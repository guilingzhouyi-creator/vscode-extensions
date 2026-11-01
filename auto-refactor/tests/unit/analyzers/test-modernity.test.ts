/**
 * Module: Unit Test — Test Modernity & Business Contract Fulfillment Analyzer Suite
 * File Path: tests/unit/analyzers/test-modernity.test.ts
 * Architecture Role: Exercises TestModernityAnalyzer across skipped tests (TST-SKP-001),
 *   tautological assertions (TST-TAU-001), and test density evaluation.
 * Dependencies & Triggers: vitest (describe, it, expect); imports TestModernityAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert TST-SKP-001 and TST-TAU-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { TestModernityAnalyzer } from '../../../src/analyzers/test-modernity';
import type { AnalyzerContext } from '../../../src/core/types';

describe('TestModernityAnalyzer Suite', () => {
    const analyzer = new TestModernityAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {
                analyzers: {
                    'test-modernity': { options: {} },
                },
            },
        };
    }

    it('bypasses production source files that are not tests', () => {
        const code = 'export function calculateTotal(a: number, b: number) { return a + b; }';
        const ctx = createCtx('src/services/billing.ts', code);
        const issues = analyzer.finalize(ctx);
        expect(issues).toHaveLength(0);
    });

    it('permits compliant unit test suite with legitimate domain assertions', () => {
        const code = [
            'import { describe, it, expect } from "vitest";',
            'describe("BillingService", () => {',
            '    it("calculates positive sum correctly", () => {',
            '        const total = 10 + 20;',
            '        expect(total).toBe(30);',
            '    });',
            '});',
        ].join('\n');
        const ctx = createCtx('tests/unit/billing.test.ts', code);
        const issues = analyzer.finalize(ctx);
        const smellIssues = issues.filter((i) => i.rule === 'TST-SKP-001' || i.rule === 'TST-TAU-001');
        expect(smellIssues).toHaveLength(0);
    });

    it('flags orphaned skipped test cases (TST-SKP-001)', () => {
        const code = [
            'import { describe, it, expect } from "vitest";',
            'describe("AuthSuite", () => {',
            '    it.skip("skips login under maintenance", () => {',
            '        expect(1).toBe(1);',
            '    });',
            '});',
        ].join('\n');
        const ctx = createCtx('tests/unit/auth.test.ts', code);
        const issues = analyzer.finalize(ctx);
        const skipIssue = issues.find((i) => i.rule === 'TST-SKP-001');
        expect(skipIssue).toBeDefined();
        expect(skipIssue?.message).toContain('skipped test');
    });

    it('flags tautological assertion comparing constants to themselves (TST-TAU-001)', () => {
        const code = [
            'import { describe, it, expect } from "vitest";',
            'describe("SanityCheck", () => {',
            '    it("verifies identity", () => {',
            '        expect(true).toBe(true);',
            '    });',
            '});',
        ].join('\n');
        const ctx = createCtx('tests/unit/sanity.test.ts', code);
        const issues = analyzer.finalize(ctx);
        const tauIssue = issues.find((i) => i.rule === 'TST-TAU-001');
        expect(tauIssue).toBeDefined();
        expect(tauIssue?.message).toContain('Tautological');
    });
});
