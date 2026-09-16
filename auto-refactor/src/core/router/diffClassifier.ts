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
const LITERAL_ONLY_CATEGORY = 'LITERAL_ONLY';

/**
 * Closed vocabulary of mutation categories emitted by {@link classifyDiff}.
 *
 * The union stays small on purpose so the sparse router can map each category to a stable
 * analyzer subset; `GENERAL_CODE` is the fail-open fallback used when no narrower category is
 * proven. Categories describe why a hunk changed, never how severe the change is.
 */
export type DiffSemanticCategory =
    | typeof LITERAL_ONLY_CATEGORY
    | 'CONTROL_FLOW'
    | 'INTERFACE_SIGNATURE'
    | 'IMPORT_EXPORT'
    | 'COMMENT_DOC_ONLY'
    | 'GENERAL_CODE';

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
}

const CONTROL_FLOW_RE =
    /\b(if|else|for|while|switch|case|match|return|throw|try|catch|break|continue|yield|await)\b/;
const INTERFACE_SIG_RE =
    /\b(export|class|interface|type|struct|enum|impl|function|def|fn)\s+([A-Za-z0-9_$]+)/;
const IMPORT_EXPORT_RE = /\b(import\b|export\s+(?:\*|\{)|from\s+['"]|require\s*\()/;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#)/;

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
 * @returns The matched category set and its boolean flags; never throws and always yields a
 *   result, falling back to `GENERAL_CODE` when a line resists narrower classification.
 */
export function classifyDiff(
    oldContent: string,
    newContent: string,
    changedLines?: string[],
): DiffClassificationResult {
    // If changed lines not provided, extract non-identical lines
    const linesToInspect: string[] = changedLines || [];
    if (!changedLines) {
        const oldLines = new Set(oldContent.split(/\r?\n/));
        const newL = newContent.split(/\r?\n/);
        for (const l of newL) {
            if (!oldLines.has(l) && l.trim()) {
                linesToInspect.push(l);
            }
        }
    }

    const categories = new Set<DiffSemanticCategory>();

    if (linesToInspect.length === 0) {
        return {
            categories: new Set([LITERAL_ONLY_CATEGORY]),
            hasLiteralChange: false,
            hasControlFlowChange: false,
            hasInterfaceChange: false,
            hasImportExportChange: false,
            isDocOnly: true,
        };
    }

    let allComments = true;
    let hasControlFlow = false;
    let hasInterface = false;
    let hasImportExport = false;
    let hasLiteral = false;
    let hasGeneralCode = false;

    for (const line of linesToInspect) {
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

        // Check if line is predominantly literals
        const isLiteralOnlyLine =
            /^['"][^'"]*['"][,;]?$/.test(trimmed) ||
            /^[0-9]+[LUlu]?[,;]?$/.test(trimmed) ||
            /^(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:['"][^'"]*['"]|[0-9]+)[,;]?$/.test(
                trimmed,
            );

        if (isLiteralOnlyLine) {
            hasLiteral = true;
        } else {
            hasGeneralCode = true;
        }
    }

    if (allComments) {
        categories.add('COMMENT_DOC_ONLY');
        return {
            categories,
            hasLiteralChange: false,
            hasControlFlowChange: false,
            hasInterfaceChange: false,
            hasImportExportChange: false,
            isDocOnly: true,
        };
    }

    if (hasImportExport) categories.add('IMPORT_EXPORT');
    if (hasInterface) categories.add('INTERFACE_SIGNATURE');
    if (hasControlFlow) categories.add('CONTROL_FLOW');
    if (hasLiteral && !hasGeneralCode && !hasControlFlow && !hasInterface && !hasImportExport) {
        categories.add(LITERAL_ONLY_CATEGORY);
    }
    if (categories.size === 0 || hasGeneralCode) {
        categories.add('GENERAL_CODE');
    }

    return {
        categories,
        hasLiteralChange: hasLiteral || categories.has(LITERAL_ONLY_CATEGORY),
        hasControlFlowChange: hasControlFlow,
        hasInterfaceChange: hasInterface,
        hasImportExportChange: hasImportExport,
        isDocOnly: false,
    };
}
