/**
 * Module: Core Engine — Diff Hint Routing
 * File Path: src/core/scanner/diffHints.ts
 * Architecture Role: Per-file diff-hint routing stage of the diff scan pipeline.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../incremental,
 *   ../incrementalState, ./scannerContext, ./cacheKeyHelper; invoked by executeScanWithDiff in
 *   ./diffScanner for every discovered file, changed or not.
 * Responsibilities: Normalize and validate diff hints, route byteEqual hints to L2 reuse and
 *   incremental hints to subtree reuse, fall back to disk bytes when a hint is unusable, and
 *   materialize the index-aligned per-file result the caller merges into the report.
 * Exit Semantics & Design Rationale: A malformed or stale hint never throws — it degrades to a
 *   full rescan, so routed results stay byte-identical to a cold scan.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, FileMetric, DiffInput } from '../types';
import type { CacheStore, CachedResult, Fingerprint } from '../cache';
import type { WorkerPoolManager } from '../workerPool';
import { sha256Hex } from '../cacheKey';
import { route, incrementalMaxChangedLines, countLines } from '../incremental';
import { resolveDiff } from '../diff';
import { decodeContent } from '../utf8';
import { IncrementalFileState, touchIncremental } from '../incrementalState';
import type { ScannerContext } from './scannerContext';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cacheKeyHelper';
import { remapCachedResult } from './cacheKeyHelper';
import {} from './workerScheduler';

/** Options accepted by executeScanWithDiff. */
export interface ScanWithDiffOptions {
    cache: CacheStore;
    session?: WarmSession;
    pool?: WorkerPoolManager;
    cacheCustom?: boolean;
    diffHints: Map<string, DiffInput>;
    verifyDiskContent: boolean;
    deltaOnly?: boolean;
}

/**
 * Mutable per-scan routing counters plus the index-aligned work lists the hint processors fill.
 */
export interface DiffRoutingState {
    l1Hit: number;
    l2Hit: number;
    diffFiles: number;
    byteEqual: number;
    diffIncremental: number;
    diffFull: number;
    rangesProvided: number;
    rangesFallback: number;
    oldContentFromDaemon: number;
    toAnalyze: {
        idx: number;
        rel: string;
        fpHash: string;
        contentHash: string;
        buf?: Buffer;
    }[];
    toIncremental: {
        idx: number;
        rel: string;
        fpHash: string;
        contentHash: string;
        state: IncrementalFileState;
        content: string;
    }[];
    l2Refresh: {
        fpHash: string;
        contentHash: string;
        rel: string;
        result: CachedResult;
        fp?: Fingerprint;
    }[];
    l1Fps: { rel: string; fp: Fingerprint }[];
}

function routeFullFallback(
    fph: string,
    contentHash: string,
    rel: string,
    newContent: string,
    buf: Buffer,
    idx: number,
    incEnabled: boolean,
    incMinLines: number,
    incBucket: Map<string, IncrementalFileState>,
    state: DiffRoutingState,
): void {
    if (incEnabled && countLines(newContent) >= incMinLines) {
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        state.toIncremental.push({
            idx,
            rel,
            fpHash: fph,
            contentHash,
            state: fresh,
            content: newContent,
        });
    } else {
        state.toAnalyze.push({ idx, rel, fpHash: fph, contentHash, buf });
    }
}

/**
 * Route one changed file from its diff hint into reuse, incremental, or a full rescan.
 *
 * @param rel - Repository-relative POSIX path of the changed file.
 * @param diffInput - Hint the caller reported for this path.
 * @param i - Index of the file in the index-aligned per-file result array.
 * @param absRoot - Absolute root used to read the canonical disk bytes.
 * @param fpContext - Pool fingerprint context backing the L2 lookups.
 * @param opts - Diff scan options (cache, session, delta switch).
 * @param incBucket - Per-file incremental state bucket of the pool fingerprint.
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param cache - Two-level cache store used for L1/L2 reuse and writes.
 * @param state - Routing counters accumulated across the diff scan.
 * @param incEnabled - Whether line-level incremental routing is enabled.
 * @param incMinLines - Minimum line count for incremental routing eligibility.
 * @param s - Pre-read stat fingerprint of the file.
 * @param scanner - Scanner execution context supplying config and fallbacks.
 * @returns Resolves once the file is routed and its per-file result recorded.
 */
export async function processChangedFileHint(
    rel: string,
    diffInput: DiffInput,
    i: number,
    absRoot: string,
    fpContext: CacheFingerprintContext,
    opts: ScanWithDiffOptions,
    incBucket: Map<string, IncrementalFileState>,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    cache: CacheStore,
    state: DiffRoutingState,
    incEnabled: boolean,
    incMinLines: number,
    s: StatResultEntry,
    scanner: ScannerContext,
): Promise<void> {
    state.diffFiles++;
    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(absRoot, rel));
    } catch {
        perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
        state.diffFull++;
        return;
    }
    const newContent = buf.toString('utf8');
    const contentHash = sha256Hex(buf);
    const fph = fpContext.fpHashFor(rel);

    if (opts.verifyDiskContent) {
        const provided = decodeContent((diffInput as any).newContent);
        if (sha256Hex(Buffer.from(provided, 'utf8')) !== contentHash) {
            scanner.logger.warn(`diff newContent mismatch on ${rel}; falling back to full rescan`);
            state.diffFull++;
            routeFullFallback(
                fph,
                contentHash,
                rel,
                newContent,
                buf,
                i,
                incEnabled,
                incMinLines,
                incBucket,
                state,
            );
            return;
        }
    }

    const incState = incBucket.get(rel);
    const resolved = resolveDiff(diffInput, {
        enabled: incEnabled,
        minLines: incMinLines,
        maxChangedLines: incrementalMaxChangedLines(),
        state: incState,
        newContent,
        buf,
    });
    if (resolved.rangesProvided) state.rangesProvided++;
    if (resolved.rangesFallback) state.rangesFallback++;
    if (resolved.oldContentFromState) state.oldContentFromDaemon++;

    if (resolved.mode === 'incremental') {
        state.diffIncremental++;
        incState!.prepare(newContent, contentHash);
        state.toIncremental.push({
            idx: i,
            rel,
            fpHash: fph,
            contentHash,
            state: incState!,
            content: newContent,
        });
        return;
    }

    if (resolved.mode === 'byteEqual') {
        state.byteEqual++;
        const l2 = fpContext.l2Enabled ? cache.lookupL2(fph, contentHash) : null;
        if (l2) {
            const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
            perFile[i] = result;
            sessionBucket.set(rel, result);
            state.l2Hit++;
            state.l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
            return;
        }
        routeFullFallback(
            fph,
            contentHash,
            rel,
            newContent,
            buf,
            i,
            incEnabled,
            incMinLines,
            incBucket,
            state,
        );
        return;
    }

    state.diffFull++;
    routeFullFallback(
        fph,
        contentHash,
        rel,
        newContent,
        buf,
        i,
        incEnabled,
        incMinLines,
        incBucket,
        state,
    );
}

/**
 * Route one unchanged file through L1/L2 reuse before falling back to a rescan.
 *
 * @param rel - Repository-relative POSIX path of the unchanged file.
 * @param i - Index of the file in the index-aligned per-file result array.
 * @param s - Pre-read stat fingerprint of the file.
 * @param absRoot - Absolute root used to read the canonical disk bytes.
 * @param fpContext - Pool fingerprint context backing the L2 lookups.
 * @param incBucket - Per-file incremental state bucket of the pool fingerprint.
 * @param sessionBucket - Warm session results bucket of the pool fingerprint.
 * @param perFile - Index-aligned per-file results the caller merges into the report.
 * @param cache - Two-level cache store used for L1/L2 reuse and writes.
 * @param state - Routing counters accumulated across the diff scan.
 * @param incEnabled - Whether line-level incremental routing is enabled.
 * @param incMinLines - Minimum line count for incremental routing eligibility.
 * @returns Resolves once the file is routed and its per-file result recorded.
 */
export async function processUnchangedFile(
    rel: string,
    i: number,
    s: StatResultEntry,
    absRoot: string,
    fpContext: CacheFingerprintContext,
    incBucket: Map<string, IncrementalFileState>,
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>,
    perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[],
    cache: CacheStore,
    state: DiffRoutingState,
    incEnabled: boolean,
    incMinLines: number,
): Promise<void> {
    const l1 = cache.lookupL1(rel);
    if (s.fp && l1 && l1.mtimeMs === s.fp.mtimeMs && l1.size === s.fp.size) {
        const cached = sessionBucket.get(rel);
        if (cached) {
            perFile[i] = cached;
            state.l1Hit++;
            return;
        }
        const fph = fpContext.fpHashFor(rel);
        const byPath = fpContext.l2Enabled
            ? cache.lookupL2ByPath(fph, rel, s.fp.mtimeMs, s.fp.size)
            : null;
        if (byPath) {
            const result = remapCachedResult(
                { issues: byPath.issues, metric: byPath.metric },
                byPath.p,
                rel,
            );
            perFile[i] = result;
            sessionBucket.set(rel, result);
            state.l1Hit++;
            return;
        }
    }
    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(absRoot, rel));
    } catch {
        perFile[i] = { issues: [] as Issue[], metric: null as FileMetric | null };
        return;
    }
    const contentHash = sha256Hex(buf);
    const fph = fpContext.fpHashFor(rel);
    const l2 = fpContext.l2Enabled ? cache.lookupL2(fph, contentHash) : null;
    if (l2) {
        const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, rel);
        perFile[i] = result;
        sessionBucket.set(rel, result);
        state.l2Hit++;
        state.l2Refresh.push({ fpHash: fph, contentHash, rel, result, fp: s.fp || undefined });
        return;
    }
    if (incEnabled && countLines(buf.toString('utf8')) >= incMinLines) {
        const newContent = buf.toString('utf8');
        const oldState = incBucket.get(rel);
        if (oldState) {
            touchIncremental(incBucket, rel);
            const r = route(rel, oldState.content, newContent, oldState, {
                enabled: true,
                minLines: incMinLines,
            });
            if (r.mode === 'incremental') {
                oldState.prepare(newContent, contentHash);
                state.toIncremental.push({
                    idx: i,
                    rel,
                    fpHash: fph,
                    contentHash,
                    state: oldState,
                    content: newContent,
                });
                return;
            }
        }
        const fresh = new IncrementalFileState(newContent, contentHash);
        fresh.prepare(newContent, contentHash);
        incBucket.set(rel, fresh);
        state.toIncremental.push({
            idx: i,
            rel,
            fpHash: fph,
            contentHash,
            state: fresh,
            content: newContent,
        });
        return;
    }
    state.toAnalyze.push({ idx: i, rel, fpHash: fph, contentHash, buf });
}

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
