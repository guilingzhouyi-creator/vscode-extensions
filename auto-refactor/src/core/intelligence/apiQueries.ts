/**
 * Module: Core Intelligence — Programmatic API Query Facade
 * File Path: src/core/intelligence/apiQueries.ts
 * Architecture Role: Query operations and intelligence extraction facade for IDE extensions,
 *   review memory, trajectories, agent constraints, symbol resolution, and context slices.
 * Dependencies & Triggers: fs, path, ../config, ../analyzer, ../logger, ../memory,
 *   ../scoring, ../trajectory, ../guidance, and ./symbolIndex; called by public API and tools.
 * Responsibilities: Resolve review memory directories, calculate transparent quality scores,
 *   replay change trajectories, resolve symbols, build context slices, and run dual-track scans.
 * Exit Semantics & Design Rationale: Stateless, reentrant query wrappers constructing fresh
 *   scanners and loggers per call so concurrent agent queries do not share mutable state.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScanReport } from '../types';
import type { ScanOptions } from '../../api';
import { resolveConfig } from '../config';
import { Scanner } from '../analyzer';
import { Logger } from '../logger';
import { ReviewMemoryManager } from '../memory/reviewMemory';
import { QualityScorer } from '../scoring/qualityScorer';
import type { QualityWeights, QualityScoreBreakdown } from '../scoring/scoringTypes';
import { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';
import type { FileChangeTrajectory } from '../trajectory/types';
import type {
    AgentConstraintOptions,
    AgentConstraintPrompt,
} from '../guidance/agentConstraintGenerator';
import { AgentConstraintGenerator } from '../guidance/agentConstraintGenerator';
import type { SymbolDefinition, SymbolReference, SymbolIndexStats } from './symbolIndex';
import { buildContextSlice } from './contextSlice';
import type { ContextSlice, ContextSliceOptions } from './contextSlice';
import type {
    DiffFileInput,
    DualTrackExecution,
    DualTrackOptions,
} from '../pipeline/dualTrackPipeline';
import { executeDualTrack } from '../pipeline/dualTrackPipeline';

/** Directory name every scan writes its review memory into, relative to the scan root. */
const REVIEW_MEMORY_DIR_NAME = '.auto-refactor-cache';

/**
 * Evaluate the transparent quality score for an entire scan report using optional dimension
 * weights; omitted weights keep the scorer's defaults.
 *
 * @param report - Completed scan report whose issues and config drive the score.
 * @param weights - Optional per-dimension weight overrides merged over the defaults.
 * @returns Quality breakdown computed for the pseudo-file 'PROJECT'.
 */
export function evaluateQualityScore(
    report: ScanReport,
    weights?: Partial<QualityWeights>,
): QualityScoreBreakdown {
    const scorer = new QualityScorer(weights);
    return scorer.evaluateFile('PROJECT', report.issues, null, report.config);
}

/**
 * Resolve the review-memory directory a query should read.
 *
 * @param startDir - Directory to start from; defaults to the process cwd.
 * @returns Absolute path of the review-memory directory to read or create.
 */
export function resolveReviewMemoryDir(startDir: string = process.cwd()): string {
    const origin = path.resolve(startDir);
    let current = origin;
    for (;;) {
        const candidate = path.join(current, REVIEW_MEMORY_DIR_NAME);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(current);
        if (parent === current) return path.join(origin, REVIEW_MEMORY_DIR_NAME);
        current = parent;
    }
}

/**
 * Open the review-memory manager for a cache directory.
 *
 * @param cacheDir - Cache root holding review-memory records; defaults to an
 *                   `.auto-refactor-cache` directory under the current working directory.
 * @returns Manager backed by the resolved cache directory.
 */
export function getReviewMemory(cacheDir?: string): ReviewMemoryManager {
    return new ReviewMemoryManager(cacheDir || resolveReviewMemoryDir());
}

/**
 * Query the recorded change trajectory of one file from review memory.
 *
 * @param filePath - File whose revision history should be replayed in order.
 * @param cacheDir - Optional review-memory cache root; defaults to the cwd cache.
 * @returns Trajectory object, or undefined when no revision has been recorded yet.
 */
export function getChangeTrajectory(
    filePath: string,
    cacheDir?: string,
): FileChangeTrajectory | undefined {
    const memory = getReviewMemory(cacheDir);
    const revisions = memory.getRevisions(filePath);
    if (revisions.length === 0) return undefined;
    const trajManager = new ChangeTrajectoryManager();
    for (const rev of revisions) {
        trajManager.recordRevision(filePath, rev);
    }
    return trajManager.getTrajectory(filePath);
}

/**
 * Resolve a cross-file symbol against a repository.
 *
 * Concurrency: reentrant, idempotent and thread-safe; constructs a dedicated scanner
 *   over a read-only snapshot with no shared mutable state.
 *
 * @param name - Declared or called symbol name to resolve.
 * @param options - Scan overrides; `root` selects the repository.
 * @returns The resolved definitions, every recorded call site, the cross-file subset, and stats.
 */
export async function querySymbols(
    name: string,
    options: ScanOptions = {},
): Promise<{
    definitions: SymbolDefinition[];
    references: SymbolReference[];
    crossFileReferences: SymbolReference[];
    stats: SymbolIndexStats;
}> {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);
    try {
        await scanner.scan();
        const index = scanner.getSymbolIndex();
        const resolved = index.resolve(name);
        const crossFile = [
            ...new Set(
                resolved.definitions.flatMap((definition) =>
                    index.crossFileReferencesTo(name, definition.file),
                ),
            ),
        ];
        return {
            definitions: resolved.definitions,
            references: resolved.references,
            crossFileReferences: crossFile,
            stats: index.stats(),
        };
    } finally {
        logger.close();
    }
}

/**
 * Build a bounded semantic context slice for one task intent from a real scan.
 *
 * Concurrency: reentrant, idempotent and thread-safe; owns its scanner instance and
 *   requires no external synchronization across concurrent queries.
 *
 * @param intent - Task intent in natural language or identifier form.
 * @param options - Scan options (root/config/workers/...) plus optional slice caps.
 * @returns The bounded context slice with its constraints and truncation flag.
 */
export async function queryContextSlice(
    intent: string,
    options: ScanOptions & ContextSliceOptions = {},
): Promise<ContextSlice> {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);
    try {
        await scanner.scan();
        return buildContextSlice(intent, scanner.getSymbolIndex(), scanner.getCallGraph(), {
            ...(options.maxRegions === undefined ? {} : { maxRegions: options.maxRegions }),
            ...(options.maxDependencies === undefined
                ? {}
                : { maxDependencies: options.maxDependencies }),
            ...(options.maxImpacts === undefined ? {} : { maxImpacts: options.maxImpacts }),
            ...(options.stopWords === undefined ? {} : { stopWords: options.stopWords }),
        });
    } finally {
        logger.close();
    }
}

/**
 * Build localized engineering constraints for an agent about to modify a file.
 *
 * @param options - Query target: file path plus optional domain, line, layer, and agent UID.
 * @param cacheDir - Optional review-memory cache root; defaults to the cwd cache.
 * @returns Rendered constraint prompt with hard rules, pitfalls, and recommended patterns.
 */
export function queryAgentConstraints(
    options: AgentConstraintOptions,
    cacheDir?: string,
): AgentConstraintPrompt {
    const memoryManager = getReviewMemory(cacheDir);
    const rec = memoryManager.getRecord(options.filePath);
    const traj = getChangeTrajectory(options.filePath, cacheDir);
    const gen = new AgentConstraintGenerator();
    return gen.generate(options, rec, traj);
}

/**
 * Asymmetric dual-track scan API.
 *
 * Concurrency: reentrant and thread-safe; each execution constructs an isolated scanner
 *   and logger instance and awaits its own execution pipeline.
 *
 * @param inputs - Changed files with old/new content and optional changed-line hints.
 * @param options - Scan overrides plus dual-track knobs (governor, escalation, author, graph).
 * @returns Fast-track verdict plus the in-flight deep-track promise.
 */
export async function scanAsymmetric(
    inputs: DiffFileInput[],
    options: ScanOptions & DualTrackOptions = {},
): Promise<DualTrackExecution> {
    const config = resolveConfig(options);
    const logger = new Logger(config.logLevel, config.logFile);
    const scanner = new Scanner(config, logger);
    const execution = await executeDualTrack(scanner, inputs, options);
    execution.deepPromise.finally(() => logger.close());
    return execution;
}
