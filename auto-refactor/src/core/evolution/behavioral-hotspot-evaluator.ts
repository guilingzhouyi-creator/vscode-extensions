/**
 * Module: Core Evolution — Behavioral Hotspot Evaluator
 * File Path: src/core/evolution/behavioral-hotspot-evaluator.ts
 * Architecture Role: Computes behavioral hotspot index and technical debt interest
 *   multiplier by synthesizing 30-day commit churn, effective lines of code,
 *   cyclomatic complexity, and defect counts.
 * Dependencies & Triggers: Consumes GitFileHistoryProfile and GitCommitRecord; invoked by
 *   QualityScorer, refactoring schedulers, and evolution diagnostic pipelines.
 * Responsibilities:
 *   1. Quantify 30-day activity intensity and churn velocity per source file.
 *   2. Compute composite Hotspot index combining code complexity, volume, defects, and activity.
 *   3. Calculate compounding technical debt interest multiplier representing recurring change tax.
 *   4. Generate deterministic Hotspot rankings and prioritized refactoring recommendations.
 *   5. Provide pure-data evaluation pipelines with zero-crash fallbacks for
 *      unversioned environments.
 * Exit Semantics & Design Rationale: Never throws exceptions on malformed or absent git inputs;
 *   smoothly degrades to baseline unit multiplier (1.0) and zero hotspot score.
 */

import type { GitFileHistoryProfile } from './git-history-miner';

/**
 * Raw input metrics for evaluating a file's behavioral hotspot status.
 */
export interface FileHotspotInput {
    /** Target file path */
    filePath: string;
    /** Number of git commits touching this file in the last 30 days */
    commits30Days: number;
    /** Number of git commits touching this file in the last 7 days (burst spike detection) */
    commits7Days?: number;
    /** Effective lines of code (excluding comments and blank lines) */
    eloc: number;
    /** Aggregate or peak cyclomatic complexity */
    cyclomaticComplexity: number;
    /** Historical bug fixes or static defect/rule violation count */
    defectCount: number;
    /** Churn lines (added + deleted lines in 30-day window, optional) */
    churnLines?: number;
    /** Total lifetime commits (optional) */
    totalCommits?: number;
    /** Normalized author Shannon entropy [0.0, 1.0] (optional) */
    authorEntropy?: number;
    /** Dominant author commit share [0.0, 1.0] (optional) */
    primaryAuthorRatio?: number;
    /** Number of distinct active authors in recent evaluation window (optional) */
    activeAuthorsCount?: number;
    /** Timestamp of last modification in ms (optional) */
    lastModifiedTimestamp?: number;
}

/**
 * Severity tier of a behavioral hotspot.
 */
export type HotspotSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Actionable refactoring guidance for an identified hotspot.
 */
export interface HotspotRecommendation {
    action: 'immediate_refactor' | 'split_module' | 'add_test_coverage' | 'monitor';
    summary: string;
}

/**
 * Computed behavioral hotspot evaluation result for a single file.
 */
export interface HotspotEvaluationResult {
    filePath: string;
    /** Composite hotspot score normalized to [0, 100] */
    hotspotScore: number;
    /** Compounding technical debt interest multiplier [1.0, 5.0] */
    interestMultiplier: number;
    /** Relative rank among evaluated cohort (1 = hottest) */
    rank: number;
    /** Severity classification */
    severity: HotspotSeverity;
    /** Whether the file exhibits short-term burst spike acceleration */
    burstSpike?: boolean;
    /** Short-term churn acceleration factor relative to 30-day baseline */
    churnAcceleration?: number;
    /** Code health decay velocity factor (rate of debt accumulation and churn acceleration) */
    decayVelocity?: number;
    /** Whether the file exhibits rapid code health decay demanding preemptive intervention */
    rapidDecay?: boolean;
    /** Normalized author contribution entropy [0.0, 1.0] */
    authorEntropy?: number;
    /** Whether code ownership is heavily fragmented across multiple concurrent authors */
    authorDiffusion?: boolean;
    /** Number of active concurrent authors touching this file in the evaluation window */
    activeAuthorsCount?: number;
    /** Pairwise communication channels N*(N-1)/2 per Brooks' Law */
    coordinationPaths?: number;
    /** Whether concurrent author congestion creates elevated coordination overhead */
    developerCongestion?: boolean;
    /** Snapshot of input metrics */
    metrics: {
        commits30Days: number;
        churnLines: number;
        eloc: number;
        cyclomaticComplexity: number;
        defectCount: number;
    };
    /** Actionable refactoring proposal */
    recommendation: HotspotRecommendation;
}

/**
 * Configuration options for the Hotspot evaluation model.
 */
export interface HotspotEvaluatorOptions {
    /** Weight of cyclomatic complexity in static debt component [default: 0.40] */
    weightComplexity?: number;
    /** Weight of ELOC in static debt component [default: 0.30] */
    weightEloc?: number;
    /** Weight of defects in static debt component [default: 0.30] */
    weightDefects?: number;
    /** Churn normalization half-point in commits [default: 10] */
    activityHalfPointCommits?: number;
    /** Complexity normalization half-point [default: 20] */
    complexityHalfPoint?: number;
    /** ELOC normalization half-point [default: 600] */
    elocHalfPoint?: number;
    /** Defect count normalization half-point [default: 5] */
    defectHalfPoint?: number;
    /** Maximum debt interest multiplier cap [default: 5.0] */
    maxInterestMultiplier?: number;
    /** Reference current timestamp in milliseconds for time-series calculations */
    nowTimestamp?: number;
}

// ── Weight Defaults ─────────────────────────────────────────────────────────
const DEFAULT_WEIGHT_COMPLEXITY = 0.4;
const DEFAULT_WEIGHT_ELOC = 0.3;
const DEFAULT_WEIGHT_DEFECTS = 0.3;

// ── Normalization Half-Points ───────────────────────────────────────────────
const DEFAULT_ACTIVITY_HALF_POINT = 10;
const DEFAULT_COMPLEXITY_HALF_POINT = 20;
const DEFAULT_ELOC_HALF_POINT = 600;
const DEFAULT_DEFECT_HALF_POINT = 5;
const CHURN_LINES_HALF_POINT = 200;

// ── Scaling, Ceilings, and Baselines ─────────────────────────────────────────
const DEFAULT_MAX_INTEREST_MULTIPLIER = 5.0;
const BASE_INTEREST_MULTIPLIER = 1.0;
const SCORE_SCALE_MAX = 100.0;
const SCORE_SCALE_MIN = 0.0;
const DEFAULT_CYCLOMATIC_COMPLEXITY = 1;
const FALLBACK_DEFECT_COUNT = 0;
const FALLBACK_FILE_PATH = 'unknown';

// ── Time Windows and Intervals ──────────────────────────────────────────────
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_30_DAYS_MS = 30 * MILLIS_PER_DAY;
const WINDOW_7_DAYS_MS = 7 * MILLIS_PER_DAY;
const DAYS_IN_WEEK = 7;
const DAYS_IN_MONTH = 30;
const MIN_COMMITS_BASELINE_RATE = 1 / DAYS_IN_MONTH;

// ── Statistical and Precision Standards ─────────────────────────────────────
const PRECISION_STATISTICAL = 4;
const PRECISION_VELOCITY = 2;
const PRECISION_SCORE = 1;
const ENTROPY_MIN_VALUE = 0.0;
const ENTROPY_MAX_VALUE = 1.0;
const PRIMARY_RATIO_MONOPOLY = 1.0;

// ── Severity Thresholds ─────────────────────────────────────────────────────
const SEVERITY_CRITICAL_SCORE_THRESHOLD = 60;
const SEVERITY_CRITICAL_MULTIPLIER_THRESHOLD = 3.0;
const SEVERITY_HIGH_SCORE_THRESHOLD = 40;
const SEVERITY_HIGH_MULTIPLIER_THRESHOLD = 2.0;
const SEVERITY_MEDIUM_SCORE_THRESHOLD = 20;
const SEVERITY_MEDIUM_MULTIPLIER_THRESHOLD = 1.4;

// ── Severity Tier Identifiers ───────────────────────────────────────────────
const SEVERITY_CRITICAL: HotspotSeverity = 'critical';
const SEVERITY_HIGH: HotspotSeverity = 'high';
const SEVERITY_MEDIUM: HotspotSeverity = 'medium';
const SEVERITY_LOW: HotspotSeverity = 'low';

// ── Recommendation Thresholds ───────────────────────────────────────────────
const RECOMMENDATION_SPLIT_ELOC_THRESHOLD = 800;
const RECOMMENDATION_SPLIT_CC_THRESHOLD = 30;
const RECOMMENDATION_COVERAGE_DEFECT_THRESHOLD = 3;
const RECOMMENDATION_COVERAGE_COMMITS_THRESHOLD = 5;

// ── Action Recommendations ──────────────────────────────────────────────────
const ACTION_IMMEDIATE_REFACTOR = 'immediate_refactor';
const ACTION_SPLIT_MODULE = 'split_module';
const ACTION_ADD_TEST_COVERAGE = 'add_test_coverage';
const ACTION_MONITOR = 'monitor';

// ── Burst Spike Modifier Constants ──────────────────────────────────────────
const BURST_ACCELERATION_THRESHOLD = 2.0;
const BURST_MIN_COMMITS_7_DAYS = 3;
const BURST_SPIKE_MULTIPLIER_FACTOR = 1.25;

// ── Author Diffusion Modifier Constants ─────────────────────────────────────
const DIFFUSION_ENTROPY_THRESHOLD = 0.75;
const DIFFUSION_MIN_COMMITS_30_DAYS = 10;
const DIFFUSION_MULTIPLIER_FACTOR = 1.15;

// ── Rapid Decay Modifier Constants ──────────────────────────────────────────
const ACCELERATION_BASELINE = 1.0;
const DECAY_DEFECT_WEIGHT = 0.5;
const RAPID_DECAY_VELOCITY_THRESHOLD = 2.0;
const RAPID_DECAY_MIN_DEFECTS = 2;
const RAPID_DECAY_MULTIPLIER_FACTOR = 1.15;

// ── Developer Congestion Modifier Constants ─────────────────────────────────
const MIN_CONGESTION_AUTHOR_COUNT = 2;
const CONGESTION_MIN_AUTHORS = 4;
const CONGESTION_MIN_COMMITS_30_DAYS = 8;
const CONGESTION_MULTIPLIER_FACTOR = 1.15;

// ── Activity Scoring Weights and Factors ────────────────────────────────────
const ACTIVITY_COMMIT_WEIGHT = 0.7;
const ACTIVITY_CHURN_WEIGHT = 0.3;
const ACTIVITY_EXPONENT_FACTOR = 0.8;

// ── Diagnostics and Textual Annotations ─────────────────────────────────────
const ANNOTATION_BURST_SPIKE = '[BURST SPIKE: Short-term commit frequency accelerating]';
const ANNOTATION_AUTHOR_DIFFUSION =
    '[AUTHOR DIFFUSION: Highly fragmented ownership across concurrent contributors]';
const ANNOTATION_RAPID_DECAY =
    '[RAPID DECAY: Code health deteriorating rapidly under high churn acceleration and defects]';
const DEFAULT_MONITOR_SUMMARY =
    'Current complexity and churn are within manageable bounds. Monitor in release cycles.';
const DEFAULT_BASELINE_SUMMARY =
    'Baseline status; insufficient behavioral or complexity history available.';

/**
 * Helper to compute Shannon entropy from an array of positive counts and total sum.
 *
 * @param counts - Array of positive commit counts.
 * @param totalSum - Total sum of all counts.
 * @returns Normalized Shannon entropy in [0.0, 1.0].
 */
function computeShannonEntropy(counts: number[], totalSum: number): number {
    let shannon = 0;
    const activeAuthorCount = counts.length;
    for (let i = 0; i < activeAuthorCount; i++) {
        const commitShare = counts[i] / totalSum;
        if (commitShare > 0) {
            shannon -= commitShare * Math.log2(commitShare);
        }
    }
    const maxTheoreticalEntropy = Math.log2(activeAuthorCount);
    return maxTheoreticalEntropy > 0 ? shannon / maxTheoreticalEntropy : ENTROPY_MIN_VALUE;
}

/**
 * Calculate Shannon entropy and dominant author ratio over author commit counts.
 * Returns normalized entropy in [0.0, 1.0], where 0 indicates single-owner monopoly
 * and 1.0 indicates maximum dispersion/fragmentation across multiple authors.
 *
 * @param authorCounts - Mapping of author identifier to commit count.
 * @returns Object with normalized entropy and dominant author ratio.
 */
export function calculateAuthorEntropy(authorCounts?: Record<string, number>): {
    entropy: number;
    primaryAuthorRatio: number;
} {
    if (!authorCounts || typeof authorCounts !== 'object') {
        return { entropy: ENTROPY_MIN_VALUE, primaryAuthorRatio: PRIMARY_RATIO_MONOPOLY };
    }

    const counts = Object.values(authorCounts).filter(
        (commitCount) => typeof commitCount === 'number' && commitCount > 0,
    );
    const activeAuthorCount = counts.length;
    if (activeAuthorCount <= 1) {
        return { entropy: ENTROPY_MIN_VALUE, primaryAuthorRatio: PRIMARY_RATIO_MONOPOLY };
    }

    let totalCommitSum = 0;
    let dominantAuthorCommitCount = 0;
    for (let i = 0; i < activeAuthorCount; i++) {
        const commitCount = counts[i];
        totalCommitSum += commitCount;
        if (commitCount > dominantAuthorCommitCount) {
            dominantAuthorCommitCount = commitCount;
        }
    }

    if (totalCommitSum <= 0) {
        return { entropy: ENTROPY_MIN_VALUE, primaryAuthorRatio: PRIMARY_RATIO_MONOPOLY };
    }

    const normalizedEntropy = computeShannonEntropy(counts, totalCommitSum);
    const primaryAuthorRatio = dominantAuthorCommitCount / totalCommitSum;

    return {
        entropy: +Math.min(
            ENTROPY_MAX_VALUE,
            Math.max(ENTROPY_MIN_VALUE, normalizedEntropy),
        ).toFixed(PRECISION_STATISTICAL),
        primaryAuthorRatio: +Math.min(
            ENTROPY_MAX_VALUE,
            Math.max(ENTROPY_MIN_VALUE, primaryAuthorRatio),
        ).toFixed(PRECISION_STATISTICAL),
    };
}

/**
 * Sanitizes an unknown input candidate into a non-negative finite numeric value.
 *
 * @param candidateValue - Raw input to validate.
 * @param fallbackValue - Fallback number if validation fails.
 * @returns Validated non-negative number.
 */
function sanitizeNonNegative(candidateValue: unknown, fallbackValue = 0): number {
    if (
        typeof candidateValue !== 'number' ||
        Number.isNaN(candidateValue) ||
        !Number.isFinite(candidateValue) ||
        candidateValue < 0
    ) {
        return fallbackValue;
    }
    return candidateValue;
}

/**
 * Resolves severity classification from composite hotspot score and interest multiplier.
 *
 * @param hotspotScore - Normalized composite score in [0.0, 100.0].
 * @param interestMultiplier - Compounding interest multiplier in [1.0, maxCap].
 * @returns HotspotSeverity classification.
 */
function resolveHotspotSeverity(hotspotScore: number, interestMultiplier: number): HotspotSeverity {
    if (
        hotspotScore >= SEVERITY_CRITICAL_SCORE_THRESHOLD ||
        interestMultiplier >= SEVERITY_CRITICAL_MULTIPLIER_THRESHOLD
    ) {
        return SEVERITY_CRITICAL;
    }
    if (
        hotspotScore >= SEVERITY_HIGH_SCORE_THRESHOLD ||
        interestMultiplier >= SEVERITY_HIGH_MULTIPLIER_THRESHOLD
    ) {
        return SEVERITY_HIGH;
    }
    if (
        hotspotScore >= SEVERITY_MEDIUM_SCORE_THRESHOLD ||
        interestMultiplier >= SEVERITY_MEDIUM_MULTIPLIER_THRESHOLD
    ) {
        return SEVERITY_MEDIUM;
    }
    return SEVERITY_LOW;
}

/**
 * Resolves actionable refactoring recommendation for an identified behavioral hotspot.
 *
 * The metrics argument is an inline object literal at the call site, so its properties are
 * documented individually: the JSDoc parser resolves `@param` names against the declared
 * properties rather than accepting the whole object as one opaque name.
 *
 * @param severity - Classified hotspot severity tier.
 * @param metrics - Cleaned file hotspot metric snapshot.
 * @param metrics.commits30Days - Commit count inside the trailing 30-day window.
 * @param metrics.churnLines - Lines added plus removed over the same window.
 * @param metrics.eloc - Effective code volume of the file.
 * @param metrics.cyclomaticComplexity - Aggregated cyclomatic complexity of the file.
 * @param metrics.defectCount - Defects attributed to the file in the observation window.
 * @returns Actionable HotspotRecommendation.
 */
function resolveHotspotRecommendation(
    severity: HotspotSeverity,
    metrics: {
        commits30Days: number;
        churnLines: number;
        eloc: number;
        cyclomaticComplexity: number;
        defectCount: number;
    },
): HotspotRecommendation {
    if (severity === SEVERITY_CRITICAL) {
        return {
            action: ACTION_IMMEDIATE_REFACTOR,
            summary:
                `Critical behavioral hotspot with high churn (${metrics.commits30Days} commits in 30d) ` +
                `and compounded debt (CC: ${metrics.cyclomaticComplexity}, ELOC: ${metrics.eloc}, defects: ${metrics.defectCount}). ` +
                `Immediate modular decomposition required to halt compounding debt interest.`,
        };
    }
    if (
        metrics.eloc > RECOMMENDATION_SPLIT_ELOC_THRESHOLD ||
        metrics.cyclomaticComplexity > RECOMMENDATION_SPLIT_CC_THRESHOLD
    ) {
        return {
            action: ACTION_SPLIT_MODULE,
            summary:
                `File exceeds maintainability thresholds (ELOC: ${metrics.eloc}, CC: ${metrics.cyclomaticComplexity}) ` +
                `in active development. Decompose into focused single-responsibility submodules.`,
        };
    }
    if (
        metrics.defectCount >= RECOMMENDATION_COVERAGE_DEFECT_THRESHOLD &&
        metrics.commits30Days >= RECOMMENDATION_COVERAGE_COMMITS_THRESHOLD
    ) {
        return {
            action: ACTION_ADD_TEST_COVERAGE,
            summary:
                `Elevated defect count (${metrics.defectCount}) with ongoing modifications. ` +
                `Establish comprehensive regression tests before further feature expansion.`,
        };
    }
    return {
        action: ACTION_MONITOR,
        summary: DEFAULT_MONITOR_SUMMARY,
    };
}

/** Clean metric subset required by evolution modifiers. */
interface ModifierCleanMetrics {
    readonly commits30Days: number;
    readonly defectCount: number;
}

/** Full composite evolution modifier state record. */
interface EvolutionModifierState {
    effectiveMultiplier: number;
    burstSpike: boolean;
    churnAcceleration: number;
    authorDiffusion: boolean;
    decayVelocity: number;
    rapidDecay: boolean;
    developerCongestion: boolean;
    activeAuthorsCount: number;
    coordinationPaths: number;
    annotations: string[];
}

/** State tracking accumulated interest multipliers and diagnostics. */
interface ModifierAccumulator {
    effectiveMultiplier: number;
    readonly annotations: string[];
}

/** Context parameters for evaluating burst spikes (SIM-ARGS-001). */
interface BurstSpikeParams {
    readonly accumulator: ModifierAccumulator;
    readonly input: FileHotspotInput;
    readonly cleanMetrics: ModifierCleanMetrics;
    readonly maxCap: number;
}

/** Context parameters for evaluating author diffusion (SIM-ARGS-001). */
interface AuthorDiffusionParams {
    readonly accumulator: ModifierAccumulator;
    readonly input: FileHotspotInput;
    readonly cleanMetrics: ModifierCleanMetrics;
    readonly maxCap: number;
}

/** Context parameters for evaluating rapid code health decay (SIM-ARGS-001). */
interface RapidDecayParams {
    readonly accumulator: ModifierAccumulator;
    readonly churnAcceleration: number;
    readonly cleanMetrics: ModifierCleanMetrics;
    readonly maxCap: number;
}

/** Context parameters for evaluating developer congestion (SIM-ARGS-001). */
interface DeveloperCongestionParams {
    readonly accumulator: ModifierAccumulator;
    readonly authorCount: number;
    readonly cleanMetrics: ModifierCleanMetrics;
    readonly maxCap: number;
}

/** Parameter object for evolution modifier calculations (SIM-ARGS-001). */
interface EvolutionModifierParams {
    readonly baseMultiplier: number;
    readonly input: FileHotspotInput;
    readonly cleanMetrics: ModifierCleanMetrics;
    readonly maxCap: number;
}

/**
 * Evaluates short-term burst spike acceleration over a 7-day window.
 *
 * @param params - Contextual parameters for burst spike calculation.
 * @returns Object containing burst spike flag and normalized churn acceleration.
 */
function evaluateBurstSpike(params: BurstSpikeParams): {
    burstSpike: boolean;
    churnAcceleration: number;
} {
    let burstSpike = false;
    let churnAcceleration = ACCELERATION_BASELINE;
    const { accumulator, input, cleanMetrics, maxCap } = params;

    if (typeof input.commits7Days === 'number' && input.commits7Days > 0) {
        const safeCommits7 = sanitizeNonNegative(input.commits7Days);
        const rate7 = safeCommits7 / DAYS_IN_WEEK;
        const rate30 = Math.max(
            MIN_COMMITS_BASELINE_RATE,
            cleanMetrics.commits30Days / DAYS_IN_MONTH,
        );
        churnAcceleration = +(rate7 / rate30).toFixed(PRECISION_VELOCITY);
        if (
            churnAcceleration >= BURST_ACCELERATION_THRESHOLD &&
            safeCommits7 >= BURST_MIN_COMMITS_7_DAYS
        ) {
            burstSpike = true;
            accumulator.effectiveMultiplier = +Math.min(
                maxCap,
                accumulator.effectiveMultiplier * BURST_SPIKE_MULTIPLIER_FACTOR,
            ).toFixed(PRECISION_VELOCITY);
            accumulator.annotations.push(ANNOTATION_BURST_SPIKE);
        }
    }
    return { burstSpike, churnAcceleration };
}

/**
 * Evaluates author diffusion where ownership is heavily fragmented across contributors.
 *
 * @param params - Contextual parameters for author diffusion evaluation.
 * @returns Whether code ownership exhibits high author diffusion.
 */
function evaluateAuthorDiffusion(params: AuthorDiffusionParams): boolean {
    const { accumulator, input, cleanMetrics, maxCap } = params;
    if (
        typeof input.authorEntropy === 'number' &&
        input.authorEntropy >= DIFFUSION_ENTROPY_THRESHOLD &&
        cleanMetrics.commits30Days >= DIFFUSION_MIN_COMMITS_30_DAYS
    ) {
        accumulator.effectiveMultiplier = +Math.min(
            maxCap,
            accumulator.effectiveMultiplier * DIFFUSION_MULTIPLIER_FACTOR,
        ).toFixed(PRECISION_VELOCITY);
        accumulator.annotations.push(ANNOTATION_AUTHOR_DIFFUSION);
        return true;
    }
    return false;
}

/**
 * Evaluates rapid code health decay under compounding churn acceleration and defect density.
 *
 * @param params - Contextual parameters for rapid decay calculation.
 * @returns Object containing rapid decay flag and computed decay velocity.
 */
function evaluateRapidDecay(params: RapidDecayParams): {
    rapidDecay: boolean;
    decayVelocity: number;
} {
    let rapidDecay = false;
    let decayVelocity = ACCELERATION_BASELINE;
    const { accumulator, churnAcceleration, cleanMetrics, maxCap } = params;

    if (churnAcceleration > ACCELERATION_BASELINE) {
        const defectRatio = cleanMetrics.defectCount / Math.max(1, cleanMetrics.commits30Days);
        decayVelocity = +(churnAcceleration * (1.0 + defectRatio * DECAY_DEFECT_WEIGHT)).toFixed(
            PRECISION_VELOCITY,
        );
        if (
            decayVelocity >= RAPID_DECAY_VELOCITY_THRESHOLD &&
            cleanMetrics.defectCount >= RAPID_DECAY_MIN_DEFECTS
        ) {
            rapidDecay = true;
            accumulator.effectiveMultiplier = +Math.min(
                maxCap,
                accumulator.effectiveMultiplier * RAPID_DECAY_MULTIPLIER_FACTOR,
            ).toFixed(PRECISION_VELOCITY);
            accumulator.annotations.push(ANNOTATION_RAPID_DECAY);
        }
    }
    return { rapidDecay, decayVelocity };
}

/**
 * Evaluates developer coordination congestion per Brooks' Law pairwise channels.
 *
 * @param params - Contextual parameters for developer congestion evaluation.
 * @returns Object containing developer congestion flag and active coordination path count.
 */
function evaluateDeveloperCongestion(params: DeveloperCongestionParams): {
    developerCongestion: boolean;
    coordinationPaths: number;
} {
    const { accumulator, authorCount, cleanMetrics, maxCap } = params;
    const coordinationPaths =
        authorCount >= MIN_CONGESTION_AUTHOR_COUNT ? (authorCount * (authorCount - 1)) / 2 : 0;
    let developerCongestion = false;

    if (
        authorCount >= CONGESTION_MIN_AUTHORS &&
        cleanMetrics.commits30Days >= CONGESTION_MIN_COMMITS_30_DAYS
    ) {
        developerCongestion = true;
        accumulator.effectiveMultiplier = +Math.min(
            maxCap,
            accumulator.effectiveMultiplier * CONGESTION_MULTIPLIER_FACTOR,
        ).toFixed(PRECISION_VELOCITY);
        accumulator.annotations.push(
            `[DEVELOPER CONGESTION: Elevated coordination friction with ${authorCount} active authors and ${coordinationPaths} communication channels]`,
        );
    }
    return { developerCongestion, coordinationPaths };
}

/**
 * Synthesizes all evolution modifiers into a unified modifier state.
 *
 * @param params - Input parameters for computing evolution modifiers.
 * @returns Unified state record of all applied evolution modifiers.
 */
function computeEvolutionModifiers(params: EvolutionModifierParams): EvolutionModifierState {
    const { baseMultiplier, input, cleanMetrics, maxCap } = params;
    const accumulator: ModifierAccumulator = {
        effectiveMultiplier: baseMultiplier,
        annotations: [],
    };

    const { burstSpike, churnAcceleration } = evaluateBurstSpike({
        accumulator,
        input,
        cleanMetrics,
        maxCap,
    });

    const authorDiffusion = evaluateAuthorDiffusion({
        accumulator,
        input,
        cleanMetrics,
        maxCap,
    });

    const { rapidDecay, decayVelocity } = evaluateRapidDecay({
        accumulator,
        churnAcceleration,
        cleanMetrics,
        maxCap,
    });

    const authorCount = sanitizeNonNegative(input.activeAuthorsCount);
    const { developerCongestion, coordinationPaths } = evaluateDeveloperCongestion({
        accumulator,
        authorCount,
        cleanMetrics,
        maxCap,
    });

    return {
        effectiveMultiplier: accumulator.effectiveMultiplier,
        burstSpike,
        churnAcceleration,
        authorDiffusion,
        decayVelocity,
        rapidDecay,
        developerCongestion,
        activeAuthorsCount: authorCount,
        coordinationPaths,
        annotations: accumulator.annotations,
    };
}

/**
 * Behavioral Hotspot Evaluator implementing CodeScene code evolution principles.
 */
export class BehavioralHotspotEvaluator {
    private readonly weightComplexity: number;
    private readonly weightEloc: number;
    private readonly weightDefects: number;
    private readonly activityHalfPoint: number;
    private readonly complexityHalfPoint: number;
    private readonly elocHalfPoint: number;
    private readonly defectHalfPoint: number;
    private readonly maxInterestMultiplier: number;
    private readonly nowTimestamp: number;

    /**
     * Initializes the BehavioralHotspotEvaluator with configurable weights and half-points.
     *
     * @param options - Optional evaluator configuration options.
     */
    constructor(options?: HotspotEvaluatorOptions) {
        this.weightComplexity = options?.weightComplexity ?? DEFAULT_WEIGHT_COMPLEXITY;
        this.weightEloc = options?.weightEloc ?? DEFAULT_WEIGHT_ELOC;
        this.weightDefects = options?.weightDefects ?? DEFAULT_WEIGHT_DEFECTS;
        this.activityHalfPoint = options?.activityHalfPointCommits ?? DEFAULT_ACTIVITY_HALF_POINT;
        this.complexityHalfPoint = options?.complexityHalfPoint ?? DEFAULT_COMPLEXITY_HALF_POINT;
        this.elocHalfPoint = options?.elocHalfPoint ?? DEFAULT_ELOC_HALF_POINT;
        this.defectHalfPoint = options?.defectHalfPoint ?? DEFAULT_DEFECT_HALF_POINT;
        this.maxInterestMultiplier =
            options?.maxInterestMultiplier ?? DEFAULT_MAX_INTEREST_MULTIPLIER;
        this.nowTimestamp = options?.nowTimestamp ?? Date.now();
    }

    /**
     * Compute normalized activity intensity [0.0, 1.0] from 30-day commits and churn.
     *
     * @param commits30Days - Number of commits in the 30-day window.
     * @param churnLines - Lines of code churned in the window.
     * @returns Normalized activity intensity score in [0.0, 1.0].
     */
    public calculateActivityScore(commits30Days: number, churnLines?: number): number {
        const safeCommits = sanitizeNonNegative(commits30Days);
        const safeChurn = sanitizeNonNegative(churnLines);

        if (safeCommits === 0 && safeChurn === 0) {
            return SCORE_SCALE_MIN;
        }

        const commitSaturation = safeCommits / (safeCommits + this.activityHalfPoint);
        if (safeChurn > 0) {
            const churnSaturation = safeChurn / (safeChurn + CHURN_LINES_HALF_POINT);
            return +(
                ACTIVITY_COMMIT_WEIGHT * commitSaturation +
                ACTIVITY_CHURN_WEIGHT * churnSaturation
            ).toFixed(PRECISION_STATISTICAL);
        }

        return +commitSaturation.toFixed(PRECISION_STATISTICAL);
    }

    /**
     * Compute normalized static debt score [0.0, 1.0] from CC, ELOC, and defect count.
     *
     * @param cyclomaticComplexity - Aggregate or peak cyclomatic complexity.
     * @param eloc - Effective lines of code.
     * @param defectCount - Count of known static or historical defects.
     * @returns Normalized static debt score in [0.0, 1.0].
     */
    public calculateStaticDebtScore(
        cyclomaticComplexity: number,
        eloc: number,
        defectCount: number,
    ): number {
        const safeCc = sanitizeNonNegative(cyclomaticComplexity);
        const safeEloc = sanitizeNonNegative(eloc);
        const safeDefects = sanitizeNonNegative(defectCount);

        const normCc = safeCc / (safeCc + this.complexityHalfPoint);
        const normEloc = safeEloc / (safeEloc + this.elocHalfPoint);
        const normDefects = safeDefects / (safeDefects + this.defectHalfPoint);

        const totalWeight =
            this.weightComplexity + this.weightEloc + this.weightDefects ||
            BASE_INTEREST_MULTIPLIER;
        const weightedDebt =
            (this.weightComplexity * normCc +
                this.weightEloc * normEloc +
                this.weightDefects * normDefects) /
            totalWeight;

        return +Math.min(ENTROPY_MAX_VALUE, Math.max(ENTROPY_MIN_VALUE, weightedDebt)).toFixed(
            PRECISION_STATISTICAL,
        );
    }

    /**
     * Calculate composite Hotspot score [0.0, 100.0] as the intersection of activity and debt.
     *
     * @param input - File hotspot metrics input record.
     * @returns Composite hotspot score in [0.0, 100.0].
     */
    public calculateHotspotScore(input: FileHotspotInput): number {
        if (!input || typeof input !== 'object') {
            return SCORE_SCALE_MIN;
        }

        const activityScore = this.calculateActivityScore(input.commits30Days, input.churnLines);
        if (activityScore <= SCORE_SCALE_MIN) {
            return SCORE_SCALE_MIN;
        }

        const debtScore = this.calculateStaticDebtScore(
            input.cyclomaticComplexity,
            input.eloc,
            input.defectCount,
        );

        // CodeScene Hotspot principle: Activity x Static Debt
        const rawScore =
            SCORE_SCALE_MAX * Math.pow(activityScore, ACTIVITY_EXPONENT_FACTOR) * debtScore;
        return +Math.min(SCORE_SCALE_MAX, Math.max(SCORE_SCALE_MIN, rawScore)).toFixed(
            PRECISION_SCORE,
        );
    }

    /**
     * Calculate technical debt compounding interest multiplier [1.0, maxCap].
     * Represents recurring maintenance tax paid on each change.
     *
     * @param input - File hotspot metrics input record.
     * @returns Compounding interest multiplier in [1.0, maxCap].
     */
    public calculateInterestMultiplier(input: FileHotspotInput): number {
        if (!input || typeof input !== 'object') {
            return BASE_INTEREST_MULTIPLIER;
        }

        const activityScore = this.calculateActivityScore(input.commits30Days, input.churnLines);
        if (activityScore <= SCORE_SCALE_MIN) {
            return BASE_INTEREST_MULTIPLIER;
        }

        const debtScore = this.calculateStaticDebtScore(
            input.cyclomaticComplexity,
            input.eloc,
            input.defectCount,
        );

        const spread = Math.max(0.0, this.maxInterestMultiplier - BASE_INTEREST_MULTIPLIER);
        const multiplier = BASE_INTEREST_MULTIPLIER + spread * (activityScore * debtScore);
        return +Math.min(
            this.maxInterestMultiplier,
            Math.max(BASE_INTEREST_MULTIPLIER, multiplier),
        ).toFixed(PRECISION_VELOCITY);
    }

    /**
     * Evaluate single file hotspot metrics with ranking defaulted to 1.
     *
     * @param input - Target file hotspot metrics input.
     * @returns Full hotspot evaluation result.
     */
    public evaluateSingle(input: FileHotspotInput): HotspotEvaluationResult {
        if (!input || typeof input !== 'object' || typeof input.filePath !== 'string') {
            return this.createDefaultResult(input?.filePath || FALLBACK_FILE_PATH);
        }

        const hotspotScore = this.calculateHotspotScore(input);
        const interestMultiplier = this.calculateInterestMultiplier(input);
        const severity = resolveHotspotSeverity(hotspotScore, interestMultiplier);

        const cleanMetrics = {
            commits30Days: sanitizeNonNegative(input.commits30Days),
            churnLines: sanitizeNonNegative(input.churnLines),
            eloc: sanitizeNonNegative(input.eloc),
            cyclomaticComplexity: sanitizeNonNegative(input.cyclomaticComplexity),
            defectCount: sanitizeNonNegative(input.defectCount),
        };

        const modifierState = computeEvolutionModifiers({
            baseMultiplier: interestMultiplier,
            input,
            cleanMetrics,
            maxCap: this.maxInterestMultiplier,
        });

        const recommendation = resolveHotspotRecommendation(severity, cleanMetrics);
        for (const annotation of modifierState.annotations) {
            recommendation.summary += ' ' + annotation;
        }

        return {
            filePath: input.filePath,
            hotspotScore,
            interestMultiplier: modifierState.effectiveMultiplier,
            rank: 1,
            severity,
            burstSpike: modifierState.burstSpike,
            churnAcceleration: modifierState.churnAcceleration,
            decayVelocity: modifierState.decayVelocity,
            rapidDecay: modifierState.rapidDecay,
            authorEntropy: input.authorEntropy,
            authorDiffusion: modifierState.authorDiffusion,
            activeAuthorsCount: modifierState.activeAuthorsCount,
            coordinationPaths: modifierState.coordinationPaths,
            developerCongestion: modifierState.developerCongestion,
            metrics: cleanMetrics,
            recommendation,
        };
    }

    /**
     * Evaluate a batch of files and compute relative Hotspot rankings (rank 1 = hottest).
     *
     * @param inputs - Array of file hotspot metric inputs.
     * @returns Sorted and ranked array of evaluation results.
     */
    public evaluateBatch(inputs: FileHotspotInput[]): HotspotEvaluationResult[] {
        if (!Array.isArray(inputs) || inputs.length === 0) {
            return [];
        }

        const results: HotspotEvaluationResult[] = [];
        for (const candidateInput of inputs) {
            results.push(this.evaluateSingle(candidateInput));
        }

        // Sort descending: highest hotspot score first;
        // tiebreak by interest multiplier then commits
        results.sort((resultA, resultB) => {
            if (resultB.hotspotScore !== resultA.hotspotScore) {
                return resultB.hotspotScore - resultA.hotspotScore;
            }
            if (resultB.interestMultiplier !== resultA.interestMultiplier) {
                return resultB.interestMultiplier - resultA.interestMultiplier;
            }
            if (resultB.metrics.commits30Days !== resultA.metrics.commits30Days) {
                return resultB.metrics.commits30Days - resultA.metrics.commits30Days;
            }
            return resultA.filePath.localeCompare(resultB.filePath);
        });

        // Assign ordinal ranks
        for (let i = 0; i < results.length; i++) {
            results[i].rank = i + 1;
        }

        return results;
    }

    /**
     * Evaluate hotspot status from GitFileHistoryProfiles paired with static code metrics.
     *
     * @param profiles - Array of mined git file history profiles.
     * @param staticMetricsMap - Map of file path to static code complexity metrics.
     * @returns Ranked array of hotspot evaluation results.
     */
    public evaluateFromGitProfiles(
        profiles: GitFileHistoryProfile[],
        staticMetricsMap: Map<
            string,
            { eloc: number; cyclomaticComplexity: number; defectCount?: number }
        >,
    ): HotspotEvaluationResult[] {
        if (!Array.isArray(profiles) || profiles.length === 0) {
            return [];
        }

        const inputs: FileHotspotInput[] = [];
        for (const profile of profiles) {
            const staticMetrics = staticMetricsMap.get(profile.filePath) || {
                eloc: 0,
                cyclomaticComplexity: DEFAULT_CYCLOMATIC_COMPLEXITY,
                defectCount: profile.bugFixCommits,
            };

            const commits30Days = this.extract30DayCommitsFromProfile(profile);
            const commits7Days = this.extract7DayCommitsFromProfile(profile);
            const authorStats = calculateAuthorEntropy(profile.authorCommitCounts);
            const activeAuthorsCount = this.extractActiveAuthorsFromProfile(profile);

            inputs.push({
                filePath: profile.filePath,
                commits30Days,
                commits7Days,
                eloc: staticMetrics.eloc,
                cyclomaticComplexity: staticMetrics.cyclomaticComplexity,
                defectCount: staticMetrics.defectCount ?? profile.bugFixCommits,
                totalCommits: profile.totalCommits,
                authorEntropy: authorStats.entropy,
                primaryAuthorRatio: authorStats.primaryAuthorRatio,
                activeAuthorsCount,
                lastModifiedTimestamp: profile.lastModifiedTimestamp ?? undefined,
            });
        }

        return this.evaluateBatch(inputs);
    }

    /**
     * Count commits within the last 30 days from a GitFileHistoryProfile.
     *
     * @param profile - Target git file history profile.
     * @returns Count of commits within the 30-day window.
     */
    public extract30DayCommitsFromProfile(profile: GitFileHistoryProfile): number {
        if (!profile || !profile.isGitAvailable || !Array.isArray(profile.recentCommits)) {
            return 0;
        }

        const cutoffTimestamp = this.nowTimestamp - WINDOW_30_DAYS_MS;
        let count = 0;
        for (const commit of profile.recentCommits) {
            if (commit.timestamp >= cutoffTimestamp) {
                count++;
            }
        }
        return count;
    }

    /**
     * Count commits within the last 7 days from a GitFileHistoryProfile for burst spike detection.
     *
     * @param profile - Target git file history profile.
     * @returns Count of commits within the 7-day window.
     */
    public extract7DayCommitsFromProfile(profile: GitFileHistoryProfile): number {
        if (!profile || !profile.isGitAvailable || !Array.isArray(profile.recentCommits)) {
            return 0;
        }

        const cutoffTimestamp = this.nowTimestamp - WINDOW_7_DAYS_MS;
        let count = 0;
        for (const commit of profile.recentCommits) {
            if (commit.timestamp >= cutoffTimestamp) {
                count++;
            }
        }
        return count;
    }

    /**
     * Helper to count distinct active authors within cutoff window.
     *
     * @param commits - List of recent commit summaries.
     * @param cutoffTimestamp - Timestamp threshold.
     * @returns Count of distinct authors.
     */
    private countRecentActiveAuthors(
        commits: { timestamp: number; author?: string }[],
        cutoffTimestamp: number,
    ): number {
        const activeSet = new Set<string>();
        for (const commit of commits) {
            if (commit.timestamp >= cutoffTimestamp && commit.author) {
                activeSet.add(commit.author);
            }
        }
        return activeSet.size;
    }

    /**
     * Count distinct active authors contributing within the 30-day window.
     *
     * @param profile - Target git file history profile.
     * @returns Count of unique active authors.
     */
    public extractActiveAuthorsFromProfile(profile: GitFileHistoryProfile): number {
        if (!profile?.isGitAvailable) {
            return 0;
        }
        if (Array.isArray(profile.recentCommits) && profile.recentCommits.length > 0) {
            const count = this.countRecentActiveAuthors(
                profile.recentCommits,
                this.nowTimestamp - WINDOW_30_DAYS_MS,
            );
            if (count > 0) {
                return count;
            }
        }
        if (profile.authorCommitCounts && typeof profile.authorCommitCounts === 'object') {
            return Object.keys(profile.authorCommitCounts).length;
        }
        return 0;
    }

    /**
     * Produce safe baseline Hotspot evaluation result for unversioned or degraded environments.
     *
     * @param filePath - Target file path.
     * @returns Baseline fallback HotspotEvaluationResult.
     */
    public createDefaultResult(filePath: string): HotspotEvaluationResult {
        return {
            filePath,
            hotspotScore: SCORE_SCALE_MIN,
            interestMultiplier: BASE_INTEREST_MULTIPLIER,
            rank: 1,
            severity: SEVERITY_LOW,
            decayVelocity: ACCELERATION_BASELINE,
            rapidDecay: false,
            developerCongestion: false,
            activeAuthorsCount: 0,
            coordinationPaths: 0,
            metrics: {
                commits30Days: 0,
                churnLines: 0,
                eloc: 0,
                cyclomaticComplexity: 0,
                defectCount: FALLBACK_DEFECT_COUNT,
            },
            recommendation: {
                action: ACTION_MONITOR,
                summary: DEFAULT_BASELINE_SUMMARY,
            },
        };
    }
}
