/**
 * Module: Core Guidance — Provider-Agnostic Token Estimator
 * File Path: src/core/guidance/token-estimate.ts
 * Architecture Role: Single source for the character-to-token heuristic shared by CAPP prompts,
 *   AAS presentation metrics, and any consumer that must budget agent context windows.
 * Dependencies & Triggers: Pure leaf with no imports; consumed by agentConstraintGenerator.ts and
 *   by presentation adapters that report token savings.
 * Responsibilities: Classify each character as a wide glyph (CJK, Hangul, Kana, fullwidth) or a
 *   narrow one, estimate tokens as wide count plus narrow count over the Latin ratio, keep the
 *   estimate at or above one token for non-empty input, and expose the JSON baseline a compact
 *   prompt replaces so savings claims stay verifiable rather than calibrated.
 * Exit Semantics & Design Rationale: Pure, allocation-light scan with no I/O and no exceptions. A
 *   single `CHARS_PER_TOKEN = 4` divisor under-reports CJK prompts about 3.5x on measured samples
 *   because most tokenizers emit one token per CJK glyph; classifying instead of assuming keeps
 *   reported savings truthful across locales while staying deterministic for equal inputs.
 */
/** Narrow (Latin/ASCII) characters that share one token with their neighbours. */
const NARROW_CHARS_PER_TOKEN = 4;
/** Inclusive code-point ranges whose glyphs each consume a full token. */
const WIDE_GLYPH_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x1100, 0x11ff], // Hangul Jamo
    [0x2e80, 0x303f], // CJK radicals, Kangxi, CJK punctuation
    [0x3040, 0x30ff], // Hiragana, Katakana
    [0x3400, 0x4dbf], // CJK Extension A
    [0x4e00, 0x9fff], // CJK Unified Ideographs
    [0xac00, 0xd7af], // Hangul Syllables
    [0xf900, 0xfaff], // CJK Compatibility Ideographs
    [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
];
/** True when one code point renders as a wide glyph for tokenizer purposes. */
function isWideGlyph(codePoint: number): boolean {
    for (let i = 0; i < WIDE_GLYPH_RANGES.length; i++) {
        const [from, to] = WIDE_GLYPH_RANGES[i];
        if (codePoint >= from && codePoint <= to) return true;
    }
    return false;
}
/** Estimates tokens for a prompt fragment: an upper bound on Latin text, close on CJK text. */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    let wideCount = 0;
    let narrowCount = 0;
    for (const glyph of text) {
        if (isWideGlyph(glyph.codePointAt(0) ?? 0)) {
            wideCount++;
        } else {
            narrowCount++;
        }
    }
    return Math.max(1, Math.ceil(wideCount + narrowCount / NARROW_CHARS_PER_TOKEN));
}
/** Measured byte weight of the JSON payload a compact prompt replaces. */
export function measureJsonBaseline(records: readonly unknown[]): number {
    if (records.length === 0) return 0;
    return JSON.stringify(records).length;
}
/** Estimates tokens for an ASCII JSON payload of the given length. */
export function estimateNarrowTokens(charCount: number): number {
    if (charCount <= 0) return 0;
    return Math.ceil(charCount / NARROW_CHARS_PER_TOKEN);
}
