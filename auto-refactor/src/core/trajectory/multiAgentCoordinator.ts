/**
 * Module: Core Engine — Multi-Agent Coordinator Facade
 * File Path: src/core/trajectory/multiAgentCoordinator.ts
 * Architecture Role: Orchestrates multi-agent change attribution, architectural collision
 *   detection, intent conflict auditing, and patch arbitration into a unified report.
 * Dependencies & Triggers: Consumes tracker, collision detector, conflict detector, duplicate
 *   auditor, arbiter, and contracts from ./types.
 * Responsibilities: Coordinate parallel agent patches, aggregate all findings, determine the
 *   consolidated multi-agent governance verdict, and emit blocking issues.
 * Exit Semantics & Design Rationale: Central headless facade; produces deterministic results;
 *   returns 'blocking_collisions' verdict if any architectural collision issue is present.
 */

import type { Issue } from '../types';
import type { AgentPatchSlice, MultiAgentGovernanceResult } from './types';
import { AgentAttributionTracker } from './agentAttribution';
import { AgentCollisionDetector } from './agentCollisionDetector';
import { IntentConflictDetector } from './intentConflictDetector';
import { DuplicateWorkAuditor } from './duplicateWorkAuditor';
import { PatchArbiter } from './patchArbiter';

/**
 * Options configuring the multi-agent governance coordination.
 */
export interface MultiAgentCoordinationOptions {
    baseEdges?: Array<{ from: string; to: string }>;
    duplicateWorkThreshold?: number;
}

/**
 * Orchestrates multi-agent governance across parallel patches.
 */
export class MultiAgentCoordinator {
    private readonly attributionTracker = new AgentAttributionTracker();
    private readonly collisionDetector = new AgentCollisionDetector();
    private readonly conflictDetector = new IntentConflictDetector();
    private readonly duplicateAuditor = new DuplicateWorkAuditor();
    private readonly patchArbiter = new PatchArbiter();

    /**
     * Coordinates analysis of concurrent agent patches and produces a consolidated report.
     */
    public coordinate(
        patches: AgentPatchSlice[],
        options: MultiAgentCoordinationOptions = {},
    ): MultiAgentGovernanceResult {
        const attributions = this.attributionTracker.computeFromPatches(patches);
        const collisions = this.collisionDetector.detectCollisions(
            patches,
            options.baseEdges || [],
        );
        const conflicts = this.conflictDetector.detectPatchConflicts(patches);
        const duplicateWork = this.duplicateAuditor.auditDuplicateWork(
            patches,
            options.duplicateWorkThreshold,
        );
        const arbitrations = this.patchArbiter.arbitratePatches(patches);

        const issues: Issue[] = [];
        for (const col of collisions) {
            issues.push(col.issue);
        }

        let verdict: MultiAgentGovernanceResult['verdict'] = 'clean';
        if (collisions.length > 0) {
            verdict = 'blocking_collisions';
        } else if (conflicts.length > 0 || duplicateWork.length > 0) {
            verdict = 'has_conflicts';
        }

        return {
            attributions,
            collisions,
            conflicts,
            duplicateWork,
            arbitrations,
            issues,
            verdict,
        };
    }
}

/** Default singleton instance of MultiAgentCoordinator */
export const defaultMultiAgentCoordinator = new MultiAgentCoordinator();
