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
const BACKSLASH_GLOBAL_RE = /\\/g;

const STR_TRUE = 'true';
const MIN_HEADER_FIELD_COUNT = 4;
const MILLIS_PER_SECOND = 1000;
const DEFAULT_MAX_COMMITS = 100;
const TIMEOUT_REPO_PROBE_MS = 2000;
const TIMEOUT_BATCH_LOG_MS = 10000;
const TIMEOUT_SINGLE_LOG_MS = 3000;
const MAX_BUFFER_BYTES = 33554432;

const ARG_REV_PARSE = 'rev-parse';
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
        const normFile = rawFile.trim().replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH);
        if (!normFile) continue;
        appendCommitRecord(commitsByFile, normFile, record);
    }
}

function indexProfileAliases(ctx: ProfileAliasContext): void {
    ctx.profilesMap.set(ctx.absPath, ctx.profile);
    ctx.profilesMap.set(ctx.absPath.toLowerCase(), ctx.profile);
    ctx.profilesMap.set(ctx.relCwd, ctx.profile);
    ctx.profilesMap.set(ctx.relCwd.toLowerCase(), ctx.profile);
    ctx.profilesMap.set(ctx.relTop, ctx.profile);
    ctx.profilesMap.set(ctx.relTop.toLowerCase(), ctx.profile);
}

/**
 * Batch Git commit log miner analyzing change frequency, author ownership, and churn history.
 */
export class GitHistoryMiner {
    private readonly repoRoot?: string;
    private readonly maxCommits: number;
    private batchCache: Map<string, GitFileHistoryProfile> | null = null;
    private batchCacheCwd: string | null = null;
    private batchGitAvailable: boolean = false;

    constructor(options?: { repoRoot?: string; maxCommits?: number }) {
        this.repoRoot = options?.repoRoot;
        this.maxCommits = options?.maxCommits ?? DEFAULT_MAX_COMMITS;
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

    /** Mine repository history in batch using a single git log execution. */
    public mineRepositoryHistoryBatch(
        targetDir?: string,
        maxCommits?: number,
    ): Map<string, GitFileHistoryProfile> {
        const cwd = targetDir || this.repoRoot || process.cwd();
        const profilesMap = new Map<string, GitFileHistoryProfile>();
        this.batchGitAvailable = this.isGitRepository(cwd);
        if (!this.batchGitAvailable) {
            this.batchCache = profilesMap;
            this.batchCacheCwd = cwd;
            return profilesMap;
        }

        const topLevel = this.getGitTopLevel(cwd);
        if (!topLevel) {
            this.batchCache = profilesMap;
            this.batchCacheCwd = cwd;
            return profilesMap;
        }

        const commitLimit = maxCommits ?? this.maxCommits;
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
        return profilesMap;
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

        for (const [relTop, commits] of commitsByFile.entries()) {
            const absPath = path
                .resolve(topLevel, relTop)
                .replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH);
            const relCwd = path.relative(cwd, absPath).replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH);
            const profile = this.aggregateCommitRecords(absPath, commits);
            profile.isGitAvailable = true;
            indexProfileAliases({ profilesMap, profile, absPath, relCwd, relTop });
        }
    }

    /** Safely extract the file history profile using `git log`. */
    public mineFileHistory(targetFilePath: string, targetDir?: string): GitFileHistoryProfile {
        const cwd = targetDir || this.repoRoot || process.cwd();

        if (this.batchCache) {
            const normPath = targetFilePath.replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH);
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
