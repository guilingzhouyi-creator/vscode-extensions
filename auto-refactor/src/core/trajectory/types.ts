/**
 * Module: Core Engine — Change Trajectory Type Contracts
 * File Path: src/core/trajectory/types.ts
 * Architecture Role: Single source of truth for the trajectory data contracts; a pure
 *   declaration module that both the detector and the manager compile against
 * Dependencies & Triggers: Imports QualityDimension / QualityScoreBreakdown from
 *   ../scoring/scoringTypes and Severity from ../types; consumed by anomalyDetector,
 *   changeTrajectory, the Scanner pipeline and training exporter, and re-exported through the
 *   public barrel in src/api.ts
 * Responsibilities: Define the five EvolutionAnomalyKind values; describe EvolutionAnomaly
 *   (kind, optional dimension and domainId, severity, message, affectedAgents, details);
 *   describe the atomic FileRevision snapshot including qualityScore, ruleHitIds, diffSummary
 *   and optional rollback markers; describe TrajectoryComparison deltas, issue lists and
 *   summary; describe the FileChangeTrajectory container with latestComparison and
 *   activeAnomalies
 * Exit Semantics & Design Rationale: Compile-time only, erased at runtime, so it performs no
 *   validation and cannot fail; optional properties intentionally express "unknown/absent"
 *   rather than zero, forcing consumers to null-check before reading rollback or diff data,
 *   and the module deliberately imports nothing but type contracts to stay cycle-free.
 */
import type { QualityDimension, QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { Severity } from '../types';

/** Specific anomaly detected across revisions or between different agents */
export type EvolutionAnomalyKind =
    | 'quality-regression'
    | 'style-drift'
    | 'duplicate-fix'
    | 're-introduced-issue'
    | 'logical-rollback';

/**
 * A single anomaly detected across revisions or between agents.
 *
 * Contract: `kind` selects the detector rule that fired; `message` is a pre-rendered
 * human-readable explanation; `affectedAgents` lists the agent uids involved and is
 * populated for every anomaly emitted by the bundled detector; `details` carries
 * rule-specific evidence such as score deltas, restored revision ids or overlapping
 * domains.
 *
 * Optional fields: `dimension` is set only for per-dimension quality regressions, while
 * `domainId` is reserved for domain-scoped anomalies and is currently never emitted, so
 * consumers must treat it as absent by default.
 */
export interface EvolutionAnomaly {
    kind: EvolutionAnomalyKind;
    dimension?: QualityDimension;
    severity: Severity;
    message: string;
    domainId?: string;
    affectedAgents: string[];
    details: Record<string, any>;
}

/** Atomic snapshot of a single revision */
export interface FileRevision {
    revisionId: string;
    timestamp: number;
    agentUid: string;
    commitHash?: string;
    fileHash: string;
    astDigest: string;
    qualityScore: QualityScoreBreakdown;
    ruleHitIds: string[];
    diffSummary?: {
        addedLines: number;
        deletedLines: number;
        modifiedDomains: string[];
    };
    isRollback?: boolean;
    rolledBackToRevisionId?: string;
}

/** Comparison result between two revisions */
export interface TrajectoryComparison {
    filePath: string;
    fromRevisionId: string;
    toRevisionId: string;
    fromAgent: string;
    toAgent: string;
    dimensionDeltas: Record<QualityDimension, number>;
    compositeDelta: number;
    newIssues: Array<{
        id: string;
        rule: string;
        severity: Severity;
        line: number;
        message: string;
    }>;
    resolvedIssues: Array<{
        id: string;
        rule: string;
        severity: Severity;
        line: number;
        message: string;
    }>;
    anomalies: EvolutionAnomaly[];
    isLogicalRollback: boolean;
    summary: string;
}

/** Multi-revision trajectory container for a single file */
export interface FileChangeTrajectory {
    filePath: string;
    revisions: FileRevision[];
    totalRevisions: number;
    participatingAgents: string[];
    latestComparison?: TrajectoryComparison;
    activeAnomalies: EvolutionAnomaly[];
}
