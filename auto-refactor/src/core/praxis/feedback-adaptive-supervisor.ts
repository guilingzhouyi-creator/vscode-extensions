/**
 * Module: Praxis Governance — Feedback Adaptive Supervisor
 * File Path: src/core/praxis/feedback-adaptive-supervisor.ts
 * Architecture Role: Closed-loop self-adaptive supervision engine that continuously tunes
 *   tri-plane weights (W_s, W_d, W_f) via gradient descent on outcome errors, tracks incident
 *   and rollback ledgers, penalizes high-reversion rules, and boosts stable architectural patterns:
 *   W_{t+1} = W_t + eta * Error * Gradient.
 * Dependencies & Triggers: Consumes fusion-scorer types; consumed by Praxis pipeline, CLI,
 *   and automated review gates.
 * Responsibilities:
 *   1. Track operational incidents, rollbacks, and stability milestones in an Incident Ledger.
 *   2. Evolve tri-plane scoring weights dynamically based on actual outcome discrepancies.
 *   3. Enforce rule confidence dampening for advice that causes regressions or reverts.
 *   4. Apply stability boosts for proven zero-defect architectural invariant implementations.
 * Exit Semantics & Design Rationale: Bounded convex weight evolution guaranteed to sum to 1.0;
 *   learning rate eta constrained to [0.01, 0.05]; safe serialization/deserialization for CI persistence.
 */

import type { FusionWeights } from '../scoring/fusion-scorer';

/** Classification of feedback incident */
export type FeedbackIncidentType =
    | 'runtime_crash'
    | 'rollback'
    | 'performance_degradation'
    | 'stable_milestone'
    | 'false_positive';

/** Severity of recorded incident */
export type FeedbackIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Plane that was the primary contributor or missed the defect */
export type IncidentAttributionPlane = 'static' | 'dynamic' | 'feedback' | 'unspecified';

/**
 * Record representing a real-world software outcome event.
 */
export interface FeedbackIncidentRecord {
    /** Unique incident identifier */
    id: string;
    /** Timestamp in epoch milliseconds */
    timestamp: number;
    /** Incident category */
    type: FeedbackIncidentType;
    /** Severity level */
    severity: FeedbackIncidentSeverity;
    /** Attributed plane */
    attributionPlane: IncidentAttributionPlane;
    /** Specific rule identifier associated with the incident */
    ruleId?: string;
    /** Architecture pattern identifier associated with the event */
    patternId?: string;
    /** Target module or file path */
    modulePath: string;
    /** Predicted quality score from review system [0.0, 100.0] */
    predictedScore: number;
    /** Actual realized outcome score [0.0, 100.0] */
    actualOutcomeScore: number;
    /** Error delta: actualOutcomeScore - predictedScore */
    error: number;
    /** Human-readable explanation */
    description: string;
}

/**
 * Historical reliability metrics for a specific rule.
 */
export interface RuleReliabilityStats {
    ruleId: string;
    adoptions: number;
    rollbacks: number;
    /** Multiplier applied to rule confidence C_i in [0.2, 1.2] */
    confidenceMultiplier: number;
}

/**
 * Stability metrics for a recognized architectural pattern.
 */
export interface PatternStabilityStats {
    patternId: string;
    milestoneCount: number;
    /** Score boost multiplier in [1.0, 1.25] */
    stabilityBoostFactor: number;
}

/**
 * Single step of weight evolution.
 */
export interface AdaptiveEvolutionStep {
    stepIndex: number;
    timestamp: number;
    previousWeights: FusionWeights;
    updatedWeights: FusionWeights;
    error: number;
    learningRate: number;
    gradient: { Ws: number; Wd: number; Wf: number };
    reason: string;
}

/**
 * Governance summary generated for reporting.
 */
export interface FeedbackGovernanceSummary {
    totalIncidents: number;
    rollbacksCount: number;
    activeRulesTracked: number;
    dampenedRulesCount: number;
    boostedPatternsCount: number;
    currentWeights: FusionWeights;
    evolutionStepsCount: number;
}

/** Default minimum and maximum bounds for tri-plane weights */
const WEIGHT_BOUNDS = {
    Ws: { min: 0.2, max: 0.8 },
    Wd: { min: 0.1, max: 0.7 },
    Wf: { min: 0.05, max: 0.4 },
};

/** Default smooth learning rate eta */
const DEFAULT_LEARNING_RATE = 0.02;

/**
 * Ledger maintaining software governance incident history, rule rollbacks,
 * and architectural stability records.
 */
export class FeedbackIncidentLedger {
    private readonly incidents: FeedbackIncidentRecord[] = [];

    private readonly ruleAdoptions = new Map<string, number>();

    private readonly ruleRollbacks = new Map<string, number>();

    private readonly patternMilestones = new Map<string, number>();

    private nextIdCounter = 1;

    /**
     * Records a new operational incident or outcome event.
     */
    public recordIncident(
        input: Omit<FeedbackIncidentRecord, 'id' | 'timestamp' | 'error'>,
    ): FeedbackIncidentRecord {
        const error = Math.round((input.actualOutcomeScore - input.predictedScore) * 10) / 10;
        const record: FeedbackIncidentRecord = {
            ...input,
            id: `INC-${Date.now()}-${this.nextIdCounter++}`,
            timestamp: Date.now(),
            error,
        };

        this.incidents.push(record);

        if (input.ruleId) {
            if (input.type === 'rollback') {
                const current = this.ruleRollbacks.get(input.ruleId) ?? 0;
                this.ruleRollbacks.set(input.ruleId, current + 1);
            }
        }

        if (input.patternId && input.type === 'stable_milestone') {
            const current = this.patternMilestones.get(input.patternId) ?? 0;
            this.patternMilestones.set(input.patternId, current + 1);
        }

        return record;
    }

    /**
     * Records successful adoption of an automated rule recommendation.
     */
    public recordRuleAdoption(ruleId: string): void {
        const current = this.ruleAdoptions.get(ruleId) ?? 0;
        this.ruleAdoptions.set(ruleId, current + 1);
    }

    /**
     * Records that an automated rule change was rolled back due to defect or developer revert.
     */
    public recordRuleRollback(
        ruleId: string,
        modulePath: string,
        description: string,
        predictedScore = 85.0,
        actualOutcomeScore = 20.0,
    ): FeedbackIncidentRecord {
        return this.recordIncident({
            type: 'rollback',
            severity: 'high',
            attributionPlane: 'static',
            ruleId,
            modulePath,
            predictedScore,
            actualOutcomeScore,
            description,
        });
    }

    /**
     * Records a successful zero-defect release milestone for a module following an architecture pattern.
     */
    public recordStabilityMilestone(
        patternId: string,
        modulePath: string,
        description = 'Module completed production release cycle with zero regressions',
    ): FeedbackIncidentRecord {
        return this.recordIncident({
            type: 'stable_milestone',
            severity: 'low',
            attributionPlane: 'feedback',
            patternId,
            modulePath,
            predictedScore: 90.0,
            actualOutcomeScore: 100.0,
            description,
        });
    }

    /**
     * Computes reliability statistics and confidence multiplier for a given rule:
     * High rollbacks steeply dampen confidence C_i down to 0.2.
     */
    public getRuleReliability(ruleId: string): RuleReliabilityStats {
        const adoptions = this.ruleAdoptions.get(ruleId) ?? 0;
        const rollbacks = this.ruleRollbacks.get(ruleId) ?? 0;

        let multiplier = 1.0;
        if (rollbacks > 0) {
            multiplier -= rollbacks * 0.25;
            multiplier += adoptions * 0.05;
        } else if (adoptions >= 5) {
            multiplier += 0.1;
        }

        const confidenceMultiplier = Math.max(0.2, Math.min(1.2, Math.round(multiplier * 100) / 100));

        return {
            ruleId,
            adoptions,
            rollbacks,
            confidenceMultiplier,
        };
    }

    /**
     * Computes stability boost factor for an architectural pattern:
     * Consecutive clean milestones boost pattern weight up to 1.25.
     */
    public getPatternStability(patternId: string): PatternStabilityStats {
        const milestoneCount = this.patternMilestones.get(patternId) ?? 0;
        const boost = 1.0 + Math.min(0.25, milestoneCount * 0.05);
        const stabilityBoostFactor = Math.round(boost * 100) / 100;

        return {
            patternId,
            milestoneCount,
            stabilityBoostFactor,
        };
    }

    /**
     * Returns all recorded incidents.
     */
    public getAllIncidents(): readonly FeedbackIncidentRecord[] {
        return this.incidents;
    }

    /**
     * Exports ledger state to plain JSON-serializable object.
     */
    public exportState(): {
        incidents: FeedbackIncidentRecord[];
        ruleAdoptions: Record<string, number>;
        ruleRollbacks: Record<string, number>;
        patternMilestones: Record<string, number>;
    } {
        return {
            incidents: [...this.incidents],
            ruleAdoptions: Object.fromEntries(this.ruleAdoptions.entries()),
            ruleRollbacks: Object.fromEntries(this.ruleRollbacks.entries()),
            patternMilestones: Object.fromEntries(this.patternMilestones.entries()),
        };
    }

    /**
     * Imports ledger state from serialized object.
     */
    public importState(data: {
        incidents?: FeedbackIncidentRecord[];
        ruleAdoptions?: Record<string, number>;
        ruleRollbacks?: Record<string, number>;
        patternMilestones?: Record<string, number>;
    }): void {
        if (Array.isArray(data.incidents)) {
            this.incidents.length = 0;
            this.incidents.push(...data.incidents);
        }
        if (data.ruleAdoptions) {
            this.ruleAdoptions.clear();
            for (const [k, v] of Object.entries(data.ruleAdoptions)) {
                this.ruleAdoptions.set(k, v);
            }
        }
        if (data.ruleRollbacks) {
            this.ruleRollbacks.clear();
            for (const [k, v] of Object.entries(data.ruleRollbacks)) {
                this.ruleRollbacks.set(k, v);
            }
        }
        if (data.patternMilestones) {
            this.patternMilestones.clear();
            for (const [k, v] of Object.entries(data.patternMilestones)) {
                this.patternMilestones.set(k, v);
            }
        }
    }
}

/**
 * Closed-loop supervisor driving dynamic tri-plane weight adaptation
 * through gradient descent on verification outcome discrepancies.
 */
export class FeedbackAdaptiveSupervisor {
    private readonly ledger: FeedbackIncidentLedger;

    private currentWeights: FusionWeights;

    private readonly learningRate: number;

    private readonly evolutionHistory: AdaptiveEvolutionStep[] = [];

    constructor(
        ledger: FeedbackIncidentLedger = new FeedbackIncidentLedger(),
        initialWeights: FusionWeights = { Ws: 0.5, Wd: 0.35, Wf: 0.15 },
        learningRate = DEFAULT_LEARNING_RATE,
    ) {
        this.ledger = ledger;
        this.currentWeights = { ...initialWeights };
        this.learningRate = Math.max(0.01, Math.min(0.05, learningRate));
    }

    /**
     * Returns current tri-plane weights.
     */
    public getWeights(): Readonly<FusionWeights> {
        return this.currentWeights;
    }

    /**
     * Returns attached incident ledger.
     */
    public getLedger(): FeedbackIncidentLedger {
        return this.ledger;
    }

    /**
     * Returns full weight evolution trajectory history.
     */
    public getEvolutionHistory(): readonly AdaptiveEvolutionStep[] {
        return this.evolutionHistory;
    }

    /**
     * Adjusts a rule's base confidence using historical rollback tracking.
     * High rollbacks discount confidence; stable adoptions preserve or slightly boost confidence.
     */
    public adjustRuleConfidence(ruleId: string, baseConfidence = 1.0): number {
        const stats = this.ledger.getRuleReliability(ruleId);
        const adjusted = baseConfidence * stats.confidenceMultiplier;
        return Math.max(0.1, Math.min(1.0, Math.round(adjusted * 100) / 100));
    }

    /**
     * Applies architectural pattern stability boost factor to a base score.
     */
    public applyArchitectureBoost(patternId: string, baseScore: number): number {
        const stats = this.ledger.getPatternStability(patternId);
        const boosted = baseScore * stats.stabilityBoostFactor;
        return Math.max(0.0, Math.min(100.0, Math.round(boosted * 10) / 10));
    }

    /**
     * Evolves tri-plane weights based on discrepancy between predicted score and actual outcome:
     * W_{t+1} = W_t + eta * Error * Gradient.
     */
    public evolveFromOutcome(params: {
        predictedScore: number;
        actualOutcomeScore: number;
        attributionPlane?: IncidentAttributionPlane;
        customGradient?: { Ws: number; Wd: number; Wf: number };
        reason?: string;
    }): AdaptiveEvolutionStep {
        const error = params.actualOutcomeScore - params.predictedScore;
        const plane = params.attributionPlane ?? 'unspecified';

        // Derive feature gradient vector based on attributed plane
        let gradient: { Ws: number; Wd: number; Wf: number };

        if (params.customGradient) {
            gradient = params.customGradient;
        } else {
            // When error < 0 (over-optimistic prediction):
            // - If runtime failure occurred (dynamic), dynamic plane was underweighted -> gradient pulls Wd up, Ws down.
            // - If structural/architecture regression occurred (static), static plane was underweighted -> gradient pulls Ws up, Wd down.
            // - If historical pattern was ignored (feedback), feedback plane was underweighted -> gradient pulls Wf up.
            switch (plane) {
                case 'dynamic':
                    gradient = { Ws: 0.005, Wd: -0.008, Wf: 0.003 };
                    break;
                case 'static':
                    gradient = { Ws: -0.008, Wd: 0.005, Wf: 0.003 };
                    break;
                case 'feedback':
                    gradient = { Ws: 0.004, Wd: 0.004, Wf: -0.008 };
                    break;
                default:
                    // Symmetrical balance
                    gradient = { Ws: -0.004, Wd: -0.004, Wf: 0.008 };
                    break;
            }
        }

        const prev = { ...this.currentWeights };

        // Delta = eta * Error * Gradient
        // Note: When error < 0 (predicted was too high) and gradient is negative for the underweighted plane,
        // delta = eta * (-|error|) * (-|grad|) > 0, which correctly increases that plane's weight.
        let rawWs = prev.Ws + this.learningRate * error * gradient.Ws;
        let rawWd = prev.Wd + this.learningRate * error * gradient.Wd;
        let rawWf = prev.Wf + this.learningRate * error * gradient.Wf;

        // Clamp to allowed intervals
        rawWs = Math.max(WEIGHT_BOUNDS.Ws.min, Math.min(WEIGHT_BOUNDS.Ws.max, rawWs));
        rawWd = Math.max(WEIGHT_BOUNDS.Wd.min, Math.min(WEIGHT_BOUNDS.Wd.max, rawWd));
        rawWf = Math.max(WEIGHT_BOUNDS.Wf.min, Math.min(WEIGHT_BOUNDS.Wf.max, rawWf));

        // L1 Normalization: sum must equal 1.0
        const sum = rawWs + rawWd + rawWf;
        const updatedWeights: FusionWeights = {
            Ws: Math.round((rawWs / sum) * 1000) / 1000,
            Wd: Math.round((rawWd / sum) * 1000) / 1000,
            Wf: Math.round((rawWf / sum) * 1000) / 1000,
        };

        // Fix any residual roundoff to ensure exact 1.000 sum
        const roundSum = updatedWeights.Ws + updatedWeights.Wd + updatedWeights.Wf;
        if (roundSum !== 1.0) {
            updatedWeights.Ws = Math.round((1.0 - updatedWeights.Wd - updatedWeights.Wf) * 1000) / 1000;
        }

        this.currentWeights = updatedWeights;

        const reason =
            params.reason ??
            `Adaptive weight shift on Error=${error.toFixed(1)} attributed to ${plane} plane ` +
            `[Ws: ${prev.Ws} -> ${updatedWeights.Ws}, Wd: ${prev.Wd} -> ${updatedWeights.Wd}, Wf: ${prev.Wf} -> ${updatedWeights.Wf}]`;

        const step: AdaptiveEvolutionStep = {
            stepIndex: this.evolutionHistory.length + 1,
            timestamp: Date.now(),
            previousWeights: prev,
            updatedWeights,
            error,
            learningRate: this.learningRate,
            gradient,
            reason,
        };

        this.evolutionHistory.push(step);
        return step;
    }

    /**
     * Convenience method to evolve weights directly from a recorded incident.
     */
    public evolveFromIncident(incident: FeedbackIncidentRecord): AdaptiveEvolutionStep {
        return this.evolveFromOutcome({
            predictedScore: incident.predictedScore,
            actualOutcomeScore: incident.actualOutcomeScore,
            attributionPlane: incident.attributionPlane,
            reason: `Incident ${incident.id} (${incident.type}, ${incident.severity}): ${incident.description}`,
        });
    }

    /**
     * Generates a governance summary of all incidents, adaptive adjustments, and rule tracking.
     */
    public generateGovernanceSummary(): FeedbackGovernanceSummary {
        const incidents = this.ledger.getAllIncidents();
        const rollbacks = incidents.filter((i) => i.type === 'rollback');

        const rulesSet = new Set<string>();
        let dampenedCount = 0;
        for (const inc of incidents) {
            if (inc.ruleId) {
                rulesSet.add(inc.ruleId);
                const rel = this.ledger.getRuleReliability(inc.ruleId);
                if (rel.confidenceMultiplier < 1.0) {
                    dampenedCount++;
                }
            }
        }

        const patternsSet = new Set<string>();
        let boostedCount = 0;
        for (const inc of incidents) {
            if (inc.patternId) {
                patternsSet.add(inc.patternId);
                const boost = this.ledger.getPatternStability(inc.patternId);
                if (boost.stabilityBoostFactor > 1.0) {
                    boostedCount++;
                }
            }
        }

        return {
            totalIncidents: incidents.length,
            rollbacksCount: rollbacks.length,
            activeRulesTracked: rulesSet.size,
            dampenedRulesCount: dampenedCount,
            boostedPatternsCount: boostedCount,
            currentWeights: { ...this.currentWeights },
            evolutionStepsCount: this.evolutionHistory.length,
        };
    }
}

/** Default global instance of supervisor */
export const defaultFeedbackAdaptiveSupervisor = new FeedbackAdaptiveSupervisor();
