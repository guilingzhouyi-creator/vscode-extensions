/**
 * Module: Core Engine — Edit Range Boundary Validation & Extraction
 * File Path: src/core/diff/edit-range-validator.ts
 * Architecture Role: Boundary, coordinate validation, and contiguous edit-range extraction
 *   engine for LSP-style edit ranges, asserting 1-based line bounds and byte offsets.
 * Dependencies & Triggers: Consumed by edit-diff during incremental and diff range processing.
 * Responsibilities:
 *   1. Declare the canonical EditRange and EditRangeExtractionParams interfaces;
 *   2. Assert numerical validity and finiteness across start/end coordinates;
 *   3. Enforce monotonic order between start and end line/byte offsets;
 *   4. Extract contiguous edit ranges from diff operations.
 * Exit Semantics & Design Rationale: CC <= 15; explicit Error throw on invalid bounds;
 *   all checks execute in O(1) space per edit range.
 */

import {
    DiffOp,
    DIFF_OP_EQUAL,
    DIFF_OP_EQUAL_SPAN,
    DIFF_OP_DELETE,
} from './myers-algorithm';

/** `typeof` tag for numeric edit-range fields; non-numeric input is rejected. */
const TYPEOF_NUMBER = 'number';

/**
 * One contiguous edit (a run of adjacent line insertions/deletions, i.e. a "replace"
 * block). Line numbers are 1-based; byte offsets are UTF-16 code-unit offsets.
 */
export interface EditRange {
    /** 1-based first affected line (the same index in old and new content). */
    startLine: number;
    /** 1-based last OLD line consumed by this edit (inclusive). */
    oldEndLine: number;
    /** 1-based last NEW line produced by this edit (inclusive). */
    newEndLine: number;
    /** Byte offset where the edit starts (identical in old and new content). */
    startByte: number;
    /** Byte offset immediately AFTER the old (deleted) span. */
    oldEndByte: number;
    /** Byte offset immediately AFTER the new (inserted) span. */
    newEndByte: number;
}

/**
 * Parameter object for contiguous edit range extraction.
 */
export interface EditRangeExtractionParams {
    ops: DiffOp[];
    oldStarts: number[];
    newStarts: number[];
    oldLen: number;
    newLen: number;
}

/**
 * Checks whether any coordinate within the edit range is non-numeric or non-finite.
 *
 * @param editRange - Edit range record to verify.
 * @returns true if any coordinate is invalid.
 */
export function hasInvalidCoordinates(editRange: EditRange): boolean {
    const coords = [
        editRange.startLine,
        editRange.oldEndLine,
        editRange.newEndLine,
        editRange.startByte,
        editRange.oldEndByte,
        editRange.newEndByte,
    ];
    for (let index = 0; index < coords.length; index++) {
        const coordinate = coords[index];
        if (typeof coordinate !== TYPEOF_NUMBER || !Number.isFinite(coordinate)) {
            return true;
        }
    }
    return false;
}

/**
 * Validates line number constraints (1-based and endLine >= startLine).
 *
 * @param editRange - Edit range under inspection.
 */
export function validateEditLineBounds(editRange: EditRange): void {
    if (editRange.startLine < 1) {
        throw new Error('invalid edit range: startLine < 1');
    }
    if (editRange.oldEndLine < editRange.startLine || editRange.newEndLine < editRange.startLine) {
        throw new Error('invalid edit range: end line before start line');
    }
}

/**
 * Validates byte offset constraints (non-negative, monotonic, and within max bounds).
 *
 * @param editRange - Edit range under inspection.
 * @param maxByte - Optional maximum allowable byte bound.
 */
export function validateEditByteBounds(editRange: EditRange, maxByte?: number): void {
    const { startByte, oldEndByte, newEndByte } = editRange;
    if (startByte < 0) {
        throw new Error('invalid edit range: negative byte offset');
    }
    const hasInvalidEnd = oldEndByte < startByte || newEndByte < startByte;
    if (hasInvalidEnd) {
        throw new Error('invalid edit range: end byte before start byte');
    }
    if (maxByte !== undefined && (startByte > maxByte || oldEndByte > maxByte || newEndByte > maxByte)) {
        throw new Error('invalid edit range: byte offset out of bounds');
    }
}

/**
 * Validates a single edit range comprehensively.
 *
 * @param editRange - Edit range under inspection.
 * @param maxByte - Optional maximum allowable byte bound.
 */
export function validateSingleEditRange(editRange: EditRange, maxByte?: number): void {
    if (!editRange || hasInvalidCoordinates(editRange)) {
        throw new Error('invalid edit range: non-numeric field');
    }
    validateEditLineBounds(editRange);
    validateEditByteBounds(editRange, maxByte);
}

/**
 * Validate a set of edit ranges, throwing on the first invalid range.
 *
 * @param edits - Candidate ranges validated in order.
 * @param maxByte - Optional inclusive byte bound.
 */
export function validateEditRanges(edits: EditRange[], maxByte?: number): void {
    for (const edit of edits) {
        validateSingleEditRange(edit, maxByte);
    }
}

/**
 * Count deleted and inserted lines in a contiguous changed block.
 */
function scanContiguousEdits(
    ops: DiffOp[],
    startIndex: number,
): { delCount: number; insCount: number; nextIndex: number } {
    let delCount = 0;
    let insCount = 0;
    let scanIndex = startIndex;
    while (
        scanIndex < ops.length &&
        ops[scanIndex].type !== DIFF_OP_EQUAL &&
        ops[scanIndex].type !== DIFF_OP_EQUAL_SPAN
    ) {
        if (ops[scanIndex].type === DIFF_OP_DELETE) delCount++;
        else insCount++;
        scanIndex++;
    }
    return { delCount, insCount, nextIndex: scanIndex };
}

/**
 * Extract contiguous edit ranges from diff operations.
 *
 * @param params - Structured options containing ops, start indices, and lengths.
 * @returns Array of contiguous EditRange descriptors.
 */
export function extractEditRanges(params: EditRangeExtractionParams): EditRange[] {
    const { ops, oldStarts, newStarts, oldLen, newLen } = params;
    const edits: EditRange[] = [];
    let opIndex = 0;
    while (opIndex < ops.length) {
        if (ops[opIndex].type === DIFF_OP_EQUAL || ops[opIndex].type === DIFF_OP_EQUAL_SPAN) {
            opIndex++;
            continue;
        }
        const startIdx = ops[opIndex].aIdx;
        const scan = scanContiguousEdits(ops, opIndex);
        const delCount = scan.delCount;
        const insCount = scan.insCount;
        opIndex = scan.nextIndex;

        const startByte = startIdx < oldStarts.length ? oldStarts[startIdx] : oldLen;
        const oldEndIdx = startIdx + delCount;
        const newEndIdx = startIdx + insCount;
        const oldEndByte = oldEndIdx < oldStarts.length ? oldStarts[oldEndIdx] : oldLen;
        const newEndByte = newEndIdx < newStarts.length ? newStarts[newEndIdx] : newLen;
        edits.push({
            startLine: startIdx + 1,
            oldEndLine: startIdx + delCount,
            newEndLine: startIdx + insCount,
            startByte,
            oldEndByte,
            newEndByte,
        });
    }
    return edits;
}
