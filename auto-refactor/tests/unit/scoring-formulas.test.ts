/**
 * Module: Unit Tests — Quality Scoring Formulas
 * File Path: tests/unit/scoring-formulas.test.ts
 * Architecture Role: Locks the quantitative behaviour of the ten-dimension scoring model:
 *     the reciprocal density curve (strict monotonicity, no hard floor at zero), the inverse
 *     used for report recomputability, composite-score aggregation and weight validation,
 *     grade cut-offs, and rule-family routing.
 * Test Type: Unit test (pure math + dimension routing)
 */
import { describe, it, expect } from 'vitest';
import {
    DIMENSION_MAX_SCORE,
    SATURATION_HALFPOINT,
    applyScaleDampedScores,
    computeCompositeScore,
    effectivePenaltyFromIndex,
    isMeasured,
    resolveQualityGrade,
    scoreDelta,
} from '../../src/core/scoring/scorer-formulas';
import {
    ALL_QUALITY_DIMENSIONS,
    DIMENSION_SCALE_MODE,
    DEFAULT_QUALITY_WEIGHTS,
} from '../../src/core/scoring/scoringTypes';
import { familyDimensionOf } from '../../src/core/scoring/dimensionDeductions';
import type { QualityDimension, QualityWeights } from '../../src/core/scoring/scoringTypes';

/** Build a deduction record where only the named dimension carries points. */
function deductionsOf(
    points: Partial<Record<QualityDimension, number>>,
): Record<QualityDimension, number> {
    const record = {} as Record<QualityDimension, number>;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
        record[dim] = points[dim] ?? 0;
    }
    return record;
}

/** Uniform weights so composite assertions stay about the aggregation, not the weights. */
const UNIFORM_WEIGHTS: QualityWeights = Object.fromEntries(
    ALL_QUALITY_DIMENSIONS.map((dim) => [dim, 1]),
) as QualityWeights;

describe('density index curve', () => {
    it('scores a dimension with no findings at the ceiling', () => {
        const scores = applyScaleDampedScores(deductionsOf({}), 5);
        expect(scores.duplication).toBe(DIMENSION_MAX_SCORE);
    });

    it('places the half-point exactly at the declared saturation constant', () => {
        const scores = applyScaleDampedScores(
            deductionsOf({ duplication: SATURATION_HALFPOINT * 4 }),
            4,
        );
        // density === SATURATION_HALFPOINT, so the index must land on 50.
        expect(scores.duplication).toBeCloseTo(50, 10);
    });

    it('decreases strictly monotonically as density rises', () => {
        let previous = Number.POSITIVE_INFINITY;
        for (let density = 0.5; density <= 4000; density *= 1.05) {
            const index = applyScaleDampedScores(
                deductionsOf({ maintainability: density * 4 }),
                4,
            ).maintainability;
            expect(index).toBeLessThan(previous);
            previous = index;
        }
    });

    it('never hard-clamps to zero, so extreme cases stay ordered', () => {
        // The regression this guards: the previous exponential form applied
        // min(rawPoints, ...), collapsing every density past ~240 to exactly 0.
        const extreme = applyScaleDampedScores(
            deductionsOf({ techDebtRisk: 24840 }),
            5,
        ).techDebtRisk;
        const heavy = applyScaleDampedScores(deductionsOf({ techDebtRisk: 1230 }), 5).techDebtRisk;

        expect(extreme).toBeGreaterThan(0);
        expect(heavy).toBeGreaterThan(0);
        // 24840 points is ~20x the severity of 1230 and must remain distinguishable.
        expect(heavy).toBeGreaterThan(extreme);
    });

    it('stays strictly below the ceiling for any positive density', () => {
        for (const points of [0.001, 1, 15, 100, 1e4, 1e9]) {
            const index = applyScaleDampedScores(
                deductionsOf({ maintainability: points }),
                4,
            ).maintainability;
            expect(index).toBeGreaterThan(0);
            expect(index).toBeLessThan(DIMENSION_MAX_SCORE);
        }
    });
});

describe('index inverse (report recomputability)', () => {
    it('reconciles the published index back to its effective penalty', () => {
        // This is the contract the report relies on: a consumer that has only the
        // breakdown must be able to re-derive every index from effectivePoints.
        for (const density of [0.5, 12.5, 30, 96, 480, 3000, 1e5]) {
            const index = applyScaleDampedScores(
                deductionsOf({ duplication: density * 4 }),
                4,
            ).duplication;
            const effective = effectivePenaltyFromIndex(index);
            expect(DIMENSION_MAX_SCORE - effective).toBeCloseTo(index, 6);
        }
    });

    it('clamps an out-of-range index before reporting a penalty', () => {
        // A negative index is meaningless; the helper floors it at 0 so the reported
        // penalty can never exceed the ceiling.
        expect(effectivePenaltyFromIndex(-5)).toBe(DIMENSION_MAX_SCORE);
        expect(effectivePenaltyFromIndex(150)).toBe(0);
    });

    it('keeps effectivePoints inside the index range for any density', () => {
        for (const points of [0.001, 1, 15, 100, 1e4, 1e9]) {
            const index = applyScaleDampedScores(
                deductionsOf({ codeSecurity: points }),
                1,
            ).codeSecurity;
            const effective = effectivePenaltyFromIndex(index);
            expect(effective).toBeGreaterThanOrEqual(0);
            expect(effective).toBeLessThanOrEqual(DIMENSION_MAX_SCORE);
        }
    });
});

describe('dimension scale modes', () => {
    it('declares security absolute and every other dimension density-scaled', () => {
        expect(DIMENSION_SCALE_MODE.codeSecurity).toBe('absolute');
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            if (dim === 'codeSecurity') continue;
            expect(DIMENSION_SCALE_MODE[dim]).toBe('density');
        }
    });

    it('leaves the absolute mode unscaled by file size', () => {
        const small = applyScaleDampedScores(deductionsOf({ codeSecurity: 30 }), 1).codeSecurity;
        const large = applyScaleDampedScores(deductionsOf({ codeSecurity: 30 }), 20).codeSecurity;
        expect(small).toBe(large);
    });

    it('dampens density-scaled dimensions by file size', () => {
        const small = applyScaleDampedScores(
            deductionsOf({ maintainability: 30 }),
            1,
        ).maintainability;
        const large = applyScaleDampedScores(
            deductionsOf({ maintainability: 30 }),
            5,
        ).maintainability;
        expect(large).toBeGreaterThan(small);
    });
});

describe('composite score', () => {
    it('weights the composite over the evaluated dimensions only', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        scores.duplication = 40;
        const { compositeScore, coverage } = computeCompositeScore(
            scores,
            ALL_QUALITY_DIMENSIONS,
            UNIFORM_WEIGHTS,
        );
        expect(coverage).toBe(1);
        // Weighted geometric mean of nine 100s and one 40: 100 * (0.4)^(1/10) = 91.2.
        // The arithmetic mean would have reported 94, so the weaker axis costs more here.
        expect(compositeScore).toBeCloseTo(91.2, 1);
    });

    it('renormalizes when a dimension was not measured', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        scores.duplication = 0;
        const evaluated = ALL_QUALITY_DIMENSIONS.filter((d) => d !== 'duplication');
        const { compositeScore, coverage } = computeCompositeScore(
            scores,
            evaluated,
            UNIFORM_WEIGHTS,
        );
        expect(coverage).toBeCloseTo(0.9, 5);
        expect(compositeScore).toBe(DIMENSION_MAX_SCORE);
    });

    it('rejects a negative weight instead of silently producing a skewed score', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        const weights = { ...UNIFORM_WEIGHTS, codeSecurity: -1 };
        expect(() => computeCompositeScore(scores, ALL_QUALITY_DIMENSIONS, weights)).toThrow(
            RangeError,
        );
    });

    it('rejects a non-finite weight', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        const weights = { ...UNIFORM_WEIGHTS, maintainability: Number.NaN };
        expect(() => computeCompositeScore(scores, ALL_QUALITY_DIMENSIONS, weights)).toThrow(
            RangeError,
        );
    });

    it('rejects an all-zero weight set rather than reporting grade F for missing data', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        const zeroed = Object.fromEntries(
            ALL_QUALITY_DIMENSIONS.map((dim) => [dim, 0]),
        ) as QualityWeights;
        expect(() => computeCompositeScore(scores, ALL_QUALITY_DIMENSIONS, zeroed)).toThrow(
            RangeError,
        );
    });

    it('reports no score rather than a failing one when nothing was measured', () => {
        // A narrow scan (e.g. only the simplify analyzer) witnesses none of the ten axes.
        // Coercing that to 0 and grading it F would report missing data as a bad verdict.
        const { compositeScore, coverage } = computeCompositeScore(
            deductionsOf({}),
            [],
            UNIFORM_WEIGHTS,
        );
        expect(Number.isNaN(compositeScore)).toBe(true);
        expect(coverage).toBe(0);
        expect(resolveQualityGrade(compositeScore)).toBe('N/A');
    });
});

describe('composite aggregation guards a weak axis', () => {
    it('penalizes one collapsed axis more than an arithmetic mean would', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        scores.duplication = 0;
        const { compositeScore } = computeCompositeScore(
            scores,
            ALL_QUALITY_DIMENSIONS,
            UNIFORM_WEIGHTS,
        );
        // Arithmetic mean would report 90 and read as near-perfect. The geometric mean is
        // bounded by the weakest axis, so the collapse has to register.
        expect(compositeScore).toBeLessThan(90);
        expect(compositeScore).toBeGreaterThan(50);
    });

    it('keeps the composite at the ceiling when every axis is clean', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = DIMENSION_MAX_SCORE;
        }
        const { compositeScore } = computeCompositeScore(
            scores,
            ALL_QUALITY_DIMENSIONS,
            UNIFORM_WEIGHTS,
        );
        expect(compositeScore).toBe(DIMENSION_MAX_SCORE);
    });

    it('stays within (0, 100] for any index mix', () => {
        for (const low of [0, 1, 10, 50, 99]) {
            const scores = deductionsOf({});
            for (const dim of ALL_QUALITY_DIMENSIONS) {
                scores[dim] = DIMENSION_MAX_SCORE;
            }
            scores.duplication = low;
            const { compositeScore } = computeCompositeScore(
                scores,
                ALL_QUALITY_DIMENSIONS,
                UNIFORM_WEIGHTS,
            );
            expect(compositeScore).toBeGreaterThan(0);
            expect(compositeScore).toBeLessThanOrEqual(DIMENSION_MAX_SCORE);
        }
    });

    it('is invariant to a uniform rescaling of the weights', () => {
        const scores = deductionsOf({});
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            scores[dim] = 80 + (dim.length % 7);
        }
        const scaled = Object.fromEntries(
            ALL_QUALITY_DIMENSIONS.map((dim) => [dim, UNIFORM_WEIGHTS[dim] * 3.7]),
        ) as QualityWeights;
        const base = computeCompositeScore(scores, ALL_QUALITY_DIMENSIONS, UNIFORM_WEIGHTS);
        const grown = computeCompositeScore(scores, ALL_QUALITY_DIMENSIONS, scaled);
        expect(grown.compositeScore).toBeCloseTo(base.compositeScore, 5);
        expect(grown.coverage).toBeCloseTo(base.coverage, 5);
    });
});

describe('unmeasured score guards', () => {
    it('treats NaN as unmeasured rather than as a zero', () => {
        // NaN is not 0: every comparison against it is false, so unguarded arithmetic
        // silently falls through to its default branch instead of reporting a real value.
        expect(isMeasured(Number.NaN)).toBe(false);
        expect(isMeasured(0)).toBe(true);
        expect(isMeasured(95.2)).toBe(true);
        expect(isMeasured(Number.POSITIVE_INFINITY)).toBe(false);
    });

    it('returns null from scoreDelta when either side is unmeasured', () => {
        expect(scoreDelta(90, 92)).toBe(2);
        expect(scoreDelta(Number.NaN, 92)).toBeNull();
        expect(scoreDelta(90, Number.NaN)).toBeNull();
        expect(scoreDelta(Number.NaN, Number.NaN)).toBeNull();
    });

    it('never lets a NaN delta masquerade as no change', () => {
        // The arithmetic that produced this bug: NaN - x is NaN, and every threshold test on
        // NaN is false, so a neutral verdict was returned for a patch nobody measured.
        const unguarded = Number.NaN - 90;
        expect(Number.isFinite(unguarded)).toBe(false);
        expect(unguarded > 0.5).toBe(false);
        expect(unguarded < -0.5).toBe(false);

        expect(scoreDelta(Number.NaN, 90)).toBeNull();
    });
});

describe('default weight set', () => {
    it('sums to one so weights are comparable across scoring surfaces', () => {
        let sum = 0;
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            sum += DEFAULT_QUALITY_WEIGHTS[dim];
        }
        expect(sum).toBeCloseTo(1, 6);
    });

    it('keeps every weight positive so no axis can be silenced by default', () => {
        for (const dim of ALL_QUALITY_DIMENSIONS) {
            expect(DEFAULT_QUALITY_WEIGHTS[dim]).toBeGreaterThan(0);
        }
    });

    it('ranks security above comment quality, matching the stated priority', () => {
        expect(DEFAULT_QUALITY_WEIGHTS.codeSecurity).toBeGreaterThan(
            DEFAULT_QUALITY_WEIGHTS.commentQuality,
        );
    });
});

describe('grade resolution', () => {
    it('places each band boundary on the inclusive side', () => {
        expect(resolveQualityGrade(100)).toBe('A+');
        expect(resolveQualityGrade(90)).toBe('A+');
        expect(resolveQualityGrade(89.9)).toBe('A');
        expect(resolveQualityGrade(80)).toBe('A');
        expect(resolveQualityGrade(79.9)).toBe('B');
        expect(resolveQualityGrade(70)).toBe('B');
        expect(resolveQualityGrade(69.9)).toBe('C');
        expect(resolveQualityGrade(60)).toBe('C');
        expect(resolveQualityGrade(59.9)).toBe('D');
        expect(resolveQualityGrade(50)).toBe('D');
        expect(resolveQualityGrade(49.9)).toBe('F');
        expect(resolveQualityGrade(0)).toBe('F');
    });

    it('is monotonic across the whole range', () => {
        const order = ['F', 'D', 'C', 'B', 'A', 'A+'];
        let previous = -1;
        for (let score = 0; score <= 100; score += 0.5) {
            const rank = order.indexOf(resolveQualityGrade(score));
            expect(rank).toBeGreaterThanOrEqual(previous);
            previous = rank;
        }
    });
});

describe('rule family routing', () => {
    it('routes a family-prefixed rule to its declared dimension', () => {
        expect(familyDimensionOf('ARCH-LEAK-001')).toBe('architectureConsistency');
        expect(familyDimensionOf('GOV-PRF-001')).toBe('performanceEfficiency');
        expect(familyDimensionOf('CPX-NEST-001')).toBe('maintainability');
    });

    it('matches a bare family id that carries no trailing segment', () => {
        // Regression: the prefix test required a trailing '-', so a bare family id
        // silently fell through to techDebtRisk instead of its declared owner.
        expect(familyDimensionOf('ARCH')).toBe('architectureConsistency');
        expect(familyDimensionOf('CPX-NEST')).toBe('maintainability');
    });

    it('routes a family to the same axis the deduction table charges it to', () => {
        // These three disagreed with DIMENSION_RULES and double-charged one finding
        // across two axes; scripts/validate-dimension-consistency.js now guards all 243.
        expect(familyDimensionOf('GOV-TYP-001')).toBe('semanticPurity');
        expect(familyDimensionOf('TST-TOP-001')).toBe('maintainability');
        expect(familyDimensionOf('CPX-STM-001')).toBe('maintainability');
    });

    it('prefers the longest matching family over a shorter overlapping one', () => {
        // 'ARCH-HDL' must win over the bare 'ARCH' entry for the same dimension family.
        expect(familyDimensionOf('ARCH-HDL-001')).toBe('architectureConsistency');
        expect(familyDimensionOf('CPX-REC-001')).toBe('maintainability');
    });

    it('returns null for an unrouted or empty rule instead of throwing', () => {
        expect(familyDimensionOf('')).toBeNull();
        expect(familyDimensionOf('ZZZ-UNKNOWN-999')).toBeNull();
        expect(familyDimensionOf(undefined as unknown as string)).toBeNull();
    });
});
