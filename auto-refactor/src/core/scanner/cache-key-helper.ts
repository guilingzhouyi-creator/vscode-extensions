/**
 * Module: Core Engine — Scanner Cache Key & Fingerprint Resolver
 * File Path: src/core/scanner/cache-key-helper.ts
 * Architecture Role: Fingerprint computation, stat probe, and session bucket resolution.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../analyzerRegistry;
 *   invoked by Scanner before evaluating warm-cache hits or diff executions.
 * Responsibilities: Build composite fingerprint hashes, probe file stat fingerprints,
 *   manage in-memory warm session buckets, and remap content-addressable results.
 * Exit Semantics & Design Rationale: Provides synchronous/idempotent cache-key resolution;
 *   remaps file-path references for L2 sharing without mutating original cached records.
 */

import * as path from 'path';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { ResolvedAnalyzer } from '../analyzer-registry';
import type { FingerprintAnalyzerDesc } from '../cache-key';
import {
    ANALYZER_VERSIONS,
    buildFingerprintPayload,
    fpHash,
    adapterIdFor,
    computeCustomHash,
    buildPoolFingerprint,
} from '../cache-key';
import type { CachedResult, Fingerprint } from '../cache';
import * as fs from 'fs';
import type { IncrementalFileState } from '../diff/incremental-state';

/** TypeScript declaration-file suffix, keyed separately from a plain `.ts` extension. */
export const DTS_EXTENSION = '.d.ts';

/** Type string for visit/finalize check. */
const TYPEOF_FUNCTION = 'function';

/** Session-scoped result cache shared across scans within one process (the daemon). */
export interface WarmSession {
    results: Map<string, Map<string, { issues: Issue[]; metric: FileMetric | null }>>;
    /** Per-file line-level incremental state (subtree caches), keyed by pool fp → rel path. */
    incremental: Map<string, Map<string, IncrementalFileState>>;
}

/**
 * Allocate an empty session-scoped cache used by repeated warm scans in one process.
 *
 * @returns Fresh WarmSession with empty results and incremental maps.
 */
export function createWarmSession(): WarmSession {
    return { results: new Map(), incremental: new Map() };
}

/** Resolved cache fingerprint context for a scan execution. */
export interface CacheFingerprintContext {
    descs: FingerprintAnalyzerDesc[];
    customHash: string | null;
    l2Enabled: boolean;
    poolFp: string;
    fpHashFor: (rel: string) => string;
}

/**
 * Re-map a cached per-file result from the path it was originally computed for to the
 * current rel path.
 *
 * @param cachedResult - Original cached result.
 * @param fromRel - Source path in cache entry.
 * @param toRel - Destination path in current scan.
 * @returns New result object with updated issue IDs and locations.
 */
export function getRemappedCachedResult(
    cachedResult: CachedResult,
    fromRel: string,
    toRel: string,
): CachedResult {
    if (fromRel === toRel) return cachedResult;
    const issues = cachedResult.issues.map((issueItem) => {
        const line =
            issueItem.location && issueItem.location.start ? issueItem.location.start.line : 1;
        return {
            ...issueItem,
            id: `${issueItem.analyzer}:${issueItem.rule}:${toRel}:${line}`,
            location: issueItem.location
                ? { ...issueItem.location, file: toRel }
                : issueItem.location,
        };
    });
    const metric = cachedResult.metric ? { ...cachedResult.metric, file: toRel } : null;
    let symbols: typeof cachedResult.symbols;
    if (cachedResult.symbols) {
        symbols = {
            definitions: cachedResult.symbols.definitions.map((def) => ({
                ...def,
                file: toRel,
            })),
            references: cachedResult.symbols.references.map((ref) => ({
                ...ref,
                file: toRel,
            })),
        };
    }
    const literals = cachedResult.literals
        ? cachedResult.literals.map((lit) => ({ ...lit, file: toRel }))
        : undefined;
    const loopSites = cachedResult.loopSites
        ? cachedResult.loopSites.map((site) => ({ ...site, file: toRel }))
        : undefined;
    const graphEdges = cachedResult.graphEdges
        ? { ...cachedResult.graphEdges, file: toRel }
        : undefined;
    return {
        issues,
        metric,
        ...(symbols ? { symbols } : {}),
        ...(literals ? { literals } : {}),
        ...(loopSites ? { loopSites } : {}),
        ...(graphEdges ? { graphEdges } : {}),
    };
}

/** Backward-compatible export alias for remapCachedResult. */
export const remapCachedResult = getRemappedCachedResult;

/**
 * Normalize a diff-input filePath to a rel path (POSIX '/') inside root, or null if illegal.
 *
 * @param filePath - Input file path from diff hint.
 * @param absRoot - Absolute root path of the project.
 * @returns Normalized POSIX relative path, or null if outside root.
 */
export function normalizeRelPath(filePath: string, absRoot: string): string | null {
    if (!filePath || typeof filePath !== 'string') return null;
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(absRoot, filePath);
    const rel = path.relative(absRoot, abs);
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        return null;
    }
    return rel.split(path.sep).join('/');
}

/**
 * Build composite analyzer fingerprint descriptors and lookup functions for caching.
 *
 * @param cfg - Resolved scan configuration.
 * @param plan - Resolved analyzer execution plan.
 * @param cacheCustom - Whether custom analyzer caching is enabled.
 * @returns Complete fingerprint context including poolFp and per-file fpHashFor resolver.
 */
export function buildCacheFingerprintContext(
    cfg: ScanConfig,
    plan: ResolvedAnalyzer[],
    cacheCustom?: boolean,
): CacheFingerprintContext {
    const descs: FingerprintAnalyzerDesc[] = plan.map((planItem) => ({
        name: planItem.name,
        version: ANALYZER_VERSIONS[planItem.name] ?? 1,
        modulePath: planItem.modulePath,
        options: planItem.options,
        legacy: typeof planItem.instance.visit !== TYPEOF_FUNCTION,
    }));
    const customAnalyzers = (cfg.customAnalyzers || []).filter(
        (analyzer) => analyzer.enabled !== false,
    );
    const customHash =
        customAnalyzers.length > 0 && cacheCustom === true ? computeCustomHash(descs) : null;
    const l2Enabled = customAnalyzers.length === 0 || (cacheCustom === true && customHash !== null);

    const poolFp = buildPoolFingerprint(cfg, descs);
    const payloadByAdapter = new Map<string, string>();

    const fpHashFor = (rel: string): string => {
        const adapterId = adapterIdFor(rel, cfg.parser);
        const fileExt = rel.toLowerCase().endsWith(DTS_EXTENSION)
            ? DTS_EXTENSION
            : path.extname(rel).toLowerCase();
        const key = adapterId + '|' + fileExt;
        let fpHashValue = payloadByAdapter.get(key);
        if (!fpHashValue) {
            const payload = buildFingerprintPayload(cfg, adapterId, fileExt, { descs, customHash });
            fpHashValue = fpHash(payload);
            payloadByAdapter.set(key, fpHashValue);
        }
        return fpHashValue;
    };

    return { descs, customHash, l2Enabled, poolFp, fpHashFor };
}

/**
 * Resolve session buckets for scan results and incremental file states.
 *
 * @param session - Active or newly created warm session.
 * @param poolFp - Configuration pool fingerprint key.
 * @returns Associated results bucket and incremental state bucket.
 */
export function resolveSessionBuckets(
    session: WarmSession,
    poolFp: string,
): {
    sessionBucket: Map<string, { issues: Issue[]; metric: FileMetric | null }>;
    incBucket: Map<string, IncrementalFileState>;
} {
    let sessionBucket = session.results.get(poolFp);
    if (!sessionBucket) {
        sessionBucket = new Map<string, { issues: Issue[]; metric: FileMetric | null }>();
        session.results.set(poolFp, sessionBucket);
    }
    let incBucket = session.incremental.get(poolFp);
    if (!incBucket) {
        incBucket = new Map<string, IncrementalFileState>();
        session.incremental.set(poolFp, incBucket);
    }
    return { sessionBucket, incBucket };
}

/** Stat result entry for a file in the project. */
export interface StatResultEntry {
    rel: string;
    fp: Fingerprint | null;
    idx: number;
}

/** Stat probes kept in flight at once; matches the scanner's own hybrid concurrency budget. */
const STAT_CONCURRENCY = 16;

/**
 * Collect filesystem stat fingerprints across discovered files.
 *
 * Runs concurrently because every caller sits in an async pipeline stage; the previous synchronous
 * loop serialised one blocking `stat` per file, so a 600-file scan paid 600 blocking syscalls on
 * the event loop. Concurrency is bounded so a whole repository cannot exhaust file descriptors.
 *
 * @param absRoot - Absolute project root.
 * @param files - Discovered relative paths.
 * @returns Stat results with timestamps, sizes, and inodes, indexed to `files`.
 */
export async function collectStatFingerprints(
    absRoot: string,
    files: string[],
): Promise<StatResultEntry[]> {
    const statResults: StatResultEntry[] = new Array(files.length);
    let nextIndex = 0;

    const probeNext = async (): Promise<void> => {
        while (nextIndex < files.length) {
            const idx = nextIndex++;
            const rel = files[idx];
            try {
                const fileStat = await fs.promises.stat(path.join(absRoot, rel));
                statResults[idx] = {
                    rel,
                    fp: { mtimeMs: fileStat.mtimeMs, size: fileStat.size, ino: fileStat.ino },
                    idx,
                };
            } catch {
                statResults[idx] = { rel, fp: null, idx };
            }
        }
    };

    const laneCount = Math.max(1, Math.min(STAT_CONCURRENCY, files.length));
    await Promise.all(Array.from({ length: laneCount }, probeNext));
    return statResults;
}
