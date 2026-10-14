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
    NativeCoreEngineType,
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
import {
    DIFF_OP_EQUAL,
    DIFF_OP_DELETE,
    DIFF_OP_INSERT,
    DIFF_OP_EQUAL_SPAN,
    type DiffOp,
} from '../diff/myers-algorithm';
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

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MINHASH_PERMUTATIONS = 64;
const LARGE_GRAPH_EDGES_THRESHOLD = 1500;
const NATIVE_BINDING_PATH = '../../../crates/auto-refactor-core/index.node';
const ENGINE_PURE_JS: NativeCoreEngineType = 'pure-js-shim';
const ENGINE_RUST_NATIVE: NativeCoreEngineType = 'rust-native';
const VERSION_SHIM = '0.4.0-shim';
const VERSION_NATIVE_FALLBACK = '0.4.0-native';

const CAPABILITY_HISTOGRAM_DIFF = 'histogram-diff';
const CAPABILITY_TARJAN_SCC = 'tarjan-scc';
const CAPABILITY_TOPOLOGICAL_SORT = 'topological-sort';
const CAPABILITY_FAST_PATTERN_MATCH = 'fast-pattern-match';
const CAPABILITY_SIMD_SOURCE_MASK = 'simd-source-mask';
const CAPABILITY_CLONE_DETECTION = 'clone-detection';
const CAPABILITY_MINHASH_LSH = 'minhash-lsh';
const CAPABILITY_DOMINATOR_TREE = 'dominator-tree';
const CAPABILITY_DATAFLOW_SOLVER = 'dataflow-solver';

const CAPABILITY_SIMD_HISTOGRAM_DIFF = 'simd-histogram-diff';
const CAPABILITY_PARALLEL_TARJAN_SCC = 'parallel-tarjan-scc';
const CAPABILITY_ZERO_COPY_BUFFER = 'zero-copy-buffer';

const SHIM_CAPABILITIES: readonly string[] = Object.freeze([
    CAPABILITY_HISTOGRAM_DIFF,
    CAPABILITY_TARJAN_SCC,
    CAPABILITY_TOPOLOGICAL_SORT,
    CAPABILITY_FAST_PATTERN_MATCH,
    CAPABILITY_SIMD_SOURCE_MASK,
    CAPABILITY_CLONE_DETECTION,
    CAPABILITY_MINHASH_LSH,
    CAPABILITY_DOMINATOR_TREE,
    CAPABILITY_DATAFLOW_SOLVER,
]);

const NATIVE_CORE_CAPABILITIES: readonly string[] = Object.freeze([
    ...SHIM_CAPABILITIES,
    CAPABILITY_SIMD_HISTOGRAM_DIFF,
    CAPABILITY_PARALLEL_TARJAN_SCC,
    CAPABILITY_ZERO_COPY_BUFFER,
]);

const EMPTY_NEIGHBOR_SET: ReadonlySet<string> = Object.freeze(new Set<string>());
const MICRO_SOURCE_MASK_THRESHOLD = 256;

interface TarjanState {
    indexCounter: number;
    indices: Map<string, number>;
    lowlinks: Map<string, number>;
    onStack: Set<string>;
    stack: string[];
    sccs: string[][];
    cycles: string[][];
    nodeToNeighborsMap: Map<string, Set<string>>;
}

function addDirectedEdge(
    sourceNode: string,
    targetNode: string,
    nodeToNeighborsMap: Map<string, Set<string>>,
    nodeToInDegreeMap: Map<string, number>,
): void {
    let neighbors = nodeToNeighborsMap.get(sourceNode);
    if (!neighbors) {
        neighbors = new Set();
        nodeToNeighborsMap.set(sourceNode, neighbors);
    }
    if (!neighbors.has(targetNode)) {
        neighbors.add(targetNode);
        nodeToInDegreeMap.set(targetNode, (nodeToInDegreeMap.get(targetNode) || 0) + 1);
    }
    if (!nodeToInDegreeMap.has(sourceNode)) {
        nodeToInDegreeMap.set(sourceNode, 0);
    }
}

function traverseStrongConnect(node: string, state: TarjanState): void {
    state.indices.set(node, state.indexCounter);
    state.lowlinks.set(node, state.indexCounter);
    state.indexCounter++;
    state.stack.push(node);
    state.onStack.add(node);

    const neighbors = state.nodeToNeighborsMap.get(node) || EMPTY_NEIGHBOR_SET;
    for (const neighbor of neighbors) {
        if (!state.indices.has(neighbor)) {
            traverseStrongConnect(neighbor, state);
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
        extractConnectedComponent(node, state);
    }
}

function extractConnectedComponent(node: string, state: TarjanState): void {
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
    if (scc.length === 1 && state.nodeToNeighborsMap.get(node)?.has(node)) {
        state.cycles.push([node, node]);
    }
}

function computeTarjanCycles(
    allNodes: Set<string>,
    nodeToNeighborsMap: Map<string, Set<string>>,
): { sccs: string[][]; cycles: string[][] } {
    const state: TarjanState = {
        indexCounter: 0,
        indices: new Map(),
        lowlinks: new Map(),
        onStack: new Set(),
        stack: [],
        sccs: [],
        cycles: [],
        nodeToNeighborsMap,
    };
    for (const node of allNodes) {
        if (!state.indices.has(node)) {
            traverseStrongConnect(node, state);
        }
    }
    return { sccs: state.sccs, cycles: state.cycles };
}

function computeTopologicalOrder(
    allNodes: Set<string>,
    nodeToNeighborsMap: Map<string, Set<string>>,
    nodeToInDegreeMap: Map<string, number>,
): string[] {
    const nodeToInDegreeCopyMap = new Map<string, number>();
    for (const node of allNodes) {
        nodeToInDegreeCopyMap.set(node, nodeToInDegreeMap.get(node) || 0);
    }

    const queue: string[] = [];
    for (const node of allNodes) {
        if (nodeToInDegreeCopyMap.get(node) === 0) {
            queue.push(node);
        }
    }
    queue.sort((a, b) => b.localeCompare(a));

    const topologicalOrder: string[] = [];
    const orderedSet = new Set<string>();
    while (queue.length > 0) {
        const current = queue.pop()!;
        topologicalOrder.push(current);
        orderedSet.add(current);

        const neighbors = nodeToNeighborsMap.get(current) || EMPTY_NEIGHBOR_SET;
        for (const next of neighbors) {
            const remainingIn = nodeToInDegreeCopyMap.get(next)! - 1;
            nodeToInDegreeCopyMap.set(next, remainingIn);
            if (remainingIn === 0) {
                queue.push(next);
                queue.sort((a, b) => b.localeCompare(a));
            }
        }
    }

    for (const node of allNodes) {
        if (!orderedSet.has(node)) {
            orderedSet.add(node);
            topologicalOrder.push(node);
        }
    }
    return topologicalOrder;
}

function isPatternMatchAt(
    line: string,
    pattern: string,
    offset: number,
    patternLen: number,
): boolean {
    for (let patternIdx = 0; patternIdx < patternLen; patternIdx++) {
        if (line.charCodeAt(offset + patternIdx) !== pattern.charCodeAt(patternIdx)) {
            return false;
        }
    }
    return true;
}

function findPatternMatchesInLine(
    line: string,
    pattern: string,
    lineNum: number,
    results: NativePatternMatch[],
): void {
    const patternLen = pattern.length;
    const maxStart = line.length - patternLen;
    if (patternLen === 0 || maxStart < 0) {
        return;
    }

    const step = Math.max(1, patternLen);
    let colIdx = 0;
    while (colIdx <= maxStart) {
        if (isPatternMatchAt(line, pattern, colIdx, patternLen)) {
            results.push({
                pattern,
                line: lineNum,
                column: colIdx + 1,
                matchText: pattern,
            });
            colIdx += step;
        } else {
            colIdx++;
        }
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

    public constructor(defaultContextLines = DEFAULT_CONTEXT_LINES) {
        this.defaultContextLines = defaultContextLines;
    }

    /**
     * Inspects active shim status.
     */
    public getStatus(): NativeCoreStatus {
        return {
            isNativeAvailable: false,
            activeEngine: ENGINE_PURE_JS,
            version: VERSION_SHIM,
            capabilities: [...SHIM_CAPABILITIES],
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
        const nodeToNeighborsMap = new Map<string, Set<string>>();
        const nodeToInDegreeMap = new Map<string, number>();
        const allNodes = new Set<string>();

        for (const [sourceNode, targetNode] of edges) {
            allNodes.add(sourceNode);
            allNodes.add(targetNode);
            addDirectedEdge(sourceNode, targetNode, nodeToNeighborsMap, nodeToInDegreeMap);
        }

        const { sccs, cycles } = computeTarjanCycles(allNodes, nodeToNeighborsMap);
        const topologicalOrder = computeTopologicalOrder(
            allNodes,
            nodeToNeighborsMap,
            nodeToInDegreeMap,
        );

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

        if (patterns.length > 1) {
            results.sort((a, b) => a.line - b.line || a.column - b.column);
        }

        return results;
    }

    /**
     * Pure JS fallback implementation of the native operator library.
     */
    public maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource {
        const maskedResult = maskSourceTextJs(content, {
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
            raw: maskedResult.raw,
            masked: maskedResult.masked,
            lines: stats.lines,
            nonBlankLines: stats.nonBlankLines,
        };
    }

    /**
     * Counts duplicated non-blank lines using 32-bit line hashes.
     */
    public countDuplicateLines(content: string): number {
        return !content ? 0 : countDuplicateLinesShim(content);
    }

    /**
     * Detects repeated code blocks within a single file.
     */
    public detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[] {
        if (!content || minCloneLines <= 0) return [];
        return detectCloneBlocksShim(content, minCloneLines);
    }

    /**
     * Computes a MinHash signature vector for a source file.
     */
    public computeMinHash(
        content: string,
        numPermutations = DEFAULT_MINHASH_PERMUTATIONS,
    ): number[] {
        return !content ? [] : computeMinHashShim(content, numPermutations);
    }

    /**
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    public findClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
        if (!signatures || signatures.length === 0) return [];
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
        if ((!nodes || nodes.length === 0) && (!edges || edges.length === 0)) {
            return {
                entry,
                reachableNodes: [entry],
                idom: {},
                dominanceFrontiers: {},
                loopHeaders: [],
                backEdges: [],
            };
        }
        return computeDominatorTreeShim(entry, nodes || [], edges);
    }

    /**
     * Solves forward or backward dataflow equations to a fixed point.
     */
    public solveDataflow(params: NativeDataflowParams): NativeDataflowResult {
        if (!params || !params.entry) {
            return { inSets: {}, outSets: {}, iterations: 0 };
        }
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
            if (
                ops[clusterEnd].type === DIFF_OP_DELETE ||
                ops[clusterEnd].type === DIFF_OP_INSERT
            ) {
                clusterEnd++;
                continue;
            }
            if (ops[clusterEnd].type === DIFF_OP_EQUAL_SPAN) {
                break;
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
    private buildHunk(context: {
        readonly ops: DiffOp[];
        readonly startIdx: number;
        readonly endIdx: number;
        readonly oldLines: string[];
        readonly newLines: string[];
    }): NativeDiffHunk {
        const state: HunkBuilderState = {
            oldStart: 0,
            newStart: 0,
            oldLinesCount: 0,
            newLinesCount: 0,
            lines: [],
            firstOldAssigned: false,
            firstNewAssigned: false,
        };

        for (let opIdx = context.startIdx; opIdx < context.endIdx; opIdx++) {
            const op = context.ops[opIdx];
            if (op.type === DIFF_OP_EQUAL) {
                applyDiffOpEqual(op, context.oldLines, state);
                continue;
            }
            if (op.type === DIFF_OP_DELETE) {
                applyDiffOpDelete(op, context.oldLines, state);
                continue;
            }
            if (op.type === DIFF_OP_INSERT) {
                applyDiffOpInsert(op, context.newLines, state);
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
        let opIndex = 0;

        while (opIndex < ops.length) {
            // Skip leading unchanged lines
            if (ops[opIndex].type === DIFF_OP_EQUAL || ops[opIndex].type === DIFF_OP_EQUAL_SPAN) {
                opIndex++;
                continue;
            }

            const clusterStart = opIndex;
            const contextBefore = this.findPrecedingContextCount(ops, clusterStart, contextLines);
            const hunkOpsStart = clusterStart - contextBefore;

            const clusterEnd = this.findClusterEnd(ops, clusterStart, contextLines);
            const contextAfter = this.findTrailingContextCount(ops, clusterEnd, contextLines);
            const hunkOpsEnd = clusterEnd + contextAfter;

            hunks.push(
                this.buildHunk({
                    ops,
                    startIdx: hunkOpsStart,
                    endIdx: hunkOpsEnd,
                    oldLines,
                    newLines,
                }),
            );
            opIndex = hunkOpsEnd;
        }

        return hunks;
    }
}

interface RawNativeBinding {
    readonly computeHistogramDiff: (oldContent: string, newContent: string) => NativeDiffHunk[];
    readonly analyzeDependencyGraph: (edges: [string, string][]) => NativeGraphAnalysis;
    readonly fastPatternMatch: (sourceText: string, patterns: string[]) => NativePatternMatch[];
    readonly maskSourceCode: (content: string, config: NativeMaskConfig) => NativeMaskedSource;
    readonly countDuplicateLines: (content: string) => number;
    readonly detectCloneBlocks: (content: string, minCloneLines: number) => NativeCloneBlock[];
    readonly computeMinHash?: (content: string, numPermutations?: number) => number[];
    readonly computeMinhash?: (content: string, numPermutations?: number) => number[];
    readonly findClonePairs: (signatures: number[][], threshold: number) => NativeClonePair[];
    readonly computeDominatorTree: (
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
    ) => NativeDominatorTreeResult;
    readonly solveDataflow: (
        entry: string,
        nodes: string[],
        edges: Array<[string, string]>,
        forward: boolean,
        gen: Record<string, string[]>,
        kill: Record<string, string[]>,
    ) => NativeDataflowResult;
    readonly version?: string;
    readonly VERSION?: string;
}

function assembleNativeBindingCore(
    binding: RawNativeBinding,
    jsShim: PureJsNativeShim,
): INativeCore {
    return {
        computeHistogramDiff: binding.computeHistogramDiff,
        analyzeDependencyGraph: (edges: [string, string][]) => {
            if (edges.length < LARGE_GRAPH_EDGES_THRESHOLD) {
                return jsShim.analyzeDependencyGraph(edges);
            }
            return binding.analyzeDependencyGraph(edges);
        },
        fastPatternMatch: binding.fastPatternMatch,
        maskSourceCode: (content: string, config: NativeMaskConfig) => {
            if (content.length < MICRO_SOURCE_MASK_THRESHOLD) {
                return jsShim.maskSourceCode(content, config);
            }
            return binding.maskSourceCode(content, config);
        },
        countDuplicateLines: binding.countDuplicateLines,
        detectCloneBlocks: binding.detectCloneBlocks,
        computeMinHash:
            binding.computeMinHash ||
            binding.computeMinhash ||
            ((content, permutations) => jsShim.computeMinHash(content, permutations)),
        findClonePairs: binding.findClonePairs,
        computeDominatorTree: binding.computeDominatorTree,
        solveDataflow: (params: NativeDataflowParams) =>
            binding.solveDataflow(
                params.entry,
                params.nodes ?? [],
                params.edges,
                params.forward ?? true,
                params.gen ?? {},
                params.kill ?? {},
            ),
        getStatus: () => ({
            isNativeAvailable: true,
            activeEngine: ENGINE_RUST_NATIVE,
            version: binding.version || binding.VERSION || VERSION_NATIVE_FALLBACK,
            capabilities: [...NATIVE_CORE_CAPABILITIES],
        }),
    };
}

function loadNativeBindingModule(): RawNativeBinding | null {
    try {
        const modulePath = NATIVE_BINDING_PATH;
        const dynamicLoader = typeof require === 'function' ? require : undefined;
        if (!dynamicLoader) return null;
        const binding = dynamicLoader(modulePath) as RawNativeBinding;
        if (binding && typeof binding.computeHistogramDiff === 'function') {
            return binding;
        }
    } catch (_err) {
        void _err;
    }
    return null;
}

function probeNativeBinding(): INativeCore | null {
    const binding = loadNativeBindingModule();
    if (!binding) return null;
    const jsShim = new PureJsNativeShim();
    return assembleNativeBindingCore(binding, jsShim);
}

/**
 * Global singleton native acceleration instance.
 * Automatically delegates to compiled Rust native core when present, or pure JS shim fallback.
 */
export const nativeCore: INativeCore = probeNativeBinding() || new PureJsNativeShim();

/**
 * Retrieves the status and capabilities of the active acceleration engine with immutable defense.
 *
 * @returns Active native core engine status descriptor.
 */
export function getNativeCoreStatus(): NativeCoreStatus {
    const status = nativeCore.getStatus();
    return Object.freeze({
        isNativeAvailable: status.isNativeAvailable,
        activeEngine: status.activeEngine,
        version: status.version,
        capabilities: Object.freeze([...status.capabilities]) as unknown as string[],
    });
}

/**
 * Computes line-level histogram diffs with identical-content short-circuit optimization.
 *
 * @param oldContent - Original text content.
 * @param newContent - Updated text content.
 * @returns Array of computed NativeDiffHunk elements.
 */
export function computeNativeHistogramDiff(
    oldContent: string,
    newContent: string,
): NativeDiffHunk[] {
    return oldContent === newContent ? [] : nativeCore.computeHistogramDiff(oldContent, newContent);
}

/**
 * Analyzes dependency graph topology with empty edge defensive bypass.
 *
 * @param edges - Array of directed [from, to] dependency edges.
 * @returns Graph analysis result with cycles, topological order, and SCCs.
 */
export function analyzeNativeDependencyGraph(edges: [string, string][]): NativeGraphAnalysis {
    if (!edges || edges.length === 0) {
        return {
            cycles: [],
            topologicalOrder: [],
            stronglyConnectedComponents: [],
            isAcyclic: true,
        };
    }
    return nativeCore.analyzeDependencyGraph(edges);
}

/**
 * Performs fast pattern matching across source text.
 *
 * @param sourceText - Target text to search.
 * @param patterns - Pattern strings to match against source.
 * @returns Array of pattern matches with offsets and line numbers.
 */
export function matchNativeFastPatterns(
    sourceText: string,
    patterns: string[],
): NativePatternMatch[] {
    if (!sourceText || !patterns || patterns.length === 0) return [];
    return nativeCore.fastPatternMatch(sourceText, patterns);
}

/**
 * Masks source code comments and literals with blank text guard.
 *
 * @param content - Target source code content.
 * @param config - Lexical masking configuration.
 * @returns Masked source text structure with line metrics.
 */
export function maskNativeSourceCode(
    content: string,
    config: NativeMaskConfig,
): NativeMaskedSource {
    if (!content) {
        return { raw: [], masked: [], lines: 0, nonBlankLines: 0 };
    }
    return nativeCore.maskSourceCode(content, config);
}

/**
 * Counts duplicated non-blank lines with empty content guard.
 *
 * @param content - Target source code content.
 * @returns Number of duplicated occurrences beyond the first.
 */
export function countNativeDuplicateLines(content: string): number {
    return !content ? 0 : nativeCore.countDuplicateLines(content);
}

/**
 * Detects code clone blocks within a file with bounds checks.
 *
 * @param content - Target source code content.
 * @param minCloneLines - Minimum consecutive lines to constitute a clone.
 * @returns Detected clone block descriptors.
 */
export function detectNativeCloneBlocks(
    content: string,
    minCloneLines: number,
): NativeCloneBlock[] {
    if (!content || minCloneLines <= 0) return [];
    return nativeCore.detectCloneBlocks(content, minCloneLines);
}

/**
 * Computes MinHash signature of a file with content presence check.
 *
 * @param content - Target source code content.
 * @param numPermutations - Number of permutations.
 * @returns MinHash signature vector.
 */
export function computeNativeMinHash(content: string, numPermutations?: number): number[] {
    return !content ? [] : nativeCore.computeMinHash(content, numPermutations);
}

/**
 * Discovers similar file pairs using LSH with signature validation.
 *
 * @param signatures - Array of file MinHash signatures.
 * @param threshold - Similarity threshold between 0.0 and 1.0.
 * @returns Array of detected similar file pairs with similarity scores.
 */
export function findNativeClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
    return !signatures || signatures.length === 0
        ? []
        : nativeCore.findClonePairs(signatures, threshold);
}

/**
 * Computes immediate dominators and dominance frontiers with node list defense.
 *
 * @param entry - Entry node identifier.
 * @param nodes - Node identifiers list.
 * @param edges - Directed edges list.
 * @returns Computed dominator tree result.
 */
export function computeNativeDominatorTree(
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): NativeDominatorTreeResult {
    if (!nodes || nodes.length === 0) {
        return {
            entry,
            reachableNodes: [],
            idom: {},
            dominanceFrontiers: {},
            loopHeaders: [],
            backEdges: [],
        };
    }
    return nativeCore.computeDominatorTree(entry, nodes, edges);
}

/**
 * Solves forward or backward dataflow equations to a fixed point.
 *
 * @param params - Dataflow configuration parameters.
 * @returns In and Out sets at fixed-point convergence.
 */
export function solveNativeDataflow(params: NativeDataflowParams): NativeDataflowResult {
    if (!params || !params.entry) {
        return { inSets: {}, outSets: {}, iterations: 0 };
    }
    return nativeCore.solveDataflow(params);
}

// ─── Substantive Backwards-Compatibility Aliases ────────────────────────────

/** Backward compatibility alias for computeNativeHistogramDiff. */
export const nativeHistogramDiff = computeNativeHistogramDiff;

/** Backward compatibility alias for analyzeNativeDependencyGraph. */
export const nativeAnalyzeDependencyGraph = analyzeNativeDependencyGraph;

/** Backward compatibility alias for matchNativeFastPatterns. */
export const nativeFastPatternMatch = matchNativeFastPatterns;

/** Backward compatibility alias for maskNativeSourceCode. */
export const nativeMaskSourceCode = maskNativeSourceCode;

/** Backward compatibility alias for countNativeDuplicateLines. */
export const nativeCountDuplicateLines = countNativeDuplicateLines;

/** Backward compatibility alias for detectNativeCloneBlocks. */
export const nativeDetectCloneBlocks = detectNativeCloneBlocks;

/** Backward compatibility alias for computeNativeMinHash. */
export const nativeComputeMinHash = computeNativeMinHash;

/** Backward compatibility alias for findNativeClonePairs. */
export const nativeFindClonePairs = findNativeClonePairs;

/** Backward compatibility alias for computeNativeDominatorTree. */
export const nativeComputeDominatorTree = computeNativeDominatorTree;

/** Backward compatibility alias for solveNativeDataflow. */
export const nativeSolveDataflow = solveNativeDataflow;
