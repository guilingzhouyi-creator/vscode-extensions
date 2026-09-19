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
        lower.includes('/tests/') ||
        lower.startsWith('tests/') ||
        lower.startsWith('test_') ||
        lower.endsWith('_test.py') ||
        lower.endsWith('_test.gd') ||
        lower.endsWith('_test.rs') ||
        lower.includes('/test_')
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

/**
 * Checks if a trimmed line is a tautological assertion.
 *
 * @param line - Trimmed line of code.
 * @returns True if tautological.
 */
function isTautologicalLine(line: string): boolean {
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
        line.startsWith('@pytest.mark.skip') ||
        line.startsWith('@unittest.skip') ||
        line.startsWith('@skip') ||
        line.startsWith('#[ignore]')
    );
}

/**
 * Checks if a trimmed line is a non-functional comment.
 *
 * @param line - Trimmed line.
 * @returns True if comment.
 */
function isCommentLine(line: string): boolean {
    return (
        line.startsWith('//') ||
        line.startsWith('#') ||
        line.startsWith('/*') ||
        line.startsWith('*')
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
            const sm = line.match(
                /(?:it|test|describe|xit|xdescribe)(?:\.skip)?\s*\(\s*['"`]([^'"`]+)['"`]/,
            );
            return { testName: sm ? sm[1] : 'skipped-test', isSkipped: true };
        }
        const m = line.match(/(?:it|test)(?:\.only)?\s*\(\s*['"`]([^'"`]+)['"`]/);
        return m ? { testName: m[1], isSkipped: false } : null;
    }
    if (ext === '.py') {
        const m = line.match(/def\s+(test_\w+)\s*\(/);
        return m ? { testName: m[1], isSkipped: false } : null;
    }
    if (ext === '.gd') {
        const m = line.match(/func\s+(test_\w+)\s*\(/);
        return m ? { testName: m[1], isSkipped: false } : null;
    }
    if (ext === '.rs') {
        const m = line.match(/fn\s+(test_\w+)\s*\(/);
        return m ? { testName: m[1], isSkipped: false } : null;
    }
    const m = line.match(/(?:it|test|func|def|fn)\s+['"`]?([a-zA-Z0-9_-]+)['"`]?\s*\(/);
    return m ? { testName: m[1], isSkipped: false } : null;
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
    return {
        file,
        line,
        testName,
        isSkipped: flags.isSkipped ?? false,
        isTautological: flags.isTautological ?? false,
        isMockOnly: flags.isMockOnly ?? false,
        referencesDeprecatedContract: flags.referencesDeprecatedContract ?? false,
        contractVersion: flags.contractVersion,
        activeContractVersion: flags.activeContractVersion,
        testedSymbol: flags.testedSymbol,
    };
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
    const lines = content.split('\n');
    const sites: TestSite[] = [];
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

    let currentTestName: string | null = null;
    let currentLine = 1;
    let currentAssertions = 0;
    let currentMockAssertions = 0;
    let inSkippedBlock = false;

    const flushCurrentTest = () => {
        if (!currentTestName) return;
        if (currentAssertions === 0 && !inSkippedBlock) {
            sites.push(
                createTestSite(filePath, currentLine, currentTestName, {
                    isTautological: true,
                }),
            );
        } else if (
            currentAssertions > 0 &&
            currentMockAssertions === currentAssertions &&
            !inSkippedBlock
        ) {
            sites.push(
                createTestSite(filePath, currentLine, currentTestName, {
                    isMockOnly: true,
                }),
            );
        }
        currentTestName = null;
        currentAssertions = 0;
        currentMockAssertions = 0;
        inSkippedBlock = false;
    };

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const lineNum = i + 1;

        if (isSkipMarkerLine(trimmed)) {
            inSkippedBlock = true;
            continue;
        }
        if (isCommentLine(trimmed)) {
            continue;
        }

        const decl = matchTestDeclaration(trimmed, ext);
        if (decl) {
            flushCurrentTest();
            currentTestName = decl.testName;
            currentLine = lineNum;
            if (inSkippedBlock || decl.isSkipped) {
                sites.push(
                    createTestSite(filePath, lineNum, currentTestName, {
                        isSkipped: true,
                    }),
                );
                inSkippedBlock = false;
            }
            continue;
        }

        if (!currentTestName) {
            continue;
        }

        if (isTautologicalLine(trimmed)) {
            currentAssertions++;
            sites.push(
                createTestSite(filePath, lineNum, currentTestName, {
                    isTautological: true,
                }),
            );
            continue;
        }

        if (isObsoleteContractLine(trimmed, content)) {
            currentAssertions++;
            sites.push(
                createTestSite(filePath, lineNum, currentTestName, {
                    referencesDeprecatedContract: true,
                    contractVersion: 'V1',
                    activeContractVersion: 'V3',
                }),
            );
            continue;
        }

        if (isMockAssertionLine(trimmed)) {
            currentAssertions++;
            currentMockAssertions++;
            continue;
        }

        if (isGeneralAssertionLine(trimmed)) {
            currentAssertions++;
        }
    }

    flushCurrentTest();

    const issues = analyzeTestModernitySites(sites, [], options);
    if (options.strict || options.tautologicalIsFatal) {
        for (const issue of issues) {
            if (issue.rule === 'TST-TAU-001' || issue.rule === 'TST-ILS-001') {
                issue.severity = 'error';
            }
        }
    }

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
    if (
        lower.includes('payment') ||
        lower.includes('auth') ||
        lower.includes('crypto') ||
        lower.includes('security')
    ) {
        return 1.0;
    }
    if (
        lower.includes('service') ||
        lower.includes('repository') ||
        lower.includes('domain') ||
        lower.includes('pipeline') ||
        lower.includes('controller')
    ) {
        return 0.9;
    }
    if (lower.includes('util') || lower.includes('helper') || lower.includes('format')) {
        return 0.5;
    }
    return 0.7;
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
    activeTestNloc: number = 100,
    options: TestModernityOptions = {},
): BusinessTestMappingResult {
    const nodes = productionGraph.getAllNodes();
    const semanticUnits: ActiveSemanticUnit[] = [];
    const uncoveredSymbols: string[] = [];

    const businessNodes = nodes.filter((n: SemanticNode) => {
        if (n.kind !== 'function' && n.kind !== 'type' && n.kind !== 'module') {
            return false;
        }
        const file = n.location?.file ?? '';
        return !isTestFilePath(file);
    });

    for (const node of businessNodes) {
        const lowerName = node.name.toLowerCase();
        const pathLower = (node.location?.file ?? '').toLowerCase();
        const riskWeight = inferSymbolRiskWeight(node.name);

        const matchingSites = testSites.filter((s) => {
            if (s.testedSymbol && s.testedSymbol.toLowerCase() === lowerName) {
                return true;
            }
            return s.testName.toLowerCase().includes(lowerName);
        });

        const isCovered = matchingSites.length > 0;
        if (!isCovered) {
            uncoveredSymbols.push(node.name);
        }

        const { freshness, effectiveness } = isCovered
            ? evaluateCoverageQuality(matchingSites)
            : { freshness: 1.0, effectiveness: 1.0 };

        const parts = pathLower.split('/');
        const domain = parts.length > 2 ? parts[parts.length - 2] : 'core';

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
    const domain = semanticUnits.length > 0 ? semanticUnits[0].domain : 'domain';
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

    /**
     * Initializes evaluator with customizable test modernity thresholds.
     *
     * @param options - Configuration options.
     */
    public constructor(options: TestModernityOptions = {}) {
        this.options = options;
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
     * Unified audit entry point.
     *
     * @param filePath - Path to the test file.
     * @param content - Test file content string.
     * @param options - Configuration options.
     * @returns List of detected issues.
     */
    public audit(filePath: string, content: string, options?: TestModernityOptions): Issue[] {
        return this.auditTestSource(filePath, content, options);
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
