/**
 * Module: Core Intelligence — Test Modernity Metrics
 * File Path: src/core/intelligence/testModernityMetrics.ts
 * Architecture Role: Metric computation and threshold evaluation for the test-modernity pack.
 * Dependencies & Triggers: the same imports as ./testModernity plus its shared types;
 *   re-exported by that module so existing callers keep their single import path.
 * Responsibilities: Aggregate test-modernity metrics and grade them against the thresholds.
 * Exit Semantics & Design Rationale: Pure aggregation over the supplied site list; no I/O, and
 *   the caller keeps the analyzer wiring and severity policy.
 */
/**
 * Scale factor converting a ratio into per-mille units.
 */
const METRIC_SCALE = 1000;

/**
 * Scale factor converting a ratio into a whole percentage.
 */
const PERCENT_SCALE = 100;

/**
 * Score ceiling applied when a metric saturates.
 */
const MAX_SCORE_CAP = 80;

/**
 * Module: Core Intelligence — Test Modernity & Contract Fulfillment
 * File Path: src/core/intelligence/testModernity.ts
 * Architecture Role: Evaluates test suites for actual business risk mitigation, contract
 *   modernity, Effective Modern Test Density (EMTD), and Current Business Contract Coverage
 *   (CBCR), rejecting raw assertion counts or line counts.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep,
 *   TestModernityMetricSummary, TestDebtTicket); invoked by TestModernityAnalyzer.
 * Responsibilities: Detect test integrity illusions (TST-ILS-001); detect orphaned skipped
 *   tests (TST-SKP-001); detect tautological assertions (TST-TAU-001); compute EMTD and CBCR
 *   scores (TST-DEN-001); track deferred test debts with milestone convergence (TST-DBT-001).
 * Exit Semantics & Design Rationale: Pure computational model and AST pattern analyzer;
 *   returns structured diagnostics and metrics.
 */

import type { Issue, SemanticReviewDetail, TestModernityMetricSummary } from '../types';
import { SEVERITY_INFO, LANGUAGE_TYPESCRIPT } from '../types';
import { ANALYZER_TEST_MODERNITY } from '../scoring/dimensionLiterals';
import type { ActiveSemanticUnit, TestModernityOptions } from './testModernity';

/** Module tag written into the semantic review detail. */
const MODULE_TEST_SUITE = 'test-suite';
/** Code-domain tag written into the semantic review detail. */
const CODE_DOMAIN_TEST_MODERNITY = 'test-modernity';
/** Rule id of the low-test-density finding. */
const RULE_TST_DEN_001 = 'TST-DEN-001';
/** Rule contract version recorded on every emitted issue. */
const RULE_VERSION = '1.0.0';
/** Engine config version recorded on every emitted issue. */
const CONFIG_VERSION = '0.3.0';

/**
 * Calculate Effective Modern Test Density (EMTD) and Current Business Contract Coverage (CBCR).
 *
 * EMTD = 1000 * (sum(w_s * c_s * f_s * e_s * u_s)) / max(1, ActiveTestNLOC)
 * CBCR = sum(w_s * c_s * f_s) / sum(w_s)
 *
 * @param units - Set of active business semantic units.
 * @param activeTestNloc - Non-comment, non-fixture test lines of code.
 * @returns Computed metrics summary.
 */
export function computeTestModernityMetrics(
    units: ActiveSemanticUnit[],
    activeTestNloc: number,
): TestModernityMetricSummary {
    let weightedQualitySum = 0;
    let weightedFreshCoverageSum = 0;
    let totalWeight = 0;
    let coveredCount = 0;

    for (const unit of units) {
        totalWeight += unit.riskWeight;
        if (unit.isCovered) {
            coveredCount += 1;
            const freshCoverage = unit.riskWeight * unit.freshness;
            weightedFreshCoverageSum += freshCoverage;
            const qualityTerm =
                unit.riskWeight * unit.freshness * unit.effectiveness * unit.uniqueness;
            weightedQualitySum += qualityTerm;
        }
    }

    const nlocDivisor = Math.max(1, activeTestNloc);
    const emtd = Math.round((METRIC_SCALE * weightedQualitySum) / nlocDivisor);
    const cbcr = totalWeight > 0 ? weightedFreshCoverageSum / totalWeight : 1.0;

    return {
        emtd,
        cbcr: Math.round(cbcr * METRIC_SCALE) / METRIC_SCALE,
        activeTestNloc,
        activeSemanticUnits: units.length,
        coveredSemanticUnits: coveredCount,
    };
}
/**
 * Evaluate computed test metrics against thresholds and emit TST-DEN-001 if below minimum.
 *
 * @param metrics - Calculated EMTD and CBCR summary.
 * @param domain - Evaluated business domain name.
 * @param options - Modernity thresholds.
 * @returns Diagnostic issues for low test density or coverage.
 */
export function evaluateTestModernityThresholds(
    metrics: TestModernityMetricSummary,
    domain: string,
    options: TestModernityOptions = {},
): Issue[] {
    const minEmtd = options.minEmtd ?? PERCENT_SCALE;
    const minCbcr = options.minCbcr ?? 0.7;
    const issues: Issue[] = [];

    if (metrics.emtd < minEmtd || metrics.cbcr < minCbcr) {
        const detail: SemanticReviewDetail = {
            language: LANGUAGE_TYPESCRIPT,
            module: MODULE_TEST_SUITE,
            symbol: domain,
            codeDomain: CODE_DOMAIN_TEST_MODERNITY,
            currentBehavior: `Test suite achieves EMTD score ${metrics.emtd} (min ${minEmtd}) and CBCR rate ${metrics.cbcr} (min ${minCbcr}).`,
            semanticEvidenceChain: [],
            triggerCondition:
                'Effective Modern Test Density (EMTD) or Current Contract Coverage (CBCR) below configured threshold',
            risk: 'Critical business behaviors and state transitions lack effective modern fault-detecting test coverage.',
            blastRadius: [domain],
            isDeterministic: true,
            requiresManualConfirm: false,
            suggestedFix:
                'Add contract tests and negative boundary verification for active domain semantic units.',
            impactedCallers: [],
            impactedTests: [],
            verificationMethod: 'Recalculate EMTD and CBCR after augmenting test suites.',
            ruleVersion: RULE_VERSION,
            configVersion: CONFIG_VERSION,
            canAutofix: false,
        };

        issues.push({
            id: `test-modernity:TST-DEN-001:${domain}:1`,
            analyzer: ANALYZER_TEST_MODERNITY,
            rule: RULE_TST_DEN_001,
            severity: SEVERITY_INFO,
            message: `Low test density in domain '${domain}': EMTD=${metrics.emtd} (min ${minEmtd}), CBCR=${metrics.cbcr} (min ${minCbcr}).`,
            location: {
                file: `tests/unit/${domain}.test.ts`,
                start: { line: 1, column: 1 },
                end: { line: 1, column: MAX_SCORE_CAP },
            },
            detail,
            suggestion: 'Increase effective contract assertions for active domain workflows.',
            evidence: {
                confidence: 0.9,
                requiresRuntime: false,
            },
        });
    }

    return issues;
}
