/**
 * Diff Semantic Mutation Classifier.
 * Analyzes diff hunks or changed content to classify the nature of code changes.
 * Module: Core Engine — Diff Semantic Classification (router domain)
 * File Path: src/core/router/diffClassifier.ts
 * Architecture Role: Pure leaf classifier feeding sparse analyzer routing; it owns the
 *   shared DiffSemanticCategory vocabulary consumed by the category-to-analyzer policy
 * Dependencies & Triggers: No imports, IO or side effects; called by the FastTrack loop of
 *   src/core/pipeline/dualTrackPipeline.ts per changed file, right before sparseRuleRouter's
 *   routeDiffToAnalyzers consumes the returned classification
 * Responsibilities: Recover changed lines from old/new content when no explicit list is given;
 *   flag literal-only, control-flow, interface-signature, import/export and comment/doc-only
 *   mutations; return the category set plus the boolean flags of DiffClassificationResult
 * Exit Semantics & Design Rationale: Synchronous and never throws; empty input short-circuits
 *   to LITERAL_ONLY marked doc-only and an all-comment diff to COMMENT_DOC_ONLY. Unmatched or
 *   general code falls back to GENERAL_CODE, keeping the downstream route fail-open (all
 *   analyzers) instead of risking a missed analyzer on an uncertain diff.
 */

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
 * Outcome of one diff classification: matched categories plus per-dimension flags.
 *
 * `categories` is a de-duplicated set that may hold several entries at once; each boolean
 * mirrors whether the corresponding mutation kind was observed anywhere in the inspected
 * lines, so callers can gate individual analyzers without re-scanning the diff.
 */
export interface DiffClassificationResult {
    categories: Set<DiffSemanticCategory>;
    hasLiteralChange: boolean;
    hasControlFlowChange: boolean;
    hasInterfaceChange: boolean;
    hasImportExportChange: boolean;
    isDocOnly: boolean;
    /** DSpark confidence tier for speculative decoding and tiered verification bypass. */
    confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW';
    /** Inferred target language (e.g. 'typescript', 'python', 'rust', 'gdscript'). */
    language?: string;
    /** Associated target file path when provided. */
    filePath?: string;
    /** Inferred code role separating production runtime from tooling and test suites. */
    codeRole?: CodeRole;
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
 * Extract changed lines from old and new text when explicit changed lines are omitted.
 */
function extractChangedLines(
    oldContent: string,
    newContent: string,
    changedLines?: string[],
): string[] {
    if (changedLines) {
        return changedLines;
    }
    const linesToInspect: string[] = [];
    const oldLines = new Set(oldContent.split(/\r?\n/));
    const newL = newContent.split(/\r?\n/);
    for (const l of newL) {
        if (!oldLines.has(l) && l.trim()) {
            linesToInspect.push(l);
        }
    }
    return linesToInspect;
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
 * Determine if observed changes qualify exclusively as a literal mutation.
 */
function isLiteralOnlyObservation(obs: DiffLineObservation): boolean {
    if (!obs.hasLiteral || obs.hasGeneralCode) return false;
    if (obs.hasControlFlow || obs.hasInterface || obs.hasImportExport) return false;
    return true;
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
        case '.gd':
            return 'gdscript';
        case '.md':
            return 'markdown';
        default:
            return undefined;
    }
}

/**
 * Compute DSpark confidence tier based on mutation categories.
 * HIGH confidence indicates localized literal/doc modifications safe for speculative bypass.
 */
function computeConfidenceTier(
    categories: Set<DiffSemanticCategory>,
    isDocOnly: boolean,
): 'HIGH' | 'MEDIUM' | 'LOW' {
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
    return {
        categories,
        hasLiteralChange: false,
        hasControlFlowChange: false,
        hasInterfaceChange: false,
        hasImportExportChange: false,
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
    obs: DiffLineObservation,
    filePath?: string,
): DiffClassificationResult {
    const categories = new Set<DiffSemanticCategory>();
    const language = inferLanguageFromPath(filePath);

    if (obs.allComments) {
        categories.add(COMMENT_DOC_ONLY_CATEGORY);
        return {
            categories,
            hasLiteralChange: false,
            hasControlFlowChange: false,
            hasInterfaceChange: false,
            hasImportExportChange: false,
            isDocOnly: true,
            confidenceTier: 'HIGH',
            language,
            filePath,
            codeRole: inferCodeRoleFromPath(filePath),
        };
    }

    if (obs.hasImportExport) categories.add(IMPORT_EXPORT_CATEGORY);
    if (obs.hasInterface) categories.add(INTERFACE_SIGNATURE_CATEGORY);
    if (obs.hasControlFlow) categories.add(CONTROL_FLOW_CATEGORY);
    if (isLiteralOnlyObservation(obs)) {
        categories.add(LITERAL_ONLY_CATEGORY);
    }
    if (categories.size === 0 || obs.hasGeneralCode) {
        categories.add(GENERAL_CODE_CATEGORY);
    }

    return {
        categories,
        hasLiteralChange: obs.hasLiteral || categories.has(LITERAL_ONLY_CATEGORY),
        hasControlFlowChange: obs.hasControlFlow,
        hasInterfaceChange: obs.hasInterface,
        hasImportExportChange: obs.hasImportExport,
        isDocOnly: false,
        confidenceTier: computeConfidenceTier(categories, false),
        language,
        filePath,
        codeRole: inferCodeRoleFromPath(filePath),
    };
}

/**
 * Classify semantic categories from old and new content snippets or changed lines.
 *
 * When `changedLines` is omitted, candidate lines are derived from the content pair by keeping
 * non-blank new lines that do not exist in the old text; an empty candidate set reports an
 * empty literal-only diff marked as doc-only instead of throwing.
 *
 * @param oldContent - Full previous file text; read only to derive changed lines when no
 *   explicit `changedLines` list is supplied.
 * @param newContent - Current file text whose lines are compared against `oldContent`.
 * @param changedLines - Optional pre-computed changed lines; when present the two contents are
 *   ignored and the supplied lines are classified verbatim.
 * @param filePath - Optional path of target file used for language inference and metadata tracking.
 * @returns The matched category set and its boolean flags; never throws and always yields a
 *   result, falling back to `GENERAL_CODE` when a line resists narrower classification.
 */
export function classifyDiff(
    oldContent: string,
    newContent: string,
    changedLines?: string[],
    filePath?: string,
): DiffClassificationResult {
    const linesToInspect = extractChangedLines(oldContent, newContent, changedLines);
    if (linesToInspect.length === 0) {
        return buildEmptyClassificationResult(filePath);
    }

    const obs = inspectLines(linesToInspect);
    return buildClassificationResult(obs, filePath);
}
