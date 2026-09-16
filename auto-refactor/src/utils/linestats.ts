/**
 * Module: Core Engine — Line-Statistics Primitives (ts-free Hot Path)
 * File Path: src/utils/linestats.ts
 * Architecture Role: Leaf utility on the per-file hot path; the single source of the line
 *   and non-blank-line totals shared by the orchestrator metric collector and worker timings.
 * Dependencies & Triggers: Zero imports by design (must NEVER import `typescript` or any
 *   module that does); imported by core/analyzer.ts (FileMetricCollector) and core/worker.ts,
 *   re-exported by utils/ast.ts, and required directly by bench-fastpath.js and
 *   bench-oxc-modea.js. Extracted from utils/ast.ts so worker threads can count lines
 *   without pulling in the `typescript` module.
 * Responsibilities: Reproduce `content.split(/\r\n|\n/).length` as `lines`; count lines whose
 *   `trim()` result is non-empty as `nonBlankLines`; recognize exactly the ECMAScript
 *   WhiteSpace + LineTerminator set (U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A,
 *   U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF); compute both totals in one scan.
 * Exit Semantics & Design Rationale: Pure, synchronous and deterministic; always returns
 *   { lines, nonBlankLines } (empty input yields 1/0) and never throws. The single pass
 *   exists to remove 2–3 whole-string `split` calls plus intermediate line arrays per file,
 *   and the import-free module keeps `typescript` off the worker hot path.
 */

/** U+0009 HORIZONTAL TAB, lower bound of the C0 whitespace range (tab, LF, VT, FF, CR). */
const CHAR_TAB = 0x09;

/** U+000A LINE FEED, the only code unit that starts a new line in `countLineStats`. */
const CHAR_LINE_FEED = 0x0a;

/** U+000D CARRIAGE RETURN, upper bound of the C0 whitespace range (tab, LF, VT, FF, CR). */
const CHAR_CARRIAGE_RETURN = 0x0d;

/** U+0020 SPACE. */
const CHAR_SPACE = 0x20;

/** U+00A0 NO-BREAK SPACE. */
const CHAR_NO_BREAK_SPACE = 0xa0;

/** U+1680 OGHAM SPACE MARK. */
const CHAR_OGHAM_SPACE_MARK = 0x1680;

/** U+2000 EN QUAD, lower bound of the U+2000–U+200A space range. */
const CHAR_EN_QUAD = 0x2000;

/** U+200A HAIR SPACE, upper bound of the U+2000–U+200A space range. */
const CHAR_HAIR_SPACE = 0x200a;

/** U+2028 LINE SEPARATOR. */
const CHAR_LINE_SEPARATOR = 0x2028;

/** U+2029 PARAGRAPH SEPARATOR. */
const CHAR_PARAGRAPH_SEPARATOR = 0x2029;

/** U+202F NARROW NO-BREAK SPACE. */
const CHAR_NARROW_NO_BREAK_SPACE = 0x202f;

/** U+205F MEDIUM MATHEMATICAL SPACE. */
const CHAR_MEDIUM_MATHEMATICAL_SPACE = 0x205f;

/** U+3000 IDEOGRAPHIC SPACE. */
const CHAR_IDEOGRAPHIC_SPACE = 0x3000;

/** U+FEFF ZERO WIDTH NO-BREAK SPACE (byte-order mark). */
const CHAR_ZERO_WIDTH_NO_BREAK_SPACE = 0xfeff;

/**
 * Architectural design: single-pass line statistics, computed ONCE per file and shared by
 * every consumer (FileMetricCollector + large-file analyzer) — replacing 2–3 whole-string
 * `split` calls plus intermediate line arrays per file.
 *
 * Semantics are byte-identical to the previous implementation:
 *   - `lines`        == `content.split(/\r\n|\n/).length`  (i.e. 1 + number of `\n`)
 *   - `nonBlankLines` == lines whose `trim()` result is non-empty
 *
 * The whitespace predicate below is EXACTLY the set ECMAScript `String.prototype.trim`
 * removes (WhiteSpace + LineTerminator): U+0009–U+000D, U+0020, U+00A0, U+1680,
 * U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Note that U+2028/U+2029
 * are trim-whitespace but NOT `\n`, so they do not increment `lines` (matching split).
 *
 * @param ch - UTF-16 code unit to test.
 * @returns `true` when ECMAScript `String.prototype.trim` treats the code point as
 * whitespace; `false` for every other code point.
 */
function isTrimWhitespace(ch: number): boolean {
    return (
        (ch >= CHAR_TAB && ch <= CHAR_CARRIAGE_RETURN) || // \t \n \v \f \r
        ch === CHAR_SPACE || // space
        ch === CHAR_NO_BREAK_SPACE || // no-break space
        ch === CHAR_OGHAM_SPACE_MARK || // ogham space mark
        (ch >= CHAR_EN_QUAD && ch <= CHAR_HAIR_SPACE) || // en quad … hair space
        ch === CHAR_LINE_SEPARATOR || // line separator
        ch === CHAR_PARAGRAPH_SEPARATOR || // paragraph separator
        ch === CHAR_NARROW_NO_BREAK_SPACE || // narrow no-break space
        ch === CHAR_MEDIUM_MATHEMATICAL_SPACE || // medium mathematical space
        ch === CHAR_IDEOGRAPHIC_SPACE || // ideographic space
        ch === CHAR_ZERO_WIDTH_NO_BREAK_SPACE // zero-width no-break space
    );
}

/**
 * Count total lines and non-blank lines in a single pass over the input.
 *
 * Contract: `lines` is identical to `content.split(/\r\n|\n/).length` (only `\n` advances
 * the counter, so a lone `\r` neither starts nor ends a line), and `nonBlankLines` counts
 * lines whose ECMAScript `trim()` result is non-empty. Empty input yields
 * `{ lines: 1, nonBlankLines: 0 }`; the function never throws and never mutates its input.
 *
 * @param content - source text to measure; may be empty and is never mutated.
 * @returns the total line count and the number of lines that hold at least one non-blank
 * code point.
 */
export function countLineStats(content: string): { lines: number; nonBlankLines: number } {
    let lines = 1;
    let nonBlankLines = 0;
    let lineHasNonBlank = false;
    for (let i = 0; i < content.length; i++) {
        const ch = content.charCodeAt(i);
        if (ch === CHAR_LINE_FEED /* \n */) {
            if (lineHasNonBlank) nonBlankLines++;
            lines++;
            lineHasNonBlank = false;
            continue;
        }
        if (!lineHasNonBlank && !isTrimWhitespace(ch)) lineHasNonBlank = true;
    }
    if (lineHasNonBlank) nonBlankLines++;
    return { lines, nonBlankLines };
}
