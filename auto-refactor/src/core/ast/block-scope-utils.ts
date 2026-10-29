/**
 * Module: Core AST — Lexical Block & Scope Traversal Utilities
 * File Path: src/core/ast/block-scope-utils.ts
 * Architecture Role: High-performance, zero-allocation lexical helpers for indentation,
 *   brace pairing, comment/blank detection, and block boundary extraction across languages.
 * Dependencies & Triggers: Pure TypeScript string/array manipulation; consumed by
 *   simplify, rust-modern, block-fingerprint-cache, and delta classifiers.
 * Responsibilities: Compute indent width without regex allocation, find matching braces
 *   in line arrays and raw text, detect comment or blank lines across languages, and count
 *   meaningful statements.
 * Exit Semantics & Design Rationale: 100% pure functions; CC <= 15, Depth <= 4; no side
 *   effects; never throw on malformed input.
 */

const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_OPEN_BRACE = 123; // '{'
const CHAR_CLOSE_BRACE = 125; // '}'

const PREFIX_SLASH_SLASH = '//';
const PREFIX_HASH = '#';
const PREFIX_STAR = '*';
const PREFIX_BLOCK_COMMENT_START = '/*';

const BRACE_ONLY_LINE_PATTERN = /^[{}]+$/;

/**
 * Checks whether a line is empty or starts with a comment delimiter.
 * Supports C-family (//, /*, *), Python/Shell/GDScript (#).
 * Handles both trimmed and raw lines cleanly.
 *
 * @param line - Raw or trimmed source line.
 * @returns True when the line is empty or a pure comment line.
 */
export function isCommentOrBlankLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return (
        trimmed.startsWith(PREFIX_SLASH_SLASH) ||
        trimmed.startsWith(PREFIX_HASH) ||
        trimmed.startsWith(PREFIX_STAR) ||
        trimmed.startsWith(PREFIX_BLOCK_COMMENT_START)
    );
}

/**
 * Computes leading indentation column count without allocating RegExp match arrays.
 * Scans leading spaces (ASCII 32) and tabs (ASCII 9).
 *
 * @param lineText - Raw source code line.
 * @returns Leading whitespace character count.
 */
export function calculateIndentWidth(lineText: string): number {
    let indent = 0;
    while (
        indent < lineText.length &&
        (lineText.charCodeAt(indent) === CHAR_SPACE || lineText.charCodeAt(indent) === CHAR_TAB)
    ) {
        indent++;
    }
    return indent;
}

/**
 * Scans an array of lines forward from startIndex to find the line containing
 * the matching closing brace '}' at net depth 0.
 *
 * @param lines - Array of source code lines.
 * @param startIndex - Line index where opening block begins.
 * @returns 0-based line index of matching closing brace, or -1 if unclosed.
 */
export function findMatchingBraceInLines(lines: string[], startIndex: number): number {
    let depth = 0;
    let started = false;
    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        for (let charIndex = 0; charIndex < line.length; charIndex++) {
            const charCode = line.charCodeAt(charIndex);
            if (charCode === CHAR_OPEN_BRACE) {
                depth++;
                started = true;
            } else if (charCode === CHAR_CLOSE_BRACE && started) {
                depth--;
                if (depth === 0) return lineIndex;
            }
        }
    }
    return -1;
}

/**
 * Scans raw text forward from openBraceIndex to find the index of the matching closing brace.
 *
 * @param text - Full raw source text.
 * @param openBraceIndex - Character offset of the opening brace '{'.
 * @returns Character offset of matching '}', or -1 if unclosed.
 */
export function findMatchingBraceInText(text: string, openBraceIndex: number): number {
    let depth = 0;
    let started = false;
    const start = Math.max(0, openBraceIndex);
    for (let i = start; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === CHAR_OPEN_BRACE) {
            depth++;
            started = true;
        } else if (code === CHAR_CLOSE_BRACE && started) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/**
 * Advances lineIndex past blank and comment lines.
 *
 * @param lines - Array of source lines.
 * @param start - Starting line index.
 * @returns Next non-blank, non-comment line index, or lines.length if exhausted.
 */
export function advancePastBlanksAndComments(lines: string[], start: number): number {
    let lineIndex = start;
    while (lineIndex < lines.length && isCommentOrBlankLine(lines[lineIndex].trim())) {
        lineIndex++;
    }
    return lineIndex;
}

/**
 * Finds the last non-empty, non-comment, non-brace-only line in [start, end].
 *
 * @param lines - Array of source lines.
 * @param start - Starting line index (inclusive).
 * @param end - Ending line index (inclusive).
 * @returns Line index of last meaningful statement, or -1 if none found.
 */
export function findLastMeaningfulLine(lines: string[], start: number, end: number): number {
    for (let lineIndex = end; lineIndex >= start; lineIndex--) {
        const trimmed = lines[lineIndex].trim();
        if (isCommentOrBlankLine(trimmed) || BRACE_ONLY_LINE_PATTERN.test(trimmed)) continue;
        return lineIndex;
    }
    return -1;
}

/**
 * Counts logical non-comment statements in [start, end).
 *
 * @param lines - Array of source lines.
 * @param start - Starting line index (inclusive).
 * @param end - Ending line index (exclusive).
 * @returns Number of non-comment, non-brace-only lines.
 */
export function countMeaningfulStatements(lines: string[], start: number, end: number): number {
    let count = 0;
    for (let lineIndex = start; lineIndex < end; lineIndex++) {
        const trimmed = lines[lineIndex].trim();
        if (isCommentOrBlankLine(trimmed) || BRACE_ONLY_LINE_PATTERN.test(trimmed)) continue;
        count++;
    }
    return count;
}
