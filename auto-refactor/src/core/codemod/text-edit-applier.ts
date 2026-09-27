/**
 * Module: Core Codemod — Transactional Text Edit Applier
 * File Path: src/core/codemod/text-edit-applier.ts
 * Architecture Role: Applies non-overlapping TextEdits to file content with atomic semantics.
 * Dependencies & Triggers: Consumed by PatchEngine for in-memory patch synthesis and verification.
 * Responsibilities: Map 1-indexed line/column to byte offsets and apply sorted reverse edits.
 * Exit Semantics & Design Rationale: Atomic in-memory execution; invalid or
 *   conflicting ranges rejected.
 */

import type { TextEdit } from './types';

/**
 * Internal representation of a text edit with precomputed character offsets.
 */
interface OffsetEdit {
    readonly startOffset: number;
    readonly endOffset: number;
    readonly newText: string;
    readonly originalEdit: TextEdit;
}

/**
 * Result of applying text edits to a source string.
 */
export interface ApplyEditsResult {
    /** Resulting patched source text. */
    readonly content: string;
    /** Number of non-overlapping edits successfully applied. */
    readonly appliedCount: number;
    /** Number of conflicting edits omitted. */
    readonly skippedCount: number;
}

/**
 * Transactional manager for applying textual replacements to source code.
 */
export class TextEditApplier {
    /**
     * Converts 1-indexed line and column coordinates into 0-indexed character offset.
     *
     * @param lineOffsets - Array mapping each 0-indexed line index
     *   to its starting character offset.
     * @param line - 1-indexed line number.
     * @param col - 1-indexed column number.
     * @param textLength - Total length of the source string.
     * @returns 0-indexed character offset clamped within text boundaries.
     */
    public static coordinateToOffset(
        lineOffsets: readonly number[],
        line: number,
        col: number,
        textLength: number,
    ): number {
        const lineIdx = Math.max(0, Math.min(line - 1, lineOffsets.length - 1));
        const lineStart = lineOffsets[lineIdx];
        const nextLineStart =
            lineIdx + 1 < lineOffsets.length ? lineOffsets[lineIdx + 1] : textLength;
        const lineLength = nextLineStart - lineStart;
        const colOffset = Math.max(0, Math.min(col - 1, lineLength));
        return Math.min(lineStart + colOffset, textLength);
    }

    /**
     * Builds an array of character offsets where each index represents the start of a line.
     *
     * @param source - Original source code string.
     * @returns Array of starting character offsets for each line.
     */
    public static buildLineOffsets(source: string): number[] {
        const offsets = [0];
        for (let i = 0; i < source.length; i++) {
            if (source[i] === '\n') {
                offsets.push(i + 1);
            }
        }
        return offsets;
    }

    /**
     * Applies an array of text edits to a source string safely without offset drift.
     * Overlapping edits are filtered out, favoring the earlier occurring edit.
     *
     * @param source - Original source code string.
     * @param edits - List of textual replacements to apply.
     * @returns Result containing transformed text and application statistics.
     */
    public static applyEdits(source: string, edits: readonly TextEdit[]): ApplyEditsResult {
        if (edits.length === 0) {
            return { content: source, appliedCount: 0, skippedCount: 0 };
        }

        const lineOffsets = TextEditApplier.buildLineOffsets(source);
        const offsetEdits: OffsetEdit[] = edits.map((edit) => {
            const startOffset = TextEditApplier.coordinateToOffset(
                lineOffsets,
                edit.startLine,
                edit.startCol,
                source.length,
            );
            const endOffset = TextEditApplier.coordinateToOffset(
                lineOffsets,
                edit.endLine,
                edit.endCol,
                source.length,
            );
            return {
                startOffset: Math.min(startOffset, endOffset),
                endOffset: Math.max(startOffset, endOffset),
                newText: edit.newText,
                originalEdit: edit,
            };
        });

        // Sort ascending by startOffset, then descending by endOffset
        offsetEdits.sort((a, b) => {
            if (a.startOffset !== b.startOffset) {
                return a.startOffset - b.startOffset;
            }
            return b.endOffset - a.endOffset;
        });

        const validEdits: OffsetEdit[] = [];
        let skippedCount = 0;
        let lastEnd = -1;

        for (const edit of offsetEdits) {
            if (edit.startOffset < lastEnd) {
                // Conflict detected: overlapping edit range
                skippedCount++;
                continue;
            }
            validEdits.push(edit);
            lastEnd = edit.endOffset;
        }

        // Apply edits in reverse order (descending startOffset) to maintain offset validity
        validEdits.sort((a, b) => b.startOffset - a.startOffset);

        let result = source;
        for (const edit of validEdits) {
            result =
                result.slice(0, edit.startOffset) + edit.newText + result.slice(edit.endOffset);
        }

        return {
            content: result,
            appliedCount: validEdits.length,
            skippedCount,
        };
    }
}
