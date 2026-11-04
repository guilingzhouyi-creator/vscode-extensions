/**
 * Module: Core Evolution — Git History Miner
 * File Path: src/core/evolution/git-history-miner.ts
 * Architecture Role: Extracts commit history, blame distribution, and churn metrics from git logs
 *   to feed the code evolution quality model.
 * Dependencies & Triggers: Node child_process (spawnSync); invoked by CodeEvolutionAnalyzer.
 * Responsibilities:
 *   1. Safely inspect git availability and repository presence without throwing.
 *   2. Mine structured commit logs for target files (author, timestamp,
 *      message, bug-fix detection).
 *   3. Aggregate file-level author contribution distributions for entropy calculation.
 *   4. Provide pure-data mining methods for testing and offline telemetry without child processes.
 * Exit Semantics & Design Rationale: Gracefully degrades to an empty profile on missing git,
 *   non-repo directories, or timeouts. Zero crash guarantee under all environments.
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import { normalizePathSeparators } from '../constants';
import {
    loadGitHistoryCache,
    saveGitHistoryCache,
    type GitHistoryCacheKey,
} from './git-history-cache';
/** Structured record representing a single git commit modifying a file. */
export interface GitCommitRecord {
    hash: string;
    author: string;
    timestamp: number; // Unix timestamp in milliseconds
    subject: string;
    isBugFix: boolean;
}
/** Aggregated evolution history profile for a specific file. */
export interface GitFileHistoryProfile {
    filePath: string;
    isGitAvailable: boolean;
    totalCommits: number;
    bugFixCommits: number;
    authorCommitCounts: Record<string, number>;
    uniqueAuthorsCount: number;
    firstSeenTimestamp: number | null;
    lastModifiedTimestamp: number | null;
    recentCommits: GitCommitRecord[];
}
/** Parameter context for indexing profile aliases in inverted maps. */
interface ProfileAliasContext {
    readonly profilesMap: Map<string, GitFileHistoryProfile>;
    readonly profile: GitFileHistoryProfile;
    readonly absPath: string;
    readonly relCwd: string;
    readonly relTop: string;
}
/** Regex pattern matching commit subjects indicating bug repairs or hotfixes */
export const BUG_FIX_COMMIT_PATTERN =
    /\b(?:fix|fixes|fixed|bug|bugs|patch|hotfix|resolve|resolves|resolved|defect|issue)\b/i;

const CMD_GIT = 'git';
const ENCODING_UTF8 = 'utf8';
const STDIO_IGNORE = 'ignore';
const STDIO_PIPE = 'pipe';
const FORWARD_SLASH = '/';
const ASCII_RECORD_SEP = '\x1e';
const ASCII_FIELD_SEP = '\x1f';
const NEWLINE_SPLIT_RE = /\r?\n/;

const STR_TRUE = 'true';
const MIN_HEADER_FIELD_COUNT = 4;
const MILLIS_PER_SECOND = 1000;
const DEFAULT_MAX_COMMITS = 100;
const TIMEOUT_REPO_PROBE_MS = 2000;
const TIMEOUT_BATCH_LOG_MS = 10000;
const TIMEOUT_SINGLE_LOG_MS = 10000;
const MAX_BUFFER_BYTES = 33554432;

const ARG_REV_PARSE = 'rev-parse';
const ARG_HEAD = 'HEAD';
const ARG_INSIDE_WORK_TREE = '--is-inside-work-tree';
const ARG_SHOW_TOPLEVEL = '--show-toplevel';
const ARG_LOG = 'log';
const ARG_NAME_ONLY = '--name-only';
const ARG_DOUBLE_DASH = '--';
const FORMAT_BATCH_STR = '%x1e%H%x1f%an%x1f%ct%x1f%s';
const FORMAT_SINGLE_STR = '%H%x1f%an%x1f%ct%x1f%s%x1e';

const DEFAULT_SPAWN_STDIO: childProcess.StdioOptions = [STDIO_IGNORE, STDIO_PIPE, STDIO_IGNORE];

function parseCommitChunk(
    trimmed: string,
): { record: GitCommitRecord; fileLines: string[] } | null {
    const newlineIdx = trimmed.indexOf('\n');
    const header = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx).trim();
    const fields = header.split(ASCII_FIELD_SEP);
    if (fields.length < MIN_HEADER_FIELD_COUNT) return null;

    const hash = fields[0].trim();
    const author = fields[1].trim();
    const timestampSeconds = parseInt(fields[2].trim(), 10);
    const subject = fields[3].trim();
    if (!hash || !author || isNaN(timestampSeconds)) return null;

    const record: GitCommitRecord = {
        hash,
        author,
        timestamp: timestampSeconds * MILLIS_PER_SECOND,
        subject,
        isBugFix: BUG_FIX_COMMIT_PATTERN.test(subject),
    };

    const fileLines =
        newlineIdx !== -1 ? trimmed.slice(newlineIdx + 1).split(NEWLINE_SPLIT_RE) : [];
    return { record, fileLines };
}

function appendCommitRecord(
    commitsByFile: Map<string, GitCommitRecord[]>,
    normFile: string,
    record: GitCommitRecord,
): void {
    const list = commitsByFile.get(normFile);
    if (list !== undefined) {
        list.push(record);
        return;
    }
    commitsByFile.set(normFile, [record]);
}

function recordCommitFiles(
    commitsByFile: Map<string, GitCommitRecord[]>,
    record: GitCommitRecord,
    fileLines: string[],
): void {
    for (const rawFile of fileLines) {
        const normFile = normalizePathSeparators(rawFile.trim());
        if (!normFile) continue;
        appendCommitRecord(commitsByFile, normFile, record);
    }
}
/**
 * Register a profile under every spelling a caller may use for the same file.
 *
 * Indexing runs in two passes so the winner is decided by precedence, never by the order commits
 * happen to be enumerated. Pass one indexes `absPath` and `relCwd`: those are the two reference
 * frames `mineFileHistory` resolves against (its `targetDir` is a cwd), and they are unique per
 * file, so they always win. Pass two indexes `relTop`, the spelling relative to the repository top
 * level; it is only an alias when no cwd-relative spelling already owns that key, because
 * otherwise a top-level `package.json` would shadow the `auto-refactor/package.json` a caller in
 * that directory asked for and batch mode would disagree with single-file mode. The lowercase
 * twins cover case-insensitive filesystems.
 */
function indexProfileAliases(contexts: readonly ProfileAliasContext[]): void {
    for (const ctx of contexts) {
        ctx.profilesMap.set(ctx.absPath, ctx.profile);
        ctx.profilesMap.set(ctx.absPath.toLowerCase(), ctx.profile);
        ctx.profilesMap.set(ctx.relCwd, ctx.profile);
        ctx.profilesMap.set(ctx.relCwd.toLowerCase(), ctx.profile);
    }
    for (const ctx of contexts) {
        setAliasIfUnclaimed(ctx.profilesMap, ctx.relTop, ctx.profile);
        setAliasIfUnclaimed(ctx.profilesMap, ctx.relTop.toLowerCase(), ctx.profile);
    }
}
/**
 * Register one alias only when nothing has claimed the key yet.
 *
 * @param profilesMap - Inverted index being populated.
 * @param key - Spelling to register.
 * @param profile - Profile the spelling refers to.
 */
function setAliasIfUnclaimed(
    profilesMap: Map<string, GitFileHistoryProfile>,
    key: string,
    profile: GitFileHistoryProfile,
): void {
    if (profilesMap.has(key)) {
        return;
    }
    profilesMap.set(key, profile);
}
/**
 * Batch Git commit log miner analyzing change frequency, author ownership, and churn history.
 */
export class GitHistoryMiner {
    private readonly repoRoot?: string;
    private readonly maxCommits: number;
    private batchCache: Map<string, GitFileHistoryProfile> | null = null;
    private batchCacheCwd: string | null = null;
    /**
     * Commit ceiling the cached batch was mined with.
     *
     * Part of the cache key: a batch mined at 100 commits cannot answer a request for 2000, so the
     * ceiling has to travel with the cache or a later call silently receives a truncated history.
     */
    private batchCacheCommitLimit: number | null = null;
    /**
     * HEAD recorded when the cached batch was mined.
     *
     * Also part of the key. `git log` returns newest-first, so the first hash of the batch is HEAD;
     * comparing it costs nothing while a new commit correctly invalidates the cache.
     */
    private batchCacheHead: string | null = null;
    private batchGitAvailable: boolean = false;
    /** When true, batch profiles are neither read from nor written to disk. */
    private diskCacheDisabled: boolean;

    constructor(options?: { repoRoot?: string; maxCommits?: number; diskCache?: boolean }) {
        this.repoRoot = options?.repoRoot;
        this.maxCommits = options?.maxCommits ?? DEFAULT_MAX_COMMITS;
        this.diskCacheDisabled = options?.diskCache === false;
    }
    /** Enables or disables the on-disk batch cache; a per-scan `--no-cache` needs to flip it on a
     *  miner other scans still share. */
    public setDiskCacheEnabled(enabled: boolean): void {
        this.diskCacheDisabled = !enabled;
    }
    /** Check if git executable is reachable and current directory is inside a git working tree. */
    public isGitRepository(targetDir?: string): boolean {
        const cwd = targetDir || this.repoRoot || process.cwd();
        try {
            const res = childProcess.spawnSync(CMD_GIT, [ARG_REV_PARSE, ARG_INSIDE_WORK_TREE], {
                cwd,
                encoding: ENCODING_UTF8,
                timeout: TIMEOUT_REPO_PROBE_MS,
                stdio: DEFAULT_SPAWN_STDIO,
            });
            return res.status === 0 && res.stdout.trim() === STR_TRUE;
        } catch {
            return false;
        }
    }
    /** Check if batch history cache is currently loaded. */
    public hasBatchCache(): boolean {
        return this.batchCache !== null;
    }
    /** Clear the in-memory batch history cache. */
    public clearCache(): void {
        this.batchCache = null;
        this.batchCacheCwd = null;
        this.batchCacheCommitLimit = null;
        this.batchGitAvailable = false;
    }
    /** Get the Git repository top level directory. */
    public getGitTopLevel(targetDir?: string): string | null {
        const cwd = targetDir || this.repoRoot || process.cwd();
        try {
            const res = childProcess.spawnSync(CMD_GIT, [ARG_REV_PARSE, ARG_SHOW_TOPLEVEL], {
                cwd,
                encoding: ENCODING_UTF8,
                timeout: TIMEOUT_REPO_PROBE_MS,
                stdio: DEFAULT_SPAWN_STDIO,
            });
            return res.status === 0 && res.stdout ? res.stdout.trim() : null;
        } catch {
            return null;
        }
    }
    /**
     * Resolves the repository top level and current HEAD in one Git invocation.
     *
     * `rev-parse --show-toplevel HEAD` answers both questions that the batch mine needs, replacing
     * three separate probes (`--is-inside-work-tree`, `--show-toplevel`, `HEAD`) that each paid a
     * full process spawn. One spawn costs about 80 ms on Windows, so collapsing three into one is
     * the difference between 240 ms and 80 ms of pure overhead per scan.
     *
     * @param cwd - Working directory that may be inside a Git work tree.
     * @returns Top level and HEAD hash, or null when `cwd` is not inside a work tree.
     */
    private resolveRepoIdentity(cwd: string): { topLevel: string; head: string } | null {
        try {
            const res = childProcess.spawnSync(
                CMD_GIT,
                [ARG_REV_PARSE, ARG_SHOW_TOPLEVEL, ARG_HEAD],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_REPO_PROBE_MS,
                    stdio: DEFAULT_SPAWN_STDIO,
                },
            );
            if (res.status !== 0 || !res.stdout) return null;
            const lines = res.stdout.trim().split(NEWLINE_SPLIT_RE);
            if (lines.length < 2) return null;
            const topLevel = lines[0].trim();
            const head = lines[1].trim();
            if (!topLevel || !head) return null;
            return { topLevel, head };
        } catch {
            return null;
        }
    }
    /**
     * Resolves the current HEAD commit hash for cache validation.
     *
     * Deliberately single-purpose: one `rev-parse` costs a fraction of a batch mine, so paying it
     * to prove the cached history is still current is cheaper than re-mining unconditionally.
     *
     * @param cwd - Working directory inside the repository.
     * @returns HEAD hash, or null when the directory is not a Git work tree.
     */
    private resolveHeadHash(cwd: string): string | null {
        try {
            const res = childProcess.spawnSync(CMD_GIT, [ARG_REV_PARSE, ARG_HEAD], {
                cwd,
                encoding: ENCODING_UTF8,
                timeout: TIMEOUT_REPO_PROBE_MS,
                stdio: DEFAULT_SPAWN_STDIO,
            });
            return res.status === 0 && res.stdout ? res.stdout.trim() : null;
        } catch {
            return null;
        }
    }
    /**
     * Mine repository history in batch using a single git log execution.
     *
     * Results are memoized per (directory, commit ceiling) in memory, and additionally per
     * (top level, HEAD, commit ceiling) on disk. Mining shells out to `git log`, which costs about
     * 300 ms on a 1.3k-file history, and a fresh CLI process cannot reuse another process's memory,
     * so the disk layer is what lets a second scan skip the subprocess entirely. Any commit moves
     * HEAD, so a stale payload never matches.
     */
    public mineRepositoryHistoryBatch(
        targetDir?: string,
        maxCommits?: number,
    ): Map<string, GitFileHistoryProfile> {
        const cwd = targetDir || this.repoRoot || process.cwd();
        const commitLimit = maxCommits ?? this.maxCommits;
        // One probe answers "is this a work tree", "what is the top level" and "what is HEAD",
        // which the mine needs anyway. Only a warm cache adds the extra HEAD-only probe, and that
        // still costs less than re-mining.
        const identity = this.resolveRepoIdentity(cwd);
        if (!identity) {
            this.batchGitAvailable = false;
            const emptyMap = new Map<string, GitFileHistoryProfile>();
            this.batchCache = emptyMap;
            this.batchCacheCwd = cwd;
            this.batchCacheCommitLimit = commitLimit;
            this.batchCacheHead = null;
            return emptyMap;
        }

        this.batchGitAvailable = true;
        if (
            this.batchCache !== null &&
            this.batchCacheCwd === cwd &&
            this.batchCacheCommitLimit === commitLimit &&
            this.batchCacheHead === identity.head
        ) {
            return this.batchCache;
        }

        const diskKey: GitHistoryCacheKey = {
            topLevel: identity.topLevel,
            head: identity.head,
            commitLimit,
        };
        const diskHit = this.readDiskCache(cwd, diskKey);
        if (diskHit !== null) {
            this.adoptBatchCache(diskHit, cwd, commitLimit, identity.head);
            return diskHit;
        }

        const profilesMap = new Map<string, GitFileHistoryProfile>();
        const topLevel = identity.topLevel;
        try {
            const res = childProcess.spawnSync(
                CMD_GIT,
                [
                    ARG_LOG,
                    `--max-count=${commitLimit}`,
                    `--format=${FORMAT_BATCH_STR}`,
                    ARG_NAME_ONLY,
                ],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_BATCH_LOG_MS,
                    maxBuffer: MAX_BUFFER_BYTES,
                    stdio: DEFAULT_SPAWN_STDIO,
                },
            );

            if (res.status === 0 && res.stdout) {
                this.populateBatchProfiles(res.stdout, topLevel, cwd, profilesMap);
            }
        } catch (_err) {
            void _err;
        }

        this.batchCache = profilesMap;
        this.batchCacheCwd = cwd;
        this.batchCacheCommitLimit = commitLimit;
        this.batchCacheHead = identity.head;
        saveGitHistoryCache(cwd, diskKey, profilesMap);
        return profilesMap;
    }
    /**
     * Reads the persisted batch for this identity triple, when disk caching is enabled.
     *
     * @param cwd - Directory the scan was launched against.
     * @param key - Identity triple the payload must describe.
     * @returns Cached profile map, or null when caching is off or the payload misses.
     */
    private readDiskCache(
        cwd: string,
        key: GitHistoryCacheKey,
    ): Map<string, GitFileHistoryProfile> | null {
        if (this.diskCacheDisabled) return null;
        return loadGitHistoryCache(cwd, key);
    }
    /**
     * Installs a disk payload as this instance's in-memory batch.
     *
     * @param profiles - Profiles decoded from disk.
     * @param cwd - Directory the scan was launched against.
     * @param commitLimit - Commit ceiling that produced the payload.
     * @param head - HEAD the payload was mined at.
     */
    private adoptBatchCache(
        profiles: Map<string, GitFileHistoryProfile>,
        cwd: string,
        commitLimit: number,
        head: string,
    ): void {
        this.batchCache = profiles;
        this.batchCacheCwd = cwd;
        this.batchCacheCommitLimit = commitLimit;
        this.batchCacheHead = head;
    }
    /** Preload repository history in batch into memory. */
    public preloadRepository(
        targetDir?: string,
        maxCommits?: number,
    ): Map<string, GitFileHistoryProfile> {
        return this.mineRepositoryHistoryBatch(targetDir, maxCommits);
    }

    private populateBatchProfiles(
        rawOutput: string,
        topLevel: string,
        cwd: string,
        profilesMap: Map<string, GitFileHistoryProfile>,
    ): void {
        const commitsByFile = new Map<string, GitCommitRecord[]>();
        const chunks = rawOutput.split(ASCII_RECORD_SEP);

        for (const chunk of chunks) {
            const trimmed = chunk.trim();
            if (!trimmed) continue;
            const parsed = parseCommitChunk(trimmed);
            if (!parsed) continue;
            recordCommitFiles(commitsByFile, parsed.record, parsed.fileLines);
        }

        const profiles: ProfileAliasContext[] = [];
        for (const [relTop, commits] of commitsByFile.entries()) {
            const absPath = normalizePathSeparators(path.resolve(topLevel, relTop));
            const relCwd = normalizePathSeparators(path.relative(cwd, absPath));
            const profile = this.aggregateCommitRecords(absPath, commits);
            profile.isGitAvailable = true;
            profiles.push({ profilesMap, profile, absPath, relCwd, relTop });
        }
        indexProfileAliases(profiles);
    }
    /** Safely extract the file history profile using `git log`. */
    public mineFileHistory(targetFilePath: string, targetDir?: string): GitFileHistoryProfile {
        const cwd = targetDir || this.repoRoot || process.cwd();

        if (this.batchCache) {
            const normPath = normalizePathSeparators(targetFilePath);
            const cached =
                this.batchCache.get(normPath) || this.batchCache.get(normPath.toLowerCase());
            if (cached) {
                return cached;
            }
            return {
                filePath: targetFilePath,
                isGitAvailable: this.batchGitAvailable,
                totalCommits: 0,
                bugFixCommits: 0,
                authorCommitCounts: {},
                uniqueAuthorsCount: 0,
                firstSeenTimestamp: null,
                lastModifiedTimestamp: null,
                recentCommits: [],
            };
        }

        const fallbackProfile: GitFileHistoryProfile = {
            filePath: targetFilePath,
            isGitAvailable: false,
            totalCommits: 0,
            bugFixCommits: 0,
            authorCommitCounts: {},
            uniqueAuthorsCount: 0,
            firstSeenTimestamp: null,
            lastModifiedTimestamp: null,
            recentCommits: [],
        };

        if (!this.isGitRepository(cwd)) {
            return fallbackProfile;
        }

        try {
            const relativePath = path.isAbsolute(targetFilePath)
                ? path.relative(cwd, targetFilePath)
                : targetFilePath;

            const res = childProcess.spawnSync(
                CMD_GIT,
                [
                    ARG_LOG,
                    `--max-count=${this.maxCommits}`,
                    `--format=${FORMAT_SINGLE_STR}`,
                    ARG_DOUBLE_DASH,
                    relativePath,
                ],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_SINGLE_LOG_MS,
                    stdio: DEFAULT_SPAWN_STDIO,
                },
            );

            if (res.status !== 0 || res.stdout === undefined || res.stdout === null) {
                return fallbackProfile;
            }

            const rawCommits = this.parseGitLogOutput(res.stdout);
            const profile = this.aggregateCommitRecords(targetFilePath, rawCommits);
            profile.isGitAvailable = true;
            return profile;
        } catch {
            return fallbackProfile;
        }
    }
    /** Parse raw git log string delimited by ASCII unit and record separators. */
    public parseGitLogOutput(rawOutput: string): GitCommitRecord[] {
        const records: GitCommitRecord[] = [];
        const rawEntries = rawOutput.split(ASCII_RECORD_SEP);

        for (const entry of rawEntries) {
            const trimmed = entry.trim();
            if (!trimmed) continue;

            const fields = trimmed.split(ASCII_FIELD_SEP);
            if (fields.length < MIN_HEADER_FIELD_COUNT) continue;

            const hash = fields[0].trim();
            const author = fields[1].trim();
            const timestampSeconds = parseInt(fields[2].trim(), 10);
            const subject = fields[3].trim();

            if (!hash || !author || isNaN(timestampSeconds)) continue;

            records.push({
                hash,
                author,
                timestamp: timestampSeconds * MILLIS_PER_SECOND,
                subject,
                isBugFix: BUG_FIX_COMMIT_PATTERN.test(subject),
            });
        }

        return records;
    }
    /** Aggregate parsed commit records into structured file history. */
    public aggregateCommitRecords(
        filePath: string,
        commits: GitCommitRecord[],
    ): GitFileHistoryProfile {
        const authorCommitCounts: Record<string, number> = {};
        let bugFixCommits = 0;
        let firstSeenTimestamp: number | null = null;
        let lastModifiedTimestamp: number | null = null;

        for (const commit of commits) {
            authorCommitCounts[commit.author] = (authorCommitCounts[commit.author] || 0) + 1;

            if (commit.isBugFix) {
                bugFixCommits++;
            }

            if (lastModifiedTimestamp === null || commit.timestamp > lastModifiedTimestamp) {
                lastModifiedTimestamp = commit.timestamp;
            }
            if (firstSeenTimestamp === null || commit.timestamp < firstSeenTimestamp) {
                firstSeenTimestamp = commit.timestamp;
            }
        }

        return {
            filePath,
            isGitAvailable: true,
            totalCommits: commits.length,
            bugFixCommits,
            authorCommitCounts,
            uniqueAuthorsCount: Object.keys(authorCommitCounts).length,
            firstSeenTimestamp,
            lastModifiedTimestamp,
            recentCommits: commits,
        };
    }
}
