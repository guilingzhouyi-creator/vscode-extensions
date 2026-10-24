/**
 * Module: Core Algorithms — Graph Traversal & Topological Analysis Primitives
 * File Path: src/core/algorithms/graph.ts
 * Architecture Role: Foundation operators for directed graph topology analysis,
 *   dependency ordering, iterative cycle detection, and reachable closure computation.
 * Dependencies & Triggers: Zero external runtime dependencies.
 * Responsibilities:
 *   1. Detect directed cycles via iterative three-color DFS, eliminating call-stack overflow hazards;
 *   2. Execute Kahn's algorithm for deterministic in-degree topological sorting on DAG structures;
 *   3. Compute BFS reachable transitive closures using an allocation-thin pointer queue;
 *   4. Compute dense boolean matrix transitive closure via Warshall's algorithm.
 * Exit Semantics & Design Rationale: CC <= 12, Depth <= 4; pure functions; deterministic.
 */

const COLOR_WHITE = 0;
const COLOR_GRAY = 1;
const COLOR_BLACK = 2;

interface DfsStackFrame<T> {
    readonly node: T;
    readonly nexts: T[];
    idx: number;
}

/**
 * Detects all directed cycles reachable from the given root nodes using iterative three-color DFS.
 * Stack depth is strictly bounded by the total unique node count (|V|), completely eliminating
 * call-stack overflow hazards on deep or cyclic graphs.
 *
 * @param roots - Starting or seed nodes to traverse from.
 * @param getOutgoing - Function returning directed outgoing neighbor nodes for a given node.
 * @returns Array of detected cycle paths, each formatted with the repeated closing node at the end.
 */
export function detectGraphCycles<T>(
    roots: Iterable<T>,
    getOutgoing: (node: T) => Iterable<T>,
): T[][] {
    const color = new Map<T, number>();
    const cycles: T[][] = [];
    const pathArr: T[] = [];
    const stack: DfsStackFrame<T>[] = [];

    for (const start of roots) {
        if ((color.get(start) ?? COLOR_WHITE) !== COLOR_WHITE) {
            continue;
        }

        color.set(start, COLOR_GRAY);
        pathArr.length = 0;
        pathArr.push(start);
        stack.length = 0;
        stack.push({ node: start, nexts: Array.from(getOutgoing(start)), idx: 0 });

        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.idx >= top.nexts.length) {
                color.set(top.node, COLOR_BLACK);
                stack.pop();
                pathArr.pop();
                continue;
            }

            const next = top.nexts[top.idx++];
            const nextColor = color.get(next) ?? COLOR_WHITE;

            if (nextColor === COLOR_GRAY) {
                const cycleStartIndex = pathArr.indexOf(next);
                if (cycleStartIndex >= 0) {
                    cycles.push([...pathArr.slice(cycleStartIndex), next]);
                }
            } else if (nextColor === COLOR_WHITE) {
                color.set(next, COLOR_GRAY);
                pathArr.push(next);
                stack.push({ node: next, nexts: Array.from(getOutgoing(next)), idx: 0 });
            }
        }
    }

    return cycles;
}

function buildInDegreeAndNeighbors<T>(
    nodeList: T[],
    getOutgoing: (node: T) => Iterable<T>,
): { inDegree: Map<T, number>; outgoingMap: Map<T, T[]> } {
    const inDegree = new Map<T, number>();
    const outgoingMap = new Map<T, T[]>();

    for (let i = 0; i < nodeList.length; i++) {
        const node = nodeList[i];
        inDegree.set(node, 0);
        outgoingMap.set(node, Array.from(getOutgoing(node)));
    }

    for (const neighbors of outgoingMap.values()) {
        for (let j = 0; j < neighbors.length; j++) {
            const target = neighbors[j];
            const currentDegree = inDegree.get(target);
            if (currentDegree !== undefined) {
                inDegree.set(target, currentDegree + 1);
            }
        }
    }

    return { inDegree, outgoingMap };
}

function processKahnQueue<T>(
    queue: T[],
    outgoingMap: Map<T, T[]>,
    inDegree: Map<T, number>,
): T[] {
    const order: T[] = [];
    let head = 0;

    while (head < queue.length) {
        const current = queue[head++];
        order.push(current);

        const neighbors = outgoingMap.get(current);
        if (neighbors === undefined) {
            continue;
        }

        for (let i = 0; i < neighbors.length; i++) {
            const next = neighbors[i];
            const currentDegree = inDegree.get(next);
            if (currentDegree !== undefined) {
                const nextDegree = currentDegree - 1;
                inDegree.set(next, nextDegree);
                if (nextDegree === 0) {
                    queue.push(next);
                }
            }
        }
    }

    return order;
}

/**
 * Computes topological order of a directed graph using Kahn's in-degree queue algorithm.
 *
 * @param allNodes - All unique nodes in the graph.
 * @param getOutgoing - Function returning directed outgoing neighbor nodes for a given node.
 * @returns Topologically sorted array of nodes, or null if the graph contains a cycle.
 */
export function computeTopologicalOrder<T>(
    allNodes: Iterable<T>,
    getOutgoing: (node: T) => Iterable<T>,
): T[] | null {
    const nodeList = Array.from(allNodes);
    if (nodeList.length === 0) {
        return [];
    }

    const { inDegree, outgoingMap } = buildInDegreeAndNeighbors(nodeList, getOutgoing);
    const queue: T[] = [];

    for (let i = 0; i < nodeList.length; i++) {
        const node = nodeList[i];
        if (inDegree.get(node) === 0) {
            queue.push(node);
        }
    }

    const order = processKahnQueue(queue, outgoingMap, inDegree);
    return order.length === nodeList.length ? order : null;
}

/**
 * Computes forward or reverse reachable transitive closure using an allocation-thin pointer BFS queue.
 *
 * @param seeds - Seed nodes to start traversal from.
 * @param getNeighbors - Function returning outgoing or incoming neighbor nodes.
 * @param maxDepth - Maximum traversal depth bound (default Infinity).
 * @returns Set containing all reachable nodes including seeds.
 */
export function bfsTransitiveClosure<T>(
    seeds: Iterable<T>,
    getNeighbors: (node: T) => Iterable<T>,
    maxDepth: number = Infinity,
): Set<T> {
    const visited = new Set<T>();
    const queueNodes: T[] = [];
    const queueDepths: number[] = [];

    for (const seed of seeds) {
        if (!visited.has(seed)) {
            visited.add(seed);
            queueNodes.push(seed);
            queueDepths.push(0);
        }
    }

    let head = 0;
    while (head < queueNodes.length) {
        const current = queueNodes[head];
        const currentDepth = queueDepths[head];
        head++;

        if (currentDepth >= maxDepth) {
            continue;
        }

        const neighbors = getNeighbors(current);
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queueNodes.push(neighbor);
                queueDepths.push(currentDepth + 1);
            }
        }
    }

    return visited;
}

function relaxWarshallRow(
    matrix: Uint8Array,
    iRowOffset: number,
    kRowOffset: number,
    size: number,
): void {
    for (let j = 0; j < size; j++) {
        if (matrix[iRowOffset + j] === 0 && matrix[kRowOffset + j] === 1) {
            matrix[iRowOffset + j] = 1;
        }
    }
}

/**
 * Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
 * Operates on a flat Uint8Array buffer of size * size with zero intermediate heap allocations.
 *
 * @param matrix - Row-major Uint8Array where matrix[i * size + j] === 1 indicates an edge from i to j.
 * @param size - Dimension of the square adjacency matrix.
 * @returns The modified matrix in-place with complete transitive reachability.
 */
export function computeWarshallTransitiveClosure(matrix: Uint8Array, size: number): Uint8Array {
    if (!matrix || size <= 0) return matrix;

    for (let k = 0; k < size; k++) {
        const kRowOffset = k * size;
        for (let i = 0; i < size; i++) {
            const iRowOffset = i * size;
            if (matrix[iRowOffset + k] === 1) {
                relaxWarshallRow(matrix, iRowOffset, kRowOffset, size);
            }
        }
    }

    return matrix;
}
