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
        const startPos = starts[i];
        const endPos = i + 1 < starts.length ? starts[i + 1] - 1 : content.length;
        if (!content.slice(startPos, endPos).trim()) continue;
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
            let hashVal = 0x811c9dc5;
            for (let charIdx = 0; charIdx < trimmed.length; charIdx++) {
                hashVal ^= trimmed.charCodeAt(charIdx);
                hashVal = Math.imul(hashVal, 0x01000193);
            }
            hashes.push(hashVal | 0);
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
    const lines = content
        .split('\n')
        .map((lineText) => (lineText.endsWith('\r') ? lineText.slice(0, -1) : lineText));
    const { hashes: meaningfulHashes, indices: meaningfulLineIndices } =
        filterMeaningfulLines(lines);

    if (meaningfulHashes.length < minCloneLines * 2) {
        return [];
    }

    const blockMap = new Map<number, number>();
    const total = meaningfulHashes.length;
    const clones: NativeCloneBlock[] = [];

    for (let i = 0; i <= total - minCloneLines; i++) {
        let combinedHash = 0;
        for (let k = 0; k < minCloneLines; k++) {
            combinedHash = (Math.imul(combinedHash, 31) + meaningfulHashes[i + k]) | 0;
        }

        const prevIdx = blockMap.get(combinedHash);
        if (prevIdx !== undefined && i >= prevIdx + minCloneLines) {
            clones.push({
                startLine: meaningfulLineIndices[i] + 1,
                originalLine: meaningfulLineIndices[prevIdx] + 1,
                lineSpan: minCloneLines,
            });
            break;
        }
        if (prevIdx === undefined) {
            blockMap.set(combinedHash, i);
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
            const shingleHash =
                (Math.imul(meaningfulHashes[i], 961) +
                    Math.imul(meaningfulHashes[i + 1], 31) +
                    meaningfulHashes[i + 2]) >>>
                0;
            shingles.push(shingleHash);
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

    const lines = content
        .split('\n')
        .map((lineText) => (lineText.endsWith('\r') ? lineText.slice(0, -1) : lineText));
    const { hashes: rawHashes } = filterMeaningfulLines(lines);
    const meaningfulHashes = rawHashes.map((hashItem) => hashItem >>> 0);

    if (meaningfulHashes.length === 0) {
        return signature;
    }

    const shingles = computeShingles(meaningfulHashes);
    for (const shingle of shingles) {
        for (let k = 0; k < numHashes; k++) {
            const [coeffA, coeffB] = HASH_COEFFS[k];
            const hashVal = (Math.imul(coeffA, shingle) + coeffB) >>> 0;
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
            const minIdx = Math.min(bucket[i], bucket[j]);
            const maxIdx = Math.max(bucket[i], bucket[j]);
            candidateMap.set(`${minIdx}:${maxIdx}`, [minIdx, maxIdx]);
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

interface PopulateBandBucketsParams {
    readonly signatures: number[][];
    readonly start: number;
    readonly end: number;
    readonly totalSignatures: number;
    readonly buckets: Map<number, number[]>;
}

function populateBandBuckets(params: PopulateBandBucketsParams): void {
    const { signatures, start, end, totalSignatures, buckets } = params;
    buckets.clear();
    for (let sigIdx = 0; sigIdx < totalSignatures; sigIdx++) {
        const sig = signatures[sigIdx];
        if (sig.length < end) continue;
        let bandHash = 0x811c9dc5;
        for (let rowIdx = start; rowIdx < end; rowIdx++) {
            bandHash ^= sig[rowIdx];
            bandHash = Math.imul(bandHash, 0x01000193);
        }
        addToBucket(buckets, bandHash >>> 0, sigIdx);
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
    for (const [fileIdxA, fileIdxB] of candidateMap.values()) {
        const similarity = computeSignatureSimilarity(signatures[fileIdxA], signatures[fileIdxB]);
        if (similarity >= threshold) {
            pairs.push({ fileA: fileIdxA, fileB: fileIdxB, similarity });
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
    const totalFiles = signatures.length;
    if (totalFiles < 2) return [];

    const numHashes = signatures[0].length;
    const numBands = 16;
    const rowsPerBand = Math.floor(numHashes / numBands);
    if (rowsPerBand === 0) return [];

    const candidateMap = new Map<string, [number, number]>();
    const buckets = new Map<number, number[]>();

    for (let band = 0; band < numBands; band++) {
        const start = band * rowsPerBand;
        const end = start + rowsPerBand;
        populateBandBuckets({
            signatures,
            start,
            end,
            totalSignatures: totalFiles,
            buckets,
        });

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
 *
 * @param pattern - Packed pattern word set the edit distance is measured against.
 * @param text - Packed text word set scanned for that pattern.
 * @returns Minimum number of edits transforming the pattern into the text.
 */
export function computeBitParallelDistanceShim(pattern: Uint32Array, text: Uint32Array): number {
    if (pattern.length === 0) return text.length;
    if (text.length === 0) return pattern.length;
    return bitParallelMyers64Distance(pattern, text);
}

/**
 * Pure JavaScript fallback for SimHash-64 generation.
 *
 * @param tokens - Token sequence reduced into a single fingerprint.
 * @returns Zero-padded lowercase hexadecimal SimHash, widening the numeric hash to a stable width.
 */
export function computeSimHash64Shim(tokens: readonly string[]): string {
    const hash = computeSimHash64(tokens);
    return hash.toString(16).padStart(16, '0');
}

/**
 * Pure JavaScript fallback for SimHash Hamming similarity.
 *
 * @param hashA - Hexadecimal fingerprint of the first document, with or without a `0x` prefix.
 * @param hashB - Hexadecimal fingerprint of the second document, same accepted forms.
 * @returns Similarity in the closed interval `0..1`, where 1 means identical fingerprints.
 */
export function computeSimHashSimilarityShim(hashA: string, hashB: string): number {
    const parse = (hashString: string): bigint => {
        const trimmed = hashString.trim();
        if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
            return BigInt(trimmed);
        }
        return BigInt(`0x${trimmed}`);
    };
    return calculateSimHashHammingSimilarity(parse(hashA), parse(hashB));
}

/**
 * Backward compatibility alias for computeSimHashSimilarityShim.
 */
export const calculateSimHashHammingSimilarityShim = computeSimHashSimilarityShim;

/**
 * Pure JavaScript fallback for trigram cosine similarity.
 *
 * @param tokensA - Token sequence of the first document, expanded into trigram vectors.
 * @param tokensB - Token sequence of the second document, expanded the same way.
 * @returns Cosine similarity of the two trigram vectors in `0..1`.
 */
export function calculateTrigramSimilarityShim(
    tokensA: readonly string[],
    tokensB: readonly string[],
): number {
    const vecA = extractTokenTrigrams(tokensA);
    const vecB = extractTokenTrigrams(tokensB);
    return calculateTrigramCosineSimilarity(vecA, vecB);
}

/** Backward-compatibility alias for calculateTrigramSimilarityShim. */
export const calculateTrigramCosineSimilarityShim = calculateTrigramSimilarityShim;

interface TemporalMiningState {
    readonly fileCommitCounts: Map<number, number>;
    readonly pairSharedCounts: Map<string, number>;
}

function recordChangeset(changeset: number[], state: TemporalMiningState): void {
    if (!Array.isArray(changeset) || changeset.length === 0) {
        return;
    }
    const unique = Array.from(new Set(changeset)).sort((firstId, secondId) => firstId - secondId);
    for (const fileId of unique) {
        state.fileCommitCounts.set(fileId, (state.fileCommitCounts.get(fileId) || 0) + 1);
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

interface CouplingPairEvaluationParams {
    readonly key: string;
    readonly shared: number;
    readonly fileCommitCounts: Map<number, number>;
    readonly minShared: number;
    readonly minJaccard: number;
}

function parseAndEvaluateCouplingPair(
    params: CouplingPairEvaluationParams,
): NativeTemporalCouplingPair | null {
    const { key, shared, fileCommitCounts, minShared, minJaccard } = params;
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
    firstPair: NativeTemporalCouplingPair,
    secondPair: NativeTemporalCouplingPair,
): number {
    if (secondPair.jaccardSimilarity !== firstPair.jaccardSimilarity) {
        return secondPair.jaccardSimilarity - firstPair.jaccardSimilarity;
    }
    if (secondPair.sharedCommits !== firstPair.sharedCommits) {
        return secondPair.sharedCommits - firstPair.sharedCommits;
    }
    if (firstPair.fileA !== secondPair.fileA) {
        return firstPair.fileA - secondPair.fileA;
    }
    return firstPair.fileB - secondPair.fileB;
}

/**
 * Pure JavaScript fallback for temporal coupling co-change mining.
 *
 * @param changesets - Commit-sized groups of file ids, each listing files changed together.
 * @param minShared - Floor on how often two files must co-occur before the pair is reported.
 * @param minJaccard - Floor on the Jaccard overlap of the two files' change sets.
 * @returns Co-change pairs that clear both thresholds, ordered by descending coupling strength.
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

    for (const changeset of changesets) {
        recordChangeset(changeset, state);
    }

    const pairs: NativeTemporalCouplingPair[] = [];
    for (const [key, shared] of state.pairSharedCounts.entries()) {
        const pair = parseAndEvaluateCouplingPair({
            key,
            shared,
            fileCommitCounts: state.fileCommitCounts,
            minShared,
            minJaccard,
        });
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
 *
 * @param line - Raw source line; only its leading whitespace run is inspected.
 * @returns Indentation measured in units, where a tab counts as one unit.
 */
export function measureLineIndentLevelShim(line: string): number {
    let spaces = 0;
    for (let i = 0; i < line.length; i++) {
        const charCode = line.charCodeAt(i);
        if (charCode === 32) {
            spaces++;
        } else if (charCode === 9) {
            spaces += SPACE_INDENT_SIZE;
        } else {
            break;
        }
    }
    return Math.floor(spaces / SPACE_INDENT_SIZE);
}

const ZERO_BUMPY_ROAD_RESULT: NativeBumpyRoadResult = Object.freeze({
    bumpyScore: 0.0,
    isBumpy: false,
    meanDepth: 0.0,
    varianceDepth: 0.0,
    spikesCount: 0,
});

interface DepthVarianceCalculationParams {
    readonly lines: readonly string[];
    readonly startLine: number;
    readonly endLine: number;
    readonly baseIndent: number;
    readonly meanDepth: number;
}

function computeDepthVarianceAndSpikes(params: DepthVarianceCalculationParams): {
    varianceSum: number;
    spikesCount: number;
} {
    const { lines, startLine, endLine, baseIndent, meanDepth } = params;
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

    return { varianceSum, spikesCount };
}

/**
 * Pure JavaScript fallback for Bumpy Road structural complexity evaluation.
 *
 * @param lines - Source lines of the file being inspected.
 * @param startLine - One-based first line of the function region to evaluate.
 * @param endLine - One-based last line of that region, inclusive.
 * @returns Nested-depth profile for the region; unrunnable bounds yield a zero, non-bumpy result.
 */
export function evaluateBumpyRoadShim(
    lines: readonly string[],
    startLine: number,
    endLine: number,
): NativeBumpyRoadResult {
    const totalLines = endLine - startLine + 1;
    if (!lines || totalLines < MIN_BUMPY_LINE_SPAN || startLine < 1 || endLine > lines.length) {
        return ZERO_BUMPY_ROAD_RESULT;
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
        depthSum += Math.max(0, depth - baseIndent);
        nonBlankCount++;
    }

    if (nonBlankCount < MIN_BUMPY_LINE_SPAN) {
        return ZERO_BUMPY_ROAD_RESULT;
    }

    const meanDepth = depthSum / nonBlankCount;
    const { varianceSum, spikesCount } = computeDepthVarianceAndSpikes({
        lines,
        startLine,
        endLine,
        baseIndent,
        meanDepth,
    });

    const varianceDepth = +(varianceSum / nonBlankCount).toFixed(2);
    const rawScore = spikesCount * varianceDepth * Math.max(1.0, meanDepth);
    const bumpyScore = +Math.min(100.0, rawScore).toFixed(2);
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
        const triggerItem = group[i];
        if (triggerItem && triggerItem.length > 0) {
            validTriggers.push(triggerItem);
        }
    }
    if (validTriggers.length === 0) {
        return false;
    }
    const pattern = validTriggers
        .map((triggerPattern) => triggerPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    return new RegExp(pattern).test(content);
}

function probeSingleTriggerGroup(content: string, group: readonly string[], len: number): boolean {
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
 *
 * @param content - Text scanned for the trigger groups.
 * @param triggerGroups - One trigger set per probed group; an empty group always matches.
 * @returns One flag per group, in the same order as the input groups.
 */
export function batchProbeTriggersShim(
    content: string,
    triggerGroups: readonly (readonly string[])[],
): boolean[] {
    if (!triggerGroups || triggerGroups.length === 0) {
        return [];
    }
    if (!content) {
        return triggerGroups.map((triggerGroup) => !triggerGroup || triggerGroup.length === 0);
    }
    const len = content.length;
    return triggerGroups.map((group) => probeSingleTriggerGroup(content, group, len));
}
