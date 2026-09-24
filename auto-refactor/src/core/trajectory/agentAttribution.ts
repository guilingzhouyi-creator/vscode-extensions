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

/** Internal mutable state tracker used during accumulation to avoid in-loop array lookups. */
interface MutableAttribution {
    attr: AgentAttribution;
    filesModifiedSet: Set<string>;
    introducedIssuesSet: Set<string>;
    resolvedIssuesSet: Set<string>;
    scores: number[];
}

/**
 * Creates an empty mutable attribution bucket for an agent.
 *
 * @param agentUid - Unique identifier of the agent.
 * @returns Initialized MutableAttribution instance.
 */
function createMutableAttribution(agentUid: string): MutableAttribution {
    return {
        attr: {
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
        },
        filesModifiedSet: new Set<string>(),
        introducedIssuesSet: new Set<string>(),
        resolvedIssuesSet: new Set<string>(),
        scores: [],
    };
}

/**
 * Accumulates patch slice metrics into the agent's attribution bucket using O(1) set operations.
 *
 * @param mutable - Mutable attribution accumulator.
 * @param patch - Incoming atomic patch slice.
 */
function accumulatePatchMetrics(mutable: MutableAttribution, patch: AgentPatchSlice): void {
    const { attr, filesModifiedSet, introducedIssuesSet, scores } = mutable;
    attr.totalPatches += 1;
    filesModifiedSet.add(patch.filePath);
    attr.linesAdded += patch.addedLines;
    attr.linesDeleted += patch.deletedLines;

    if (patch.ruleHitIds) {
        for (const rule of patch.ruleHitIds) {
            introducedIssuesSet.add(rule);
        }
    }
    if (patch.compositeScore !== undefined) {
        scores.push(patch.compositeScore);
    }
}

/**
 * Finalizes composite scores and converts tracking sets into frozen result arrays.
 *
 * @param mutable - Mutable attribution accumulator.
 * @param baselineScore - Starting baseline quality score.
 * @returns Fully populated, immutable AgentAttribution record.
 */
function finalizeAttribution(mutable: MutableAttribution, baselineScore: number): AgentAttribution {
    const { attr, filesModifiedSet, introducedIssuesSet, resolvedIssuesSet, scores } = mutable;
    attr.filesModified = Array.from(filesModifiedSet);
    attr.introducedIssues = Array.from(introducedIssuesSet);
    attr.resolvedIssues = Array.from(resolvedIssuesSet);
    attr.netIssueDelta = attr.resolvedIssues.length - attr.introducedIssues.length;

    if (scores.length > 0) {
        const sum = scores.reduce((acc, val) => acc + val, 0);
        attr.averageQualityScore = Math.round((sum / scores.length) * 10) / 10;
        const lastScore = scores[scores.length - 1];
        attr.scoreImpact = Math.round((lastScore - baselineScore) * 10) / 10;
    }
    return attr;
}

/**
 * Tracks and computes code change attributions for multiple agents.
 */
export class AgentAttributionTracker {
    /**
     * Aggregates attribution statistics from a chronological sequence of FileRevisions.
     *
     * @param filePath - Path of the file being tracked.
     * @param revisions - Chronological list of file revisions.
     * @returns Map of agent UID to calculated attribution metrics.
     */
    public computeFromRevisions(
        filePath: string,
        revisions: FileRevision[],
    ): Record<string, AgentAttribution> {
        const mutables: Record<string, MutableAttribution> = {};

        for (let i = 0; i < revisions.length; i++) {
            const rev = revisions[i];
            const uid = rev.agentUid;
            if (!mutables[uid]) {
                mutables[uid] = createMutableAttribution(uid);
            }
            const mutable = mutables[uid];
            mutable.attr.totalPatches += 1;
            mutable.filesModifiedSet.add(filePath);
            if (rev.diffSummary) {
                mutable.attr.linesAdded += rev.diffSummary.addedLines;
                mutable.attr.linesDeleted += rev.diffSummary.deletedLines;
            }
            const compScore = rev.qualityScore?.compositeScore ?? 100;
            mutable.scores.push(compScore);

            this.trackRevisionIssues(rev, i > 0 ? revisions[i - 1] : undefined, mutable);
        }

        const baseline = revisions[0]?.qualityScore?.compositeScore ?? 100;
        const attributions: Record<string, AgentAttribution> = {};
        for (const uid of Object.keys(mutables)) {
            attributions[uid] = finalizeAttribution(mutables[uid], baseline);
        }

        return attributions;
    }

    /**
     * Resolves newly introduced and resolved issues between consecutive revisions.
     *
     * @param current - Current file revision.
     * @param previous - Preceding file revision.
     * @param mutable - Mutable attribution accumulator.
     */
    private trackRevisionIssues(
        current: FileRevision,
        previous: FileRevision | undefined,
        mutable: MutableAttribution,
    ): void {
        const prevIssues = new Set(previous?.ruleHitIds || []);
        const currIssues = new Set(current.ruleHitIds || []);

        for (const rule of currIssues) {
            if (!prevIssues.has(rule)) {
                mutable.introducedIssuesSet.add(rule);
            }
        }
        for (const rule of prevIssues) {
            if (!currIssues.has(rule)) {
                mutable.resolvedIssuesSet.add(rule);
            }
        }
    }

    /**
     * Aggregates attribution statistics from an array of independent patch slices.
     *
     * @param patches - List of submitted agent patch slices.
     * @returns Map of agent UID to calculated attribution metrics.
     */
    public computeFromPatches(patches: AgentPatchSlice[]): Record<string, AgentAttribution> {
        const mutables: Record<string, MutableAttribution> = {};

        for (const patch of patches) {
            const uid = patch.agentUid;
            if (!mutables[uid]) {
                mutables[uid] = createMutableAttribution(uid);
            }
            accumulatePatchMetrics(mutables[uid], patch);
        }

        const attributions: Record<string, AgentAttribution> = {};
        for (const uid of Object.keys(mutables)) {
            attributions[uid] = finalizeAttribution(mutables[uid], 100);
        }

        return attributions;
    }
}

/** Default singleton instance of AgentAttributionTracker */
export const defaultAgentAttributionTracker = new AgentAttributionTracker();
