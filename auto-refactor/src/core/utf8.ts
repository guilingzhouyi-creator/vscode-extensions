/**
 * Module: Core Engine — UTF-8 Byte ↔ UTF-16 Offset Boundary Adaptation
 * File Path: src/core/utf8.ts
 * Architecture Role: TypeScript-free boundary adapter that converts diff-system UTF-8
 *   byte offsets into the UTF-16 code-unit offsets used by the engine's normalized tree.
 * Dependencies & Triggers: Imports EditRange/validateEditRanges from ./editDiff and
 *   isPureAsciiSWAR64 from ./swar; called on every diff input or edit-range batch by
 *   diff.ts, api.ts and analyzer.ts, and re-exported through incremental.ts.
 * Responsibilities: decodeContent normalizes string/Buffer content; isPureAscii detects
 *   the ASCII fast path; utf8ToUtf16Offsets/Offset build and query the byte→unit map;
 *   normalizeEditRanges validates, converts, drops empty edits, and sorts ranges.
 * Exit Semantics & Design Rationale: decodeContent preserves a leading BOM so content
 *   hashes stay byte-identical to disk; pure ASCII maps 1:1 and skips the whole map
 *   allocation; invalid ranges throw and callers fall back to a full rescan, because
 *   edit ranges are advisory and must never affect result correctness.
 *
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

import type { EditRange } from './editDiff';
import { validateEditRanges } from './editDiff';

// ── UTF-8 encoding boundaries (RFC 3629 / WHATWG decoder) ───────────────────────────
/** Largest single-byte (ASCII) code point. */
const ASCII_MAX = 0x7f;
/** Two-byte sequence lead-byte range — C0/C1 are overlong and therefore invalid. */
const LEAD2_MIN = 0xc2;
const LEAD2_MAX = 0xdf;
/** Three-byte sequence lead-byte range. */
const LEAD3_MIN = 0xe0;
const LEAD3_MAX = 0xef;
/** Four-byte sequence lead-byte range; above F4 is outside the Unicode range. */
const LEAD4_MIN = 0xf0;
const LEAD4_MAX = 0xf4;
/** Continuation-byte range shared by every multi-byte sequence. */
const CONTINUATION_MIN = 0x80;
const CONTINUATION_MAX = 0xbf;
/** Payload masks that strip the lead/continuation marker bits. */
const LEAD2_PAYLOAD_MASK = 0x1f;
const LEAD3_PAYLOAD_MASK = 0x0f;
const LEAD4_PAYLOAD_MASK = 0x07;
const CONTINUATION_PAYLOAD_MASK = 0x3f;
/** Bits contributed by each continuation byte. */
const CONTINUATION_SHIFT_BITS = 6;
/** Continuation bytes expected after each lead byte. */
const LEAD2_CONTINUATIONS = 1;
const LEAD3_CONTINUATIONS = 2;
const LEAD4_CONTINUATIONS = 3;
/** Minimum valid code point per sequence length (overlong-encoding guards). */
const SEQ2_MIN_CODE_POINT = 0x80;
const SEQ3_MIN_CODE_POINT = 0x800;
const SEQ4_MIN_CODE_POINT = 0x10000;
/** Unicode scalar-value window: surrogates and anything above U+10FFFF are invalid. */
const SURROGATE_MIN = 0xd800;
const SURROGATE_MAX = 0xdfff;
const BMP_MAX = 0xffff;
const MAX_CODE_POINT = 0x10ffff;
/** UTF-16 code units emitted per decoded code point. */
const BMP_CODE_UNITS = 1;
const SURROGATE_PAIR_CODE_UNITS = 2;

/**
 * Normalize diff-system content to a UTF-16 JS string (byte-identical to
 * `fs.readFileSync(path, 'utf8')` for a `Buffer`). A `string` is passed through unchanged.
 * NOTE: `buf.toString('utf8')` PRESERVES a leading BOM (U+FEFF) — we must not strip it, or
 * the content hash would diverge from the on-disk bytes and trigger a spurious full rescan.
 *
 * @param input - Diff-system content as a JS string, a Node Buffer, or raw UTF-8 bytes.
 * @returns The decoded UTF-16 string; a string input is returned unchanged and a BOM survives.
 */
export function decodeContent(input: string | Buffer | Uint8Array): string {
    if (typeof input === 'string') return input;
    return Buffer.from(input as Uint8Array).toString('utf8');
}

import { isPureAsciiSWAR64 } from './swar';

/**
 * Fast-path check: is the buffer 100% ASCII (all bytes <= 0x7f)?
 * In ASCII, UTF-8 byte offset === UTF-16 code-unit offset (identity map).
 * Uses 64-bit SWAR vector scanning for maximum speed (8 bytes per CPU cycle).
 *
 * @param buf - Raw bytes to inspect; only the top bit of each byte decides the result.
 * @returns True only when every byte is <= 0x7f, so byte and UTF-16 offsets coincide.
 */
export function isPureAscii(buf: Uint8Array): boolean {
    return isPureAsciiSWAR64(buf);
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
 *
 * @param buf - UTF-8 bytes to map; invalid or truncated sequences become one U+FFFD each.
 * @returns A `buf.length + 1` Int32Array whose final entry is the decoded UTF-16 length.
 */
export function utf8ToUtf16Offsets(buf: Uint8Array): Int32Array {
    const map = new Int32Array(buf.length + 1);
    map.fill(-1);
    let utf16 = 0;
    let i = 0;
    // UTF-8 decoder state (WHATWG UTF-8 decoder, fatal:false → lossy U+FFFD).
    let cp = 0;
    let needed = 0;
    let seen = 0;
    let startIdx = -1;

    // Minimum valid code point for an N-continuation sequence (overlong-encoding guard):
    // one continuation byte → 2-byte sequence, two → 3-byte, three → 4-byte.
    const minForLen = (n: number): number =>
        n === LEAD2_CONTINUATIONS
            ? SEQ2_MIN_CODE_POINT
            : n === LEAD3_CONTINUATIONS
              ? SEQ3_MIN_CODE_POINT
              : SEQ4_MIN_CODE_POINT;

    const emitAt = (idx: number, codeUnits: number): void => {
        map[idx] = utf16;
        utf16 += codeUnits;
    };

    while (i < buf.length) {
        const b = buf[i];
        if (needed === 0) {
            // Expect a lead byte (or a single-byte ASCII / an invalid byte).
            if (b <= ASCII_MAX) {
                emitAt(i, BMP_CODE_UNITS);
                i++;
            } else if (b >= LEAD2_MIN && b <= LEAD2_MAX) {
                needed = LEAD2_CONTINUATIONS;
                cp = b & LEAD2_PAYLOAD_MASK;
                startIdx = i;
                i++;
            } else if (b >= LEAD3_MIN && b <= LEAD3_MAX) {
                needed = LEAD3_CONTINUATIONS;
                cp = b & LEAD3_PAYLOAD_MASK;
                startIdx = i;
                i++;
            } else if (b >= LEAD4_MIN && b <= LEAD4_MAX) {
                needed = LEAD4_CONTINUATIONS;
                cp = b & LEAD4_PAYLOAD_MASK;
                startIdx = i;
                i++;
            } else {
                // Invalid lead byte → one U+FFFD for this single byte.
                emitAt(i, BMP_CODE_UNITS);
                i++;
            }
            continue;
        }

        // Expect a continuation byte.
        if (b >= CONTINUATION_MIN && b <= CONTINUATION_MAX) {
            seen++;
            cp = (cp << CONTINUATION_SHIFT_BITS) | (b & CONTINUATION_PAYLOAD_MASK);
            if (seen === needed) {
                if (
                    cp < minForLen(needed) ||
                    cp > MAX_CODE_POINT ||
                    (cp >= SURROGATE_MIN && cp <= SURROGATE_MAX)
                ) {
                    // Overlong / surrogate / out-of-range → one U+FFFD for the whole sequence.
                    emitAt(startIdx, BMP_CODE_UNITS);
                } else {
                    emitAt(startIdx, cp > BMP_MAX ? SURROGATE_PAIR_CODE_UNITS : BMP_CODE_UNITS);
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
 *
 * @param map - Offset map from utf8ToUtf16Offsets for the same byte buffer.
 * @param byteOffset - UTF-8 byte offset; non-positive values clamp to 0 and past-EOF values clamp
 *                     to the total UTF-16 length stored in the map's final entry.
 * @returns The UTF-16 code-unit offset at or before the requested byte boundary.
 */
export function utf8ToUtf16Offset(map: Int32Array | number[], byteOffset: number): number {
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
 *
 * @param editRanges - Raw ranges carrying UTF-8 byte offsets, typically straight from diff output.
 * @param buf - UTF-8 bytes the ranges refer to; also selects the ASCII fast path.
 * @returns A new array of UTF-16 ranges sorted by start, with no-op edits removed.
 * @throws When validateEditRanges rejects a raw range; callers must fall back to a full rescan.
 */
export function normalizeEditRanges(editRanges: EditRange[], buf: Uint8Array): EditRange[] {
    // Validate raw UTF-8 byte offsets against the buffer length BEFORE conversion.
    validateEditRanges(editRanges, buf.length);

    // Fast-path: pure ASCII files avoid 4.4MB Array allocation and map lookups!
    if (isPureAscii(buf)) {
        const out: EditRange[] = [];
        for (const e of editRanges) {
            if (e.oldEndByte === e.startByte && e.newEndByte === e.startByte) continue;
            out.push({
                startLine: e.startLine,
                oldEndLine: e.oldEndLine,
                newEndLine: e.newEndLine,
                startByte: e.startByte,
                oldEndByte: e.oldEndByte,
                newEndByte: e.newEndByte,
            });
        }
        out.sort((a, b) => a.startByte - b.startByte || a.startLine - b.startLine);
        return out;
    }

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
