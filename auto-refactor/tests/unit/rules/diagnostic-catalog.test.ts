/**
 * Test Suite: Rules Diagnostic Catalog Expansion & Invariant Verification
 * File Path: tests/unit/rules/diagnostic-catalog.test.ts
 * Role: Validates 100% rule coverage and non-empty remediation templates across RULE_REGISTRY.
 */

import { describe, expect, it } from 'vitest';
import {
    DIAGNOSTIC_CATALOG,
    getDiagnosticCatalogCoverage,
} from '../../../src/core/rules/diagnostic-catalog';
import { RULE_REGISTRY } from '../../../src/core/rules/registry';

describe('Diagnostic Catalog Expansion Invariants', () => {
    it('achieves complete coverage of all registered auto-refactor rules', () => {
        const coverage = getDiagnosticCatalogCoverage();
        expect(coverage.totalAutoRules).toBe(RULE_REGISTRY.length);
        expect(coverage.coveredRules).toBeGreaterThanOrEqual(coverage.totalAutoRules);
        expect(coverage.coveragePercent).toBe(100);
    });

    it('ensures each catalog template contains valid rule metadata and actionable codes', () => {
        for (const rule of RULE_REGISTRY) {
            const template = DIAGNOSTIC_CATALOG[rule.id];
            expect(template).toBeDefined();
            expect(template.ruleId).toBe(rule.id);
            expect(['error', 'warning', 'info']).toContain(template.defaultSeverity);
            expect(template.actionCode).toMatch(/^AR:[A-Z0-9_]{2,8}:\d{3}$/);
            expect(template.defaultMessage.length).toBeGreaterThan(0);
            expect(template.suggestion.length).toBeGreaterThan(0);
        }
    });
});
