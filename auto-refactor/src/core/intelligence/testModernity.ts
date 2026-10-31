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

import type {
    Issue,
    SemanticEvidenceStep,
    SemanticReviewDetail,
    TestDebtTicket,
    TestModernityMetricSummary,
} from '../types';
import { SEVERITY_WARNING, SEVERITY_INFO, LANGUAGE_TYPESCRIPT } from '../types';
import {
    CODE_TST_SKIPPED,
    CODE_TST_TAUTOLOGICAL,
    CODE_TST_FRAGILE_FLOAT,
    CODE_TST_BRITTLE_ORACLE,
} from '../constants/rule-codes';

const METRIC_SCALE = 1000;
const PERCENT_SCALE = 100;
const MAX_SCORE_CAP = 80;
const RULE_TST_DEN_001 = 'TST-DEN-001';

const KIND_CONDITION = 'condition';
const KIND_CALL = 'call';
const MODULE_TEST_SUITE = 'test-suite';
const MODULE_GOVERNANCE = 'governance';
const CODE_DOMAIN_TEST_MODERNITY = 'test-modernity';
const CODE_DOMAIN_TEST_DEBT = 'test-debt';
const DEFAULT_RULE_VERSION = '1.0.0';
const DEFAULT_CONFIG_VERSION = '0.3.0';
const DEFAULT_END_COLUMN = 80;
const ANALYZER_TEST_MODERNITY = 'test-modernity';
const RULE_TST_ILS_001 = 'TST-ILS-001';
const RULE_TST_SKP_001 = 'TST-SKP-001';
const RULE_TST_TAU_001 = 'TST-TAU-001';
const RULE_TST_FLT_001 = 'TST-FLT-001';
const RULE_TST_ORC_001 = 'TST-ORC-001';
const RULE_TST_DBT_001 = 'TST-DBT-001';

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
    isFragileFloatAssertion?: boolean;
    fragileFloatLiteral?: string;
    isBrittleOracleAssertion?: boolean;
    brittleOracleLiteral?: string;
    brittleOracleTarget?: string;
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
    strict?: boolean;
    tautologicalIsFatal?: boolean;
    enforceTestDensity?: boolean;
}

/**
 * Consolidated result of business symbol to test coverage mapping.
 */
export interface BusinessTestMappingResult {
    metrics: TestModernityMetricSummary;
    semanticUnits: ActiveSemanticUnit[];
    issues: Issue[];
    uncoveredSymbols: string[];
}

interface TestSiteIssueSpec {
    site: TestSite;
    rule: string;
    message: string;
    suggestion: string;
    confidence: number;
    evidenceKind: typeof KIND_CALL | typeof KIND_CONDITION;
    evidenceDescription: string;
    secondaryEvidenceDescription?: string;
    currentBehavior: string;
    triggerCondition: string;
    risk: string;
    suggestedFix: string;
    verificationMethod: string;
    actionable?: Issue['actionable'];
}

/**
 * Construct a standardized test modernity diagnostic issue for a single test site.
 */
function buildTestSiteIssue(spec: TestSiteIssueSpec): Issue {
    const { site } = spec;
    const evidence: SemanticEvidenceStep[] = [
        {
            kind: spec.evidenceKind,
            description: spec.evidenceDescription,
            file: site.file,
            line: site.line,
            symbol: site.testName,
        },
    ];
    if (spec.secondaryEvidenceDescription) {
        evidence.push({
            kind: KIND_CONDITION,
            description: spec.secondaryEvidenceDescription,
            file: site.file,
            line: site.line,
            symbol: site.testName,
        });
    }

    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: MODULE_TEST_SUITE,
        symbol: site.testName,
        codeDomain: CODE_DOMAIN_TEST_MODERNITY,
        currentBehavior: spec.currentBehavior,
        semanticEvidenceChain: evidence,
        triggerCondition: spec.triggerCondition,
        risk: spec.risk,
        blastRadius: [site.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: spec.suggestedFix,
        impactedCallers: [],
        impactedTests: [site.file],
        verificationMethod: spec.verificationMethod,
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };

    const issue: Issue = {
        id: `${ANALYZER_TEST_MODERNITY}:${spec.rule}:${site.file}:${site.line}`,
        analyzer: ANALYZER_TEST_MODERNITY,
        rule: spec.rule,
        severity: SEVERITY_WARNING,
        message: spec.message,
        location: {
            file: site.file,
            start: { line: site.line, column: 1 },
            end: { line: site.line, column: DEFAULT_END_COLUMN },
        },
        detail,
        suggestion: spec.suggestion,
        evidence: {
            confidence: spec.confidence,
            requiresRuntime: false,
        },
    };
    if (spec.actionable) {
        issue.actionable = spec.actionable;
    }
    return issue;
}

function createDeprecatedContractIssue(site: TestSite): Issue {
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_ILS_001,
        message: `Test integrity illusion: '${site.testName}' asserts deprecated contract (${site.contractVersion} vs active ${site.activeContractVersion}).`,
        suggestion: `Migrate test assertions to verify current contract ${site.activeContractVersion}.`,
        confidence: 0.95,
        evidenceKind: KIND_CALL,
        evidenceDescription: `Test '${site.testName}' verifies obsolete contract version ${site.contractVersion}`,
        secondaryEvidenceDescription: `Active production contract version is ${site.activeContractVersion}`,
        currentBehavior: `Test suite verifies deprecated contract ${site.contractVersion} while production code is on ${site.activeContractVersion}.`,
        triggerCondition:
            'Test targets obsolete contract version without explicit legacy compatibility declaration',
        risk: 'Test integrity illusion: test passes successfully against obsolete APIs, falsely creating confidence of coverage for active V3 code.',
        suggestedFix: `Update test signatures to match active contract ${site.activeContractVersion}, or move to legacy compatibility suite.`,
        verificationMethod:
            'Execute test runner and assert test verifies active business schema fields.',
    });
}

function createMockOnlyIssue(site: TestSite): Issue {
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_ILS_001,
        message: `Test integrity illusion: '${site.testName}' verifies mock stubs only without real domain assertions.`,
        suggestion:
            'Verify actual business invariants and side-effects rather than mock parameters.',
        confidence: 0.9,
        evidenceKind: KIND_CALL,
        evidenceDescription: `Test '${site.testName}' configures mock and asserts only mock configuration`,
        currentBehavior: `Test '${site.testName}' asserts only the mock stub's own return value without exercising business state transitions.`,
        triggerCondition:
            'Assertion verifies mock instance rather than actual domain invariants or state',
        risk: 'Mock-only validation masks real production bugs when business domain logic breaks.',
        suggestedFix:
            'Assert on real domain outputs, state mutations, or event emissions rather than mock stubs.',
        verificationMethod:
            'Introduce an intentional bug in domain logic and verify the test catches it.',
    });
}

function createSkippedTestIssue(site: TestSite): Issue {
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_SKP_001,
        message: `Orphaned skipped test case '${site.testName}' in active test suite.`,
        suggestion:
            'Re-enable the test case or document milestone convergence in test debt registry.',
        confidence: 1.0,
        evidenceKind: KIND_CONDITION,
        evidenceDescription: `Test '${site.testName}' explicitly skipped or disabled`,
        currentBehavior: `Permanently skipped or disabled test case in '${site.file}'.`,
        triggerCondition: 'Test suite contains skipped tests (.skip, xit, @pytest.mark.skip)',
        risk: 'Skipped tests decay over time and mask regressions in active business domains.',
        suggestedFix:
            'Re-enable and fix the test, or formally register as a tracked test debt ticket.',
        verificationMethod: 'Execute test suite and confirm test runs to completion.',
        actionable: {
            action: 'simplify_control_flow',
            code: CODE_TST_SKIPPED,
            taxonomy: 'TEST_MODERN',
            safeToAutomate: false,
            templateSnippet: 'Re-enable test and verify assertions.',
        },
    });
}

function createTautologicalIssue(site: TestSite): Issue {
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_TAU_001,
        message: `Tautological or non-verifying assertion in '${site.testName}'.`,
        suggestion: 'Assert specific business values and invariants rather than constant truth.',
        confidence: 1.0,
        evidenceKind: KIND_CONDITION,
        evidenceDescription: `Tautological assertion in test '${site.testName}'`,
        currentBehavior: `Test contains non-verifying or tautological assertion (e.g. expect(true).toBe(true)).`,
        triggerCondition:
            'Assertion expression evaluates to an invariant constant truth without testing runtime logic',
        risk: 'Artificially inflates assertion metrics without testing functional behavior.',
        suggestedFix:
            'Replace tautological assertion with meaningful verification of domain outcomes.',
        verificationMethod: 'Run test with fault injection to verify failure capability.',
        actionable: {
            action: 'extract_pure_predicate',
            code: CODE_TST_TAUTOLOGICAL,
            taxonomy: 'TEST_MODERN',
            safeToAutomate: false,
            templateSnippet: 'expect(result).toBe(expectedBusinessValue);',
        },
    });
}

function createFragileFloatIssue(site: TestSite): Issue {
    const floatLit = site.fragileFloatLiteral ?? 'float';
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_FLT_001,
        message: `Fragile floating-point assertion: '${site.testName}' asserts naked float literal '${floatLit}' without epsilon tolerance.`,
        suggestion: `Derive expected value via mathematical formula (e.g. Math.round(formula * 100) / 100) or use tolerance assertion.`,
        confidence: 1.0,
        evidenceKind: KIND_CONDITION,
        evidenceDescription: `Fragile floating-point assertion against naked literal '${floatLit}' in test '${site.testName}'`,
        currentBehavior: `Test asserts calculated floating-point result against naked magic literal '${floatLit}' without formula derivation or tolerance.`,
        triggerCondition:
            'Assertion performs direct strict equality against a naked floating-point literal',
        risk: 'Floating-point roundoff errors and machine epsilon variance cause brittle test failures across platforms.',
        suggestedFix:
            'Use tolerance matcher (e.g. toBeCloseTo, isScoreEqual) or derive expectation via shared formula.',
        verificationMethod:
            'Assert test failure with epsilon perturbation or replace with toBeCloseTo matcher.',
        actionable: {
            action: 'replace_with_tolerance_assertion',
            code: CODE_TST_FRAGILE_FLOAT,
            taxonomy: 'TEST_MODERN',
            safeToAutomate: true,
            templateSnippet: `expect(actual).toBeCloseTo(${floatLit}, 2);`,
            targetArguments: {
                targetLiteral: floatLit,
                toleranceDecimals: 2,
            },
        },
    });
}

function createBrittleOracleIssue(site: TestSite): Issue {
    const oracleLit = site.brittleOracleLiteral ?? 'scalar';
    const oracleTarget = site.brittleOracleTarget ?? 'entity total';
    return buildTestSiteIssue({
        site,
        rule: RULE_TST_ORC_001,
        message: `Brittle assertion oracle: '${site.testName}' asserts exact scalar literal '${oracleLit}' on '${oracleTarget}' without bounded corridor.`,
        suggestion: `Replace exact scalar assertion with bounded corridor (e.g. assertWithinCorridor or >= baseline) to guard against fragile breakdown.`,
        confidence: 1.0,
        evidenceKind: KIND_CONDITION,
        evidenceDescription: `Brittle oracle assertion against exact literal '${oracleLit}' on '${oracleTarget}' in test '${site.testName}'`,
        currentBehavior: `Test asserts exact scalar equality against naked magic literal '${oracleLit}' on entity metric '${oracleTarget}' without corridor or dynamic derivation.`,
        triggerCondition:
            'Assertion performs exact equality against a hardcoded physical total or entity count literal',
        risk: 'Brittle test oracle breaks on normal workspace evolution (file additions, rule expansions) rather than detecting real functional regressions.',
        suggestedFix:
            'Use invariant corridor assertion (e.g. assertWithinCorridor, >= baseline) or dynamic derivation.',
        verificationMethod:
            'Assert test resilience across incremental fixture/rule count expansion.',
        actionable: {
            action: 'replace_with_tolerance_assertion',
            code: CODE_TST_BRITTLE_ORACLE,
            taxonomy: 'TEST_MODERN',
            safeToAutomate: false,
            templateSnippet: `assertWithinCorridor(${oracleTarget}, ${oracleLit}, 5);`,
            targetArguments: {
                targetLiteral: oracleLit,
                targetExpression: oracleTarget,
            },
        },
    });
}

function createTestDebtIssue(debt: TestDebtTicket): Issue {
    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: MODULE_GOVERNANCE,
        symbol: debt.domain,
        codeDomain: CODE_DOMAIN_TEST_DEBT,
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
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };

    return {
        id: `${ANALYZER_TEST_MODERNITY}:${RULE_TST_DBT_001}:${debt.domain}:1`,
        analyzer: ANALYZER_TEST_MODERNITY,
        rule: RULE_TST_DBT_001,
        severity: SEVERITY_INFO,
        message: `Unindexed test debt: domain '${debt.domain}' deferred test coverage lacks milestone target.`,
        location: {
            file: `docs/test-debt/${debt.domain}.md`,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DEFAULT_END_COLUMN },
        },
        detail,
        suggestion: 'Specify target milestone and responsible owner for test debt convergence.',
        evidence: {
            confidence: 0.95,
            requiresRuntime: false,
        },
    };
}

function evaluateSingleSiteModernity(
    site: TestSite,
    flagDeprecated: boolean,
    flagTautological: boolean,
    flagSkipped: boolean,
): Issue | null {
    if (flagDeprecated && site.referencesDeprecatedContract) {
        return createDeprecatedContractIssue(site);
    }
    if (site.isMockOnly) {
        return createMockOnlyIssue(site);
    }
    if (flagSkipped && site.isSkipped) {
        return createSkippedTestIssue(site);
    }
    if (flagTautological && site.isTautological) {
        return createTautologicalIssue(site);
    }
    if (site.isFragileFloatAssertion) {
        return createFragileFloatIssue(site);
    }
    if (site.isBrittleOracleAssertion) {
        return createBrittleOracleIssue(site);
    }
    return null;
}

function isUnindexedDebt(debt: TestDebtTicket): boolean {
    return !debt.targetMilestone || !debt.owner;
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
    const flagDeprecated = options.flagDeprecatedContractTests !== false;
    const flagTautological = options.flagTautologicalAssertions !== false;
    const flagSkipped = options.flagSkippedTests !== false;

    for (const site of sites) {
        const issue = evaluateSingleSiteModernity(
            site,
            flagDeprecated,
            flagTautological,
            flagSkipped,
        );
        if (issue) {
            issues.push(issue);
        }
    }

    // Overdue or unindexed test debt tracking (TST-DBT-001)
    for (const debt of debts) {
        if (isUnindexedDebt(debt)) {
            issues.push(createTestDebtIssue(debt));
        }
    }

    return issues;
}

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
            ruleVersion: DEFAULT_RULE_VERSION,
            configVersion: DEFAULT_CONFIG_VERSION,
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

export {
    isTestFilePath,
    auditTestSource,
    mapBusinessToTests,
    TestModernityEvaluator,
    defaultTestModernityEvaluator,
} from './testModernityAuditor';
