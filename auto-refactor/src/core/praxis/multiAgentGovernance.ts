/**
 * Module: Core Engine — Praxis Multi-Agent Governance Facade
 * File Path: src/core/praxis/multiAgentGovernance.ts
 * Architecture Role: Formal interface and facade for Praxis multi-agent review cells,
 *   coordinating concurrent patch conflict detection, cross-agent dependency governance,
 *   and patch quality arbitration.
 * Dependencies & Triggers: Consumes multi-agent trajectory components from ../trajectory/
 *   and types from ../types; consumed by Praxis merge gates and development teams.
 * Responsibilities: Provide strongly typed SPI and service facade for multi-agent patch
 *   inspection, collision detection, and attribution.
 * Exit Semantics & Design Rationale: Interface-first design maintains long-term backward
 *   compatibility for Praxis cells while isolating internal graph algorithms.
 */

import type { Issue } from '../types';
import type {
    AgentAttribution,
    AgentCollision,
    AgentPatchSlice,
    FileRevision,
    MultiAgentGovernanceResult,
    PatchArbitrationCandidate,
} from '../trajectory/types';
import {
    defaultAgentAttributionTracker,
    defaultAgentCollisionDetector,
    defaultMultiAgentCoordinator,
    defaultPatchArbiter,
} from '../trajectory';

/**
 * Options configuring the Praxis multi-agent governance execution.
 */
export interface PraxisMultiAgentOptions {
    /** Base dependency edges of the repository */
    baseEdges?: Array<{ from: string; to: string }>;
    /** Threshold ratio for flagging duplicate work / redundant churn (default: 0.5) */
    duplicateWorkThreshold?: number;
    /** Whether to evaluate patch quality on candidates (default: true) */
    enablePatchQuality?: boolean;
}

/**
 * Composite governance report delivered to Praxis review cells for multi-agent changes.
 */
export interface PraxisMultiAgentGovernanceResult {
    /** Multi-agent governance core result */
    report: MultiAgentGovernanceResult;
    /** Blocking architectural issues that fail merge gates */
    blockingIssues: Issue[];
    /** Advisory conflicts or duplicate work warnings */
    advisoryWarnings: string[];
    /** Consolidated verdict for Praxis merge gates */
    verdict: 'approved' | 'rejected' | 'rework_needed';
}

/**
 * Formal service interface exposed to the Praxis development team for multi-agent governance.
 */
export interface IPraxisMultiAgentGovernanceService {
    /**
     * Conducts comprehensive multi-agent governance review across concurrent patch slices.
     */
    reviewMultiAgentPatches(
        patches: AgentPatchSlice[],
        options?: PraxisMultiAgentOptions,
    ): Promise<PraxisMultiAgentGovernanceResult>;

    /**
     * Detects architectural collisions and circular dependencies across concurrent agent patches.
     */
    detectAgentCollisions(
        patches: AgentPatchSlice[],
        baseEdges?: Array<{ from: string; to: string }>,
    ): AgentCollision[];

    /**
     * Computes contribution attribution metrics across agent revision histories.
     */
    attributeAgentChanges(
        filePath: string,
        revisions: FileRevision[],
    ): Record<string, AgentAttribution>;

    /**
     * Ranks and arbitrates competing candidate patches submitted by parallel agents.
     */
    arbitrateCompetingPatches(patches: AgentPatchSlice[]): PatchArbitrationCandidate[];
}

/**
 * High-performance, interface-driven implementation of the Praxis Multi-Agent Governance Service.
 */
export class PraxisMultiAgentGovernanceService implements IPraxisMultiAgentGovernanceService {
    /**
     * Reviews concurrent agent patches for collisions, conflicts, and quality.
     */
    public async reviewMultiAgentPatches(
        patches: AgentPatchSlice[],
        options: PraxisMultiAgentOptions = {},
    ): Promise<PraxisMultiAgentGovernanceResult> {
        const report = defaultMultiAgentCoordinator.coordinate(patches, {
            baseEdges: options.baseEdges,
            duplicateWorkThreshold: options.duplicateWorkThreshold,
        });

        const blockingIssues = report.issues.filter((i) => i.severity === 'error');
        const advisoryWarnings: string[] = [];

        for (const conf of report.conflicts) {
            advisoryWarnings.push(`[${conf.kind}] ${conf.description}`);
        }
        for (const dup of report.duplicateWork) {
            advisoryWarnings.push(
                `Duplicate work between '${dup.agentA}' and '${dup.agentB}' ` +
                    `(overlap: ${(dup.overlapRatio * 100).toFixed(0)}%) in: ${dup.commonFiles.join(', ')}`,
            );
        }

        let verdict: PraxisMultiAgentGovernanceResult['verdict'] = 'approved';
        if (blockingIssues.length > 0) {
            verdict = 'rejected';
        } else if (advisoryWarnings.length > 0) {
            verdict = 'rework_needed';
        }

        return {
            report,
            blockingIssues,
            advisoryWarnings,
            verdict,
        };
    }

    /**
     * Detects architectural collisions and circular dependencies.
     */
    public detectAgentCollisions(
        patches: AgentPatchSlice[],
        baseEdges: Array<{ from: string; to: string }> = [],
    ): AgentCollision[] {
        return defaultAgentCollisionDetector.detectCollisions(patches, baseEdges);
    }

    /**
     * Computes contribution attribution metrics across revisions.
     */
    public attributeAgentChanges(
        filePath: string,
        revisions: FileRevision[],
    ): Record<string, AgentAttribution> {
        return defaultAgentAttributionTracker.computeFromRevisions(filePath, revisions);
    }

    /**
     * Ranks and arbitrates competing candidate patches.
     */
    public arbitrateCompetingPatches(patches: AgentPatchSlice[]): PatchArbitrationCandidate[] {
        return defaultPatchArbiter.arbitratePatches(patches);
    }
}

/** Default singleton instance for Praxis multi-agent governance */
export const defaultPraxisMultiAgentGovernanceService = new PraxisMultiAgentGovernanceService();

/**
 * Factory creating a fresh instance of Praxis multi-agent governance service.
 *
 * @returns Fresh IPraxisMultiAgentGovernanceService instance.
 */
export function createPraxisMultiAgentGovernanceService(): IPraxisMultiAgentGovernanceService {
    return new PraxisMultiAgentGovernanceService();
}
