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
    NativeDiffHunk,
    NativeGraphAnalysis,
    NativeMaskConfig,
    NativeMaskedSource,
    NativePatternMatch,
} from './native-types';
import {
    computeLineStartsAndHashes,
    linesOf,
} from '../diff/edit-diff';
import { histogramDiff } from '../diff/histogram-diff';
import type { DiffOp } from '../diff/myers-algorithm';
import { DIFF_OP_EQUAL, DIFF_OP_DELETE, DIFF_OP_INSERT } from '../diff/myers-algorithm';
import { countLineStats } from '../../utils/linestats';
import { maskSourceTextJs } from '../policy/source-mask';

/**
 * 64 fixed deterministic (a, b) universal hash coefficients for MinHash.
 */
const HASH_COEFFS: ReadonlyArray<readonly [number, number]> = [
    [1103515245, 12345],
    [1664525, 1013904223],
    [22695477, 1],
    [69069, 5],
    [134775813, 1],
    [214013, 2531011],
    [16807, 0],
    [48271, 0],
    [65539, 0],
    [314159269, 271828183],
    [271828183, 314159269],
    [1234567891, 987654321],
    [987654321, 1234567891],
    [362436069, 521288629],
    [521288629, 362436069],
    [1588635695, 1111111111],
    [1111111111, 1588635695],
    [17711, 28657],
    [28657, 17711],
    [46368, 75025],
    [75025, 46368],
    [121393, 196418],
    [196418, 121393],
    [317811, 514229],
    [514229, 317811],
    [832040, 1346269],
    [1346269, 832040],
    [2178309, 3524578],
    [3524578, 2178309],
    [5702887, 9227465],
    [9227465, 5702887],
    [14930352, 24157817],
    [24157817, 14930352],
    [39088169, 63245986],
    [63245986, 39088169],
    [102334155, 165580141],
    [165580141, 102334155],
    [267914296, 433494437],
    [433494437, 267914296],
    [701408733, 1134903170],
    [1134903170, 701408733],
    [1836311903, 1969814873],
    [1969814873, 1836311903],
    [2042071191, 1374719261],
    [1374719261, 2042071191],
    [3416790453, 2748779069],
    [2748779069, 3416790453],
    [1867169421, 3928172901],
    [3928172901, 1867169421],
    [2491823901, 1928374191],
    [1928374191, 2491823901],
    [3918274191, 1029384751],
    [1029384751, 3918274191],
    [2938471921, 4019283741],
    [4019283741, 2938471921],
    [1938472911, 2039481721],
    [2039481721, 1938472911],
    [3049581921, 1928374651],
    [1928374651, 3049581921],
    [2938471021, 3928174651],
    [3928174651, 2938471021],
    [1827364519, 2938475619],
    [2938475619, 1827364519],
    [3847562911, 1928374653],
];

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
     * Pure JS fallback implementation of source masking and line statistics.
     */
    public maskSourceCode(content: string, config: NativeMaskConfig): NativeMaskedSource {
        const res = maskSourceTextJs(content, {
            lineComment: config.lineComment,
            blockComment: config.blockCommentOpen && config.blockCommentClose
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
        const { starts, hashes } = computeLineStartsAndHashes(content);
        const counts = new Map<number, number>();
        for (let i = 0; i < hashes.length; i += 1) {
            const s = starts[i];
            const e = i + 1 < starts.length ? starts[i + 1] - 1 : content.length;
            if (!content.slice(s, e).trim()) continue;
            counts.set(hashes[i], (counts.get(hashes[i]) ?? 0) + 1);
        }
        let duplicated = 0;
        for (const count of counts.values()) {
            if (count > 1) duplicated += count - 1;
        }
        return duplicated;
    }

    /**
     * Detects repeated code blocks within a single file.
     */
    public detectCloneBlocks(content: string, minCloneLines: number): NativeCloneBlock[] {
        const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
        const meaningfulHashes: number[] = [];
        const meaningfulLineIndices: number[] = [];

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (
                trimmed &&
                !trimmed.startsWith('//') &&
                !trimmed.startsWith('#') &&
                trimmed !== '{' &&
                trimmed !== '}'
            ) {
                let h = 0x811c9dc5;
                for (let c = 0; c < trimmed.length; c++) {
                    h ^= trimmed.charCodeAt(c);
                    h = Math.imul(h, 0x01000193);
                }
                meaningfulHashes.push(h | 0);
                meaningfulLineIndices.push(i);
            }
        }

        if (meaningfulHashes.length < minCloneLines * 2) {
            return [];
        }

        const blockMap = new Map<number, number>();
        const total = meaningfulHashes.length;
        const clones: NativeCloneBlock[] = [];

        for (let i = 0; i <= total - minCloneLines; i++) {
            let h = 0;
            for (let k = 0; k < minCloneLines; k++) {
                h = (Math.imul(h, 31) + meaningfulHashes[i + k]) | 0;
            }

            const prevIdx = blockMap.get(h);
            if (prevIdx !== undefined && i >= prevIdx + minCloneLines) {
                clones.push({
                    startLine: meaningfulLineIndices[i] + 1,
                    originalLine: meaningfulLineIndices[prevIdx] + 1,
                    lineSpan: minCloneLines,
                });
                break;
            } else if (prevIdx === undefined) {
                blockMap.set(h, i);
            }
        }
        return clones;
    }

    /**
     * Computes a MinHash signature vector for a source file.
     */
    public computeMinHash(content: string, numPermutations = 64): number[] {
        const numHashes = Math.min(numPermutations, HASH_COEFFS.length);
        const signature = new Array<number>(numHashes).fill(0xffffffff);

        const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
        const meaningfulHashes: number[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (
                trimmed &&
                !trimmed.startsWith('//') &&
                !trimmed.startsWith('#') &&
                trimmed !== '{' &&
                trimmed !== '}'
            ) {
                let h = 0x811c9dc5;
                for (let c = 0; c < trimmed.length; c++) {
                    h ^= trimmed.charCodeAt(c);
                    h = Math.imul(h, 0x01000193);
                }
                meaningfulHashes.push(h >>> 0);
            }
        }

        if (meaningfulHashes.length === 0) {
            return signature;
        }

        const shingles: number[] = [];
        if (meaningfulHashes.length >= 3) {
            for (let i = 0; i <= meaningfulHashes.length - 3; i++) {
                const s = (Math.imul(meaningfulHashes[i], 961) +
                    Math.imul(meaningfulHashes[i + 1], 31) +
                    meaningfulHashes[i + 2]) >>> 0;
                shingles.push(s);
            }
        } else {
            shingles.push(...meaningfulHashes);
        }

        for (const shingle of shingles) {
            for (let k = 0; k < numHashes; k++) {
                const [a, b] = HASH_COEFFS[k];
                const hashVal = (Math.imul(a, shingle) + b) >>> 0;
                if (hashVal < signature[k]) {
                    signature[k] = hashVal;
                }
            }
        }
        return signature;
    }

    /**
     * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
     */
    public findClonePairs(signatures: number[][], threshold: number): NativeClonePair[] {
        const n = signatures.length;
        if (n < 2) return [];

        const numHashes = signatures[0].length;
        const numBands = 16;
        const rowsPerBand = Math.floor(numHashes / numBands);
        if (rowsPerBand === 0) return [];

        const candidateMap = new Map<string, [number, number]>();

        for (let band = 0; band < numBands; band++) {
            const start = band * rowsPerBand;
            const end = start + rowsPerBand;
            const buckets = new Map<number, number[]>();

            for (let f = 0; f < n; f++) {
                const sig = signatures[f];
                if (sig.length < end) continue;
                let bandHash = 0x811c9dc5;
                for (let r = start; r < end; r++) {
                    bandHash ^= sig[r];
                    bandHash = Math.imul(bandHash, 0x01000193);
                }
                const bh = bandHash >>> 0;
                const bucket = buckets.get(bh) || [];
                bucket.push(f);
                buckets.set(bh, bucket);
            }

            for (const bucket of buckets.values()) {
                if (bucket.length >= 2) {
                    this.addBucketCandidates(bucket, candidateMap);
                }
            }
        }

        const pairs: NativeClonePair[] = [];
        for (const [a, b] of candidateMap.values()) {
            const sigA = signatures[a];
            const sigB = signatures[b];
            const total = Math.min(sigA.length, sigB.length);
            if (total === 0) continue;

            let matches = 0;
            for (let i = 0; i < total; i++) {
                if (sigA[i] === sigB[i]) matches++;
            }
            const similarity = matches / total;
            if (similarity >= threshold) {
                pairs.push({ fileA: a, fileB: b, similarity });
            }
        }

        pairs.sort((p1, p2) => p2.similarity - p1.similarity);
        return pairs;
    }

    /**
     * Extracts pairwise candidates from an LSH collision bucket.
     */
    private addBucketCandidates(
        bucket: number[],
        candidateMap: Map<string, [number, number]>,
    ): void {
        for (let i = 0; i < bucket.length; i++) {
            for (let j = i + 1; j < bucket.length; j++) {
                const a = Math.min(bucket[i], bucket[j]);
                const b = Math.max(bucket[i], bucket[j]);
                candidateMap.set(`${a}:${b}`, [a, b]);
            }
        }
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
                maskSourceCode: binding.maskSourceCode,
                countDuplicateLines: binding.countDuplicateLines,
                detectCloneBlocks: binding.detectCloneBlocks,
                computeMinHash: binding.computeMinHash || binding.computeMinhash,
                findClonePairs: binding.findClonePairs,
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
export function nativeFindClonePairs(
    signatures: number[][],
    threshold: number,
): NativeClonePair[] {
    return nativeCore.findClonePairs(signatures, threshold);
}



