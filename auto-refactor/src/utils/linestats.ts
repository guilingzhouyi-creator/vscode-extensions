/**
 * Pure line-statistics helpers (NO TypeScript dependency).
 *
 * Extracted from utils/ast.ts so worker threads can count lines without pulling in
 * the `typescript` module. This file must NEVER import `typescript` (or any module
 * that does) — it sits on the hot worker path for every parser.
 */

/**
 * P0-3: single-pass line statistics, computed ONCE per file and shared by every consumer
 * (FileMetricCollector + large-file analyzer) — replacing 2–3 whole-string `split` calls
 * plus intermediate line arrays per file.
 *
 * Semantics are byte-identical to the previous implementation:
 *   - `lines`        == `content.split(/\r\n|\n/).length`  (i.e. 1 + number of `\n`)
 *   - `nonBlankLines` == lines whose `trim()` result is non-empty
 *
 * The whitespace predicate below is EXACTLY the set ECMAScript `String.prototype.trim`
 * removes (WhiteSpace + LineTerminator): U+0009–U+000D, U+0020, U+00A0, U+1680,
 * U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Note that U+2028/U+2029
 * are trim-whitespace but NOT `\n`, so they do not increment `lines` (matching split).
 */
function isTrimWhitespace(ch: number): boolean {
  return (
    (ch >= 0x09 && ch <= 0x0d) || // \t \n \v \f \r
    ch === 0x20 || // space
    ch === 0xa0 || // no-break space
    ch === 0x1680 || // ogham space mark
    (ch >= 0x2000 && ch <= 0x200a) || // en quad … hair space
    ch === 0x2028 || // line separator
    ch === 0x2029 || // paragraph separator
    ch === 0x202f || // narrow no-break space
    ch === 0x205f || // medium mathematical space
    ch === 0x3000 || // ideographic space
    ch === 0xfeff // zero-width no-break space
  );
}

export function countLineStats(content: string): { lines: number; nonBlankLines: number } {
  let lines = 1;
  let nonBlankLines = 0;
  let lineHasNonBlank = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    if (ch === 0x0a /* \n */) {
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
