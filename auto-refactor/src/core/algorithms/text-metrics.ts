/**
 * Module: Core Algorithms — Text Metrics & Syntactic Scanning Primitives
 * File Path: src/core/algorithms/text-metrics.ts
 * Architecture Role: High-throughput, zero-allocation syntactic text scanning primitives
 *   for indentation depth measurement, delimiter balance tracking, and line counting.
 * Dependencies & Triggers: Zero external runtime dependencies; pure charCode loops.
 * Responsibilities:
 *   1. Measure structural indentation level with customizable tab expansion (default 4);
 *   2. Compute net curly brace balance and detailed open/close counts;
 *   3. Count line boundaries in text streams without intermediate string splits.
 * Exit Semantics & Design Rationale: CC <= 8; pure functions; zero heap allocations;
 *   replaces redundant per-analyzer parsing loops.
 */

const DEFAULT_TAB_WIDTH = 4;
const CHAR_SPACE = 32;
const CHAR_TAB = 9;
const CHAR_OPEN_BRACE = 123;  // '{'
const CHAR_CLOSE_BRACE = 125; // '}'
const CHAR_LINE_FEED = 10;    // '\n'

/**
 * Detailed count of open and closed curly braces.
 */
export interface BraceBalance {
    /** Number of opening curly braces '{' */
    readonly opens: number;
    /** Number of closing curly braces '}' */
    readonly closes: number;
    /** Net delta (opens - closes) */
    readonly delta: number;
}

/**
 * Measures structural indentation depth of a single source line in indentation units.
 * Scans leading spaces and tabs; stops at the first non-whitespace character.
 *
 * @param line - Raw line text.
 * @param tabWidth - Spaces per tab character (default 4).
 * @returns Indentation depth level (0 for non-indented or empty lines).
 */
export function measureIndentationDepth(line: string, tabWidth: number = DEFAULT_TAB_WIDTH): number {
    if (!line || line.length === 0) return 0;
    const safeTabWidth = tabWidth > 0 ? tabWidth : DEFAULT_TAB_WIDTH;
    let visualSpaces = 0;

    for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        if (code === CHAR_SPACE) {
            visualSpaces++;
        } else if (code === CHAR_TAB) {
            visualSpaces += safeTabWidth;
        } else {
            break;
        }
    }

    return Math.floor(visualSpaces / safeTabWidth);
}

/**
 * Counts net change in curly brace depth within a text line (opens - closes).
 *
 * @param line - Text line to inspect.
 * @returns Net delta (e.g., +1 for one extra '{', -1 for one extra '}').
 */
export function countBraceDelta(line: string): number {
    if (!line || line.length === 0) return 0;
    let delta = 0;
    for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        if (code === CHAR_OPEN_BRACE) {
            delta++;
        } else if (code === CHAR_CLOSE_BRACE) {
            delta--;
        }
    }
    return delta;
}

/**
 * Counts opening and closing curly braces in a line with detailed breakdown.
 *
 * @param line - Text line to inspect.
 * @returns BraceBalance containing opens, closes, and delta.
 */
export function countBracesDetailed(line: string): BraceBalance {
    if (!line || line.length === 0) {
        return Object.freeze({ opens: 0, closes: 0, delta: 0 });
    }

    let opens = 0;
    let closes = 0;
    for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        if (code === CHAR_OPEN_BRACE) {
            opens++;
        } else if (code === CHAR_CLOSE_BRACE) {
            closes++;
        }
    }

    return Object.freeze({
        opens,
        closes,
        delta: opens - closes,
    });
}

/**
 * Counts physical newline characters in text in a single zero-allocation pass.
 *
 * @param text - Source text to inspect.
 * @returns Total physical lines (at least 1 for non-empty text, 0 for empty string).
 */
export function countStreamLines(text: string): number {
    if (!text || text.length === 0) return 0;
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === CHAR_LINE_FEED) {
            lines++;
        }
    }
    return lines;
}
