/**
 * Module: Core Engine - Scale-Adaptive Sparse Scheduler Contracts
 * File Path: src/core/scheduler/scheduler-types.ts
 * Architecture Role: Strongly typed contracts and interfaces for dynamic project partitioning,
 *   responsibility domain bindings, cross-reviewer event cascades, and sparse orchestration.
 * Dependencies & Triggers: Consumes Issue from core/types and file roles from intelligence;
 *   consumed by dynamic-partitioner, sparse-orchestrator, and public APIs.
 * Responsibilities: Declare reviewer responsibility domains, partition descriptors, cascade event
 *   payloads, review context cache entries, and the ISparseOrchestrator SPI contract.
 * Exit Semantics & Design Rationale: Pure contracts; zero runtime overhead; ensures strict
 *   isolation boundaries and predictable event flow between specialized analyzers.
 */

import type { Issue } from '../types';
import type { FineGrainedFileRole } from '../intelligence/file-role-inference';
import type { CodeDensityMetrics } from '../intelligence/code-density-analyzer';
import type { ConvergedReviewResult } from './semantic-convergence';
import type { TaskPriority } from './execution-scheduler';

/** Reviewer responsibility domain categories */
export type ReviewerDomain =
    | 'DOCUMENTATION'
    | 'LOGIC_AND_COMPLEXITY'
    | 'NAMING_AND_LAYOUT'
    | 'ARCHITECTURE'
    | 'SECURITY_AND_SECRETS';

/** Reviewer domain binding mapping */
export interface ReviewDomainBinding {
    /** Domain category */
    domain: ReviewerDomain;
    /** Analyzers belonging to this domain */
    analyzers: string[];
    /** Semantic scope and syntax responsibility description */
    scopeDescription: string;
}

/** Dynamic review partition descriptor */
export interface ReviewPartition {
    /** Unique partition identifier (e.g. "part-core-cache-1") */
    id: string;
    /** Primary source files analyzed within this partition */
    primaryFiles: string[];
    /** Read-only context files needed for dependency or type resolution */
    contextFiles: string[];
    /** Estimated total computing workload (ECL * complexity multiplier) */
    estimatedWorkload: number;
    /** Active reviewer domains assigned to this partition */
    activeDomains: ReviewerDomain[];
    /** Dominant architectural role across primary files */
    dominantRole: FineGrainedFileRole;
}

/** Cascade event kind triggered across review domains */
export type ReviewCascadeEventKind =
    | 'DOC_CODE_CONTRACT_MISMATCH'
    | 'SYMBOL_NAMING_COLLISION'
    | 'UNBOUNDED_COMPLEXITY_SPIKE'
    | 'CROSS_FILE_DEPENDENCY_MUTATION';

/** Cascade event payload coordinating cross-domain secondary review */
export interface ReviewCascadeEvent {
    /** Unique event identifier */
    eventId: string;
    /** Category of cascade event */
    kind: ReviewCascadeEventKind;
    /** Originating domain */
    sourceDomain: ReviewerDomain;
    /** Target domain recommended for targeted activation */
    targetDomain: ReviewerDomain;
    /** Paths of affected source files */
    affectedFiles: string[];
    /** Target symbol identifier if localized */
    targetSymbol?: string;
    /** Justification for the triggered cascade */
    reason: string;
    /** Initial finding triggering the cascade */
    triggeringFinding?: Issue;
}

/** In-memory review context cache entry */
export interface ReviewContextEntry {
    /** Relative file path */
    filePath: string;
    /** Content fingerprint hash */
    contentHash: string;
    /** Inferred architectural role */
    role: FineGrainedFileRole;
    /** Evaluated code density metrics */
    density: CodeDensityMetrics;
    /** Primary local findings from initial partition review */
    localFindings: Issue[];
    /** Execution duration in milliseconds */
    durationMs: number;
    /** Timestamp when entry was stored */
    cachedAt: number;
}

/** Options configuring scale-adaptive sparse orchestration */
export interface SparseSchedulerOptions {
    /** Maximum worker concurrency */
    maxConcurrency?: number;
    /** Enable secondary cascade verification (default: true) */
    enableSecondaryCheck?: boolean;
    /** Active domain whitelist filter */
    enabledDomains?: ReviewerDomain[];
    /** Maximum allowed files clustered into a single partition (default: 25) */
    maxPartitionFiles?: number;
    /** Active Agent OS caller UID requesting review */
    agentUid?: string;
    /** Task priority for quota and pool preemption */
    priority?: TaskPriority;
    /** Enable 3D tensor-parallel partitioning (Data x Depth x Rule) */
    enableTensorPartitioning?: boolean;
    /** Enable pooled multi-core execution (default: true) */
    enablePooling?: boolean;
    /** Directed dependency edges [from, to] across codebase */
    dependencyEdges?: [string, string][];
}

/** Final execution summary payload for the sparse review pipeline */
export interface SparseSchedulerResult {
    /** Total source files processed */
    totalFiles: number;
    /** Total partitions evaluated */
    partitionCount: number;
    /** Millisecond duration across pipeline stages */
    stageTimingsMs: {
        structureAnalysis: number;
        partitioning: number;
        localAnalysis: number;
        secondaryCheck: number;
        globalInvariant: number;
        scoring: number;
    };
    /** Ratio of CPU time saved compared to full naive scan */
    sparseActivationSavingsRatio: number;
    /** Deduplicated aggregate findings */
    findings: Issue[];
    /** Context cache hit count */
    cacheHits: number;
    /** Total triggered cascade events */
    cascadeEventCount: number;
    /** All-Reduce converged outcome */
    convergedResult?: ConvergedReviewResult;
    /** Detected circular dependency loops */
    circularDependencies?: string[][];
    /** Detected cross-partition symbol collisions */
    symbolConflicts?: { symbol: string; definedIn: string[] }[];
    /** Granted agent lease identifier if agentUid was supplied */
    agentLeaseId?: string;
}
