/**
 * Module: Core Engine - Native Acceleration Bridge & Pure JS Fallback Shim
 * File Path: src/core/native/native-bridge.ts
 * Architecture Role: High-performance execution bridge providing transparent dual-track
 *   dispatch between compiled Rust native core (N-API) and deterministic pure JS algorithms.
 * Dependencies & Triggers: Consumes native-types.ts, edit-diff, and histogram-diff;
 *   invoked by execution schedulers, diff stream processors, and dependency graph analyzers.
 * Responsibilities:
 *   1. Dynamically probe and load optional compiled Rust native bindings;
 *   2. Supply complete, byte-equivalent pure JS implementations for histogram diff,
 *      Tarjan SCC cycle detection, topological sorting, and fast pattern matching;
 *   3. Deliver zero-overhead singleton interface `nativeCore` and convenience helpers.
 * Exit Semantics & Design Rationale: Never throws during initialization or execution;
 *   guarantees 100% algorithmic parity and platform neutrality across all Node environments.
 */

import type {
    INativeCore,
    NativeCloneBlock,
    NativeClonePair,
    NativeCoreStatus,
    NativeDataflowParams,
    NativeDataflowResult,
    NativeDiffHunk,
    NativeDominatorTreeResult,
    NativeGraphAnalysis,
    NativeMaskConfig,
    NativeMaskedSource,
    NativePatternMatch,
} from './native-types';
import { computeLineStartsAndHashes, linesOf, type LineIndex } from '../diff/edit-diff';
import { histogramDiff } from '../diff/histogram-diff';
import type { DiffOp } from '../diff/myers-algorithm';
import { DIFF_OP_EQUAL, DIFF_OP_DELETE, DIFF_OP_INSERT } from '../diff/myers-algorithm';
import { countLineStats } from '../../utils/linestats';
import { maskSourceTextJs } from '../policy/source-mask';
import {
    countDuplicateLinesShim,
    detectCloneBlocksShim,
    computeMinHashShim,
    findClonePairsShim,
    HASH_COEFFS,
} from './native-clone-shim';
import { computeDominatorTreeShim, solveDataflowShim } from './native-flow-shim';

export { HASH_COEFFS };

const EMPTY_NEIGHBOR_SET = new Set<string>();

interface TarjanState {
    indexCounter: number;
    indices: Map<string, number>;
    lowlinks: Map<string, number>;
    onStack: Set<string>;
    stack: string[];
    sccs: string[][];
    cycles: string[][];
    adjacency: Map<string, Set<string>>;
}

function addDirectedEdge(
    from: string,
    to: string,
    adjacency: Map<string, Set<string>>,
    inDegree: Map<string, number>,
): void {
    let neighbors = adjacency.get(from);
    if (!neighbors) {
        neighbors = new Set();
        adjacency.set(from, neighbors);
    }
    if (!neighbors.has(to)) {
        neighbors.add(to);
        inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }
    if (!inDegree.has(from)) {
        inDegree.set(from, 0);
    }
}

function strongConnect(node: string, state: TarjanState): void {
    state.indices.set(node, state.indexCounter);
    state.lowlinks.set(node, state.indexCounter);
    state.indexCounter++;
    state.stack.push(node);
    state.onStack.add(node);

    const neighbors = state.adjacency.get(node) || EMPTY_NEIGHBOR_SET;
    for (const neighbor of neighbors) {
        if (!state.indices.has(neighbor)) {
            strongConnect(neighbor, state);
            state.lowlinks.set(
                node,
                Math.min(state.lowlinks.get(node)!, state.lowlinks.get(neighbor)!),
            );
            continue;
        }
        if (state.onStack.has(neighbor)) {
            state.lowlinks.set(
                node,
                Math.min(state.lowlinks.get(node)!, state.indices.get(neighbor)!),
            );
        }
    }

    if (state.lowlinks.get(node) === state.indices.get(node)) {
        popScc(node, state);
    }
}

function popScc(node: string, state: TarjanState): void {
    const scc: string[] = [];
    let popped: string;
    do {
        popped = state.stack.pop()!;
        state.onStack.delete(popped);
        scc.push(popped);
    } while (popped !== node);

    state.sccs.push(scc);
    if (scc.length > 1) {
        state.cycles.push([...scc].reverse());
        return;
    }
    if (scc.length === 1 && state.adjacency.get(node)?.has(node)) {
        state.cycles.push([node, node]);
    }
}

function computeSccsAndCycles(
    allNodes: Set<string>,
    adjacency: Map<string, Set<string>>,
): { sccs: string[][]; cycles: string[][] } {
    const state: TarjanState = {
        indexCounter: 0,
        indices: new Map(),
        lowlinks: new Map(),
        onStack: new Set(),
        stack: [],
        sccs: [],
        cycles: [],
        adjacency,
    };
    for (const node of allNodes) {
        if (!state.indices.has(node)) {
            strongConnect(node, state);
        }
    }
    return { sccs: state.sccs, cycles: state.cycles };
}

function computeTopologicalOrder(
    allNodes: Set<string>,
    adjacency: Map<string, Set<string>>,
    inDegree: Map<string, number>,
): string[] {
    const inDegreeCopy = new Map<string, number>();
    for (const node of allNodes) {
        inDegreeCopy.set(node, inDegree.get(node) || 0);
    }

    const queue: string[] = [];
    for (const node of allNodes) {
        if (inDegreeCopy.get(node) === 0) {
            queue.push(node);
        }
    }
    queue.sort();

    const topologicalOrder: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift()!;
        topologicalOrder.push(current);

        const neighbors = adjacency.get(current) || EMPTY_NEIGHBOR_SET;
        for (const next of neighbors) {
            const remainingIn = inDegreeCopy.get(next)! - 1;
            inDegreeCopy.set(next, remainingIn);
            if (remainingIn === 0) {
                queue.push(next);
                queue.sort();
            }
        }
    }

    for (const node of allNodes) {
        if (!topologicalOrder.includes(node)) {
            topologicalOrder.push(node);
        }
    }
    return topologicalOrder;
}

function findPatternMatchesInLine(
    line: string,
    pattern: string,
    lineNum: number,
    results: NativePatternMatch[],
): void {
    let startCol = 0;
    while (startCol < line.length) {
        const matchIndex = line.indexOf(pattern, startCol);
        if (matchIndex === -1) break;
        results.push({
            pattern,
            line: lineNum,
            column: matchIndex + 1,
            matchText: pattern,
        });
        startCol = matchIndex + Math.max(1, pattern.length);
    }
}

interface HunkBuilderState {
    oldStart: number;
    newStart: number;
    oldLinesCount: number;
    newLinesCount: number;
    lines: string[];
    firstOldAssigned: boolean;
    firstNewAssigned: boolean;
}

function applyDiffOpEqual(op: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = op.aIdx + 1;
        state.firstOldAssigned = true;
    }
    if (!state.firstNewAssigned) {
        state.newStart = op.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.oldLinesCount++;
    state.newLinesCount++;
    state.lines.push(' ' + (oldLines[op.aIdx] ?? ''));
}

function applyDiffOpDelete(op: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = op.aIdx + 1;
        state.firstOldAssigned = true;
    }
    state.oldLinesCount++;
    state.lines.push('-' + (oldLines[op.aIdx] ?? ''));
}

function applyDiffOpInsert(op: DiffOp, newLines: string[], state: HunkBuilderState): void {
    if (!state.firstNewAssigned) {
        state.newStart = op.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.newLinesCount++;
    state.lines.push('+' + (newLines[op.bIdx] ?? ''));
}

/**
 * Drop the synthetic line start that follows a trailing newline.
 *
 * `computeLineStarts` records an offset immediately after every `\n`, so content ending in a
 * newline yields a final start that denotes an empty final line. The Rust operator does not
 * emit that line, and keeping it made the shim's diff hunks one context line longer and the
 * hunk spans one line larger than the native ones for identical input. The start is removed
 * only when it genuinely points past the last character.
 *
 * @param content - Source text the offsets were computed from.
 * @param starts - Line-start offsets.
 * @returns Offsets without the trailing empty line.
 */
function trimTrailingLineStart(content: string, starts: number[]): number[] {
    if (starts.length > 0 && starts[starts.length - 1] >= content.length) {
        return starts.slice(0, starts.length - 1);
    }
    return starts;
}

/**
 * Split content into lines the way the Rust operator does.
 *
 * `linesOf` derives the last line's end from `content.length`, so a file ending in a newline
 * yields a final line that still carries its `\n`, while every earlier line has already had
 * the terminator removed. The Rust `split_lines` strips the terminator uniformly, so the
 * trailing newline is trimmed here to keep both engines byte-identical.
 *
 * @param content - Source text to split.
 * @param starts - Line-start offsets, already trimmed of any synthetic trailing line.
 * @returns One string per line, without line terminators.
 */
function splitLinesLikeNative(content: string, starts: number[]): string[] {
    const out = linesOf(content, starts);
    if (out.length > 0) {
        out[out.length - 1] = out[out.length - 1].replace(/\r?\n$/, '');
    }
    return out;
}

/**
 * Line hashes truncated to match a trimmed line count.
 *
 * @param index - Line index produced by `computeLineStartsAndHashes`.
 * @param lineCount - Number of lines after trailing-line trimming.
 * @returns Hash array of exactly `lineCount` entries.
 */
function trimTrailingHash(index: LineIndex, lineCount: number): Uint32Array {
    if (index.hashes.length === lineCount) {
        return index.hashes;
    }
    return index.hashes.slice(0, lineCount);
}

/**
 * Pure JavaScript fallback implementation of INativeCore.
 * Provides Git-grade histogram diff, Tarjan strongly connected components,
 * deterministic topological sorting, and MinHash clone detection without native dependencies.
 */
export class PureJsNativeShim implements INativeCore {
    private readonly defaultContextLines: number;

    public constructor(defaultContextLines = 3) {
        this.defaultContextLines = defaultContextLines;
    }

    /**
     * Inspects active shim status.
     */
    public getStatus(): NativeCoreStatus {
        return {
            isNativeAvailable: false,
            activeEngine: 'pure-js-shim',
            version: '0.4.0-shim',
            capabilities: [
                'histogram-diff',
                'tarjan-scc',
                'topological-sort',
                'fast-pattern-match',
                'simd-source-mask',
                'clone-detection',
                'minhash-lsh',
                'dominator-tree',
                'dataflow-solver',
            ],
        };
    }

    /**
     * Computes line-level histogram diff hunks between oldContent and newContent.
     */
    public computeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
        if (oldContent === newContent) {
            return [];
        }

        // The Rust `split_lines` yields one line per '\n' and does not synthesise a trailing
        // empty line, whereas `computeLineStarts` records a start offset just past a final
        // newline. Feeding that extra empty line into the diff made the shim report one more
        // context line and a larger hunk span than the native operator for the same input,
        // so the trailing start is dropped here to keep the two engines byte-identical.
        const oldIndex = computeLineStartsAndHashes(oldContent);
        const newIndex = computeLineStartsAndHashes(newContent);
        const oldLines = splitLinesLikeNative(
            oldContent,
            trimTrailingLineStart(oldContent, oldIndex.starts),
        );
        const newLines = splitLinesLikeNative(
            newContent,
            trimTrailingLineStart(newContent, newIndex.starts),
        );

        const oldHashes = trimTrailingHash(oldIndex, oldLines.length);
        const newHashes = trimTrailingHash(newIndex, newLines.length);

        const ops = histogramDiff(oldLines, newLines, oldHashes, newHashes);
        return this.assembleHunks(ops, oldLines, newLines, this.defaultContextLines);
    }

    /**
     * Analyzes directed dependency graph edges: [from, to] (where `from` depends on `to`).
     * Implements Tarjan's SCC algorithm and topological sort.
     */
    public analyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
        const adjacency = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        const allNodes = new Set<string>();

        for (const [from, to] of edges) {
            allNodes.add(from);
            allNodes.add(to);
            addDirectedEdge(from, to, adjacency, inDegree);
        }

        const { sccs, cycles } = computeSccsAndCycles(allNodes, adjacency);
        const topologicalOrder = computeTopologicalOrder(allNodes, adjacency, inDegree);

        return {
            cycles,
            topologicalOrder,
            stronglyConnectedComponents: sccs,
            isAcyclic: cycles.length === 0,
        };
    }

    /**
     * Fast multi-pattern textual scanner locating occurrences with 1-based line and column.
     */
    public fastPatternMatch(sourceText: string, patterns: string[]): NativePatternMatch[] {
        const results: NativePatternMatch[] = [];
        if (!sourceText || patterns.length === 0) {
            return results;
        }

        const lines = sourceText.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const lineNum = lineIndex + 1;
            for (const pattern of patterns) {
                findPatternMatchesInLine(line, pattern, lineNum, results);
            }
        }

        return results;
    }

    /**
     * Pure JS fallback implementation of the native operator library.
     */
    public maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource {
        const res = maskSourceTextJs(content, {
            lineComment: config.lineComment,
            blockComment:
                config.blockCommentOpen && config.blockCommentClose
                    ? { open: config.blockCommentOpen, close: config.blockCommentClose }
                    : undefined,
            quoteChars: config.quoteChars,
            multilineTemplates: config.multilineTemplates,
            regexLiterals: config.regexLiterals,
        });
        const stats = countLineStats(content);
        return {
            raw: res.raw,
            masked: res.masked,
            lines: stats.lines,
            nonBlankLines: stats.nonBlankLines,
        };
    }

    /**
     * Counts duplicated non-blank lines using 32-bit line hashes.
     */
    public countDuplicateLines(content: string): number {
        return countDuplicateLinesShim(content);
    }

    /**
     * Detects repeated code blocks within a single file.
     */
    public detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[] {
        return detectCloneBlocksShim(content, minCloneLines);
    }

    /**
     * Computes a MinHash signature vector for a source file.
     */
    public computeMinHash(content: string, numPermutations = 64): number[] {
        return computeMinHashShim(content, numPermutations);
    }

    /**
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    public findClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
        return findClonePairsShim(signatures, threshold);
    }

    /**
     * Computes the immediate dominator tree and dominance frontiers for a graph.
     */
    public computeDominatorTree(
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ): NativeDominatorTreeResult {
        return computeDominatorTreeShim(entry, nodes, edges);
    }

    /**
     * Solves forward or backward dataflow equations to a fixed point.
     */
    public solveDataflow(params: NativeDataflowParams): NativeDataflowResult {
        return solveDataflowShim(params);
    }

    /**
     * Finds preceding equal context line count before a cluster start.
     */
    private findPrecedingContextCount(
        ops: DiffOp[],
        clusterStart: number,
        contextLines: number,
    ): number {
        let count = 0;
        let ctxIdx = clusterStart - 1;
        while (ctxIdx >= 0 && ops[ctxIdx].type === DIFF_OP_EQUAL && count < contextLines) {
            count++;
            ctxIdx--;
        }
        return count;
    }

    /**
     * Determines cluster end index, bridging adjacent change blocks separated by few equal lines.
     */
    private findClusterEnd(ops: DiffOp[], clusterStart: number, contextLines: number): number {
        let clusterEnd = clusterStart;
        while (clusterEnd < ops.length) {
            if (ops[clusterEnd].type !== DIFF_OP_EQUAL) {
                clusterEnd++;
                continue;
            }
            let equalLookahead = clusterEnd;
            while (equalLookahead < ops.length && ops[equalLookahead].type === DIFF_OP_EQUAL) {
                equalLookahead++;
            }
            const canBridge =
                equalLookahead < ops.length && equalLookahead - clusterEnd <= contextLines * 2;
            if (canBridge) {
                clusterEnd = equalLookahead;
            } else {
                break;
            }
        }
        return clusterEnd;
    }

    /**
     * Finds trailing equal context line count after a cluster end.
     */
    private findTrailingContextCount(
        ops: DiffOp[],
        clusterEnd: number,
        contextLines: number,
    ): number {
        let count = 0;
        let trailIdx = clusterEnd;
        while (
            trailIdx < ops.length &&
            ops[trailIdx].type === DIFF_OP_EQUAL &&
            count < contextLines
        ) {
            count++;
            trailIdx++;
        }
        return count;
    }

    /**
     * Builds a single NativeDiffHunk from DiffOp operations within the specified range.
     */
    private buildHunk(
        ops: DiffOp[],
        startIdx: number,
        endIdx: number,
        oldLines: string[],
        newLines: string[],
    ): NativeDiffHunk {
        const state: HunkBuilderState = {
            oldStart: 0,
            newStart: 0,
            oldLinesCount: 0,
            newLinesCount: 0,
            lines: [],
            firstOldAssigned: false,
            firstNewAssigned: false,
        };

        for (let opIdx = startIdx; opIdx < endIdx; opIdx++) {
            const op = ops[opIdx];
            if (op.type === DIFF_OP_EQUAL) {
                applyDiffOpEqual(op, oldLines, state);
                continue;
            }
            if (op.type === DIFF_OP_DELETE) {
                applyDiffOpDelete(op, oldLines, state);
                continue;
            }
            if (op.type === DIFF_OP_INSERT) {
                applyDiffOpInsert(op, newLines, state);
            }
        }

        return {
            oldStart: state.oldStart || 1,
            oldLines: state.oldLinesCount,
            newStart: state.newStart || 1,
            newLines: state.newLinesCount,
            lines: state.lines,
        };
    }

    /**
     * Clusters DiffOp operations into contiguous unified diff hunks with context lines.
     */
    private assembleHunks(
        ops: DiffOp[],
        oldLines: string[],
        newLines: string[],
        contextLines: number,
    ): NativeDiffHunk[] {
        const hunks: NativeDiffHunk[] = [];
        let i = 0;

        while (i < ops.length) {
            // Skip leading unchanged lines
            if (ops[i].type === DIFF_OP_EQUAL) {
                i++;
                continue;
            }

            const clusterStart = i;
            const contextBefore = this.findPrecedingContextCount(ops, clusterStart, contextLines);
            const hunkOpsStart = clusterStart - contextBefore;

            const clusterEnd = this.findClusterEnd(ops, clusterStart, contextLines);
            const contextAfter = this.findTrailingContextCount(ops, clusterEnd, contextLines);
            const hunkOpsEnd = clusterEnd + contextAfter;

            hunks.push(this.buildHunk(ops, hunkOpsStart, hunkOpsEnd, oldLines, newLines));
            i = hunkOpsEnd;
        }

        return hunks;
    }
}

/**
 * Attempts to load native binary bindings if available.
 */
function probeNativeBinding(): INativeCore | null {
    try {
        // Probe relative prebuilt N-API binary location
        const binding = require('../../../crates/auto-refactor-core/index.node');
        if (binding && typeof binding.computeHistogramDiff === 'function') {
            const jsShim = new PureJsNativeShim();
            return {
                computeHistogramDiff: binding.computeHistogramDiff,
                analyzeDependencyGraph: (edges: [string, string][]) => {
                    if (edges.length < 1500) {
                        return jsShim.analyzeDependencyGraph(edges);
                    }
                    return binding.analyzeDependencyGraph(edges);
                },
                fastPatternMatch: binding.fastPatternMatch,
                // The N-API binding takes `(content, config)`. Passing `binding.maskSourceCode`
                // straight through dropped `config`, so every native masking call threw
                // "Cannot convert undefined or null to object" at runtime.
                maskSourceCode: (content: string, config: NativeMaskConfig) =>
                    binding.maskSourceCode(content, config),
                countDuplicateLines: binding.countDuplicateLines,
                detectCloneBlocks: binding.detectCloneBlocks,
                computeMinHash: binding.computeMinHash || binding.computeMinhash,
                findClonePairs: binding.findClonePairs,
                computeDominatorTree: binding.computeDominatorTree,
                solveDataflow: (params: NativeDataflowParams) => {
                    return binding.solveDataflow(
                        params.entry,
                        params.nodes ?? [],
                        params.edges,
                        params.forward ?? true,
                        params.gen ?? {},
                        params.kill ?? {},
                    );
                },
                getStatus: () => ({
                    isNativeAvailable: true,
                    activeEngine: 'rust-native',
                    version: binding.version || binding.VERSION || '0.4.0-native',
                    capabilities: [
                        'histogram-diff',
                        'tarjan-scc',
                        'topological-sort',
                        'fast-pattern-match',
                        'simd-histogram-diff',
                        'parallel-tarjan-scc',
                        'zero-copy-buffer',
                        'simd-source-mask',
                        'clone-detection',
                        'minhash-lsh',
                        'dominator-tree',
                        'dataflow-solver',
                    ],
                }),
            };
        }
    } catch (_err) {
        // Expected: native binary missing or unsupported platform; fallback to pure JS shim
        void _err;
    }
    return null;
}

/**
 * Global singleton native acceleration instance.
 * Automatically delegates to compiled Rust native core when present, or pure JS shim fallback.
 */
export const nativeCore: INativeCore = probeNativeBinding() || new PureJsNativeShim();

/**
 * Retrieves the status and capabilities of the active acceleration engine.
 *
 * @returns Active native core engine status descriptor.
 */
export function getNativeCoreStatus(): NativeCoreStatus {
    return nativeCore.getStatus();
}

/**
 * Convenience helper to compute histogram diffs.
 *
 * @param oldContent - Original text content.
 * @param newContent - Updated text content.
 * @returns Array of computed NativeDiffHunk elements.
 */
export function nativeHistogramDiff(oldContent: string, newContent: string): NativeDiffHunk[] {
    return nativeCore.computeHistogramDiff(oldContent, newContent);
}

/**
 * Convenience helper to analyze dependency graph topology and detect cycles.
 *
 * @param edges - Array of directed [from, to] dependency edges.
 * @returns Graph analysis result with cycles, topological order, and SCCs.
 */
export function nativeAnalyzeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
    return nativeCore.analyzeDependencyGraph(edges);
}

/**
 * Convenience helper to perform fast pattern matching.
 *
 * @param sourceText - Target text to search.
 * @param patterns - Pattern strings to match against source.
 * @returns Array of pattern matches with offsets and line numbers.
 */
export function nativeFastPatternMatch(
    sourceText: string,
    patterns: string[],
): NativePatternMatch[] {
    return nativeCore.fastPatternMatch(sourceText, patterns);
}

/**
 * Convenience helper to mask source code comments and literals.
 *
 * @param content - Target source code content.
 * @param config - Lexical masking configuration.
 * @returns Masked source text structure with line metrics.
 */
export function nativeMaskSourceCode(
    content: string,
    config: NativeMaskConfig,
): NativeMaskedSource {
    return nativeCore.maskSourceCode(content, config);
}

/**
 * Convenience helper to count duplicated non-blank lines.
 *
 * @param content - Target source code content.
 * @returns Number of duplicated occurrences beyond the first.
 */
export function nativeCountDuplicateLines(content: string): number {
    return nativeCore.countDuplicateLines(content);
}

/**
 * Convenience helper to detect code clone blocks within a file.
 *
 * @param content - Target source code content.
 * @param minCloneLines - Minimum consecutive lines to constitute a clone.
 * @returns Detected clone block descriptors.
 */
export function nativeDetectCloneBlocks(
    content: string,
    minCloneLines: number,
): NativeCloneBlock[] {
    return nativeCore.detectCloneBlocks(content, minCloneLines);
}

/**
 * Convenience helper to compute MinHash signature of a file.
 *
 * @param content - Target source code content.
 * @param numPermutations - Number of permutations (default 64).
 * @returns MinHash signature vector.
 */
export function nativeComputeMinHash(content: string, numPermutations?: number): number[] {
    return nativeCore.computeMinHash(content, numPermutations);
}

/**
 * Convenience helper to discover similar file pairs using LSH.
 *
 * @param signatures - Array of file MinHash signatures.
 * @param threshold - Similarity threshold between 0.0 and 1.0.
 * @returns Array of detected similar file pairs with similarity scores.
 */
export function nativeFindClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
    return nativeCore.findClonePairs(signatures, threshold);
}

/**
 * Convenience helper to compute immediate dominators and dominance frontiers.
 *
 * @param entry - Entry node identifier.
 * @param nodes - Node identifiers list.
 * @param edges - Directed edges list.
 * @returns Computed dominator tree result.
 */
export function nativeComputeDominatorTree(
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): NativeDominatorTreeResult {
    return nativeCore.computeDominatorTree(entry, nodes, edges);
}

/**
 * Convenience helper to solve forward or backward dataflow equations to a fixed point.
 *
 * @param params - Dataflow configuration parameters.
 * @returns In and Out sets at fixed-point convergence.
 */
export function nativeSolveDataflow(params: NativeDataflowParams): NativeDataflowResult {
    return nativeCore.solveDataflow(params);
}
