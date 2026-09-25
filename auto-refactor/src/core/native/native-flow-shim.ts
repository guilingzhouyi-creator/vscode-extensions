/**
 * Module: Core Engine - Native Dataflow & Dominator Shim
 * File Path: src/core/native/native-flow-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of graph dominator tree
 *     and dataflow fixed-point solver algorithms.
 * Dependencies & Triggers: Consumes ./native-types; delegated by ./native-bridge.
 * Responsibilities:
 *     1. Compute immediate dominator trees, dominance frontiers, and loop headers via CHK;
 *     2. Solve forward and backward monotone dataflow equations to a fixed point;
 *     3. Keep function complexities <= 10 and maintain zero nested loop depth violations.
 * Exit Semantics & Design Rationale: Pure in-memory computation with zero external dependencies.
 */

import type {
    NativeDominatorTreeResult,
    NativeDataflowParams,
    NativeDataflowResult,
} from './native-types';

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
    for (const n of nodes) {
        nodeSet.add(n);
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
            const u = nameToId.get(edge[0]);
            const v = nameToId.get(edge[1]);
            if (u !== undefined && v !== undefined) {
                succs[u].push(v);
                preds[v].push(u);
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
function intersectIdom(
    b1: number,
    b2: number,
    doms: number[],
    rpoIndex: number[],
): number {
    let finger1 = b1;
    let finger2 = b2;
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
    for (const p of preds) {
        if (doms[p] !== -1) {
            return p;
        }
    }
    return -1;
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
            const b = rpo[i];
            let newIdom = findFirstValidPredecessor(preds[b], doms);
            if (newIdom === -1) continue;

            for (const p of preds[b]) {
                if (p !== newIdom && doms[p] !== -1) {
                    newIdom = intersectIdom(p, newIdom, doms, rpoIndex);
                }
            }

            if (doms[b] !== newIdom) {
                doms[b] = newIdom;
                changed = true;
            }
        }
    }
    return doms;
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
    const df: Array<Set<number>> = Array.from({ length: total }, () => new Set<number>());
    for (const b of rpo) {
        if (preds[b].length < 2) continue;
        for (const p of preds[b]) {
            let runner = p;
            while (runner !== doms[b] && runner !== -1) {
                df[runner].add(b);
                if (runner === doms[runner]) break;
                runner = doms[runner];
            }
        }
    }

    const dominanceFrontiers: Record<string, string[]> = {};
    for (const b of rpo) {
        dominanceFrontiers[allNodeNames[b]] = Array.from(df[b])
            .map((idx) => allNodeNames[idx])
            .sort();
    }
    return dominanceFrontiers;
}

/**
 * Tests whether node u dominates node v.
 */
function checkDominates(doms: number[], u: number, v: number): boolean {
    let curr = v;
    while (curr !== -1) {
        if (curr === u) return true;
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
        const u = nameToId.get(edge[0]);
        const v = nameToId.get(edge[1]);
        if (u !== undefined && v !== undefined && doms[u] !== -1 && doms[v] !== -1) {
            if (checkDominates(doms, v, u)) {
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
    for (const b of rpo) {
        if (b !== entryId && doms[b] !== -1) {
            idom[allNodeNames[b]] = allNodeNames[doms[b]];
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
 * Helper to test whether a set has modified during fixed point iteration.
 */
function hasSetChanged(oldSet: Set<string>, newSet: Set<string>): boolean {
    if (oldSet.size !== newSet.size) return true;
    for (const item of newSet) {
        if (!oldSet.has(item)) return true;
    }
    return false;
}

/**
 * Merges sets from adjacent nodes without deep loop nesting.
 */
function mergeAdjacentSets(neighbors: number[], sets: Array<Set<string>>): Set<string> {
    const merged = new Set<string>();
    for (const n of neighbors) {
        for (const item of sets[n]) {
            merged.add(item);
        }
    }
    return merged;
}

/**
 * Applies the transfer equation: Out = Gen U (In - Kill).
 */
function applyTransfer(
    baseSet: Set<string>,
    genSet: Set<string>,
    killSet: Set<string>,
): Set<string> {
    const res = new Set<string>(genSet);
    for (const val of baseSet) {
        if (!killSet.has(val)) {
            res.add(val);
        }
    }
    return res;
}

/**
 * Solves one step of forward dataflow equation for node i.
 */
function stepForwardNode(
    i: number,
    preds: number[][],
    genSets: Array<Set<string>>,
    killSets: Array<Set<string>>,
    inSets: Array<Set<string>>,
    outSets: Array<Set<string>>,
): boolean {
    let modified = false;
    const newIn = mergeAdjacentSets(preds[i], outSets);
    if (hasSetChanged(inSets[i], newIn)) {
        inSets[i] = newIn;
        modified = true;
    }
    const newOut = applyTransfer(inSets[i], genSets[i], killSets[i]);
    if (hasSetChanged(outSets[i], newOut)) {
        outSets[i] = newOut;
        modified = true;
    }
    return modified;
}

/**
 * Solves one step of backward dataflow equation for node i.
 */
function stepBackwardNode(
    i: number,
    succs: number[][],
    genSets: Array<Set<string>>,
    killSets: Array<Set<string>>,
    inSets: Array<Set<string>>,
    outSets: Array<Set<string>>,
): boolean {
    let modified = false;
    const newOut = mergeAdjacentSets(succs[i], inSets);
    if (hasSetChanged(outSets[i], newOut)) {
        outSets[i] = newOut;
        modified = true;
    }
    const newIn = applyTransfer(outSets[i], genSets[i], killSets[i]);
    if (hasSetChanged(inSets[i], newIn)) {
        inSets[i] = newIn;
        modified = true;
    }
    return modified;
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

    const inSets: Array<Set<string>> = Array.from({ length: total }, () => new Set<string>());
    const outSets: Array<Set<string>> = Array.from({ length: total }, () => new Set<string>());
    const genSets = allNodeNames.map((name) => new Set(gen[name] ?? []));
    const killSets = allNodeNames.map((name) => new Set(kill[name] ?? []));

    let iterations = 0;
    let changed = true;

    while (changed && iterations < 500) {
        changed = false;
        iterations++;
        for (let i = 0; i < total; i++) {
            const stepMod = forward
                ? stepForwardNode(i, preds, genSets, killSets, inSets, outSets)
                : stepBackwardNode(i, succs, genSets, killSets, inSets, outSets);
            if (stepMod) {
                changed = true;
            }
        }
    }

    const inMap: Record<string, string[]> = {};
    const outMap: Record<string, string[]> = {};
    for (let i = 0; i < total; i++) {
        const name = allNodeNames[i];
        inMap[name] = Array.from(inSets[i]).sort();
        outMap[name] = Array.from(outSets[i]).sort();
    }

    return {
        inSets: inMap,
        outSets: outMap,
        iterations,
    };
}
