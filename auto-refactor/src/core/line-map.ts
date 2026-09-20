/**
 * Module: Core Engine — Incremental Position Mapping (ts-free pure logic)
 * File Path: src/core/line-map.ts
 * Architecture Role: Translation helper for the line-level incremental infrastructure
 *                    (docs/03-incremental-and-diff/01-line-level-incremental.md §3.2): maps old
 *                    line/byte positions onto new content across byte-level edits.
 * Dependencies & Triggers: Imports EditRange and computeLineStarts from ./editDiff; constructed
 *                    with (oldContent, newContent, edits) by callers needing position translation.
 * Responsibilities: Sort the edit ranges by start byte once in the constructor; mapLine() maps a
 *                    1-based old line to its 1-based new line; mapByte() maps an old byte offset
 *                    to its new offset; lineDeltaAt() reports the cumulative new-minus-old line
 *                    shift at a line; isUnchangedRange() reports whether a NEW-content byte range
 *                    overlaps no edit span.
 * Exit Semantics & Design Rationale: All methods are total and non-throwing; -1 is the explicit
 *                    deleted-position sentinel. INC-Mode-1 does not rely on line translation for
 *                    reuse (a subtree is reused only when its byte range is untouched), but
 *                    isUnchangedRange() is the byte-level form of that condition, exposed for
 *                    callers/validation. This module NEVER imports `typescript`.
 */

import type { EditRange } from './edit-diff';
import { computeLineStarts } from './edit-diff';

/**
 * Map positions in an old file revision onto a new revision after byte-level edits.
 *
 * The constructor snapshots line starts for both contents and sorts the edit ranges once by
 * start byte. Every mapping method is total, synchronous and non-throwing, using -1 as the
 * explicit sentinel for a position inside a deleted span. `isUnchangedRange` exposes the
 * INC-Mode-1 reuse condition at byte granularity: a range that overlaps no edit has identical
 * bytes and identical positions in both revisions. This module never imports `typescript`.
 */
export class LineMap {
    private readonly oldStarts: number[];
    private readonly newStarts: number[];
    private readonly edits: EditRange[];

    /**
     * Build the mapper from both contents and the byte-level edit list.
     *
     * @param oldContent - Full content before the edits; only read to snapshot line starts.
     * @param newContent - Full content after the edits; only read to snapshot line starts.
     * @param edits - Edit ranges to map across; the caller's array is copied and sorted by
     *                `startByte` so mapping methods can stop scanning early.
     */
    constructor(oldContent: string, newContent: string, edits: EditRange[]) {
        this.oldStarts = computeLineStarts(oldContent);
        this.newStarts = computeLineStarts(newContent);
        this.edits = [...edits].sort((a, b) => a.startByte - b.startByte);
    }

    /**
     * Map a 1-based OLD line number to its 1-based NEW line number.
     *
     * @param oldLine - 1-based line in the old content; translated by the net delta of every
     *                  edit that starts at or before it.
     * @returns The matching 1-based line in the new content, or -1 when `oldLine` falls inside
     *          a deleted span.
     */
    mapLine(oldLine: number): number {
        let delta = 0;
        for (const e of this.edits) {
            if (oldLine < e.startLine) break; // this line sits before every remaining edit
            if (oldLine <= e.oldEndLine) return -1; // inside a deleted span
            delta += e.newEndLine - e.startLine + 1 - (e.oldEndLine - e.startLine + 1);
        }
        return oldLine + delta;
    }

    /**
     * Map an OLD byte offset to its NEW byte offset.
     *
     * @param oldByte - 0-based byte offset in the old content.
     * @returns The matching 0-based byte offset in the new content, or -1 when `oldByte` falls
     *          inside a deleted span.
     */
    mapByte(oldByte: number): number {
        let delta = 0;
        for (const e of this.edits) {
            if (oldByte < e.startByte) break;
            if (oldByte < e.oldEndByte) return -1;
            delta += e.newEndByte - e.startByte - (e.oldEndByte - e.startByte);
        }
        return oldByte + delta;
    }

    /**
     * Compute the cumulative new-minus-old line shift contributed by edits at or above a line.
     *
     * @param line - 1-based old line that bounds which edits are included in the sum.
     * @returns Positive when net lines were inserted, negative when net lines were removed, and
     *          0 when no qualifying edit changed the line count.
     */
    lineDeltaAt(line: number): number {
        let delta = 0;
        for (const e of this.edits) {
            if (e.startLine > line) break;
            delta += e.newEndLine - e.startLine + 1 - (e.oldEndLine - e.startLine + 1);
        }
        return delta;
    }

    /**
     * Test whether a NEW-content byte range overlaps no edit span.
     *
     * This is the INC-Mode-1 reuse condition expressed at byte granularity: an untouched range
     * has identical bytes and identical positions in old and new content.
     *
     * @param startByte - Inclusive start offset of the range in the new content.
     * @param endByte - Exclusive end offset of the range in the new content.
     * @returns True when no edit intersects the half-open range, so the range is reusable;
     *          false on any overlap.
     */
    isUnchangedRange(startByte: number, endByte: number): boolean {
        for (const e of this.edits) {
            if (e.newEndByte <= startByte) continue; // edit entirely before the range
            if (e.startByte >= endByte) break; // edits are sorted; the rest are after the range
            return false; // overlap
        }
        return true;
    }
}
