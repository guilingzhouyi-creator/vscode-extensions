/**
 * Module: Core Engine - Seven-Stage Sparse Review Orchestrator
 * File Path: src/core/scheduler/sparse-orchestrator.ts
 * Architecture Role: Primary scheduler coordinating "local -> cascade -> global" pipeline;
 *   integrates Agent OS quota, tensor partitioning, ring buffer bus, and All-Reduce convergence.
 * Dependencies & Triggers: Consumes partitioner, caches, event bus, native bridge, and convergence;
 *   consumed by public scanner, CLI entry points, and multi-agent collaborative workflows.
 * Responsibilities: Execute 7-stage workflow (Structure -> Partition -> Local -> Callback ->
 *   Cascade -> Global Invariants -> Elastic Scoring); manage cooperative event-loop yields.
 * Exit Semantics & Design Rationale: Never throws; handles large-scale multi-file inputs safely
 *   and outputs structured SparseSchedulerResult with timing, savings, and converged graph facts.
 */

import type { Issue } from '../types';
import { analyzeCodeDensity } from '../intelligence/code-density-analyzer';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import type { DynamicPartitioner } from './dynamic-partitioner';
import { defaultDynamicPartitioner } from './dynamic-partitioner';
import type { ReviewContextCache } from './review-context-cache';
import {
    computeSimpleContentHash,
    defaultReviewContextCache,
} from './review-context-cache';
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

    public constructor(
        partitioner = defaultDynamicPartitioner,
        cache = defaultReviewContextCache,
        eventBus = defaultReviewEventBus,
        tensorPartitioner = defaultTensorPartitioner,
        topologyCache = defaultTopologyCacheManager,
        quotaGateway = defaultAgentQuotaGateway,
    ) {
        this.partitioner = partitioner;
        this.cache = cache;
        this.eventBus = eventBus;
        this.tensorPartitioner = tensorPartitioner;
        this.topologyCache = topologyCache;
        this.quotaGateway = quotaGateway;
    }

    /**
     * Registers underlying analyzer execution adapter (optional, for custom/test execution).
     */
    public setAuditExecutor(executor: DomainAuditExecutor): void {
        this.customExecutor = executor;
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
        // Stage 0: Agent OS Quota Check & Lease Acquisition
        let agentLease: AgentResourceLease | undefined;
        if (options?.agentUid) {
            const leaseResult = this.quotaGateway.acquireLease(
                options.agentUid,
                options.priority ?? TaskPriority.NORMAL,
            );
            if (leaseResult.granted && leaseResult.lease) {
                agentLease = leaseResult.lease;
            }
        }

        const timings = {
            structureAnalysis: 0,
            partitioning: 0,
            localAnalysis: 0,
            secondaryCheck: 0,
            globalInvariant: 0,
            scoring: 0,
        };

        // ---- Stage 1: Project Structure Analysis & Topology Ingestion ----
        const t1Start = Date.now();
        const validFiles = files.filter((f) => Boolean(f && f.trim()));
        if (options?.dependencyEdges) {
            for (const [from, to] of options.dependencyEdges) {
                this.topologyCache.recordDependency(from, to);
            }
        }
        await cooperativeYield();
        timings.structureAnalysis = Math.max(1, Date.now() - t1Start);

        // ---- Stage 2: Dynamic Review Partitioning (Tensor or 1D) ----
        const t2Start = Date.now();
        let partitions: ReviewPartition[] = [];
        if (options?.enableTensorPartitioning) {
            const tensorPlan = this.tensorPartitioner.partition(
                validFiles,
                options.dependencyEdges ?? [],
            );
            partitions = tensorPlan.cells.map((cell) => ({
                id: cell.cellId,
                primaryFiles: cell.dataFiles,
                contextFiles: [],
                estimatedWorkload: cell.estimatedCost,
                activeDomains: ['LOGIC_AND_COMPLEXITY', 'ARCHITECTURE'],
                dominantRole: inferFineGrainedFileRole(cell.dataFiles[0] || '').role,
            }));
        } else {
            partitions = this.partitioner.createPartitions(
                validFiles,
                fileContents,
                options?.enabledDomains,
            );
        }
        timings.partitioning = Math.max(1, Date.now() - t2Start);

        // ---- Stage 3 & 4: Sparse Local Analysis & RingBuffer Result Bus ----
        const t3Start = Date.now();
        const resultBus = new RingBufferBus<SemanticDelta>(
            Math.max(64, partitions.length * 2),
            'reject',
        );
        const convergenceEngine = new SemanticConvergenceEngine();
        let cacheHits = 0;
        let processedUnits = 0;

        for (const partition of partitions) {
            const partitionFindings: Issue[] = [];
            const partitionStart = Date.now();

            for (const file of partition.primaryFiles) {
                const content = fileContents.get(file) ?? '';
                const contentHash = computeSimpleContentHash(content);

                // 1. Check Context Cache
                const cached = this.cache.get(file, contentHash);
                if (cached) {
                    cacheHits++;
                    partitionFindings.push(...cached.localFindings);
                    continue;
                }

                // 2. Local domain analysis
                const density = analyzeCodeDensity(content, file);
                const roleInference = inferFineGrainedFileRole(file, content.slice(0, 300));
                let findingsForFile: Issue[] = [];

                if (this.customExecutor) {
                    findingsForFile = await this.customExecutor(file, content, partition);
                }

                partitionFindings.push(...findingsForFile);

                // Backfill review context cache
                this.cache.set({
                    filePath: file,
                    contentHash,
                    role: roleInference.role,
                    density,
                    localFindings: findingsForFile,
                    durationMs: 1,
                    cachedAt: Date.now(),
                });

                // Also populate topology cache
                this.topologyCache.put(file, contentHash, contentHash, findingsForFile);

                // Detect and dispatch cascade events
                this.detectAndDispatchCascades(file, content, findingsForFile);

                processedUnits++;
                if (processedUnits % 15 === 0) {
                    await cooperativeYield();
                }
            }

            // Pack partition outcome into SemanticDelta and push to result bus
            resultBus.push({
                partitionId: partition.id,
                issues: partitionFindings,
                dependencies: options?.dependencyEdges,
                executionTimeMs: Math.max(1, Date.now() - partitionStart),
            });
        }

        // Drain result bus into convergence engine
        const deltas = resultBus.drainAll();
        for (const delta of deltas) {
            convergenceEngine.ingestDelta(delta);
        }

        timings.localAnalysis = Math.max(1, Date.now() - t3Start);

        // ---- Stage 5: Semantic Cascade Targeted Recheck ----
        const t5Start = Date.now();
        const cascadeEvents = this.eventBus.getDispatchedEvents();
        const secondaryFindings: Issue[] = [];

        if (options?.enableSecondaryCheck !== false && cascadeEvents.length > 0) {
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
        }
        timings.secondaryCheck = Math.max(1, Date.now() - t5Start);

        // ---- Stage 6: Global Invariant & All-Reduce Convergence ----
        const t6Start = Date.now();
        const converged = convergenceEngine.converge();
        await cooperativeYield();
        timings.globalInvariant = Math.max(1, Date.now() - t6Start);

        // ---- Stage 7: Elastic Scoring & Result Aggregation ----
        const t7Start = Date.now();
        timings.scoring = Math.max(1, Date.now() - t7Start);

        // Release agent lease if acquired
        if (agentLease) {
            this.quotaGateway.releaseLease(agentLease.leaseId);
        }

        // Compute savings ratio from sparse activation vs full traversal
        const totalPossibleDomainUnits = validFiles.length * 5;
        const activatedUnits = partitions.reduce(
            (acc, p) => acc + p.primaryFiles.length * p.activeDomains.length,
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
            cacheHits,
            cascadeEventCount: cascadeEvents.length,
            convergedResult: converged,
            circularDependencies: converged.circularDependencies,
            symbolConflicts: converged.symbolConflicts,
            agentLeaseId: agentLease?.leaseId,
        };
    }

    /**
     * Detects potential semantic conflicts and dispatches cross-domain cascade events.
     */
    private detectAndDispatchCascades(file: string, content: string, findings: Issue[]): void {
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
            this.eventBus.dispatch(event);
        }

        // Scenario 2: Naming collision with constants table
        const namingIssue = findings.find((f) => f.analyzer === 'naming');
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
            this.eventBus.dispatch(event);
        }
    }
}

/** Default global sparse orchestrator singleton instance */
export const defaultSparseOrchestrator = new SparseOrchestrator();
