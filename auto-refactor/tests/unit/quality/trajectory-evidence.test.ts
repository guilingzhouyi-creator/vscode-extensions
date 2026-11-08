/**
 * Module: Trajectory measurement evidence regression tests
 * File Path: tests/unit/quality/trajectory-evidence.test.ts
 * Architecture Role: Preserve unknown observations through the public learning API.
 * Dependencies & Triggers: Vitest, the learning service, and score contract fixtures.
 * Responsibilities: Verify measured deltas, absent measurements, and unvalidated generalization.
 * Exit Semantics & Design Rationale: Text changes alone must never create positive quality evidence.
 */
import { describe, expect, it } from 'vitest';
import { TrajectoryRecipeExtractor } from '../../../src/core/trajectory/recipeExtractor';
import { PraxisTrajectoryLearningService } from '../../../src/core/praxis/trajectoryLearningService';
import type { PraxisTrajectoryLearningInput } from '../../../src/core/trajectory/recipeTypes';
import type { QualityScoreBreakdown } from '../../../src/core/scoring/scoringTypes';

const input: PraxisTrajectoryLearningInput = {
    trajectoryId: 'quality-evidence-example',
    filePath: 'src/example.ts',
    beforeContent: 'export const value = 1;\n',
    afterContent: 'export const value = 2;\n',
    language: 'typescript',
};

function score(compositeScore: number): QualityScoreBreakdown {
    return { compositeScore } as QualityScoreBreakdown;
}

describe('trajectory learning measurement evidence', () => {
    const transformation = {
        ...input,
        beforeContent:
            'function render(width: number, height: number, theme: string, animate: boolean) { return width; }',
        afterContent:
            'interface RenderOptions { width: number; height: number; theme: string; animate: boolean }\nfunction render(options: RenderOptions) { return options.width; }',
    };

    it('does not synthesize a scored recipe without a measured improvement', () => {
        const extractor = new TrajectoryRecipeExtractor();
        const candidate = extractor.extractRecipeFromTrajectory(transformation);
        expect(candidate?.expectedQualityGain).toBeNull();
        expect(candidate?.qualityGain.status).toBe('unmeasured');
        expect(
            extractor.extractRecipeFromTrajectory({
                ...transformation,
                beforeScore: score(50),
                afterScore: score(50),
            }),
        ).toBeUndefined();
    });

    it('preserves a small measured gain without raising it to a minimum', () => {
        const recipe = new TrajectoryRecipeExtractor().extractRecipeFromTrajectory({
            ...transformation,
            beforeScore: score(50),
            afterScore: score(51),
        });
        expect(recipe?.expectedQualityGain).toBe(1);
    });

    it('does not invent improvement when both scores are absent', async () => {
        const result = await new PraxisTrajectoryLearningService().learnFromTrajectory(input);
        expect(result.qualityDelta).toBeNull();
        expect(result.qualityVelocity).toBeNull();
        expect(result.hasBadToGoodImprovement).toBe(false);
    });

    it('keeps a one-sided measurement unknown', async () => {
        const result = await new PraxisTrajectoryLearningService().learnFromTrajectory({
            ...input,
            afterScore: score(90),
        });
        expect(result.qualityDelta).toBeNull();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects non-finite scoring input %s as unmeasured',
        async (invalid) => {
            const result = await new PraxisTrajectoryLearningService().learnFromTrajectory({
                ...input,
                beforeScore: score(invalid),
                afterScore: score(90),
            });
            expect(result.qualityDelta).toBeNull();
            expect(result.qualityVelocity).toBeNull();
            expect(result.hasBadToGoodImprovement).toBe(false);
            expect(result.measurements.qualityDelta.status).toBe('failed');
            expect(result.measurements.qualityVelocity.status).toBe('failed');
        },
    );

    it.each([
        [70, 90, 20],
        [90, 70, -20],
        [80, 80, 0],
    ])('preserves measured change from %s to %s', async (before, after, expected) => {
        const result = await new PraxisTrajectoryLearningService().learnFromTrajectory({
            ...input,
            beforeScore: score(before),
            afterScore: score(after),
        });
        expect(result.qualityDelta).toBe(expected);
    });

    it('does not publish a generalization measurement without validation samples', async () => {
        const result = await new PraxisTrajectoryLearningService().learnFromTrajectory(input);
        expect(result.generalizationIndex).toBeNull();
    });
});
