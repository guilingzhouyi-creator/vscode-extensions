/**
 * Module: Core Evolution — Temporal Coupling Detector
 * File Path: src/core/evolution/temporal-coupling-detector.ts
 * Architecture Role: Detects implicit temporal coupling and cross-module shotgun surgery patterns
 *   by computing co-change frequency and Jaccard similarity across git commit histories.
 * Dependencies & Triggers: Consumes GitHistoryMiner commit logs or structured CommitChangeSets;
 *   invoked by architecture quality linters, preflight audits, and refactoring planning agents.
 * Responsibilities:
 *   1. Mine multi-file commit changesets from git history logs or in-memory profiles.
 *   2. Compute pairwise co-change frequency and Jaccard similarity coefficients.
 *   3. Filter significant temporal coupling pairs (default Jaccard similarity >= 0.6).
 *   4. Identify cross-module shotgun surgery violations where unrelated subsystems change together.
 *   5. Produce actionable coupling diagnostic reports with robust non-git degradation.
 * Exit Semantics & Design Rationale: Never crashes on empty commits, missing git,
 *   or malformed data; safely returns an empty diagnostic report with zero warnings.
 */

import * as childProcess from 'child_process';
import { nativeCore } from '../native/native-bridge';

/**
 * Structured commit representation containing all files touched in a single change.
 */
export interface CommitChangeSet {
    commitHash: string;
    changedFiles: string[];
    timestamp?: number;
    author?: string;
    message?: string;
}

/**
 * An identified temporally coupled file pair.
 */
export interface TemporalCouplingPair {
    /** First file in the pair (lexicographically ordered) */
    fileA: string;
    /** Second file in the pair */
    fileB: string;
    /** Number of commits where both files changed together */
    sharedCommits: number;
    /** Number of commits touching fileA */
    commitsA: number;
    /** Number of commits touching fileB */
    commitsB: number;
    /** Jaccard similarity coefficient |A ∩ B| / |A ∪ B| in [0.0, 1.0] */
    jaccardSimilarity: number;
    /** Coupling percentage e.g. 75.0 */
    couplingPercentage: number;
    /** Whether the pair spans across different architectural modules/directories */
    isCrossModule: boolean;
    /** Architectural module/domain for fileA */
    moduleA: string;
    /** Architectural module/domain for fileB */
    moduleB: string;
    /** Warning severity level */
    warningLevel: 'critical' | 'high' | 'medium';
    /** Human-readable warning message */
    warningMessage: string;
}

/**
 * Overall summary report of temporal coupling analysis.
 */
export interface TemporalCouplingReport {
    /** Detected coupled file pairs meeting criteria */
    pairs: TemporalCouplingPair[];
    /** Total commit count inspected */
    totalCommitsAnalyzed: number;
    /** Total unique files tracked across commits */
    totalFilesAnalyzed: number;
    /** Count of cross-module coupling instances (shotgun surgery) */
    crossModuleWarningCount: number;
    /** Whether git mining was available */
    isGitAvailable: boolean;
}

/**
 * Configuration options for temporal coupling detection.
 */
export interface TemporalCouplingOptions {
    /** Minimum Jaccard similarity threshold to report [default: 0.6] */
    minJaccardSimilarity?: number;
    /** Minimum shared co-change commits required to eliminate small-sample noise [default: 2] */
    minSharedCommits?: number;
    /** Maximum commit history depth to inspect [default: 500] */
    maxCommits?: number;
    /**
     * Maximum files in a single commit before treating as bulk changes and ignoring
     * [default: 50]
     */
    maxFilesPerCommit?: number;
    /** Target directory for git repository probe [default: process.cwd()] */
    targetDir?: string;
    /** Optional module boundary resolver function: (filePath: string) => string */
    resolveModule?: (filePath: string) => string;
}

const DEFAULT_MIN_JACCARD = 0.6;
const DEFAULT_MIN_SHARED_COMMITS = 2;
const DEFAULT_MAX_COMMITS = 500;
const DEFAULT_MAX_FILES_PER_COMMIT = 50;

const CMD_GIT = 'git';
const ENCODING_UTF8 = 'utf8';
const TIMEOUT_GIT_LOG_MS = 10000;
const TIMEOUT_GIT_PROBE_MS = 2000;
const MAX_BUFFER_BYTES = 33554432;
const ASCII_RECORD_SEP = '\x1e';
const ASCII_FIELD_SEP = '\x1f';
const PAIR_DELIMITER = '\x1d';

const BACKSLASH_GLOBAL_RE = /\\/g;
const FORWARD_SLASH = '/';

/**
 * Normalize file path to forward slashes without leading/trailing slashes.
 *
 * @param rawPath - Raw file path from git log or options.
 * @returns Normalized forward-slash relative path.
 */
export function normalizeEvolutionPath(rawPath: string): string {
    return rawPath.trim().replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH).replace(/^\/+/, '');
}

/**
 * Default architectural module resolver extracting top-level subsystem boundaries.
 *
 * @param filePath - Path to inspect.
 * @returns Inferred module or subsystem identifier string.
 */
export function defaultModuleResolver(filePath: string): string {
    const normalized = normalizeEvolutionPath(filePath);
    const parts = normalized.split(FORWARD_SLASH);
    const dirParts = parts.length > 1 ? parts.slice(0, parts.length - 1) : parts;

    const srcIndex = dirParts.indexOf('src');
    if (srcIndex !== -1) {
        const subDirs = dirParts.slice(srcIndex);
        if (subDirs.length >= 3) {
            return subDirs.slice(0, 3).join(FORWARD_SLASH);
        }
        return subDirs.join(FORWARD_SLASH);
    }

    if (dirParts.length >= 2) {
        return dirParts.slice(0, 2).join(FORWARD_SLASH);
    }
    return dirParts[0] || 'root';
}

function resolveCouplingWarningLevel(
    isCrossModule: boolean,
    jaccard: number,
): 'critical' | 'high' | 'medium' {
    if (isCrossModule && jaccard >= 0.8) {
        return 'critical';
    }
    if (isCrossModule || jaccard >= 0.8) {
        return 'high';
    }
    return 'medium';
}

function createWarningMessage(
    fileA: string,
    fileB: string,
    moduleA: string,
    moduleB: string,
    sharedCommits: number,
    couplingPct: number,
    isCrossModule: boolean,
): string {
    if (isCrossModule) {
        return (
            `Cross-module shotgun surgery detected: '${fileA}' (${moduleA}) and '${fileB}' (${moduleB}) ` +
            `frequently change together in ${sharedCommits} commits (Jaccard similarity: ${couplingPct}%). ` +
            `Extract a shared contract or unify module responsibilities.`
        );
    }
    return (
        `Intra-module temporal coupling detected: '${fileA}' and '${fileB}' ` +
        `frequently change together in ${sharedCommits} commits (Jaccard similarity: ${couplingPct}%).`
    );
}

/**
 * Detector for temporal co-change coupling and architectural shotgun surgery.
 */
export class TemporalCouplingDetector {
    private readonly minJaccard: number;
    private readonly minSharedCommits: number;
    private readonly maxCommits: number;
    private readonly maxFilesPerCommit: number;
    private readonly resolveModule: (filePath: string) => string;

    constructor(options?: TemporalCouplingOptions) {
        this.minJaccard = options?.minJaccardSimilarity ?? DEFAULT_MIN_JACCARD;
        this.minSharedCommits = options?.minSharedCommits ?? DEFAULT_MIN_SHARED_COMMITS;
        this.maxCommits = options?.maxCommits ?? DEFAULT_MAX_COMMITS;
        this.maxFilesPerCommit = options?.maxFilesPerCommit ?? DEFAULT_MAX_FILES_PER_COMMIT;
        this.resolveModule = options?.resolveModule ?? defaultModuleResolver;
    }

    /**
     * Pure-data detector analyzing in-memory commit change sets.
     */
    public detectFromChangeSets(
        changeSets: CommitChangeSet[],
        overrideOptions?: TemporalCouplingOptions,
    ): TemporalCouplingReport {
        if (!Array.isArray(changeSets) || changeSets.length === 0) {
            return this.createEmptyReport(true);
        }

        const minJaccard = overrideOptions?.minJaccardSimilarity ?? this.minJaccard;
        const minShared = overrideOptions?.minSharedCommits ?? this.minSharedCommits;
        const maxFiles = overrideOptions?.maxFilesPerCommit ?? this.maxFilesPerCommit;
        const moduleResolver = overrideOptions?.resolveModule ?? this.resolveModule;

        const fileToId = new Map<string, number>();
        const idToFile: string[] = [];

        const getFileId = (file: string): number => {
            let id = fileToId.get(file);
            if (id === undefined) {
                id = idToFile.length;
                fileToId.set(file, id);
                idToFile.push(file);
            }
            return id;
        };

        const mappedChangeSets: number[][] = [];
        for (const cs of changeSets) {
            if (!cs.changedFiles || cs.changedFiles.length > maxFiles) {
                continue;
            }
            const ids: number[] = [];
            for (const f of cs.changedFiles) {
                const norm = normalizeEvolutionPath(f);
                if (norm) {
                    ids.push(getFileId(norm));
                }
            }
            if (ids.length > 0) {
                mappedChangeSets.push(ids);
            }
        }

        const nativePairs = nativeCore.computeTemporalCoupling(
            mappedChangeSets,
            minShared,
            minJaccard,
        );

        const pairs: TemporalCouplingPair[] = [];
        let crossModuleWarningCount = 0;

        for (const np of nativePairs) {
            const rawA = idToFile[np.fileA];
            const rawB = idToFile[np.fileB];
            const [fileA, fileB] = rawA.localeCompare(rawB) <= 0 ? [rawA, rawB] : [rawB, rawA];
            const commitsA = fileA === rawA ? np.commitsA : np.commitsB;
            const commitsB = fileA === rawA ? np.commitsB : np.commitsA;

            const moduleA = moduleResolver(fileA);
            const moduleB = moduleResolver(fileB);
            const isCrossModule = moduleA !== moduleB;
            if (isCrossModule) {
                crossModuleWarningCount++;
            }

            const couplingPercentage = +(np.jaccardSimilarity * 100).toFixed(1);
            const warningLevel = resolveCouplingWarningLevel(isCrossModule, np.jaccardSimilarity);
            const warningMessage = createWarningMessage(
                fileA,
                fileB,
                moduleA,
                moduleB,
                np.sharedCommits,
                couplingPercentage,
                isCrossModule,
            );

            pairs.push({
                fileA,
                fileB,
                sharedCommits: np.sharedCommits,
                commitsA,
                commitsB,
                jaccardSimilarity: np.jaccardSimilarity,
                couplingPercentage,
                isCrossModule,
                moduleA,
                moduleB,
                warningLevel,
                warningMessage,
            });
        }

        // Sort descending by Jaccard similarity, then shared commit count
        pairs.sort((a, b) => {
            if (b.jaccardSimilarity !== a.jaccardSimilarity) {
                return b.jaccardSimilarity - a.jaccardSimilarity;
            }
            if (b.sharedCommits !== a.sharedCommits) {
                return b.sharedCommits - a.sharedCommits;
            }
            return a.fileA.localeCompare(b.fileA);
        });

        return {
            pairs,
            totalCommitsAnalyzed: changeSets.length,
            totalFilesAnalyzed: fileToId.size,
            crossModuleWarningCount,
            isGitAvailable: true,
        };
    }

    /**
     * Parse raw git log output into structured CommitChangeSet records.
     */
    public parseGitLogOutput(rawOutput: string): CommitChangeSet[] {
        if (!rawOutput || typeof rawOutput !== 'string') {
            return [];
        }

        const changeSets: CommitChangeSet[] = [];
        const chunks = rawOutput.split(ASCII_RECORD_SEP);

        for (const chunk of chunks) {
            const trimmed = chunk.trim();
            if (!trimmed) {
                continue;
            }

            const newlineIdx = trimmed.indexOf('\n');
            const header = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx).trim();
            const fields = header.split(ASCII_FIELD_SEP);
            if (fields.length < 4) {
                continue;
            }

            const commitHash = fields[0].trim();
            const author = fields[1].trim();
            const timestampSec = parseInt(fields[2].trim(), 10);
            const message = fields[3].trim();

            if (!commitHash) {
                continue;
            }

            const fileLines = newlineIdx !== -1 ? trimmed.slice(newlineIdx + 1).split(/\r?\n/) : [];
            const changedFiles: string[] = [];

            for (const line of fileLines) {
                const normPath = normalizeEvolutionPath(line);
                if (normPath && !changedFiles.includes(normPath)) {
                    changedFiles.push(normPath);
                }
            }

            changeSets.push({
                commitHash,
                changedFiles,
                timestamp: Number.isNaN(timestampSec) ? undefined : timestampSec * 1000,
                author,
                message,
            });
        }

        return changeSets;
    }

    /**
     * Inspect Git repository history and compute temporal coupling report.
     * Guaranteed never to throw; gracefully degrades if git is absent or fails.
     */
    public detectFromRepository(
        targetDir?: string,
        overrideOptions?: TemporalCouplingOptions,
    ): TemporalCouplingReport {
        const cwd = targetDir || process.cwd();
        if (!this.isGitRepository(cwd)) {
            return this.createEmptyReport(false);
        }

        const commitLimit = overrideOptions?.maxCommits ?? this.maxCommits;
        try {
            const formatStr = `${ASCII_RECORD_SEP}%H${ASCII_FIELD_SEP}%an${ASCII_FIELD_SEP}%ct${ASCII_FIELD_SEP}%s`;
            const res = childProcess.spawnSync(
                CMD_GIT,
                ['log', `--max-count=${commitLimit}`, `--format=${formatStr}`, '--name-only'],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_GIT_LOG_MS,
                    maxBuffer: MAX_BUFFER_BYTES,
                    stdio: ['ignore', 'pipe', 'ignore'],
                },
            );

            if (res.status !== 0 || !res.stdout) {
                return this.createEmptyReport(false);
            }

            const changeSets = this.parseGitLogOutput(res.stdout);
            const report = this.detectFromChangeSets(changeSets, overrideOptions);
            report.isGitAvailable = true;
            return report;
        } catch {
            return this.createEmptyReport(false);
        }
    }

    /**
     * Check if git command is executable and cwd is inside a git work tree.
     */
    public isGitRepository(targetDir?: string): boolean {
        const cwd = targetDir || process.cwd();
        try {
            const res = childProcess.spawnSync(CMD_GIT, ['rev-parse', '--is-inside-work-tree'], {
                cwd,
                encoding: ENCODING_UTF8,
                timeout: TIMEOUT_GIT_PROBE_MS,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            return res.status === 0 && res.stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    /**
     * Populate file commit frequencies and pair co-occurrence counts.
     */
    private accumulateCoChanges(
        changeSets: CommitChangeSet[],
        maxFilesPerCommit: number,
        fileCommitCounts: Map<string, number>,
        pairSharedCounts: Map<string, number>,
    ): void {
        for (const cs of changeSets) {
            if (!cs.changedFiles || cs.changedFiles.length > maxFilesPerCommit) {
                continue;
            }

            const uniqueFiles = Array.from(
                new Set(cs.changedFiles.map(normalizeEvolutionPath)),
            ).filter(Boolean);
            if (uniqueFiles.length < 2) {
                if (uniqueFiles.length === 1) {
                    const single = uniqueFiles[0];
                    fileCommitCounts.set(single, (fileCommitCounts.get(single) || 0) + 1);
                }
                continue;
            }

            // Track individual file occurrences
            for (const file of uniqueFiles) {
                fileCommitCounts.set(file, (fileCommitCounts.get(file) || 0) + 1);
            }

            // Track co-changing pairs
            uniqueFiles.sort();
            for (let i = 0; i < uniqueFiles.length; i++) {
                const fileA = uniqueFiles[i];
                for (let j = i + 1; j < uniqueFiles.length; j++) {
                    const fileB = uniqueFiles[j];
                    const key = `${fileA}${PAIR_DELIMITER}${fileB}`;
                    pairSharedCounts.set(key, (pairSharedCounts.get(key) || 0) + 1);
                }
            }
        }
    }

    /**
     * Produce an empty baseline TemporalCouplingReport.
     */
    public createEmptyReport(isGitAvailable: boolean): TemporalCouplingReport {
        return {
            pairs: [],
            totalCommitsAnalyzed: 0,
            totalFilesAnalyzed: 0,
            crossModuleWarningCount: 0,
            isGitAvailable,
        };
    }
}
