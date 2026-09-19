/**
 * Module: Core Engine — Agent Change Attribution Tracker
 * File Path: src/core/trajectory/agentAttribution.ts
 * Architecture Role: Aggregates atomic revision history and patch slices into per-agent
 *   attribution summaries, quantifying net quality impact and issue velocity.
 * Dependencies & Triggers: Consumes FileRevision and AgentPatchSlice from ./types.
 * Responsibilities: Track lines added/deleted, unique files touched, introduced vs resolved
 *   issues, net issue delta, and composite score deltas across multiple AI agents.
 * Exit Semantics & Design Rationale: Pure in-memory deterministic calculations; returns empty
 *   attributions record when inputs are empty without throwing exceptions.
 */

import type { AgentAttribution, AgentPatchSlice, FileRevision } from './types';

/**
 * Creates a default empty attribution bucket for an agent.
 */
function createEmptyAttribution(agentUid: string): AgentAttribution {
    return {
        agentUid,
        totalPatches: 0,
        filesModified: [],
        linesAdded: 0,
        linesDeleted: 0,
        introducedIssues: [],
        resolvedIssues: [],
        netIssueDelta: 0,
        averageQualityScore: 100,
        scoreImpact: 0,
    };
}

/**
 * Accumulates patch slice metrics into the agent's attribution bucket.
 */
function accumulatePatchMetrics(
    attribution: AgentAttribution,
    patch: AgentPatchSlice,
    qualityScores: number[],
): void {
    attribution.totalPatches += 1;
    if (!attribution.filesModified.includes(patch.filePath)) {
        attribution.filesModified.push(patch.filePath);
    }
    attribution.linesAdded += patch.addedLines;
    attribution.linesDeleted += patch.deletedLines;

    if (patch.ruleHitIds) {
        for (const rule of patch.ruleHitIds) {
            if (!attribution.introducedIssues.includes(rule)) {
                attribution.introducedIssues.push(rule);
            }
        }
    }
    if (patch.compositeScore !== undefined) {
        qualityScores.push(patch.compositeScore);
    }
}

/**
 * Finalizes composite and average scores on an attribution record.
 */
function finalizeAttributionScores(
    attribution: AgentAttribution,
    scores: number[],
    baselineScore: number,
): void {
    attribution.netIssueDelta =
        attribution.resolvedIssues.length - attribution.introducedIssues.length;
    if (scores.length > 0) {
        const sum = scores.reduce((acc, val) => acc + val, 0);
        attribution.averageQualityScore = Math.round((sum / scores.length) * 10) / 10;
        const lastScore = scores[scores.length - 1];
        attribution.scoreImpact = Math.round((lastScore - baselineScore) * 10) / 10;
    }
}

/**
 * Tracks and computes code change attributions for multiple agents.
 */
export class AgentAttributionTracker {
    /**
     * Aggregates attribution statistics from a chronological sequence of FileRevisions.
     */
    public computeFromRevisions(
        filePath: string,
        revisions: FileRevision[],
    ): Record<string, AgentAttribution> {
        const attributions: Record<string, AgentAttribution> = {};
        const agentScores: Record<string, number[]> = {};

        for (let i = 0; i < revisions.length; i++) {
            const rev = revisions[i];
            const uid = rev.agentUid;
            if (!attributions[uid]) {
                attributions[uid] = createEmptyAttribution(uid);
                agentScores[uid] = [];
            }
            const attr = attributions[uid];
            attr.totalPatches += 1;
            if (!attr.filesModified.includes(filePath)) {
                attr.filesModified.push(filePath);
            }
            if (rev.diffSummary) {
                attr.linesAdded += rev.diffSummary.addedLines;
                attr.linesDeleted += rev.diffSummary.deletedLines;
            }
            const compScore = rev.qualityScore?.compositeScore ?? 100;
            agentScores[uid].push(compScore);

            this.trackRevisionIssues(rev, i > 0 ? revisions[i - 1] : undefined, attr);
        }

        const baseline = revisions[0]?.qualityScore?.compositeScore ?? 100;
        for (const uid of Object.keys(attributions)) {
            finalizeAttributionScores(attributions[uid], agentScores[uid] || [], baseline);
        }

        return attributions;
    }

    /**
     * Resolves newly introduced and resolved issues between consecutive revisions.
     */
    private trackRevisionIssues(
        current: FileRevision,
        previous: FileRevision | undefined,
        attr: AgentAttribution,
    ): void {
        const prevIssues = new Set(previous?.ruleHitIds || []);
        const currIssues = new Set(current.ruleHitIds || []);

        for (const rule of currIssues) {
            if (!prevIssues.has(rule) && !attr.introducedIssues.includes(rule)) {
                attr.introducedIssues.push(rule);
            }
        }
        for (const rule of prevIssues) {
            if (!currIssues.has(rule) && !attr.resolvedIssues.includes(rule)) {
                attr.resolvedIssues.push(rule);
            }
        }
    }

    /**
     * Aggregates attribution statistics from an array of independent patch slices.
     */
    public computeFromPatches(patches: AgentPatchSlice[]): Record<string, AgentAttribution> {
        const attributions: Record<string, AgentAttribution> = {};
        const agentScores: Record<string, number[]> = {};

        for (const patch of patches) {
            const uid = patch.agentUid;
            if (!attributions[uid]) {
                attributions[uid] = createEmptyAttribution(uid);
                agentScores[uid] = [];
            }
            accumulatePatchMetrics(attributions[uid], patch, agentScores[uid]);
        }

        for (const uid of Object.keys(attributions)) {
            finalizeAttributionScores(attributions[uid], agentScores[uid] || [], 100);
        }

        return attributions;
    }
}

/** Default singleton instance of AgentAttributionTracker */
export const defaultAgentAttributionTracker = new AgentAttributionTracker();
