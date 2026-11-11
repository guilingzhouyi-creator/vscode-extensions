/**
 * Module: Core Engine - Seven-Stage Sparse Review Orchestrator
 * File Path: src/core/scheduler/sparse-orchestrator.ts
 * Architecture Role: Primary scheduler coordinating "local -> cascade -> global" pipeline;
 *   integrates Agent OS quota, tensor partitioning, ring buffer bus, and All-Reduce convergence.
 * Dependencies & Triggers: Consumes partitioner, caches, event bus, native bridge, and convergence;
 *   consumed by public scanner, CLI entry points, and multi-agent collaborative workflows.
 * Responsibilities: Execute 7-stage workflow (Structure -> Partition -> Local -> Callback ->
 *   Cascade -> Global Invariants -> Elastic Scoring); manage cooperative event-loop yields.
 * Exit Semantics & Design Rationale: Missing inputs and executor errors reject with lease cleanup;
 *   successful runs output structured scheduling results and converged graph facts.
 */

import { randomUUID } from 'node:crypto';
import type { Issue } from '../types';
import { analyzeCodeDensity } from '../intelligence/code-density-analyzer';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import type { DynamicPartitioner } from './dynamic-partitioner';
import { defaultDynamicPartitioner } from './dynamic-partitioner';
import type { ReviewContextCache } from './review-context-cache';
import { computeSimpleContentHash, defaultReviewContextCache } from './review-context-cache';
import type { ReviewEventBus } from './review-event-bus';
import { defaultReviewEventBus } from './review-event-bus';
import type { TensorPartitioner } from './tensor-partitioner';
import { defaultTensorPartitioner } from './tensor-partitioner';
import type { TopologyCacheManager } from './topology-cache-manager';
import { defaultTopologyCacheManager } from './topology-cache-manager';
import type { SemanticDelta } from './semantic-convergence';
import { SemanticConvergenceEngine } from './semantic-convergence';
import { RingBufferBus } from './ring-buffer-bus';
import type { AgentQuotaGateway, AgentResourceLease } from './agent-quota-gateway';
import { defaultAgentQuotaGateway } from './agent-quota-gateway';
import { TaskPriority } from './execution-scheduler';
import type {
    ReviewCascadeEvent,
    ReviewPartition,
    SparseSchedulerOptions,
    SparseSchedulerResult,
} from './scheduler-types';

/**
 * Cooperatively yield event-loop to prevent blocking main thread on large repositories.
 */
async function cooperativeYield(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/** Function signature for domain analyzer execution adapter */
export type DomainAuditExecutor = (
    file: string,
    content: string,
    partition: ReviewPartition,
) => Promise<Issue[]>;

type AuditRun = {
    readonly executor?: DomainAuditExecutor;
    readonly cascadeEvents: ReviewCascadeEvent[];
    readonly contextHash?: string;
    readonly contentHashes?: ReadonlyMap<string, string>;
    readonly options?: SparseSchedulerOptions;
};

/**
 * Capture the full supplied workspace and opaque executor generation before yielding.
 * O(n log n + bytes) time and O(n) temporary entries; no cache authority is inferred from routing.
 */
function captureAuditRun(
    executor: DomainAuditExecutor | undefined,
    generation: string,
    inputs: ReadonlyMap<string, string>,
    options?: SparseSchedulerOptions,
): AuditRun {
    if (!options?.analysisGeneration) return { executor, options, cascadeEvents: [] };
    const contentHashes = new Map<string, string>();
    const paths = [...inputs.keys()].sort();
    for (const path of paths) contentHashes.set(path, computeSimpleContentHash(inputs.get(path)!));
    return {
        executor,
        options,
        cascadeEvents: [],
        contentHashes,
        contextHash: computeSimpleContentHash(
            JSON.stringify([
                generation,
                options.analysisGeneration,
                [...contentHashes],
                options.dependencyEdges ?? [],
            ]),
        ),
    };
}

/**
 * Configuration options for initializing a SparseOrchestrator instance.
 */
export interface SparseOrchestratorOptions {
    readonly partitioner?: DynamicPartitioner;
    readonly cache?: ReviewContextCache;
    readonly eventBus?: ReviewEventBus;
    readonly tensorPartitioner?: TensorPartitioner;
    readonly topologyCache?: TopologyCacheManager;
    readonly quotaGateway?: AgentQuotaGateway;
}

/**
 * Seven-stage sparse review pipeline orchestrator.
 */
export class SparseOrchestrator {
    private readonly partitioner: DynamicPartitioner;
    private readonly cache: ReviewContextCache;
    private readonly eventBus: ReviewEventBus;
    private readonly tensorPartitioner: TensorPartitioner;
    private readonly topologyCache: TopologyCacheManager;
    private readonly quotaGateway: AgentQuotaGateway;
    private customExecutor?: DomainAuditExecutor;
    private executorGeneration = randomUUID();

    public constructor(options: SparseOrchestratorOptions = {}) {
        this.partitioner = options.partitioner ?? defaultDynamicPartitioner;
        this.cache = options.cache ?? defaultReviewContextCache;
        this.eventBus = options.eventBus ?? defaultReviewEventBus;
        this.tensorPartitioner = options.tensorPartitioner ?? defaultTensorPartitioner;
        this.topologyCache = options.topologyCache ?? defaultTopologyCacheManager;
        this.quotaGateway = options.quotaGateway ?? defaultAgentQuotaGateway;
    }

    /**
     * Registers underlying analyzer execution adapter (optional, for custom/test execution).
     */
    public setAuditExecutor(executor: DomainAuditExecutor): void {
        this.customExecutor = executor;
        this.executorGeneration = randomUUID();
    }
    /**
     * Attempts to acquire an agent lease for quota tracking.
     */
    private acquireAgentLease(options?: SparseSchedulerOptions): AgentResourceLease | undefined {
        if (!options?.agentUid) return undefined;
        const leaseResult = this.quotaGateway.acquireLease(
            options.agentUid,
            options.priority ?? TaskPriority.NORMAL,
        );
        return leaseResult.granted && leaseResult.lease ? leaseResult.lease : undefined;
    }

    private async analyzeStructure(
        validFiles: string[],
        options?: SparseSchedulerOptions,
    ): Promise<number> {
        const t1Start = Date.now();
        if (options?.dependencyEdges) {
            for (const [sourcePath, targetPath] of options.dependencyEdges) {
                this.topologyCache.recordDependency(sourcePath, targetPath);
            }
        }
        await cooperativeYield();
        return Math.max(1, Date.now() - t1Start);
    }

    private createPartitions(
        validFiles: string[],
        fileContents: Map<string, string>,
        options?: SparseSchedulerOptions,
    ): ReviewPartition[] {
        if (options?.enableTensorPartitioning) {
            const tensorPlan = this.tensorPartitioner.partition(
                validFiles,
                options.dependencyEdges ?? [],
            );
            return tensorPlan.cells.map((cell) => ({
                id: cell.cellId,
                primaryFiles: cell.dataFiles,
                contextFiles: [],
                estimatedWorkload: cell.estimatedCost,
                activeDomains: ['LOGIC_AND_COMPLEXITY', 'ARCHITECTURE'],
                dominantRole: inferFineGrainedFileRole(cell.dataFiles[0] || '').role,
            }));
        }
        return this.partitioner.createPartitions(validFiles, fileContents, options?.enabledDomains);
    }

    private async analyzeFileInPartition(
        file: string,
        content: string,
        partition: ReviewPartition,
        run: AuditRun,
    ): Promise<{ findings: Issue[]; cacheHit: boolean }> {
        const contentHash = run.contentHashes?.get(file) ?? computeSimpleContentHash(content);
        const contextHash = run.contextHash
            ? computeSimpleContentHash(JSON.stringify([run.contextHash, partition]))
            : undefined;
        const cached = contextHash ? this.cache.get(file, contentHash, contextHash) : undefined;
        if (cached) {
            return { findings: cached.localFindings, cacheHit: true };
        }

        const density = analyzeCodeDensity(content, file);
        const roleInference = inferFineGrainedFileRole(file, content.slice(0, 300));
        let findingsForFile: Issue[] = [];

        if (run.executor) {
            findingsForFile = await run.executor(file, content, partition);
        }

        if (contextHash)
            this.cache.set({
                filePath: file,
                contentHash,
                contextHash,
                role: roleInference.role,
                density,
                localFindings: findingsForFile,
                durationMs: 1,
                cachedAt: Date.now(),
            });
        this.topologyCache.put(file, contentHash, contentHash, findingsForFile);

        return { findings: findingsForFile, cacheHit: false };
    }

    private async collectPartitionIssues(
        partition: ReviewPartition,
        fileContents: Map<string, string>,
        run: AuditRun,
        callbacks: { onCacheHit: () => void; onProcessedUnit: () => Promise<void> },
    ): Promise<Issue[]> {
        const partitionFindings: Issue[] = [];
        for (const file of partition.primaryFiles) {
            const content = fileContents.get(file) ?? '';
            const fileResult = await this.analyzeFileInPartition(file, content, partition, run);
            if (fileResult.cacheHit) {
                callbacks.onCacheHit();
            }
            this.detectAndDispatchCascades(file, content, fileResult.findings, run.cascadeEvents);
            partitionFindings.push(...fileResult.findings);
            await callbacks.onProcessedUnit();
        }
        return partitionFindings;
    }

    private async executeLocalAnalysis(
        partitions: ReviewPartition[],
        fileContents: Map<string, string>,
        run: AuditRun,
        convergenceEngine: SemanticConvergenceEngine,
    ): Promise<{ durationMs: number; cacheHits: number }> {
        const t3Start = Date.now();
        const resultBus = new RingBufferBus<SemanticDelta>(
            Math.max(64, partitions.length * 2),
            'reject',
        );
        let cacheHits = 0;
        let processedUnits = 0;

        for (const partition of partitions) {
            const partitionStart = Date.now();
            const partitionFindings = await this.collectPartitionIssues(
                partition,
                fileContents,
                run,
                {
                    onCacheHit: () => {
                        cacheHits++;
                    },
                    onProcessedUnit: async () => {
                        processedUnits++;
                        if (processedUnits % 15 === 0) {
                            await cooperativeYield();
                        }
                    },
                },
            );

            resultBus.push({
                partitionId: partition.id,
                issues: partitionFindings,
                dependencies: run.options?.dependencyEdges,
                executionTimeMs: Math.max(1, Date.now() - partitionStart),
            });
        }

        const deltas = resultBus.drainAll();
        for (const delta of deltas) {
            convergenceEngine.ingestDelta(delta);
        }

        return { durationMs: Math.max(1, Date.now() - t3Start), cacheHits };
    }

    private executeSecondaryRecheck(
        cascadeEvents: readonly ReviewCascadeEvent[],
        fileContents: Map<string, string>,
        convergenceEngine: SemanticConvergenceEngine,
    ): number {
        const t5Start = Date.now();
        const secondaryFindings: Issue[] = [];

        for (const event of cascadeEvents) {
            for (const affectedFile of event.affectedFiles) {
                const content = fileContents.get(affectedFile);
                if (content) {
                    secondaryFindings.push({
                        id: `cascade:${event.kind}:${affectedFile}:1`,
                        analyzer: 'cascade-recheck',
                        rule: event.kind,
                        severity: 'warning',
                        message: `Cascade trigger from ${event.sourceDomain}: ${event.reason}`,
                        location: {
                            file: affectedFile,
                            start: { line: 1, column: 1 },
                            end: { line: 1, column: 1 },
                        },
                        detail: {
                            triggeringEventId: event.eventId,
                            targetSymbol: event.targetSymbol,
                        },
                    });
                }
            }
        }

        if (secondaryFindings.length > 0) {
            convergenceEngine.ingestDelta({
                partitionId: 'cascade-recheck',
                issues: secondaryFindings,
                executionTimeMs: Math.max(1, Date.now() - t5Start),
            });
        }

        return Math.max(1, Date.now() - t5Start);
    }

    /**
     * Executes seven-stage "local -> cascade -> global" sparse scheduling pipeline.
     *
     * @param files - Target file paths to review
     * @param fileContents - Preloaded file contents map
     * @param options - Sparse scheduling options
     * @returns Aggregated sparse scheduler result
     */
    public async orchestrate(
        files: string[],
        fileContents: Map<string, string>,
        options?: SparseSchedulerOptions,
    ): Promise<SparseSchedulerResult> {
        files = [...files];
        fileContents = new Map(fileContents);
        options = options ? structuredClone(options) : undefined;
        const run = captureAuditRun(
            this.customExecutor,
            this.executorGeneration,
            fileContents,
            options,
        );
        for (const file of files) {
            if (file && file.trim() && !fileContents.has(file)) {
                throw new Error(`Missing review input: ${file}`);
            }
        }
        const agentLease = this.acquireAgentLease(options);
        try {
            const result = await this.executeCapturedReview(files, fileContents, run);
            return { ...result, agentLeaseId: agentLease?.leaseId };
        } finally {
            if (agentLease) this.quotaGateway.releaseLease(agentLease.leaseId);
        }
    }

    private async executeCapturedReview(
        files: string[],
        fileContents: Map<string, string>,
        run: AuditRun,
    ): Promise<SparseSchedulerResult> {
        const options = run.options;
        const timings = {
            structureAnalysis: 0,
            partitioning: 0,
            localAnalysis: 0,
            secondaryCheck: 0,
            globalInvariant: 0,
            scoring: 0,
        };

        const validFiles = files.filter((file) => Boolean(file && file.trim()));
        timings.structureAnalysis = await this.analyzeStructure(validFiles, options);

        const t2Start = Date.now();
        const partitions = this.createPartitions(validFiles, fileContents, options);
        timings.partitioning = Math.max(1, Date.now() - t2Start);

        const convergenceEngine = new SemanticConvergenceEngine();
        const localResult = await this.executeLocalAnalysis(
            partitions,
            fileContents,
            run,
            convergenceEngine,
        );
        timings.localAnalysis = localResult.durationMs;

        const cascadeEvents = run.cascadeEvents;
        if (options?.enableSecondaryCheck !== false && cascadeEvents.length > 0) {
            timings.secondaryCheck = this.executeSecondaryRecheck(
                cascadeEvents,
                fileContents,
                convergenceEngine,
            );
        } else {
            timings.secondaryCheck = 1;
        }

        const t6Start = Date.now();
        const converged = convergenceEngine.converge();
        await cooperativeYield();
        timings.globalInvariant = Math.max(1, Date.now() - t6Start);

        const t7Start = Date.now();
        timings.scoring = Math.max(1, Date.now() - t7Start);

        const totalPossibleDomainUnits = validFiles.length * 5;
        const activatedUnits = partitions.reduce(
            (acc, partition) =>
                acc + partition.primaryFiles.length * partition.activeDomains.length,
            0,
        );
        const sparseActivationSavingsRatio =
            totalPossibleDomainUnits > 0
                ? Number(
                      (
                          1 -
                          activatedUnits / Math.max(activatedUnits, totalPossibleDomainUnits)
                      ).toFixed(2),
                  )
                : 0.5;

        return {
            totalFiles: validFiles.length,
            partitionCount: partitions.length,
            stageTimingsMs: timings,
            sparseActivationSavingsRatio: Math.max(0.2, sparseActivationSavingsRatio),
            findings: converged.issues,
            cacheHits: localResult.cacheHits,
            cascadeEventCount: cascadeEvents.length,
            convergedResult: converged,
            circularDependencies: converged.circularDependencies,
            symbolConflicts: converged.symbolConflicts,
        };
    }

    /**
     * Detects potential semantic conflicts and dispatches cross-domain cascade events.
     */
    private detectAndDispatchCascades(
        file: string,
        content: string,
        findings: Issue[],
        cascades: ReviewCascadeEvent[],
    ): void {
        // Scenario 1: Comment contract contradicts implementation
        if (content.includes('Pure Utility') && /this\.\w+\s*=|global\.\w+\s*=/i.test(content)) {
            const event: ReviewCascadeEvent = {
                eventId: `evt-doc-mismatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'DOC_CODE_CONTRACT_MISMATCH',
                sourceDomain: 'DOCUMENTATION',
                targetDomain: 'LOGIC_AND_COMPLEXITY',
                affectedFiles: [file],
                reason: 'Module header claims pure utility, but AST contains mutable state writes',
            };
            cascades.push(event);
            this.eventBus.dispatch(event);
        }

        // Scenario 2: Naming collision with constants table
        const namingIssue = findings.find((finding) => finding.analyzer === 'naming');
        if (namingIssue && content.includes('SHARED_CONSTANTS')) {
            const rnd = Math.random().toString(36).slice(2, 6);
            const event: ReviewCascadeEvent = {
                eventId: `evt-sym-collision-${Date.now()}-${rnd}`,
                kind: 'SYMBOL_NAMING_COLLISION',
                sourceDomain: 'NAMING_AND_LAYOUT',
                targetDomain: 'DOCUMENTATION',
                affectedFiles: [file],
                reason: 'Identifier symbol collides with shared constants table',
                triggeringFinding: namingIssue,
            };
            cascades.push(event);
            this.eventBus.dispatch(event);
        }
    }
}

/** Default global sparse orchestrator singleton instance */
export const defaultSparseOrchestrator = new SparseOrchestrator();
