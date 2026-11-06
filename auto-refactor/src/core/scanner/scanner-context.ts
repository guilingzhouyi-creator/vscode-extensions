/**
 * Module: Core Engine — Scanner Execution Context Contract
 * File Path: src/core/scanner/scanner-context.ts
 * Architecture Role: Decoupled interface representing Scanner capabilities for sub-scanners.
 * Dependencies & Triggers: ../types, ../logger, ../analyzerRegistry, ../incrementalState,
 *   ./triggerCatalog; implemented by Scanner and consumed by cacheScanner and diffScanner.
 * Responsibilities: Declare configuration, plan, logging, and per-file analyzer execution hooks.
 * Exit Semantics & Design Rationale: Allows cache and diff pipeline extraction without circular
 *   dependencies on the concrete Scanner class definition.
 */

import type { ScanConfig, ScanReport, Issue, FileMetric } from '../types';
import type { ResolvedAnalyzer } from '../analyzer-registry';
import type { IncrementalFileState } from '../diff/incremental-state';
import type { Logger } from '../logger';
import type { PerFileResult } from './scan-stage';
export {
    AnalyzerTriggerCatalog,
    defaultTriggerCatalog,
    shouldExecuteAnalyzer,
} from './trigger-catalog';

/** Options parameter object for ScannerContext.runAnalyzers. */
export interface RunAnalyzersExecutionOptions {
    activeAnalyzers?: Set<string>;
    lineBounds?: readonly [number, number];
}

/** Execution context exposing Scanner state and execution primitives to sub-pipelines. */
export interface ScannerContext {
    config: ScanConfig;
    logger: Logger;
    plan: ResolvedAnalyzer[];
    runAnalyzers(
        rel: string,
        content: string,
        seed?: IncrementalFileState,
        options?: Set<string> | RunAnalyzersExecutionOptions,
    ): Promise<PerFileResult>;
    runInProcess(
        files: string[],
        absRoot: string,
        preloaded?: Map<string, Buffer>,
    ): Promise<PerFileResult[]>;
    retainSource?(rel: string, content: string): void;
    ingestFileSummaries?(result: PerFileResult | null | undefined): void;
    buildReport(
        filesScanned: number,
        issues: Issue[],
        fileMetrics: FileMetric[],
        durationMs: number,
    ): ScanReport;
}
