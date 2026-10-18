/**
 * Module: Core Engine - Native Clone & Duplication Shim
 * File Path: src/core/native/native-clone-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of duplicate line counting,
 *     intra-file clone block detection, MinHash signatures, and LSH clone pair discovery.
 * Dependencies & Triggers: Consumes ./native-types; delegated by ./native-bridge.
 * Responsibilities:
 *     1. Count non-blank duplicate lines using 32-bit line hashing;
 *     2. Detect repeated multi-line code blocks using rolling polynomial hashes;
 *     3. Compute MinHash signature vectors using 64 independent hash permutations;
 *     4. Discover cross-file clone pairs using Locality Sensitive Hashing (LSH) bands.
 * Exit Semantics & Design Rationale: Dependency-free, fully deterministic pure JS shim.
 */

import type {
    NativeBumpyRoadResult,
    NativeCloneBlock,
    NativeClonePair,
    NativeTemporalCouplingPair,
} from './native-types';
import { bitParallelMyers64Distance } from '../ast/swar';
import {
    computeSimHash64,
    calculateSimHashHammingSimilarity,
    extractTokenTrigrams,
    calculateTrigramCosineSimilarity,
} from '../intelligence/semantic-vector';

/**
 * 64 prime coefficient pairs (a, b) for MinHash universal hashing: h(x) = (a * x + b) >>> 0.
 */
export const HASH_COEFFS: Array<[number, number]> = [
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
 * Computes line start offsets and 32-bit line content hashes for a document.
 */
function computeLineStartsAndHashes(content: string): { starts: number[]; hashes: number[] } {
    const starts: number[] = [0];
    const hashes: number[] = [];
    let currentHash = 5381;

    for (let i = 0; i < content.length; i += 1) {
        const char = content.charCodeAt(i);
        if (char === 10) {
            hashes.push(currentHash | 0);
            starts.push(i + 1);
            currentHash = 5381;
        } else if (char !== 13) {
            currentHash = (Math.imul(currentHash, 33) ^ char) | 0;
        }
    }
    hashes.push(currentHash | 0);
    return { starts, hashes };
}

/**
 * Counts duplicated non-blank lines using 32-bit line hashes.
 * @param content Source code string to scan.
 * @returns Count of redundant lines beyond the first occurrence.
 */
export function countDuplicateLinesShim(content: string): number {
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
 * Filters source code into meaningful non-comment lines and FNV-1a hashes.
 */
function filterMeaningfulLines(lines: string[]): { hashes: number[]; indices: number[] } {
    const hashes: number[] = [];
    const indices: number[] = [];
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
            hashes.push(h | 0);
            indices.push(i);
        }
    }
    return { hashes, indices };
}

/**
 * Detects repeated code blocks within a single file.
 * @param content Source code string.
 * @param minCloneLines Minimum consecutive lines required to classify as a clone.
 * @returns Array of detected clone blocks.
 */
export function detectCloneBlocksShim(content: string, minCloneLines: number): NativeCloneBlock[] {
    const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    const { hashes: meaningfulHashes, indices: meaningfulLineIndices } =
        filterMeaningfulLines(lines);

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
        }
        if (prevIdx === undefined) {
            blockMap.set(h, i);
        }
    }
    return clones;
}

/**
 * Computes 3-shingles from meaningful line hashes.
 */
function computeShingles(meaningfulHashes: number[]): number[] {
    const shingles: number[] = [];
    if (meaningfulHashes.length >= 3) {
        for (let i = 0; i <= meaningfulHashes.length - 3; i++) {
            const s =
                (Math.imul(meaningfulHashes[i], 961) +
                    Math.imul(meaningfulHashes[i + 1], 31) +
                    meaningfulHashes[i + 2]) >>>
                0;
            shingles.push(s);
        }
    } else {
        shingles.push(...meaningfulHashes);
    }
    return shingles;
}

/**
 * Computes a MinHash signature vector for a source file.
 * @param content Source code string.
 * @param numPermutations Number of hash permutations (default 64).
 * @returns MinHash signature array.
 */
export function computeMinHashShim(content: string, numPermutations = 64): number[] {
    const numHashes = Math.min(numPermutations, HASH_COEFFS.length);
    const signature = new Array<number>(numHashes).fill(0xffffffff);

    const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    const { hashes: rawHashes } = filterMeaningfulLines(lines);
    const meaningfulHashes = rawHashes.map((h) => h >>> 0);

    if (meaningfulHashes.length === 0) {
        return signature;
    }

    const shingles = computeShingles(meaningfulHashes);
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
 * Extracts pairwise candidates from an LSH collision bucket.
 */
function addBucketCandidates(bucket: number[], candidateMap: Map<string, [number, number]>): void {
    for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
            const a = Math.min(bucket[i], bucket[j]);
            const b = Math.max(bucket[i], bucket[j]);
            candidateMap.set(`${a}:${b}`, [a, b]);
        }
    }
}

function addToBucket(buckets: Map<number, number[]>, hash: number, fileIdx: number): void {
    const list = buckets.get(hash);
    if (list) {
        list.push(fileIdx);
    } else {
        buckets.set(hash, [fileIdx]);
    }
}

function populateBandBuckets(
    signatures: number[][],
    start: number,
    end: number,
    n: number,
    buckets: Map<number, number[]>,
): void {
    buckets.clear();
    for (let f = 0; f < n; f++) {
        const sig = signatures[f];
        if (sig.length < end) continue;
        let bandHash = 0x811c9dc5;
        for (let r = start; r < end; r++) {
            bandHash ^= sig[r];
            bandHash = Math.imul(bandHash, 0x01000193);
        }
        addToBucket(buckets, bandHash >>> 0, f);
    }
}

function computeSignatureSimilarity(sigA: number[], sigB: number[]): number {
    const total = Math.min(sigA.length, sigB.length);
    if (total === 0) return 0;
    let matches = 0;
    for (let i = 0; i < total; i++) {
        if (sigA[i] === sigB[i]) matches++;
    }
    return matches / total;
}

function evaluateCloneCandidates(
    signatures: number[][],
    candidateMap: Map<string, [number, number]>,
    threshold: number,
): NativeClonePair[] {
    const pairs: NativeClonePair[] = [];
    for (const [a, b] of candidateMap.values()) {
        const similarity = computeSignatureSimilarity(signatures[a], signatures[b]);
        if (similarity >= threshold) {
            pairs.push({ fileA: a, fileB: b, similarity });
        }
    }
    pairs.sort((pairA, pairB) => pairB.similarity - pairA.similarity);
    return pairs;
}

/**
 * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
 * @param signatures Array of MinHash signature vectors.
 * @param threshold Jaccard similarity threshold [0.0, 1.0].
 * @returns List of candidate clone pairs exceeding the threshold.
 */
export function findClonePairsShim(signatures: number[][], threshold: number): NativeClonePair[] {
    const n = signatures.length;
    if (n < 2) return [];

    const numHashes = signatures[0].length;
    const numBands = 16;
    const rowsPerBand = Math.floor(numHashes / numBands);
    if (rowsPerBand === 0) return [];

    const candidateMap = new Map<string, [number, number]>();
    const buckets = new Map<number, number[]>();

    for (let band = 0; band < numBands; band++) {
        const start = band * rowsPerBand;
        const end = start + rowsPerBand;
        populateBandBuckets(signatures, start, end, n, buckets);

        for (const bucket of buckets.values()) {
            if (bucket.length >= 2) {
                addBucketCandidates(bucket, candidateMap);
            }
        }
    }

    return evaluateCloneCandidates(signatures, candidateMap, threshold);
}

/**
 * Pure JavaScript fallback for bit-parallel Myers distance.
 */
export function computeBitParallelDistanceShim(pattern: Uint32Array, text: Uint32Array): number {
    return bitParallelMyers64Distance(pattern, text);
}

/**
 * Pure JavaScript fallback for SimHash-64 generation.
 */
export function computeSimHash64Shim(tokens: readonly string[]): string {
    const hash = computeSimHash64(tokens);
    return hash.toString(16).padStart(16, '0');
}

/**
 * Pure JavaScript fallback for SimHash Hamming similarity.
 */
export function calculateSimHashHammingSimilarityShim(hashA: string, hashB: string): number {
    const parse = (s: string): bigint => {
        const trimmed = s.trim();
        if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
            return BigInt(trimmed);
        }
        return BigInt(`0x${trimmed}`);
    };
    return calculateSimHashHammingSimilarity(parse(hashA), parse(hashB));
}

/**
 * Pure JavaScript fallback for trigram cosine similarity.
 */
export function calculateTrigramCosineSimilarityShim(
    tokensA: readonly string[],
    tokensB: readonly string[],
): number {
    const vecA = extractTokenTrigrams(tokensA);
    const vecB = extractTokenTrigrams(tokensB);
    return calculateTrigramCosineSimilarity(vecA, vecB);
}

interface TemporalMiningState {
    readonly fileCommitCounts: Map<number, number>;
    readonly pairSharedCounts: Map<string, number>;
}

function recordChangeset(
    cs: number[],
    state: TemporalMiningState,
): void {
    if (!Array.isArray(cs) || cs.length === 0) {
        return;
    }
    const unique = Array.from(new Set(cs)).sort((a, b) => a - b);
    for (const id of unique) {
        state.fileCommitCounts.set(id, (state.fileCommitCounts.get(id) || 0) + 1);
    }
    const len = unique.length;
    for (let i = 0; i < len; i++) {
        const fileA = unique[i];
        for (let j = i + 1; j < len; j++) {
            const fileB = unique[j];
            const key = `${fileA}:${fileB}`;
            state.pairSharedCounts.set(key, (state.pairSharedCounts.get(key) || 0) + 1);
        }
    }
}

function parseAndEvaluateCouplingPair(
    key: string,
    shared: number,
    fileCommitCounts: Map<number, number>,
    minShared: number,
    minJaccard: number,
): NativeTemporalCouplingPair | null {
    if (shared < minShared) {
        return null;
    }
    const colonIdx = key.indexOf(':');
    const fileA = Number(key.slice(0, colonIdx));
    const fileB = Number(key.slice(colonIdx + 1));
    const commitsA = fileCommitCounts.get(fileA) || 0;
    const commitsB = fileCommitCounts.get(fileB) || 0;
    const unionCount = commitsA + commitsB - shared;
    if (unionCount <= 0) {
        return null;
    }
    const jaccard = shared / unionCount;
    const roundedJaccard = +jaccard.toFixed(4);
    if (roundedJaccard < minJaccard) {
        return null;
    }
    return {
        fileA,
        fileB,
        sharedCommits: shared,
        commitsA,
        commitsB,
        jaccardSimilarity: roundedJaccard,
    };
}

function compareCouplingPairs(
    a: NativeTemporalCouplingPair,
    b: NativeTemporalCouplingPair,
): number {
    if (b.jaccardSimilarity !== a.jaccardSimilarity) {
        return b.jaccardSimilarity - a.jaccardSimilarity;
    }
    if (b.sharedCommits !== a.sharedCommits) {
        return b.sharedCommits - a.sharedCommits;
    }
    if (a.fileA !== b.fileA) {
        return a.fileA - b.fileA;
    }
    return a.fileB - b.fileB;
}

/**
 * Pure JavaScript fallback for temporal coupling co-change mining.
 */
export function computeTemporalCouplingShim(
    changesets: number[][],
    minShared: number,
    minJaccard: number,
): NativeTemporalCouplingPair[] {
    if (!Array.isArray(changesets) || changesets.length === 0) {
        return [];
    }

    const state: TemporalMiningState = {
        fileCommitCounts: new Map<number, number>(),
        pairSharedCounts: new Map<string, number>(),
    };

    for (const cs of changesets) {
        recordChangeset(cs, state);
    }

    const pairs: NativeTemporalCouplingPair[] = [];
    for (const [key, shared] of state.pairSharedCounts.entries()) {
        const pair = parseAndEvaluateCouplingPair(
            key,
            shared,
            state.fileCommitCounts,
            minShared,
            minJaccard,
        );
        if (pair !== null) {
            pairs.push(pair);
        }
    }

    pairs.sort(compareCouplingPairs);
    return pairs;
}

const SPACE_INDENT_SIZE = 4;
const MIN_BUMPY_LINE_SPAN = 20;
const MIN_BUMPY_SCORE_THRESHOLD = 12.0;

/**
 * Calculates effective indentation level of a single source line.
 */
export function measureLineIndentLevelShim(line: string): number {
    let spaces = 0;
    for (let i = 0; i < line.length; i++) {
        const ch = line.charCodeAt(i);
        if (ch === 32) {
            spaces++;
        } else if (ch === 9) {
            spaces += SPACE_INDENT_SIZE;
        } else {
            break;
        }
    }
    return Math.floor(spaces / SPACE_INDENT_SIZE);
}

/**
 * Pure JavaScript fallback for Bumpy Road structural complexity evaluation.
 */
export function evaluateBumpyRoadShim(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): NativeBumpyRoadResult {
    const totalLines = endLine - startLine + 1;
    if (!lines || totalLines < MIN_BUMPY_LINE_SPAN || startLine < 1 || endLine > lines.length) {
        return {
            bumpyScore: 0.0,
            isBumpy: false,
            meanDepth: 0.0,
            varianceDepth: 0.0,
            spikesCount: 0,
        };
    }

    let nonBlankCount = 0;
    let depthSum = 0;
    let baseIndent = -1;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = lines[lineNum - 1];
        if (!line || line.trim().length === 0) {
            continue;
        }
        const depth = measureLineIndentLevelShim(line);
        if (baseIndent === -1) {
            baseIndent = depth;
        }
        const relativeDepth = Math.max(0, depth - baseIndent);
        depthSum += relativeDepth;
        nonBlankCount++;
    }

    if (nonBlankCount < MIN_BUMPY_LINE_SPAN) {
        return {
            bumpyScore: 0.0,
            isBumpy: false,
            meanDepth: 0.0,
            varianceDepth: 0.0,
            spikesCount: 0,
        };
    }

    const meanDepth = depthSum / nonBlankCount;
    let varianceSum = 0;
    let spikesCount = 0;
    let prevDepth = 0;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
        const line = lines[lineNum - 1];
        if (!line || line.trim().length === 0) {
            continue;
        }
        const relativeDepth = Math.max(0, measureLineIndentLevelShim(line) - baseIndent);
        const diffFromMean = relativeDepth - meanDepth;
        varianceSum += diffFromMean * diffFromMean;

        const delta = Math.abs(relativeDepth - prevDepth);
        if (delta >= 2) {
            spikesCount++;
        }
        prevDepth = relativeDepth;
    }

    const varianceDepth = +(varianceSum / nonBlankCount).toFixed(2);
    const rawScore = spikesCount * varianceDepth * Math.max(1.0, meanDepth);
    const bumpyScore = +Math.min(100.0, rawScore).toFixed(1);
    const isBumpy = bumpyScore >= MIN_BUMPY_SCORE_THRESHOLD && spikesCount >= 3;

    return {
        bumpyScore,
        isBumpy,
        meanDepth: +meanDepth.toFixed(2),
        varianceDepth,
        spikesCount,
    };
}

function buildTriggerLut(group: readonly string[]): { lut: Uint8Array; hasValidTrigger: boolean } {
    const lut = new Uint8Array(256);
    let hasValidTrigger = false;
    for (let i = 0; i < group.length; i++) {
        const trigger = group[i];
        if (trigger && trigger.length > 0) {
            lut[trigger.charCodeAt(0) & 0xff] = 1;
            hasValidTrigger = true;
        }
    }
    return { lut, hasValidTrigger };
}

function hasInitialByte(content: string, len: number, lut: Uint8Array): boolean {
    for (let i = 0; i < len; i++) {
        if (lut[content.charCodeAt(i) & 0xff] === 1) {
            return true;
        }
    }
    return false;
}

function matchesAnyTrigger(content: string, group: readonly string[]): boolean {
    const validTriggers: string[] = [];
    for (let i = 0; i < group.length; i++) {
        const t = group[i];
        if (t && t.length > 0) {
            validTriggers.push(t);
        }
    }
    if (validTriggers.length === 0) {
        return false;
    }
    const pattern = validTriggers.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(pattern).test(content);
}

function probeSingleTriggerGroup(
    content: string,
    group: readonly string[],
    len: number,
): boolean {
    if (!group || group.length === 0) {
        return true;
    }

    const { lut, hasValidTrigger } = buildTriggerLut(group);
    if (!hasValidTrigger) {
        return true;
    }

    if (!hasInitialByte(content, len, lut)) {
        return false;
    }

    return matchesAnyTrigger(content, group);
}

/**
 * Pure JavaScript fallback for vectorized trigger batch probing.
 */
export function batchProbeTriggersShim(
    content: string,
    triggerGroups: readonly (readonly string[])[],
): boolean[] {
    if (!triggerGroups || triggerGroups.length === 0) {
        return [];
    }
    if (!content) {
        return triggerGroups.map((g) => !g || g.length === 0);
    }
    const len = content.length;
    return triggerGroups.map((group) => probeSingleTriggerGroup(content, group, len));
}
