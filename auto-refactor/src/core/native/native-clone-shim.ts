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

import type { NativeCloneBlock, NativeClonePair } from './native-types';

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
export function detectCloneBlocksShim(
    content: string,
    minCloneLines: number,
): NativeCloneBlock[] {
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
        } else if (prevIdx === undefined) {
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
            const s = (Math.imul(meaningfulHashes[i], 961) +
                Math.imul(meaningfulHashes[i + 1], 31) +
                meaningfulHashes[i + 2]) >>> 0;
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
function addBucketCandidates(
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
 * Discovers similar file pairs using Locality Sensitive Hashing (LSH).
 * @param signatures Array of MinHash signature vectors.
 * @param threshold Jaccard similarity threshold [0.0, 1.0].
 * @returns List of candidate clone pairs exceeding the threshold.
 */
export function findClonePairsShim(
    signatures: number[][],
    threshold: number,
): NativeClonePair[] {
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
                addBucketCandidates(bucket, candidateMap);
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
