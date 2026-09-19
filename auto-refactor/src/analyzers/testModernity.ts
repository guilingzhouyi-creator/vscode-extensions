/**
 * Module: Static Analysis — Test Modernity & Business Contract Fulfillment
 * File Path: src/analyzers/testModernity.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects test suites
 *   for effective business risk mitigation, contract freshness, and assertion validity.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), testModernity
 *   intelligence module; triggered when 'test-modernity' analyzer is enabled.
 * Responsibilities: Detect test integrity illusions (TST-ILS-001); detect orphaned skipped
 *   tests (TST-SKP-001); detect tautological assertions (TST-TAU-001); compute EMTD and CBCR
 *   scores (TST-DEN-001); track test debt tickets lacking milestone convergence (TST-DBT-001).
 * Exit Semantics & Design Rationale: Stateless and synchronous per file; returns Issue[] and
 *   never throws.
 */

import * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type {
    ActiveSemanticUnit,
    TestModernityOptions,
    TestSite,
} from '../core/intelligence/testModernity';
import {
    analyzeTestModernitySites,
    computeTestModernityMetrics,
    evaluateTestModernityThresholds,
} from '../core/intelligence/testModernity';

/** Pattern identifying test case declarations for polyglot fallbacks. */
const TEST_DECL_RE =
    /\b(?:it|test|describe|test_case|func\s+test_|def\s+test_)\s*(?:\(\s*['"]([^'"]+)['"]|([A-Za-z0-9_]+))/;

/** Pattern identifying permanently skipped or disabled tests. */
const SKIPPED_TEST_RE =
    /\b(?:\.skip\s*\(|xit\s*\(|xtest\s*\(|@pytest\.mark\.skip|@pytest\.mark\.xfail|@ignore\b)/;

/** Pattern identifying tautological assertions. */
const TAUTOLOGICAL_ASSERT_RE =
    /\b(?:expect\s*\(\s*(true|1|'a'|[a-zA-Z0-9_$]+)\s*\)\.to(?:Be|Equal)\s*\(\s*(?:true|1|'a'|\1)\s*\)|assert\s+(?:True|1\s*==\s*1)\b)/;

/** Pattern identifying assertions that test mock stubs only. */
const MOCK_ONLY_ASSERT_RE =
    /\bexpect\s*\(\s*(?:mock|jest\.fn|stub|spy)[A-Za-z0-9_.]*\)\.(?:toHaveBeenCalled|toBe|toEqual)/;

/** Pattern identifying tests asserting obsolete V1 contract versions. */
const OBSOLETE_CONTRACT_RE =
    /\b(?:v1_contract|legacy_v1_api|contract_v1|apiVersion:\s*['"]v1['"])\b/;

/** Test block names recognized during AST traversal. */
const TEST_BLOCK_NAMES = new Set([
    'it',
    'test',
    'describe',
    'it.skip',
    'test.skip',
    'describe.skip',
    'xit',
    'xtest',
]);

/** Label used when a test declaration has no readable name (line scanner fallback). */
const UNKNOWN_TEST_NAME = 'unknown-test';

/** Matcher names for direct equality comparison. */
const EQUALITY_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual']);

/** Invariant literal strings checked for tautological identity. */
const INVARIANT_CONSTANTS = new Set(['true', 'false', '1', '0']);

/** Non-business test harness symbols ignored during domain symbol inference. */
const IGNORED_TEST_SYMBOLS = new Set(['toBe', 'toEqual', 'toHaveBeenCalled', 'expect']);

interface CaseRecord {
    name: string;
    line: number;
    isSkipped: boolean;
    assertionsCount: number;
    mockAssertionsCount: number;
    tautologicalCount: number;
    obsoleteCount: number;
    testedSymbols: Set<string>;
}

/**
 * Analyzer detecting test integrity illusions and obsolete test suites.
 */
export class TestModernityAnalyzer implements Analyzer {
    name = 'test-modernity' as const;

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        const lowerPath = ctx.filePath.toLowerCase().replace(/\\/g, '/');
        const isTestFile =
            lowerPath.includes('test') ||
            lowerPath.includes('spec') ||
            lowerPath.includes('__tests__') ||
            lowerPath.endsWith('_test.py') ||
            lowerPath.startsWith('test_') ||
            lowerPath.endsWith('_test.gd') ||
            lowerPath.includes('/test_');

        if (!isTestFile) {
            return [];
        }

        const options = (ctx.config.analyzers['test-modernity']?.options ||
            {}) as TestModernityOptions;
        const sites: TestSite[] = [];
        const caseRecords: CaseRecord[] = [];

        if (sf && typeof sf.forEachChild === 'function') {
            this.analyzeWithAst(sf, ctx, sites, caseRecords);
        }

        // If AST traversal yielded nothing (e.g. non-TS file or empty AST),
        // fallback to line scanning
        if (sites.length === 0 && caseRecords.length === 0) {
            this.analyzeWithLines(ctx, sites, caseRecords);
        }

        const issues: Issue[] = analyzeTestModernitySites(sites, [], options);

        // Compute EMTD and CBCR metrics across detected semantic units
        const nloc = this.countNloc(ctx.content);
        const domain = this.inferDomainName(ctx.filePath);
        const units = this.buildSemanticUnits(domain, caseRecords);

        if (units.length > 0) {
            const metrics = computeTestModernityMetrics(units, nloc);
            const densityIssues = evaluateTestModernityThresholds(metrics, domain, options);
            for (const issue of densityIssues) {
                // Point file location to the actual test file
                issue.location.file = ctx.filePath;
                issue.id = `test-modernity:TST-DEN-001:${ctx.filePath}:1`;
                issues.push(issue);
            }
        }

        return issues;
    }

    private analyzeWithAst(
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        sites: TestSite[],
        caseRecords: CaseRecord[],
    ): void {
        let currentCase: CaseRecord | null = null;

        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                const callText = node.expression.getText(sf);
                if (TEST_BLOCK_NAMES.has(callText)) {
                    const previousCase = currentCase;
                    currentCase = this.handleTestBlock(node, callText, sf, ctx, sites, caseRecords);
                    ts.forEachChild(node, visit);
                    currentCase = previousCase;
                    return;
                }

                this.handleAssertion(node, sf, ctx, sites, currentCase);

                // Collect called symbols inside the test case to infer tested domain units
                if (
                    currentCase &&
                    ts.isPropertyAccessExpression(node.expression) &&
                    !IGNORED_TEST_SYMBOLS.has(node.expression.name.text)
                ) {
                    currentCase.testedSymbols.add(node.expression.name.text);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sf);

        // Evaluate whether any case is mock-only overall
        for (const c of caseRecords) {
            if (c.assertionsCount > 0 && c.mockAssertionsCount === c.assertionsCount) {
                // All assertions were mock-only
                const alreadyReported = sites.some(
                    (s) => s.line === c.line && s.testName === c.name && s.isMockOnly,
                );
                if (!alreadyReported) {
                    sites.push({
                        file: ctx.filePath,
                        line: c.line,
                        testName: c.name,
                        isSkipped: false,
                        isTautological: false,
                        isMockOnly: true,
                        referencesDeprecatedContract: false,
                    });
                }
            }
        }
    }

    /**
     * Process a test block declaration call, extracting case name and skipped state.
     */
    private handleTestBlock(
        node: ts.CallExpression,
        callText: string,
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        sites: TestSite[],
        caseRecords: CaseRecord[],
    ): CaseRecord {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        let testName = 'anonymous-test';
        if (node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
            testName = (node.arguments[0] as ts.StringLiteralLike).text;
        }

        const isSkipped = callText.includes('skip') || callText.startsWith('x');
        const caseRecord: CaseRecord = {
            name: testName,
            line,
            isSkipped,
            assertionsCount: 0,
            mockAssertionsCount: 0,
            tautologicalCount: 0,
            obsoleteCount: 0,
            testedSymbols: new Set(),
        };

        caseRecords.push(caseRecord);

        if (isSkipped) {
            sites.push({
                file: ctx.filePath,
                line,
                testName,
                isSkipped: true,
                isTautological: false,
                isMockOnly: false,
                referencesDeprecatedContract: false,
            });
        }

        return caseRecord;
    }

    /**
     * Handle an assertion call expression and classify integrity indicators.
     */
    private handleAssertion(
        node: ts.CallExpression,
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        sites: TestSite[],
        currentCase: CaseRecord | null,
    ): void {
        // Inner expect(...) chained into matchers (.toBe/.toHaveBeenCalled)
        // is the subject, not the assertion
        if (node.expression.getText(sf) === 'expect') {
            return;
        }

        const text = node.getText(sf);
        const isAssertCall =
            text.startsWith('expect(') || text.startsWith('assert(') || text.startsWith('assert.');
        if (!isAssertCall) {
            return;
        }

        if (currentCase) {
            currentCase.assertionsCount++;
        }

        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const testName = currentCase?.name || 'unknown-test';

        this.checkAssertionIntegrity(node, sf, ctx, sites, currentCase, line, testName);
    }

    /**
     * Check assertion call integrity for tautological, mock-only, or deprecated contracts.
     */
    private checkAssertionIntegrity(
        node: ts.CallExpression,
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        sites: TestSite[],
        currentCase: CaseRecord | null,
        line: number,
        testName: string,
    ): void {
        if (this.checkTautological(node, sf)) {
            if (currentCase) currentCase.tautologicalCount++;
            sites.push({
                file: ctx.filePath,
                line,
                testName,
                isSkipped: false,
                isTautological: true,
                isMockOnly: false,
                referencesDeprecatedContract: false,
            });
            return;
        }

        if (this.checkMockAssertion(node, sf)) {
            if (currentCase) currentCase.mockAssertionsCount++;
        }

        if (OBSOLETE_CONTRACT_RE.test(node.getText(sf))) {
            if (currentCase) currentCase.obsoleteCount++;
            sites.push({
                file: ctx.filePath,
                line,
                testName,
                isSkipped: false,
                isTautological: false,
                isMockOnly: false,
                referencesDeprecatedContract: true,
                contractVersion: 'V1',
                activeContractVersion: 'V3',
            });
        }
    }

    /**
     * Determine if an assertion is tautological (comparing invariant or identical operands).
     */
    private checkTautological(node: ts.CallExpression, sf: ts.SourceFile): boolean {
        if (!ts.isPropertyAccessExpression(node.expression)) {
            if (node.expression.getText(sf) === 'assert' && node.arguments.length > 0) {
                const arg = node.arguments[0].getText(sf).replace(/\s+/g, '');
                return arg === 'true' || arg === '1===1' || arg === '1==1';
            }
            return false;
        }

        const method = node.expression.name.text;
        if (!EQUALITY_MATCHERS.has(method) || !ts.isCallExpression(node.expression.expression)) {
            return false;
        }

        const innerCall = node.expression.expression;
        if (
            innerCall.expression.getText(sf) !== 'expect' ||
            innerCall.arguments.length === 0 ||
            node.arguments.length === 0
        ) {
            return false;
        }

        const actual = innerCall.arguments[0].getText(sf).trim();
        const expected = node.arguments[0].getText(sf).trim();
        // An assertion whose two sides are both invariant literals verifies nothing beyond the
        // language itself, so it is as tautological as comparing a value with itself.
        const bothInvariant = INVARIANT_CONSTANTS.has(actual) && INVARIANT_CONSTANTS.has(expected);
        return actual === expected || bothInvariant;
    }

    /**
     * Determine if an assertion verifies mock configuration instead of business state.
     */
    private checkMockAssertion(node: ts.CallExpression, sf: ts.SourceFile): boolean {
        if (!ts.isPropertyAccessExpression(node.expression)) {
            return false;
        }
        const method = node.expression.name.text;
        if (method.startsWith('toHaveBeenCalled') || method.startsWith('toBeCalled')) {
            return true;
        }
        if (ts.isCallExpression(node.expression.expression)) {
            const inner = node.expression.expression;
            if (inner.arguments.length > 0) {
                const argText = inner.arguments[0].getText(sf).toLowerCase();
                return (
                    argText.includes('mock') || argText.includes('stub') || argText.includes('spy')
                );
            }
        }
        return false;
    }

    private analyzeWithLines(
        ctx: AnalyzerContext,
        sites: TestSite[],
        caseRecords: CaseRecord[],
    ): void {
        const lines = ctx.content.split('\n');
        let currentTestName = UNKNOWN_TEST_NAME;
        let currentCase: CaseRecord | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            const declMatch = line.match(TEST_DECL_RE);
            if (declMatch) {
                currentTestName = declMatch[1] || declMatch[2] || UNKNOWN_TEST_NAME;
                currentCase = {
                    name: currentTestName,
                    line: lineNum,
                    isSkipped: false,
                    assertionsCount: 0,
                    mockAssertionsCount: 0,
                    tautologicalCount: 0,
                    obsoleteCount: 0,
                    testedSymbols: new Set(),
                };
                caseRecords.push(currentCase);
            }

            const isSkipped = SKIPPED_TEST_RE.test(line);
            const isTautological = TAUTOLOGICAL_ASSERT_RE.test(line);
            const isMockOnly = MOCK_ONLY_ASSERT_RE.test(line);
            const isObsolete = OBSOLETE_CONTRACT_RE.test(line);

            if (currentCase) {
                if (line.includes('assert') || line.includes('expect')) {
                    currentCase.assertionsCount++;
                }
                if (isMockOnly) currentCase.mockAssertionsCount++;
                if (isTautological) currentCase.tautologicalCount++;
                if (isObsolete) currentCase.obsoleteCount++;
            }

            if (isSkipped || isTautological || isMockOnly || isObsolete) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    testName: currentTestName,
                    isSkipped,
                    isTautological,
                    isMockOnly,
                    referencesDeprecatedContract: isObsolete,
                    contractVersion: isObsolete ? 'V1' : undefined,
                    activeContractVersion: isObsolete ? 'V3' : undefined,
                });
            }
        }
    }

    private countNloc(content: string): number {
        const lines = content.split('\n');
        let nloc = 0;
        let inBlockComment = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (inBlockComment) {
                if (trimmed.includes('*/')) inBlockComment = false;
                continue;
            }
            if (trimmed.startsWith('/*')) {
                if (!trimmed.includes('*/')) inBlockComment = true;
                continue;
            }
            if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }
            nloc++;
        }
        return nloc;
    }

    private inferDomainName(filePath: string): string {
        const norm = filePath.replace(/\\/g, '/');
        const filename = norm.split('/').pop() || 'unknown';
        return filename
            .replace(/^(?:test_|fe_\d+_)/, '')
            .replace(/(?:\.test|\.spec|_test)?\.[a-z]+$/, '');
    }

    private buildSemanticUnits(domain: string, cases: CaseRecord[]): ActiveSemanticUnit[] {
        const units: ActiveSemanticUnit[] = [];

        if (cases.length === 0) {
            return units;
        }

        for (const c of cases) {
            const isEffective =
                !c.isSkipped &&
                c.tautologicalCount === 0 &&
                (c.assertionsCount === 0 || c.mockAssertionsCount < c.assertionsCount);
            const isFresh = c.obsoleteCount === 0;

            if (c.testedSymbols.size > 0) {
                for (const sym of c.testedSymbols) {
                    units.push({
                        id: `${domain}:${sym}`,
                        domain,
                        riskWeight: 0.8,
                        isCovered: isEffective,
                        freshness: isFresh ? 1.0 : 0.3,
                        effectiveness: isEffective ? 0.9 : 0.1,
                        uniqueness: 1.0,
                    });
                }
            } else {
                units.push({
                    id: `${domain}:${c.name}`,
                    domain,
                    riskWeight: 0.7,
                    isCovered: isEffective,
                    freshness: isFresh ? 1.0 : 0.4,
                    effectiveness: isEffective ? 0.8 : 0.1,
                    uniqueness: 1.0,
                });
            }
        }

        return units;
    }
}
