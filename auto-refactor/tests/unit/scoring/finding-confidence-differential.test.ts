/**
 * Module: Unit Test Suite — Finding Confidence Arbiter Differential Slicing & Batching
 * File Path: tests/unit/scoring/finding-confidence-differential.test.ts
 * Architecture Role: Verifies differential slice filtering, batch aggregation, suppression
 *   health metrics, and dynamic quarantine lifecycles under strict test conditions.
 * Dependencies & Triggers: Consumes finding-confidence-arbiter.ts and vitest framework.
 * Responsibilities:
 *   1. Assert differential slice pruning of non-blocking historical suggestions outside diffs.
 *   2. Assert batch evaluation aggregation across mixed issue tiers and findings.
 *   3. Assert rule suppression health tracking and noisy rule detection.
 *   4. Assert Tricorder feedback demotion and canary / quarantine lifecycle guards.
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

describe('FindingConfidenceArbiter - Differential Slice Filtering', () => {
    it('keeps Advisory issues located on modified lines within differential slice', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                fileChangedRanges: {
                    'src/app.ts': [{ startLine: 10, endLine: 25 }],
                },
            },
        });

        const inSliceIssue = createIssue({
            analyzer: 'comments',
            rule: 'CMT-DOC-001',
            location: {
                file: 'src/app.ts',
                start: { line: 15, column: 1 },
                end: { line: 15, column: 20 },
            },
        });

        const result = arbiter.arbitrateFinding(inSliceIssue);
        expect(result.isPrunedBySlice).toBe(false);
    });

    it('prunes non-blocking Advisory issues outside modified differential slices', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                fileChangedRanges: {
                    'src/app.ts': [{ startLine: 10, endLine: 25 }],
                },
                pruneHistoricalNonBlocking: true,
            },
        });

        const outsideSliceIssue = createIssue({
            analyzer: 'comments',
            rule: 'CMT-DOC-001',
            location: {
                file: 'src/app.ts',
                start: { line: 80, column: 1 },
                end: { line: 80, column: 20 },
            },
        });

        const result = arbiter.arbitrateFinding(outsideSliceIssue);
        expect(result.isPrunedBySlice).toBe(true);
    });

    it('prunes Actionable issues on historical unchanged code outside differential slice', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                fileChangedRanges: {
                    'src/app.ts': [{ startLine: 10, endLine: 25 }],
                },
            },
        });

        const historicalActionable = createIssue({
            analyzer: 'constants',
            rule: 'magic-number',
            location: {
                file: 'src/app.ts',
                start: { line: 95, column: 1 },
                end: { line: 95, column: 20 },
            },
            actionable: {
                action: 'extract_constant',
                code: 'AR:CONST:001',
                safeToAutomate: true,
                templateSnippet: 'const TIMEOUT = 1000;',
            },
        });

        const result = arbiter.arbitrateFinding(historicalActionable);
        expect(result.tier).toBe(TIER_ACTIONABLE);
        expect(result.isPrunedBySlice).toBe(true);
    });

    it('retains Prescriptive (T1) blocking issues even outside modified differential slice', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                fileChangedRanges: {
                    'src/app.ts': [{ startLine: 10, endLine: 25 }],
                },
            },
        });

        const historicalSecret = createIssue({
            analyzer: 'security',
            rule: 'SEC-LEAK-001',
            severity: 'error',
            message: 'High-risk secretKey found in historical code',
            location: {
                file: 'src/app.ts',
                start: { line: 120, column: 1 },
                end: { line: 120, column: 30 },
            },
        });

        const result = arbiter.arbitrateFinding(historicalSecret);
        expect(result.tier).toBe(TIER_PRESCRIPTIVE);
        expect(result.mustBlock).toBe(true);
        expect(result.isPrunedBySlice).toBe(false);
    });

    it('supports changedLines set for single-file PR arbitration', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                changedLines: new Set([5, 6, 7, 8]),
            },
        });

        const changedLineIssue = createIssue({
            location: {
                file: 'src/single.ts',
                start: { line: 7, column: 1 },
                end: { line: 7, column: 10 },
            },
        });

        const historicalIssue = createIssue({
            location: {
                file: 'src/single.ts',
                start: { line: 50, column: 1 },
                end: { line: 50, column: 10 },
            },
        });

        expect(arbiter.arbitrateFinding(changedLineIssue).isPrunedBySlice).toBe(false);
        expect(arbiter.arbitrateFinding(historicalIssue).isPrunedBySlice).toBe(true);
    });

    it('retains all issues when differential slice filtering is disabled', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: false,
            },
        });

        const issue = createIssue({
            location: {
                file: 'src/app.ts',
                start: { line: 999, column: 1 },
                end: { line: 999, column: 10 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isPrunedBySlice).toBe(false);
    });
});

describe('FindingConfidenceArbiter - Batch Evaluation and Summary', () => {
    it('correctly aggregates counts, active findings, and patches across mixed issues', () => {
        const arbiter = new FindingConfidenceArbiter({
            differentialSlice: {
                enabled: true,
                fileChangedRanges: {
                    'src/file.ts': [{ startLine: 1, endLine: 30 }],
                },
            },
            fileContentMap: {
                'src/file.ts': [
                    '// line 1',
                    '// @refactor-suppress high-complexity',
                    'function complexSuppressed() {}',
                    '// line 4',
                ].join('\n'),
            },
        });

        const issues: Issue[] = [
            // 1. Prescriptive, in slice, suppressed
            createIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { complexity: 20 },
                location: {
                    file: 'src/file.ts',
                    start: { line: 3, column: 1 },
                    end: { line: 3, column: 20 },
                },
            }),
            // 2. Actionable, in slice, active
            createIssue({
                rule: 'magic-number',
                location: {
                    file: 'src/file.ts',
                    start: { line: 15, column: 1 },
                    end: { line: 15, column: 20 },
                },
                actionable: {
                    action: 'extract_constant',
                    code: 'AR:CONST:001',
                    safeToAutomate: true,
                    templateSnippet: 'const PI = 3.14;',
                },
            }),
            // 3. Advisory, in slice, active
            createIssue({
                rule: 'CMT-DOC-001',
                location: {
                    file: 'src/file.ts',
                    start: { line: 20, column: 1 },
                    end: { line: 20, column: 20 },
                },
            }),
            // 4. Advisory, outside slice -> pruned
            createIssue({
                rule: 'CMT-HDR-001',
                location: {
                    file: 'src/file.ts',
                    start: { line: 100, column: 1 },
                    end: { line: 100, column: 20 },
                },
            }),
        ];

        const summary = arbiter.arbitrate(issues);

        expect(summary.totalEvaluated).toBe(4);
        expect(summary.prescriptiveCount).toBe(1);
        expect(summary.actionableCount).toBe(1);
        expect(summary.advisoryCount).toBe(2);
        expect(summary.suppressedCount).toBe(1);
        expect(summary.prunedBySliceCount).toBe(1);
        expect(summary.activeFindings.length).toBe(2);
        expect(summary.blockingCount).toBe(0);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);
        expect(summary.executablePatches.length).toBe(1);
        expect(summary.executablePatches[0].templateSnippet).toBe('const PI = 3.14;');
    });

    it('tracks per-rule suppression health statistics and flags noisy rules', () => {
        const fileContent = [
            '// Line 1',
            '// @refactor-suppress noisy-rule',
            'const x = 1;',
            '// @refactor-suppress noisy-rule',
            'const y = 2;',
            'const z = 3;',
            'const w = 4;',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/noise.ts': fileContent },
        });

        const issues: Issue[] = [
            createIssue({
                rule: 'noisy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 3, column: 1 },
                    end: { line: 3, column: 10 },
                },
            }),
            createIssue({
                rule: 'noisy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 5, column: 1 },
                    end: { line: 5, column: 10 },
                },
            }),
            createIssue({
                rule: 'noisy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 6, column: 1 },
                    end: { line: 6, column: 10 },
                },
            }),
            createIssue({
                rule: 'noisy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 7, column: 1 },
                    end: { line: 7, column: 10 },
                },
            }),
            createIssue({
                rule: 'healthy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 6, column: 1 },
                    end: { line: 6, column: 10 },
                },
            }),
            createIssue({
                rule: 'healthy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 7, column: 1 },
                    end: { line: 7, column: 10 },
                },
            }),
            createIssue({
                rule: 'healthy-rule',
                location: {
                    file: 'src/noise.ts',
                    start: { line: 3, column: 1 },
                    end: { line: 3, column: 10 },
                },
            }),
        ];

        const summary = arbiter.arbitrate(issues);

        expect(summary.totalEvaluated).toBe(7);
        expect(summary.suppressedCount).toBe(2);
        expect(summary.ruleSuppressionStats).toBeDefined();

        const noisyStat = summary.ruleSuppressionStats?.find((s) => s.rule === 'noisy-rule');
        expect(noisyStat).toBeDefined();
        expect(noisyStat?.total).toBe(4);
        expect(noisyStat?.suppressed).toBe(2);
        expect(noisyStat?.suppressionRatio).toBe(0.5);
        expect(noisyStat?.isNoisy).toBe(true);

        const healthyStat = summary.ruleSuppressionStats?.find((s) => s.rule === 'healthy-rule');
        expect(healthyStat).toBeDefined();
        expect(healthyStat?.total).toBe(3);
        expect(healthyStat?.suppressed).toBe(0);
        expect(healthyStat?.isNoisy).toBe(false);

        expect(summary.noisyRules).toEqual(['noisy-rule']);
    });

    it('auto-demotes prescriptive issues when their rule is flagged as noisy (Tricorder feedback loop)', () => {
        const fileContent = [
            '// Line 1',
            '// @refactor-suppress high-complexity',
            'function f1() { return 1; }',
            '// @refactor-suppress high-complexity',
            'function f2() { return 2; }',
            'function f3() { return 3; }',
            'function f4() { return 4; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/noise2.ts': fileContent },
            autoDemoteNoisyRules: true,
        });

        const issues: Issue[] = [
            // 2 suppressed, 2 active prescriptive findings for 'high-complexity'
            createIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { complexity: 20 },
                location: {
                    file: 'src/noise2.ts',
                    start: { line: 3, column: 1 },
                    end: { line: 3, column: 10 },
                },
            }),
            createIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { complexity: 20 },
                location: {
                    file: 'src/noise2.ts',
                    start: { line: 5, column: 1 },
                    end: { line: 5, column: 10 },
                },
            }),
            createIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { complexity: 20 },
                location: {
                    file: 'src/noise2.ts',
                    start: { line: 6, column: 1 },
                    end: { line: 6, column: 10 },
                },
            }),
            createIssue({
                rule: 'high-complexity',
                severity: 'error',
                detail: { complexity: 20 },
                location: {
                    file: 'src/noise2.ts',
                    start: { line: 7, column: 1 },
                    end: { line: 7, column: 10 },
                },
            }),
        ];

        const summary = arbiter.arbitrate(issues);

        // Even though f3 and f4 were prescriptive errors, because high-complexity suppression ratio is 50%,
        // Tricorder feedback demotes active findings to Advisory, unblocking the gate!
        expect(summary.noisyRules).toEqual(['high-complexity']);
        expect(summary.blockingCount).toBe(0);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);

        const activeFinding = summary.activeFindings[0];
        expect(activeFinding.tier).toBe(TIER_ADVISORY);
        expect(activeFinding.mustBlock).toBe(false);
        expect(activeFinding.rationale).toContain('Demoted from Prescriptive to Advisory');
    });

    it('respects valid future TTL suppressions and marks expiry date', () => {
        const fileContent = [
            '// Line 1',
            '// @refactor-suppress CPX-CYC-001 until=2030-01-01 : temporary exemption',
            'function complexFn() { return 42; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/ttl.ts': fileContent },
            nowTimestamp: Date.parse('2026-10-18T00:00:00Z'),
        });

        const issue = createIssue({
            rule: 'CPX-CYC-001',
            severity: 'error',
            location: {
                file: 'src/ttl.ts',
                start: { line: 3, column: 1 },
                end: { line: 3, column: 10 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(true);
        expect(result.isSuppressionExpired).toBe(false);
        expect(result.suppressionExpiryDate).toBe('2030-01-01');
        expect(result.suppressionReason).toContain('valid until 2030-01-01');
    });

    it('invalidates expired TTL suppressions and restores prescriptive blocking', () => {
        const fileContent = [
            '// Line 1',
            '// @refactor-suppress CPX-CYC-001 until=2025-01-01 : expired exemption',
            'function complexFn() { return 42; }',
        ].join('\n');

        const arbiter = new FindingConfidenceArbiter({
            fileContentMap: { 'src/expired.ts': fileContent },
            nowTimestamp: Date.parse('2026-10-18T00:00:00Z'),
        });

        const issue = createIssue({
            rule: 'CPX-CYC-001',
            severity: 'error',
            location: {
                file: 'src/expired.ts',
                start: { line: 3, column: 1 },
                end: { line: 3, column: 10 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.isSuppressed).toBe(false);
        expect(result.isSuppressionExpired).toBe(true);
        expect(result.suppressionExpiryDate).toBe('2025-01-01');
        expect(result.mustBlock).toBe(true);
        expect(result.tier).toBe(TIER_PRESCRIPTIVE);
        expect(result.rationale).toContain('SUPPRESSION EXPIRED');

        const summary = arbiter.arbitrate([issue]);
        expect(summary.expiredSuppressionCount).toBe(1);
        expect(summary.blockingCount).toBe(1);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_BLOCKED);
    });

    it('clusters overlapping findings from multiple analyzers on the same line', () => {
        const arbiter = new FindingConfidenceArbiter({
            enableClustering: true,
        });

        const primaryPrescriptive = createIssue({
            analyzer: 'complexity',
            rule: 'high-complexity',
            severity: 'error',
            detail: { complexity: 20 },
            location: {
                file: 'src/overlap.ts',
                start: { line: 10, column: 1 },
                end: { line: 10, column: 20 },
            },
        });

        const secondaryAdvisory1 = createIssue({
            analyzer: 'naming',
            rule: 'NAM-VAR-001',
            severity: 'info',
            location: {
                file: 'src/overlap.ts',
                start: { line: 10, column: 5 },
                end: { line: 10, column: 12 },
            },
        });

        const secondaryAdvisory2 = createIssue({
            analyzer: 'comments',
            rule: 'CMT-CON-001',
            severity: 'warning',
            location: {
                file: 'src/overlap.ts',
                start: { line: 11, column: 1 },
                end: { line: 11, column: 15 },
            },
        });

        const distantIssue = createIssue({
            analyzer: 'security',
            rule: 'SEC-SQL-001',
            severity: 'error',
            location: {
                file: 'src/overlap.ts',
                start: { line: 50, column: 1 },
                end: { line: 50, column: 30 },
            },
        });

        const summary = arbiter.arbitrate([
            secondaryAdvisory1,
            primaryPrescriptive,
            secondaryAdvisory2,
            distantIssue,
        ]);

        expect(summary.totalEvaluated).toBe(4);
        expect(summary.clusteredCount).toBe(2);
        // Only 2 active findings: primaryPrescriptive (carrying 2 clustered issues) and distantIssue
        expect(summary.activeFindings.length).toBe(2);

        const primary = summary.activeFindings.find((f) => f.issue.rule === 'high-complexity');
        expect(primary).toBeDefined();
        expect(primary?.clusteredFindings?.length).toBe(2);
    });

    it('handles empty issues list gracefully', () => {
        const arbiter = new FindingConfidenceArbiter();
        const summary = arbiter.arbitrate([]);
        expect(summary.totalEvaluated).toBe(0);
        expect(summary.blockingCount).toBe(0);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);
        expect(summary.activeFindings.length).toBe(0);
        expect(summary.executablePatches.length).toBe(0);
        expect(summary.ruleSuppressionStats).toEqual([]);
        expect(summary.noisyRules).toEqual([]);
    });

    it('strips blocking authority when a rule is in quarantined state', () => {
        const arbiter = new FindingConfidenceArbiter({
            ruleLifecycleMap: {
                'high-complexity': 'quarantined',
            },
        });

        const issue = createIssue({
            rule: 'high-complexity',
            severity: 'error',
            detail: { complexity: 35 },
            location: {
                file: 'src/quarantined.ts',
                start: { line: 10, column: 1 },
                end: { line: 10, column: 20 },
            },
        });

        const result = arbiter.arbitrateFinding(issue);
        expect(result.mustBlock).toBe(false);
        expect(result.tier).toBe(TIER_ADVISORY);
        expect(result.isQuarantined).toBe(true);
        expect(result.ruleLifecycleState).toBe('quarantined');
        expect(result.rationale).toContain('[TRICORDER QUARANTINE:');
    });

    it('evaluates canary and experimental rules without blocking quality gates', () => {
        const arbiter = new FindingConfidenceArbiter({
            ruleLifecycleMap: {
                'canary-rule': 'canary',
                'experimental-rule': 'experimental',
            },
            customPrescriptiveRules: ['canary-rule', 'experimental-rule'],
        });

        const canaryIssue = createIssue({
            rule: 'canary-rule',
            severity: 'error',
            location: { file: 'src/trial.ts', start: { line: 5, column: 1 }, end: { line: 5, column: 10 } },
        });

        const expIssue = createIssue({
            rule: 'experimental-rule',
            severity: 'error',
            location: { file: 'src/trial.ts', start: { line: 15, column: 1 }, end: { line: 15, column: 10 } },
        });

        const summary = arbiter.arbitrate([canaryIssue, expIssue]);
        expect(summary.blockingCount).toBe(0);
        expect(summary.gateVerdict).toBe(GATE_VERDICT_PASSED);
        expect(summary.quarantinedCount).toBe(2);
        expect(summary.activeFindings.every((f) => !f.mustBlock)).toBe(true);
    });

    it('automatically flags high-suppression rules as dynamic quarantine candidates', () => {
        const arbiter = new FindingConfidenceArbiter({
            customPrescriptiveRules: ['flaky-rule'],
            autoDemoteNoisyRules: true,
            autoQuarantineThreshold: 0.5,
        });

        const issues: Issue[] = [];
        for (let i = 0; i < 5; i++) {
            issues.push(
                createIssue({
                    rule: 'flaky-rule',
                    severity: 'error',
                    detail: { complexity: 20 },
                    suppression: i < 4 ? { reason: 'noisy' } : undefined,
                    location: { file: 'src/flaky.ts', start: { line: i + 1, column: 1 }, end: { line: i + 1, column: 10 } },
                }),
            );
        }

        const summary = arbiter.arbitrate(issues);
        expect(summary.quarantinedRules).toContain('flaky-rule');
        expect(summary.quarantinedCount).toBeGreaterThanOrEqual(1);
    });
});
