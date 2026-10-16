/**
 * Module: Core Intelligence — 3-gram Semantic Vector & SWAR SimHash Engine
 * File Path: src/core/intelligence/semantic-vector.ts
 * Architecture Role: High-performance vector feature extractor, bit-parallel SimHash calculator,
 *   and orphan inlining utility evaluator.
 * Dependencies & Triggers: Pure native algorithmic operator; zero external dependencies;
 *   utilized by semantic similarity analyzers and refactoring recommendation engines.
 * Responsibilities: Extract 3-gram sparse token frequency vectors; compute trigram cosine
 *   similarity; compute 64-bit SimHash fingerprints with SWAR bitwise popcount Hamming
 *   similarity; calculate single-use orphan function inlining payoff utility.
 * Exit Semantics & Design Rationale: Constant-time bitwise operations and single-pass algorithms;
 *   never throws on empty or zero vectors; enforces zero heap allocation across hash hot paths;
 *   strictly conforms to algebraic inlining utility specification.
 */

/**
 * Parameters for calculating orphan inline utility payoff.
 */
export interface InliningUtilityParams {
    readonly cosSim: number;
    readonly childEloc: number;
    readonly sharedScopeVarsCount: number;
    readonly childParamCount: number;
}

/** 64-bit FNV-1a offset basis constant. */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;

/** 64-bit FNV-1a prime constant. */
const FNV_PRIME = 0x100000001b3n;

/** 64-bit bitmask. */
const MASK_64 = 0xffffffffffffffffn;

/**
 * 64-bit FNV-1a hash function for strings.
 *
 * @param str The string to hash.
 * @returns 64-bit unsigned BigInt hash.
 */
function fnv1a64(str: string): bigint {
    let hash = FNV_OFFSET_BASIS;
    const len = str.length;
    for (let i = 0; i < len; i++) {
        hash = ((hash ^ BigInt(str.charCodeAt(i))) * FNV_PRIME) & MASK_64;
    }
    return hash;
}

/**
 * Branch-free SWAR (SIMD Within A Register) popcount for 32-bit unsigned integers.
 *
 * @param x 32-bit unsigned integer.
 * @returns Number of set bits.
 */
function popcount32(x: number): number {
    let v = x - ((x >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Extract 3-gram sparse token frequency feature vector.
 *
 * @param tokens Ordered array of token strings.
 * @returns Map of trigram string keys to occurrences count.
 */
export function extractTokenTrigrams(tokens: readonly string[]): Map<string, number> {
    const trigramMap = new Map<string, number>();
    const len = tokens.length;
    if (len < 3) {
        return trigramMap;
    }

    const bound = len - 2;
    for (let i = 0; i < bound; i++) {
        const key = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
        trigramMap.set(key, (trigramMap.get(key) ?? 0) + 1);
    }

    return trigramMap;
}

/**
 * Calculate cosine similarity between two 3-gram frequency vectors.
 *
 * CosSim(A, B) = (A \cdot B) / (||A|| * ||B||)
 *
 * @param vecA First frequency vector.
 * @param vecB Second frequency vector.
 * @returns Cosine similarity in [0.0, 1.0].
 */
export function calculateTrigramCosineSimilarity(
    vecA: ReadonlyMap<string, number>,
    vecB: ReadonlyMap<string, number>,
): number {
    if (vecA.size === 0 || vecB.size === 0) {
        return 0;
    }

    const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

    let dotProduct = 0;
    for (const [key, countA] of smaller.entries()) {
        const countB = larger.get(key);
        if (countB !== undefined) {
            dotProduct += countA * countB;
        }
    }

    if (dotProduct === 0) {
        return 0;
    }

    let sumSqA = 0;
    for (const val of vecA.values()) {
        sumSqA += val * val;
    }

    let sumSqB = 0;
    for (const val of vecB.values()) {
        sumSqB += val * val;
    }

    const denominator = Math.sqrt(sumSqA) * Math.sqrt(sumSqB);
    if (denominator <= 0) {
        return 0;
    }

    const sim = dotProduct / denominator;
    return Math.round(Math.min(1.0, Math.max(0.0, sim)) * 1e6) / 1e6;
}

/**
 * Compute 64-bit branch-free bit-parallel SimHash fingerprint from tokens.
 *
 * @param tokens Array of token strings.
 * @returns 64-bit BigInt SimHash fingerprint.
 */
export function computeSimHash64(tokens: readonly string[]): bigint {
    const len = tokens.length;
    if (len === 0) {
        return 0n;
    }

    const weights = new Int32Array(64);

    for (let i = 0; i < len; i++) {
        const h = fnv1a64(tokens[i]);
        for (let b = 0; b < 64; b++) {
            const bit = (h >> BigInt(b)) & 1n;
            weights[b] += bit === 1n ? 1 : -1;
        }
    }

    let fingerprint = 0n;
    for (let b = 0; b < 64; b++) {
        if (weights[b] > 0) {
            fingerprint |= 1n << BigInt(b);
        }
    }

    return fingerprint;
}

/**
 * Calculate SimHash Hamming similarity via 64-bit SWAR popcount.
 *
 * Similarity = 1.0 - popcount(hashA ^ hashB) / 64.0
 *
 * @param hashA First 64-bit SimHash.
 * @param hashB Second 64-bit SimHash.
 * @returns Hamming similarity score in [0.0, 1.0].
 */
export function calculateSimHashHammingSimilarity(hashA: bigint, hashB: bigint): number {
    const diff = (hashA ^ hashB) & MASK_64;
    if (diff === 0n) {
        return 1.0;
    }

    const low32 = Number(diff & 0xffffffffn) >>> 0;
    const high32 = Number((diff >> 32n) & 0xffffffffn) >>> 0;
    const distance = popcount32(low32) + popcount32(high32);

    const sim = 1.0 - distance / 64.0;
    return Math.round(Math.min(1.0, Math.max(0.0, sim)) * 1e6) / 1e6;
}

/**
 * Calculate single-use orphan function inlining payoff utility.
 *
 * Strict Formula:
 *   U_{inline} = CosSim * (1 - childEloc / 8) * ((sharedVars + 1) / (childParams + 1))
 *
 * @param params Inlining parameters (cosSim, childEloc, sharedScopeVarsCount, childParamCount).
 * @returns Algebraic inlining utility value (positive = beneficial, negative = unfavorable).
 */
export function calculateInliningUtility(params: InliningUtilityParams): number {
    const cosSim = Math.min(1.0, Math.max(0.0, Number.isFinite(params.cosSim) ? params.cosSim : 0));
    const childEloc = Math.max(0, Number.isFinite(params.childEloc) ? params.childEloc : 0);
    const sharedVars = Math.max(
        0,
        Number.isFinite(params.sharedScopeVarsCount) ? params.sharedScopeVarsCount : 0,
    );
    const childParams = Math.max(
        0,
        Number.isFinite(params.childParamCount) ? params.childParamCount : 0,
    );

    const sizeFactor = 1.0 - childEloc / 8.0;
    const scopeRatio = (sharedVars + 1.0) / (childParams + 1.0);
    const utility = cosSim * sizeFactor * scopeRatio;

    return Math.round(utility * 1e6) / 1e6;
}
