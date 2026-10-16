/**
 * Module: Unit Test — Effective Density & Anti-Gaming Integration Suite
 * File Path: tests/unit/effective-density-integration.test.ts
 * Architecture Role: Verifies the ten-dimension continuous scoring mapping, extended
 *   effective density payload tensor calculations, declarative rule table routing, and
 *   anti-gaming circuit breakers for low-entropy and tautological loop padding.
 * Dependencies & Triggers: Vitest test runner; consumes computeEffectiveCodeDensity,
 *   detectScoreGaming, dimensionRuleTable, and dimensionLiterals.
 * Responsibilities:
 *   1. Validate computeEffectiveCodeDensity output extensions (tokenCount, tokensPerEloc,
 *      columnDensity, tspr, por, sufr, compositeDensity).
 *   2. Validate dimensionRuleTable declarative deduction routing for RULE_ARCH_PLM_001,
 *      RULE_SIM_INL_001, and RULE_CPX_TRV_001.
 *   3. Validate antiGaming detection and rejection for low_entropy_token_padding and
 *      tautological_traversal_padding.
 * Exit Semantics & Design Rationale: Deterministic test suite with 100% assertion pass rate.
 */

import { describe, it, expect } from 'vitest';
import { computeEffectiveCodeDensity } from '../../src/core/scoring/effectiveDensity';
import {
    detectScoreGaming,
    RULE_GOV_GAM_001,
} from '../../src/core/scoring/antiGaming';
import {
    DIMENSION_RULES,
    getDimensionRulesForAnalyzer,
} from '../../src/core/scoring/dimensionRuleTable';
import {
    RULE_ARCH_PLM_001,
    RULE_SIM_INL_001,
    RULE_CPX_TRV_001,
    DEDUCTION_PLUMBING_OVERHEAD,
    DEDUCTION_ORPHAN_INLINE,
    DEDUCTION_TAUTOLOGICAL_LOOP,
    ANALYZER_TOKEN_DENSITY,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_PERFORMANCE_EFFICIENCY,
} from '../../src/core/scoring/dimensionLiterals';
import { applyQualityDimensionDeductions } from '../../src/core/scoring/dimensionDeductions';
import type { Issue } from '../../src/core/types';

describe('computeEffectiveCodeDensity extended metrics', () => {
    it('should compute standard and extended payload density metrics for valid code', () => {
        const sampleCode = `
import { readFileSync } from 'fs';
import { resolve } from 'path';

export function calculateMetrics(inputPath: string): number {
    const content = readFileSync(resolve(inputPath), 'utf-8');
    const lines = content.split('\\n');
    let total = 0;
    for (const line of lines) {
        if (line.trim().length > 0) {
            total += 1;
        }
    }
    return total;
}

export function runCalculation(): number {
    return calculateMetrics('sample.txt');
}
`;

        const result = computeEffectiveCodeDensity(sampleCode, 'typescript');

        // Original backward-compatible fields
        expect(result.totalLoc).toBeGreaterThan(0);
        expect(result.usefulLoc).toBeGreaterThan(0);
        expect(result.boilerplateLoc).toBeGreaterThanOrEqual(0);
        expect(result.forwardingCount).toBeGreaterThanOrEqual(0);
        expect(result.effectiveDensity).toBeGreaterThan(0);
        expect(result.effectiveDensity).toBeLessThanOrEqual(1.0);
        expect(result.noiseIndex).toBeGreaterThanOrEqual(0);
        expect(result.gaussianHealth).toBeGreaterThanOrEqual(0);
        expect(result.gaussianHealth).toBeLessThanOrEqual(1.0);
        expect(typeof result.isLowDensity).toBe('boolean');

        // Extended 7 fields
        expect(result.tokenCount).toBeDefined();
        expect(result.tokenCount).toBeGreaterThan(0);

        expect(result.tokensPerEloc).toBeDefined();
        expect(result.tokensPerEloc).toBeGreaterThan(0);

        expect(result.columnDensity).toBeDefined();
        expect(result.columnDensity).toBeGreaterThanOrEqual(0);
        expect(result.columnDensity).toBeLessThanOrEqual(1.0);

        expect(result.tspr).toBeDefined();
        expect(result.tspr).toBeGreaterThanOrEqual(0);
        expect(result.tspr).toBeLessThanOrEqual(1.0);

        expect(result.por).toBeDefined();
        expect(result.por).toBeGreaterThanOrEqual(0);
        expect(result.por).toBeLessThanOrEqual(1.0);

        expect(result.sufr).toBeDefined();
        expect(result.sufr).toBeGreaterThanOrEqual(0);
        expect(result.sufr).toBeLessThanOrEqual(1.0);

        expect(result.compositeDensity).toBeDefined();
        expect(result.compositeDensity).toBeGreaterThan(0);
        expect(result.compositeDensity).toBeLessThanOrEqual(1.0);
    });

    it('should safely fall back with zero values when input content is empty', () => {
        const result = computeEffectiveCodeDensity('', 'typescript');

        expect(result.totalLoc).toBe(0);
        expect(result.usefulLoc).toBe(0);
        expect(result.effectiveDensity).toBe(1.0);
        expect(result.tokenCount).toBe(0);
        expect(result.tokensPerEloc).toBe(0);
        expect(result.columnDensity).toBe(0);
        expect(result.tspr).toBe(0);
        expect(result.por).toBe(0);
        expect(result.sufr).toBe(0);
        expect(result.compositeDensity).toBe(0);
    });
});

describe('dimensionRuleTable routing for new rules', () => {
    it('should route RULE_ARCH_PLM_001 to architectureConsistency with 12 point deduction', () => {
        const issue: Issue = {
            id: `${ANALYZER_TOKEN_DENSITY}:${RULE_ARCH_PLM_001}:src/test.ts:10`,
            analyzer: ANALYZER_TOKEN_DENSITY,
            rule: RULE_ARCH_PLM_001,
            severity: 'warning',
            message: 'Plumbing overhead ratio (POR = 0.45) exceeds architectural threshold',
        };

        const rules = getDimensionRulesForAnalyzer(ANALYZER_TOKEN_DENSITY);
        const matchingRule = rules.find((r) => r.covers(issue));

        expect(matchingRule).toBeDefined();
        expect(matchingRule?.dimension).toBe(DIMENSION_ARCHITECTURE_CONSISTENCY);
        expect(matchingRule?.points).toBe(DEDUCTION_PLUMBING_OVERHEAD);
        expect(DEDUCTION_PLUMBING_OVERHEAD).toBe(12);

        // Verify end-to-end deduction execution
        const applied: { dim: string; points: number }[] = [];
        applyQualityDimensionDeductions(issue, (dim, points) => {
            applied.push({ dim, points });
        });
        expect(
            applied.some(
                (a) => a.dim === DIMENSION_ARCHITECTURE_CONSISTENCY && a.points === 12,
            ),
        ).toBe(true);
    });

    it('should route RULE_SIM_INL_001 to maintainability with 8 point deduction', () => {
        const issue: Issue = {
            id: `${ANALYZER_TOKEN_DENSITY}:${RULE_SIM_INL_001}:src/test.ts:25`,
            analyzer: ANALYZER_TOKEN_DENSITY,
            rule: RULE_SIM_INL_001,
            severity: 'warning',
            message: 'Orphan inline function single-use rate exceeds threshold (SUFR = 0.85)',
        };

        const rules = getDimensionRulesForAnalyzer(ANALYZER_TOKEN_DENSITY);
        const matchingRule = rules.find((r) => r.covers(issue));

        expect(matchingRule).toBeDefined();
        expect(matchingRule?.dimension).toBe(DIMENSION_MAINTAINABILITY);
        expect(matchingRule?.points).toBe(DEDUCTION_ORPHAN_INLINE);
        expect(DEDUCTION_ORPHAN_INLINE).toBe(8);

        // Verify end-to-end deduction execution
        const applied: { dim: string; points: number }[] = [];
        applyQualityDimensionDeductions(issue, (dim, points) => {
            applied.push({ dim, points });
        });
        expect(
            applied.some((a) => a.dim === DIMENSION_MAINTAINABILITY && a.points === 8),
        ).toBe(true);
    });

    it('should route RULE_CPX_TRV_001 to performanceEfficiency with 10 point deduction', () => {
        const issue: Issue = {
            id: `${ANALYZER_TOKEN_DENSITY}:${RULE_CPX_TRV_001}:src/test.ts:40`,
            analyzer: ANALYZER_TOKEN_DENSITY,
            rule: RULE_CPX_TRV_001,
            severity: 'warning',
            message: 'Tautological loop traversal detected with negligible state entropy delta',
        };

        const rules = getDimensionRulesForAnalyzer(ANALYZER_TOKEN_DENSITY);
        const matchingRule = rules.find((r) => r.covers(issue));

        expect(matchingRule).toBeDefined();
        expect(matchingRule?.dimension).toBe(DIMENSION_PERFORMANCE_EFFICIENCY);
        expect(matchingRule?.points).toBe(DEDUCTION_TAUTOLOGICAL_LOOP);
        expect(DEDUCTION_TAUTOLOGICAL_LOOP).toBe(10);

        // Verify end-to-end deduction execution
        const applied: { dim: string; points: number }[] = [];
        applyQualityDimensionDeductions(issue, (dim, points) => {
            applied.push({ dim, points });
        });
        expect(
            applied.some(
                (a) => a.dim === DIMENSION_PERFORMANCE_EFFICIENCY && a.points === 10,
            ),
        ).toBe(true);
    });
});

describe('antiGaming detection and circuit breaking', () => {
    it('should identify tautological traversal loop padding and deduct 20 points', () => {
        const tautologicalLoopCode = `
export function iterateEmptyDomains(listA: string[], listB: number[]): void {
    for (const item of listA) {
        // empty traversal without mutation
    }
    for (let i = 0; i < listB.length; i++) {
        continue;
    }
}
`;

        const result = detectScoreGaming('src/traversal-padding.ts', tautologicalLoopCode);

        expect(result.hasGaming).toBe(true);
        expect(result.gamingKinds).toContain('tautological_traversal_padding');
        expect(result.gamingPenalty).toBeGreaterThanOrEqual(20.0);

        const gamingIssue = result.issues.find(
            (i) => i.rule === RULE_GOV_GAM_001 && i.detail?.gamingKind === 'tautological_traversal_padding',
        );
        expect(gamingIssue).toBeDefined();
        expect(gamingIssue?.analyzer).toBe('governance');
    });

    it('should identify low-entropy token padding in 300+ line files and deduct 25 points', () => {
        // Synthesize >= 300 lines with degenerate low-entropy repetitive tokens
        const lines: string[] = [];
        for (let i = 0; i < 320; i++) {
            lines.push('const paddingVar = 1;');
        }
        const lowEntropyFileContent = lines.join('\n');

        const result = detectScoreGaming('src/large-low-entropy.ts', lowEntropyFileContent);

        expect(result.hasGaming).toBe(true);
        expect(result.gamingKinds).toContain('low_entropy_token_padding');
        expect(result.gamingPenalty).toBeGreaterThanOrEqual(25.0);

        const lowEntropyIssue = result.issues.find(
            (i) => i.rule === RULE_GOV_GAM_001 && i.detail?.gamingKind === 'low_entropy_token_padding',
        );
        expect(lowEntropyIssue).toBeDefined();
        expect(lowEntropyIssue?.detail?.totalLines).toBeGreaterThanOrEqual(300);
        expect(lowEntropyIssue?.detail?.entropy).toBeLessThan(2.5);
    });

    it('should cleanly pass normal functional code with zero gaming deductions', () => {
        const cleanDomainCode = `
export function computeBinarySearch(arr: readonly number[], target: number): number {
    let low = 0;
    let high = arr.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const val = arr[mid];
        if (val === target) return mid;
        if (val < target) low = mid + 1;
        else high = mid - 1;
    }
    return -1;
}
`;

        const result = detectScoreGaming('src/binarySearch.ts', cleanDomainCode);

        expect(result.gamingKinds).not.toContain('tautological_traversal_padding');
        expect(result.gamingKinds).not.toContain('low_entropy_token_padding');
        expect(result.hasGaming).toBe(false);
        expect(result.gamingPenalty).toBe(0);
    });
});
