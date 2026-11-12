/**
 * Module: Praxis — Workspace Review Execution
 * File Path: src/core/praxis/client/workspace-execution.ts
 * Architecture Role: Connect workspace SDK reports with immutable execution or legacy observations.
 * Dependencies & Triggers: Scanner, report finalization and bounded semantic extraction assets.
 * Responsibilities: Publish observed topology; distinguish fixed snapshots from directories.
 * Exit Semantics & Design Rationale: Directory observations carry no snapshot identity; missing
 *     execution or global snapshot finalization stays explicitly incomplete. Logger always closes.
 */
import { randomUUID } from 'node:crypto';
import { Scanner } from '../../analyzer';
import { Logger } from '../../logger';
import { finalizeReport } from '../../reporting/reportFinalizer';
import { executeReview } from '../../review/review-executor';
import { createReviewExecution } from '../../review/review-execution';
import type { ReviewExecution } from '../../review/review-execution';
import type { ReviewFailure } from '../../review/review-contracts';
import type { SourceSnapshot } from '../../review/source-snapshot';
import type { SemanticGraphSnapshot } from '../../review/semantic-snapshot';
import { SemanticGraph } from '../../semantic/semanticGraph';
import { defaultSemanticAdapterRegistry } from '../../semantic/adapters/registry';
import { resolveSnapshotModules } from '../../semantic/snapshot-module-resolution';
import type { ScanConfig, ScanReport } from '../../types';

/** Actual report execution and topology, with strong generation metadata only for fixed inputs. */
export interface WorkspaceReviewExecution {
    readonly report: ScanReport;
    readonly execution: ReviewExecution;
    readonly graph: SemanticGraph;
    readonly generation?: SemanticGraphSnapshot;
}

async function observeWorkspaceGraph(scanner: Scanner): Promise<{
    graph: SemanticGraph;
    failures: ReviewFailure[];
}> {
    const graph = new SemanticGraph();
    const failures: ReviewFailure[] = [];
    for (const [file, content] of scanner.retainedSourceText()) {
        try {
            const published = await defaultSemanticAdapterRegistry.extractFileToGraph(
                file,
                content,
                graph,
            );
            if (!published)
                failures.push({
                    code: 'SEMANTIC_EXTRACTION_UNAVAILABLE',
                    message: `No semantic update published for ${file}`,
                });
        } catch (error) {
            failures.push({
                code: 'SEMANTIC_EXTRACTION_FAILED',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { graph: resolveSnapshotModules(graph).graph, failures };
}

async function executeSnapshotWorkspace(
    scanner: Scanner,
    snapshot: SourceSnapshot,
    logger: Logger,
): Promise<WorkspaceReviewExecution> {
    const started = Date.now();
    const result = await executeReview({ requestId: randomUUID() }, snapshot, { scanner });
    const snapshotSource = new Map<string, string>();
    for (const entry of snapshot.entries) {
        const input = snapshot.read(entry.path, entry.object);
        if (input.kind === 'text') snapshotSource.set(entry.path, input.content);
    }
    const report = scanner.buildReport(
        result.inputs.filter((input) => input.kind === 'text').length,
        [...result.issues],
        [...result.fileMetrics],
        Date.now() - started,
        snapshotSource,
    );
    await finalizeReport({
        report,
        config: scanner.getConfig(),
        options: {},
        logger,
        reportScanner: scanner,
        snapshotSource,
    });
    const execution = createReviewExecution({
        reviewId: result.requestId,
        tracks: result.completion.tracks,
        coverage: [
            ...result.completion.coverage,
            {
                analyzer: 'workspace-global',
                capability: 'workspace-structural-finalization',
                language: 'mixed',
                required: true,
                status: 'supported',
            },
            {
                analyzer: 'workspace-external',
                capability: 'workspace-external-enrichment',
                language: 'mixed',
                required: true,
                status: 'unsupported',
                reason: 'snapshot-external-enrichment-unavailable',
            },
        ],
        failures: result.completion.failures,
        termination:
            result.completion.status === 'cancelled' || result.completion.status === 'superseded'
                ? result.completion.status
                : undefined,
    });
    return {
        report,
        execution,
        graph: result.semanticGraph.createMutableGraph(),
        generation: result.semanticGraph,
    };
}

/**
 * Execute the actual workspace input mode and close request resources on every exit.
 * @param config - Resolved SDK analyzer configuration.
 * @param snapshot - Explicit fixed source; absent retains legacy directory scan behavior.
 * @returns Report, exact topology observations and truthful execution completeness.
 * ASYNC-CONCURRENCY: owns its scanner; a caller sharing a cache directory must serialize.
 */
export async function executeWorkspaceReview(
    config: ScanConfig,
    snapshot?: SourceSnapshot,
): Promise<WorkspaceReviewExecution> {
    const active = snapshot ? { ...config, cacheEnabled: false, sparseRouting: false } : config;
    const logger = new Logger(active.logLevel, active.logFile);
    try {
        const scanner = new Scanner(active, logger);
        if (snapshot) {
            active.archetype ??= scanner.getArchetype();
            return await executeSnapshotWorkspace(scanner, snapshot, logger);
        }
        const report = await scanner.scan();
        await finalizeReport(report, active, {}, logger, scanner);
        const observed = await observeWorkspaceGraph(scanner);
        const execution = createReviewExecution({
            reviewId: randomUUID(),
            tracks: { fast: 'not-required', deep: 'not-required' },
            coverage: [
                {
                    analyzer: 'sdk-workspace',
                    capability: 'file-analysis',
                    language: 'mixed',
                    required: true,
                    status: 'degraded',
                    reason: 'legacy-workspace-execution-unobserved',
                },
                {
                    analyzer: 'semantic-graph',
                    capability: 'graph-analysis',
                    language: 'mixed',
                    required: false,
                    status: 'degraded',
                    reason: 'workspace-snapshot-unavailable',
                },
            ],
            failures: observed.failures,
        });
        return { report, execution, graph: observed.graph };
    } finally {
        logger.close();
    }
}
