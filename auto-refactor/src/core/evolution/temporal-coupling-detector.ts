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
import { IdInterner } from '../data-structures/id-interner';

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
const DEFAULT_PRECISION_SCALE = 100;
const MIN_MODULE_DEPTH_SUBDIRS = 3;
const DEFAULT_MODULE_DEPTH = 2;
const MIN_LOG_HEADER_FIELDS = 4;
const MS_PER_SECOND = 1000;

const CMD_GIT = 'git';
const ENCODING_UTF8 = 'utf8';
const TIMEOUT_GIT_LOG_MS = 10000;
const TIMEOUT_GIT_PROBE_MS = 2000;
const MAX_BUFFER_BYTES = 33554432;
const ASCII_RECORD_SEP = '\x1e';
const ASCII_FIELD_SEP = '\x1f';
const PAIR_DELIMITER = '\x1d';

const STDIO_IGNORE_PIPE_IGNORE: [childProcess.IOType, childProcess.IOType, childProcess.IOType] = [
    'ignore',
    'pipe',
    'ignore',
];

const BACKSLASH_GLOBAL_RE = /\\/g;
const FORWARD_SLASH = '/';

interface NativeCouplingPair {
    readonly fileA: number;
    readonly fileB: number;
    readonly commitsA: number;
    readonly commitsB: number;
    readonly sharedCommits: number;
    readonly jaccardSimilarity: number;
}

interface CouplingWarningParams {
    readonly fileA: string;
    readonly fileB: string;
    readonly moduleA: string;
    readonly moduleB: string;
    readonly sharedCommits: number;
    readonly couplingPct: number;
    readonly isCrossModule: boolean;
}

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
export function resolveDefaultModule(filePath: string): string {
    const normalized = normalizeEvolutionPath(filePath);
    const parts = normalized.split(FORWARD_SLASH);
    const dirParts = parts.length > 1 ? parts.slice(0, parts.length - 1) : parts;

    const srcIndex = dirParts.indexOf('src');
    if (srcIndex !== -1) {
        const subDirs = dirParts.slice(srcIndex);
        if (subDirs.length >= MIN_MODULE_DEPTH_SUBDIRS) {
            return subDirs.slice(0, MIN_MODULE_DEPTH_SUBDIRS).join(FORWARD_SLASH);
        }
        return subDirs.join(FORWARD_SLASH);
    }

    if (dirParts.length >= DEFAULT_MODULE_DEPTH) {
        return dirParts.slice(0, DEFAULT_MODULE_DEPTH).join(FORWARD_SLASH);
    }
    return dirParts[0] || 'root';
}

/** Backward compatibility alias for resolveDefaultModule. */
export const defaultModuleResolver = resolveDefaultModule;

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

function createWarningMessage(params: CouplingWarningParams): string {
    return params.isCrossModule
        ? `Cross-module shotgun surgery detected: '${params.fileA}' (${params.moduleA}) and '${params.fileB}' (${params.moduleB}) ` +
              `frequently change together in ${params.sharedCommits} commits (Jaccard similarity: ${params.couplingPct}%). ` +
              `Extract a shared contract or unify module responsibilities.`
        : `Intra-module temporal coupling detected: '${params.fileA}' and '${params.fileB}' ` +
              `frequently change together in ${params.sharedCommits} commits (Jaccard similarity: ${params.couplingPct}%).`;
}

function buildMappedChangeSets(
    changeSets: readonly CommitChangeSet[],
    maxFiles: number,
): { mappedChangeSets: number[][]; idToFile: string[]; totalUniqueFiles: number } {
    const interner = new IdInterner<string>();
    const mappedChangeSets: number[][] = [];

    for (const changeSet of changeSets) {
        if (!changeSet.changedFiles || changeSet.changedFiles.length > maxFiles) {
            continue;
        }
        const ids: number[] = [];
        for (const fileItem of changeSet.changedFiles) {
            const norm = normalizeEvolutionPath(fileItem);
            if (norm) {
                ids.push(interner.intern(norm));
            }
        }
        if (ids.length > 0) {
            mappedChangeSets.push(ids);
        }
    }
    return {
        mappedChangeSets,
        idToFile: interner.toArray() as string[],
        totalUniqueFiles: interner.size,
    };
}

function buildTemporalCouplingPairs(
    nativePairs: readonly NativeCouplingPair[],
    idToFile: readonly string[],
    moduleResolver: (file: string) => string,
): { pairs: TemporalCouplingPair[]; crossModuleWarningCount: number } {
    const pairs: TemporalCouplingPair[] = [];
    let crossModuleWarningCount = 0;

    for (const nativePair of nativePairs) {
        const rawA = idToFile[nativePair.fileA];
        const rawB = idToFile[nativePair.fileB];
        const [fileA, fileB] = rawA.localeCompare(rawB) <= 0 ? [rawA, rawB] : [rawB, rawA];
        const commitsA = fileA === rawA ? nativePair.commitsA : nativePair.commitsB;
        const commitsB = fileA === rawA ? nativePair.commitsB : nativePair.commitsA;

        const moduleA = moduleResolver(fileA);
        const moduleB = moduleResolver(fileB);
        const isCrossModule = moduleA !== moduleB;
        if (isCrossModule) {
            crossModuleWarningCount++;
        }

        const couplingPercentage = +(
            nativePair.jaccardSimilarity * DEFAULT_PRECISION_SCALE
        ).toFixed(2);
        const warningLevel = resolveCouplingWarningLevel(
            isCrossModule,
            nativePair.jaccardSimilarity,
        );
        const warningMessage = createWarningMessage({
            fileA,
            fileB,
            moduleA,
            moduleB,
            sharedCommits: nativePair.sharedCommits,
            couplingPct: couplingPercentage,
            isCrossModule,
        });

        pairs.push({
            fileA,
            fileB,
            sharedCommits: nativePair.sharedCommits,
            commitsA,
            commitsB,
            jaccardSimilarity: nativePair.jaccardSimilarity,
            couplingPercentage,
            isCrossModule,
            moduleA,
            moduleB,
            warningLevel,
            warningMessage,
        });
    }

    pairs.sort((pairA, pairB) => {
        if (pairB.jaccardSimilarity !== pairA.jaccardSimilarity) {
            return pairB.jaccardSimilarity - pairA.jaccardSimilarity;
        }
        if (pairB.sharedCommits !== pairA.sharedCommits) {
            return pairB.sharedCommits - pairA.sharedCommits;
        }
        return pairA.fileA.localeCompare(pairB.fileA);
    });

    return { pairs, crossModuleWarningCount };
}

function parseSingleLogChunk(chunk: string): CommitChangeSet | null {
    const trimmed = chunk.trim();
    if (!trimmed) {
        return null;
    }

    const newlineIdx = trimmed.indexOf('\n');
    const header = newlineIdx === -1 ? trimmed : trimmed.slice(0, newlineIdx).trim();
    const fields = header.split(ASCII_FIELD_SEP);
    if (fields.length < MIN_LOG_HEADER_FIELDS) {
        return null;
    }

    const commitHash = fields[0].trim();
    const author = fields[1].trim();
    const timestampSec = parseInt(fields[2].trim(), 10);
    const message = fields[3].trim();

    if (!commitHash) {
        return null;
    }

    const fileLines = newlineIdx !== -1 ? trimmed.slice(newlineIdx + 1).split(/\r?\n/) : [];
    const changedFiles: string[] = [];
    const seenSet = new Set<string>();

    for (const line of fileLines) {
        const normPath = normalizeEvolutionPath(line);
        if (normPath && !seenSet.has(normPath)) {
            seenSet.add(normPath);
            changedFiles.push(normPath);
        }
    }

    return {
        commitHash,
        changedFiles,
        timestamp: Number.isNaN(timestampSec) ? undefined : timestampSec * MS_PER_SECOND,
        author,
        message,
    };
}

function extractUniqueCommitFiles(files: readonly string[], seenSet: Set<string>): string[] {
    seenSet.clear();
    const uniqueFileList: string[] = [];
    for (let i = 0; i < files.length; i++) {
        const norm = normalizeEvolutionPath(files[i]);
        if (norm && !seenSet.has(norm)) {
            seenSet.add(norm);
            uniqueFileList.push(norm);
        }
    }
    return uniqueFileList;
}

function recordCoChangePairs(
    sortedFiles: readonly string[],
    pairSharedCounts: Map<string, number>,
): void {
    const len = sortedFiles.length;
    for (let i = 0; i < len; i++) {
        const fileA = sortedFiles[i];
        for (let j = i + 1; j < len; j++) {
            const key = `${fileA}${PAIR_DELIMITER}${sortedFiles[j]}`;
            pairSharedCounts.set(key, (pairSharedCounts.get(key) || 0) + 1);
        }
    }
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

        const { mappedChangeSets, idToFile, totalUniqueFiles } = buildMappedChangeSets(
            changeSets,
            maxFiles,
        );

        const nativePairs = nativeCore.computeTemporalCoupling(
            mappedChangeSets,
            minShared,
            minJaccard,
        );

        const { pairs, crossModuleWarningCount } = buildTemporalCouplingPairs(
            nativePairs,
            idToFile,
            moduleResolver,
        );

        return {
            pairs,
            totalCommitsAnalyzed: changeSets.length,
            totalFilesAnalyzed: totalUniqueFiles,
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
            const parsed = parseSingleLogChunk(chunk);
            if (parsed) {
                changeSets.push(parsed);
            }
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
            const logResult = childProcess.spawnSync(
                CMD_GIT,
                ['log', `--max-count=${commitLimit}`, `--format=${formatStr}`, '--name-only'],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_GIT_LOG_MS,
                    maxBuffer: MAX_BUFFER_BYTES,
                    stdio: STDIO_IGNORE_PIPE_IGNORE,
                },
            );

            if (logResult.status !== 0 || !logResult.stdout) {
                return this.createEmptyReport(false);
            }

            const changeSets = this.parseGitLogOutput(logResult.stdout);
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
            const probeResult = childProcess.spawnSync(
                CMD_GIT,
                ['rev-parse', '--is-inside-work-tree'],
                {
                    cwd,
                    encoding: ENCODING_UTF8,
                    timeout: TIMEOUT_GIT_PROBE_MS,
                    stdio: STDIO_IGNORE_PIPE_IGNORE,
                },
            );
            return probeResult.status === 0 && probeResult.stdout.trim() === 'true';
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
        const seenSet = new Set<string>();
        for (const changeSet of changeSets) {
            if (!changeSet.changedFiles || changeSet.changedFiles.length > maxFilesPerCommit) {
                continue;
            }

            const uniqueFiles = extractUniqueCommitFiles(changeSet.changedFiles, seenSet);
            if (uniqueFiles.length < 2) {
                if (uniqueFiles.length === 1) {
                    const single = uniqueFiles[0];
                    fileCommitCounts.set(single, (fileCommitCounts.get(single) || 0) + 1);
                }
                continue;
            }

            for (let i = 0; i < uniqueFiles.length; i++) {
                const file = uniqueFiles[i];
                fileCommitCounts.set(file, (fileCommitCounts.get(file) || 0) + 1);
            }

            uniqueFiles.sort();
            recordCoChangePairs(uniqueFiles, pairSharedCounts);
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
