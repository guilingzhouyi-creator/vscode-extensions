/**
 * Module: Unit Test Suite — Quality Dimension Deductions, Elastic Debt, and Arbiter Multiplicity
 * File Path: tests/unit/scoring-and-debt-guards.test.ts
 * Architecture Role: Verifies multiplier propagation through family claims, comprehensive
 *   security and dependency elastic debt classification, and multiplicity-aware regression penalties.
 * Dependencies & Triggers: Consumes dimensionDeductions, elastic-debt-budget, and change-quality-arbiter;
 *   invoked by Vitest regression harness.
 * Responsibilities:
 *   1. Assert that recordFamilyClaim preserves evolution and impact multipliers;
 *   2. Assert that classifyElasticDebtTier correctly routes security and dependency rules;
 *   3. Assert that evaluateElasticDebtBudget enforces low-tier debt limits;
 *   4. Assert that computeRegressionPenalty tracks multiplicity instead of Set collapse.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; exits 0 on pass.
 */

import { describe, it, expect } from 'vitest';
import {
    applyIssueDeductions,
    calculateCompoundedDeduction,
    classifyDebtTier,
    type DeductionApplier,
    type IssueDeductionOptions,
} from '../../src/core/scoring/dimensionDeductions';
import {
    classifyElasticDebtTier,
    evaluateElasticDebtBudget,
    computeWeightedDebtPoints,
    type DebtTierCounts,
} from '../../src/core/intelligence/elastic-debt-budget';
import {
    evaluateChangeQuality,
    type ChangeEvaluationInput,
} from '../../src/core/scoring/change-quality-arbiter';
import type { Issue, QualityDimension } from '../../src/core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING, SEVERITY_INFO } from '../../src/core/types';

function createDummyIssue(
    rule: string,
    severity: Issue['severity'] = SEVERITY_ERROR,
    file = 'src/service.ts',
    line = 10,
    analyzer = 'architecture',
): Issue {
    return {
        id: `mock:${rule}:${file}:${line}`,
        analyzer,
        rule,
        severity,
        message: `Violation of rule ${rule}`,
        location: {
            file,
            start: { line, column: 1 },
            end: { line, column: 80 },
        },
        detail: {},
    };
}

describe('Quality Dimension Deductions — Multiplier & Family Claims', () => {
    it('applies compound formula deterministically across multiple occurrences', () => {
        const base = 10;
        const alpha = 0.5;
        const occ0 = calculateCompoundedDeduction(base, 0, alpha);
        const occ1 = calculateCompoundedDeduction(base, 1, alpha);
        const occ2 = calculateCompoundedDeduction(base, 2, alpha);

        expect(occ0).toBe(10);
        expect(occ1).toBe(13);
        expect(occ2).toBe(15);
    });

    it('propagates evolution and impact multipliers through recordFamilyClaim', () => {
        const issue = createDummyIssue(
            'SEC-ENT-001',
            SEVERITY_ERROR,
            'src/secrets.ts',
            42,
            'security',
        );
        const recorded: Array<{
            dim: QualityDimension;
            points: number;
            reason: string;
            rule: string;
            line: number;
        }> = [];

        const applier: DeductionApplier = (dim, points, reason, rule, line) => {
            recorded.push({ dim, points, reason, rule, line });
        };

        const options: IssueDeductionOptions = {
            evolutionMultiplier: 2.0,
            impactMultiplier: 1.5,
        };

        applyIssueDeductions(issue, applier, options);

        expect(recorded.length).toBeGreaterThan(0);
        const secRecord = recorded.find((r) => r.dim === 'codeSecurity');
        expect(secRecord).toBeDefined();
        if (secRecord) {
            expect(secRecord.points).toBeGreaterThan(0);
            expect(secRecord.reason).toContain('[Vulnerability x3.00]');
        }
    });

    it('classifies critical vs evolutionary architectural debt tiers', () => {
        const criticalIssue = createDummyIssue(
            'SEC-TOK-001',
            SEVERITY_ERROR,
            'src/sec.ts',
            1,
            'security',
        );
        const evolutionaryIssue = createDummyIssue(
            'CPX-CYC-001',
            SEVERITY_WARNING,
            'src/mod.ts',
            1,
            'complexity',
        );

        expect(classifyDebtTier(criticalIssue)).toBe(1);
        expect(classifyDebtTier(evolutionaryIssue)).toBe(2);
    });
});

describe('Elastic Debt Budget — Rule Tiers & Low Limit Enforcement', () => {
    it('classifies security rules into critical or high tier according to vulnerability scope', () => {
        const secVuln = createDummyIssue('SEC-VUL-001', SEVERITY_WARNING);
        const secTokenWarn = createDummyIssue('SEC-TOK-001', SEVERITY_WARNING);
        const secTokenErr = createDummyIssue('SEC-TOK-001', SEVERITY_ERROR);
        const psSec = createDummyIssue('PS-SEC-INJ-001', SEVERITY_WARNING);

        expect(classifyElasticDebtTier(secVuln)).toBe('critical');
        expect(classifyElasticDebtTier(secTokenWarn)).toBe('high');
        expect(classifyElasticDebtTier(secTokenErr)).toBe('critical');
        expect(classifyElasticDebtTier(psSec)).toBe('high');
    });

    it('classifies dependency rules into critical, high, and medium tiers', () => {
        const depInv = createDummyIssue('DEP-INV-001', SEVERITY_ERROR);
        const depPhantom = createDummyIssue('DEP-PHANTOM-001', SEVERITY_WARNING);
        const depLic = createDummyIssue('DEP-LIC-001', SEVERITY_WARNING);
        const depDev = createDummyIssue('DEP-DEV-001', SEVERITY_WARNING);
        const depPin = createDummyIssue('DEP-PIN-001', SEVERITY_WARNING);
        const depObs = createDummyIssue('DEP-OBS-001', SEVERITY_WARNING);
        const depOrd = createDummyIssue('DEP-ORD-001', SEVERITY_INFO);

        expect(classifyElasticDebtTier(depInv)).toBe('critical');
        expect(classifyElasticDebtTier(depPhantom)).toBe('high');
        expect(classifyElasticDebtTier(depLic)).toBe('high');
        expect(classifyElasticDebtTier(depDev)).toBe('medium');
        expect(classifyElasticDebtTier(depPin)).toBe('medium');
        expect(classifyElasticDebtTier(depObs)).toBe('medium');
        expect(classifyElasticDebtTier(depOrd)).toBe('low');
    });

    it('blocks change when low-tier debt exceeds allowed budget', () => {
        const baseCounts: DebtTierCounts = { critical: 0, high: 0, medium: 0, low: 10 };
        const newCounts: DebtTierCounts = { critical: 0, high: 0, medium: 0, low: 650 };

        const evaluation = evaluateElasticDebtBudget(newCounts, {
            baselineDebt: baseCounts,
            baseLowAllowance: 100,
        });

        expect(evaluation.verdict).toBe('BLOCKED_EXCEEDED_BUDGET');
        expect(evaluation.violations.length).toBeGreaterThan(0);
        const lowViolation = evaluation.violations.find((v) => v.tier === 'low');
        expect(lowViolation).toBeDefined();
        if (lowViolation) {
            expect(lowViolation.delta).toBe(640);
        }
        expect(evaluation.rationale).toContain('New low debt');
    });

    it('permits zero debt change strictly when low delta is zero', () => {
        const counts: DebtTierCounts = { critical: 0, high: 0, medium: 0, low: 10 };

        const evaluation = evaluateElasticDebtBudget(counts, {
            baselineDebt: counts,
            baseLowAllowance: 100,
        });

        expect(evaluation.verdict).toBe('PERMITTED_ZERO_DEBT');
        expect(evaluation.violations).toHaveLength(0);
    });

    it('computes weighted debt points proportionally to configured weights', () => {
        const counts: DebtTierCounts = { critical: 1, high: 2, medium: 3, low: 4 };
        const points = computeWeightedDebtPoints(counts, {
            critical: 20,
            high: 10,
            medium: 5,
            low: 1,
        });

        expect(points).toBe(1 * 20 + 2 * 10 + 3 * 5 + 4 * 1);
    });
});

describe('Change Quality Arbiter — Multiplicity Regression Penalties', () => {
    it('penalizes multiple new occurrences of an already baselined finding', () => {
        const existing = [createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 10)];
        const updated = [
            createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 10),
            createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 20),
            createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 30),
        ];

        const input: ChangeEvaluationInput = {
            filePath: 'src/calc.ts',
            beforeContent: 'const a = 42;\n',
            afterContent: 'const a = 42;\nconst b = 100;\nconst c = 200;\n',
            beforeScore: 85.0,
            afterScore: 85.0,
            existingIssues: existing,
            newIssues: updated,
        };

        const result = evaluateChangeQuality(input);

        expect(result.regressionPenalty).toBe(10.0);
        expect(result.changeScore).toBeLessThan(0);
        expect(result.explanation.some((msg) => msg.includes('2 introduced issues'))).toBe(true);
    });

    it('gives zero regression penalty when finding counts remain within baseline credits', () => {
        const existing = [
            createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 10),
            createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 20),
        ];
        const updated = [createDummyIssue('CST-NUM-001', SEVERITY_WARNING, 'src/calc.ts', 10)];

        const input: ChangeEvaluationInput = {
            filePath: 'src/calc.ts',
            beforeContent: 'const a = 42;\nconst b = 100;\n',
            afterContent: 'const a = 42;\n',
            beforeScore: 85.0,
            afterScore: 85.0,
            existingIssues: existing,
            newIssues: updated,
        };

        const result = evaluateChangeQuality(input);

        expect(result.regressionPenalty).toBe(0);
        expect(result.changeScore).toBeGreaterThanOrEqual(0);
    });
});
