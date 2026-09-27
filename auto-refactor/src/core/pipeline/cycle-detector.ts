/**
 * Module: Core Engine — Pipeline Dependency Cycle Detector
 * File Path: src/core/pipeline/cycle-detector.ts
 * Architecture Role: Provides iterative three-color DFS cycle detection over dependency graphs
 *   with both synchronous and asynchronous (time-sliced) traversal engines.
 * Dependencies & Triggers: ModuleDependencyGraph, LoadGovernor; used by dualTrackPipeline and CLI.
 * Responsibilities:
 *   1. Iterative 3-color DFS (WHITE/GRAY/BLACK) avoiding V8 call stack overflow.
 *   2. Support time-sliced asynchronous event loop yielding via LoadGovernor.
 *   3. Canonical deduplication of detected circular dependency chains.
 * Exit Semantics & Design Rationale: Returns string[][] cycle loops; returns [] on DAG.
 */

import * as path from 'path';
import type { ModuleDependencyGraph } from '../dependency-graph';
import type { LoadGovernor } from '../profiler/loadGovernor';

/** Graph DFS node traversal states. */
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/** Default loop iterations between event loop yields in DFS cycle detection. */
export const DEFAULT_DFS_YIELD_INTERVAL = 50;

/** Frame state for explicit call-stack-free DFS. */
interface DfsFrame {
    node: string;
    neighbors: string[];
    idx: number;
}

/**
 * Normalize target files or fallback to all known forward edge keys.
 *
 * @param targetFiles - Optional roots supplied by caller.
 * @param edges - Dependency graph forward edges.
 * @returns Array of normalized root node IDs.
 */
export function normalizeDependencyRoots(
    targetFiles: string[] | undefined,
    edges: Map<string, Set<string>>,
): string[] {
    if (targetFiles && targetFiles.length > 0) {
        return targetFiles.map((f) =>
            path
                .normalize(f)
                .replace(/\\/g, '/')
                .replace(/\.(ts|tsx|js|jsx|d\.ts)$/, ''),
        );
    }
    return Array.from(edges.keys());
}

/**
 * Record a detected dependency cycle if its canonical representation is not yet recorded.
 */
function recordCycleIfNew(
    activePath: string[],
    next: string,
    seenCycleKeys: Set<string>,
    cycles: string[][],
): void {
    const cycleStartIndex = activePath.indexOf(next);
    if (cycleStartIndex === -1) {
        return;
    }
    const cyclePath = activePath.slice(cycleStartIndex).concat(next);
    const key = cyclePath.slice().sort().join('->');
    if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        cycles.push(cyclePath);
    }
}

/**
 * Push an unvisited child node into the explicit DFS frame stack.
 */
function advanceDfs(
    next: string,
    edges: Map<string, Set<string>>,
    visited: Map<string, number>,
    activePath: string[],
    frameStack: DfsFrame[],
): void {
    visited.set(next, GRAY);
    activePath.push(next);
    const nextNeighbors = edges.get(next);
    frameStack.push({
        node: next,
        neighbors: nextNeighbors ? Array.from(nextNeighbors) : [],
        idx: 0,
    });
}

/**
 * Detect dependency cycles with an iterative three-color (WHITE/GRAY/BLACK) DFS over the
 * graph's forward edges. An explicit frame stack removes the V8 call-stack limit, so deeply
 * nested dependency chains cannot overflow.
 *
 * @param graph - Dependency graph to inspect; only its current forward edges are read.
 * @param targetFiles - Optional roots; paths are normalized and extension-stripped before use.
 *   When omitted or empty, every known graph node is used as a root.
 * @returns Deduplicated cycle paths, each closed by repeating its entry node; empty when acyclic.
 */
export function detectDependencyCycles(
    graph: ModuleDependencyGraph,
    targetFiles?: string[],
): string[][] {
    const edges = graph.getForwardEdges();
    const visited = new Map<string, number>();
    const cycles: string[][] = [];
    const seenCycleKeys = new Set<string>();

    const targets = normalizeDependencyRoots(targetFiles, edges);

    for (const root of targets) {
        if ((visited.get(root) ?? WHITE) !== WHITE) {
            continue;
        }

        visited.set(root, GRAY);
        const activePath: string[] = [root];
        const rootNeighbors = edges.get(root);
        const frameStack: DfsFrame[] = [
            {
                node: root,
                neighbors: rootNeighbors ? Array.from(rootNeighbors) : [],
                idx: 0,
            },
        ];

        while (frameStack.length > 0) {
            const top = frameStack[frameStack.length - 1];

            if (top.idx >= top.neighbors.length) {
                visited.set(top.node, BLACK);
                frameStack.pop();
                activePath.pop();
                continue;
            }

            const next = top.neighbors[top.idx++];
            const state = visited.get(next) ?? WHITE;

            if (state === GRAY) {
                recordCycleIfNew(activePath, next, seenCycleKeys, cycles);
                continue;
            }

            if (state === WHITE) {
                advanceDfs(next, edges, visited, activePath, frameStack);
            }
        }
    }

    return cycles;
}

/**
 * Asynchronous, time-sliced variant of {@link detectDependencyCycles}.
 * Periodically yields the event loop every `yieldInterval` frames to prevent event-loop
 * starvation on massive enterprise dependency graphs.
 *
 * @param graph - Dependency graph to inspect; only its current forward edges are read.
 * @param targetFiles - Optional roots; paths are normalized and extension-stripped before use.
 * @param governor - Optional LoadGovernor instance used for yielding; if omitted,
 *   yielding is skipped.
 * @param yieldInterval - Number of loop iterations between event loop yields (default: 50).
 * @returns Deduplicated cycle paths, each closed by repeating its entry node.
 * Concurrency: Asynchronous routine yielding the event loop; operates on local DFS state.
 */
export async function detectDependencyCyclesAsync(
    graph: ModuleDependencyGraph,
    targetFiles?: string[],
    governor?: LoadGovernor,
    yieldInterval = DEFAULT_DFS_YIELD_INTERVAL,
): Promise<string[][]> {
    const edges = graph.getForwardEdges();
    const visited = new Map<string, number>();
    const cycles: string[][] = [];
    const seenCycleKeys = new Set<string>();

    const targets = normalizeDependencyRoots(targetFiles, edges);
    let frameCount = 0;

    for (const root of targets) {
        if ((visited.get(root) ?? WHITE) !== WHITE) {
            continue;
        }

        visited.set(root, GRAY);
        const activePath: string[] = [root];
        const rootNeighbors = edges.get(root);
        const frameStack: DfsFrame[] = [
            {
                node: root,
                neighbors: rootNeighbors ? Array.from(rootNeighbors) : [],
                idx: 0,
            },
        ];

        while (frameStack.length > 0) {
            frameCount++;
            if (governor && frameCount % yieldInterval === 0) {
                await governor.yieldEventLoop();
            }

            const top = frameStack[frameStack.length - 1];

            if (top.idx >= top.neighbors.length) {
                visited.set(top.node, BLACK);
                frameStack.pop();
                activePath.pop();
                continue;
            }

            const next = top.neighbors[top.idx++];
            const state = visited.get(next) ?? WHITE;

            if (state === GRAY) {
                recordCycleIfNew(activePath, next, seenCycleKeys, cycles);
                continue;
            }

            if (state === WHITE) {
                advanceDfs(next, edges, visited, activePath, frameStack);
            }
        }
    }

    return cycles;
}
