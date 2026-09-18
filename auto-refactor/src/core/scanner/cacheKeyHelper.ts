/**
 * Module: Core Engine — Scanner Cache Key & Fingerprint Resolver
 * File Path: src/core/scanner/cacheKeyHelper.ts
 * Architecture Role: Fingerprint computation, stat probe, and session bucket resolution.
 * Dependencies & Triggers: fs, path, ../types, ../cache, ../cacheKey, ../analyzerRegistry;
 *   invoked by Scanner before evaluating warm-cache hits or diff executions.
 * Responsibilities: Build composite fingerprint hashes, probe file stat fingerprints,
 *   manage in-memory warm session buckets, and remap content-addressable results.
 * Exit Semantics & Design Rationale: Provides synchronous/idempotent cache-key resolution;
 *   remaps file-path references for L2 sharing without mutating original cached records.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScanConfig, Issue, FileMetric } from '../types';
import type { ResolvedAnalyzer } from '../analyzerRegistry';
import type { FingerprintAnalyzerDesc } from '../cacheKey';
import {
    ANALYZER_VERSIONS,
    buildFingerprintPayload,
    fpHash,
    adapterIdFor,
    computeCustomHash,
    buildPoolFingerprint,
} from '../cacheKey';
import type { CachedResult, Fingerprint } from '../cache';
import type { IncrementalFileState } from '../incrementalState';

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
 * @param result - Original cached result.
 * @param fromRel - Source path in cache entry.
 * @param toRel - Destination path in current scan.
 * @returns New result object with updated issue IDs and locations.
 */
export function remapCachedResult(
    result: CachedResult,
    fromRel: string,
    toRel: string,
): CachedResult {
    if (fromRel === toRel) return result;
    const issues = result.issues.map((it) => {
        const line = it.location && it.location.start ? it.location.start.line : 1;
        return {
            ...it,
            id: `${it.analyzer}:${it.rule}:${toRel}:${line}`,
            location: it.location ? { ...it.location, file: toRel } : it.location,
        };
    });
    const metric = result.metric ? { ...result.metric, file: toRel } : null;
    return { issues, metric };
}

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
    const descs: FingerprintAnalyzerDesc[] = plan.map((p) => ({
        name: p.name,
        version: ANALYZER_VERSIONS[p.name] ?? 1,
        modulePath: p.modulePath,
        options: p.options,
        legacy: typeof (p.instance as any).visit !== TYPEOF_FUNCTION,
    }));
    const customAnalyzers = (cfg.customAnalyzers || []).filter((c) => c.enabled !== false);
    const customHash =
        customAnalyzers.length > 0 && cacheCustom === true ? computeCustomHash(descs) : null;
    const l2Enabled =
        customAnalyzers.length === 0 || (cacheCustom === true && customHash !== null);

    const poolFp = buildPoolFingerprint(cfg, descs);
    const payloadByAdapter = new Map<string, string>();

    const fpHashFor = (rel: string): string => {
        const adapterId = adapterIdFor(rel, cfg.parser);
        const fileExt = rel.toLowerCase().endsWith(DTS_EXTENSION)
            ? DTS_EXTENSION
            : path.extname(rel).toLowerCase();
        const key = adapterId + '|' + fileExt;
        let h = payloadByAdapter.get(key);
        if (!h) {
            const payload = buildFingerprintPayload(cfg, adapterId, fileExt, descs, customHash);
            h = fpHash(payload);
            payloadByAdapter.set(key, h);
        }
        return h;
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

/**
 * Collect filesystem stat fingerprints synchronously across discovered files.
 *
 * @param absRoot - Absolute project root.
 * @param files - Discovered relative paths.
 * @returns Array of stat results with timestamps, sizes, and inodes.
 */
export function collectStatFingerprints(absRoot: string, files: string[]): StatResultEntry[] {
    const statResults: StatResultEntry[] = new Array(files.length);
    for (let i = 0; i < files.length; i++) {
        const rel = files[i];
        try {
            const st = fs.statSync(path.join(absRoot, rel));
            statResults[i] = {
                rel,
                fp: { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino },
                idx: i,
            };
        } catch {
            statResults[i] = { rel, fp: null, idx: i };
        }
    }
    return statResults;
}
