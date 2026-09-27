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

/**
 * Structured record representing a single git commit modifying a file.
 */
export interface GitCommitRecord {
    hash: string;
    author: string;
    timestamp: number; // Unix timestamp in milliseconds
    subject: string;
    isBugFix: boolean;
}

/**
 * Aggregated evolution history profile for a specific file.
 */
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

/** Regex pattern matching commit subjects indicating bug repairs or hotfixes */
export const BUG_FIX_COMMIT_PATTERN =
    /\b(?:fix|fixes|fixed|bug|bugs|patch|hotfix|resolve|resolves|resolved|defect|issue)\b/i;

function parseCommitChunk(
    trimmed: string,
): { record: GitCommitRecord; fileLines: string[] } | null {
    const newlineIdx = trimmed.indexOf('\n');
    const header = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx).trim();
    const fields = header.split('\x1f');
    if (fields.length < 4) return null;

    const hash = fields[0].trim();
    const author = fields[1].trim();
    const timestampSeconds = parseInt(fields[2].trim(), 10);
    const subject = fields[3].trim();
    if (!hash || !author || isNaN(timestampSeconds)) return null;

    const record: GitCommitRecord = {
        hash,
        author,
        timestamp: timestampSeconds * 1000,
        subject,
        isBugFix: BUG_FIX_COMMIT_PATTERN.test(subject),
    };

    const fileLines = newlineIdx !== -1 ? trimmed.slice(newlineIdx + 1).split(/\r?\n/) : [];
    return { record, fileLines };
}

function recordCommitFiles(
    commitsByFile: Map<string, GitCommitRecord[]>,
    record: GitCommitRecord,
    fileLines: string[],
): void {
    for (const rawFile of fileLines) {
        const normFile = rawFile.trim().replace(/\\/g, '/');
        if (!normFile) continue;
        let list = commitsByFile.get(normFile);
        if (!list) {
            list = [];
            commitsByFile.set(normFile, list);
        }
        list.push(record);
    }
}

function indexProfileAliases(
    profilesMap: Map<string, GitFileHistoryProfile>,
    profile: GitFileHistoryProfile,
    absPath: string,
    relCwd: string,
    relTop: string,
): void {
    profilesMap.set(absPath, profile);
    profilesMap.set(absPath.toLowerCase(), profile);
    profilesMap.set(relCwd, profile);
    profilesMap.set(relCwd.toLowerCase(), profile);
    profilesMap.set(relTop, profile);
    profilesMap.set(relTop.toLowerCase(), profile);
}

/**
 * Batch Git commit log miner analyzing change frequency, author ownership, and churn history.
 */
export class GitHistoryMiner {
    private readonly repoRoot?: string;
    private readonly maxCommits: number;

    constructor(options?: { repoRoot?: string; maxCommits?: number }) {
        this.repoRoot = options?.repoRoot;
        this.maxCommits = options?.maxCommits ?? 100;
    }

    /**
     * Check if git executable is reachable and current directory is inside a git working tree.
     */
    public isGitRepository(targetDir?: string): boolean {
        const cwd = targetDir || this.repoRoot || process.cwd();
        try {
            const res = childProcess.spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
                cwd,
                encoding: 'utf8',
                timeout: 2000,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            return res.status === 0 && res.stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    private batchCache: Map<string, GitFileHistoryProfile> | null = null;
    private batchCacheCwd: string | null = null;

    /**
     * Check if batch history cache is currently loaded.
     *
     * @returns Boolean indicating whether batch cache is populated.
     */
    public hasBatchCache(): boolean {
        return this.batchCache !== null;
    }

    /**
     * Clear the in-memory batch history cache.
     */
    public clearCache(): void {
        this.batchCache = null;
        this.batchCacheCwd = null;
    }

    /**
     * Get the Git repository top level directory.
     *
     * @param targetDir - Optional root directory.
     * @returns Git root path or null if not in a git repository.
     */
    public getGitTopLevel(targetDir?: string): string | null {
        const cwd = targetDir || this.repoRoot || process.cwd();
        try {
            const res = childProcess.spawnSync('git', ['rev-parse', '--show-toplevel'], {
                cwd,
                encoding: 'utf8',
                timeout: 2000,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            return res.status === 0 && res.stdout ? res.stdout.trim() : null;
        } catch {
            return null;
        }
    }

    /**
     * Mine repository history in batch using a single git log execution.
     * Builds an in-memory inverted index of file paths to commit records.
     *
     * @param targetDir - Optional root directory.
     * @param maxCommits - Optional maximum number of commits to mine.
     * @returns Map of relative file paths to aggregated GitFileHistoryProfile.
     */
    public mineRepositoryHistoryBatch(
        targetDir?: string,
        maxCommits?: number,
    ): Map<string, GitFileHistoryProfile> {
        const cwd = targetDir || this.repoRoot || process.cwd();
        const profilesMap = new Map<string, GitFileHistoryProfile>();
        if (!this.isGitRepository(cwd)) {
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
            const formatStr = '%x1e%H%x1f%an%x1f%ct%x1f%s';
            const res = childProcess.spawnSync(
                'git',
                ['log', `--max-count=${commitLimit}`, `--format=${formatStr}`, '--name-only'],
                {
                    cwd,
                    encoding: 'utf8',
                    timeout: 10000,
                    maxBuffer: 32 * 1024 * 1024,
                    stdio: ['ignore', 'pipe', 'ignore'],
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

    /**
     * Preload repository history in batch into memory.
     *
     * @param targetDir - Optional root directory.
     * @param maxCommits - Optional maximum number of commits.
     * @returns Map of indexed file profiles.
     */
    public preloadRepository(
        targetDir?: string,
        maxCommits?: number,
    ): Map<string, GitFileHistoryProfile> {
        return this.mineRepositoryHistoryBatch(targetDir, maxCommits);
    }

    /**
     * Parse batch git log output and populate profiles map.
     *
     * @param rawOutput - Raw git log output with name-only diffs.
     * @param topLevel - Git top-level root path.
     * @param cwd - Current execution working directory.
     * @param profilesMap - Destination map for file profiles.
     */
    private populateBatchProfiles(
        rawOutput: string,
        topLevel: string,
        cwd: string,
        profilesMap: Map<string, GitFileHistoryProfile>,
    ): void {
        const commitsByFile = new Map<string, GitCommitRecord[]>();
        const chunks = rawOutput.split('\x1e');

        for (const chunk of chunks) {
            const trimmed = chunk.trim();
            if (!trimmed) continue;
            const parsed = parseCommitChunk(trimmed);
            if (!parsed) continue;
            recordCommitFiles(commitsByFile, parsed.record, parsed.fileLines);
        }

        for (const [relTop, commits] of commitsByFile.entries()) {
            const absPath = path.resolve(topLevel, relTop).replace(/\\/g, '/');
            const relCwd = path.relative(cwd, absPath).replace(/\\/g, '/');
            const profile = this.aggregateCommitRecords(absPath, commits);
            profile.isGitAvailable = true;
            indexProfileAliases(profilesMap, profile, absPath, relCwd, relTop);
        }
    }

    /**
     * Safely extract the file history profile using `git log`.
     *
     * @param targetFilePath - Absolute or relative file path.
     * @param targetDir - Optional root directory for git execution.
     * @returns Aggregated GitFileHistoryProfile with seamless fallback.
     */
    public mineFileHistory(targetFilePath: string, targetDir?: string): GitFileHistoryProfile {
        const cwd = targetDir || this.repoRoot || process.cwd();
        if (this.batchCache) {
            const normPath = targetFilePath.replace(/\\/g, '/');
            const cached =
                this.batchCache.get(normPath) || this.batchCache.get(normPath.toLowerCase());
            if (cached) {
                return cached;
            }
            return {
                filePath: targetFilePath,
                isGitAvailable: true,
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
            // Format: hash%x1fauthor%x1f%ct%x1fsymbolic subject%x1e
            const formatStr = '%H%x1f%an%x1f%ct%x1f%s%x1e';
            const relativePath = path.isAbsolute(targetFilePath)
                ? path.relative(cwd, targetFilePath)
                : targetFilePath;

            const res = childProcess.spawnSync(
                'git',
                [
                    'log',
                    `--max-count=${this.maxCommits}`,
                    `--format=${formatStr}`,
                    '--',
                    relativePath,
                ],
                {
                    cwd,
                    encoding: 'utf8',
                    timeout: 3000,
                    stdio: ['ignore', 'pipe', 'ignore'],
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

    /**
     * Parse raw git log string delimited by ASCII unit and record separators.
     */
    public parseGitLogOutput(rawOutput: string): GitCommitRecord[] {
        const records: GitCommitRecord[] = [];
        const rawEntries = rawOutput.split('\x1e');

        for (const entry of rawEntries) {
            const trimmed = entry.trim();
            if (!trimmed) continue;

            const fields = trimmed.split('\x1f');
            if (fields.length < 4) continue;

            const hash = fields[0].trim();
            const author = fields[1].trim();
            const timestampSeconds = parseInt(fields[2].trim(), 10);
            const subject = fields[3].trim();

            if (!hash || !author || isNaN(timestampSeconds)) continue;

            records.push({
                hash,
                author,
                timestamp: timestampSeconds * 1000,
                subject,
                isBugFix: BUG_FIX_COMMIT_PATTERN.test(subject),
            });
        }

        return records;
    }

    /**
     * Aggregate parsed commit records into structured file history.
     */
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
