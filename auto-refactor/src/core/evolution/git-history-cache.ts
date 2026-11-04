/**
 * Module: Core Evolution — Git History Batch Disk Cache
 * File Path: src/core/evolution/git-history-cache.ts
 * Architecture Role: Persistence layer for `GitHistoryMiner` batch profiles, letting a second
 *   scan of an unchanged repository skip the `git log` subprocess entirely.
 * Dependencies & Triggers: Node fs/path; consumed by `GitHistoryMiner.mineRepositoryHistoryBatch`.
 * Responsibilities: Serialize a mined profile map to a versioned JSON payload, validate the
 *   payload's identity triple before reuse, and stage writes atomically so a crash cannot leave a
 *   half-written cache that decodes into a truncated history.
 * Exit Semantics & Design Rationale: Every entry point is fail-soft — a missing, corrupt, oversized
 *   or identity-mismatched file degrades to a cache miss instead of throwing, because history
 *   mining is an enrichment and must never block a scan.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { GitCommitRecord, GitFileHistoryProfile } from './git-history-miner';
/** Bump when the persisted profile shape changes, so old payloads simply miss. */
export const GIT_HISTORY_CACHE_VERSION = 1;
/** Directory name under the scan root that holds derived caches. */
const CACHE_DIR_NAME = '.auto-refactor-cache';
/** File name of the mined git history payload. */
const CACHE_FILE_NAME = 'git-history-cache.json';

const ENCODING_UTF8 = 'utf8';
const NEWLINE_CHAR = '\n';
const RANDOM_STRING_RADIX = 36;
const STAGING_SUFFIX_START = 2;
const STAGING_SUFFIX_END = 8;
/**
 * Upper bound on a cache payload we are willing to decode.
 *
 * The measured payload for a 1,374-file history is 896 KB. A 32 MB ceiling leaves ample room for
 * a much larger repository while keeping a corrupt or runaway file from stalling the scan inside
 * `JSON.parse`.
 */
const MAX_CACHE_BYTES = 33554432;
/** Identity triple that must match before a payload may be reused. */
export interface GitHistoryCacheKey {
    readonly topLevel: string;
    readonly head: string;
    readonly commitLimit: number;
}
/** On-disk envelope wrapping the profile map. */
interface GitHistoryCachePayload {
    readonly version: number;
    readonly key: GitHistoryCacheKey;
    readonly profiles: Record<string, GitFileHistoryProfile>;
}
/**
 * Resolves the cache file path for a scan root.
 *
 * @param scanRoot - Directory the scan was launched against.
 * @returns Absolute path of the payload file.
 */
export function resolveGitHistoryCachePath(scanRoot: string): string {
    return path.join(scanRoot, CACHE_DIR_NAME, CACHE_FILE_NAME);
}
/**
 * Decodes a serialized payload, rejecting anything whose identity triple does not match.
 *
 * @param rawText - Raw JSON text read from disk.
 * @param expectedKey - Identity triple the caller needs the payload to describe.
 * @returns Profile map on a hit, or null when the payload is unusable.
 */
export function decodeGitHistoryCache(
    rawText: string,
    expectedKey: GitHistoryCacheKey,
): Map<string, GitFileHistoryProfile> | null {
    try {
        const payload = JSON.parse(rawText) as Partial<GitHistoryCachePayload> | null;
        if (!payload || payload.version !== GIT_HISTORY_CACHE_VERSION) return null;
        if (!matchesKey(payload.key, expectedKey)) return null;
        const profiles = payload.profiles;
        if (!profiles || typeof profiles !== 'object') return null;
        const map = new Map<string, GitFileHistoryProfile>();
        for (const [key, value] of Object.entries(profiles)) {
            if (isProfile(value)) map.set(key, value);
        }
        return map.size > 0 ? map : null;
    } catch {
        return null;
    }
}
/**
 * Loads the cached profile map for a scan root.
 *
 * @param scanRoot - Directory the scan was launched against.
 * @param expectedKey - Identity triple that must match.
 * @returns Profile map on a hit, or null on any miss condition.
 */
export function loadGitHistoryCache(
    scanRoot: string,
    expectedKey: GitHistoryCacheKey,
): Map<string, GitFileHistoryProfile> | null {
    const cachePath = resolveGitHistoryCachePath(scanRoot);
    try {
        if (fs.statSync(cachePath).size > MAX_CACHE_BYTES) return null;
        return decodeGitHistoryCache(fs.readFileSync(cachePath, ENCODING_UTF8), expectedKey);
    } catch {
        return null;
    }
}
/**
 * Persists a mined profile map, replacing any previous payload atomically.
 *
 * Writes to a pid-and-random-suffixed staging file first and renames over the target, so a process
 * killed mid-write leaves the previous payload intact rather than a truncated one.
 *
 * @param scanRoot - Directory the scan was launched against.
 * @param key - Identity triple the payload describes.
 * @param profiles - Mined profile map.
 * @returns True when the payload reached disk.
 */
export function saveGitHistoryCache(
    scanRoot: string,
    key: GitHistoryCacheKey,
    profiles: Map<string, GitFileHistoryProfile>,
): boolean {
    const cachePath = resolveGitHistoryCachePath(scanRoot);
    const stagingPath = `${cachePath}.tmp-${process.pid}-${Math.random()
        .toString(RANDOM_STRING_RADIX)
        .slice(STAGING_SUFFIX_START, STAGING_SUFFIX_END)}`;
    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const payload: GitHistoryCachePayload = {
            version: GIT_HISTORY_CACHE_VERSION,
            key,
            profiles: Object.fromEntries(profiles),
        };
        fs.writeFileSync(stagingPath, JSON.stringify(payload) + NEWLINE_CHAR, ENCODING_UTF8);
        fs.renameSync(stagingPath, cachePath);
        return true;
    } catch {
        try {
            fs.rmSync(stagingPath, { force: true });
        } catch {
            /* best-effort staging cleanup */
        }
        return false;
    }
}

function matchesKey(candidate: unknown, expected: GitHistoryCacheKey): boolean {
    const record = candidate as Partial<GitHistoryCacheKey> | null;
    if (!record) return false;
    return (
        record.topLevel === expected.topLevel &&
        record.head === expected.head &&
        record.commitLimit === expected.commitLimit
    );
}

function isProfile(candidate: unknown): candidate is GitFileHistoryProfile {
    const record = candidate as Partial<GitFileHistoryProfile> | null;
    if (!record || typeof record !== 'object') return false;
    if (typeof record.filePath !== 'string') return false;
    if (typeof record.totalCommits !== 'number') return false;
    if (typeof record.bugFixCommits !== 'number') return false;
    if (!Array.isArray(record.recentCommits)) return false;
    return record.recentCommits.every(isCommitRecord);
}

function isCommitRecord(candidate: unknown): candidate is GitCommitRecord {
    const record = candidate as Partial<GitCommitRecord> | null;
    if (!record || typeof record !== 'object') return false;
    return typeof record.hash === 'string' && typeof record.timestamp === 'number';
}
