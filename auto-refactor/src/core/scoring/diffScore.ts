/**
 * Module: Core Engine - Diff-Level Quality Scoring (quantified standard, diff layer)
 * File Path: src/core/scoring/diffScore.ts
 * Architecture Role: The diff-layer half of the quantified standard: `qualityScorer` grades a
 *     repository snapshot, while this module grades a CHANGE by consuming the B7 incremental
 *     metrics (effective LOC / complexity proxy / coupling / duplication) and expressing them in
 *     the same ten quality dimensions, so "good architecture / good performance" has one language
 *     for both snapshots and edits
 * Dependencies & Triggers: `computeIncrementalMetrics` from ../intelligence/incrementalMetrics and
 *     `QualityDimension` from ./scoringTypes; called by consumers that hold before/after content
 *     (the consumer runner's coupling gate) and exported through `api.ts`
 * Responsibilities: Convert each incremental metric into dimension deltas with published,
 *     config-driven per-unit weights; keep the B7 verdict as the authoritative pass/fail signal;
 *     and return the formulas so a reviewer can re-derive every delta
 * Exit Semantics & Design Rationale: Pure function over two strings - no I/O, no throwing beyond
 *     what `computeIncrementalMetrics` already documents, deterministic. Deltas are signed so a
 *     negative value always means "this dimension got worse"; the module deliberately does NOT
 *     re-decide the verdict (the gate stays a single source in B7) and it does not invent a score
 *     for dimensions the diff cannot observe - only the four dimensions the metrics can speak
 *     about are emitted, which is why the return type is a partial record.
 */
import {
    computeIncrementalMetrics,
    type IncrementalMetrics,
    type IncrementalOptions,
} from '../intelligence/incrementalMetrics';
import type { QualityDimension } from './scoringTypes';

/** Per-unit weights turning incremental metrics into dimension deltas (points, signed). */
export interface DiffScoreWeights {
    /** Points lost per unit of coupling growth (default 2). */
    couplingPerUnit: number;
    /** Points lost per line of effective-LOC growth; compression earns the same rate (default
        0.5). */
    effectiveLocPerLine: number;
    /** Points lost per unit of complexity-proxy growth (default 3). */
    complexityPerUnit: number;
    /** Points lost per duplicated line growth (default 1). */
    duplicationPerLine: number;
}

/** Options for the diff-layer scoring. */
export interface DiffScoreOptions extends IncrementalOptions {
    /** Optional per-unit weight overrides. */
    weights?: Partial<DiffScoreWeights>;
}

/** Result of grading a change against the quantified standard. */
export interface DiffScore {
    /** The underlying incremental metrics (single source of numeric truth). */
    metrics: IncrementalMetrics;
    /** Signed dimension deltas: negative means the dimension got worse. */
    dimensionDeltas: Partial<Record<QualityDimension, number>>;
    /** Human-readable rationale per emitted dimension. */
    rationale: string[];
    /** Verdict copied from the B7 gate, not re-decided here. */
    verdict: IncrementalMetrics['verdict'];
    /** Published formulas and applied weights, so every delta can be re-derived. */
    formulas: {
        architectureConsistency: string;
        performanceEfficiency: string;
        maintainability: string;
        duplication: string;
        weights: DiffScoreWeights;
    };
}

/** Default weights; document any change here so the published formula stays meaningful. */
const DEFAULT_WEIGHTS: DiffScoreWeights = {
    couplingPerUnit: 2,
    effectiveLocPerLine: 0.5,
    complexityPerUnit: 3,
    duplicationPerLine: 1,
};

/** Round dimension deltas to one decimal, matching the snapshot scorer's precision. */
const DELTA_SCALE = 10;

/**
 * Round a signed delta to the shared precision.
 *
 * @param value - Raw delta.
 * @returns The rounded delta.
 */
function roundDelta(value: number): number {
    return Math.round(value * DELTA_SCALE) / DELTA_SCALE;
}

/**
 * Grade a change with the same dimensions the snapshot scorer uses.
 *
 * @param oldContent - Original file content.
 * @param newContent - Modified file content.
 * @param options - Gate options forwarded to B7 plus optional weight overrides.
 * @returns Dimension deltas, rationale, the B7 verdict and the published formulas.
 */
export function scoreDiff(
    oldContent: string,
    newContent: string,
    options: DiffScoreOptions = {},
): DiffScore {
    const metrics = computeIncrementalMetrics(
        oldContent,
        newContent,
        options.maxCouplingDelta === undefined
            ? {}
            : { maxCouplingDelta: options.maxCouplingDelta },
    );
    const weights: DiffScoreWeights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };

    const architectureDelta = roundDelta(-metrics.couplingDelta * weights.couplingPerUnit);
    const performanceDelta = roundDelta(-metrics.complexityDelta * weights.complexityPerUnit);
    const maintainabilityDelta = roundDelta(
        -metrics.effectiveLocDelta * weights.effectiveLocPerLine,
    );
    const duplicationDelta = roundDelta(-metrics.duplicationDelta * weights.duplicationPerLine);

    const dimensionDeltas: Partial<Record<QualityDimension, number>> = {
        architectureConsistency: architectureDelta,
        performanceEfficiency: performanceDelta,
        maintainability: maintainabilityDelta,
        duplication: duplicationDelta,
    };
    const rationale = [
        `architectureConsistency ${architectureDelta} from couplingDelta ${metrics.couplingDelta}`,
        `performanceEfficiency ${performanceDelta} from complexityDelta ${metrics.complexityDelta}`,
        `maintainability ${maintainabilityDelta} from effectiveLocDelta
            ${metrics.effectiveLocDelta}`,
        `duplication ${duplicationDelta} from duplicationDelta ${metrics.duplicationDelta}`,
    ];

    return {
        metrics,
        dimensionDeltas,
        rationale,
        verdict: metrics.verdict,
        formulas: {
            architectureConsistency: `-couplingDelta * ${weights.couplingPerUnit}`,
            performanceEfficiency: `-complexityDelta * ${weights.complexityPerUnit}`,
            maintainability: `-effectiveLocDelta * ${weights.effectiveLocPerLine}`,
            duplication: `-duplicationDelta * ${weights.duplicationPerLine}`,
            weights,
        },
    };
}
