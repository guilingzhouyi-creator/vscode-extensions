/**
 * UTF-8 byte-offset ↔ UTF-16 code-unit conversion (ts-free pure functions).
 *
 * The diff system reports edit ranges with UTF-8 BYTE offsets (offsets into the raw UTF-8
 * byte stream). The engine's normalized tree, `content.length`, `String.prototype.slice`
 * and `editDiff.ts` all use UTF-16 CODE-UNIT offsets (JS string indices). This module maps
 * between the two at the entry boundary so the engine never has to think in UTF-8.
 *
 * This module NEVER imports `typescript` (it sits on the diff routing path, which must stay
 * loadable without the parser).
 */

import { EditRange, validateEditRanges } from './editDiff';

/**
 * Normalize diff-system content to a UTF-16 JS string (byte-identical to
 * `fs.readFileSync(path, 'utf8')` for a `Buffer`). A `string` is passed through unchanged.
 * NOTE: `buf.toString('utf8')` PRESERVES a leading BOM (U+FEFF) — we must not strip it, or
 * the content hash would diverge from the on-disk bytes and trigger a spurious full rescan.
 */
export function decodeContent(input: string | Buffer | Uint8Array): string {
  if (typeof input === 'string') return input;
  return Buffer.from(input as Uint8Array).toString('utf8');
}

/**
 * Build the byte→code-unit mapping for a UTF-8 buffer, following the WHATWG UTF-8 decoder
 * (the same algorithm `Buffer#toString('utf8')` uses) with `fatal:false` → lossy U+FFFD
 * replacement for invalid/truncated sequences.
 *
 * Returns `map` of length `buf.length + 1` where:
 *   - `map[i]` = the UTF-16 code-unit offset at the CODE-POINT BOUNDARY starting at byte `i`;
 *   - `map[i]` = -1 for continuation bytes (bytes inside a multi-byte sequence);
 *   - `map[buf.length]` = the total UTF-16 length of the decoded string.
 *
 * A 4-byte surrogate-pair code point (U+10000+) counts as TWO code units; every other code
 * point (ASCII / BMP / BOM) counts as ONE.
 */
export function utf8ToUtf16Offsets(buf: Uint8Array): number[] {
  const map: number[] = new Array(buf.length + 1).fill(-1);
  let utf16 = 0;
  let i = 0;
  // UTF-8 decoder state (WHATWG UTF-8 decoder, fatal:false → lossy U+FFFD).
  let cp = 0;
  let needed = 0;
  let seen = 0;
  let startIdx = -1;

  // Minimum valid code point for an N-byte sequence (overlong-encoding guard).
  const minForLen = (n: number): number => (n === 1 ? 0x80 : n === 2 ? 0x800 : 0x10000);

  const emitAt = (idx: number, codeUnits: number): void => {
    map[idx] = utf16;
    utf16 += codeUnits;
  };

  while (i < buf.length) {
    const b = buf[i];
    if (needed === 0) {
      // Expect a lead byte (or a single-byte ASCII / an invalid byte).
      if (b <= 0x7f) {
        emitAt(i, 1);
        i++;
      } else if (b >= 0xc2 && b <= 0xdf) {
        needed = 1;
        cp = b & 0x1f;
        startIdx = i;
        i++;
      } else if (b >= 0xe0 && b <= 0xef) {
        needed = 2;
        cp = b & 0x0f;
        startIdx = i;
        i++;
      } else if (b >= 0xf0 && b <= 0xf4) {
        needed = 3;
        cp = b & 0x07;
        startIdx = i;
        i++;
      } else {
        // Invalid lead byte → one U+FFFD for this single byte.
        emitAt(i, 1);
        i++;
      }
      continue;
    }

    // Expect a continuation byte.
    if (b >= 0x80 && b <= 0xbf) {
      seen++;
      cp = (cp << 6) | (b & 0x3f);
      if (seen === needed) {
        if (cp < minForLen(needed) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          // Overlong / surrogate / out-of-range → one U+FFFD for the whole sequence.
          emitAt(startIdx, 1);
        } else {
          emitAt(startIdx, cp > 0xffff ? 2 : 1);
        }
        needed = 0;
        seen = 0;
        cp = 0;
        startIdx = -1;
      }
      i++;
    } else {
      // Invalid continuation → one U+FFFD for the INCOMPLETE sequence, then re-process this
      // byte as a fresh lead (WHATWG "prepend byte" behavior).
      emitAt(startIdx, 1);
      needed = 0;
      seen = 0;
      cp = 0;
      startIdx = -1;
      // do not advance i
    }
  }

  // Truncated trailing sequence → one U+FFFD for the leftover bytes.
  if (needed > 0) emitAt(startIdx, 1);

  map[buf.length] = utf16;
  return map;
}

/**
 * Convert a single UTF-8 byte offset to a UTF-16 code-unit offset. Offsets that land on a
 * continuation byte are snapped back to the preceding code-point boundary (`≤ byteOffset`).
 */
export function utf8ToUtf16Offset(map: number[], byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  const total = map[map.length - 1];
  if (byteOffset >= map.length - 1) return total;
  let k = byteOffset;
  while (k > 0 && map[k] === -1) k--;
  return map[k] >= 0 ? map[k] : 0;
}

/**
 * Normalize diff-system edit ranges: convert the three UTF-8 byte fields to UTF-16
 * code-unit offsets (line fields are 1-based and passed through untouched), drop empty
 * edits, sort by start position, and validate. Throws on any invalid range (the caller
 * treats that as a full-rescan fallback — edit ranges are advisory, never correctness).
 */
export function normalizeEditRanges(editRanges: EditRange[], buf: Uint8Array): EditRange[] {
  // Validate raw UTF-8 byte offsets against the buffer length BEFORE conversion.
  validateEditRanges(editRanges, buf.length);
  const map = utf8ToUtf16Offsets(buf);
  const out: EditRange[] = [];
  for (const e of editRanges) {
    const startByte = utf8ToUtf16Offset(map, e.startByte);
    const oldEndByte = utf8ToUtf16Offset(map, e.oldEndByte);
    const newEndByte = utf8ToUtf16Offset(map, e.newEndByte);
    // Drop no-op edits (no deleted bytes and no inserted bytes).
    if (oldEndByte === startByte && newEndByte === startByte) continue;
    out.push({
      startLine: e.startLine,
      oldEndLine: e.oldEndLine,
      newEndLine: e.newEndLine,
      startByte,
      oldEndByte,
      newEndByte,
    });
  }
  out.sort((a, b) => a.startByte - b.startByte || a.startLine - b.startLine);
  return out;
}
