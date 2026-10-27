/**
 * Module: Core Engine — Native Fast Pattern Matching Shim
 * File Path: src/core/native/native-pattern-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of fast multi-pattern textual scanner.
 * Dependencies & Triggers: Consumes ./native-types; delegated by ./native-bridge.
 * Responsibilities:
 *   1. Match multiple sub-string patterns against line-based source code;
 *   2. Accurately report 1-based line number and 1-based column offset;
 *   3. Enforce deterministic line-and-column sorting for multi-pattern results.
 * Exit Semantics & Design Rationale: CC <= 6; pure functions; zero regex overhead;
 *   mirrors Rust ops-pattern multi-pattern scan.
 */

import type { NativePatternMatch } from './native-types';

function isPatternMatchAt(
    line: string,
    pattern: string,
    offset: number,
    patternLen: number,
): boolean {
    for (let patternIdx = 0; patternIdx < patternLen; patternIdx++) {
        if (line.charCodeAt(offset + patternIdx) !== pattern.charCodeAt(patternIdx)) {
            return false;
        }
    }
    return true;
}

function findPatternMatchesInLine(
    line: string,
    pattern: string,
    lineNum: number,
    results: NativePatternMatch[],
): void {
    const patternLen = pattern.length;
    const maxStart = line.length - patternLen;
    if (patternLen === 0 || maxStart < 0) {
        return;
    }

    const step = Math.max(1, patternLen);
    let colIdx = 0;
    while (colIdx <= maxStart) {
        if (isPatternMatchAt(line, pattern, colIdx, patternLen)) {
            results.push({
                pattern,
                line: lineNum,
                column: colIdx + 1,
                matchText: pattern,
            });
            colIdx += step;
        } else {
            colIdx++;
        }
    }
}

/**
 * Fast multi-pattern textual scanner locating occurrences with 1-based line and column.
 *
 * @param sourceText - Target source code to search.
 * @param patterns - Pattern strings to locate.
 * @returns Sorted array of NativePatternMatch occurrences.
 */
export function fastPatternMatchShim(sourceText: string, patterns: string[]): NativePatternMatch[] {
    const results: NativePatternMatch[] = [];
    if (!sourceText || patterns.length === 0) {
        return results;
    }

    const lines = sourceText.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineNum = lineIndex + 1;
        for (const pattern of patterns) {
            findPatternMatchesInLine(line, pattern, lineNum, results);
        }
    }

    if (patterns.length > 1) {
        results.sort(
            (firstMatch, secondMatch) =>
                firstMatch.line - secondMatch.line || firstMatch.column - secondMatch.column,
        );
    }

    return results;
}
