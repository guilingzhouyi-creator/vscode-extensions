/**
 * Module: Unit Test Suite — Hierarchical Scorer & Dispersion Metrics
 * File Path: tests/unit/scoring/hierarchical-and-dispersion.test.ts
 * Architecture Role: Verifies bottom-up multi-level quality scoring, function-level extraction,
 *   and spatial Popoviciu dispersion metrics across files.
 */

import { describe, it, expect } from 'vitest';
import { scoreFileQuality, aggregateProjectScore } from '../../../src/core/scoring/hierarchicalScorer';
import { QualityScorer } from '../../../src/core/scoring/qualityScorer';
import type { Issue } from '../../../src/core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../../../src/core/types';

describe('Hierarchical Scorer & Project Dispersion Metrics', () => {
    describe('scoreFileQuality with Function Extraction', () => {
        it('extracts function-level quality scores from source content', () => {
            const content = `
export function calculateSum(a: number, b: number): number {
    if (a > 0 && b > 0) {
        return a + b;
    }
    return 0;
}

const multiply = (x: number, y: number) => {
    return x * y;
};
`;
            const fileIssues: Issue[] = [
                {
                    id: 'rule-test-1',
                    analyzer: 'test',
                    rule: 'TST-001',
                    severity: SEVERITY_WARNING,
                    message: 'warning issue',
                    location: {
                        file: 'test.ts',
                        start: { line: 3, column: 5 },
                        end: { line: 3, column: 15 },
                    },
                },
            ];

            const score = scoreFileQuality({
                filePath: 'src/math/test.ts',
                content,
                issues: fileIssues,
                domainName: 'math',
                moduleName: 'arithmetic',
            });

            expect(score.filePath).toBe('src/math/test.ts');
            expect(score.functions.length).toBeGreaterThanOrEqual(1);

            const sumFn = score.functions.find((f) => f.functionName === 'calculateSum');
            expect(sumFn).toBeDefined();
            expect(sumFn!.loc).toBeGreaterThan(0);
            expect(sumFn!.cyclomaticComplexity).toBeGreaterThanOrEqual(2);
            expect(sumFn!.score).toBeLessThanOrEqual(100);
            expect(sumFn!.score).toBeGreaterThan(0);
        });

        it('handles files with no functions gracefully', () => {
            const content = '// Just comments\nconst A = 1;\n';
            const score = scoreFileQuality({
                filePath: 'src/constants.ts',
                content,
                issues: [],
            });
            expect(score.functions).toEqual([]);
        });
    });

    describe('QualityScorer.evaluateProject with Dispersion Metrics', () => {
        it('computes spatial Popoviciu dispersion penalty across disparate file scores', () => {
            const scorer = new QualityScorer();

            const createMockScore = (val: number) => ({
                compositeScore: val,
                indices: {
                    maintainability: val,
                    cyclomaticComplexity: val,
                    cognitiveComplexity: val,
                    nestingDepth: val,
                    structuralDuplication: val,
                    codeSecurity: val,
                    performanceEfficiency: val,
                    architectureConsistency: val,
                    commentCoverage: val,
                    typeStrength: val,
                },
                rationales: [],
            });

            // Simulate 5 files: four scoring 95-98, one scoring 40 (high variance)
            const fileScores: Record<string, any> = {
                'file1.ts': createMockScore(98),
                'file2.ts': createMockScore(96),
                'file3.ts': createMockScore(95),
                'file4.ts': createMockScore(97),
                'file5.ts': createMockScore(40),
            };
            const fileMetrics: any[] = [
                { file: 'file1.ts', lines: 100 },
                { file: 'file2.ts', lines: 100 },
                { file: 'file3.ts', lines: 100 },
                { file: 'file4.ts', lines: 100 },
                { file: 'file5.ts', lines: 100 },
            ];

            const projectBreakdown = scorer.evaluateProject(fileScores, fileMetrics);
            expect(projectBreakdown.dispersionMetrics).toBeDefined();

            const dm = projectBreakdown.dispersionMetrics!;
            expect(dm.mean).toBeCloseTo(85.2, 1);
            expect(dm.standardDeviation).toBeGreaterThan(20);
            expect(dm.penaltyFactor).toBeLessThan(1.0);
            expect(dm.penaltyFactor).toBeGreaterThan(0.5);
            expect(projectBreakdown.formulas?.dispersion).toContain('Popoviciu');
        });

        it('awards near 1.0 dispersion penalty factor for homogeneous file scores', () => {
            const scorer = new QualityScorer();

            const createMockScore = (val: number) => ({
                compositeScore: val,
                indices: {
                    maintainability: val,
                    cyclomaticComplexity: val,
                    cognitiveComplexity: val,
                    nestingDepth: val,
                    structuralDuplication: val,
                    codeSecurity: val,
                    performanceEfficiency: val,
                    architectureConsistency: val,
                    commentCoverage: val,
                    typeStrength: val,
                },
                rationales: [],
            });

            const fileScores: Record<string, any> = {
                'file1.ts': createMockScore(95),
                'file2.ts': createMockScore(96),
                'file3.ts': createMockScore(95),
            };
            const fileMetrics: any[] = [
                { file: 'file1.ts', lines: 100 },
                { file: 'file2.ts', lines: 100 },
                { file: 'file3.ts', lines: 100 },
            ];

            const projectBreakdown = scorer.evaluateProject(fileScores, fileMetrics);
            expect(projectBreakdown.dispersionMetrics).toBeDefined();
            const dm = projectBreakdown.dispersionMetrics!;
            expect(dm.standardDeviation).toBeLessThan(1.0);
            expect(dm.penaltyFactor).toBeCloseTo(1.0, 2);
        });
    });
});
