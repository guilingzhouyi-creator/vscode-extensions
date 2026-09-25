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
    NativeCoreStatus,
    NativeDiffHunk,
    NativeGraphAnalysis,
    NativePatternMatch,
} from './native-types';
import {
    computeLineStartsAndHashes,
    linesOf,
} from '../diff/edit-diff';
import { histogramDiff } from '../diff/histogram-diff';
import type { DiffOp } from '../diff/myers-algorithm';
import { DIFF_OP_EQUAL, DIFF_OP_DELETE, DIFF_OP_INSERT } from '../diff/myers-algorithm';


/**
 * Pure JavaScript fallback implementation of INativeCore.
 * Provides Git-grade histogram diff, Tarjan strongly connected components,
 * and deterministic topological sorting without external native dependencies.
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

        const oldIndex = computeLineStartsAndHashes(oldContent);
        const newIndex = computeLineStartsAndHashes(newContent);
        const oldLines = linesOf(oldContent, oldIndex.starts);
        const newLines = linesOf(newContent, newIndex.starts);

        const ops = histogramDiff(oldLines, newLines, oldIndex.hashes, newIndex.hashes);
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

        // 1. Tarjan SCC & Cycle Detection
        let indexCounter = 0;
        const indices = new Map<string, number>();
        const lowlinks = new Map<string, number>();
        const onStack = new Set<string>();
        const stack: string[] = [];
        const sccs: string[][] = [];
        const cycles: string[][] = [];

        const strongConnect = (node: string): void => {
            indices.set(node, indexCounter);
            lowlinks.set(node, indexCounter);
            indexCounter++;
            stack.push(node);
            onStack.add(node);

            const neighbors = adjacency.get(node) || new Set();
            for (const neighbor of neighbors) {
                if (!indices.has(neighbor)) {
                    strongConnect(neighbor);
                    lowlinks.set(
                        node,
                        Math.min(lowlinks.get(node)!, lowlinks.get(neighbor)!),
                    );
                } else if (onStack.has(neighbor)) {
                    lowlinks.set(
                        node,
                        Math.min(lowlinks.get(node)!, indices.get(neighbor)!),
                    );
                }
            }

            if (lowlinks.get(node) === indices.get(node)) {
                const scc: string[] = [];
                let popped: string;
                do {
                    popped = stack.pop()!;
                    onStack.delete(popped);
                    scc.push(popped);
                } while (popped !== node);

                sccs.push(scc);
                // An SCC is a cycle if it contains more than 1 node, or has a self-loop
                if (scc.length > 1) {
                    cycles.push([...scc].reverse());
                } else if (scc.length === 1) {
                    const single = scc[0];
                    if (adjacency.get(single)?.has(single)) {
                        cycles.push([single, single]);
                    }
                }
            }
        };

        for (const node of allNodes) {
            if (!indices.has(node)) {
                strongConnect(node);
            }
        }

        // 2. Kahn's Topological Sort (ignoring cycles for best-effort ordering)
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

        // Sort queue deterministically
        queue.sort();

        const topologicalOrder: string[] = [];
        while (queue.length > 0) {
            const current = queue.shift()!;
            topologicalOrder.push(current);

            const neighbors = adjacency.get(current) || new Set();
            for (const next of neighbors) {
                const remainingIn = inDegreeCopy.get(next)! - 1;
                inDegreeCopy.set(next, remainingIn);
                if (remainingIn === 0) {
                    queue.push(next);
                    queue.sort();
                }
            }
        }

        // Append any unvisited nodes from cycles to ensure total coverage
        for (const node of allNodes) {
            if (!topologicalOrder.includes(node)) {
                topologicalOrder.push(node);
            }
        }

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
            for (const pattern of patterns) {
                let startCol = 0;
                while (startCol < line.length) {
                    const matchIndex = line.indexOf(pattern, startCol);
                    if (matchIndex === -1) {
                        break;
                    }
                    results.push({
                        pattern,
                        line: lineIndex + 1,
                        column: matchIndex + 1,
                        matchText: pattern,
                    });
                    startCol = matchIndex + Math.max(1, pattern.length);
                }
            }
        }

        return results;
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
    private findClusterEnd(
        ops: DiffOp[],
        clusterStart: number,
        contextLines: number,
    ): number {
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
        let oldStart = 0;
        let newStart = 0;
        let oldLinesCount = 0;
        let newLinesCount = 0;
        const lines: string[] = [];

        let firstOldAssigned = false;
        let firstNewAssigned = false;

        for (let opIdx = startIdx; opIdx < endIdx; opIdx++) {
            const op = ops[opIdx];
            if (op.type === DIFF_OP_EQUAL) {
                if (!firstOldAssigned) {
                    oldStart = op.aIdx + 1;
                    firstOldAssigned = true;
                }
                if (!firstNewAssigned) {
                    newStart = op.bIdx + 1;
                    firstNewAssigned = true;
                }
                oldLinesCount++;
                newLinesCount++;
                lines.push(' ' + (oldLines[op.aIdx] ?? ''));
            } else if (op.type === DIFF_OP_DELETE) {
                if (!firstOldAssigned) {
                    oldStart = op.aIdx + 1;
                    firstOldAssigned = true;
                }
                oldLinesCount++;
                lines.push('-' + (oldLines[op.aIdx] ?? ''));
            } else if (op.type === DIFF_OP_INSERT) {
                if (!firstNewAssigned) {
                    newStart = op.bIdx + 1;
                    firstNewAssigned = true;
                }
                newLinesCount++;
                lines.push('+' + (newLines[op.bIdx] ?? ''));
            }
        }

        return {
            oldStart: oldStart || 1,
            oldLines: oldLinesCount,
            newStart: newStart || 1,
            newLines: newLinesCount,
            lines,
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
            return {
                computeHistogramDiff: binding.computeHistogramDiff,
                analyzeDependencyGraph: binding.analyzeDependencyGraph,
                fastPatternMatch: binding.fastPatternMatch,
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

