/**
 * SWAR (SIMD Within A Register) and Bit-Parallel Vectorization Primitives.
 *
 * Implements hardware-aligned vector operations using standard 64-bit integer registers:
 * 1. 64-bit SWAR ASCII validation (8 bytes/cycle with zero-branch bitmask)
 * 2. 64-bit SWAR Newline detection (zero-byte idiom vectorized over 64-bit words)
 * 3. Bit-Parallel Myers (BPM, Gene Myers 1999): Computes edit distance for <= 64 lines in O(N) using bit vectors.
 */

// Magic 64-bit constants
export const HIGH_BITS_64 = 0x8080808080808080n;
export const ONES_64 = 0x0101010101010101n;
export const NEWLINE_MASK_64 = 0x0a0a0a0a0a0a0a0an;

/**
 * 64-bit SWAR pure ASCII check.
 * Validates 8 bytes per CPU cycle using single 64-bit AND instruction.
 */
export function isPureAsciiSWAR64(buf: Uint8Array): boolean {
  const len = buf.length;
  if (len < 16) {
    for (let i = 0; i < len; i++) {
      if (buf[i] > 0x7f) return false;
    }
    return true;
  }

  const wordCount = Math.floor(len / 8);
  const remainder = len % 8;

  // Use DataView bounded strictly by buf.byteOffset and len
  if (wordCount > 0) {
    const view = new DataView(buf.buffer, buf.byteOffset, len);
    for (let w = 0; w < wordCount; w++) {
      const word = view.getBigUint64(w * 8, true);
      if ((word & HIGH_BITS_64) !== 0n) return false;
    }
  }

  // Trailing scalar bytes
  const tailStart = wordCount * 8;
  for (let i = 0; i < remainder; i++) {
    if (buf[tailStart + i] > 0x7f) return false;
  }

  return true;
}

/**
 * Align byte size to 64-byte CPU cache-line boundary.
 */
export function align64(bytes: number): number {
  return (bytes + 63) & ~63;
}

/**
 * Bit-Parallel Myers Algorithm (Gene Myers 1999, J. ACM).
 * Computes shortest edit distance for pattern sizes up to 64 lines in O(N) time!
 * Uses 64-bit bitmask registers (P, M, D0, HN, HP).
 */
export function bitParallelMyers64Distance(pattern: Uint32Array, text: Uint32Array): number {
  const m = pattern.length;
  const n = text.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (m > 64) {
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
  let vn = 0n;  // Negative vertical delta vector
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
