/**
 * Module: Core Engine - Adaptive Expert Bias Router (DeepSeekMoE Auxiliary-Loss-Free Alignment)
 * File Path: src/core/router/adaptive-bias-router.ts
 * Architecture Role: Dynamic load-balancing and yield-aware bias controller for Conditional Expert
 *   Dispatching (CED). Adjusts expert routing scores at runtime via online queue depth and
 *   actionable findings feedback, eliminating hot-spot queue stalls without representation loss.
 * Dependencies & Triggers: Consumes EXPERT_BASE_SCORES from expert-activation-library; consumed by
 *   sparseRuleRouter, sparseMoEGate, and execution schedulers.
 * Responsibilities:
 *   1. Track 32-bit expert dynamic load biases (b_i) and yield rewards (rho_i);
 *   2. Rank candidate analyzer bits using zero-heap packed integer sorting;
 *   3. Calibrate biases dynamically via exponential moving average (EMA);
 *   4. Export and import snapshots for trajectory ledger persistence and warm-session restart.
 * Exit Semantics & Design Rationale: Deterministic, bounded floating-point updates [-5.0, 5.0];
 *   pure in-memory hot path with typed array packing; never throws.
 */

import { EXPERT_BASE_SCORES } from '../experts/expert-activation-library';

/** Total maximum supported MoE experts matching 32-bit integer capacity. */
export const TOTAL_ROUTER_EXPERTS = 32;

/** Baseline fallback expert priority score if unmapped in SSOT. */
export const DEFAULT_ROUTER_EXPERT_PRIORITY = 10;

/** Learning rate (gamma) for dynamic bias updates based on queue depth deviations. */
export const BIAS_LEARNING_RATE_GAMMA = 0.05;

/** Target optimal queue depth per analyzer worker before applying negative backpressure. */
export const TARGET_QUEUE_DEPTH = 2.0;

/** Lower bound clamp for dynamic bias to prevent permanent starvation. */
export const MIN_DYNAMIC_BIAS = -5.0;

/** Upper bound clamp for dynamic bias to prevent runaway promotion. */
export const MAX_DYNAMIC_BIAS = 5.0;

/** Discount factor for yield reward exponential moving average. */
export const YIELD_REWARD_DECAY = 0.9;

/** Weight factor for new actionable findings yield in reward update. */
export const YIELD_REWARD_WEIGHT = 0.1;

/** Multiplier for actionable findings bonus per dispatch. */
export const YIELD_BONUS_MULTIPLIER = 2.0;

/** Runtime telemetry snapshot of an individual analyzer expert for bias calibration. */
export interface ExpertTelemetrySnapshot {
    /** 32-bit single-word bitmask (1 << index). */
    readonly bit: number;
    /** Current pending task queue depth waiting for this analyzer. */
    readonly currentQueueDepth: number;
    /** Rolling average execution latency in microseconds. */
    readonly rollingAvgLatencyUs: number;
    /** Total cumulative dispatches received by this analyzer. */
    readonly totalDispatches: number;
    /** Cumulative actionable defects or rule violations detected by this analyzer. */
    readonly actionableFindingsYield: number;
}

/** Persistent snapshot format for serializing and restoring adaptive bias state. */
export interface BiasStateSnapshot {
    /** Snapshot schema version for backward compatibility. */
    readonly version: number;
    /** Timestamp of snapshot creation in epoch milliseconds. */
    readonly timestamp: number;
    /** Array of 32 dynamic load biases. */
    readonly dynamicBiases: readonly number[];
    /** Array of 32 yield rewards. */
    readonly yieldRewards: readonly number[];
}

/** Scored candidate expert bit and computed composite score. */
export interface ScoredExpertBit {
    /** 32-bit single-word bitmask. */
    readonly bit: number;
    /** Computed composite score (base + bias + yield). */
    readonly score: number;
}

/**
 * AdaptiveExpertBiasRouter implements DeepSeek-V3 style auxiliary-loss-free load balancing.
 *
 * Dynamically balances worker utilization across the 32-expert MoE topology without degrading
 * static rule precision, rewarding high-yield analyzers and throttling overloaded queues.
 */
export class AdaptiveExpertBiasRouter {
    private readonly dynamicBiases = new Float32Array(TOTAL_ROUTER_EXPERTS);
    private readonly yieldRewards = new Float32Array(TOTAL_ROUTER_EXPERTS);

    /**
     * Rank candidate routed bits by composite score (base + dynamic bias + yield reward) descending.
     *
     * @param mask - Unbounded candidate analyzer bitmask.
     * @returns Array of scored expert bits sorted in descending priority order.
     */
    public scoreAndRankCandidateBits(mask: number): ScoredExpertBit[] {
        const scored: ScoredExpertBit[] = [];
        for (let i = 0; i < TOTAL_ROUTER_EXPERTS; i++) {
            const bit = (1 << i) >>> 0;
            if ((mask & bit) !== 0) {
                const baseScore = EXPERT_BASE_SCORES[bit] || DEFAULT_ROUTER_EXPERT_PRIORITY;
                const dynamicScore = baseScore + this.dynamicBiases[i] + this.yieldRewards[i];
                scored.push({ bit, score: dynamicScore });
            }
        }
        scored.sort((firstEntry, secondEntry) => secondEntry.score - firstEntry.score);
        return scored;
    }

    /**
     * Fast zero-heap evaluation returning the highest scoring bit from a candidate mask.
     *
     * @param mask - Candidate analyzer bitmask.
     * @returns Single winning 32-bit bitmask, or 0 if empty.
     */
    public selectSingleTopBit(mask: number): number {
        let bestBit = 0;
        let bestScore = -Infinity;

        for (let i = 0; i < TOTAL_ROUTER_EXPERTS; i++) {
            const bit = (1 << i) >>> 0;
            if ((mask & bit) !== 0) {
                const baseScore = EXPERT_BASE_SCORES[bit] || DEFAULT_ROUTER_EXPERT_PRIORITY;
                const dynamicScore = baseScore + this.dynamicBiases[i] + this.yieldRewards[i];
                if (dynamicScore > bestScore) {
                    bestScore = dynamicScore;
                    bestBit = bit;
                }
            }
        }
        return bestBit;
    }

    /**
     * Calibrate dynamic biases and yield rewards based on runtime telemetry feedback.
     *
     * Follows the DeepSeek-V3 auxiliary-loss-free gradient approximation:
     * - Overloaded queues receive a negative bias penalty proportional to excess depth;
     * - Underutilized queues receive a positive bias recovery;
     * - Yield bonuses reward analyzers that uncover actionable issues.
     *
     * @param telemetry - Array of per-analyzer runtime telemetry records.
     */
    public calibrateBiases(telemetry: readonly ExpertTelemetrySnapshot[]): void {
        for (let i = 0; i < telemetry.length; i++) {
            const snap = telemetry[i];
            const bitIndex = 31 - Math.clz32(snap.bit);
            if (bitIndex < 0 || bitIndex >= TOTAL_ROUTER_EXPERTS) {
                continue;
            }

            // 1. Dynamic load backpressure update: b_i = b_i - gamma * (Q_i - Q_target)
            const queueDelta = snap.currentQueueDepth - TARGET_QUEUE_DEPTH;
            const loadAdjustment = queueDelta * BIAS_LEARNING_RATE_GAMMA;
            const updatedBias = this.dynamicBiases[bitIndex] - loadAdjustment;
            this.dynamicBiases[bitIndex] = Math.max(
                MIN_DYNAMIC_BIAS,
                Math.min(MAX_DYNAMIC_BIAS, updatedBias),
            );

            // 2. Actionable yield reward update: rho_i = 0.9 * rho_i + 0.1 * yieldBonus
            const dispatches = Math.max(1, snap.totalDispatches);
            const yieldRate = snap.actionableFindingsYield / dispatches;
            const yieldBonus = yieldRate * YIELD_BONUS_MULTIPLIER;
            this.yieldRewards[bitIndex] =
                this.yieldRewards[bitIndex] * YIELD_REWARD_DECAY + yieldBonus * YIELD_REWARD_WEIGHT;
        }
    }

    /**
     * Retrieve the current dynamic bias value for a specific expert bit.
     *
     * @param bit - 32-bit single-word bitmask.
     * @returns Current dynamic bias value.
     */
    public getBiasForBit(bit: number): number {
        const bitIndex = 31 - Math.clz32(bit);
        if (bitIndex >= 0 && bitIndex < TOTAL_ROUTER_EXPERTS) {
            return this.dynamicBiases[bitIndex];
        }
        return 0;
    }

    /**
     * Retrieve the current yield reward value for a specific expert bit.
     *
     * @param bit - 32-bit single-word bitmask.
     * @returns Current yield reward value.
     */
    public getYieldRewardForBit(bit: number): number {
        const bitIndex = 31 - Math.clz32(bit);
        if (bitIndex >= 0 && bitIndex < TOTAL_ROUTER_EXPERTS) {
            return this.yieldRewards[bitIndex];
        }
        return 0;
    }

    /**
     * Export current internal bias vectors into an immutable state snapshot for persistence.
     *
     * @returns Serializable snapshot object.
     */
    public exportSnapshot(): BiasStateSnapshot {
        return {
            version: 1,
            timestamp: Date.now(),
            dynamicBiases: Array.from(this.dynamicBiases),
            yieldRewards: Array.from(this.yieldRewards),
        };
    }

    /**
     * Restore internal bias vectors from a previously exported snapshot.
     *
     * @param snapshot - Valid BiasStateSnapshot object.
     */
    public importSnapshot(snapshot: BiasStateSnapshot): void {
        if (!snapshot || !Array.isArray(snapshot.dynamicBiases)) {
            return;
        }
        const biasLimit = Math.min(snapshot.dynamicBiases.length, TOTAL_ROUTER_EXPERTS);
        for (let i = 0; i < biasLimit; i++) {
            const rawBias = snapshot.dynamicBiases[i];
            if (typeof rawBias === 'number' && Number.isFinite(rawBias)) {
                this.dynamicBiases[i] = Math.max(
                    MIN_DYNAMIC_BIAS,
                    Math.min(MAX_DYNAMIC_BIAS, rawBias),
                );
            }
        }
        if (Array.isArray(snapshot.yieldRewards)) {
            const rewardLimit = Math.min(snapshot.yieldRewards.length, TOTAL_ROUTER_EXPERTS);
            for (let i = 0; i < rewardLimit; i++) {
                const rawReward = snapshot.yieldRewards[i];
                if (typeof rawReward === 'number' && Number.isFinite(rawReward)) {
                    this.yieldRewards[i] = Math.max(0, rawReward);
                }
            }
        }
    }

    /**
     * Reset all dynamic biases and yield rewards back to zero baseline.
     */
    public reset(): void {
        this.dynamicBiases.fill(0);
        this.yieldRewards.fill(0);
    }
}

/** Default singleton instance of AdaptiveExpertBiasRouter. */
export const defaultAdaptiveExpertBiasRouter = new AdaptiveExpertBiasRouter();
