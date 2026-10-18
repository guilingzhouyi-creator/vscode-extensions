import { describe, it, expect } from 'vitest';
import type { Issue } from '../../../src/core/types';
import {
    resolveIssueRemediationMinutes,
    resolveSqaleGrade,
    evaluateTechnicalDebtAssessment,
    DEFAULT_DEV_MINUTES_PER_ELOC,
} from '../../../src/core/scoring/technical-debt-ratio';

describe('SQALE Technical Debt Ratio Engine', () => {
    describe('resolveIssueRemediationMinutes', () => {
        it('should assign higher effort for security issues than naming issues', () => {
            const secIssue: Issue = {
                id: 'security:SEC-VUL-001:test.ts:1',
                analyzer: 'security',
                rule: 'SEC-VUL-001',
                severity: 'error',
                message: 'Vulnerability',
            };
            const namIssue: Issue = {
                id: 'naming:NAM-DEC-001:test.ts:10',
                analyzer: 'naming',
                rule: 'NAM-DEC-001',
                severity: 'warning',
                message: 'Naming issue',
            };

            const secMinutes = resolveIssueRemediationMinutes(secIssue);
            const namMinutes = resolveIssueRemediationMinutes(namIssue);

            expect(secMinutes).toBeGreaterThan(namMinutes);
            expect(secMinutes).toBeGreaterThanOrEqual(45);
            expect(namMinutes).toBeLessThanOrEqual(5);
        });

        it('should respect custom rule cost override', () => {
            const issue: Issue = {
                id: 'cpx:CPX-HOP-001:test.ts:5',
                analyzer: 'complexity',
                rule: 'CPX-HOP-001',
                severity: 'warning',
                message: 'Hop penalty',
            };
            const customCost = { 'CPX-HOP-001': 40 };
            const minutes = resolveIssueRemediationMinutes(issue, customCost);
            expect(minutes).toBe(40);
        });
    });

    describe('resolveSqaleGrade', () => {
        it('should assign A for debt ratio <= 5%', () => {
            expect(resolveSqaleGrade(0.01)).toBe('A');
            expect(resolveSqaleGrade(0.05)).toBe('A');
        });

        it('should assign B for debt ratio between 5% and 10%', () => {
            expect(resolveSqaleGrade(0.06)).toBe('B');
            expect(resolveSqaleGrade(0.10)).toBe('B');
        });

        it('should assign C for debt ratio between 10% and 20%', () => {
            expect(resolveSqaleGrade(0.15)).toBe('C');
            expect(resolveSqaleGrade(0.20)).toBe('C');
        });

        it('should assign D for debt ratio between 20% and 50%', () => {
            expect(resolveSqaleGrade(0.25)).toBe('D');
            expect(resolveSqaleGrade(0.50)).toBe('D');
        });

        it('should assign E for debt ratio > 50%', () => {
            expect(resolveSqaleGrade(0.55)).toBe('E');
            expect(resolveSqaleGrade(1.20)).toBe('E');
        });
    });

    describe('evaluateTechnicalDebtAssessment', () => {
        it('should compute exact hours, days, TDR and pillar distribution', () => {
            const issues: Issue[] = [
                {
                    id: 'sec:SEC-001',
                    analyzer: 'security',
                    rule: 'SEC-VUL-001',
                    severity: 'error',
                    message: 'High severity security flaw',
                },
                {
                    id: 'cpx:CPX-001',
                    analyzer: 'complexity',
                    rule: 'CPX-CC-001',
                    severity: 'warning',
                    message: 'High cyclomatic complexity',
                },
            ];

            const eloc = 500;
            const assessment = evaluateTechnicalDebtAssessment(issues, eloc);

            expect(assessment.totalRemediationMinutes).toBeGreaterThan(0);
            expect(assessment.totalRemediationHours).toBeCloseTo(assessment.totalRemediationMinutes / 60, 2);
            expect(assessment.totalRemediationDays).toBeCloseTo(assessment.totalRemediationHours / 8, 2);
            expect(assessment.developmentCostMinutes).toBe(500 * DEFAULT_DEV_MINUTES_PER_ELOC);
            expect(assessment.technicalDebtRatio).toBeLessThan(0.05);
            expect(assessment.sqaleGrade).toBe('A');
            expect(assessment.effortByPillar.security).toBeGreaterThan(0);
            expect(assessment.effortByPillar.performance).toBeGreaterThanOrEqual(0);
        });
    });
});
