/**
 * Module: Core Scoring — Topological Churn & Fan-in Multiplier Evaluator
 * File Path: src/core/scoring/topological-churn-evaluator.ts
 * Architecture Role: Evaluates architectural centrality (Fan-in) and temporal churn
 *   intensity to calculate composite impact multiplier M_impact(f) for targeted technical
 *   debt prioritization.
 * Dependencies & Triggers: Consumes GitFileHistoryProfile from ../evolution/git-history-miner;
 *   called by scan pipeline and QualityScorer.
 * Responsibilities:
 *   1. Calculate fan-in multiplier (1 + ln(1 + FanIn(f))) with configurable soft ceiling.
 *   2. Compute 30-day temporal churn intensity using bounded hyperbolic tangent (Tanh).
 *   3. Apply frozen decay relaxation (0.6x) for stable, un-churned legacy modules.
 *   4. Safe 1.0 fallback when dependency graph or git history is unavailable.
 * Exit Semantics & Design Rationale: Pure mathematical evaluator; zero side-effects; non-throwing.
 */

import type { GitFileHistoryProfile } from '../evolution/git-history-miner';

export const DEFAULT_ALPHA_CHURN = 0.5;
export const DEFAULT_MU_CHURN = 4.0;
export const DEFAULT_MAX_FAN_IN_MULTIPLIER = 6.0;
export const DEFAULT_FROZEN_THRESHOLD_DAYS = 180;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const CHURN_WINDOW_DAYS = 30;

const FROZEN_LEGACY_MAX_FAN_IN = 2;
const FROZEN_BASELINE_RELAXATION = 0.6;
const NEUTRAL_CHURN_MULTIPLIER = 1.0;
const MIN_COMBINED_IMPACT = 0.5;
const MAX_COMBINED_IMPACT = 8.0;

const HIGH_CENTRALITY_FAN_IN_THRESHOLD = 15;
const HIGH_CENTRALITY_CHURN_THRESHOLD = 3;
const ISOLATE_CHURN_COMMIT_THRESHOLD = 6;

const HOTSPOT_RED_IMPACT_THRESHOLD = 2.5;
const HOTSPOT_RED_FAN_IN_THRESHOLD = 10;
const HOTSPOT_RED_CHURN_THRESHOLD = 3;
const HOTSPOT_YELLOW_IMPACT_THRESHOLD = 1.5;
const HOTSPOT_YELLOW_CHURN_THRESHOLD = 2;

export const HOTSPOT_CATEGORY_RED = 'red';
export const HOTSPOT_CATEGORY_YELLOW = 'yellow';
export const HOTSPOT_CATEGORY_GREEN = 'green';

export const ACTION_HIGH_CENTRALITY_GUARD = 'high_centrality_refactor_guard';
export const ACTION_ISOLATE_CHURN_HOTSPOT = 'isolate_churn_hotspot';

/**
 * Configuration parameters governing topological churn scoring and fan-in amplification.
 */
export interface TopologicalChurnOptions {
    alphaChurn?: number; // Weight of temporal churn in Tanh (default 0.5)
    muChurn?: number; // Normalization midpoint for monthly churn (default 4 commits)
    maxFanInMultiplier?: number; // Soft ceiling for fan-in amplifier (default 6.0)
    frozenThresholdDays?: number; // Days without commit to enter frozen relaxation (default 180)
    nowTimestamp?: number;
}

/**
 * Result metrics evaluating impact multiplier, fan-in centrality, and temporal churn.
 */
export interface TopologicalChurnResult {
    filePath: string;
    fanIn: number;
    churn30dCommits: number;
    fanInMultiplier: number;
    churnMultiplier: number;
    impactMultiplier: number; // M_impact(f)
    isFrozenLegacy: boolean;
    hotspotCategory?: 'red' | 'yellow' | 'green';
    actionableProposal?: {
        action: 'high_centrality_refactor_guard' | 'isolate_churn_hotspot';
        rationale: string;
    };
}

/**
 * Evaluates architectural impact multipliers by fusing dependency graph fan-in with Git churn.
 */
export class TopologicalChurnEvaluator {
    private readonly alphaChurn: number;
    private readonly muChurn: number;
    private readonly maxFanInMultiplier: number;
    private readonly frozenThresholdDays: number;
    private readonly nowTimestamp: number;

    constructor(options?: TopologicalChurnOptions) {
        this.alphaChurn = options?.alphaChurn ?? DEFAULT_ALPHA_CHURN;
        this.muChurn = options?.muChurn ?? DEFAULT_MU_CHURN;
        this.maxFanInMultiplier = options?.maxFanInMultiplier ?? DEFAULT_MAX_FAN_IN_MULTIPLIER;
        this.frozenThresholdDays = options?.frozenThresholdDays ?? DEFAULT_FROZEN_THRESHOLD_DAYS;
        this.nowTimestamp = options?.nowTimestamp ?? Date.now();
    }

    private calculateFanInMultiplier(safeFanIn: number): number {
        const rawFanInMultiplier = 1.0 + Math.log(1.0 + safeFanIn);
        return +Math.min(this.maxFanInMultiplier, rawFanInMultiplier).toFixed(2);
    }

    private analyzeCommitChurn(
        safeFanIn: number,
        history?: GitFileHistoryProfile | null,
    ): { churn30dCommits: number; isFrozenLegacy: boolean } {
        if (!history || !history.isGitAvailable || history.recentCommits.length === 0) {
            return { churn30dCommits: 0, isFrozenLegacy: false };
        }

        const thirtyDaysAgo = this.nowTimestamp - CHURN_WINDOW_DAYS * MS_PER_DAY;
        const frozenThresholdAgo = this.nowTimestamp - this.frozenThresholdDays * MS_PER_DAY;

        let churn30dCommits = 0;
        for (const commit of history.recentCommits) {
            if (commit.timestamp >= thirtyDaysAgo) {
                churn30dCommits++;
            }
        }

        const isFrozenLegacy =
            history.lastModifiedTimestamp !== null &&
            history.lastModifiedTimestamp < frozenThresholdAgo &&
            safeFanIn <= FROZEN_LEGACY_MAX_FAN_IN;

        return { churn30dCommits, isFrozenLegacy };
    }

    private calculateChurnMultiplier(churn30dCommits: number, isFrozenLegacy: boolean): number {
        if (isFrozenLegacy) {
            return FROZEN_BASELINE_RELAXATION; // Inactive dormant baseline relaxation
        }
        if (churn30dCommits > 0) {
            const normalizedChurn = churn30dCommits / this.muChurn;
            return +(1.0 + this.alphaChurn * Math.tanh(normalizedChurn)).toFixed(2);
        }
        return NEUTRAL_CHURN_MULTIPLIER;
    }

    private calculateCombinedImpact(fanInMultiplier: number, churnMultiplier: number): number {
        const impactMultiplier = +(fanInMultiplier * churnMultiplier).toFixed(2);
        return Math.max(MIN_COMBINED_IMPACT, Math.min(MAX_COMBINED_IMPACT, impactMultiplier));
    }

    private resolveProposal(
        filePath: string,
        safeFanIn: number,
        churn30dCommits: number,
        impactMultiplier: number,
    ): TopologicalChurnResult['actionableProposal'] {
        if (
            safeFanIn >= HIGH_CENTRALITY_FAN_IN_THRESHOLD &&
            churn30dCommits >= HIGH_CENTRALITY_CHURN_THRESHOLD
        ) {
            return {
                action: ACTION_HIGH_CENTRALITY_GUARD,
                rationale:
                    `High-centrality module '${filePath}' has ${safeFanIn} incoming dependencies ` +
                    `and active 30-day churn (${churn30dCommits} commits). Impact amplifier is ${impactMultiplier}x. ` +
                    `Enforce strict interface contracts before refactoring.`,
            };
        }
        if (churn30dCommits >= ISOLATE_CHURN_COMMIT_THRESHOLD) {
            return {
                action: ACTION_ISOLATE_CHURN_HOTSPOT,
                rationale:
                    `High temporal churn (${churn30dCommits} commits in 30 days) on '${filePath}'. ` +
                    `Consider decoupling volatile subroutines to stabilize core logic.`,
            };
        }
        return undefined;
    }

    /**
     * Evaluate the combined impact multiplier M_impact(f) for a given file.
     *
     * @param filePath - Path to target file.
     * @param fanIn - Number of incoming dependencies pointing to this file.
     * @param history - Optional mined git history profile.
     * @returns Complete topological churn evaluation result.
     */
    public evaluate(
        filePath: string,
        fanIn: number = 0,
        history?: GitFileHistoryProfile | null,
    ): TopologicalChurnResult {
        const safeFanIn = Math.max(0, fanIn);
        const fanInMultiplier = this.calculateFanInMultiplier(safeFanIn);
        const churnAnalysis = this.analyzeCommitChurn(safeFanIn, history);
        const churnMultiplier = this.calculateChurnMultiplier(
            churnAnalysis.churn30dCommits,
            churnAnalysis.isFrozenLegacy,
        );
        const impactMultiplier = this.calculateCombinedImpact(fanInMultiplier, churnMultiplier);
        const actionableProposal = this.resolveProposal(
            filePath,
            safeFanIn,
            churnAnalysis.churn30dCommits,
            impactMultiplier,
        );
        const hotspotCategory = this.resolveHotspotCategory(
            impactMultiplier,
            safeFanIn,
            churnAnalysis.churn30dCommits,
            churnAnalysis.isFrozenLegacy,
        );

        return {
            filePath,
            fanIn: safeFanIn,
            churn30dCommits: churnAnalysis.churn30dCommits,
            fanInMultiplier,
            churnMultiplier,
            impactMultiplier,
            isFrozenLegacy: churnAnalysis.isFrozenLegacy,
            hotspotCategory,
            actionableProposal,
        };
    }

    private resolveHotspotCategory(
        impactMultiplier: number,
        safeFanIn: number,
        churn30dCommits: number,
        isFrozen: boolean,
    ): 'red' | 'yellow' | 'green' {
        if (isFrozen) return HOTSPOT_CATEGORY_GREEN;
        if (
            impactMultiplier >= HOTSPOT_RED_IMPACT_THRESHOLD ||
            (safeFanIn >= HOTSPOT_RED_FAN_IN_THRESHOLD &&
                churn30dCommits >= HOTSPOT_RED_CHURN_THRESHOLD)
        ) {
            return HOTSPOT_CATEGORY_RED;
        }
        if (
            impactMultiplier >= HOTSPOT_YELLOW_IMPACT_THRESHOLD ||
            churn30dCommits >= HOTSPOT_YELLOW_CHURN_THRESHOLD
        ) {
            return HOTSPOT_CATEGORY_YELLOW;
        }
        return HOTSPOT_CATEGORY_GREEN;
    }
}
