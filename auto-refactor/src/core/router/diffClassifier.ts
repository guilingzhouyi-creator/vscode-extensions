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
import {
    CATEGORY_LITERAL_ONLY,
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_IMPORT_EXPORT,
    CATEGORY_COMMENT_DOC_ONLY,
    CATEGORY_GENERAL_CODE,
    type DiffSemanticCategory,
} from './sliceTypes';

const CONFIDENCE_HIGH = 'HIGH' as const;
const CONFIDENCE_MEDIUM = 'MEDIUM' as const;
const CONFIDENCE_LOW = 'LOW' as const;

/** DSpark confidence tiers for speculative verification gating. */
export type ConfidenceTier =
    typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM | typeof CONFIDENCE_LOW;

const SIGNAL_DOC_COMMENT: MutationSignal = 'DOC_COMMENT';
const SIGNAL_DELETION: MutationSignal = 'DELETION';
const SIGNAL_IMPORT_EXPORT: MutationSignal = 'IMPORT_EXPORT';
const SIGNAL_INTERFACE_SIGNATURE: MutationSignal = 'INTERFACE_SIGNATURE';
const SIGNAL_CONTROL_FLOW: MutationSignal = 'CONTROL_FLOW';
const SIGNAL_LITERAL: MutationSignal = 'LITERAL';
const SIGNAL_GENERAL_CODE: MutationSignal = 'GENERAL_CODE';

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
    confidenceTier: ConfidenceTier;
    /** Inferred target language. */
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

const TEST_PATH_RE =
    /(?:^|\/)(?:tests?|testdata|benchmarks?|fixtures?|specs?)\/|\.(?:test|spec)\.[tj]sx?$/;
const TOOL_PATH_RE = /(?:^|\/)(?:scripts|tools?|bin)\//;

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
        if (COMMENT_LINE_RE.test(trimmed)) continue;
        allComments = false;

        if (IMPORT_EXPORT_RE.test(trimmed)) hasImportExport = true;
        if (INTERFACE_SIG_RE.test(trimmed)) hasInterface = true;
        if (CONTROL_FLOW_RE.test(trimmed)) hasControlFlow = true;

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
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) return undefined;
    const ext = filePath.slice(dot).toLowerCase();
    if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript';
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
    if (ext === '.py') return 'python';
    if (ext === '.rs') return 'rust';
    if (ext === '.go') return 'go';
    if (ext === '.gd') return 'gdscript';
    if (ext === '.md') return 'markdown';
    return undefined;
}

/**
 * Compute DSpark confidence tier based on mutation categories and deletion attributes.
 */
function computeConfidenceTier(
    categories: Set<DiffSemanticCategory>,
    isDocOnly: boolean,
    hasStructuralDeletion: boolean,
): ConfidenceTier {
    if (hasStructuralDeletion) return CONFIDENCE_LOW;
    if (isDocOnly || (categories.size === 1 && categories.has(CATEGORY_LITERAL_ONLY))) {
        return CONFIDENCE_HIGH;
    }
    if (
        categories.has(CATEGORY_IMPORT_EXPORT) ||
        categories.has(CATEGORY_INTERFACE_SIGNATURE) ||
        categories.has(CATEGORY_GENERAL_CODE)
    ) {
        return CONFIDENCE_LOW;
    }
    return CONFIDENCE_MEDIUM;
}

/**
 * Infer architectural code role from file path to separate production code from tests and scripts.
 *
 * @param filePath - Candidate file path to inspect.
 * @returns Inferred CodeRole category.
 */
export function inferCodeRoleFromPath(filePath?: string): CodeRole {
    if (!filePath) return CODE_ROLE_PRODUCTION;
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (TEST_PATH_RE.test(normalized)) return CODE_ROLE_TEST_SUITE;
    if (TOOL_PATH_RE.test(normalized)) return CODE_ROLE_TOOL_SCRIPT;
    return CODE_ROLE_PRODUCTION;
}

/**
 * Construct simple zero-mutation / doc-only classification result.
 */
function buildSimpleResult(
    category: DiffSemanticCategory,
    signal: MutationSignal,
    filePath?: string,
): DiffClassificationResult {
    return {
        categories: new Set<DiffSemanticCategory>([category]),
        signals: new Set<MutationSignal>([signal]),
        hasLiteralChange: false,
        hasControlFlowChange: false,
        hasInterfaceChange: false,
        hasImportExportChange: false,
        hasDeletion: false,
        isDocOnly: true,
        confidenceTier: CONFIDENCE_HIGH,
        language: inferLanguageFromPath(filePath),
        filePath,
        codeRole: inferCodeRoleFromPath(filePath),
    };
}

function buildEmptyClassificationResult(filePath?: string): DiffClassificationResult {
    return buildSimpleResult(CATEGORY_LITERAL_ONLY, SIGNAL_LITERAL, filePath);
}

function buildDocOnlyResult(filePath?: string): DiffClassificationResult {
    return buildSimpleResult(CATEGORY_COMMENT_DOC_ONLY, SIGNAL_DOC_COMMENT, filePath);
}

interface MergedObs {
    hasImportExport: boolean;
    hasInterface: boolean;
    hasControlFlow: boolean;
    hasLiteral: boolean;
    hasGeneralCode: boolean;
}

function mergeObservations(a: DiffLineObservation, b: DiffLineObservation): MergedObs {
    return {
        hasImportExport: a.hasImportExport || b.hasImportExport,
        hasInterface: a.hasInterface || b.hasInterface,
        hasControlFlow: a.hasControlFlow || b.hasControlFlow,
        hasLiteral: a.hasLiteral || b.hasLiteral,
        hasGeneralCode: a.hasGeneralCode || b.hasGeneralCode,
    };
}

function isStructuralDeletion(obs: DiffLineObservation): boolean {
    if (obs.allComments) return false;
    return obs.hasControlFlow || obs.hasInterface || obs.hasImportExport || obs.hasGeneralCode;
}

/**
 * Populate fine-grained mutation categories and signals from diff observations.
 */
function populateMutationCategories(
    m: MergedObs,
    categories: Set<DiffSemanticCategory>,
    signals: Set<MutationSignal>,
): void {
    if (m.hasImportExport) {
        categories.add(CATEGORY_IMPORT_EXPORT);
        signals.add(SIGNAL_IMPORT_EXPORT);
    }
    if (m.hasInterface) {
        categories.add(CATEGORY_INTERFACE_SIGNATURE);
        signals.add(SIGNAL_INTERFACE_SIGNATURE);
    }
    if (m.hasControlFlow) {
        categories.add(CATEGORY_CONTROL_FLOW);
        signals.add(SIGNAL_CONTROL_FLOW);
    }
    const hasOther = m.hasGeneralCode || m.hasControlFlow || m.hasInterface || m.hasImportExport;
    if (m.hasLiteral && !hasOther) {
        categories.add(CATEGORY_LITERAL_ONLY);
        signals.add(SIGNAL_LITERAL);
    }
    if (categories.size === 0 || m.hasGeneralCode) {
        categories.add(CATEGORY_GENERAL_CODE);
        signals.add(SIGNAL_GENERAL_CODE);
    }
}

/**
 * Construct final DiffClassificationResult from aggregated line observations.
 */
function buildClassificationResult(
    addedObs: DiffLineObservation,
    removedObs: DiffLineObservation,
    filePath?: string,
): DiffClassificationResult {
    if (addedObs.allComments && removedObs.allComments) {
        return buildDocOnlyResult(filePath);
    }

    const categories = new Set<DiffSemanticCategory>();
    const signals = new Set<MutationSignal>();
    const hasDeletion = !removedObs.allComments;
    if (hasDeletion) {
        signals.add(SIGNAL_DELETION);
    }

    const merged = mergeObservations(addedObs, removedObs);
    populateMutationCategories(merged, categories, signals);

    const confidenceTier = computeConfidenceTier(
        categories,
        false,
        isStructuralDeletion(removedObs),
    );

    return {
        categories,
        signals,
        hasLiteralChange: merged.hasLiteral || categories.has(CATEGORY_LITERAL_ONLY),
        hasControlFlowChange: merged.hasControlFlow,
        hasInterfaceChange: merged.hasInterface,
        hasImportExportChange: merged.hasImportExport,
        hasDeletion,
        isDocOnly: false,
        confidenceTier,
        language: inferLanguageFromPath(filePath),
        filePath,
        codeRole: inferCodeRoleFromPath(filePath),
    };
}

/**
 * Extract added and removed text lines from Myers diff operations.
 */
function extractDiffLines(
    ops: readonly any[],
    oldLines: readonly string[],
    newLines: readonly string[],
): { addedLines: string[]; removedLines: string[] } {
    const addedLines: string[] = [];
    const removedLines: string[] = [];
    for (const op of ops) {
        if (op.type === DIFF_OP_INSERT) addedLines.push(newLines[op.bIdx]);
        if (op.type === DIFF_OP_DELETE) removedLines.push(oldLines[op.aIdx]);
    }
    return { addedLines, removedLines };
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
    const { addedLines, removedLines } = extractDiffLines(ops, oldLines, newLines);

    if (addedLines.length === 0 && removedLines.length === 0) {
        return buildEmptyClassificationResult(filePath);
    }

    const addedObs = inspectLines(addedLines);
    const removedObs = inspectLines(removedLines);
    return buildClassificationResult(addedObs, removedObs, filePath);
}
