/**
 * Module: Core Engine — Parse+Analyze Stage Selection
 * File Path: src/core/scanner/scan-stage.ts
 * Architecture Role: Execution-strategy layer choosing worker-pool vs in-process analysis.
 * Dependencies & Triggers: ../types, ../analyzerRegistry, ../logger, ./workerScheduler,
 *   ./triggerCatalog; invoked by Scanner.scan (and reused through the same host surface).
 * Responsibilities: Derive worker descriptors, pick the effective thread count, run the pool
 *   with an in-process fallback, merge index-aligned results, and sort issues deterministically.
 * Exit Semantics & Design Rationale: A worker-pool failure does not abort the scan — it degrades to
 *   the in-process path with identical output; the sort order (file, line, analyzer, rule) is the
 *   byte-stability contract every cache/diff comparison relies on.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileMetric, Issue, ScanConfig } from '../types';
import type { ResolvedAnalyzer, WorkerAnalyzerDesc } from '../analyzer-registry';
import type { Logger } from '../logger';
import { defaultProjectCommentProfiler } from '../comments/project-comment-profiler';
import { isFixtureOrMockPath, isTestFilePath } from '../path';
import { AR_TIMING, effectiveWorkers, nowMs, runWorkerPool } from './worker-scheduler';
import {
    defaultTriggerCatalog,
    filterAnalyzersForContent,
    shouldExecuteAnalyzer,
} from './trigger-catalog';

export { defaultTriggerCatalog, shouldExecuteAnalyzer };

/**
 * Short-circuit filter a resolved analyzer plan against file content using the trigger catalog.
 * Analyzers whose triggers do not appear in content are skipped early.
 *
 * @param plan - Resolved analyzer plan.
 * @param content - File content to inspect for triggers.
 * @returns Filtered plan with inactive analyzers pruned.
 */
export function prefilterPlanForContent(
    plan: ResolvedAnalyzer[],
    content: string,
): ResolvedAnalyzer[] {
    return filterAnalyzersForContent(plan, content);
}

/** One file's analyzer output; the array is index-aligned with the dispatched file list. */
export interface PerFileResult {
    issues: Issue[];
    metric: FileMetric | null;
    symbols?: {
        definitions: import('../intelligence/symbolIndex').SymbolDefinition[];
        references: import('../intelligence/symbolIndex').SymbolReference[];
    };
    literals?: import('../intelligence/literalIndex').LiteralOccurrence[];
    loopSites?: import('../intelligence/semanticComplexity').LoopSite[];
    graphEdges?: import('../dependency-graph').ModuleGraphFileSummary;
}

/** Scanner surface the stage selector drives (structurally satisfied by Scanner). */
export interface ScanStageHost {
    config: ScanConfig;
    plan: ResolvedAnalyzer[];
    logger: Logger;
    /** Per-file analyzer entry point, also handed to the worker pool as its fallback. */
    runAnalyzers(rel: string, content: string): Promise<PerFileResult>;
    /** Main-thread scheduler used when no worker pool runs. */
    runInProcess(files: string[], absRoot: string): Promise<PerFileResult[]>;
    retainSource?(rel: string, content: string): void;
    ingestFileSummaries?(result: PerFileResult | null | undefined): void;
    recordWorkerSymbols?(
        definitions: import('../intelligence/symbolIndex').SymbolDefinition[],
        references: import('../intelligence/symbolIndex').SymbolReference[],
    ): void;
}

/** Stage timestamps captured for the optional AR_TIMING table. */
export interface ScanTimingMarks {
    /** Baseline timestamp taken at stage entry when AR_TIMING is on (0 otherwise). */
    startAt: number;
    /** Timestamp taken right after discovery when AR_TIMING is on (0 otherwise). */
    discoverAt: number;
    /** Timestamp taken right after the parse+analyze stage (0 when AR_TIMING is off). */
    parseAnalyzeAt: number;
    /** Timestamp taken right after merging and sorting (0 when AR_TIMING is off). */
    sortedAt: number;
    /** Total wall time of the scan in milliseconds. */
    durationMs: number;
}

/**
 * Build the worker descriptors describing each analyzer's module path and merged options.
 *
 * Unused in single-process mode; this is what lets workers reconstruct analyzers without
 * sharing the main process's live instances.
 *
 * @param plan - Resolved analyzer plan of the scanner.
 * @returns One descriptor per resolved analyzer, in plan order.
 */
function workerDescs(plan: ResolvedAnalyzer[]): WorkerAnalyzerDesc[] {
    return plan.map((planItem) => ({
        name: planItem.name,
        modulePath: planItem.modulePath,
        options: planItem.options,
    }));
}

/**
 * Run the parse+analyze stage across the worker pool, degrading to the main thread on failure.
 *
 * Explicit counts (`workers = 1` or `N > 1`) are honoured as written; auto mode (`workers <= 0`)
 * scales with the batch size and never drops below the single-process path.
 *
 * @param host - Scanner surface providing the plan, config, logger, and fallbacks.
 * @param files - Relative paths of the discovered files.
 * @param absRoot - Absolute root path of the project.
 * Concurrency: asynchronous coordinator dispatching to worker pool; safe for
 *   single-threaded caller.
 * @returns One index-aligned result per input file.
 */
export async function runParseAnalyzeStage(
    host: ScanStageHost,
    files: string[],
    absRoot: string,
): Promise<PerFileResult[]> {
    const cfg = host.config;
    const effWorkers = effectiveWorkers(cfg.workers, files.length);
    if (effWorkers <= 1) return host.runInProcess(files, absRoot);
    try {
        const perFile = await runWorkerPool({
            files,
            absRoot,
            config: cfg,
            descs: workerDescs(host.plan),
            numWorkers: effWorkers,
            logger: host.logger,
            runAnalyzersFn: host.runAnalyzers.bind(host),
            retainSourceFn: host.retainSource?.bind(host),
        });
        for (const result of perFile) {
            if (host.ingestFileSummaries) {
                host.ingestFileSummaries(result);
            } else if (host.recordWorkerSymbols && result.symbols) {
                host.recordWorkerSymbols(result.symbols.definitions, result.symbols.references);
            }
        }
        host.logger.debug(
            `parse+analyze stage ran across ${effWorkers} worker thread(s) (in-process fallback available)`,
        );
        return perFile;
    } catch (error) {
        host.logger.warn(`worker pool failed (${String(error)}); falling back to in-process scan`);
        return host.runInProcess(files, absRoot);
    }
}

/**
 * Merge the index-aligned per-file results into flat issue and metric arrays.
 *
 * @param perFile - Per-file analyzer output of this scan.
 * @returns Aggregated issues and the metrics of files that produced one.
 */
export function mergePerFileResults(perFile: PerFileResult[]): {
    issues: Issue[];
    fileMetrics: FileMetric[];
} {
    const issues: Issue[] = [];
    const fileMetrics: FileMetric[] = [];
    for (const result of perFile) {
        issues.push(...result.issues);
        if (result.metric) fileMetrics.push(result.metric);
    }
    return { issues, fileMetrics };
}

/**
 * Sort issues deterministically: file, then line, then analyzer, then rule.
 *
 * @param issues - Issues to sort in place.
 */
export function sortIssues(issues: Issue[]): void {
    issues.sort((issueA, issueB) => {
        if (issueA.location.file !== issueB.location.file)
            return issueA.location.file < issueB.location.file ? -1 : 1;
        if (issueA.location.start.line !== issueB.location.start.line) {
            return issueA.location.start.line - issueB.location.start.line;
        }
        if (issueA.analyzer !== issueB.analyzer) return issueA.analyzer < issueB.analyzer ? -1 : 1;
        return issueA.rule < issueB.rule ? -1 : 1;
    });
}

/**
 * Print the per-stage AR_TIMING table to stderr when AR_TIMING is enabled.
 *
 * @param marks - Stage timestamps and total duration captured by the caller.
 */
export function printScanTiming(marks: ScanTimingMarks): void {
    if (!AR_TIMING) return;
    const { startAt, discoverAt, parseAnalyzeAt, sortedAt, durationMs } = marks;
    console.error(
        `[AR-TIMING scan] wall=${durationMs}ms discover=${(discoverAt - startAt).toFixed(1)}ms ` +
            `parseAnalyze=${(parseAnalyzeAt - discoverAt).toFixed(1)}ms ` +
            `merge+sort=${(sortedAt - parseAnalyzeAt).toFixed(1)}ms ` +
            `report=${(nowMs() - sortedAt).toFixed(1)}ms`,
    );
}

const COMMENT_SAMPLE_BUDGET = 24;
const COMMENT_MIN_SAMPLE_TOKENS = 20;

function isPrimaryCommentSample(rel: string): boolean {
    return !isTestFilePath(rel) && !isFixtureOrMockPath(rel);
}

function selectCommentSamplePaths(files: readonly string[]): string[] {
    const primary = files.filter(isPrimaryCommentSample);
    const pool = primary.length > 0 ? primary : files;
    if (pool.length <= COMMENT_SAMPLE_BUDGET) {
        return [...pool];
    }
    const picked: string[] = [];
    const step = pool.length / COMMENT_SAMPLE_BUDGET;
    for (let i = 0; i < COMMENT_SAMPLE_BUDGET; i++) {
        picked.push(pool[Math.min(pool.length - 1, Math.floor(i * step))]);
    }
    return picked;
}

async function readCommentSampleMap(
    samplePaths: readonly string[],
    absRoot: string,
    logger?: Logger,
): Promise<Map<string, string>> {
    const entries = await Promise.all(
        samplePaths.map(async (rel) => {
            try {
                const content = await fs.promises.readFile(path.join(absRoot, rel), 'utf8');
                return [rel, content] as const;
            } catch (err) {
                logger?.debug(`comment convention sample skipped (${rel}): ${String(err)}`);
                return null;
            }
        }),
    );
    const sampleMap = new Map<string, string>();
    for (const entry of entries) {
        if (entry) sampleMap.set(entry[0], entry[1]);
    }
    return sampleMap;
}

function hasConfiguredCommentLanguage(commentsPlan: ResolvedAnalyzer, cfg: ScanConfig): boolean {
    const planLang = commentsPlan.options?.targetDominantLanguage;
    const cfgLang = cfg.analyzers?.comments?.options?.targetDominantLanguage;
    return Boolean(planLang || cfgLang);
}

/**
 * Infer and bind the project's dominant comment language onto the comments analyzer options
 * when callers did not pin `targetDominantLanguage`, preventing English-only false positives
 * on non-English repositories.
 *
 * @param host - Scanner execution host exposing config, plan, and logger.
 * @param discoveredFiles - Deterministically ordered repository-relative file list.
 * @param absRoot - Absolute project root path.
 * Concurrency: asynchronous sampler bounded to COMMENT_SAMPLE_BUDGET files via Promise.all;
 *   runs once before worker dispatch with deterministic input order.
 */
export async function ensureProjectCommentLanguage(
    host: Pick<ScanStageHost, 'config' | 'plan' | 'logger'>,
    discoveredFiles: readonly string[],
    absRoot: string,
): Promise<void> {
    if (discoveredFiles.length === 0) return;
    const commentsPlan = host.plan.find((item) => item.name === 'comments');
    if (!commentsPlan || hasConfiguredCommentLanguage(commentsPlan, host.config)) return;

    const samplePaths = selectCommentSamplePaths(discoveredFiles);
    const sampleMap = await readCommentSampleMap(samplePaths, absRoot, host.logger);
    if (sampleMap.size === 0) return;

    const profile = defaultProjectCommentProfiler.profileProject(sampleMap);
    const totalTokens =
        profile.overallDistribution.cjkChars + profile.overallDistribution.latinWords;
    if (totalTokens < COMMENT_MIN_SAMPLE_TOKENS) return;

    commentsPlan.options = {
        ...(commentsPlan.options || {}),
        targetDominantLanguage: profile.globalDominantLanguage,
    };
    const cfgComments = host.config.analyzers?.comments;
    if (cfgComments) {
        cfgComments.options = {
            ...(cfgComments.options || {}),
            targetDominantLanguage: profile.globalDominantLanguage,
        };
    }
}
