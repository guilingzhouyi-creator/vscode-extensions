/**
 * Module: Core Engine — Native Dependency Graph & Topology Shim
 * File Path: src/core/native/native-graph-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of Tarjan strongly connected
 *   components (SCC), cycle detection, and Kahn topological sorting for dependency graphs.
 * Dependencies & Triggers: Consumes ./native-types; delegated by ./native-bridge.
 * Responsibilities:
 *   1. Build adjacency maps and in-degree tables from directed edge pairs;
 *   2. Execute Tarjan's SCC algorithm for cycle detection and component discovery;
 *   3. Perform deterministic topological sorting using Kahn's algorithm;
 *   4. Assemble NativeGraphAnalysis structure with complete acyclic invariants.
 * Exit Semantics & Design Rationale: CC <= 10; pure functions; deterministic output;
 *   isolated from bridge orchestration to strictly enforce ELOC <= 900 file budget.
 */

import type { NativeGraphAnalysis } from './native-types';

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
