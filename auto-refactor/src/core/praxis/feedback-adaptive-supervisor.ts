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
 *   learning rate eta constrained to [0.01, 0.05]; safe serialization/deserialization for CI.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FusionWeights } from '../scoring/fusion-scorer';

/** File encoding standard */
const ENCODING_UTF8 = 'utf-8';

/** Default profile for governance snapshot */
const DEFAULT_PROJECT_PROFILE = 'standard';

/** Schema version for governance ledger snapshots */
const GOVERNANCE_SNAPSHOT_VERSION = '1.0';

/** Prefix for unique incident identifier keys */
const INCIDENT_ID_PREFIX = 'INC-';

/** Default description for stability milestone achievement */
const DEFAULT_MILESTONE_DESC = 'Module completed production release cycle with zero regressions';

/** Feedback incident type classifications */
const INCIDENT_TYPE_ROLLBACK: FeedbackIncidentType = 'rollback';
const INCIDENT_TYPE_STABLE_MILESTONE: FeedbackIncidentType = 'stable_milestone';

/** Feedback incident severity classifications */
const SEVERITY_LOW: FeedbackIncidentSeverity = 'low';
const SEVERITY_HIGH: FeedbackIncidentSeverity = 'high';

/** Incident attribution plane literals */
const PLANE_STATIC: IncidentAttributionPlane = 'static';
const PLANE_DYNAMIC: IncidentAttributionPlane = 'dynamic';
const PLANE_FEEDBACK: IncidentAttributionPlane = 'feedback';
const PLANE_UNSPECIFIED: IncidentAttributionPlane = 'unspecified';

/** Scaling factor for two-decimal rounding operations */
const ROUND_PERCENT_FACTOR = 100;

/** Precision multiplier for three-decimal weight normalization */
const WEIGHT_ROUND_FACTOR = 1000;

/** Default predicted quality score for rollbacks */
const DEFAULT_ROLLBACK_SCORE = 85.0;

/** Realized defect score for rollbacks */
const DEFAULT_ROLLBACK_ACTUAL_SCORE = 20.0;

/** Baseline predicted quality score for milestone verification */
const DEFAULT_MILESTONE_SCORE = 90.0;

/** Realized quality score for zero-regression milestones */
const DEFAULT_MILESTONE_ACTUAL_SCORE = 100.0;

/** Maximum quality score boundary */
const MAX_QUALITY_SCORE = 100.0;

/** Minimum quality score boundary */
const MIN_QUALITY_SCORE = 0.0;

/** Adoption threshold qualifying a rule for reliability boost */
const PROVEN_ADOPTION_THRESHOLD = 5;

/** Penalization decrement per recorded rollback */
const ROLLBACK_PENALTY_STEP = 0.25;

/** Adoption reward increment per successful adoption */
const ADOPTION_BONUS_STEP = 0.05;

/** Reliability multiplier boost for proven adoption record */
const PROVEN_RULE_BONUS = 0.1;

/** Absolute minimum floor for rule confidence multiplier */
const MIN_RULE_CONFIDENCE = 0.2;

/** Absolute maximum ceiling for rule confidence multiplier */
const MAX_RULE_CONFIDENCE = 1.2;

/** Absolute minimum floor for supervisor rule confidence adjustment */
const CONFIDENCE_FLOOR = 0.1;

/** Absolute maximum ceiling for supervisor rule confidence adjustment */
const CONFIDENCE_CEILING = 1.0;

/** Maximum stability boost multiplier increment for patterns */
const MAX_PATTERN_BOOST = 0.25;

/** Stability boost increment per recorded milestone */
const PATTERN_MILESTONE_STEP = 0.05;

/** Default smooth learning rate eta */
const DEFAULT_LEARNING_RATE = 0.02;

/** Minimum permitted learning rate eta */
const MIN_LEARNING_RATE = 0.01;

/** Maximum permitted learning rate eta */
const MAX_LEARNING_RATE = 0.05;

/** Formatting indentation spaces for JSON snapshot persistence */
const JSON_INDENT_SPACES = 2;

const PROP_WS = 'Ws';
const PROP_WD = 'Wd';
const PROP_WF = 'Wf';

/**
 * Persistent snapshot schema for governance ledger and learned tri-plane weights.
 */
export interface GovernanceLedgerSnapshot {
    version: string;
    lastUpdated: string;
    projectProfile: string;
    learnedWeights: FusionWeights;
    activeIncidents: number;
    demotedRules: string[];
    boostedPatterns: string[];
    evolutionStepsCount: number;
}

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
 * Tri-plane gradient vector representation avoiding capitalized member identifiers.
 */
export type TriPlaneGradient = FusionWeights;

/**
 * Context object for recording rule rollback occurrences.
 */
export interface RuleRollbackContext {
    ruleId: string;
    modulePath: string;
    description: string;
    predictedScore?: number;
    actualOutcomeScore?: number;
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
    gradient: TriPlaneGradient;
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
    [PROP_WS]: { min: 0.2, max: 0.8 },
    [PROP_WD]: { min: 0.1, max: 0.7 },
    [PROP_WF]: { min: 0.05, max: 0.4 },
};

/** Default initial weights for tri-plane supervisor */
const DEFAULT_INITIAL_WEIGHTS: FusionWeights = {
    [PROP_WS]: 0.5,
    [PROP_WD]: 0.35,
    [PROP_WF]: 0.15,
};

/**
 * Derives the feature gradient vector according to attributed plane discrepancy.
 *
 * @param plane - Attributed defect plane.
 * @returns Three-dimensional gradient vector.
 */
function deriveOutcomeGradient(plane: IncidentAttributionPlane): TriPlaneGradient {
    switch (plane) {
        case PLANE_DYNAMIC:
            return { [PROP_WS]: 0.005, [PROP_WD]: -0.008, [PROP_WF]: 0.003 };
        case PLANE_STATIC:
            return { [PROP_WS]: -0.008, [PROP_WD]: 0.005, [PROP_WF]: 0.003 };
        case PLANE_FEEDBACK:
            return { [PROP_WS]: 0.004, [PROP_WD]: 0.004, [PROP_WF]: -0.008 };
        default:
            return { [PROP_WS]: -0.004, [PROP_WD]: -0.004, [PROP_WF]: 0.008 };
    }
}

/**
 * Computes updated and normalized weights using gradient descent and bounding constraints.
 *
 * @param prev - Previous weights vector.
 * @param error - Outcome discrepancy error.
 * @param learningRate - Adaptive learning rate eta.
 * @param gradient - Directional gradient vector.
 * @returns Normalized convex fusion weights.
 */
function computeNormalizedWeights(
    prev: FusionWeights,
    error: number,
    learningRate: number,
    gradient: TriPlaneGradient,
): FusionWeights {
    let rawStatic = prev.Ws + learningRate * error * gradient.Ws;
    let rawDynamic = prev.Wd + learningRate * error * gradient.Wd;
    let rawFeedback = prev.Wf + learningRate * error * gradient.Wf;

    const bounds = WEIGHT_BOUNDS;
    rawStatic = Math.max(bounds.Ws.min, Math.min(bounds.Ws.max, rawStatic));
    rawDynamic = Math.max(bounds.Wd.min, Math.min(bounds.Wd.max, rawDynamic));
    rawFeedback = Math.max(bounds.Wf.min, Math.min(bounds.Wf.max, rawFeedback));

    const totalWeightSum = rawStatic + rawDynamic + rawFeedback;
    const weightStatic =
        Math.round((rawStatic / totalWeightSum) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    const weightDynamic =
        Math.round((rawDynamic / totalWeightSum) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    const weightFeedback =
        Math.round((rawFeedback / totalWeightSum) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;

    const updatedWeights: FusionWeights = {
        [PROP_WS]: weightStatic,
        [PROP_WD]: weightDynamic,
        [PROP_WF]: weightFeedback,
    };

    const roundSum = updatedWeights.Ws + updatedWeights.Wd + updatedWeights.Wf;
    if (roundSum !== 1.0) {
        const remainder = 1.0 - updatedWeights.Wd - updatedWeights.Wf;
        updatedWeights.Ws = Math.round(remainder * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    }

    return updatedWeights;
}

/**
 * Formats diagnostic reason string for weight evolution steps.
 *
 * @param error - Discrepancy error value.
 * @param plane - Attribution plane.
 * @param prev - Previous weights.
 * @param updated - Newly calculated weights.
 * @returns Human-readable explanation.
 */
function formatEvolutionReason(
    error: number,
    plane: IncidentAttributionPlane,
    prev: FusionWeights,
    updated: FusionWeights,
): string {
    return (
        `Adaptive weight shift on Error=${error.toFixed(1)} attributed to ${plane} plane ` +
        `[Ws: ${prev.Ws} -> ${updated.Ws}, Wd: ${prev.Wd} -> ${updated.Wd}, Wf: ${prev.Wf} -> ${updated.Wf}]`
    );
}

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
        const error =
            Math.round((input.actualOutcomeScore - input.predictedScore) * ROUND_PERCENT_FACTOR) /
            ROUND_PERCENT_FACTOR;
        const record: FeedbackIncidentRecord = {
            ...input,
            id: `${INCIDENT_ID_PREFIX}${Date.now()}-${this.nextIdCounter++}`,
            timestamp: Date.now(),
            error,
        };

        this.incidents.push(record);

        if (input.ruleId) {
            if (input.type === INCIDENT_TYPE_ROLLBACK) {
                const current = this.ruleRollbacks.get(input.ruleId) ?? 0;
                this.ruleRollbacks.set(input.ruleId, current + 1);
            }
        }

        if (input.patternId && input.type === INCIDENT_TYPE_STABLE_MILESTONE) {
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
        contextOrRuleId: RuleRollbackContext | string,
        modulePath = '',
        description = '',
        ...scores: [number?, number?]
    ): FeedbackIncidentRecord {
        if (typeof contextOrRuleId === 'object' && contextOrRuleId !== null) {
            return this.recordIncident({
                type: INCIDENT_TYPE_ROLLBACK,
                severity: SEVERITY_HIGH,
                attributionPlane: PLANE_STATIC,
                ruleId: contextOrRuleId.ruleId,
                modulePath: contextOrRuleId.modulePath,
                predictedScore: contextOrRuleId.predictedScore ?? DEFAULT_ROLLBACK_SCORE,
                actualOutcomeScore:
                    contextOrRuleId.actualOutcomeScore ?? DEFAULT_ROLLBACK_ACTUAL_SCORE,
                description: contextOrRuleId.description,
            });
        }

        const [
            predictedScore = DEFAULT_ROLLBACK_SCORE,
            actualOutcomeScore = DEFAULT_ROLLBACK_ACTUAL_SCORE,
        ] = scores;

        return this.recordIncident({
            type: INCIDENT_TYPE_ROLLBACK,
            severity: SEVERITY_HIGH,
            attributionPlane: PLANE_STATIC,
            ruleId: contextOrRuleId,
            modulePath,
            predictedScore,
            actualOutcomeScore,
            description,
        });
    }

    /**
     * Records a zero-defect release milestone for a module following an architecture pattern.
     */
    public recordStabilityMilestone(
        patternId: string,
        modulePath: string,
        description = DEFAULT_MILESTONE_DESC,
    ): FeedbackIncidentRecord {
        return this.recordIncident({
            type: INCIDENT_TYPE_STABLE_MILESTONE,
            severity: SEVERITY_LOW,
            attributionPlane: PLANE_FEEDBACK,
            patternId,
            modulePath,
            predictedScore: DEFAULT_MILESTONE_SCORE,
            actualOutcomeScore: DEFAULT_MILESTONE_ACTUAL_SCORE,
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
            multiplier -= rollbacks * ROLLBACK_PENALTY_STEP;
            multiplier += adoptions * ADOPTION_BONUS_STEP;
        } else if (adoptions >= PROVEN_ADOPTION_THRESHOLD) {
            multiplier += PROVEN_RULE_BONUS;
        }

        const confidenceMultiplier = Math.max(
            MIN_RULE_CONFIDENCE,
            Math.min(
                MAX_RULE_CONFIDENCE,
                Math.round(multiplier * ROUND_PERCENT_FACTOR) / ROUND_PERCENT_FACTOR,
            ),
        );

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
        const boost = 1.0 + Math.min(MAX_PATTERN_BOOST, milestoneCount * PATTERN_MILESTONE_STEP);
        const stabilityBoostFactor =
            Math.round(boost * ROUND_PERCENT_FACTOR) / ROUND_PERCENT_FACTOR;

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
    public getExportedState(): {
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
     * Backward-compatible delegation for ledger state export.
     */
    public exportState = (): {
        incidents: FeedbackIncidentRecord[];
        ruleAdoptions: Record<string, number>;
        ruleRollbacks: Record<string, number>;
        patternMilestones: Record<string, number>;
    } => {
        return this.getExportedState();
    };

    /**
     * Imports ledger state from serialized object.
     */
    public applyImportedState(snapshotPayload: {
        incidents?: FeedbackIncidentRecord[];
        ruleAdoptions?: Record<string, number>;
        ruleRollbacks?: Record<string, number>;
        patternMilestones?: Record<string, number>;
    }): void {
        if (Array.isArray(snapshotPayload.incidents)) {
            this.incidents.length = 0;
            this.incidents.push(...snapshotPayload.incidents);
        }
        if (snapshotPayload.ruleAdoptions) {
            this.ruleAdoptions.clear();
            for (const [ruleId, count] of Object.entries(snapshotPayload.ruleAdoptions)) {
                this.ruleAdoptions.set(ruleId, count);
            }
        }
        if (snapshotPayload.ruleRollbacks) {
            this.ruleRollbacks.clear();
            for (const [ruleId, count] of Object.entries(snapshotPayload.ruleRollbacks)) {
                this.ruleRollbacks.set(ruleId, count);
            }
        }
        if (snapshotPayload.patternMilestones) {
            this.patternMilestones.clear();
            for (const [patternId, count] of Object.entries(snapshotPayload.patternMilestones)) {
                this.patternMilestones.set(patternId, count);
            }
        }
    }

    /**
     * Backward-compatible delegation for ledger state import.
     */
    public importState = (snapshotPayload: {
        incidents?: FeedbackIncidentRecord[];
        ruleAdoptions?: Record<string, number>;
        ruleRollbacks?: Record<string, number>;
        patternMilestones?: Record<string, number>;
    }): void => {
        this.applyImportedState(snapshotPayload);
    };
}

const syncFsWriteText = fs.writeFileSync.bind(fs);
const syncFsReadText = fs.readFileSync.bind(fs);
const WEIGHT_SUM_MIN = 0.99;
const WEIGHT_SUM_MAX = 1.01;
let stagingTempSequence = 0;

/** Generate a process- and call-unique staging temp path in the target directory. */
function buildUniqueStagingPath(destinationPath: string): string {
    stagingTempSequence += 1;
    return `${destinationPath}.${process.pid}.${stagingTempSequence}.tmp`;
}

/** Validate and convex-normalize tri-plane fusion weights to sum cleanly to 1.000. */
function normalizeSupervisorWeights(weights: Partial<FusionWeights>): FusionWeights | null {
    const { Ws, Wd, Wf } = weights;
    if (
        typeof Ws !== 'number' ||
        typeof Wd !== 'number' ||
        typeof Wf !== 'number' ||
        !Number.isFinite(Ws) ||
        !Number.isFinite(Wd) ||
        !Number.isFinite(Wf) ||
        Ws < 0 ||
        Wd < 0 ||
        Wf < 0
    ) {
        return null;
    }
    const sum = Ws + Wd + Wf;
    if (sum <= 0) return null;
    if (sum >= WEIGHT_SUM_MIN && sum <= WEIGHT_SUM_MAX) {
        return { [PROP_WS]: Ws, [PROP_WD]: Wd, [PROP_WF]: Wf };
    }
    const normWd = Math.round((Wd / sum) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    const normWf = Math.round((Wf / sum) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    const normWs = Math.round((1.0 - normWd - normWf) * WEIGHT_ROUND_FACTOR) / WEIGHT_ROUND_FACTOR;
    return { [PROP_WS]: normWs, [PROP_WD]: normWd, [PROP_WF]: normWf };
}

/**
 * Isolated I/O barrier for synchronous ledger snapshot operations.
 * Isolates low-level synchronous filesystem operations and eliminates
 * redundant existsSync checks (PRF-IO-001).
 */
export const PraxisIoBarrier = {
    /**
     * Synchronously write content to destination path ensuring directory creation.
     *
     * Non-atomic on purpose: callers that persist a load-bearing ledger must use
     * `writeAtomicSync` instead, because a process death mid-write leaves a truncated file
     * that the loader would then discard as corrupt.
     *
     * @param destinationPath - Target file path.
     * @param payload - UTF-8 string payload.
     */
    writeSync(destinationPath: string, payload: string): void {
        const parentDirectory = path.dirname(destinationPath);
        fs.mkdirSync(parentDirectory, { recursive: true });
        syncFsWriteText(destinationPath, payload, ENCODING_UTF8);
    },

    /**
     * Synchronously write content through a sibling temp file and rename it into place.
     *
     * `rename` is atomic within one filesystem, so a reader either sees the previous complete
     * payload or the new complete payload, never a half-written one. The temp file is created
     * beside the destination rather than in the system temp directory, because a cross-device
     * rename degrades to copy-then-delete and loses the atomicity this method exists to buy.
     *
     * @param destinationPath - Target file path.
     * @param payload - UTF-8 string payload.
     */
    writeAtomicSync(destinationPath: string, payload: string): void {
        const parentDirectory = path.dirname(destinationPath);
        fs.mkdirSync(parentDirectory, { recursive: true });
        const stagingPath = buildUniqueStagingPath(destinationPath);
        syncFsWriteText(stagingPath, payload, ENCODING_UTF8);
        fs.renameSync(stagingPath, destinationPath);
    },

    /**
     * Synchronously read content from source path without redundant stat/existsSync call.
     *
     * @param sourcePath - Source file path.
     * @returns File content string.
     */
    readSync(sourcePath: string): string {
        return syncFsReadText(sourcePath, ENCODING_UTF8);
    },
};

/**
 * Reports why a governance snapshot could not be read or written.
 *
 * The supervisor is deliberately fail-soft: a missing or corrupt snapshot degrades to the
 * default weights rather than aborting a scan. That containment used to be silent, which made
 * a truncated file indistinguishable from "never created" — the learned weights reset and
 * nothing in the logs said so. Diagnostics go to stderr so they survive piping.
 *
 * @param filePath - Snapshot path involved in the failed operation.
 * @param operation - Which side failed ('load' or 'save').
 * @param cause - Underlying error or a description of the rejected payload.
 */
function reportSnapshotLoadFailure(filePath: string, operation: string, cause: unknown): void {
    // A missing snapshot is the normal first-run state, not a failure: reporting it on every
    // scan would bury the one case that matters (a file that exists and cannot be read).
    if (cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT') return;
    const detail = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`[governance-snapshot] ${operation} failed for ${filePath}: ${detail}\n`);
}

/**
 * Validates a parsed governance snapshot before it is allowed to overwrite live weights.
 *
 * A schema mismatch is treated exactly like a corrupt file: the payload is rejected rather
 * than partially applied, because applying an unknown-version snapshot would silently import
 * weights whose meaning the running build cannot vouch for.
 *
 * @param candidate - Parsed JSON value.
 * @returns The snapshot when it conforms to the current version, otherwise null.
 */
function hasValidSnapshotMetadata(candidate: Partial<GovernanceLedgerSnapshot>): boolean {
    if (candidate.version !== GOVERNANCE_SNAPSHOT_VERSION) return false;
    if (typeof candidate.lastUpdated !== 'string' || typeof candidate.projectProfile !== 'string') {
        return false;
    }
    if (!Array.isArray(candidate.demotedRules) || !Array.isArray(candidate.boostedPatterns)) {
        return false;
    }
    return (
        typeof candidate.activeIncidents === 'number' &&
        typeof candidate.evolutionStepsCount === 'number'
    );
}

function acceptGovernanceSnapshot(candidate: unknown): GovernanceLedgerSnapshot | null {
    if (typeof candidate !== 'object' || candidate === null) return null;
    const snapshot = candidate as Partial<GovernanceLedgerSnapshot>;
    if (!hasValidSnapshotMetadata(snapshot)) return null;
    const weights = snapshot.learnedWeights;
    if (typeof weights !== 'object' || weights === null) return null;
    const normalized = normalizeSupervisorWeights(weights as Partial<FusionWeights>);
    return normalized ? ({ ...snapshot, learnedWeights: normalized } as GovernanceLedgerSnapshot) : null;
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

    private readonly snapshotMemoryCache = new Map<string, GovernanceLedgerSnapshot>();

    constructor(
        ledger: FeedbackIncidentLedger = new FeedbackIncidentLedger(),
        initialWeights: FusionWeights = DEFAULT_INITIAL_WEIGHTS,
        learningRate = DEFAULT_LEARNING_RATE,
    ) {
        this.ledger = ledger;
        this.currentWeights = { ...initialWeights };
        this.learningRate = Math.max(MIN_LEARNING_RATE, Math.min(MAX_LEARNING_RATE, learningRate));
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
     * Updates a rule's base confidence using historical rollback tracking.
     * High rollbacks discount confidence; stable adoptions preserve or slightly boost confidence.
     */
    public updateRuleConfidence(ruleId: string, baseConfidence = 1.0): number {
        const stats = this.ledger.getRuleReliability(ruleId);
        const adjusted = baseConfidence * stats.confidenceMultiplier;
        return Math.max(
            CONFIDENCE_FLOOR,
            Math.min(
                CONFIDENCE_CEILING,
                Math.round(adjusted * ROUND_PERCENT_FACTOR) / ROUND_PERCENT_FACTOR,
            ),
        );
    }

    /**
     * Backward-compatible delegation for confidence adjustment.
     */
    public adjustRuleConfidence = (ruleId: string, baseConfidence = 1.0): number => {
        return this.updateRuleConfidence(ruleId, baseConfidence);
    };

    /**
     * Applies architectural pattern stability boost factor to a base score.
     */
    public applyArchitectureBoost(patternId: string, baseScore: number): number {
        const stats = this.ledger.getPatternStability(patternId);
        const boosted = baseScore * stats.stabilityBoostFactor;
        return Math.max(
            MIN_QUALITY_SCORE,
            Math.min(
                MAX_QUALITY_SCORE,
                Math.round(boosted * ROUND_PERCENT_FACTOR) / ROUND_PERCENT_FACTOR,
            ),
        );
    }

    /**
     * Evolves tri-plane weights based on discrepancy between predicted score and actual outcome:
     * W_{t+1} = W_t + eta * Error * Gradient.
     */
    public runOutcomeEvolution(params: {
        predictedScore: number;
        actualOutcomeScore: number;
        attributionPlane?: IncidentAttributionPlane;
        customGradient?: TriPlaneGradient;
        reason?: string;
    }): AdaptiveEvolutionStep {
        const error = params.actualOutcomeScore - params.predictedScore;
        const plane = params.attributionPlane ?? PLANE_UNSPECIFIED;
        const gradient = params.customGradient ?? deriveOutcomeGradient(plane);
        const prev = { ...this.currentWeights };
        const updatedWeights = computeNormalizedWeights(prev, error, this.learningRate, gradient);

        this.currentWeights = updatedWeights;
        const reason = params.reason ?? formatEvolutionReason(error, plane, prev, updatedWeights);

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
     * Backward-compatible delegation for outcome evolution.
     */
    public evolveFromOutcome = (
        params: Parameters<FeedbackAdaptiveSupervisor['runOutcomeEvolution']>[0],
    ): AdaptiveEvolutionStep => {
        return this.runOutcomeEvolution(params);
    };

    /**
     * Convenience method to evolve weights directly from a recorded incident.
     */
    public runIncidentEvolution(incident: FeedbackIncidentRecord): AdaptiveEvolutionStep {
        return this.runOutcomeEvolution({
            predictedScore: incident.predictedScore,
            actualOutcomeScore: incident.actualOutcomeScore,
            attributionPlane: incident.attributionPlane,
            reason: `Incident ${incident.id} (${incident.type}, ${incident.severity}): ${incident.description}`,
        });
    }

    /**
     * Backward-compatible delegation for incident evolution.
     */
    public evolveFromIncident = (incident: FeedbackIncidentRecord): AdaptiveEvolutionStep => {
        return this.runIncidentEvolution(incident);
    };

    /**
     * Generates a governance summary of all incidents, adaptive adjustments, and rule tracking.
     */
    public generateGovernanceSummary(): FeedbackGovernanceSummary {
        const incidents = this.ledger.getAllIncidents();
        const rollbacks = incidents.filter((incident) => incident.type === INCIDENT_TYPE_ROLLBACK);

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

    /**
     * Exports a portable governance snapshot of the supervisor's learned weights and state.
     *
     * @param projectProfile - Project profile identifier (default: 'standard').
     * @returns Portable GovernanceLedgerSnapshot.
     */
    public getExportedLedgerSnapshot(
        projectProfile = DEFAULT_PROJECT_PROFILE,
    ): GovernanceLedgerSnapshot {
        const summary = this.generateGovernanceSummary();
        const incidents = this.ledger.getAllIncidents();

        const demotedRulesSet = new Set<string>();
        for (const inc of incidents) {
            if (inc.ruleId && !demotedRulesSet.has(inc.ruleId)) {
                if (this.ledger.getRuleReliability(inc.ruleId).confidenceMultiplier < 1.0) {
                    demotedRulesSet.add(inc.ruleId);
                }
            }
        }
        const demotedRules = Array.from(demotedRulesSet);

        const boostedPatternsSet = new Set<string>();
        for (const inc of incidents) {
            if (inc.patternId && !boostedPatternsSet.has(inc.patternId)) {
                if (this.ledger.getPatternStability(inc.patternId).stabilityBoostFactor > 1.0) {
                    boostedPatternsSet.add(inc.patternId);
                }
            }
        }
        const boostedPatterns = Array.from(boostedPatternsSet);

        return {
            version: GOVERNANCE_SNAPSHOT_VERSION,
            lastUpdated: new Date().toISOString(),
            projectProfile,
            learnedWeights: { ...this.currentWeights },
            activeIncidents: summary.totalIncidents,
            demotedRules,
            boostedPatterns,
            evolutionStepsCount: this.evolutionHistory.length,
        };
    }

    /**
     * Backward-compatible delegation for snapshot export.
     */
    public exportLedgerSnapshot = (
        projectProfile = DEFAULT_PROJECT_PROFILE,
    ): GovernanceLedgerSnapshot => {
        return this.getExportedLedgerSnapshot(projectProfile);
    };

    /**
     * Imports a governance snapshot to restore learned weights and evolutionary state.
     *
     * @param snapshot - GovernanceLedgerSnapshot to load.
     */
    public applyImportedLedgerSnapshot(snapshot: GovernanceLedgerSnapshot): void {
        if (snapshot.learnedWeights) {
            const normalized = normalizeSupervisorWeights(snapshot.learnedWeights);
            if (normalized) {
                this.currentWeights = normalized;
            }
        }
    }

    /**
     * Backward-compatible delegation for snapshot import.
     */
    public importLedgerSnapshot = (snapshot: GovernanceLedgerSnapshot): void => {
        this.applyImportedLedgerSnapshot(snapshot);
    };

    /**
     * Serializes and writes the governance snapshot to a JSON file.
     * Updates in-memory snapshot cache and persists to disk synchronously.
     *
     * @param filePath - Destination JSON file path.
     * @param projectProfile - Project profile identifier.
     */
    public saveLedgerSnapshot(filePath: string, projectProfile = DEFAULT_PROJECT_PROFILE): void {
        const snapshot = this.getExportedLedgerSnapshot(projectProfile);
        const diskPath = path.resolve(filePath);
        this.snapshotMemoryCache.set(diskPath, snapshot);
        try {
            PraxisIoBarrier.writeAtomicSync(
                filePath,
                JSON.stringify(snapshot, null, JSON_INDENT_SPACES) + '\n',
            );
        } catch (err) {
            // Best-effort disk persistence: memory snapshot remains valid when disk write fails.
            reportSnapshotLoadFailure(filePath, 'save', err);
        }
    }

    public loadLedgerSnapshot(filePath: string): boolean {
        const diskPath = path.resolve(filePath);
        const cachedSnapshot = this.snapshotMemoryCache.get(diskPath);
        if (cachedSnapshot) {
            this.applyImportedLedgerSnapshot(cachedSnapshot);
            return true;
        }
        try {
            const rawContent = PraxisIoBarrier.readSync(filePath);
            const parsedSnapshot = acceptGovernanceSnapshot(JSON.parse(rawContent));
            if (parsedSnapshot === null) {
                reportSnapshotLoadFailure(filePath, 'load', 'schema rejected');
                return false;
            }
            this.snapshotMemoryCache.set(diskPath, parsedSnapshot);
            this.applyImportedLedgerSnapshot(parsedSnapshot);
            return true;
        } catch (err) {
            reportSnapshotLoadFailure(filePath, 'load', err);
            return false;
        }
    }

    /**
     * Asynchronously serializes and writes the governance snapshot to a JSON file.
     * Updates in-memory snapshot cache and persists to disk asynchronously.
     * Concurrency: Requires external synchronization per destination file path.
     *
     * @param filePath - Destination JSON file path.
     * @param projectProfile - Project profile identifier.
     */
    public async saveLedgerSnapshotAsync(
        filePath: string,
        projectProfile = DEFAULT_PROJECT_PROFILE,
    ): Promise<void> {
        const snapshot = this.getExportedLedgerSnapshot(projectProfile);
        const diskPath = path.resolve(filePath);
        this.snapshotMemoryCache.set(diskPath, snapshot);
        const parentDirectory = path.dirname(filePath);
        await fs.promises.mkdir(parentDirectory, { recursive: true });
        const stagingPath = buildUniqueStagingPath(filePath);
        try {
            await fs.promises.writeFile(
                stagingPath,
                JSON.stringify(snapshot, null, JSON_INDENT_SPACES) + '\n',
                ENCODING_UTF8,
            );
            await fs.promises.rename(stagingPath, filePath);
        } catch (err) {
            await fs.promises.rm(stagingPath, { force: true }).catch(() => undefined);
            reportSnapshotLoadFailure(filePath, 'save', err);
        }
    }

    /**
     * Asynchronously loads and restores governance snapshot from memory cache or a JSON file.
     * Prioritizes in-memory snapshot cache before falling back to asynchronous disk I/O.
     *
     * @param filePath - Source JSON file path.
     * @returns True if successfully loaded, false if file does not exist or invalid.
     */
    public async loadLedgerSnapshotAsync(filePath: string): Promise<boolean> {
        const diskPath = path.resolve(filePath);
        const cached = this.snapshotMemoryCache.get(diskPath);
        if (cached) {
            this.applyImportedLedgerSnapshot(cached);
            return true;
        }
        try {
            const content = await fs.promises.readFile(filePath, ENCODING_UTF8);
            const parsed = acceptGovernanceSnapshot(JSON.parse(content));
            if (parsed === null) {
                reportSnapshotLoadFailure(filePath, 'load', 'schema rejected');
                return false;
            }
            this.snapshotMemoryCache.set(diskPath, parsed);
            this.applyImportedLedgerSnapshot(parsed);
            return true;
        } catch (err) {
            reportSnapshotLoadFailure(filePath, 'load', err);
            return false;
        }
    }
}

/** Default global instance of supervisor */
export const defaultAdaptiveSupervisor = new FeedbackAdaptiveSupervisor();
