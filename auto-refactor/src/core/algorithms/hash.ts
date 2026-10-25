/**
 * Module: Core Algorithms — String and Buffer Hashing Operators
 * File Path: src/core/algorithms/hash.ts
 * Architecture Role: Unified foundation for non-cryptographic fast hashing operators,
 *   supporting AST entity fingerprinting, line-level diff tracking, and clone detection.
 * Dependencies & Triggers: Zero external dependencies; pure bitwise arithmetic.
 * Responsibilities:
 *   1. Compute 32-bit and 64-bit FNV-1a hashes with deterministic unsigned outputs;
 *   2. Compute Bernstein DJB2 line hashes for fast line comparisons;
 *   3. Compute Java-style polynomial accumulator hashes for sliding window clone detection.
 * Exit Semantics & Design Rationale: CC <= 6; pure functions; zero heap allocations in loops;
 *   single canonical implementation for every hashing call site in the engine.
 */

/** 32-bit FNV-1a initial offset basis (0x811c9dc5). */
export const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;

/** 32-bit FNV-1a prime constant (0x01000193). */
export const FNV1A_32_PRIME = 0x01000193;

/** 64-bit FNV-1a initial offset basis (0xcbf29ce484222325n). */
export const FNV1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;

/** 64-bit FNV-1a prime constant (0x100000001b3n). */
export const FNV1A_64_PRIME = 0x100000001b3n;

/** 32-bit DJB2 initial offset basis (5381). */
export const DJB2_OFFSET_BASIS = 5381;

/** 32-bit DJB2 multiplier constant (33). */
export const DJB2_MULTIPLIER = 33;

/** Java polynomial hash multiplier constant (31). */
export const JAVA_HASH_MULTIPLIER = 31;

/**
 * Computes unsigned 32-bit FNV-1a hash of a string.
 *
 * @param str - Source text to hash.
 * @returns Unsigned 32-bit integer in [0, 4294967295].
 */
export function computeFnv1a32(str: string): number {
    let hash = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, FNV1A_32_PRIME);
    }
    return hash >>> 0;
}

/** Backward compatibility alias for computeFnv1a32. */
export const fnv1a32 = computeFnv1a32;

/**
 * Computes signed 32-bit FNV-1a hash of a string.
 *
 * @param str - Source text to hash.
 * @returns Signed 32-bit integer in [-2147483648, 2147483647].
 */
export function computeFnv1a32Signed(str: string): number {
    return computeFnv1a32(str) | 0;
}

/** Backward compatibility alias for computeFnv1a32Signed. */
export const fnv1a32Signed = computeFnv1a32Signed;

/**
 * Hash every entry of an already-split line array into an unsigned 32-bit Uint32Array.
 *
 * @param lines - Lines to hash.
 * @returns One unsigned 32-bit FNV-1a hash per input line.
 */
export function hashLines(lines: string[]): Uint32Array {
    const hashes = new Uint32Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        hashes[i] = computeFnv1a32(lines[i]);
    }
    return hashes;
}

/**
 * Computes unsigned 64-bit FNV-1a BigInt hash of a string.
 *
 * @param str - Source text to hash.
 * @returns 64-bit unsigned BigInt.
 */
export function computeFnv1a64(str: string): bigint {
    let hash = FNV1A_64_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = (hash * FNV1A_64_PRIME) & 0xffffffffffffffffn;
    }
    return hash;
}

/** Backward compatibility alias for computeFnv1a64. */
export const fnv1a64 = computeFnv1a64;

/**
 * Computes 32-bit DJB2 hash (hash * 33 ^ c) of a string.
 *
 * @param str - Source text to hash.
 * @returns Signed 32-bit integer.
 */
export function computeDjb2(str: string): number {
    let hash = DJB2_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(hash, DJB2_MULTIPLIER) ^ str.charCodeAt(i)) | 0;
    }
    return hash;
}

/** Backward compatibility alias for computeDjb2. */
export const djb2 = computeDjb2;

/**
 * Computes Java-style polynomial hash (hash * 31 + c) of a string.
 *
 * @param str - Source text to hash.
 * @returns Signed 32-bit integer.
 */
export function computeJavaHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (Math.imul(JAVA_HASH_MULTIPLIER, hash) + str.charCodeAt(i)) | 0;
    }
    return hash;
}

/** Backward compatibility alias for computeJavaHash. */
export const javaHash = computeJavaHash;
