/**
 * Module: Core Engine — Scan Guard Predicates
 * File Path: src/core/scanner/scanGuards.ts
 * Architecture Role: Leaf predicates shared by the diff and cache scan stages.
 * Dependencies & Triggers: ../incremental (countLines) and ../workerPool (types); consumed by
 *   diffHints, diffScanner, and cacheProbe.
 * Responsibilities: Answer the three routing questions every scan stage asks — worker pool
 *   availability, incremental eligibility, and L1 freshness.
 * Exit Semantics & Design Rationale: Pure predicates with no I/O and no state, kept in a leaf
 *   module so the routing stages can share them without an import cycle.
 */
import { countLines } from '../incremental';
import type { WorkerPoolManager } from '../worker-pool';

/**
 * Report whether the diff miss batch should go to the persistent worker pool.
 *
 * A type predicate is used instead of a plain boolean so the caller keeps the narrowing of
 * `opts.pool` that the inline condition used to provide.
 *
 * @param useWorkers - Whether the effective worker count allows a pool at all.
 * @param opts - Diff scan options carrying the optional persistent pool manager.
 * @returns True when the batch should be handled by the worker pool.
 */
export function hasWorkerPool<T extends { pool?: WorkerPoolManager }>(
    useWorkers: boolean,
    opts: T,
): opts is T & { pool: WorkerPoolManager } {
    return useWorkers && opts.pool !== undefined;
}

/**
 * Report whether a content payload qualifies for line-level incremental routing.
 *
 * Extracted so both routing stages ask the same question through one named predicate, keeping
 * the incremental eligibility rule (enabled flag plus minimum line count) in a single place.
 *
 * @param incEnabled - Whether incremental routing is enabled for this scan.
 * @param content - Raw file content to measure.
 * @param incMinLines - Minimum line count for incremental eligibility.
 * @returns True when the file qualifies for incremental reuse.
 */
export function isIncrementalCandidate(
    incEnabled: boolean,
    content: string,
    incMinLines: number,
): boolean {
    return incEnabled && countLines(content) >= incMinLines;
}

/**
 * Report whether a cached L1 entry still matches a file stat fingerprint.
 *
 * The caller narrows the fingerprint first, so the three comparisons live here instead of
 * inflating the caller cyclomatic complexity.
 *
 * @param fpMtimeMs - Modification time recorded for the file.
 * @param fpSize - Byte size recorded for the file.
 * @param l1 - L1 cache entry for the file, when one exists.
 * @returns True when the L1 entry is still fresh for this file.
 */
export function isFreshL1Hit(
    fpMtimeMs: number,
    fpSize: number,
    l1: { mtimeMs: number; size: number } | null | undefined,
): boolean {
    return l1 != null && l1.mtimeMs === fpMtimeMs && l1.size === fpSize;
}
