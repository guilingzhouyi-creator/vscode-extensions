/**
 * Module: Core Scanner — Shared Text Scanner Utilities
 * File Path: src/core/scanner/text-scanner-utils.ts
 * Architecture Role: Single source of truth (SSOT) utility predicates for polyglot text scanning.
 * Dependencies & Triggers: Consumed across analyzers, intelligence rules, and reporting pipelines.
 * Responsibilities:
 *   1. Determine whether a trimmed or untrimmed source line represents a comment in sources.
 *   2. Normalize and strip enclosing quotation marks (single, double, or template backticks).
 * Exit Semantics & Design Rationale: Pure string functions with zero side effects and zero
 *   allocations on non-matching strings, avoiding redundant regex engines or duplicated logic.
 */

/**
 * Checks whether a line of source code starts with comment delimiters across C-family, Shell,
 * and Python/GDScript.
 *
 * @param line - Raw or trimmed line string.
 * @returns True if the line starts with //, /*, *, or #.
 */
export function isCommentLine(line: string): boolean {
    if (!line) {
        return false;
    }
    const trimmed = line.trimStart();
    return (
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('#')
    );
}

function isQuoteCharCode(code: number): boolean {
    return code === 39 || code === 34 || code === 96; // ' " `
}

function isStringPrefixCharCode(code: number): boolean {
    return (
        code === 114 || code === 82 || // r, R
        code === 98 || code === 66 ||   // b, B
        code === 117 || code === 85 ||  // u, U
        code === 102 || code === 70     // f, F
    );
}

/**
 * Strips matching enclosing quotation marks (single, double, or backticks) from a literal string,
 * optionally stripping leading language prefixes (r, b, u, f).
 *
 * @param str - Source string possibly wrapped in quotes.
 * @returns Unquoted inner string content.
 */
export function stripQuotes(str: string): string {
    if (!str) {
        return '';
    }
    const len = str.length;
    let offset = 0;
    while (offset < len) {
        if (isStringPrefixCharCode(str.charCodeAt(offset))) {
            offset++;
        } else {
            break;
        }
    }
    const hasLeadingQuote = offset < len && isQuoteCharCode(str.charCodeAt(offset));
    const start = hasLeadingQuote ? offset + 1 : 0;
    const end = len > start && isQuoteCharCode(str.charCodeAt(len - 1)) ? len - 1 : len;
    return start > 0 || end < len ? str.slice(start, end) : str;
}
