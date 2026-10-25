/**
 * Module: Static Analysis — Hygiene Duplicate Block Detection Helper
 * File Path: src/analyzers/hygiene-clone-helper.ts
 * Architecture Role: Dedicated sub-module for hygiene analyzer auditing duplicate meaningful-line
 *   blocks using native acceleration with pure JavaScript 32-bit FNV-1a rolling hash fallback.
 * Dependencies & Triggers: Consumes AnalyzerContext, Issue, nativeCore and fnv1a32Signed;
 *   triggered by HygieneAnalyzer.analyze() when checkDuplicateBlocks is active.
 * Responsibilities:
 *   1. Delegate duplicate clone detection to native Rust kernel (nativeCore.detectCloneBlocks);
 *   2. Provide deterministic pure JS fallback when native bridge is unavailable or throws;
 *   3. Filter out blank lines, comments, and solitary braces;
 *   4. Emit HYG-CLN-001 issues with line span and original line references.
 * Exit Semantics & Design Rationale: CC <= 10; pure deterministic helper returning Issue records
 *   via createLineIssue without persistent state; catches native exceptions defensively.
 */

import type { AnalyzerContext, Issue } from '../core/types';
import { HygieneMessages } from '../core/messages';
import { nativeCore } from '../core/native';
import { fnv1a32Signed } from '../core/algorithms/hash';
import { createLineIssue } from '../core/rules/diagnostic-catalog';

const ANALYZER_HYGIENE = 'hygiene';
const SEVERITY_WARNING = 'warning' as const;

/** Default number of consecutive meaningful lines that counts as a duplicate block. */
export const DEFAULT_MIN_CLONE_LINES = 6;

/** Multiplier applied per meaningful line by the rolling clone-block hash. */
const CLONE_ROLLING_HASH_MULTIPLIER = 31;

/**
 * Defensive pure fallback utility computing 32-bit FNV-1a hashes of meaningful source lines
 * when native clone detection is unavailable or fails.
 *
 * @param content - Source file raw text.
 * @returns Object with lineHashes array and meaningfulLineIndices array.
 */
export function computeLineHashesFallback(content: string): {
    lineHashes: number[];
    meaningfulLineIndices: number[];
} {
    const lineHashes: number[] = [];
    const meaningfulLineIndices: number[] = [];
    const lines = content.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let rawLine = lines[lineIdx];
        if (rawLine.endsWith('\r')) {
            rawLine = rawLine.slice(0, -1);
        }
        const trimmed = rawLine.trim();
        if (
            trimmed &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('#') &&
            trimmed !== '{' &&
            trimmed !== '}'
        ) {
            lineHashes.push(fnv1a32Signed(trimmed));
            meaningfulLineIndices.push(lineIdx);
        }
    }

    return { lineHashes, meaningfulLineIndices };
}

/**
 * Pure JavaScript rolling-hash clone detector used as deterministic fallback.
 *
 * @param content - Raw source code content string.
 * @param minCloneLines - Minimum consecutive identical lines to trigger a clone issue.
 * @param ctx - Active analyzer execution context.
 * @param issues - Mutable target array for appending detected clone issues.
 */
export function detectClonesPureJs(
    content: string,
    minCloneLines: number,
    ctx: AnalyzerContext,
    issues: Issue[],
): void {
    const { lineHashes, meaningfulLineIndices } = computeLineHashesFallback(content);
    if (lineHashes.length < minCloneLines * 2) {
        return;
    }

    const blockMap = new Map<number, number>();
    const total = lineHashes.length;

    for (let i = 0; i <= total - minCloneLines; i++) {
        let hashValue = 0;
        for (let k = 0; k < minCloneLines; k++) {
            hashValue =
                (Math.imul(hashValue, CLONE_ROLLING_HASH_MULTIPLIER) + lineHashes[i + k]) | 0;
        }

        const prevLine = blockMap.get(hashValue);
        if (prevLine !== undefined && i >= prevLine + minCloneLines) {
            const actualStartLine = meaningfulLineIndices[i] + 1;
            const originalLine = meaningfulLineIndices[prevLine] + 1;
            const desc = HygieneMessages.DUPLICATE_CODE_CLONE(minCloneLines, originalLine);
            issues.push(
                createLineIssue(ANALYZER_HYGIENE, ctx.filePath, {
                    lineIdx: meaningfulLineIndices[i],
                    rule: 'HYG-CLN-001',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: {
                        startLine: actualStartLine,
                        originalLine,
                        lineSpan: minCloneLines,
                    },
                    suggestion: desc.suggestion,
                }),
            );
            break;
        }
        if (prevLine === undefined) {
            blockMap.set(hashValue, i);
        }
    }
}

/**
 * Audit duplicate code blocks across meaningful source lines using native kernel with JS fallback.
 *
 * @param content - Raw source code content string.
 * @param minCloneLines - Minimum consecutive identical lines to trigger a clone issue.
 * @param ctx - Active analyzer execution context.
 * @param issues - Mutable target array for appending detected clone issues.
 */
export function auditCloneBlocks(
    content: string,
    minCloneLines: number,
    ctx: AnalyzerContext,
    issues: Issue[],
): void {
    try {
        const clones = nativeCore.detectCloneBlocks(content, minCloneLines);
        if (clones && clones.length > 0) {
            const clone = clones[0];
            const desc = HygieneMessages.DUPLICATE_CODE_CLONE(clone.lineSpan, clone.originalLine);
            issues.push(
                createLineIssue(ANALYZER_HYGIENE, ctx.filePath, {
                    lineIdx: clone.startLine - 1,
                    rule: 'HYG-CLN-001',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: {
                        startLine: clone.startLine,
                        originalLine: clone.originalLine,
                        lineSpan: clone.lineSpan,
                    },
                    suggestion: desc.suggestion,
                }),
            );
            return;
        }
    } catch (_err) {
        void _err;
    }

    detectClonesPureJs(content, minCloneLines, ctx, issues);
}
