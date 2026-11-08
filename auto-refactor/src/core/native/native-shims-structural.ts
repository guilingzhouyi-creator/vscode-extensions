/**
 * Module: Core Engine — Native Structural Operators Shim
 * File Path: src/core/native/native-shims-structural.ts
 * Architecture Role: Pure JavaScript fallback implementation of the structural operator family:
 *   dominator trees, dataflow fixed points, histogram diff hunk assembly, dependency graph
 *   topology, multi-pattern line scanning, and lexical scope shadowing.
 * Dependencies & Triggers: Consumes ./native-types, ../diff and ../algorithms primitives;
 *   delegated by ./native-bridge.
 * Responsibilities:
 *   1. Compute immediate dominators, dominance frontiers and loop headers (Cooper-Harvey-Kennedy);
 *   2. Solve forward and backward monotone dataflow equations to a fixed point;
 *   3. Calculate Git-grade histogram diff and cluster edits into unified hunks;
 *   4. Detect cycles and topologically order dependency graphs (Tarjan + Kahn);
 *   5. Match multiple sub-string patterns with deterministic line-and-column ordering;
 *   6. Detect variable shadowing across nested lexical scopes.
 * Exit Semantics & Design Rationale: Every operator here is deterministic and allocation-bounded
 *   on its inner loops, so the dual-track parity oracle can compare bytes with the Rust kernels.
 *
 * Rust crate mapping — restored because merging five kernels into one module would otherwise
 * erase the one-shim-per-crate correspondence that used to be readable from the file name:
 *   - crates/ops-graph/   -> dominator tree, dataflow solver, Tarjan SCC, topological order;
 *   - crates/ops-diff/    -> histogram diff, hunk assembly, line splitting parity helpers;
 *   - crates/ops-pattern/ -> multi-pattern line scanning and deterministic result ordering;
 *   - crates/ops-scope/   -> lexical scope chain analysis and shadowing detection.
 *
 * Volume budget: roughly 813 of a 900 executable-line ceiling, which is the closest any file in
 *   this layer sits to the limit. Treat the remaining headroom as spent: a new operator in any of
 *   the four families above must be split out into its own module rather than appended below.
 */

import type {
    NativeBindingInput,
    NativeDataflowParams,
    NativeDataflowResult,
    NativeDiffHunk,
    NativeDominatorTreeResult,
    NativeGraphAnalysis,
    NativePatternMatch,
    NativeScopeInput,
    NativeShadowingResult,
} from './native-types';
import type { LineIndex } from '../diff/edit-diff';
import type { DiffOp } from '../diff/myers-algorithm';
import { computeLineStartsAndHashes, linesOf } from '../diff/edit-diff';
import { histogramDiff } from '../diff/histogram-diff';
import {
    DIFF_OP_EQUAL,
    DIFF_OP_DELETE,
    DIFF_OP_INSERT,
    DIFF_OP_EQUAL_SPAN,
} from '../diff/myers-algorithm';

// ---------------------------------------------------------------------------
// Section: native-flow-shim
// ---------------------------------------------------------------------------

/**
 * Builds node name list and bidirectional name-to-index lookup table.
 */
function buildNodeIndex(
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): { allNodeNames: string[]; nameToId: Map<string, number> } {
    const nodeSet = new Set<string>();
    nodeSet.add(entry);
    for (const nodeName of nodes) {
        nodeSet.add(nodeName);
    }
    for (const edge of edges) {
        if (edge.length >= 2) {
            nodeSet.add(edge[0]);
            nodeSet.add(edge[1]);
        }
    }
    const allNodeNames = Array.from(nodeSet).sort();
    const nameToId = new Map<string, number>();
    allNodeNames.forEach((name, idx) => nameToId.set(name, idx));
    return { allNodeNames, nameToId };
}

/**
 * Builds successor and predecessor adjacency lists for graph nodes.
 */
function buildAdjacencyLists(
    total: number,
    edges: Array<[string, string]>,
    nameToId: Map<string, number>,
): { succs: number[][]; preds: number[][] } {
    const succs: number[][] = Array.from({ length: total }, () => []);
    const preds: number[][] = Array.from({ length: total }, () => []);

    for (const edge of edges) {
        if (edge.length >= 2) {
            const sourceId = nameToId.get(edge[0]);
            const targetId = nameToId.get(edge[1]);
            if (sourceId !== undefined && targetId !== undefined) {
                succs[sourceId].push(targetId);
                preds[targetId].push(sourceId);
            }
        }
    }
    return { succs, preds };
}

/**
 * Computes depth-first search reverse post-order (RPO) traversal.
 */
function computeReversePostOrder(
    entryId: number,
    total: number,
    succs: number[][],
): { rpo: number[]; rpoIndex: number[] } {
    const visited = new Array<boolean>(total).fill(false);
    const postOrder: number[] = [];

    const dfs = (node: number) => {
        visited[node] = true;
        for (const nxt of succs[node]) {
            if (!visited[nxt]) {
                dfs(nxt);
            }
        }
        postOrder.push(node);
    };
    dfs(entryId);

    const rpo = postOrder.reverse();
    const rpoIndex = new Array<number>(total).fill(Infinity);
    rpo.forEach((node, idx) => {
        rpoIndex[node] = idx;
    });
    return { rpo, rpoIndex };
}

/**
 * Intersects two dominator paths in the semi-lattice.
 */
function intersectIdom(blockA: number, blockB: number, doms: number[], rpoIndex: number[]): number {
    let finger1 = blockA;
    let finger2 = blockB;
    while (finger1 !== finger2) {
        while (rpoIndex[finger1] > rpoIndex[finger2]) {
            finger1 = doms[finger1];
        }
        while (rpoIndex[finger2] > rpoIndex[finger1]) {
            finger2 = doms[finger2];
        }
    }
    return finger1;
}

/**
 * Finds initial valid dominator predecessor candidate.
 */
function findFirstValidPredecessor(preds: number[], doms: number[]): number {
    for (const predId of preds) {
        if (doms[predId] !== -1) {
            return predId;
        }
    }
    return -1;
}

/**
 * Refines the candidate immediate dominator across all valid predecessors of a node.
 */
function refineNodeDominator(nodePreds: number[], doms: number[], rpoIndex: number[]): number {
    let newIdom = findFirstValidPredecessor(nodePreds, doms);
    if (newIdom === -1) {
        return -1;
    }
    for (const predId of nodePreds) {
        if (predId !== newIdom && doms[predId] !== -1) {
            newIdom = intersectIdom(predId, newIdom, doms, rpoIndex);
        }
    }
    return newIdom;
}

/**
 * Iteratively computes immediate dominators using Cooper-Harvey-Kennedy algorithm.
 */
function computeImmediateDominators(
    rpo: number[],
    preds: number[][],
    rpoIndex: number[],
    entryId: number,
    total: number,
): number[] {
    const doms = new Array<number>(total).fill(-1);
    doms[entryId] = entryId;

    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 1; i < rpo.length; i++) {
            const blockId = rpo[i];
            const newIdom = refineNodeDominator(preds[blockId], doms, rpoIndex);
            if (newIdom !== -1 && doms[blockId] !== newIdom) {
                doms[blockId] = newIdom;
                changed = true;
            }
        }
    }
    return doms;
}

/**
 * Propagates dominance frontier for a given join node up the dominator chain of a predecessor.
 */
function addFrontierFromPredecessor(
    predecessorId: number,
    blockId: number,
    doms: number[],
    frontiers: Array<Set<number>>,
): void {
    let runner = predecessorId;
    while (runner !== doms[blockId] && runner !== -1) {
        frontiers[runner].add(blockId);
        if (runner === doms[runner]) {
            break;
        }
        runner = doms[runner];
    }
}

/**
 * Computes dominance frontiers across all reachable nodes.
 */
function computeFrontiers(
    rpo: number[],
    preds: number[][],
    doms: number[],
    total: number,
    allNodeNames: string[],
): Record<string, string[]> {
    const frontiers: Array<Set<number>> = Array.from({ length: total }, () => new Set<number>());
    for (const blockId of rpo) {
        if (preds[blockId].length < 2) continue;
        for (const predId of preds[blockId]) {
            addFrontierFromPredecessor(predId, blockId, doms, frontiers);
        }
    }

    const dominanceFrontiers: Record<string, string[]> = {};
    for (const blockId of rpo) {
        dominanceFrontiers[allNodeNames[blockId]] = Array.from(frontiers[blockId])
            .map((idx) => allNodeNames[idx])
            .sort();
    }
    return dominanceFrontiers;
}

/**
 * Tests whether node u dominates node v.
 */
function checkDominates(doms: number[], dominatorId: number, targetId: number): boolean {
    let curr = targetId;
    while (curr !== -1) {
        if (curr === dominatorId) return true;
        if (curr === doms[curr]) break;
        curr = doms[curr];
    }
    return false;
}

/**
 * Discovers loop back-edges and loop headers.
 */
function findLoopStructures(
    edges: Array<[string, string]>,
    nameToId: Map<string, number>,
    doms: number[],
): { backEdges: Array<[string, string]>; loopHeaders: string[] } {
    const backEdges: Array<[string, string]> = [];
    const loopHeadersSet = new Set<string>();

    for (const edge of edges) {
        if (edge.length < 2) continue;
        const sourceId = nameToId.get(edge[0]);
        const targetId = nameToId.get(edge[1]);
        if (
            sourceId !== undefined &&
            targetId !== undefined &&
            doms[sourceId] !== -1 &&
            doms[targetId] !== -1
        ) {
            if (checkDominates(doms, targetId, sourceId)) {
                backEdges.push([edge[0], edge[1]]);
                loopHeadersSet.add(edge[1]);
            }
        }
    }
    return {
        backEdges,
        loopHeaders: Array.from(loopHeadersSet).sort(),
    };
}

/**
 * Computes immediate dominator tree, dominance frontiers, and loop structures.
 * @param entry Unique identifier of graph entry node.
 * @param nodes List of all node identifiers in the graph.
 * @param edges Directed edges represented as [from, to] pairs.
 * @returns Immediate dominators, dominance frontiers, loop headers, and back-edges.
 */
export function computeDominatorTreeShim(
    entry: string,
    nodes: string[],
    edges: Array<[string, string]>,
): NativeDominatorTreeResult {
    const { allNodeNames, nameToId } = buildNodeIndex(entry, nodes, edges);
    const entryId = nameToId.get(entry) ?? 0;
    const total = allNodeNames.length;

    const { succs, preds } = buildAdjacencyLists(total, edges, nameToId);
    const { rpo, rpoIndex } = computeReversePostOrder(entryId, total, succs);
    const doms = computeImmediateDominators(rpo, preds, rpoIndex, entryId, total);
    const dominanceFrontiers = computeFrontiers(rpo, preds, doms, total, allNodeNames);
    const { backEdges, loopHeaders } = findLoopStructures(edges, nameToId, doms);

    const reachableNodes = rpo.map((idx) => allNodeNames[idx]);
    const idom: Record<string, string> = {};
    for (const blockId of rpo) {
        if (blockId !== entryId && doms[blockId] !== -1) {
            idom[allNodeNames[blockId]] = allNodeNames[doms[blockId]];
        }
    }

    return {
        entry,
        reachableNodes,
        idom,
        dominanceFrontiers,
        loopHeaders,
        backEdges,
    };
}

/**
 * Collects unique sorted fact names and builds a fact-to-id lookup table.
 */
function buildFactIndex(
    gen: Record<string, string[]>,
    kill: Record<string, string[]>,
): { factNames: string[]; factToId: Map<string, number> } {
    const factSet = new Set<string>();
    for (const list of Object.values(gen)) {
        for (const item of list) factSet.add(item);
    }
    for (const list of Object.values(kill)) {
        for (const item of list) factSet.add(item);
    }
    const factNames = Array.from(factSet).sort();
    const factToId = new Map<string, number>();
    factNames.forEach((name, idx) => factToId.set(name, idx));
    return { factNames, factToId };
}

interface DataflowBitBuffers {
    readonly wordsPerNode: number;
    readonly genWords: Uint32Array;
    readonly killWords: Uint32Array;
    readonly inWords: Uint32Array;
    readonly outWords: Uint32Array;
}

/**
 * Solves one step of forward or backward dataflow equation over 32-bit word bitsets.
 */
function stepDataflowNodeBits(
    nodeIdx: number,
    neighbors: number[],
    forward: boolean,
    buffers: DataflowBitBuffers,
): boolean {
    const { wordsPerNode, genWords, killWords, inWords, outWords } = buffers;
    const base = nodeIdx * wordsPerNode;
    let modified = false;
    const primaryWords = forward ? inWords : outWords;
    const secondaryWords = forward ? outWords : inWords;

    for (let w = 0; w < wordsPerNode; w++) {
        let mergedWord = 0;
        for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
            mergedWord |= secondaryWords[neighbors[nIdx] * wordsPerNode + w];
        }
        if (primaryWords[base + w] !== mergedWord) {
            primaryWords[base + w] = mergedWord;
            modified = true;
        }
        const transferredWord = genWords[base + w] | (mergedWord & ~killWords[base + w]);
        if (secondaryWords[base + w] !== transferredWord) {
            secondaryWords[base + w] = transferredWord;
            modified = true;
        }
    }
    return modified;
}

/**
 * Decodes a 32-bit word bitset slice into a sorted array of fact strings.
 */
function decodeBitsetRow(
    words: Uint32Array,
    baseOffset: number,
    wordsPerNode: number,
    factNames: string[],
): string[] {
    const result: string[] = [];
    for (let w = 0; w < wordsPerNode; w++) {
        let bits = words[baseOffset + w];
        while (bits !== 0) {
            const lsb = bits & -bits;
            const bitPos = 31 - Math.clz32(lsb);
            const factId = (w << 5) + bitPos;
            if (factId < factNames.length) {
                result.push(factNames[factId]);
            }
            bits ^= lsb;
        }
    }
    return result;
}

function populateNodeGenKillBits(
    allNodeNames: string[],
    wordsPerNode: number,
    gen: Record<string, string[]>,
    kill: Record<string, string[]>,
    factToId: Map<string, number>,
    buffers: DataflowBitBuffers,
): void {
    for (let i = 0; i < allNodeNames.length; i++) {
        const name = allNodeNames[i];
        const base = i * wordsPerNode;
        for (const item of gen[name] ?? []) {
            const fid = factToId.get(item);
            if (fid !== undefined) buffers.genWords[base + (fid >>> 5)] |= 1 << (fid & 31);
        }
        for (const item of kill[name] ?? []) {
            const fid = factToId.get(item);
            if (fid !== undefined) buffers.killWords[base + (fid >>> 5)] |= 1 << (fid & 31);
        }
    }
}

/**
 * Solves forward or backward dataflow equations to a fixed point.
 * @param params Dataflow configuration containing entry, edges, direction, gen, and kill.
 * @returns Monotone fixed-point result with inSets and outSets mapped per node.
 */
export function solveDataflowShim(params: NativeDataflowParams): NativeDataflowResult {
    const { entry, nodes = [], edges, forward = true, gen = {}, kill = {} } = params;
    const { allNodeNames, nameToId } = buildNodeIndex(entry, nodes, edges);
    const total = allNodeNames.length;
    const { succs, preds } = buildAdjacencyLists(total, edges, nameToId);
    const { factNames, factToId } = buildFactIndex(gen, kill);

    const wordsPerNode = Math.max(1, Math.ceil(factNames.length / 32));
    const totalWords = total * wordsPerNode;
    const buffers: DataflowBitBuffers = {
        wordsPerNode,
        genWords: new Uint32Array(totalWords),
        killWords: new Uint32Array(totalWords),
        inWords: new Uint32Array(totalWords),
        outWords: new Uint32Array(totalWords),
    };

    populateNodeGenKillBits(allNodeNames, wordsPerNode, gen, kill, factToId, buffers);

    let iterations = 0;
    let changed = true;
    const activeNeighbors = forward ? preds : succs;

    while (changed && iterations < 500) {
        changed = false;
        iterations++;
        for (let i = 0; i < total; i++) {
            if (stepDataflowNodeBits(i, activeNeighbors[i], forward, buffers)) {
                changed = true;
            }
        }
    }

    const inMap: Record<string, string[]> = {};
    const outMap: Record<string, string[]> = {};
    for (let i = 0; i < total; i++) {
        const name = allNodeNames[i];
        const base = i * wordsPerNode;
        inMap[name] = decodeBitsetRow(buffers.inWords, base, wordsPerNode, factNames);
        outMap[name] = decodeBitsetRow(buffers.outWords, base, wordsPerNode, factNames);
    }

    return {
        inSets: inMap,
        outSets: outMap,
        iterations,
    };
}

// ---------------------------------------------------------------------------
// Section: native-diff-shim
// ---------------------------------------------------------------------------

interface HunkBuilderState {
    oldStart: number;
    newStart: number;
    oldLinesCount: number;
    newLinesCount: number;
    lines: string[];
    firstOldAssigned: boolean;
    firstNewAssigned: boolean;
}

function applyDiffOpEqual(diffOp: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = diffOp.aIdx + 1;
        state.firstOldAssigned = true;
    }
    if (!state.firstNewAssigned) {
        state.newStart = diffOp.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.oldLinesCount++;
    state.newLinesCount++;
    state.lines.push(' ' + (oldLines[diffOp.aIdx] ?? ''));
}

function applyDiffOpDelete(diffOp: DiffOp, oldLines: string[], state: HunkBuilderState): void {
    if (!state.firstOldAssigned) {
        state.oldStart = diffOp.aIdx + 1;
        state.firstOldAssigned = true;
    }
    state.oldLinesCount++;
    state.lines.push('-' + (oldLines[diffOp.aIdx] ?? ''));
}

function applyDiffOpInsert(diffOp: DiffOp, newLines: string[], state: HunkBuilderState): void {
    if (!state.firstNewAssigned) {
        state.newStart = diffOp.bIdx + 1;
        state.firstNewAssigned = true;
    }
    state.newLinesCount++;
    state.lines.push('+' + (newLines[diffOp.bIdx] ?? ''));
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
export function trimTrailingLineStart(content: string, starts: number[]): number[] {
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
export function splitLinesLikeNative(content: string, starts: number[]): string[] {
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
export function trimTrailingHash(index: LineIndex, lineCount: number): Uint32Array {
    if (index.hashes.length === lineCount) {
        return index.hashes;
    }
    return index.hashes.slice(0, lineCount);
}

/**
 * Finds preceding equal context line count before a cluster start.
 */
function findPrecedingContextCount(
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
function findClusterEnd(ops: DiffOp[], clusterStart: number, contextLines: number): number {
    let clusterEnd = clusterStart;
    while (clusterEnd < ops.length) {
        if (ops[clusterEnd].type === DIFF_OP_DELETE || ops[clusterEnd].type === DIFF_OP_INSERT) {
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
function findTrailingContextCount(ops: DiffOp[], clusterEnd: number, contextLines: number): number {
    let count = 0;
    let trailIdx = clusterEnd;
    while (trailIdx < ops.length && ops[trailIdx].type === DIFF_OP_EQUAL && count < contextLines) {
        count++;
        trailIdx++;
    }
    return count;
}

/**
 * Builds a single NativeDiffHunk from DiffOp operations within the specified range.
 */
function buildHunk(context: {
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
        const diffOp = context.ops[opIdx];
        if (diffOp.type === DIFF_OP_EQUAL) {
            applyDiffOpEqual(diffOp, context.oldLines, state);
            continue;
        }
        if (diffOp.type === DIFF_OP_DELETE) {
            applyDiffOpDelete(diffOp, context.oldLines, state);
            continue;
        }
        if (diffOp.type === DIFF_OP_INSERT) {
            applyDiffOpInsert(diffOp, context.newLines, state);
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
 *
 * @param ops - Sequence of diff operations.
 * @param oldLines - Lines from original source text.
 * @param newLines - Lines from modified source text.
 * @param contextLines - Number of surrounding context lines.
 * @returns Array of assembled native diff hunks.
 */
export function assembleHunksShim(
    ops: DiffOp[],
    oldLines: string[],
    newLines: string[],
    contextLines: number,
): NativeDiffHunk[] {
    const hunks: NativeDiffHunk[] = [];
    let opIndex = 0;

    while (opIndex < ops.length) {
        if (ops[opIndex].type === DIFF_OP_EQUAL || ops[opIndex].type === DIFF_OP_EQUAL_SPAN) {
            opIndex++;
            continue;
        }

        const clusterStart = opIndex;
        const contextBefore = findPrecedingContextCount(ops, clusterStart, contextLines);
        const hunkOpsStart = clusterStart - contextBefore;

        const clusterEnd = findClusterEnd(ops, clusterStart, contextLines);
        const contextAfter = findTrailingContextCount(ops, clusterEnd, contextLines);
        const hunkOpsEnd = clusterEnd + contextAfter;

        hunks.push(
            buildHunk({
                ops,
                startIdx: hunkOpsStart,
                endIdx: hunkOpsEnd,
                oldLines,
                newLines,
            }),
        );

        opIndex = clusterEnd;
    }

    return hunks;
}

/**
 * Computes line-level histogram diff hunks between oldContent and newContent in pure JS.
 *
 * @param oldContent - Original text content.
 * @param newContent - Modified text content.
 * @param defaultContextLines - Surrounding unchanged lines preserved per hunk.
 * @returns Array of calculated native diff hunks.
 */
export function computeHistogramDiffShim(
    oldContent: string,
    newContent: string,
    defaultContextLines = 3,
): NativeDiffHunk[] {
    if (oldContent === newContent) {
        return [];
    }

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
    return assembleHunksShim(ops, oldLines, newLines, defaultContextLines);
}

// ---------------------------------------------------------------------------
// Section: native-graph-shim
// ---------------------------------------------------------------------------

const EMPTY_NEIGHBOR_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

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
    while (state.stack.length > 0) {
        const popped = state.stack.pop()!;
        state.onStack.delete(popped);
        scc.push(popped);
        if (popped === node) {
            break;
        }
    }

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
    queue.sort((firstNode, secondNode) => secondNode.localeCompare(firstNode));

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
                queue.sort((firstNode, secondNode) => secondNode.localeCompare(firstNode));
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

/**
 * Pure JavaScript fallback implementation of analyzeDependencyGraph.
 * Implements Tarjan's SCC algorithm and Kahn topological sort.
 *
 * @param edges - Directed [from, to] dependency edges.
 * @returns Complete NativeGraphAnalysis descriptor.
 */
export function analyzeDependencyGraphShim(edges: [string, string][]): NativeGraphAnalysis {
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

// ---------------------------------------------------------------------------
// Section: native-pattern-shim
// ---------------------------------------------------------------------------

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

/**
 * Fast multi-pattern textual scanner locating occurrences with 1-based line and column.
 *
 * @param sourceText - Target source code to search.
 * @param patterns - Pattern strings to locate.
 * @returns Sorted array of NativePatternMatch occurrences.
 */
export function fastPatternMatchShim(sourceText: string, patterns: string[]): NativePatternMatch[] {
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
        results.sort(
            (firstMatch, secondMatch) =>
                firstMatch.line - secondMatch.line || firstMatch.column - secondMatch.column,
        );
    }

    return results;
}

function containsNonEmptyPattern(sourceText: string, pattern: string): boolean {
    if (pattern.length === 0) return false;
    return sourceText.indexOf(pattern) !== -1;
}

/**
 * Reports whether any pattern occurs, without building a single match record.
 *
 * Mirrors the native existence check so the fallback agrees with the compiled path. The scan walks
 * the buffer with `indexOf` and stops at the first hit; it deliberately does not split into lines,
 * because the caller only needs one bit and the split would cost an array of line slices.
 *
 * @param sourceText - Target source code to search.
 * @param patterns - Pattern strings to probe.
 * @returns True when at least one pattern occurs.
 */
export function hasAnyPatternShim(sourceText: string, patterns: string[]): boolean {
    if (!sourceText || patterns.length === 0) {
        return false;
    }
    for (const pattern of patterns) {
        if (containsNonEmptyPattern(sourceText, pattern)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Section: native-scope-shim
// ---------------------------------------------------------------------------

function getOrCreateScopeMap(
    bindingsByScope: Map<number, Map<string, NativeBindingInput>>,
    scopeId: number,
): Map<string, NativeBindingInput> {
    let scopeMap = bindingsByScope.get(scopeId);
    if (!scopeMap) {
        scopeMap = new Map();
        bindingsByScope.set(scopeId, scopeMap);
    }
    return scopeMap;
}

/**
 * Pure JS fallback analyzing variable scope hierarchy and discovering symbol shadowing.
 * Uses an inverted scope-to-binding index for O(B * D) lookup without deep loop nesting.
 *
 * @param scopes - Flat list of scope descriptors with parent indices.
 * @param bindings - Flat list of symbol bindings with scope IDs and line numbers.
 * @returns Array of detected variable shadowing incidents.
 */
export function analyzeScopeShadowingShim(
    scopes: readonly NativeScopeInput[],
    bindings: readonly NativeBindingInput[],
): NativeShadowingResult[] {
    const parentMap = new Map<number, number | null>();
    for (let i = 0; i < scopes.length; i++) {
        const parentId = scopes[i].parent;
        parentMap.set(i, typeof parentId === 'number' && parentId >= 0 ? parentId : null);
    }

    const bindingsByScope = new Map<number, Map<string, NativeBindingInput>>();
    for (let i = 0; i < bindings.length; i++) {
        const bindingItem = bindings[i];
        const scopeMap = getOrCreateScopeMap(bindingsByScope, bindingItem.scopeId);
        if (!scopeMap.has(bindingItem.name)) {
            scopeMap.set(bindingItem.name, bindingItem);
        }
    }

    const defects: NativeShadowingResult[] = [];
    for (let i = 0; i < bindings.length; i++) {
        const bindingItem = bindings[i];
        let curr = parentMap.get(bindingItem.scopeId);
        while (curr !== null && curr !== undefined) {
            const outer = bindingsByScope.get(curr)?.get(bindingItem.name);
            if (outer) {
                defects.push({
                    symbol: bindingItem.name,
                    innerScopeId: bindingItem.scopeId,
                    innerLine: bindingItem.line,
                    outerScopeId: outer.scopeId,
                    outerLine: outer.line,
                    bindingKind: bindingItem.kind,
                });
            }
            curr = parentMap.get(curr);
        }
    }
    return defects;
}
