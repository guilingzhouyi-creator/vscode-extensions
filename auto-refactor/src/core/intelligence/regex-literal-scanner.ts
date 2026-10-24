/**
 * Module: Core Intelligence — Regex Literal Boundary Scanner
 * File Path: src/core/intelligence/regex-literal-scanner.ts
 * Architecture Role: Lexical helper for the tokenizer. Resolves the one genuine ambiguity in a
 *   JavaScript-family token stream — a `/` that may divide or may open a regular-expression
 *   literal — and reports where such a literal ends.
 * Dependencies & Triggers: Pure functions over the source string plus the current match; called by
 *   tokenizeCode in ./token-entropy on every `/` operator it encounters.
 * Responsibilities:
 *   1. Decide from the preceding token whether a `/` can only begin a literal;
 *   2. Scan the literal body across escapes and character classes to its closing slash;
 *   3. Consume trailing flag letters so the caller resumes at the right offset;
 *   4. Decline (return null / -1) whenever the candidate does not close on the same line.
 * Exit Semantics & Design Rationale: Total functions with no allocation beyond the returned slice.
 *   A literal can never contain a raw line terminator, so an unclosed candidate is reported as a
 *   plain division operator instead of swallowing the rest of the file — the failure mode that
 *   previously collapsed token density across whole modules.
 */

/**
 * Tokens after which a `/` opens a regex literal instead of dividing.
 *
 * A `/` is ambiguous: `total / count` divides, while `= /ab+/` starts a literal. The language
 * disambiguates on the preceding token — after an operator, an opening bracket, a comma, a colon,
 * or a keyword that expects an expression, a `/` can only begin a literal. Identifiers, numbers,
 * `)`, `]` and `}` all end an expression, so a `/` there divides.
 */
export const REGEX_PRECEDING_TOKENS: ReadonlySet<string> = new Set<string>([
    '=',
    '(',
    '[',
    '{',
    ',',
    ':',
    ';',
    '!',
    '&&',
    '||',
    '?',
    '??',
    '=>',
    'return',
    'typeof',
    'case',
    'in',
    'of',
    'new',
    'delete',
    'void',
    'do',
    'else',
    'yield',
    'await',
]);

/** Single-character escapes and character classes both hide a slash from the closing test. */
const ESCAPE_CHAR = '\\';
const CLASS_OPEN = '[';
const CLASS_CLOSE = ']';
const SLASH = '/';
const LINE_BREAK = '\n';

/** Flag letters that may follow a closing slash (`g`, `im`, `u`, ...). */
const FLAG_LETTER_RE = /[a-z]/i;

/**
 * Skip the flag letters that may follow a regex literal's closing slash.
 *
 * @param content Source text being tokenized.
 * @param start Index of the first character after the closing `/`.
 * @returns Index of the first character that is not a flag letter.
 */
function skipRegexFlags(content: string, start: number): number {
    let index = start;
    while (index < content.length && FLAG_LETTER_RE.test(content[index])) index++;
    return index;
}

/**
 * Find where a regex literal that starts at `start` ends.
 *
 * Written as a flat loop with guard clauses: every branch either advances the cursor or returns, so
 * the nesting the reader sees is one level deep regardless of how many character classes appear.
 *
 * @param content Source text being tokenized.
 * @param start Index of the opening `/`.
 * @returns Index just past the closing `/` plus flags, or -1 when no literal closes on this line.
 */
export function scanRegexLiteralEnd(content: string, start: number): number {
    let index = start + 1;
    let inCharacterClass = false;
    while (index < content.length) {
        const char = content[index];
        if (char === LINE_BREAK) return -1;
        if (char === ESCAPE_CHAR) {
            index += 2;
            continue;
        }
        if (char === CLASS_OPEN && !inCharacterClass) {
            inCharacterClass = true;
        } else if (char === CLASS_CLOSE && inCharacterClass) {
            inCharacterClass = false;
        } else if (char === SLASH && !inCharacterClass) {
            return skipRegexFlags(content, index + 1);
        }
        index++;
    }
    return -1;
}

/**
 * Resolve a matched `/` operator into a whole regex literal when the position allows one.
 *
 * Without this branch a literal such as `/['"]+/` is read as an operator followed by a string, and
 * that string only closes at the next quote — kilobytes away. The scan then swallows the rest of
 * the file into one token, which collapses `tau` and every density index derived from it.
 *
 * @param content Source text being tokenized.
 * @param match Match produced by the caller's token regex.
 * @param previousToken Last emitted token, used for the division-versus-literal disambiguation.
 * @returns The literal text, or null when the `/` really is a division operator.
 */
export function readRegexLiteral(
    content: string,
    match: RegExpExecArray,
    previousToken: string,
): string | null {
    if (match[0] !== SLASH || !REGEX_PRECEDING_TOKENS.has(previousToken)) return null;
    const end = scanRegexLiteralEnd(content, match.index);
    return end < 0 ? null : content.slice(match.index, end);
}
