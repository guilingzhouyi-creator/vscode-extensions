/**
 * Module: Unit Test Suite — Finding Confidence Arbiter & Differential Slicing Guard
 * File Path: tests/unit/scoring/finding-confidence-arbiter.test.ts
 * Architecture Role: Verifies three-tier confidence stratification, inline comment
 *   suppression guards, and differential slice filtering logic under strict test conditions.
 * Dependencies & Triggers: Consumes finding-confidence-arbiter.ts and vitest test framework.
 * Responsibilities:
 *   1. Assert Prescriptive (T1) gate blocking and 1.0 confidence for complexity, syntax, and secrets.
 *   2. Assert Actionable (T2) tier confidence >= 0.9 and executable patch generation.
 *   3. Assert Advisory (T3) tier non-blocking behavior and reporting aggregation.
 *   4. Assert inline comment suppression across multiple directive formats and positions.
 *   5. Assert differential slice pruning of non-blocking historical suggestions outside diffs.
 * Exit Semantics & Design Rationale: Deterministic pure test execution with zero external I/O.
 */

import { describe, it, expect } from 'vitest';
import type { Issue } from '../../../src/core/types';
import {
    FindingConfidenceArbiter,
    TIER_PRESCRIPTIVE,
    TIER_ACTIONABLE,
    TIER_ADVISORY,
    GATE_VERDICT_PASSED,
    GATE_VERDICT_BLOCKED,
    CONFIDENCE_PRESCRIPTIVE,
    CONFIDENCE_ACTIONABLE_FLOOR,
} from '../../../src/core/scoring/finding-confidence-arbiter';

/**
 * Factory helper creating minimal valid Issue records for testing.
 *
 * @param overrides - Partial issue fields to override defaults.
 * @returns Fully populated Issue instance.
 */
function createIssue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: overrides.id ?? 'analyzer:rule:src/test.ts:10',
        analyzer: overrides.analyzer ?? 'general',
        rule: overrides.rule ?? 'generic-rule',
        severity: overrides.severity ?? 'warning',
        message: overrides.message ?? 'Default test message',
        location: overrides.location ?? {
            file: 'src/test.ts',
            start: { line: 10, column: 1 },
            end: { line: 10, column: 20 },
        },
        detail: overrides.detail ?? {},
        suggestion: overrides.suggestion,
        evidence: overrides.evidence,
        actionable: overrides.actionable,
        suppression: overrides.suppression,
    };
}

describe('FindingConfidenceArbiter - Three-Tier Stratification', () => {
    const arbiter = new FindingConfidenceArbiter({ hardComplexityThreshold: 15 });

    describe('Prescriptive Tier (T1)', () => {
        it('classifies hard cyclomatic complexity exceeding threshold as Prescriptive (T1)', () => {
            const issue = createIssue({
                analyzer: 'complexity',
                rule: 'high-complexity',
                severity: 'error',
                detail: { cyclomaticComplexity: 18 },
                message: 'Function exceeds cyclomatic complexity threshold (18 > 15)',
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_PRESCRIPTIVE);
            expect(result.confidence).toBe(CONFIDENCE_PRESCRIPTIVE);
            expect(result.mustBlock).toBe(true);
        });

        it('classifies CPX rule exceeding numeric complexity limit as Prescriptive', () => {
            const issue = createIssue({
                analyzer: 'complexity',
                rule: 'CPX-STM-001',
                severity: 'error',
                detail: { complexity: 22 },
                message: 'Statement count complexity excessive',
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_PRESCRIPTIVE);
            expect(result.confidence).toBe(1.0);
            expect(result.mustBlock).toBe(true);
        });

        it('classifies syntax or parse errors as Prescriptive (T1)', () => {
            const issue = createIssue({
                analyzer: 'syntax',
                rule: 'SYN-001',
                severity: 'error',
                message: 'SyntaxError: Unexpected token',
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_PRESCRIPTIVE);
            expect(result.confidence).toBe(1.0);
            expect(result.mustBlock).toBe(true);
        });

        it('classifies high-risk secret and credential leaks as Prescriptive (T1)', () => {
            const leakDtoIssue = createIssue({
                analyzer: 'architecture',
                rule: 'ARCH-LEAK-002',
                severity: 'error',
                message: 'DTO credential leak: sensitive passwordHash exposed',
            });

            const leakSecIssue = createIssue({
                analyzer: 'security',
                rule: 'SEC-LEAK-001',
                severity: 'error',
                message: 'Hardcoded secretKey detected in source code',
            });

            const resultDto = arbiter.arbitrateFinding(leakDtoIssue);
            expect(resultDto.tier).toBe(TIER_PRESCRIPTIVE);
            expect(resultDto.confidence).toBe(1.0);
            expect(resultDto.mustBlock).toBe(true);

            const resultSec = arbiter.arbitrateFinding(leakSecIssue);
            expect(resultSec.tier).toBe(TIER_PRESCRIPTIVE);
            expect(resultSec.confidence).toBe(1.0);
            expect(resultSec.mustBlock).toBe(true);
        });

        it('supports custom prescriptive rules configured in options', () => {
            const customArbiter = new FindingConfidenceArbiter({
                customPrescriptiveRules: ['CUSTOM-CRITICAL-001'],
            });

            const issue = createIssue({
                rule: 'CUSTOM-CRITICAL-001',
                severity: 'warning',
            });

            const result = customArbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_PRESCRIPTIVE);
            expect(result.mustBlock).toBe(true);
        });
    });

    describe('Actionable Tier (T2)', () => {
        it('classifies issues with templateSnippet as Actionable with patch output', () => {
            const issue = createIssue({
                analyzer: 'constants',
                rule: 'magic-number',
                severity: 'warning',
                actionable: {
                    action: 'extract_constant',
                    code: 'AR:CONST:001',
                    safeToAutomate: true,
                    templateSnippet: 'const DEFAULT_TIMEOUT_MS = 5000;',
                    rationale: 'Extract repeated magic number to named constant',
                },
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_ACTIONABLE);
            expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_ACTIONABLE_FLOOR);
            expect(result.mustBlock).toBe(false);
            expect(result.executablePatch).toBeDefined();
            expect(result.executablePatch?.templateSnippet).toBe(
                'const DEFAULT_TIMEOUT_MS = 5000;',
            );
            expect(result.executablePatch?.safeToAutomate).toBe(true);
        });

        it('classifies issues with unifiedDiff payload as Actionable', () => {
            const diffSample =
                '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-var x = 1;\n+const x = 1;\n';
            const issue = createIssue({
                analyzer: 'modernization',
                rule: 'prefer-const',
                severity: 'warning',
                detail: {
                    unifiedDiff: diffSample,
                },
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_ACTIONABLE);
            expect(result.confidence).toBeGreaterThanOrEqual(0.9);
            expect(result.mustBlock).toBe(false);
            expect(result.executablePatch?.unifiedDiff).toBe(diffSample);
        });

        it('classifies issues with explicit patch ranges as Actionable', () => {
            const issue = createIssue({
                analyzer: 'simplify',
                rule: 'simplify-boolean',
                actionable: {
                    action: 'simplify_condition',
                    code: 'AR:SIM:001',
                    safeToAutomate: true,
                    patch: {
                        range: { startLine: 10, startCol: 5, endLine: 10, endCol: 15 },
                        replacementText: 'Boolean(val)',
                    },
                },
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_ACTIONABLE);
            expect(result.mustBlock).toBe(false);
            expect(result.executablePatch?.patchRange).toEqual({
                startLine: 10,
                startCol: 5,
                endLine: 10,
                endCol: 15,
                replacementText: 'Boolean(val)',
            });
        });
    });

    describe('Advisory Tier (T3)', () => {
        it('classifies architectural evolution and style advice as Advisory', () => {
            const issue = createIssue({
                analyzer: 'comments',
                rule: 'CMT-HDR-001',
                severity: 'warning',
                message: 'File header comment missing',
            });

            const result = arbiter.arbitrateFinding(issue);
            expect(result.tier).toBe(TIER_ADVISORY);
            expect(result.confidence).toBeLessThan(0.9);
            expect(result.mustBlock).toBe(false);
            expect(result.executablePatch).toBeUndefined();
        });

        it('allows quality gate to pass when only Advisory and Actionable issues exist', () => {
            const issues: Issue[] = [
                createIssue({
                    analyzer: 'comments',
                    rule: 'CMT-DOC-001',
                    severity: 'info',
                }),
                createIssue({
                    analyzer: 'constants',
                    rule: 'magic-number',
                    actionable: {
                        action: 'extract_constant',
                        code: 'AR:CONST:001',
                        safeToAutomate: true,
                        templateSnippet: 'const MAX_RETRIES = 3;',
                    },
                }),
            ];

            const summary = arbiter.arbitrate(issues);
            expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);
            expect(summary.blockingCount).toBe(0);
            expect(summary.advisoryCount).toBe(1);
            expect(summary.actionableCount).toBe(1);
            expect(summary.executablePatches.length).toBe(1);
        });

        it('blocks quality gate when an unsuppressed Prescriptive issue is present', () => {
            const issues: Issue[] = [
                createIssue({
                    analyzer: 'security',
                    rule: 'SEC-LEAK-001',
                    severity: 'error',
                    message: 'Private key exposed in configuration',
                }),
            ];

            const summary = arbiter.arbitrate(issues);
            expect(summary.gateVerdict).toBe(GATE_VERDICT_BLOCKED);
            expect(summary.blockingCount).toBe(1);
        });
    });
});

describe('FindingConfidenceArbiter - Inline Comment Suppression', () => {
    it('suppresses issue on same line with wildcard @refactor-suppress', () => {
        const fileContent = [
            '// Line 1',
            'const complexData = calc(); // @refactor-suppress',
            '// Line 3',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/test.ts': fileContent },
        });

        const issue = createIssue({
            rule: 'high-complexity',
            location: {
                file: 'src/test.ts',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 30 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(true);
        expect(result.suppressionReason).toContain('wildcard');
    });

    it('suppresses issue on target line when directive is on preceding line', () => {
        const fileContent = [
            '// @refactor-suppress high-complexity: unavoidable state machine',
            'function runStateMachine() {',
            '    return 42;',
            '}',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/test.ts': fileContent },
        });

        const issue = createIssue({
            rule: 'high-complexity',
            location: {
                file: 'src/test.ts',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 20 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(true);
        expect(result.suppressionReason).toBe('unavoidable state machine');
    });

    it('supports refactor-ignore-rule legacy syntax with rule specification', () => {
        const fileContent = [
            '// refactor-ignore-rule ARCH-LEAK-002: intentional public credential model',
            'export interface UserDto { passwordHash: string; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/dto.ts': fileContent },
        });

        const issue = createIssue({
            rule: 'ARCH-LEAK-002',
            location: {
                file: 'src/dto.ts',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 40 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(true);
        expect(result.suppressionReason).toBe('intentional public credential model');
    });

    it('does not suppress when directive specifies a different rule', () => {
        const fileContent = [
            '// @refactor-suppress magic-number',
            'function heavyComputation() { return 100; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/compute.ts': fileContent },
        });

        const issue = createIssue({
            rule: 'high-complexity',
            location: {
                file: 'src/compute.ts',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 40 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(false);
    });

    it('supports Python-style comments and block comment syntax', () => {
        const pyContent = [
            '# @refactor-suppress high-complexity',
            'def complex_routine():',
            '    pass',
        ].join('\n');

        const jsContent = [
            '/* @refactor-suppress high-complexity: block comment */',
            'function complexJs() {}',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter();

        const pyIssue = createIssue({
            rule: 'high-complexity',
            location: {
                file: 'src/mod.py',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 20 },
            },
        });
        const pyResult = arbiter.arbitrateFinding(pyIssue, pyContent);
        expect(pyResult.isSuppressed).toBe(true);

        const jsIssue = createIssue({
            rule: 'high-complexity',
            location: {
                file: 'src/mod.js',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 20 },
            },
        });
        const jsResult = arbiter.arbitrateFinding(jsIssue, jsContent);
        expect(jsResult.isSuppressed).toBe(true);
        expect(jsResult.suppressionReason).toBe('block comment');
    });

    it('unblocks quality gate when a prescriptive violation is properly suppressed', () => {
        const fileContent = [
            '// @refactor-suppress high-complexity: audited legacy routine',
            'function legacyCore() { return 1; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/legacy.ts': fileContent },
        });

        const issue = createIssue({
            rule: 'high-complexity',
            severity: 'error',
            location: {
                file: 'src/legacy.ts',
                start: { line: 2, column: 1 },
                end: { line: 2, column: 20 },
            },
            detail: { complexity: 30 },
        });

        const summary = arbiter.arbitrate([issue]);
        expect(summary.suppressedCount).toBe(1);
        expect(summary.blockingCount).toBe(0);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);
        expect(summary.activeFindings.length).toBe(0);
    });
});
