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

const DEFAULT_WEIGHT_COMPLEXITY = 0.4;
const DEFAULT_WEIGHT_ELOC = 0.3;
const DEFAULT_WEIGHT_DEFECTS = 0.3;
const DEFAULT_ACTIVITY_HALF_POINT = 10;
const DEFAULT_COMPLEXITY_HALF_POINT = 20;
const DEFAULT_ELOC_HALF_POINT = 600;
const DEFAULT_DEFECT_HALF_POINT = 5;
const DEFAULT_MAX_INTEREST_MULTIPLIER = 5.0;
const CHURN_LINES_HALF_POINT = 200;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_30_DAYS_MS = 30 * MILLIS_PER_DAY;
const WINDOW_7_DAYS_MS = 7 * MILLIS_PER_DAY;

/**
 * Calculate Shannon entropy and dominant author ratio over author commit counts.
 * Returns normalized entropy in [0.0, 1.0], where 0 indicates single-owner monopoly
 * and 1.0 indicates maximum dispersion/fragmentation across multiple authors.
 */
export function calculateAuthorEntropy(authorCounts?: Record<string, number>): {
    entropy: number;
    primaryAuthorRatio: number;
} {
    if (!authorCounts || typeof authorCounts !== 'object') {
        return { entropy: 0.0, primaryAuthorRatio: 1.0 };
    }

    const counts = Object.values(authorCounts).filter((c) => typeof c === 'number' && c > 0);
    const n = counts.length;
    if (n <= 1) {
        return { entropy: 0.0, primaryAuthorRatio: 1.0 };
    }

    let total = 0;
    let maxCount = 0;
    for (let i = 0; i < n; i++) {
        const c = counts[i];
        total += c;
        if (c > maxCount) {
            maxCount = c;
        }
    }

    if (total <= 0) {
        return { entropy: 0.0, primaryAuthorRatio: 1.0 };
    }

    let shannon = 0;
    for (let i = 0; i < n; i++) {
        const p = counts[i] / total;
        if (p > 0) {
            shannon -= p * Math.log2(p);
        }
    }

    const maxEntropy = Math.log2(n);
    const normalizedEntropy = maxEntropy > 0 ? shannon / maxEntropy : 0.0;
    const primaryRatio = maxCount / total;

    return {
        entropy: +Math.min(1.0, Math.max(0.0, normalizedEntropy)).toFixed(4),
        primaryAuthorRatio: +Math.min(1.0, Math.max(0.0, primaryRatio)).toFixed(4),
    };
}

function sanitizeNonNegative(val: unknown, fallback = 0): number {
    if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val) || val < 0) {
        return fallback;
    }
    return val;
}

function resolveHotspotSeverity(hotspotScore: number, interestMultiplier: number): HotspotSeverity {
    if (hotspotScore >= 60 || interestMultiplier >= 3.0) {
        return 'critical';
    }
    if (hotspotScore >= 40 || interestMultiplier >= 2.0) {
        return 'high';
    }
    if (hotspotScore >= 20 || interestMultiplier >= 1.4) {
        return 'medium';
    }
    return 'low';
}

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
    if (severity === 'critical') {
        return {
            action: 'immediate_refactor',
            summary:
                `Critical behavioral hotspot with high churn (${metrics.commits30Days} commits in 30d) ` +
                `and compounded debt (CC: ${metrics.cyclomaticComplexity}, ELOC: ${metrics.eloc}, defects: ${metrics.defectCount}). ` +
                `Immediate modular decomposition required to halt compounding debt interest.`,
        };
    }
    if (metrics.eloc > 800 || metrics.cyclomaticComplexity > 30) {
        return {
            action: 'split_module',
            summary:
                `File exceeds maintainability thresholds (ELOC: ${metrics.eloc}, CC: ${metrics.cyclomaticComplexity}) ` +
                `in active development. Decompose into focused single-responsibility submodules.`,
        };
    }
    if (metrics.defectCount >= 3 && metrics.commits30Days >= 5) {
        return {
            action: 'add_test_coverage',
            summary:
                `Elevated defect count (${metrics.defectCount}) with ongoing modifications. ` +
                `Establish comprehensive regression tests before further feature expansion.`,
        };
    }
    return {
        action: 'monitor',
        summary: `Current complexity and churn are within manageable bounds. Monitor in release cycles.`,
    };
}

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

interface ModifierAccumulator {
    effectiveMultiplier: number;
    annotations: string[];
}

function evaluateBurstSpike(
    acc: ModifierAccumulator,
    input: FileHotspotInput,
    cleanMetrics: { commits30Days: number; defectCount: number },
    maxCap: number,
): { burstSpike: boolean; churnAcceleration: number } {
    let burstSpike = false;
    let churnAcceleration = 1.0;
    if (typeof input.commits7Days === 'number' && input.commits7Days > 0) {
        const safeCommits7 = sanitizeNonNegative(input.commits7Days);
        const rate7 = safeCommits7 / 7;
        const rate30 = Math.max(1 / 30, cleanMetrics.commits30Days / 30);
        churnAcceleration = +(rate7 / rate30).toFixed(2);
        if (churnAcceleration >= 2.0 && safeCommits7 >= 3) {
            burstSpike = true;
            acc.effectiveMultiplier = +Math.min(maxCap, acc.effectiveMultiplier * 1.25).toFixed(2);
            acc.annotations.push('[BURST SPIKE: Short-term commit frequency accelerating]');
        }
    }
    return { burstSpike, churnAcceleration };
}

function evaluateAuthorDiffusion(
    acc: ModifierAccumulator,
    input: FileHotspotInput,
    cleanMetrics: { commits30Days: number; defectCount: number },
    maxCap: number,
): boolean {
    if (
        typeof input.authorEntropy === 'number' &&
        input.authorEntropy >= 0.75 &&
        cleanMetrics.commits30Days >= 10
    ) {
        acc.effectiveMultiplier = +Math.min(maxCap, acc.effectiveMultiplier * 1.15).toFixed(2);
        acc.annotations.push('[AUTHOR DIFFUSION: Highly fragmented ownership across concurrent contributors]');
        return true;
    }
    return false;
}

function evaluateRapidDecay(
    acc: ModifierAccumulator,
    churnAcceleration: number,
    cleanMetrics: { commits30Days: number; defectCount: number },
    maxCap: number,
): { rapidDecay: boolean; decayVelocity: number } {
    let rapidDecay = false;
    let decayVelocity = 1.0;
    if (churnAcceleration > 1.0) {
        const defectRatio = cleanMetrics.defectCount / Math.max(1, cleanMetrics.commits30Days);
        decayVelocity = +(churnAcceleration * (1.0 + defectRatio * 0.5)).toFixed(2);
        if (decayVelocity >= 2.0 && cleanMetrics.defectCount >= 2) {
            rapidDecay = true;
            acc.effectiveMultiplier = +Math.min(maxCap, acc.effectiveMultiplier * 1.15).toFixed(2);
            acc.annotations.push('[RAPID DECAY: Code health deteriorating rapidly under high churn acceleration and defects]');
        }
    }
    return { rapidDecay, decayVelocity };
}

function evaluateDeveloperCongestion(
    acc: ModifierAccumulator,
    authorCount: number,
    cleanMetrics: { commits30Days: number; defectCount: number },
    maxCap: number,
): { developerCongestion: boolean; coordinationPaths: number } {
    const coordinationPaths = authorCount >= 2 ? (authorCount * (authorCount - 1)) / 2 : 0;
    let developerCongestion = false;
    if (authorCount >= 4 && cleanMetrics.commits30Days >= 8) {
        developerCongestion = true;
        acc.effectiveMultiplier = +Math.min(maxCap, acc.effectiveMultiplier * 1.15).toFixed(2);
        acc.annotations.push(
            `[DEVELOPER CONGESTION: Elevated coordination friction with ${authorCount} active authors and ${coordinationPaths} communication channels]`,
        );
    }
    return { developerCongestion, coordinationPaths };
}

function computeEvolutionModifiers(
    baseMultiplier: number,
    input: FileHotspotInput,
    cleanMetrics: { commits30Days: number; defectCount: number },
    maxCap: number,
): EvolutionModifierState {
    const acc: ModifierAccumulator = {
        effectiveMultiplier: baseMultiplier,
        annotations: [],
    };

    const { burstSpike, churnAcceleration } = evaluateBurstSpike(acc, input, cleanMetrics, maxCap);
    const authorDiffusion = evaluateAuthorDiffusion(acc, input, cleanMetrics, maxCap);
    const { rapidDecay, decayVelocity } = evaluateRapidDecay(acc, churnAcceleration, cleanMetrics, maxCap);

    const authorCount = sanitizeNonNegative(input.activeAuthorsCount);
    const { developerCongestion, coordinationPaths } = evaluateDeveloperCongestion(
        acc,
        authorCount,
        cleanMetrics,
        maxCap,
    );

    return {
        effectiveMultiplier: acc.effectiveMultiplier,
        burstSpike,
        churnAcceleration,
        authorDiffusion,
        decayVelocity,
        rapidDecay,
        developerCongestion,
        activeAuthorsCount: authorCount,
        coordinationPaths,
        annotations: acc.annotations,
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
     */
    public calculateActivityScore(commits30Days: number, churnLines?: number): number {
        const safeCommits = sanitizeNonNegative(commits30Days);
        const safeChurn = sanitizeNonNegative(churnLines);

        if (safeCommits === 0 && safeChurn === 0) {
            return 0.0;
        }

        const commitSaturation = safeCommits / (safeCommits + this.activityHalfPoint);
        if (safeChurn > 0) {
            const churnSaturation = safeChurn / (safeChurn + CHURN_LINES_HALF_POINT);
            return +(0.7 * commitSaturation + 0.3 * churnSaturation).toFixed(4);
        }

        return +commitSaturation.toFixed(4);
    }

    /**
     * Compute normalized static debt score [0.0, 1.0] from CC, ELOC, and defect count.
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

        const totalWeight = this.weightComplexity + this.weightEloc + this.weightDefects || 1.0;
        const weightedDebt =
            (this.weightComplexity * normCc +
                this.weightEloc * normEloc +
                this.weightDefects * normDefects) /
            totalWeight;

        return +Math.min(1.0, Math.max(0.0, weightedDebt)).toFixed(4);
    }

    /**
     * Calculate composite Hotspot score [0.0, 100.0] as the intersection of activity and debt.
     */
    public calculateHotspotScore(input: FileHotspotInput): number {
        if (!input || typeof input !== 'object') {
            return 0.0;
        }

        const activityScore = this.calculateActivityScore(input.commits30Days, input.churnLines);
        if (activityScore <= 0.0) {
            return 0.0;
        }

        const debtScore = this.calculateStaticDebtScore(
            input.cyclomaticComplexity,
            input.eloc,
            input.defectCount,
        );

        // CodeScene Hotspot principle: Activity x Static Debt
        const rawScore = 100.0 * Math.pow(activityScore, 0.8) * debtScore;
        return +Math.min(100.0, Math.max(0.0, rawScore)).toFixed(1);
    }

    /**
     * Calculate technical debt compounding interest multiplier [1.0, maxCap].
     * Represents recurring maintenance tax paid on each change.
     */
    public calculateInterestMultiplier(input: FileHotspotInput): number {
        if (!input || typeof input !== 'object') {
            return 1.0;
        }

        const activityScore = this.calculateActivityScore(input.commits30Days, input.churnLines);
        if (activityScore <= 0.0) {
            return 1.0;
        }

        const debtScore = this.calculateStaticDebtScore(
            input.cyclomaticComplexity,
            input.eloc,
            input.defectCount,
        );

        const spread = Math.max(0.0, this.maxInterestMultiplier - 1.0);
        const multiplier = 1.0 + spread * (activityScore * debtScore);
        return +Math.min(this.maxInterestMultiplier, Math.max(1.0, multiplier)).toFixed(2);
    }

    /**
     * Evaluate single file hotspot metrics with ranking defaulted to 1.
     */
    public evaluateSingle(input: FileHotspotInput): HotspotEvaluationResult {
        if (!input || typeof input !== 'object' || typeof input.filePath !== 'string') {
            return this.createDefaultResult(input?.filePath || 'unknown');
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

        const mod = computeEvolutionModifiers(
            interestMultiplier,
            input,
            cleanMetrics,
            this.maxInterestMultiplier,
        );

        const recommendation = resolveHotspotRecommendation(severity, cleanMetrics);
        for (let i = 0; i < mod.annotations.length; i++) {
            recommendation.summary += ' ' + mod.annotations[i];
        }

        return {
            filePath: input.filePath,
            hotspotScore,
            interestMultiplier: mod.effectiveMultiplier,
            rank: 1,
            severity,
            burstSpike: mod.burstSpike,
            churnAcceleration: mod.churnAcceleration,
            decayVelocity: mod.decayVelocity,
            rapidDecay: mod.rapidDecay,
            authorEntropy: input.authorEntropy,
            authorDiffusion: mod.authorDiffusion,
            activeAuthorsCount: mod.activeAuthorsCount,
            coordinationPaths: mod.coordinationPaths,
            developerCongestion: mod.developerCongestion,
            metrics: cleanMetrics,
            recommendation,
        };
    }

    /**
     * Evaluate a batch of files and compute relative Hotspot rankings (rank 1 = hottest).
     */
    public evaluateBatch(inputs: FileHotspotInput[]): HotspotEvaluationResult[] {
        if (!Array.isArray(inputs) || inputs.length === 0) {
            return [];
        }

        const results: HotspotEvaluationResult[] = [];
        for (const input of inputs) {
            results.push(this.evaluateSingle(input));
        }

        // Sort descending: highest hotspot score first;
        // tiebreak by interest multiplier then commits
        results.sort((a, b) => {
            if (b.hotspotScore !== a.hotspotScore) {
                return b.hotspotScore - a.hotspotScore;
            }
            if (b.interestMultiplier !== a.interestMultiplier) {
                return b.interestMultiplier - a.interestMultiplier;
            }
            if (b.metrics.commits30Days !== a.metrics.commits30Days) {
                return b.metrics.commits30Days - a.metrics.commits30Days;
            }
            return a.filePath.localeCompare(b.filePath);
        });

        // Assign ordinal ranks
        for (let i = 0; i < results.length; i++) {
            results[i].rank = i + 1;
        }

        return results;
    }

    /**
     * Evaluate hotspot status from GitFileHistoryProfiles paired with static code metrics.
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
                cyclomaticComplexity: 1,
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
     * Count distinct active authors contributing within the 30-day window.
     */
    public extractActiveAuthorsFromProfile(profile: GitFileHistoryProfile): number {
        if (!profile || !profile.isGitAvailable) {
            return 0;
        }
        if (Array.isArray(profile.recentCommits) && profile.recentCommits.length > 0) {
            const cutoffTimestamp = this.nowTimestamp - WINDOW_30_DAYS_MS;
            const activeSet = new Set<string>();
            for (const commit of profile.recentCommits) {
                if (commit.timestamp >= cutoffTimestamp && commit.author) {
                    activeSet.add(commit.author);
                }
            }
            if (activeSet.size > 0) {
                return activeSet.size;
            }
        }
        if (profile.authorCommitCounts && typeof profile.authorCommitCounts === 'object') {
            return Object.keys(profile.authorCommitCounts).length;
        }
        return 0;
    }

    /**
     * Produce safe baseline Hotspot evaluation result for unversioned or degraded environments.
     */
    public createDefaultResult(filePath: string): HotspotEvaluationResult {
        return {
            filePath,
            hotspotScore: 0.0,
            interestMultiplier: 1.0,
            rank: 1,
            severity: 'low',
            decayVelocity: 1.0,
            rapidDecay: false,
            developerCongestion: false,
            activeAuthorsCount: 0,
            coordinationPaths: 0,
            metrics: {
                commits30Days: 0,
                churnLines: 0,
                eloc: 0,
                cyclomaticComplexity: 0,
                defectCount: 0,
            },
            recommendation: {
                action: 'monitor',
                summary:
                    'Baseline status; insufficient behavioral or complexity history available.',
            },
        };
    }
}
