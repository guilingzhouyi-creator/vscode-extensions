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
        this.alphaChurn = options?.alphaChurn ?? 0.5;
        this.muChurn = options?.muChurn ?? 4.0;
        this.maxFanInMultiplier = options?.maxFanInMultiplier ?? 6.0;
        this.frozenThresholdDays = options?.frozenThresholdDays ?? 180;
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

        const thirtyDaysAgo = this.nowTimestamp - 30 * 24 * 3600 * 1000;
        const frozenThresholdAgo =
            this.nowTimestamp - this.frozenThresholdDays * 24 * 3600 * 1000;

        let churn30dCommits = 0;
        for (const commit of history.recentCommits) {
            if (commit.timestamp >= thirtyDaysAgo) {
                churn30dCommits++;
            }
        }

        const isFrozenLegacy =
            history.lastModifiedTimestamp !== null &&
            history.lastModifiedTimestamp < frozenThresholdAgo &&
            safeFanIn <= 2;

        return { churn30dCommits, isFrozenLegacy };
    }

    private calculateChurnMultiplier(churn30dCommits: number, isFrozenLegacy: boolean): number {
        if (isFrozenLegacy) {
            return 0.6; // Inactive dormant baseline relaxation
        }
        if (churn30dCommits > 0) {
            const normalizedChurn = churn30dCommits / this.muChurn;
            return +(1.0 + this.alphaChurn * Math.tanh(normalizedChurn)).toFixed(2);
        }
        return 1.0;
    }

    private calculateCombinedImpact(fanInMultiplier: number, churnMultiplier: number): number {
        const impactMultiplier = +(fanInMultiplier * churnMultiplier).toFixed(2);
        return Math.max(0.5, Math.min(8.0, impactMultiplier));
    }

    private resolveProposal(
        filePath: string,
        safeFanIn: number,
        churn30dCommits: number,
        impactMultiplier: number,
    ): TopologicalChurnResult['actionableProposal'] {
        if (safeFanIn >= 15 && churn30dCommits >= 3) {
            return {
                action: 'high_centrality_refactor_guard',
                rationale:
                    `High-centrality module '${filePath}' has ${safeFanIn} incoming dependencies ` +
                    `and active 30-day churn (${churn30dCommits} commits). Impact amplifier is ${impactMultiplier}x. ` +
                    `Enforce strict interface contracts before refactoring.`,
            };
        }
        if (churn30dCommits >= 6) {
            return {
                action: 'isolate_churn_hotspot',
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

        return {
            filePath,
            fanIn: safeFanIn,
            churn30dCommits: churnAnalysis.churn30dCommits,
            fanInMultiplier,
            churnMultiplier,
            impactMultiplier,
            isFrozenLegacy: churnAnalysis.isFrozenLegacy,
            actionableProposal,
        };
    }
}
