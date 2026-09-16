/**
 * Module: Core Engine — SWAR and Bit-Parallel Vectorization Primitives
 * File Path: src/core/swar.ts
 * Architecture Role: dependency-free, leaf-level numeric kernel library for 64-bit SWAR byte
 *   scans and bit-parallel Myers edit distance; imported directly by performance-sensitive
 *   core modules and benchmarks.
 * Dependencies & Triggers: has no imports; exports the 64-bit masks used by callers
 *   (HIGH_BITS_64, ONES_64, NEWLINE_MASK_64); isPureAsciiSWAR64 is imported by
 *   src/core/utf8.ts on the UTF-8 decoding fast path; api.ts re-exports the module, and
 *   scripts/bench-quant.js plus scripts/bench-deep-stress.js exercise the Myers kernels.
 * Responsibilities: validate pure ASCII eight bytes per 64-bit step with a scalar tail;
 *   round byte sizes up to a 64-byte cache line; compute Myers edit distance with the fast
 *   32-bit Smi kernel for patterns up to 32 lines; delegate to it and run the BigInt kernel
 *   for 33-64 line patterns; expose the mask constants named above.
 * Exit Semantics & Design Rationale: all functions are synchronous and side-effect free.
 *   bitParallelMyers32Distance and bitParallelMyers64Distance throw Error when the pattern
 *   exceeds their 32/64-line bound instead of returning a truncated score. The split 32/64
 *   design avoids BigInt allocation for the common case while keeping exact edit distance.
 */

// Magic 64-bit constants
/** High bit set in each of the eight byte lanes; SWAR ASCII-range detector mask. */
export const HIGH_BITS_64 = 0x8080808080808080n;
/** Low bit set in each of the eight byte lanes; SWAR per-byte carry/borrow mask. */
export const ONES_64 = 0x0101010101010101n;
/** Byte 0x0a replicated across all eight lanes; LF/newline detection mask. */
export const NEWLINE_MASK_64 = 0x0a0a0a0a0a0a0a0an;
/** High bit set in each of the four byte lanes of a 32-bit word; 32-bit SWAR range detector. */
const HIGH_BITS_32 = 0x80808080;
/**
 * Number of bytes in one 32-bit word; offset of the high half of a 64-bit word read as two
 * 32-bit integers.
 */
const WORD32_BYTES = 4;
/** Bytes in one 64-bit word; stride and alignment of the eight-byte SWAR scan. */
const WORD64_BYTES = 8;
/** Largest byte value that is still pure ASCII (0x7f). */
const ASCII_MAX_BYTE = 0x7f;
/** Minimum buffer length in bytes for the eight-bytes-per-step SWAR fast path. */
const SWAR_FAST_PATH_MIN_BYTES = 16;
/** Low six bits set (64 - 1); addend/complement mask used to round sizes up to a cache line. */
const CACHE_LINE_MASK = 63;
/** Maximum pattern length in lines supported by the 32-bit Myers kernel. */
const MYERS32_MAX_PATTERN_LINES = 32;
/** Maximum pattern length in lines supported by the 64-bit BigInt Myers kernel. */
const MYERS64_MAX_PATTERN_LINES = 64;

/**
 * Test whether every byte of `buf` is pure ASCII (< 0x80). For buffers of 16 bytes or more the
 * kernel reads eight bytes per step through two 32-bit DataView reads, avoiding BigInt
 * allocation; shorter buffers and the trailing partial word use a scalar loop.
 *
 * @param buf - Byte view to inspect; only [byteOffset, byteOffset + length) is read.
 * @returns True when all bytes are <= 0x7f, false at the first byte whose high bit is set.
 */
export function isPureAsciiSWAR64(buf: Uint8Array): boolean {
    const len = buf.length;
    if (len < SWAR_FAST_PATH_MIN_BYTES) {
        for (let i = 0; i < len; i++) {
            if (buf[i] > ASCII_MAX_BYTE) return false;
        }
        return true;
    }

    const word8Count = Math.floor(len / WORD64_BYTES);
    const remainder = len % WORD64_BYTES;

    // Use DataView bounded strictly by buf.byteOffset and len
    // Validate 8 bytes per step via two 32-bit reads with zero BigInt heap boxing
    if (word8Count > 0) {
        const view = new DataView(buf.buffer, buf.byteOffset, len);
        for (let w = 0; w < word8Count; w++) {
            const off = w * WORD64_BYTES;
            const w1 = view.getUint32(off, true);
            const w2 = view.getUint32(off + WORD32_BYTES, true);
            if (((w1 | w2) & HIGH_BITS_32) !== 0) return false;
        }
    }

    // Trailing scalar bytes
    const tailStart = word8Count * WORD64_BYTES;
    for (let i = 0; i < remainder; i++) {
        if (buf[tailStart + i] > ASCII_MAX_BYTE) return false;
    }

    return true;
}

/**
 * Round a byte count up to the next 64-byte cache-line boundary.
 *
 * @param bytes - Non-negative integer byte count to align.
 * @returns Smallest multiple of 64 greater than or equal to `bytes`; aligned input is unchanged.
 */
export function align64(bytes: number): number {
    return (bytes + CACHE_LINE_MASK) & ~CACHE_LINE_MASK;
}

/**
 * Compute the exact Myers insert/delete distance between two line sequences with at most 32
 * pattern lines, using 32-bit bit-parallel vertical delta registers in O(pattern + text) time
 * and no BigInt arithmetic. The pattern is rejected rather than truncated past the bound.
 *
 * @param pattern - Pattern lines as hash codes; repeated lines are merged into peq bitmasks.
 * @param text - Text lines as hash codes produced by the same tokenizer as `pattern`.
 * @returns Minimum number of line insertions/deletions turning `pattern` into `text`.
 * @throws Error when `pattern.length > 32`; empty inputs return the other sequence's length.
 */
export function bitParallelMyers32Distance(pattern: Uint32Array, text: Uint32Array): number {
    const m = pattern.length;
    const n = text.length;
    if (m === 0) return n;
    if (n === 0) return m;
    if (m > MYERS32_MAX_PATTERN_LINES) {
        throw new Error('Pattern length must be <= 32 for 32-bit Bit-Parallel Myers');
    }

    // Precompute pattern bitmasks (one bit per line occurrence in pattern)
    const peq = new Map<number, number>();
    for (let i = 0; i < m; i++) {
        const hash = pattern[i];
        const mask = peq.get(hash) || 0;
        peq.set(hash, mask | (1 << i));
    }

    let vp = ~0; // 0xFFFFFFFF
    let vn = 0;
    let score = m;
    const targetBit = 1 << (m - 1);

    for (let j = 0; j < n; j++) {
        const hash = text[j];
        const pm = peq.get(hash) || 0;

        const x = ((pm & vp) >>> 0) + (vp >>> 0);
        const d0 = (x ^ vp) | pm | vn | 0;
        let hp = vn | ~(d0 | vp) | 0;
        let hn = (vp & d0) | 0;

        // Shift horizontal deltas
        hp = (hp << 1) | 1 | 0;
        hn = (hn << 1) | 0;

        vp = hn | ~(d0 | hp) | 0;
        vn = (hp & d0) | 0;

        if ((hp & targetBit) !== 0) {
            score++;
        } else if ((hn & targetBit) !== 0) {
            score--;
        }
    }

    return score;
}

/**
 * Compute the exact Myers insert/delete distance for patterns of up to 64 lines. Patterns of 32
 * lines or fewer delegate to the 32-bit kernel; larger ones use a BigInt bit-parallel kernel and
 * are rejected rather than truncated beyond 64.
 *
 * @param pattern - Pattern lines as hash codes, same tokenizer contract as the 32-bit kernel.
 * @param text - Text lines as hash codes; may be empty.
 * @returns Minimum line insertion/deletion distance; empty `text` returns the pattern length.
 * @throws Error when `pattern.length > 64`.
 */
export function bitParallelMyers64Distance(pattern: Uint32Array, text: Uint32Array): number {
    const m = pattern.length;
    if (m <= MYERS32_MAX_PATTERN_LINES) {
        return bitParallelMyers32Distance(pattern, text);
    }
    const n = text.length;
    if (n === 0) return m;
    if (m > MYERS64_MAX_PATTERN_LINES) {
        throw new Error('Pattern length must be <= 64 for 64-bit Bit-Parallel Myers');
    }

    // Precompute pattern bitmasks (one bit per line occurrence in pattern)
    const peq = new Map<number, bigint>();
    for (let i = 0; i < m; i++) {
        const hash = pattern[i];
        const mask = peq.get(hash) || 0n;
        peq.set(hash, mask | (1n << BigInt(i)));
    }

    let vp = ~0n; // Positive vertical delta vector
    let vn = 0n; // Negative vertical delta vector
    let score = m;

    for (let j = 0; j < n; j++) {
        const hash = text[j];
        const pm = peq.get(hash) || 0n;

        const d0 = (((pm & vp) + vp) ^ vp) | pm | vn;
        let hp = vn | ~(d0 | vp);
        let hn = vp & d0;

        // Shift horizontal deltas
        hp = (hp << 1n) | 1n;
        hn = hn << 1n;

        vp = hn | ~(d0 | hp);
        vn = hp & d0;

        if ((hp & (1n << BigInt(m - 1))) !== 0n) {
            score++;
        } else if ((hn & (1n << BigInt(m - 1))) !== 0n) {
            score--;
        }
    }

    return score;
}
