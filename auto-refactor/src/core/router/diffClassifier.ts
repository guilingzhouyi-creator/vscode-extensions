/**
 * Diff Semantic Mutation Classifier.
 * Analyzes diff hunks or changed content to classify the nature of code changes.
 * Module: Core Engine — Diff Semantic Classification (router domain)
 * File Path: src/core/router/diffClassifier.ts
 * Architecture Role: Pure leaf classifier feeding sparse analyzer routing; it owns the
 *   shared DiffSemanticCategory vocabulary consumed by the category-to-analyzer policy
 * Dependencies & Triggers: Imports true diff primitives from edit-diff and myers-algorithm,
 *   and MutationSignal from expert-manifest; called by dualTrackPipeline FastTrack loop.
 * Responsibilities: Compute true Myers line diff between old and new content; flag literal,
 *   control-flow, interface, import/export, doc-only and deletion mutations; emit both
 *   DiffSemanticCategory and MutationSignal sets with zero implicit fallback.
 * Exit Semantics & Design Rationale: Synchronous and never throws; empty input short-circuits
 *   to LITERAL_ONLY marked doc-only and an all-comment diff to COMMENT_DOC_ONLY. Unmatched or
 *   general code falls back to GENERAL_CODE, keeping downstream routing fail-open.
 */

import { computeEditRangesWithOps, linesOf } from '../diff/edit-diff';
import { DIFF_OP_DELETE, DIFF_OP_INSERT } from '../diff/myers-algorithm';
import type { MutationSignal } from './expert-manifest';

/** Mutation category for a hunk whose only change is a literal value. */
const LITERAL_ONLY_CATEGORY = 'LITERAL_ONLY' as const;
const CONTROL_FLOW_CATEGORY = 'CONTROL_FLOW' as const;
const INTERFACE_SIGNATURE_CATEGORY = 'INTERFACE_SIGNATURE' as const;
const IMPORT_EXPORT_CATEGORY = 'IMPORT_EXPORT' as const;
const COMMENT_DOC_ONLY_CATEGORY = 'COMMENT_DOC_ONLY' as const;
const GENERAL_CODE_CATEGORY = 'GENERAL_CODE' as const;

/**
 * Closed vocabulary of mutation categories emitted by {@link classifyDiff}.
 *
 * The union stays small on purpose so the sparse router can map each category to a stable
 * analyzer subset; `GENERAL_CODE` is the fail-open fallback used when no narrower category is
 * proven. Categories describe why a hunk changed, never how severe the change is.
 */
export type DiffSemanticCategory =
    | typeof LITERAL_ONLY_CATEGORY
    | typeof CONTROL_FLOW_CATEGORY
    | typeof INTERFACE_SIGNATURE_CATEGORY
    | typeof IMPORT_EXPORT_CATEGORY
    | typeof COMMENT_DOC_ONLY_CATEGORY
    | typeof GENERAL_CODE_CATEGORY;

/**
 * Architectural code role of the file housing the diff, separating production
 * runtime from scripts and tests.
 */
/** Production runtime code role. */
export const CODE_ROLE_PRODUCTION = 'PRODUCTION' as const;
/** Maintenance or build tooling script code role. */
export const CODE_ROLE_TOOL_SCRIPT = 'TOOL_SCRIPT' as const;
/** Automated test suite or fixture code role. */
export const CODE_ROLE_TEST_SUITE = 'TEST_SUITE' as const;

/** Union of architectural code roles. */
export type CodeRole =
    typeof CODE_ROLE_PRODUCTION | typeof CODE_ROLE_TOOL_SCRIPT | typeof CODE_ROLE_TEST_SUITE;

/**
 * Outcome of one diff classification: matched categories, mutation signals, and flags.
 */
export interface DiffClassificationResult {
    categories: Set<DiffSemanticCategory>;
    /** Fine-grained normative mutation signals for sparse routing. */
    signals: Set<MutationSignal>;
    hasLiteralChange: boolean;
    hasControlFlowChange: boolean;
    hasInterfaceChange: boolean;
    hasImportExportChange: boolean;
    /** True when any non-comment code lines were removed in this diff. */
    hasDeletion: boolean;
    isDocOnly: boolean;
    /** DSpark confidence tier for speculative decoding and tiered verification bypass. */
    confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW';
    /** Inferred target language (e.g. 'typescript', 'python', 'rust', 'gdscript', 'go'). */
    language?: string;
    /** Associated target file path when provided. */
    filePath?: string;
    /** Inferred code role separating production runtime from tooling and test suites. */
    codeRole?: CodeRole;
}

/**
 * Optional configuration options passed to {@link classifyDiff}.
 */
export interface DiffOptions {
    /** Target file path used for language and architectural code role inference. */
    filePath?: string;
}

const CONTROL_FLOW_RE =
    /\b(if|else|for|while|switch|case|match|return|throw|try|catch|break|continue|yield|await)\b/;
const INTERFACE_SIG_RE =
    /\b(export|class|interface|type|struct|enum|impl|function|def|fn)\s+([A-Za-z0-9_$]+)/;
const IMPORT_EXPORT_RE = /\b(import\b|export\s+(?:\*|\{)|from\s+['"]|require\s*\()/;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#)/;

interface DiffLineObservation {
    allComments: boolean;
    hasControlFlow: boolean;
    hasInterface: boolean;
    hasImportExport: boolean;
    hasLiteral: boolean;
    hasGeneralCode: boolean;
}

/**
 * Check whether a trimmed code line is predominantly literal definitions or assignments.
 */
function isPredominantlyLiteralLine(trimmed: string): boolean {
    return (
        /^['"][^'"]*['"][,;]?$/.test(trimmed) ||
        /^[0-9]+[LUlu]?[,;]?$/.test(trimmed) ||
        /^(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:['"][^'"]*['"]|[0-9]+)[,;]?$/.test(trimmed)
    );
}

/**
 * Inspect individual changed lines to collect semantic mutation indicators.
 */
function inspectLines(lines: string[]): DiffLineObservation {
    let allComments = true;
    let hasControlFlow = false;
    let hasInterface = false;
    let hasImportExport = false;
    let hasLiteral = false;
    let hasGeneralCode = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (COMMENT_LINE_RE.test(trimmed)) {
            continue;
        }
        allComments = false;

        if (IMPORT_EXPORT_RE.test(trimmed)) {
            hasImportExport = true;
        }
        if (INTERFACE_SIG_RE.test(trimmed)) {
            hasInterface = true;
        }
        if (CONTROL_FLOW_RE.test(trimmed)) {
            hasControlFlow = true;
        }

        if (isPredominantlyLiteralLine(trimmed)) {
            hasLiteral = true;
        } else {
            hasGeneralCode = true;
        }
    }

    return {
        allComments,
        hasControlFlow,
        hasInterface,
        hasImportExport,
        hasLiteral,
        hasGeneralCode,
    };
}

/**
 * Infer source language from file path extension.
 */
function inferLanguageFromPath(filePath?: string): string | undefined {
    if (!filePath) return undefined;
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    switch (ext) {
        case '.ts':
        case '.tsx':
        case '.mts':
        case '.cts':
            return 'typescript';
        case '.js':
        case '.jsx':
        case '.mjs':
        case '.cjs':
            return 'javascript';
        case '.py':
            return 'python';
        case '.rs':
            return 'rust';
        case '.go':
            return 'go';
        case '.gd':
            return 'gdscript';
        case '.md':
            return 'markdown';
        default:
            return undefined;
    }
}

/**
 * Compute DSpark confidence tier based on mutation categories and deletion attributes.
 */
function computeConfidenceTier(
    categories: Set<DiffSemanticCategory>,
    isDocOnly: boolean,
    hasStructuralDeletion: boolean,
): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (hasStructuralDeletion) {
        return 'LOW';
    }
    if (isDocOnly || (categories.size === 1 && categories.has(LITERAL_ONLY_CATEGORY))) {
        return 'HIGH';
    }
    if (
        categories.has(IMPORT_EXPORT_CATEGORY) ||
        categories.has(INTERFACE_SIGNATURE_CATEGORY) ||
        categories.has(GENERAL_CODE_CATEGORY)
    ) {
        return 'LOW';
    }
    return 'MEDIUM';
}

/**
 * Infer architectural code role from file path to separate production code from tests and scripts.
 *
 * @param filePath - Optional file path of the diff target.
 * @returns Inferred CodeRole enum ('PRODUCTION', 'TOOL_SCRIPT', or 'TEST_SUITE').
 */
export function inferCodeRoleFromPath(filePath?: string): CodeRole {
    if (!filePath) return CODE_ROLE_PRODUCTION;
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (
        /(?:^|\/)(?:tests?|testdata|benchmarks?|fixtures?|specs?)\//.test(normalized) ||
        normalized.endsWith('.test.ts') ||
        normalized.endsWith('.spec.ts') ||
        normalized.endsWith('.test.js')
    ) {
        return CODE_ROLE_TEST_SUITE;
    }
    if (/(?:^|\/)(?:scripts|tools?|bin)\//.test(normalized)) {
        return CODE_ROLE_TOOL_SCRIPT;
    }
    return CODE_ROLE_PRODUCTION;
}

/**
 * Construct empty classification result for zero inspected lines.
 */
function buildEmptyClassificationResult(filePath?: string): DiffClassificationResult {
    const categories = new Set<DiffSemanticCategory>([LITERAL_ONLY_CATEGORY]);
    const signals = new Set<MutationSignal>(['LITERAL']);
    return {
        categories,
        signals,
        hasLiteralChange: false,
        hasControlFlowChange: false,
        hasInterfaceChange: false,
        hasImportExportChange: false,
        hasDeletion: false,
        isDocOnly: true,
        confidenceTier: 'HIGH',
        language: inferLanguageFromPath(filePath),
        filePath,
        codeRole: inferCodeRoleFromPath(filePath),
    };
}

/**
 * Construct final DiffClassificationResult from aggregated line observations.
 */
function buildClassificationResult(
    addedObs: DiffLineObservation,
    removedObs: DiffLineObservation,
    filePath?: string,
): DiffClassificationResult {
    const categories = new Set<DiffSemanticCategory>();
    const signals = new Set<MutationSignal>();
    const language = inferLanguageFromPath(filePath);
    const codeRole = inferCodeRoleFromPath(filePath);

    if (addedObs.allComments && removedObs.allComments) {
        categories.add(COMMENT_DOC_ONLY_CATEGORY);
        signals.add('DOC_COMMENT');
        return {
            categories,
            signals,
            hasLiteralChange: false,
            hasControlFlowChange: false,
            hasInterfaceChange: false,
            hasImportExportChange: false,
            hasDeletion: false,
            isDocOnly: true,
            confidenceTier: 'HIGH',
            language,
            filePath,
            codeRole,
        };
    }

    const hasDeletion = !removedObs.allComments;
    if (hasDeletion) {
        signals.add('DELETION');
    }

    const hasImportExport = addedObs.hasImportExport || removedObs.hasImportExport;
    const hasInterface = addedObs.hasInterface || removedObs.hasInterface;
    const hasControlFlow = addedObs.hasControlFlow || removedObs.hasControlFlow;
    const hasLiteral = addedObs.hasLiteral || removedObs.hasLiteral;
    const hasGeneralCode = addedObs.hasGeneralCode || removedObs.hasGeneralCode;

    if (hasImportExport) {
        categories.add(IMPORT_EXPORT_CATEGORY);
        signals.add('IMPORT_EXPORT');
    }
    if (hasInterface) {
        categories.add(INTERFACE_SIGNATURE_CATEGORY);
        signals.add('INTERFACE_SIGNATURE');
    }
    if (hasControlFlow) {
        categories.add(CONTROL_FLOW_CATEGORY);
        signals.add('CONTROL_FLOW');
    }

    const isLiteralOnlyChange =
        hasLiteral && !hasGeneralCode && !hasControlFlow && !hasInterface && !hasImportExport;
    if (isLiteralOnlyChange) {
        categories.add(LITERAL_ONLY_CATEGORY);
        signals.add('LITERAL');
    }
    if (categories.size === 0 || hasGeneralCode) {
        categories.add(GENERAL_CODE_CATEGORY);
        signals.add('GENERAL_CODE');
    }

    const hasStructuralDeletion =
        !removedObs.allComments &&
        (removedObs.hasControlFlow ||
            removedObs.hasInterface ||
            removedObs.hasImportExport ||
            removedObs.hasGeneralCode);
    const confidenceTier = computeConfidenceTier(categories, false, hasStructuralDeletion);

    return {
        categories,
        signals,
        hasLiteralChange: hasLiteral || categories.has(LITERAL_ONLY_CATEGORY),
        hasControlFlowChange: hasControlFlow,
        hasInterfaceChange: hasInterface,
        hasImportExportChange: hasImportExport,
        hasDeletion,
        isDocOnly: false,
        confidenceTier,
        language,
        filePath,
        codeRole,
    };
}

/**
 * Classify semantic categories and mutation signals from old and new content via true diff.
 *
 * Calculates Myers line-level diff ops between oldContent and newContent to extract
 * added and removed lines, flagging structural deletions and computing sparse routing signals.
 *
 * @param oldContent - Full previous file text.
 * @param newContent - Current file text compared against `oldContent`.
 * @param options - Optional file path or DiffOptions object for language and role inference.
 * @returns The matched category set, signal set, and boolean mutation flags; never throws.
 */
export function classifyDiff(
    oldContent: string,
    newContent: string,
    options?: DiffOptions | string,
): DiffClassificationResult {
    const filePath = typeof options === 'string' ? options : options?.filePath;
    if (oldContent === newContent) {
        return buildEmptyClassificationResult(filePath);
    }

    const { ops, oldIndex, newIndex } = computeEditRangesWithOps(oldContent, newContent);
    if (ops.length === 0) {
        return buildEmptyClassificationResult(filePath);
    }

    const oldLines = linesOf(oldContent, oldIndex.starts);
    const newLines = linesOf(newContent, newIndex.starts);

    const addedLines: string[] = [];
    const removedLines: string[] = [];

    for (const op of ops) {
        if (op.type === DIFF_OP_INSERT) {
            addedLines.push(newLines[op.bIdx]);
        } else if (op.type === DIFF_OP_DELETE) {
            removedLines.push(oldLines[op.aIdx]);
        }
    }

    if (addedLines.length === 0 && removedLines.length === 0) {
        return buildEmptyClassificationResult(filePath);
    }

    const addedObs = inspectLines(addedLines);
    const removedObs = inspectLines(removedLines);
    return buildClassificationResult(addedObs, removedObs, filePath);
}
