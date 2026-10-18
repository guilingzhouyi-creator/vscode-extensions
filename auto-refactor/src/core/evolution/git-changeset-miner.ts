/**
 * Module: Core Evolution — Git ChangeSet & Entropy Miner
 * File Path: src/core/evolution/git-changeset-miner.ts
 * Architecture Role: Evaluates Hassan (ICSE 2009) Change Shannon Entropy H(C) and Kamei JIT
 *   diffusion vectors across Git commits and staged deltas to detect chaotic cross-domain modifications.
 * Dependencies & Triggers: Node.js child_process (spawnSync) and path; consumed by
 *   evolutionary quality scoring, gate scripts, and change-risk telemetry.
 * Responsibilities:
 *   1. Parse raw numstat outputs into structured FileChangeRecord collections;
 *   2. Compute discrete Shannon entropy H(C) and normalized entropy H_hat(C) in [0.0, 1.0];
 *   3. Extract Kamei diffusion vectors: Files (NF), Directories (ND), and Subsystems (NS);
 *   4. Flag high-entropy cross-subsystem modifications that exceed cognitive budgets;
 *   5. Provide safe repository mining with non-git graceful degradation.
 * Exit Semantics & Design Rationale: Pure deterministic calculation functions; never throws on malformed input.
 */

import * as path from 'path';
import * as childProcess from 'child_process';

/**
 * Structured record representing file change metrics parsed from git diff numstat.
 */
export interface FileChangeRecord {
    readonly filePath: string;
    readonly added: number;
    readonly deleted: number;
    readonly total: number;
}

/**
 * Configuration options for evaluating change entropy and diffusion thresholds.
 */
export interface ChangeEntropyOptions {
    readonly minFilesForEntropy?: number;
    readonly maxDiffusionEntropy?: number;
    readonly minSubsystemsForDiffusion?: number;
    readonly knownSubsystems?: readonly string[];
}

/**
 * Comprehensive change entropy and diffusion evaluation result.
 */
export interface ChangeEntropyResult {
    readonly fileCount: number;
    readonly totalChangedLoc: number;
    readonly entropy: number;
    readonly normalizedEntropy: number;
    readonly subsystemsCount: number;
    readonly directoriesCount: number;
    readonly isDiffused: boolean;
    readonly subsystems: readonly string[];
    readonly recommendation?: string;
}

/**
 * Options for executing git diff numstat queries from repository disk.
 */
export interface MineGitNumstatOptions {
    readonly isStaged?: boolean;
    readonly commitRange?: string;
    readonly cwd?: string;
}

export const DEFAULT_MAX_DIFFUSION_ENTROPY = 0.85;
export const DEFAULT_MIN_FILES_FOR_ENTROPY_CHECK = 8;
export const DEFAULT_MIN_SUBSYSTEMS_FOR_DIFFUSION = 2;

/**
 * Standard top-level subsystems recognized across the monorepo architecture.
 */
export const DEFAULT_KNOWN_SUBSYSTEMS: readonly string[] = Object.freeze([
    'src',
    'scripts',
    'docs',
    'tests',
    '.agents',
]);

const CMD_GIT = 'git';
const TAB_SPLIT_RE = /\t+/;
const LINE_SPLIT_RE = /\r?\n/;
const BACKSLASH_GLOBAL_RE = /\\/g;
const FORWARD_SLASH = '/';
const BINARY_PLACEHOLDER = '-';
const SUBSYSTEM_ROOT = 'root';
const RADIX_DECIMAL = 10;
const MAX_EXEC_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Resolves the top-level architectural subsystem for a given relative path.
 *
 * @param relPath - Path relative to workspace or repository root.
 * @param knownSubsystems - Optional list of recognized subsystem identifiers.
 * @returns Subsystem identifier e.g. 'src', 'scripts', or 'root'.
 */
export function resolveSubsystem(
    relPath: string,
    knownSubsystems: readonly string[] = DEFAULT_KNOWN_SUBSYSTEMS,
): string {
    if (!relPath) {
        return SUBSYSTEM_ROOT;
    }
    const normalized = relPath.replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH);
    const subsystemsCount = knownSubsystems.length;

    for (let i = 0; i < subsystemsCount; i++) {
        const sub = knownSubsystems[i];
        if (normalized === sub || normalized.startsWith(sub + FORWARD_SLASH)) {
            return sub;
        }
    }

    const firstSlash = normalized.indexOf(FORWARD_SLASH);
    return firstSlash === -1 ? SUBSYSTEM_ROOT : normalized.slice(0, firstSlash);
}

/**
 * Parses a single raw line from `git diff --numstat` into a structured FileChangeRecord.
 *
 * @param line - Single numstat line.
 * @returns Parsed record, or null if line is empty, malformed, or binary.
 */
export function parseNumstatLine(line: string): FileChangeRecord | null {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }

    const parts = trimmed.split(TAB_SPLIT_RE);
    if (parts.length < 3) {
        return null;
    }

    const addedRaw = parts[0];
    const deletedRaw = parts[1];
    const filePath = parts.slice(2).join('\t').trim();

    if (addedRaw === BINARY_PLACEHOLDER || deletedRaw === BINARY_PLACEHOLDER || !filePath) {
        return null;
    }

    const added = parseInt(addedRaw, RADIX_DECIMAL) || 0;
    const deleted = parseInt(deletedRaw, RADIX_DECIMAL) || 0;
    const total = added + deleted;

    return { filePath, added, deleted, total };
}

/**
 * Parses complete multi-line stdout from `git diff --numstat` into record collection.
 *
 * @param numstatText - Complete stdout of git diff numstat.
 * @returns Array of parsed file change records.
 */
export function parseNumstatOutput(numstatText: string): FileChangeRecord[] {
    if (!numstatText) {
        return [];
    }

    const lines = numstatText.split(LINE_SPLIT_RE);
    const lineCount = lines.length;
    const records: FileChangeRecord[] = [];

    for (let i = 0; i < lineCount; i++) {
        const parsed = parseNumstatLine(lines[i]);
        if (parsed) {
            records.push(parsed);
        }
    }

    return records;
}

/**
 * Internal helper to compute raw Shannon entropy for non-zero total changed lines.
 */
function computeRawShannonEntropy(fileChanges: readonly FileChangeRecord[], sumDelta: number): number {
    let rawEntropy = 0.0;
    const count = fileChanges.length;

    for (let i = 0; i < count; i++) {
        const item = fileChanges[i];
        if (item.total > 0) {
            const p = item.total / sumDelta;
            rawEntropy -= p * (Math.log(p) / Math.LN2);
        }
    }

    return rawEntropy;
}

/**
 * Builds standard guidance recommendation message when high diffusion is detected.
 */
function formatDiffusionRecommendation(
    normalizedEntropy: number,
    threshold: number,
    fileCount: number,
    subsystemsCount: number,
): string {
    return (
        `High Change Shannon Entropy (H_hat=${normalizedEntropy.toFixed(3)} > ${threshold}) ` +
        `spread across ${fileCount} files in ${subsystemsCount} subsystems. ` +
        'Consider decomposing this patch into atomic, domain-scoped commits.'
    );
}

/**
 * Computes Hassan (ICSE 2009) Change Shannon Entropy and Kamei JIT diffusion vectors.
 *
 * @param fileChanges - Array of file change records.
 * @param options - Custom threshold configuration.
 * @returns Comprehensive ChangeEntropyResult object.
 */
export function computeChangeEntropy(
    fileChanges: readonly FileChangeRecord[],
    options?: ChangeEntropyOptions,
): ChangeEntropyResult {
    const fileCount = fileChanges.length;
    const knownSubs = options?.knownSubsystems ?? DEFAULT_KNOWN_SUBSYSTEMS;
    const minFiles = options?.minFilesForEntropy ?? DEFAULT_MIN_FILES_FOR_ENTROPY_CHECK;
    const maxDiffusion = options?.maxDiffusionEntropy ?? DEFAULT_MAX_DIFFUSION_ENTROPY;
    const minSubs = options?.minSubsystemsForDiffusion ?? DEFAULT_MIN_SUBSYSTEMS_FOR_DIFFUSION;

    if (fileCount === 0) {
        return {
            fileCount: 0,
            totalChangedLoc: 0,
            entropy: 0.0,
            normalizedEntropy: 0.0,
            subsystemsCount: 0,
            directoriesCount: 0,
            isDiffused: false,
            subsystems: [],
        };
    }

    if (fileCount === 1) {
        const singleSub = resolveSubsystem(fileChanges[0].filePath, knownSubs);
        return {
            fileCount: 1,
            totalChangedLoc: fileChanges[0].total,
            entropy: 0.0,
            normalizedEntropy: 0.0,
            subsystemsCount: 1,
            directoriesCount: 1,
            isDiffused: false,
            subsystems: [singleSub],
        };
    }

    let sumDelta = 0;
    const dirSet = new Set<string>();
    const subSet = new Set<string>();

    for (let i = 0; i < fileCount; i++) {
        const item = fileChanges[i];
        sumDelta += item.total;
        dirSet.add(path.dirname(item.filePath).replace(BACKSLASH_GLOBAL_RE, FORWARD_SLASH));
        subSet.add(resolveSubsystem(item.filePath, knownSubs));
    }

    if (sumDelta === 0) {
        return {
            fileCount,
            totalChangedLoc: 0,
            entropy: 0.0,
            normalizedEntropy: 0.0,
            subsystemsCount: subSet.size,
            directoriesCount: dirSet.size,
            isDiffused: false,
            subsystems: Array.from(subSet).sort(),
        };
    }

    const rawEntropy = computeRawShannonEntropy(fileChanges, sumDelta);
    const maxTheoreticalEntropy = Math.log(fileCount) / Math.LN2;
    const normalizedEntropy = maxTheoreticalEntropy > 0
        ? Math.min(1.0, rawEntropy / maxTheoreticalEntropy)
        : 0.0;

    const isDiffused =
        fileCount >= minFiles &&
        normalizedEntropy > maxDiffusion &&
        subSet.size >= minSubs;

    const recommendation = isDiffused
        ? formatDiffusionRecommendation(normalizedEntropy, maxDiffusion, fileCount, subSet.size)
        : undefined;

    return {
        fileCount,
        totalChangedLoc: sumDelta,
        entropy: +rawEntropy.toFixed(4),
        normalizedEntropy: +normalizedEntropy.toFixed(4),
        subsystemsCount: subSet.size,
        directoriesCount: dirSet.size,
        isDiffused,
        subsystems: Array.from(subSet).sort(),
        recommendation,
    };
}

/**
 * Parses numstat text and evaluates change entropy in a single call.
 *
 * @param numstatText - Output text from git diff --numstat.
 * @param options - Custom threshold configuration.
 * @returns ChangeEntropyResult object.
 */
export function evaluateChangeEntropy(
    numstatText: string,
    options?: ChangeEntropyOptions,
): ChangeEntropyResult {
    const records = parseNumstatOutput(numstatText);
    return computeChangeEntropy(records, options);
}

/**
 * Safely mines git numstat output from local disk without throwing exceptions.
 *
 * @param options - Git command parameters including staged flag and directory.
 * @returns Raw numstat string output, or empty string on non-git or error.
 */
export function mineGitNumstat(options?: MineGitNumstatOptions): string {
    try {
        const args = ['diff', '--numstat'];
        if (options?.isStaged) {
            args.push('--cached');
        } else if (options?.commitRange) {
            args.push(options.commitRange);
        }

        const res = childProcess.spawnSync(CMD_GIT, args, {
            cwd: options?.cwd || process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: MAX_EXEC_BUFFER_BYTES,
        });

        return res.status === 0 && res.stdout ? res.stdout : '';
    } catch {
        return '';
    }
}
