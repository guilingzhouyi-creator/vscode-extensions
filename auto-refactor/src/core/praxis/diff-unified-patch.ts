/**
 * Module: Core Engine — Praxis Unified Patch and Diff Formatting Engine
 * File Path: src/core/praxis/diff-unified-patch.ts
 * Architecture Role: Pure algorithmic formatter producing standard git apply compatible
 *   Unified Diff and Patch representations from raw contents or ReviewDiffHunks.
 * Dependencies & Triggers: Consumes ReviewDiffHunk from ./contracts; consumes computeDetailedHunks
 *   from ../diff/edit-diff.
 * Responsibilities:
 *   1. Format standard git apply compatible unified diffs from old and new text buffers;
 *   2. Serialize ReviewDiffHunks into deterministic machine-actionable unified patches;
 *   3. Support file creation (/dev/null), deletion, and modification header conventions.
 * Exit Semantics & Design Rationale: Pure deterministic formatting with zero disk I/O;
 *   linear memory consumption proportional to diff line count.
 */

import type { ReviewDiffHunk } from './contracts';
import { computeDetailedHunks } from '../diff/edit-diff';

/**
 * Normalizes file path to forward slashes for cross-platform unified diffs.
 *
 * @param rawPath - Raw file path.
 * @returns Normalized forward-slash path string.
 */
export function normalizePath(rawPath?: string): string {
    return (rawPath || 'unknown').replace(/\\/g, '/');
}

/**
 * Format a single attributed line with diff prefix character.
 */
function formatPatchLine(type: string, content: string): string {
    if (type === 'delete') {
        return `-${content}`;
    }
    if (type === 'insert') {
        return `+${content}`;
    }
    return ` ${content}`;
}

/**
 * Resolves hunk header line with optional AST symbol attribution.
 */
function resolveHunkHeader(hunk: ReviewDiffHunk): string {
    const symbol = hunk.astContext?.enclosingSymbol;
    if (!symbol) {
        return hunk.header;
    }
    if (hunk.header.indexOf(symbol) !== -1) {
        return hunk.header;
    }
    return `${hunk.header} ${symbol}`;
}

/**
 * Assembles unified patch lines from hunks into git apply compatible patch text.
 *
 * @param hunks - Review diff hunks.
 * @param normalizedPath - Normalized file path.
 * @returns Formatted unified patch text.
 */
export function renderHunksToUnifiedPatch(hunks: ReviewDiffHunk[], normalizedPath: string): string {
    if (!hunks || hunks.length === 0) {
        return '';
    }
    const patchLines: string[] = [`--- a/${normalizedPath}`, `+++ b/${normalizedPath}`];

    for (const hunk of hunks) {
        patchLines.push(resolveHunkHeader(hunk));
        for (const line of hunk.lines) {
            patchLines.push(formatPatchLine(line.type, line.content));
        }
    }

    return `${patchLines.join('\n')}\n`;
}

/**
 * Formats a standard git apply compatible unified diff string from old and new text.
 *
 * @param oldContent - Content before change.
 * @param newContent - Content after change.
 * @param filePath - Target file path.
 * @returns Unified diff text compatible with git apply.
 */
export function formatUnifiedDiff(
    oldContent: string,
    newContent: string,
    filePath?: string,
): string {
    if (oldContent === newContent) {
        return '';
    }
    const normalizedPath = normalizePath(filePath);

    if (oldContent.length === 0) {
        const newLines = newContent.split(/\r?\n/);
        const header = `--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${newLines.length} @@\n`;
        const body = newLines.map((line) => `+${line}`).join('\n');
        return `${header}${body}\n`;
    }

    if (newContent.length === 0) {
        const oldLines = oldContent.split(/\r?\n/);
        const header = `--- a/${normalizedPath}\n+++ /dev/null\n@@ -1,${oldLines.length} +0,0 @@\n`;
        const body = oldLines.map((line) => `-${line}`).join('\n');
        return `${header}${body}\n`;
    }

    const hunks = computeDetailedHunks(oldContent, newContent);
    if (hunks.length === 0) {
        return '';
    }

    return renderHunksToUnifiedPatch(hunks, normalizedPath);
}

/**
 * Generates standard git apply compatible or Agent-actionable unified patch text from hunks.
 *
 * @param hunks - Review diff hunks.
 * @param filePath - Target file path.
 * @returns Complete unified patch text.
 */
export function toAgentUnifiedPatch(hunks: ReviewDiffHunk[], filePath?: string): string {
    if (!hunks || hunks.length === 0) {
        return '';
    }
    const normalizedPath = normalizePath(filePath);
    return renderHunksToUnifiedPatch(hunks, normalizedPath);
}
