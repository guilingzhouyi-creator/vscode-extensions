/**
 * Module: Core Engine — Diff Hint Routing
 * File Path: src/core/scanner/diff-hints.ts
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
import { isIncrementalCandidate } from './scan-guards';

import * as fs from 'fs';
import * as path from 'path';
import type { Issue, FileMetric, DiffInput } from '../types';
import type { CacheStore, CachedResult, Fingerprint } from '../cache';
import type { WorkerPoolManager } from '../worker-pool';
import { sha256Hex } from '../cache-key';
import { route, incrementalMaxChangedLines } from '../diff/incremental';
import { resolveDiff } from '../diff/diff';
import { decodeContent } from '../ast/utf8';
import { IncrementalFileState, touchIncremental } from '../diff/incremental-state';
import type { ScannerContext } from './scanner-context';
import type { WarmSession, CacheFingerprintContext, StatResultEntry } from './cache-key-helper';
import { remapCachedResult } from './cache-key-helper';

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

/** Shared context containing cache, fingerprint, and configuration resources for diff routing. */
export interface DiffRoutingContext {
    readonly absRoot: string;
    readonly fpContext: CacheFingerprintContext;
    readonly opts: ScanWithDiffOptions;
    readonly incBucket: Map<string, IncrementalFileState>;
    readonly sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    readonly perFile: ({ issues: Issue[]; metric: FileMetric | null } | null)[];
    readonly cache: CacheStore;
    readonly routingState: DiffRoutingState;
    readonly incEnabled: boolean;
    readonly incMinLines: number;
    readonly scanner: ScannerContext;
}

/** Parameters identifying a single changed file during diff routing. */
export interface ChangedFileParams {
    readonly rel: string;
    readonly diffInput: DiffInput;
    readonly fileIndex: number;
    readonly statEntry: StatResultEntry;
}

/** Parameters identifying a single unchanged file during diff routing. */
export interface UnchangedFileParams {
    readonly rel: string;
    readonly fileIndex: number;
    readonly statEntry: StatResultEntry;
}

interface FallbackParams {
    readonly fph: string;
    readonly contentHash: string;
    readonly rel: string;
    readonly newContent: string;
    readonly buf: Buffer;
    readonly idx: number;
}

interface QueueIncrementalParams {
    readonly fileIndex: number;
    readonly rel: string;
    readonly fph: string;
    readonly contentHash: string;
    readonly incState: IncrementalFileState;
    readonly newContent: string;
}

interface UnchangedIncTarget {
    readonly fph: string;
    readonly contentHash: string;
    readonly buf: Buffer;
}

function routeFullFallback(params: FallbackParams, ctx: DiffRoutingContext): void {
    if (isIncrementalCandidate(ctx.incEnabled, params.newContent, ctx.incMinLines)) {
        const fresh = new IncrementalFileState(params.newContent, params.contentHash);
        fresh.prepare(params.newContent, params.contentHash);
        ctx.incBucket.set(params.rel, fresh);
        ctx.routingState.toIncremental.push({
            idx: params.idx,
            rel: params.rel,
            fpHash: params.fph,
            contentHash: params.contentHash,
            state: fresh,
            content: params.newContent,
        });
    } else {
        ctx.routingState.toAnalyze.push({
            idx: params.idx,
            rel: params.rel,
            fpHash: params.fph,
            contentHash: params.contentHash,
            buf: params.buf,
        });
    }
}

function verifyDiskMatch(
    diffInput: DiffInput,
    contentHash: string,
    rel: string,
    ctx: DiffRoutingContext,
): boolean {
    if (!ctx.opts.verifyDiskContent) return true;
    const provided = decodeContent(diffInput.newContent);
    if (sha256Hex(Buffer.from(provided, 'utf8')) !== contentHash) {
        ctx.scanner.logger.warn(`diff newContent mismatch on ${rel}; falling back to full rescan`);
        return false;
    }
    return true;
}

function handleByteEqual(
    fph: string,
    contentHash: string,
    params: ChangedFileParams,
    ctx: DiffRoutingContext,
): boolean {
    ctx.routingState.byteEqual++;
    const l2 = ctx.fpContext.l2Enabled ? ctx.cache.lookupL2(fph, contentHash) : null;
    if (l2) {
        const result = remapCachedResult(
            { issues: l2.issues, metric: l2.metric },
            l2.p,
            params.rel,
        );
        ctx.perFile[params.fileIndex] = result;
        ctx.sessionBucket.set(params.rel, result);
        ctx.routingState.l2Hit++;
        ctx.routingState.l2Refresh.push({
            fpHash: fph,
            contentHash,
            rel: params.rel,
            result,
            fp: params.statEntry.fp || undefined,
        });
        return true;
    }
    return false;
}

function queueIncremental(params: QueueIncrementalParams, state: DiffRoutingState): void {
    state.diffIncremental++;
    params.incState.prepare(params.newContent, params.contentHash);
    state.toIncremental.push({
        idx: params.fileIndex,
        rel: params.rel,
        fpHash: params.fph,
        contentHash: params.contentHash,
        state: params.incState,
        content: params.newContent,
    });
}

/**
 * Route one changed file from its diff hint into reuse, incremental, or a full rescan.
 *
 * @param params - Identifiers and hint for the changed file.
 * @param ctx - Shared routing resources, cache, and state.
 *
 * Concurrency: asynchronous coordinator; safe for single-threaded caller.
 * @returns Resolves once the file is routed and its per-file result recorded.
 */
export async function processChangedFileHint(
    params: ChangedFileParams,
    ctx: DiffRoutingContext,
): Promise<void> {
    ctx.routingState.diffFiles++;
    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(ctx.absRoot, params.rel));
    } catch {
        ctx.perFile[params.fileIndex] = {
            issues: [] as Issue[],
            metric: null as FileMetric | null,
        };
        ctx.routingState.diffFull++;
        return;
    }
    const newContent = buf.toString('utf8');
    const contentHash = sha256Hex(buf);
    const fph = ctx.fpContext.fpHashFor(params.rel);

    if (!verifyDiskMatch(params.diffInput, contentHash, params.rel, ctx)) {
        ctx.routingState.diffFull++;
        routeFullFallback(
            {
                fph,
                contentHash,
                rel: params.rel,
                newContent,
                buf,
                idx: params.fileIndex,
            },
            ctx,
        );
        return;
    }

    const incState = ctx.incBucket.get(params.rel);
    const resolved = resolveDiff(params.diffInput, {
        enabled: ctx.incEnabled,
        minLines: ctx.incMinLines,
        maxChangedLines: incrementalMaxChangedLines(),
        state: incState,
        newContent,
        buf,
    });
    if (resolved.rangesProvided) ctx.routingState.rangesProvided++;
    if (resolved.rangesFallback) ctx.routingState.rangesFallback++;
    if (resolved.oldContentFromState) ctx.routingState.oldContentFromDaemon++;

    if (resolved.mode === 'incremental') {
        queueIncremental(
            {
                fileIndex: params.fileIndex,
                rel: params.rel,
                fph,
                contentHash,
                incState: incState!,
                newContent,
            },
            ctx.routingState,
        );
        return;
    }

    if (resolved.mode === 'byteEqual') {
        const hit = handleByteEqual(fph, contentHash, params, ctx);
        if (hit) return;
        routeFullFallback(
            {
                fph,
                contentHash,
                rel: params.rel,
                newContent,
                buf,
                idx: params.fileIndex,
            },
            ctx,
        );
        return;
    }

    ctx.routingState.diffFull++;
    routeFullFallback(
        {
            fph,
            contentHash,
            rel: params.rel,
            newContent,
            buf,
            idx: params.fileIndex,
        },
        ctx,
    );
}

function tryResolveUnchangedL1(params: UnchangedFileParams, ctx: DiffRoutingContext): boolean {
    const l1 = ctx.cache.lookupL1(params.rel);
    if (
        !params.statEntry.fp ||
        !l1 ||
        l1.mtimeMs !== params.statEntry.fp.mtimeMs ||
        l1.size !== params.statEntry.fp.size
    ) {
        return false;
    }
    const cached = ctx.sessionBucket.get(params.rel);
    if (cached) {
        ctx.perFile[params.fileIndex] = cached;
        ctx.routingState.l1Hit++;
        return true;
    }
    const fph = ctx.fpContext.fpHashFor(params.rel);
    const byPath = ctx.fpContext.l2Enabled
        ? ctx.cache.lookupL2ByPath(
              fph,
              params.rel,
              params.statEntry.fp.mtimeMs,
              params.statEntry.fp.size,
          )
        : null;
    if (byPath) {
        const result = remapCachedResult(
            { issues: byPath.issues, metric: byPath.metric },
            byPath.p,
            params.rel,
        );
        ctx.perFile[params.fileIndex] = result;
        ctx.sessionBucket.set(params.rel, result);
        ctx.routingState.l1Hit++;
        return true;
    }
    return false;
}

function tryResolveUnchangedL2(
    fph: string,
    contentHash: string,
    params: UnchangedFileParams,
    ctx: DiffRoutingContext,
): boolean {
    const l2 = ctx.fpContext.l2Enabled ? ctx.cache.lookupL2(fph, contentHash) : null;
    if (!l2) return false;
    const result = remapCachedResult({ issues: l2.issues, metric: l2.metric }, l2.p, params.rel);
    ctx.perFile[params.fileIndex] = result;
    ctx.sessionBucket.set(params.rel, result);
    ctx.routingState.l2Hit++;
    ctx.routingState.l2Refresh.push({
        fpHash: fph,
        contentHash,
        rel: params.rel,
        result,
        fp: params.statEntry.fp || undefined,
    });
    return true;
}

function tryRouteUnchangedIncremental(
    target: UnchangedIncTarget,
    params: UnchangedFileParams,
    ctx: DiffRoutingContext,
): boolean {
    const newContent = target.buf.toString('utf8');
    if (!isIncrementalCandidate(ctx.incEnabled, newContent, ctx.incMinLines)) {
        return false;
    }
    const oldState = ctx.incBucket.get(params.rel);
    if (oldState) {
        touchIncremental(ctx.incBucket, params.rel);
        const routeResult = route(params.rel, oldState.content, newContent, oldState, {
            enabled: true,
            minLines: ctx.incMinLines,
        });
        if (routeResult.mode === 'incremental') {
            oldState.prepare(newContent, target.contentHash);
            ctx.routingState.toIncremental.push({
                idx: params.fileIndex,
                rel: params.rel,
                fpHash: target.fph,
                contentHash: target.contentHash,
                state: oldState,
                content: newContent,
            });
            return true;
        }
    }
    const fresh = new IncrementalFileState(newContent, target.contentHash);
    fresh.prepare(newContent, target.contentHash);
    ctx.incBucket.set(params.rel, fresh);
    ctx.routingState.toIncremental.push({
        idx: params.fileIndex,
        rel: params.rel,
        fpHash: target.fph,
        contentHash: target.contentHash,
        state: fresh,
        content: newContent,
    });
    return true;
}

/**
 * Route one unchanged file through L1/L2 reuse before falling back to a rescan.
 *
 * @param params - Identifiers for the unchanged file.
 * @param ctx - Shared routing resources, cache, and state.
 *
 * Concurrency: asynchronous coordinator; safe for single-threaded caller.
 * @returns Resolves once the file is routed and its per-file result recorded.
 */
export async function processUnchangedFile(
    params: UnchangedFileParams,
    ctx: DiffRoutingContext,
): Promise<void> {
    if (tryResolveUnchangedL1(params, ctx)) {
        return;
    }
    let buf: Buffer;
    try {
        buf = await fs.promises.readFile(path.join(ctx.absRoot, params.rel));
    } catch {
        ctx.perFile[params.fileIndex] = {
            issues: [] as Issue[],
            metric: null as FileMetric | null,
        };
        return;
    }
    const contentHash = sha256Hex(buf);
    const fph = ctx.fpContext.fpHashFor(params.rel);
    if (tryResolveUnchangedL2(fph, contentHash, params, ctx)) {
        return;
    }
    if (tryRouteUnchangedIncremental({ fph, contentHash, buf }, params, ctx)) {
        return;
    }
    ctx.routingState.toAnalyze.push({
        idx: params.fileIndex,
        rel: params.rel,
        fpHash: fph,
        contentHash,
        buf,
    });
}
