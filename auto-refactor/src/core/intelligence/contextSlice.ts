/**
 * Module: Core Engine - Semantic Region Context Slice (Repository Intelligence consumer)
 * File Path: src/core/intelligence/contextSlice.ts
 * Architecture Role: The Agent-facing projection of the repository intelligence: given a task
 *     intent it selects the semantic regions that matter (definition, dependencies, impact) and
 *     returns a bounded, self-describing slice, so an Agent starts from evidence instead of
 *     guessing which files to open
 * Dependencies & Triggers: `SymbolIndex` from ./symbolIndex, `CallGraph` from ./callGraph;
 *     called by `api.queryContextSlice` after a scan, and by any consumer that already holds a
 *     scanner (the slice reuses the shared indexes and never re-reads the repository)
 * Responsibilities: Tokenize the intent, resolve it against the index, collect definition /
 *     dependency / impact regions with the call-graph evidence behind each one, deduplicate, cap
 *     the result by an explicit budget, and state the constraints the slice was built under
 * Exit Semantics & Design Rationale: Pure derivation over in-memory facts - no I/O, no throwing,
 *     deterministic ordering. The slice reports `truncated` and the applied budget instead of
 *     silently dropping regions, because a slice that looks complete but is not is worse than no
 *     slice at all. Unresolvable intent tokens are returned in `unresolved` rather than being
 *     ignored, so the caller can tell "nothing matched" from "matched but empty"; and the static
 *     nature of every edge is stated in `constraints` rather than implying runtime verification.
 */
import type { CallGraph } from './callGraph';
import type { SymbolIndex } from './symbolIndex';

/** Role a region plays in the slice. */
export type ContextRegionRole = 'definition' | 'dependency' | 'impact';

/** One semantic region selected for the task intent. */
export interface ContextSliceRegion {
    /** Repository-relative file owning the region. */
    file: string;
    /** Symbol the region is about. */
    symbol: string;
    /** Why this region is in the slice. */
    role: ContextRegionRole;
    /** 1-based declaration line, or null when the adapter did not materialize one. */
    line: number | null;
    /** Human-readable evidence for the selection. */
    reason: string;
}

/** Tuning for the context slice. */
export interface ContextSliceOptions {
    /** Hard cap on returned regions. Defaults to twelve. */
    maxRegions?: number;
    /** Hard cap on dependency regions. Defaults to twenty. */
    maxDependencies?: number;
    /** Hard cap on impact regions. Defaults to twenty. */
    maxImpacts?: number;
    /** Tokens ignored during intent tokenization (project-specific vocabulary). */
    stopWords?: readonly string[];
}

/** A bounded, evidence-backed slice of the repository for one task intent. */
export interface ContextSlice {
    /** The intent as given. */
    intent: string;
    /** Symbols the intent resolved to. */
    symbols: string[];
    /** Intent tokens that matched nothing in the index. */
    unresolved: string[];
    /** Selected regions, definitions first. */
    regions: ContextSliceRegion[];
    /** Callee names pulled in as dependencies. */
    dependencies: string[];
    /** Caller names pulled in as impact. */
    impacts: string[];
    /** Constraints the slice was built under. */
    constraints: string[];
    /** True when the budget cut regions out of the slice. */
    truncated: boolean;
}

const DEFAULT_MAX_REGIONS = 12;
const DEFAULT_MAX_DEPENDENCIES = 20;
const DEFAULT_MAX_IMPACTS = 20;
const MIN_TOKEN_LENGTH = 3;

/** Structural English words that carry no symbol meaning; consumers extend this per project. */
const BASE_STOP_WORDS: readonly string[] = [
    'the',
    'and',
    'for',
    'with',
    'from',
    'into',
    'add',
    'fix',
    'use',
    'not',
    'this',
    'that',
    'when',
    'then',
    'should',
    'must',
    'module',
    'file',
    'code',
];

/**
 * Split an intent into candidate symbol tokens.
 *
 * @param intent - Raw task intent.
 * @param stopWords - Extra project-specific stop words.
 * @returns Candidate tokens, deduplicated, in intent order.
 */
function intentTokens(intent: string, stopWords: readonly string[]): string[] {
    const stop = new Set([...BASE_STOP_WORDS, ...stopWords.map((word) => word.toLowerCase())]);
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const raw of intent.split(/[^A-Za-z0-9_$]+/)) {
        if (raw.length < MIN_TOKEN_LENGTH) continue;
        const lowered = raw.toLowerCase();
        if (stop.has(lowered)) continue;
        if (seen.has(raw)) continue;
        seen.add(raw);
        tokens.push(raw);
    }
    return tokens;
}

/**
 * Build a bounded semantic context slice for one task intent.
 *
 * @param intent - Task intent in natural language or identifier form.
 * @param index - Shared symbol index filled by the scan.
 * @param graph - Call graph derived from the same scan.
 * @param options - Optional caps and stop words.
 * @returns The slice, with its budget, constraints and truncation flag.
 */
export function buildContextSlice(
    intent: string,
    index: SymbolIndex,
    graph: CallGraph,
    options: ContextSliceOptions = {},
): ContextSlice {
    const maxRegions = options.maxRegions ?? DEFAULT_MAX_REGIONS;
    const maxDependencies = options.maxDependencies ?? DEFAULT_MAX_DEPENDENCIES;
    const maxImpacts = options.maxImpacts ?? DEFAULT_MAX_IMPACTS;

    const symbols: string[] = [];
    const unresolved: string[] = [];
    for (const token of intentTokens(intent, options.stopWords ?? [])) {
        const { definitions } = index.resolve(token);
        if (definitions.length > 0) symbols.push(token);
        else unresolved.push(token);
    }

    const regions: ContextSliceRegion[] = [];
    const dependencies: string[] = [];
    const impacts: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let crossFileImpacts = 0;

    const push = (region: ContextSliceRegion): void => {
        const key = `${region.role}|${region.symbol}|${region.file}|${region.line ?? ''}`;
        if (seen.has(key)) return;
        if (regions.length >= maxRegions) {
            truncated = true;
            return;
        }
        seen.add(key);
        regions.push(region);
    };

    for (const symbol of symbols) {
        const { definitions } = index.resolve(symbol);
        for (const definition of definitions) {
            push({
                file: definition.file,
                symbol,
                role: 'definition',
                line: definition.line,
                reason: `Task intent resolved definition of ${symbol} (${definition.kind})`,
            });
        }
        const calleeEdges = graph.calleesOf(symbol);
        for (const edge of calleeEdges) {
            if (dependencies.length >= maxDependencies) break;
            dependencies.push(edge.callee);
            const target = index.resolve(edge.callee).definitions[0];
            push({
                file: target?.file ?? edge.callerFile,
                symbol: edge.callee,
                role: 'dependency',
                line: target?.line ?? edge.line,
                reason: `${symbol} calls ${edge.callee}${edge.resolved ? '' : ' (unresolved external/dynamic)'}`,
            });
        }
        const callerEdges = graph.callersOf(symbol);
        for (const edge of callerEdges) {
            if (impacts.length >= maxImpacts) break;
            const caller = edge.caller ?? '(module-level)';
            impacts.push(caller);
            if (edge.callerFile !== (definitions[0]?.file ?? edge.callerFile))
                crossFileImpacts += 1;
            push({
                file: edge.callerFile,
                symbol: caller,
                role: 'impact',
                line: edge.line,
                reason: `${caller} calls ${symbol} (impact scope${edge.callerFile !== (definitions[0]?.file ?? '') ? ', cross-file' : ''})`,
            });
        }
    }

    const constraints = [
        `Budget: regions≤${maxRegions} (actual ${regions.length}${truncated ? ', truncated' : ''}), ` +
            `dependencies≤${maxDependencies} (actual ${dependencies.length}), impacts≤${maxImpacts} (actual ${impacts.length})`,
        `Cross-file impact scope: ${crossFileImpacts} call sites`,
        'Static inference: derived from shared SymbolIndex/CallGraph without runtime validation; unresolved calls explicitly flagged',
    ];

    return {
        intent,
        symbols,
        unresolved,
        regions,
        dependencies: [...new Set(dependencies)],
        impacts: [...new Set(impacts)],
        constraints,
        truncated,
    };
}
