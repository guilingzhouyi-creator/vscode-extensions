/**
 * Module: Diff Engine — Incremental Streaming Diff Pipeline & Grid Row Layout
 * File Path: src/diff/incremental-diff-stream.ts
 * Architecture Role: Incremental chunk-slicing diff streaming pipeline with prefix
 *   coherence verification and CSS Grid alignment helper.
 * Dependencies & Triggers: Zero external runtime dependencies; consumed by diff viewers,
 *   streaming LLM decoders, and Webview side-by-side comparison layouts.
 * Responsibilities:
 *   1. Prefix coherence determination e.startsWith(lastChunk) and incremental delta
 *      slicing e.slice(lastChunk.length);
 *   2. CSS Grid uniform row span helper gridRow = `span ${lines}` preventing word-wrap
 *      vertical drift and side-by-side desynchronization;
 *   3. Progressive line-counting without intermediate heap allocations (CPX-SPACE-001).
 * Exit Semantics & Design Rationale: Pure, fail-safe streaming state pipeline.
 *   Deterministic, single-pass processing yielding O(1) space overhead per chunk.
 */

/**
 * CSS Grid row span helper generating uniform grid row span declarations
 * to eliminate Word Wrap vertical displacement in side-by-side diff renderers.
 *
 * @param lines - Line count for the grid row span (minimum 1).
 * @returns CSS Grid row span property value, e.g. "span 3".
 */
export function gridRow(lines: number): string {
    const safeLines = Math.max(1, Math.floor(Number.isFinite(lines) ? lines : 1));
    return `span ${safeLines}`;
}

/**
 * Alias for gridRow computing CSS grid-row span declaration.
 *
 * @param lines - Line count to span.
 * @returns CSS grid-row span string expression.
 */
export function computeGridRowSpan(lines: number): string {
    return gridRow(lines);
}

/**
 * Counts newline characters in text in a single zero-allocation pass.
 *
 * @param text - Source text to inspect.
 * @returns Total physical lines (at least 1 for non-empty text, 0 for empty string).
 */
export function countStreamLines(text: string): number {
    const len = text.length;
    if (len === 0) return 0;

    let lines = 1;
    for (let i = 0; i < len; i++) {
        if (text.charCodeAt(i) === 10 /* '\n' */) {
            lines++;
        }
    }
    return lines;
}

/**
 * Output of an incremental chunk ingestion cycle.
 */
export interface IncrementalSliceResult {
    /** Newly extracted delta slice. */
    readonly delta: string;
    /** Whether incoming event satisfied prefix coherence e.startsWith(lastChunk). */
    readonly isPrefixCoherent: boolean;
    /** Character length of newly sliced delta. */
    readonly deltaLength: number;
    /** Line count of newly sliced delta. */
    readonly lineCount: number;
    /** CSS Grid row span declaration, e.g. "span 4". */
    readonly gridRowSpan: string;
    /** Total accumulated text length across stream lifetime. */
    readonly cumulativeLength: number;
    /** Total accumulated lines across stream lifetime. */
    readonly totalLines: number;
}

/**
 * Incremental diff streaming pipeline performing prefix-coherence delta slicing
 * and maintaining synchronized grid row span metrics.
 */
export class IncrementalDiffStream {
    private lastChunk = '';
    private accumulatedContent = '';
    private totalLines = 0;
    private chunkCount = 0;

    constructor(initialContent = '') {
        if (initialContent.length > 0) {
            this.lastChunk = initialContent;
            this.accumulatedContent = initialContent;
            this.totalLines = countStreamLines(initialContent);
        }
    }

    /**
     * Current accumulated full text.
     */
    getAccumulatedContent(): string {
        return this.accumulatedContent;
    }

    /**
     * Last received chunk buffer.
     */
    getLastChunk(): string {
        return this.lastChunk;
    }

    /**
     * Total line count accumulated across the stream.
     */
    getTotalLines(): number {
        return this.totalLines;
    }

    /**
     * Number of streaming chunks processed.
     */
    getChunkCount(): number {
        return this.chunkCount;
    }

    /**
     * Ingests an incoming streaming text chunk `e`.
     * If `e` starts with `lastChunk`, slices `e.slice(lastChunk.length)` to extract the delta.
     * Otherwise, treats `e` as an incremental disjoint slice directly.
     *
     * @param e - Incoming streaming string or cumulative buffer.
     * @returns Processed slice result with grid row span.
     */
    processChunk(e: string): IncrementalSliceResult {
        const lastChunk = this.lastChunk;
        let isPrefixCoherent = false;
        let delta: string;

        if (lastChunk.length > 0 && e.startsWith(lastChunk)) {
            isPrefixCoherent = true;
            delta = e.slice(lastChunk.length);
            this.lastChunk = e;
        } else {
            isPrefixCoherent = false;
            delta = e;
            this.lastChunk = lastChunk + e;
        }

        this.accumulatedContent += delta;
        this.chunkCount++;

        const deltaLines = countStreamLines(delta);
        this.totalLines += deltaLines;

        return {
            delta,
            isPrefixCoherent,
            deltaLength: delta.length,
            lineCount: deltaLines,
            gridRowSpan: gridRow(deltaLines),
            cumulativeLength: this.accumulatedContent.length,
            totalLines: this.totalLines,
        };
    }

    /**
     * Alias for processChunk implementing stream write ergonomics.
     */
    write(e: string): IncrementalSliceResult {
        return this.processChunk(e);
    }

    /**
     * Resets the streaming pipeline to initial empty state.
     */
    reset(): void {
        this.lastChunk = '';
        this.accumulatedContent = '';
        this.totalLines = 0;
        this.chunkCount = 0;
    }
}
