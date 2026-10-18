/**
 * Module: Core Intelligence — Test Modernity Multi-Language Auditor
 * File Path: src/core/intelligence/testModernityAuditor.ts
 * Architecture Role: Multi-language test source parser, AST pattern matcher, and business-to-test
 *   semantic graph coverage mapper for the test modernity governance pack.
 * Dependencies & Triggers: Consumes ./testModernity and ./testModernityMetrics; re-exported
 *   by ./testModernity to preserve a unified import surface.
 * Responsibilities: Detect multi-language tautological assertions, skipped tests, mock illusions,
 *   and map production semantic graph units to effective test suites.
 * Exit Semantics & Design Rationale: Pure computational model and pattern extractor; returns
 *   structured issues and mapping results without side effects.
 */

import type { Issue } from '../types';
import type { SemanticGraph } from '../semantic/semanticGraph';
import type { SemanticNode } from '../semantic/types';
import type {
    TestSite,
    ActiveSemanticUnit,
    TestModernityOptions,
    BusinessTestMappingResult,
} from './testModernity';
import { analyzeTestModernitySites } from './testModernity';
import {
    computeTestModernityMetrics,
    evaluateTestModernityThresholds,
} from './testModernityMetrics';
import { isCommentLine } from '../scanner/text-scanner-utils';

/** Permitted test file naming suffixes and directories. */
const TEST_DIR_NAME = '/tests/';
const TEST_FILE_PREFIX = '/test_';
const PYTHON_TEST_SUFFIX = '_test.py';
const GDSCRIPT_TEST_SUFFIX = '_test.gd';
const RUST_TEST_SUFFIX = '_test.rs';

/** Skip marker keywords across testing frameworks. */
const PYTEST_SKIP_MARKER = '@pytest.mark.skip';
const UNITTEST_SKIP_MARKER = '@unittest.skip';
const DECORATOR_SKIP_MARKER = '@skip';
const RUST_IGNORE_MARKER = '#[ignore]';

/** Default fallback names and values. */
const DEFAULT_SKIPPED_TEST_NAME = 'skipped-test';
const DEFAULT_ACTIVE_TEST_NLOC = 100;
const FALLBACK_DOMAIN_NAME = 'core';
const DEFAULT_DOMAIN_NAME = 'domain';

/** Severity constant string. */
const SEVERITY_ERROR_LITERAL = 'error';

/** Pre-compiled patterns for symbol risk weighting. */
const RE_CRITICAL_SYMBOLS = /(?:payment|auth|crypto|security)/;
const RE_CORE_DOMAIN_SYMBOLS = /(?:service|repository|domain|pipeline|controller)/;
const RE_LOW_RISK_SYMBOLS = /(?:util|helper|format)/;

/** Node kinds eligible for business-to-test semantic mapping. */
const ELIGIBLE_NODE_KINDS: ReadonlySet<string> = new Set(['function', 'type', 'module']);

/**
 * Detect whether a file path corresponds to a test file.
 *
 * @param filePath - File path string to evaluate.
 * @returns True if path matches known test file naming patterns.
 */
export function isTestFilePath(filePath: string): boolean {
    const lower = filePath.toLowerCase().replace(/\\/g, '/');
    return (
        lower.includes('.test.') ||
        lower.includes('.spec.') ||
        lower.includes('__tests__/') ||
        lower.includes(TEST_DIR_NAME) ||
        lower.startsWith('tests/') ||
        lower.startsWith('test_') ||
        lower.endsWith(PYTHON_TEST_SUFFIX) ||
        lower.endsWith(GDSCRIPT_TEST_SUFFIX) ||
        lower.endsWith(RUST_TEST_SUFFIX) ||
        lower.includes(TEST_FILE_PREFIX)
    );
}

const TAUTOLOGY_PATTERNS: readonly RegExp[] = [
    /expect\(\s*(?:true|false|1|0|'[^']*'|"[^"]*")\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\(\s*(?:true|false|1|0|'[^']*'|"[^"]*")\s*\)/,
    /expect\(\s*([a-zA-Z0-9_]+)\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/,
    /assert(?:\.strictEqual|\.equal|\.deepStrictEqual)?\(\s*(?:true|1)\s*,\s*(?:true|1)\s*\)/,
    /assert(?:\.strictEqual|\.equal|\.deepStrictEqual)?\(\s*([a-zA-Z0-9_]+)\s*,\s*\1\s*\)/,
    /assert(?:\.ok)?\(\s*true\s*\)/,
    /assert\s+True\b/,
    /assert\s+1\s*==\s*1\b/,
    /assert\s+([a-zA-Z0-9_]+)\s*==\s*\1\b/,
    /self\.assertTrue\(\s*True\s*\)/,
    /self\.assertEqual\(\s*([a-zA-Z0-9_]+)\s*,\s*\1\s*\)/,
    /assert_true\(\s*true\s*\)/,
    /assert_eq\(\s*1\s*,\s*1\s*\)/,
    /assert_eq\(\s*([a-zA-Z0-9_]+)\s*,\s*\1\s*\)/,
    /assert!\(\s*true\s*\);/,
    /assert_eq!\(\s*1\s*,\s*1\s*\);/,
];

const MOCK_ASSERTION_PATTERNS: readonly RegExp[] = [
    /\.toHaveBeenCalled\s*\(/,
    /\.toHaveBeenCalledWith\s*\(/,
    /\.toHaveBeenCalledTimes\s*\(/,
    /assert_called_once\s*\(/,
    /assert_called_with\s*\(/,
];

const GENERAL_ASSERTION_PATTERNS: readonly RegExp[] = [
    /expect\s*\(/,
    /assert\s*\(/,
    /assert\./,
    /assert\s+/,
    /assert_/,
    /self\.assert/,
];

const BRITTLE_ORACLE_LINE_RE =
    /\b(?:expect\s*\([^)]*(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount)[^)]*\)\s*\.to(?:Be|Equal|toStrictEqual)\s*\(\s*([0-9]+)\s*\)|assert(?:\.strictEqual|\.equal)?\s*\([^,)]*(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount)[^,)]*,\s*([0-9]+)\s*\)|assert\s+[^=]*(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount)[^=]*==\s*([0-9]+)|assert_eq\s*\([^,)]*(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount)[^,)]*,\s*([0-9]+)\s*\)|assert_eq!\s*\([^,)]*(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount)[^,)]*,\s*([0-9]+)\s*\))/i;

/**
 * Checks if a trimmed line is a tautological assertion.
 *
 * @param line - Trimmed line of code.
 * @returns True if tautological.
 */
function hasTautologicalAssertion(line: string): boolean {
    return TAUTOLOGY_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Checks if a trimmed line is a mock-only call verification.
 *
 * @param line - Trimmed line of code.
 * @returns True if mock call check.
 */
function isMockAssertionLine(line: string): boolean {
    return MOCK_ASSERTION_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Checks if a trimmed line contains any general assertion statement.
 *
 * @param line - Trimmed line of code.
 * @returns True if assertion present.
 */
function isGeneralAssertionLine(line: string): boolean {
    return GENERAL_ASSERTION_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Checks if a trimmed line indicates a skipped test decorator or comment.
 *
 * @param line - Trimmed line.
 * @returns True if skip marker.
 */
function isSkipMarkerLine(line: string): boolean {
    return (
        line.startsWith(PYTEST_SKIP_MARKER) ||
        line.startsWith(UNITTEST_SKIP_MARKER) ||
        line.startsWith(DECORATOR_SKIP_MARKER) ||
        line.startsWith(RUST_IGNORE_MARKER)
    );
}

/**
 * Matches test declaration patterns across supported languages.
 *
 * @param line - Trimmed line of code.
 * @param ext - File extension.
 * @returns Test name and skip flag, or null if not a test start.
 */
function matchTestDeclaration(
    line: string,
    ext: string,
): { testName: string; isSkipped: boolean } | null {
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        if (
            line.match(/(?:it|test|describe)\.skip\s*\(/) ||
            line.match(/\b(?:xit|xdescribe)\s*\(/)
        ) {
            const suiteMatch = line.match(
                /(?:it|test|describe|xit|xdescribe)(?:\.skip)?\s*\(\s*['"`]([^'"`]+)['"`]/,
            );
            return {
                testName: suiteMatch ? suiteMatch[1] : DEFAULT_SKIPPED_TEST_NAME,
                isSkipped: true,
            };
        }
        const regMatch = line.match(/(?:it|test)(?:\.only)?\s*\(\s*['"`]([^'"`]+)['"`]/);
        return regMatch ? { testName: regMatch[1], isSkipped: false } : null;
    }
    if (ext === '.py') {
        const regMatch = line.match(/def\s+(test_\w+)\s*\(/);
        return regMatch ? { testName: regMatch[1], isSkipped: false } : null;
    }
    if (ext === '.gd') {
        const regMatch = line.match(/func\s+(test_\w+)\s*\(/);
        return regMatch ? { testName: regMatch[1], isSkipped: false } : null;
    }
    if (ext === '.rs') {
        const regMatch = line.match(/fn\s+(test_\w+)\s*\(/);
        return regMatch ? { testName: regMatch[1], isSkipped: false } : null;
    }
    const regMatch = line.match(/(?:it|test|func|def|fn)\s+['"`]?([a-zA-Z0-9_-]+)['"`]?\s*\(/);
    return regMatch ? { testName: regMatch[1], isSkipped: false } : null;
}

/**
 * Checks if a line tests a deprecated or obsolete business contract.
 *
 * @param line - Trimmed line.
 * @param content - Full file content.
 * @returns True if obsolete contract target.
 */
function isObsoleteContractLine(line: string, content: string): boolean {
    if (!/assert|expect/.test(line)) {
        return false;
    }
    return (
        /deprecatedContract|obsoleteContract|ContractV1|V1Schema/.test(line) ||
        /activeContractVersion:\s*['"]V3['"]/.test(content)
    );
}

/**
 * Creates a structured TestSite descriptor.
 *
 * @param file - File path.
 * @param line - Line number.
 * @param testName - Test name.
 * @param flags - Additional site attributes.
 * @returns Initialized TestSite.
 */
function createTestSite(
    file: string,
    line: number,
    testName: string,
    flags: Partial<TestSite> = {},
): TestSite {
    const isSkipped = flags.isSkipped ?? false;
    const isTautological = flags.isTautological ?? false;
    const isMockOnly = flags.isMockOnly ?? false;
    const referencesDeprecatedContract = flags.referencesDeprecatedContract ?? false;
    return {
        file,
        line,
        testName,
        isSkipped,
        isTautological,
        isMockOnly,
        referencesDeprecatedContract,
        contractVersion: flags.contractVersion,
        activeContractVersion: flags.activeContractVersion,
        testedSymbol: flags.testedSymbol,
        isFragileFloatAssertion: flags.isFragileFloatAssertion,
        fragileFloatLiteral: flags.fragileFloatLiteral,
        isBrittleOracleAssertion: flags.isBrittleOracleAssertion,
        brittleOracleLiteral: flags.brittleOracleLiteral,
        brittleOracleTarget: flags.brittleOracleTarget,
    };
}

/**
 * Single-file test site collection state machine for AST-free modernity auditing.
 */
class TestSiteCollector {
    private readonly filePath: string;
    private readonly content: string;
    private readonly ext: string;
    private readonly sites: TestSite[] = [];
    private currentTestName: string | null = null;
    private currentLine = 1;
    private currentAssertions = 0;
    private currentMockAssertions = 0;
    private inSkippedBlock = false;

    constructor(filePath: string, content: string) {
        this.filePath = filePath;
        this.content = content;
        this.ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    }

    public collectSites(): TestSite[] {
        const lines = this.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            this.processLine(lines[i].trim(), i + 1);
        }
        this.flushCurrentTest();
        return this.sites;
    }

    private flushCurrentTest(): void {
        if (!this.currentTestName) {
            return;
        }
        if (this.currentAssertions === 0 && !this.inSkippedBlock) {
            this.sites.push(
                createTestSite(this.filePath, this.currentLine, this.currentTestName, {
                    isTautological: true,
                }),
            );
        } else if (
            this.currentAssertions > 0 &&
            this.currentMockAssertions === this.currentAssertions &&
            !this.inSkippedBlock
        ) {
            this.sites.push(
                createTestSite(this.filePath, this.currentLine, this.currentTestName, {
                    isMockOnly: true,
                }),
            );
        }
        this.currentTestName = null;
        this.currentAssertions = 0;
        this.currentMockAssertions = 0;
        this.inSkippedBlock = false;
    }

    private processLine(trimmed: string, lineNum: number): void {
        if (isSkipMarkerLine(trimmed)) {
            this.inSkippedBlock = true;
            return;
        }
        if (isCommentLine(trimmed)) {
            return;
        }

        const decl = matchTestDeclaration(trimmed, this.ext);
        if (decl) {
            this.handleTestDeclaration(decl, lineNum);
            return;
        }

        if (!this.currentTestName) {
            return;
        }

        this.handleAssertionLine(trimmed, lineNum);
    }

    private handleTestDeclaration(
        decl: NonNullable<ReturnType<typeof matchTestDeclaration>>,
        lineNum: number,
    ): void {
        this.flushCurrentTest();
        this.currentTestName = decl.testName;
        this.currentLine = lineNum;
        if (this.inSkippedBlock || decl.isSkipped) {
            this.sites.push(
                createTestSite(this.filePath, lineNum, this.currentTestName, {
                    isSkipped: true,
                }),
            );
            this.inSkippedBlock = false;
        }
    }

    private handleAssertionLine(trimmed: string, lineNum: number): void {
        if (hasTautologicalAssertion(trimmed)) {
            this.currentAssertions++;
            this.sites.push(
                createTestSite(this.filePath, lineNum, this.currentTestName!, {
                    isTautological: true,
                }),
            );
            return;
        }

        if (isObsoleteContractLine(trimmed, this.content)) {
            this.currentAssertions++;
            this.sites.push(
                createTestSite(this.filePath, lineNum, this.currentTestName!, {
                    referencesDeprecatedContract: true,
                    contractVersion: 'V1',
                    activeContractVersion: 'V3',
                }),
            );
            return;
        }

        const brittleMatch = BRITTLE_ORACLE_LINE_RE.exec(trimmed);
        if (brittleMatch) {
            this.currentAssertions++;
            const lit = brittleMatch.slice(1).find(Boolean) || 'scalar';
            this.sites.push(
                createTestSite(this.filePath, lineNum, this.currentTestName!, {
                    isBrittleOracleAssertion: true,
                    brittleOracleLiteral: lit,
                }),
            );
            return;
        }

        if (isMockAssertionLine(trimmed)) {
            this.currentAssertions++;
            this.currentMockAssertions++;
            return;
        }

        if (isGeneralAssertionLine(trimmed)) {
            this.currentAssertions++;
        }
    }
}

/**
 * Escalates rule severities to error under strict or fatal configuration.
 */
function applySeverityEscalation(issues: Issue[], options: TestModernityOptions): void {
    if (!options.strict && !options.tautologicalIsFatal) {
        return;
    }
    for (const issue of issues) {
        if (issue.rule === 'TST-TAU-001' || issue.rule === 'TST-ILS-001') {
            issue.severity = SEVERITY_ERROR_LITERAL;
        }
    }
}

/**
 * Audits test source code across multiple languages for integrity illusions,
 * tautological assertions, and orphaned skipped tests.
 *
 * @param filePath - Path to the test file.
 * @param content - Test file content string.
 * @param options - Configuration options.
 * @returns Detected test modernity issues.
 */
export function auditTestSource(
    filePath: string,
    content: string,
    options: TestModernityOptions = {},
): Issue[] {
    const collector = new TestSiteCollector(filePath, content);
    const sites = collector.collectSites();
    const issues = analyzeTestModernitySites(sites, [], options);
    applySeverityEscalation(issues, options);
    return issues;
}

/**
 * Infers risk weight for an active business symbol.
 *
 * @param name - Symbol name.
 * @returns Risk weight in range [0.5, 1.0].
 */
function inferSymbolRiskWeight(name: string): number {
    const lower = name.toLowerCase();
    if (RE_CRITICAL_SYMBOLS.test(lower)) {
        return 1.0;
    }
    if (RE_CORE_DOMAIN_SYMBOLS.test(lower)) {
        return 0.9;
    }
    return RE_LOW_RISK_SYMBOLS.test(lower) ? 0.5 : 0.7;
}

/**
 * Evaluates coverage quality (freshness and effectiveness) for matching test sites.
 *
 * @param sites - Matching test sites.
 * @returns Freshness and effectiveness weights.
 */
function evaluateCoverageQuality(sites: TestSite[]): {
    freshness: number;
    effectiveness: number;
} {
    const hasDeprecated = sites.some((s) => s.referencesDeprecatedContract);
    const freshness = hasDeprecated ? 0.2 : 1.0;
    const onlyWeak = sites.every((s) => s.isTautological || s.isMockOnly || s.isSkipped);
    const effectiveness = onlyWeak ? 0.1 : 1.0;
    return { freshness, effectiveness };
}

function hasCaseInsensitiveSubstring(text: string, search: string): boolean {
    return text.indexOf(search) !== -1;
}

function indexMatchingSitesBySymbol(
    testSites: TestSite[],
    businessNodes: SemanticNode[],
): Map<string, TestSite[]> {
    const siteMap = new Map<string, TestSite[]>();
    for (let b = 0; b < businessNodes.length; b++) {
        siteMap.set(businessNodes[b].name.toLowerCase(), []);
    }

    for (let s = 0; s < testSites.length; s++) {
        const site = testSites[s];
        const testedLower = site.testedSymbol ? site.testedSymbol.toLowerCase() : null;
        const testNameLower = site.testName.toLowerCase();

        for (let b = 0; b < businessNodes.length; b++) {
            const lowerName = businessNodes[b].name.toLowerCase();
            const matches =
                testedLower === lowerName || hasCaseInsensitiveSubstring(testNameLower, lowerName);
            if (matches) {
                siteMap.get(lowerName)!.push(site);
            }
        }
    }

    return siteMap;
}

/**
 * Maps production symbols in a SemanticGraph to test coverage sites and calculates
 * the five-dimensional test quality metrics (EMTD, CBCR, TF, AU, RS).
 *
 * @param productionGraph - SemanticGraph of production code.
 * @param testSites - List of observed test sites.
 * @param activeTestNloc - Active test non-comment lines of code.
 * @param options - Modernity options.
 * @returns Mapping results including calculated metrics and low-density findings.
 */
export function mapBusinessToTests(
    productionGraph: SemanticGraph,
    testSites: TestSite[],
    activeTestNloc: number = DEFAULT_ACTIVE_TEST_NLOC,
    options: TestModernityOptions = {},
): BusinessTestMappingResult {
    const nodes = productionGraph.getAllNodes();
    const semanticUnits: ActiveSemanticUnit[] = [];
    const uncoveredSymbols: string[] = [];

    const businessNodes = nodes.filter((n: SemanticNode) => {
        if (!ELIGIBLE_NODE_KINDS.has(n.kind)) {
            return false;
        }
        const file = n.location?.file ?? '';
        return !isTestFilePath(file);
    });

    const matchingSitesMap = indexMatchingSitesBySymbol(testSites, businessNodes);

    for (const node of businessNodes) {
        const lowerName = node.name.toLowerCase();
        const pathLower = (node.location?.file ?? '').toLowerCase();
        const riskWeight = inferSymbolRiskWeight(node.name);

        const matchingSites = matchingSitesMap.get(lowerName) ?? [];

        const isCovered = matchingSites.length > 0;
        if (!isCovered) {
            uncoveredSymbols.push(node.name);
        }

        const { freshness, effectiveness } = isCovered
            ? evaluateCoverageQuality(matchingSites)
            : { freshness: 1.0, effectiveness: 1.0 };

        const parts = pathLower.split('/');
        const domain = parts.length > 2 ? parts[parts.length - 2] : FALLBACK_DOMAIN_NAME;

        semanticUnits.push({
            id: node.id,
            domain,
            riskWeight,
            isCovered,
            freshness,
            effectiveness,
            uniqueness: 1.0,
        });
    }

    const metrics = computeTestModernityMetrics(semanticUnits, activeTestNloc);
    const domain = semanticUnits.length > 0 ? semanticUnits[0].domain : DEFAULT_DOMAIN_NAME;
    const issues = evaluateTestModernityThresholds(metrics, domain, options);

    return {
        metrics,
        semanticUnits,
        issues,
        uncoveredSymbols,
    };
}

/**
 * Unified evaluator for test modernity, contract coverage, and test density governance.
 */
export class TestModernityEvaluator {
    private readonly options: TestModernityOptions;
    /** Backward compatible bound audit runner property. */
    public readonly audit: (
        filePath: string,
        content: string,
        options?: TestModernityOptions,
    ) => Issue[];

    /**
     * Initializes evaluator with customizable test modernity thresholds.
     *
     * @param options - Configuration options.
     */
    public constructor(options: TestModernityOptions = {}) {
        this.options = options;
        this.audit = (
            filePath: string,
            content: string,
            auditOptions?: TestModernityOptions,
        ): Issue[] => this.auditTestSource(filePath, content, auditOptions);
    }

    /**
     * Audits a test source file for test integrity illusions, tautologies, and skipped tests.
     *
     * @param filePath - Path to the test file.
     * @param content - Test file content string.
     * @param options - Configuration options.
     * @returns List of detected issues.
     */
    public auditTestSource(
        filePath: string,
        content: string,
        options?: TestModernityOptions,
    ): Issue[] {
        return auditTestSource(filePath, content, { ...this.options, ...options });
    }

    /**
     * Maps production symbols to tests and computes EMTD and CBCR scores.
     *
     * @param productionGraph - SemanticGraph of production code.
     * @param testSites - List of observed test sites.
     * @param activeTestNloc - Active test non-comment lines of code.
     * @param options - Modernity options.
     * @returns Mapping result.
     */
    public mapBusinessToTests(
        productionGraph: SemanticGraph,
        testSites: TestSite[],
        activeTestNloc?: number,
        options?: TestModernityOptions,
    ): BusinessTestMappingResult {
        return mapBusinessToTests(productionGraph, testSites, activeTestNloc, {
            ...this.options,
            ...options,
        });
    }
}

/** Default singleton instance of TestModernityEvaluator. */
export const defaultTestModernityEvaluator = new TestModernityEvaluator();
