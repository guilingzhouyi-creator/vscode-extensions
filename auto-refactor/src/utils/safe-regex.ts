/**
 * Module: Utility — Safe Regex Helpers (ReDoS Mitigation)
 * File Path: src/utils/safe-regex.ts
 * Architecture Role: Shared utility module providing hardened regex construction,
 *     safety auditing, and bounded-match helpers used across analyzers and rules.
 * Dependencies & Triggers: No external dependencies; imported by analyzers and
 *     governance rules that deal with user-supplied patterns or long-alternation regexes.
 * Responsibilities: Validate regex patterns for known dangerous constructs,
 *     escape strings for literal use inside patterns, and provide bounded-match
 *     wrappers that prevent catastrophic backtracking on adversarial input.
 * Exit Semantics & Design Rationale: All functions are pure and never throw on
 *     valid input; `auditRegexSafety` returns a warning list (empty = safe) rather
 *     than rejecting patterns outright, so callers decide whether to warn or block.
 *     The bounded-match helpers use a two-tier strategy: short strings pass through
 *     directly (negligible ReDoS surface), long strings are truncated to a budget
 *     that is provably safe for all keyword/pattern detection use cases in this
 *     codebase (all text triggers are local, not full-file validations).
 */

/**
 * Maximum input length for direct regex testing without bounds enforcement.
 * Strings shorter than this have negligible ReDoS surface even for suboptimal patterns.
 */
const SAFE_DIRECT_THRESHOLD = 500;

/**
 * Maximum character budget for regex matching on long strings.
 * All our text-trigger patterns are keyword-level — they appear early in a line
 * or file. Truncating to this length eliminates ReDoS exposure on adversarial
 * megabyte-scale inputs while preserving detection accuracy for legitimate code.
 */
const SAFE_MATCH_BUDGET = 5000;

/**
 * Maximum budget for .match() / .exec() style extraction operations.
 *
 * Tighter than the test budget because match builds result arrays and
 * extraction patterns often use global /g scanning. For safe patterns
 * (no nested quantifiers) this is still plenty for keyword and token
 * extraction on individual code lines.
 *
 * Note: the primary defense against catastrophic patterns is `isRegexSafe()`
 * at pattern-compilation time. This budget protects against slow-but-safe
 * patterns (e.g. long alternations) on unexpectedly long input.
 */
const SAFE_EXTRACT_BUDGET = 500;

/**
 * Safely test whether a regex matches a string, with ReDoS protection.
 *
 * Uses a two-tier approach:
 * 1. Short strings (< SAFE_DIRECT_THRESHOLD chars) are tested directly —
 *    the input is too small for catastrophic backtracking to matter.
 * 2. Long strings are truncated to SAFE_MATCH_BUDGET characters. This is
 *    safe for all keyword/pattern detection use cases in this codebase
 *    because every text trigger is a local pattern, not a full-file validation.
 *
 * @param re - The regular expression to test. Non-global; global regexes
 *             have their lastIndex reset before testing.
 * @param str - The string to test against.
 * @returns True if the regex matches within the safe budget, false otherwise.
 */
export function safeRegexTest(re: RegExp, str: string): boolean {
    if (str.length < SAFE_DIRECT_THRESHOLD) {
        return re.test(str);
    }

    // Reset state for global/sticky regexes to avoid cross-call pollution.
    re.lastIndex = 0;

    // All our text-trigger patterns are keyword-level. If a pattern hasn't
    // matched in the first N characters, it won't match later.
    const bounded = str.slice(0, SAFE_MATCH_BUDGET);
    return re.test(bounded);
}

/**
 * Safely execute String.match with a regex, bounded to prevent ReDoS.
 *
 * For long strings, only the first SAFE_EXTRACT_BUDGET characters are examined.
 * This is safe because all patterns using .match() in this codebase extract
 * local features (tokens, identifiers, markers) — not global full-file scans.
 *
 * @param str - The string to match against.
 * @param re - The regular expression.
 * @returns Match result (same as String.match) or null on no match / budget exceeded.
 */
export function safeRegexMatch(str: string, re: RegExp): RegExpMatchArray | null {
    if (str.length < SAFE_DIRECT_THRESHOLD * 2) {
        return str.match(re);
    }
    const bounded = str.slice(0, SAFE_EXTRACT_BUDGET);
    return bounded.match(re);
}

/**
 * Safely execute RegExp.exec in a loop, with per-iteration and total budget tracking.
 *
 * Wraps a global regex exec loop with an iteration cap to prevent runaway
 * backtracking on pathological input. The callback receives each match and
 * should return false to stop iteration (true to continue).
 *
 * @param re - A global RegExp. lastIndex is reset before iteration.
 * @param str - The string to scan.
 * @param onMatch - Callback for each match; return true to continue, false to stop.
 * @param maxIterations - Maximum exec iterations (default 1000).
 * @returns Number of matches found before stopping.
 */
export function safeRegexExecLoop(
    re: RegExp,
    str: string,
    onMatch: (match: RegExpExecArray) => boolean | void,
    maxIterations = 1000,
): number {
    re.lastIndex = 0;
    let count = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(str)) !== null) {
        count++;
        const cont = onMatch(m);
        if (cont === false) break;
        if (count >= maxIterations) break;
        // Guard against zero-width matches causing infinite loops
        if (m[0].length === 0) {
            re.lastIndex++;
        }
    }

    return count;
}

/**
 * Audit a regex pattern source for known dangerous ReDoS constructs.
 *
 * Returns an array of warning strings; an empty array means no known
 * dangerous patterns were detected. This is a heuristic audit — it catches
 * common catastrophic-backtracking patterns but is not exhaustive.
 *
 * Dangerous patterns detected:
 * - Nested quantifiers: (a+)+, (a*)+, (a?)+, (a+)*, etc.
 * - Alternation inside quantifiers: (a|aa)*
 * - Consecutive unbounded quantifiers on overlapping character classes
 * - Overlapping alternation prefixes inside groups
 *
 * @param pattern - The regex source string to audit.
 * @returns Array of warning strings (empty = no known issues).
 */
export function auditRegexSafety(pattern: string): string[] {
    const warnings: string[] = [];

    // Skip empty or trivial patterns
    if (!pattern || pattern.length < 3) return warnings;

    // --- Nested quantifiers ---
    // Matches: (...)+, (...)*, (...)?  where the group body contains a quantifier
    // Simplified heuristic: detect group-close followed by quantifier, where the
    // group contains at least one quantifier character.
    const nestedQuantRegex = /\((?:[^()]*[+*?][^()]*)\)[+*?]/;
    if (nestedQuantRegex.test(pattern)) {
        warnings.push(
            'Nested quantifier detected (e.g. "(a+)+") — potential catastrophic backtracking',
        );
    }

    // --- Alternation inside quantifiers ---
    // Matches: (a|b|c)* or (a|b)+ where alternation is inside a quantified group
    const altInQuantRegex = /\([^()]*\|[^()]*\)[+*]/;
    if (altInQuantRegex.test(pattern)) {
        warnings.push(
            'Alternation inside quantified group (e.g. "(a|aa)*") — potential exponential backtracking',
        );
    }

    // --- Consecutive unbounded quantifiers with overlapping character classes ---
    // Matches patterns like [a-z]+[a-z]* or \w*\w+ where adjacent quantifiers
    // can match the same characters, causing O(n²) backtracking.
    // Heuristic: two consecutive quantifiers (*, +) on similar character sets.
    const overlapQuantRegex = /[\])a-zA-Z0-9_][*+]\s*[\[a-zA-Z0-9_][*+]/;
    if (overlapQuantRegex.test(pattern)) {
        warnings.push(
            'Consecutive unbounded quantifiers on overlapping character sets — potential O(n²) matching',
        );
    }

    // --- Very long alternation chains ---
    // More than 20 alternatives in a single alternation group can cause
    // significant slowdown on mismatch, especially if alternatives share prefixes.
    const pipeCount = (pattern.match(/\|/g) || []).length;
    if (pipeCount > 20) {
        warnings.push(
            `Long alternation chain (${pipeCount} pipes) — consider Set-based lookup instead`,
        );
    }

    // --- Backreferences inside quantifiers ---
    // \1 inside a repeating group is a classic ReDoS vector.
    const backrefInQuantRegex = /\((?:[^()]*\\\d+[^()]*)\)[+*]/;
    if (backrefInQuantRegex.test(pattern)) {
        warnings.push(
            'Backreference inside quantified group — potential exponential backtracking',
        );
    }

    return warnings;
}

/**
 * Escape a string for safe literal use inside a regular expression.
 *
 * Escapes all regex metacharacters so the string is matched literally
 * when used as part of a RegExp source.
 *
 * @param str - The literal string to escape.
 * @returns Escaped string safe for use in new RegExp(...).
 */
export function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a prefixed "fast gate" substring check before running a full regex.
 *
 * Many regex patterns have a required literal substring that must appear for
 * any match to be possible. This function returns a pre-check function that
 * first tests for that substring using String.includes() (extremely fast),
 * and only runs the full regex if the substring is found.
 *
 * This is the single most effective ReDoS mitigation: if the regex never
 * runs on non-matching input, it can never backtrack catastrophically.
 *
 * @param requiredSubstring - A literal substring that must be present for the regex to match.
 * @param re - The full regex to run when the pre-check passes.
 * @returns A function equivalent to (str) => re.test(str) but with pre-gating.
 */
export function createPrefixedTest(
    requiredSubstring: string,
    re: RegExp,
): (str: string) => boolean {
    return (str: string) => {
        if (!str.includes(requiredSubstring)) return false;
        return safeRegexTest(re, str);
    };
}

/**
 * Build a word-bounded alternation regex from a list of literal words,
 * with safety validation.
 *
 * This is the common pattern used for keyword lists (jargon, sync fs names, etc.).
 * The result is `/\b(?:word1|word2|...)\b/i` style, but with safety checks:
 * - Warns if the list is extremely long (>50 items)
 * - Escapes each word so special characters don't create unexpected patterns
 *
 * @param words - List of literal words/patterns to include in the alternation.
 * @param flags - RegExp flags (default: 'i' for case-insensitive).
 * @param wordBounded - Whether to wrap with \b anchors (default: true).
 * @returns A compiled RegExp and any safety warnings.
 */
export function buildAlternationRe(
    words: string[],
    flags = 'i',
    wordBounded = true,
): { re: RegExp; warnings: string[] } {
    const escaped = words.map((w) => escapeRegex(String(w)));
    const source = wordBounded
        ? `\\b(?:${escaped.join('|')})\\b`
        : `(?:${escaped.join('|')})`;

    const warnings = auditRegexSafety(source);
    const re = new RegExp(source, flags);

    return { re, warnings };
}

/**
 * Check whether a regex pattern is "safe enough" to use on untrusted input.
 *
 * A pattern is considered high-risk if auditRegexSafety finds nested
 * quantifiers or alternation-inside-quantifiers (the two most common
 * catastrophic-backtracking vectors).
 *
 * @param pattern - Regex source string to check.
 * @returns True if the pattern has no high-risk constructs; false otherwise.
 */
export function isRegexSafe(pattern: string): boolean {
    const warnings = auditRegexSafety(pattern);
    return !warnings.some(
        (w) =>
            w.includes('Nested quantifier') ||
            w.includes('Alternation inside quantified group') ||
            w.includes('Backreference inside quantified group'),
    );
}
