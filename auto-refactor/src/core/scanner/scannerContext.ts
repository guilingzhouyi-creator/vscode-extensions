/**
 * Module: Core Engine — Scanner Execution Context Contract
 * File Path: src/core/scanner/scannerContext.ts
 * Architecture Role: Decoupled interface representing Scanner capabilities for sub-scanners.
 * Dependencies & Triggers: ../types, ../logger, ../analyzerRegistry, ../incrementalState;
 *   implemented by Scanner and consumed by cacheScanner and diffScanner.
 * Responsibilities: Declare configuration, plan, logging, and per-file analyzer execution hooks.
 * Exit Semantics & Design Rationale: Allows cache and diff pipeline extraction without circular
 *   dependencies on the concrete Scanner class definition.
 */

import type { ScanConfig, ScanReport, Issue, FileMetric } from '../types';
import type { ResolvedAnalyzer } from '../analyzerRegistry';
import type { IncrementalFileState } from '../incrementalState';
import type { Logger } from '../logger';

/** Execution context exposing Scanner state and execution primitives to sub-pipelines. */
export interface ScannerContext {
    config: ScanConfig;
    logger: Logger;
    plan: ResolvedAnalyzer[];
    runAnalyzers(
        rel: string,
        content: string,
        seed?: IncrementalFileState,
    ): Promise<{ issues: Issue[]; metric: FileMetric | null }>;
    runInProcess(
        files: string[],
        absRoot: string,
        preloaded?: Map<string, Buffer>,
    ): Promise<{ issues: Issue[]; metric: FileMetric | null }[]>;
    buildReport(
        filesScanned: number,
        issues: Issue[],
        fileMetrics: FileMetric[],
        durationMs: number,
    ): ScanReport;
}
