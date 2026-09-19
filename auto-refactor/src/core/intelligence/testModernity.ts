export {
    computeTestModernityMetrics,
    evaluateTestModernityThresholds,
} from './testModernityMetrics';

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

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail, TestDebtTicket } from '../types';

/**
 * Descriptor of a test case or suite site.
 */
export interface TestSite {
    file: string;
    line: number;
    testName: string;
    isSkipped: boolean;
    isTautological: boolean;
    isMockOnly: boolean;
    referencesDeprecatedContract: boolean;
    contractVersion?: string;
    activeContractVersion?: string;
    testedSymbol?: string;
}

/**
 * Semantic unit of business behavior subject to test coverage.
 */
export interface ActiveSemanticUnit {
    id: string;
    domain: string;
    riskWeight: number; // w_s in [0, 1]
    isCovered: boolean; // c_s in [0, 1]
    freshness: number; // f_s in [0, 1]
    effectiveness: number; // e_s in [0, 1]
    uniqueness: number; // u_s in [0, 1]
}

/**
 * Options for tuning test modernity and density calculations.
 */
export interface TestModernityOptions {
    minEmtd?: number;
    minCbcr?: number;
    flagDeprecatedContractTests?: boolean;
    flagTautologicalAssertions?: boolean;
    flagSkippedTests?: boolean;
}

/**
 * Analyze test sites within a repository and produce modernity findings.
 *
 * @param sites - Observed test sites across test suites.
 * @param debts - Declared or discovered test debt tickets.
 * @param options - Configuration options for test modernity.
 * @returns Array of issues strictly following Section VII schema.
 */
export function analyzeTestModernitySites(
    sites: TestSite[],
    debts: TestDebtTicket[] = [],
    options: TestModernityOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const flagDeprecated = options.flagDeprecatedContractTests ?? true;
    const flagTautological = options.flagTautologicalAssertions ?? true;
    const flagSkipped = options.flagSkippedTests ?? true;

    for (const site of sites) {
        // 1. Test integrity illusion: testing a mock only, or testing deprecated
        //    contracts (TST-ILS-001).
        if (flagDeprecated && site.referencesDeprecatedContract) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'call',
                    description: `Test '${site.testName}' verifies obsolete contract version ${site.contractVersion}`,
                    file: site.file,
                    line: site.line,
                    symbol: site.testName,
                },
                {
                    kind: 'condition',
                    description: `Active production contract version is ${site.activeContractVersion}`,
                    file: site.file,
                    line: site.line,
                    symbol: site.testName,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'test-suite',
                symbol: site.testName,
                codeDomain: 'test-modernity',
                currentBehavior: `Test suite verifies deprecated contract ${site.contractVersion} while production code is on ${site.activeContractVersion}.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Test targets obsolete contract version without explicit legacy compatibility declaration',
                risk: 'Test integrity illusion: test passes successfully against obsolete APIs, falsely creating confidence of coverage for active V3 code.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix: `Update test signatures to match active contract ${site.activeContractVersion}, or move to legacy compatibility suite.`,
                impactedCallers: [],
                impactedTests: [site.file],
                verificationMethod:
                    'Execute test runner and assert test verifies active business schema fields.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `test-modernity:TST-ILS-001:${site.file}:${site.line}`,
                analyzer: 'test-modernity',
                rule: 'TST-ILS-001',
                severity: 'warning',
                message: `Test integrity illusion: '${site.testName}' asserts deprecated contract (${site.contractVersion} vs active ${site.activeContractVersion}).`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion: `Migrate test assertions to verify current contract ${site.activeContractVersion}.`,
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        } else if (site.isMockOnly) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'call',
                    description: `Test '${site.testName}' configures mock and asserts only mock configuration`,
                    file: site.file,
                    line: site.line,
                    symbol: site.testName,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'test-suite',
                symbol: site.testName,
                codeDomain: 'test-modernity',
                currentBehavior: `Test '${site.testName}' asserts only the mock stub's own return value without exercising business state transitions.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Assertion verifies mock instance rather than actual domain invariants or state',
                risk: 'Mock-only validation masks real production bugs when business domain logic breaks.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Assert on real domain outputs, state mutations, or event emissions rather than mock stubs.',
                impactedCallers: [],
                impactedTests: [site.file],
                verificationMethod:
                    'Introduce an intentional bug in domain logic and verify the test catches it.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `test-modernity:TST-ILS-001:${site.file}:${site.line}`,
                analyzer: 'test-modernity',
                rule: 'TST-ILS-001',
                severity: 'warning',
                message: `Test integrity illusion: '${site.testName}' verifies mock stubs only without real domain assertions.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion:
                    'Verify actual business invariants and side-effects rather than mock parameters.',
                evidence: {
                    confidence: 0.9,
                    requiresRuntime: false,
                },
            });
        }

        // 2. Orphaned skipped or unexecuted tests (TST-SKP-001)
        if (flagSkipped && site.isSkipped) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'condition',
                    description: `Test '${site.testName}' explicitly skipped or disabled`,
                    file: site.file,
                    line: site.line,
                    symbol: site.testName,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'test-suite',
                symbol: site.testName,
                codeDomain: 'test-modernity',
                currentBehavior: `Permanently skipped or disabled test case in '${site.file}'.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Test suite contains skipped tests (.skip, xit, @pytest.mark.skip)',
                risk: 'Skipped tests decay over time and mask regressions in active business domains.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Re-enable and fix the test, or formally register as a tracked test debt ticket.',
                impactedCallers: [],
                impactedTests: [site.file],
                verificationMethod: 'Execute test suite and confirm test runs to completion.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `test-modernity:TST-SKP-001:${site.file}:${site.line}`,
                analyzer: 'test-modernity',
                rule: 'TST-SKP-001',
                severity: 'warning',
                message: `Orphaned skipped test case '${site.testName}' in active test suite.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion:
                    'Re-enable the test case or document milestone convergence in test debt registry.',
                evidence: {
                    confidence: 1.0,
                    requiresRuntime: false,
                },
            });
        }

        // 3. Tautological or non-verifying assertions (TST-TAU-001)
        if (flagTautological && site.isTautological) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'condition',
                    description: `Tautological assertion in test '${site.testName}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.testName,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'test-suite',
                symbol: site.testName,
                codeDomain: 'test-modernity',
                currentBehavior: `Test contains non-verifying or tautological assertion (e.g. expect(true).toBe(true)).`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Assertion expression evaluates to an invariant constant truth without testing runtime logic',
                risk: 'Artificially inflates assertion metrics without testing functional behavior.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Replace tautological assertion with meaningful verification of domain outcomes.',
                impactedCallers: [],
                impactedTests: [site.file],
                verificationMethod: 'Run test with fault injection to verify failure capability.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `test-modernity:TST-TAU-001:${site.file}:${site.line}`,
                analyzer: 'test-modernity',
                rule: 'TST-TAU-001',
                severity: 'warning',
                message: `Tautological or non-verifying assertion in '${site.testName}'.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion:
                    'Assert specific business values and invariants rather than constant truth.',
                evidence: {
                    confidence: 1.0,
                    requiresRuntime: false,
                },
            });
        }
    }

    // 4. Overdue or unindexed test debt tracking (TST-DBT-001)
    for (const debt of debts) {
        if (!debt.targetMilestone || !debt.owner) {
            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'governance',
                symbol: debt.domain,
                codeDomain: 'test-debt',
                currentBehavior: `Deferred test coverage for domain '${debt.domain}' lacks owner or milestone convergence target.`,
                semanticEvidenceChain: [],
                triggerCondition:
                    'Test debt ticket lacks responsible agent owner or target convergence milestone',
                risk: 'Test coverage gap becomes permanent technical debt without accountability.',
                blastRadius: [debt.domain],
                isDeterministic: true,
                requiresManualConfirm: true,
                suggestedFix:
                    'Assign responsible agent/owner and specify milestone target for test suite completion.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod: 'Audit test debt registry for milestone completeness.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `test-modernity:TST-DBT-001:${debt.domain}:1`,
                analyzer: 'test-modernity',
                rule: 'TST-DBT-001',
                severity: 'info',
                message: `Unindexed test debt: domain '${debt.domain}' deferred test coverage lacks milestone target.`,
                location: {
                    file: `docs/test-debt/${debt.domain}.md`,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 80 },
                },
                detail,
                suggestion:
                    'Specify target milestone and responsible owner for test debt convergence.',
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }
    }

    return issues;
}
