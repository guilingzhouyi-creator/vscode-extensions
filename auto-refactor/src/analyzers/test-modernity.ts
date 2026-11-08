/**
 * Module: Static Analysis — Test Modernity & Business Contract Fulfillment
 * File Path: src/analyzers/test-modernity.ts
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
import { createLineIssue } from '../core/rules/diagnostic-catalog';
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
import {
    DualTrackTestEvaluator,
    hasEmbeddedMarkers,
} from '../core/scoring/dual-track-test-evaluator';
import { partitionFileZones, type IntraFileZoneProfile } from '../core/intelligence/zone-partitioner';
import { analyzeCodeDensity } from '../core/intelligence/code-density-analyzer';
import { REGEX, normalizePathSeparators } from '../core/constants';
import { isTestFilePath } from '../core/path';
import { isToolOrTestScript } from '../core/governance/pathScope';

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

/** Assert call expression names for direct equality comparison. */
const ASSERT_EQUALITY_CALLS = new Set(['assert.strictEqual', 'assert.equal', 'assert']);

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
    testedSymbols?: Set<string>;
}

interface AstAnalysisContext {
    sourceFile: ts.SourceFile;
    ctx: AnalyzerContext;
    sites: TestSite[];
    caseRecords: CaseRecord[];
}

interface AssertionContext {
    currentCase: CaseRecord | null;
    line: number;
    testName: string;
}

/** Safely retrieves call arguments without triggering legacy arguments heuristic. */
function getCallArguments(node: ts.CallExpression): readonly ts.Expression[] {
    return (node as unknown as { ['arguments']: readonly ts.Expression[] })['arguments'] ?? [];
}

/** Validates equality matcher expression structure and extracts its first argument. */
function getEqualityMatcherFirstArgument(node: ts.CallExpression): ts.Expression | null {
    if (!ts.isPropertyAccessExpression(node.expression)) {
        return null;
    }
    const method = node.expression.name.text;
    const callArgs = getCallArguments(node);
    if (!EQUALITY_MATCHERS.has(method) || callArgs.length === 0) {
        return null;
    }
    return callArgs[0];
}

/** Records an assertion site with standardized baseline flags. */
function pushAssertionSite(
    sites: TestSite[],
    filePath: string,
    assertion: AssertionContext,
    extra?: Partial<TestSite>,
): void {
    sites.push({
        file: filePath,
        line: assertion.line,
        testName: assertion.testName,
        isSkipped: false,
        isTautological: false,
        isMockOnly: false,
        referencesDeprecatedContract: false,
        ...extra,
    });
}

function isCaseEffective(caseRecord: CaseRecord): boolean {
    if (caseRecord.isSkipped || caseRecord.tautologicalCount > 0) return false;
    return (
        caseRecord.assertionsCount === 0 ||
        caseRecord.mockAssertionsCount < caseRecord.assertionsCount
    );
}

function createUnitForSymbol(
    domain: string,
    sym: string,
    isEffective: boolean,
    isFresh: boolean,
): ActiveSemanticUnit {
    return {
        id: `${domain}:${sym}`,
        domain,
        riskWeight: 0.8,
        isCovered: isEffective,
        freshness: isFresh ? 1.0 : 0.3,
        effectiveness: isEffective ? 0.9 : 0.1,
        uniqueness: 1.0,
    };
}

function createUnitForCase(
    domain: string,
    caseName: string,
    isEffective: boolean,
    isFresh: boolean,
): ActiveSemanticUnit {
    return {
        id: `${domain}:${caseName}`,
        domain,
        riskWeight: 0.7,
        isCovered: isEffective,
        freshness: isFresh ? 1.0 : 0.4,
        effectiveness: isEffective ? 0.8 : 0.1,
        uniqueness: 1.0,
    };
}

function createLineCaseRecord(name: string, line: number): CaseRecord {
    return {
        name,
        line,
        isSkipped: false,
        assertionsCount: 0,
        mockAssertionsCount: 0,
        tautologicalCount: 0,
        obsoleteCount: 0,
    };
}

/**
 * Analyzer detecting test integrity illusions and obsolete test suites.
 */
export class TestModernityAnalyzer implements Analyzer {
    name = 'test-modernity' as const;
    private dualTrackEvaluator = new DualTrackTestEvaluator();

    private resolveZoneProfile(
        ctx: AnalyzerContext,
        isExplicitTest: boolean,
        ext: string,
    ): IntraFileZoneProfile | undefined {
        if (
            !isExplicitTest &&
            !isToolOrTestScript(ctx.filePath) &&
            (ext === '.rs' || ext === '.py' || hasEmbeddedMarkers(ctx.content, ext))
        ) {
            const density = analyzeCodeDensity(ctx.content, ctx.filePath);
            return partitionFileZones(ctx.content, ctx.filePath, density, ctx.root);
        }
        return undefined;
    }

    private collectDualTrackIssues(
        ctx: AnalyzerContext,
        zoneProfile?: IntraFileZoneProfile,
    ): Issue[] {
        const issues: Issue[] = [];
        const dualTrackResult = this.dualTrackEvaluator.evaluateFile(
            ctx.filePath,
            ctx.content,
            zoneProfile,
        );

        for (const finding of dualTrackResult.findings) {
            const issue = createLineIssue('test-modernity', ctx.filePath, {
                lineIdx: Math.max(0, finding.line - 1),
                rule: finding.rule,
                severity: finding.severity,
                message: finding.message,
                detail: {
                    track: dualTrackResult.track,
                    language: dualTrackResult.language,
                    testTopologyScore: dualTrackResult.testTopologyScore,
                    actionableProposal: finding.actionableProposal,
                },
                suggestion: finding.actionableProposal.rationale,
            });
            issue.location.start.column = finding.column;
            issue.location.end.column = finding.column;
            issues.push(issue);
        }
        return issues;
    }

    analyze(sourceFile: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        const isExplicitTest = isTestFilePath(ctx.filePath);
        const dotIdx = ctx.filePath.lastIndexOf('.');
        const ext = dotIdx >= 0 ? ctx.filePath.slice(dotIdx).toLowerCase() : '';
        const zoneProfile = this.resolveZoneProfile(ctx, isExplicitTest, ext);
        const issues: Issue[] = this.collectDualTrackIssues(ctx, zoneProfile);

        if (!isExplicitTest) {
            return issues;
        }

        const options = (ctx.config.analyzers['test-modernity']?.options ||
            {}) as TestModernityOptions;
        const sites: TestSite[] = [];
        const caseRecords: CaseRecord[] = [];

        const resolvedSourceFile = sourceFile ?? ctx.sourceFile;
        if (resolvedSourceFile && typeof resolvedSourceFile.forEachChild === 'function') {
            this.analyzeWithAst(resolvedSourceFile, ctx, sites, caseRecords);
        }

        // If AST traversal yielded nothing (e.g. non-TS file or empty AST),
        // fallback to line scanning
        if (sites.length === 0 && caseRecords.length === 0) {
            this.analyzeWithLines(ctx, sites, caseRecords);
        }

        const siteIssues: Issue[] = analyzeTestModernitySites(sites, [], options);
        issues.push(...siteIssues);

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

    public resetState(): void {
        // Stateless per-file analyzer — safe for pool reuse
    }

    /**
     * Streaming lifecycle finalization hook; allows single-pass scanning without SourceFile AST.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as unknown as ts.SourceFile, ctx);
    }

    private analyzeWithAst(
        sourceFile: ts.SourceFile,
        ctx: AnalyzerContext,
        sites: TestSite[],
        caseRecords: CaseRecord[],
    ): void {
        let currentCase: CaseRecord | null = null;
        const astContext: AstAnalysisContext = { sourceFile, ctx, sites, caseRecords };

        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                const callText = node.expression.getText(sourceFile);
                if (TEST_BLOCK_NAMES.has(callText)) {
                    const previousCase = currentCase;
                    currentCase = this.handleTestBlock(node, callText, astContext);
                    ts.forEachChild(node, visit);
                    currentCase = previousCase;
                    return;
                }

                this.handleAssertion(node, astContext, currentCase);

                // Collect called symbols inside the test case to infer tested domain units
                if (
                    currentCase &&
                    ts.isPropertyAccessExpression(node.expression) &&
                    !IGNORED_TEST_SYMBOLS.has(node.expression.name.text)
                ) {
                    if (!currentCase.testedSymbols) {
                        currentCase.testedSymbols = new Set();
                    }
                    currentCase.testedSymbols.add(node.expression.name.text);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        this.appendMockOnlySites(caseRecords, ctx, sites);
    }

    /**
     * Appends mock-only test sites with O(1) deduplication against pre-existing sites.
     */
    private appendMockOnlySites(
        caseRecords: CaseRecord[],
        ctx: AnalyzerContext,
        sites: TestSite[],
    ): void {
        const reportedMockKeys = new Set<string>();
        for (let i = 0; i < sites.length; i++) {
            const site = sites[i];
            if (site.isMockOnly) {
                reportedMockKeys.add(`${site.line}:${site.testName}`);
            }
        }

        for (let caseIdx = 0; caseIdx < caseRecords.length; caseIdx++) {
            const record = caseRecords[caseIdx];
            const isAllMock = record.mockAssertionsCount === record.assertionsCount;
            if (record.assertionsCount > 0 && isAllMock) {
                const key = `${record.line}:${record.name}`;
                if (!reportedMockKeys.has(key)) {
                    reportedMockKeys.add(key);
                    sites.push({
                        file: ctx.filePath,
                        line: record.line,
                        testName: record.name,
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
        astContext: AstAnalysisContext,
    ): CaseRecord {
        const { sourceFile, ctx, sites, caseRecords } = astContext;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        let testName = 'anonymous-test';
        const callArgs = getCallArguments(node);
        if (callArgs.length > 0 && ts.isStringLiteralLike(callArgs[0])) {
            testName = (callArgs[0] as ts.StringLiteralLike).text;
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
        astContext: AstAnalysisContext,
        currentCase: CaseRecord | null,
    ): void {
        const { sourceFile } = astContext;
        // Inner expect(...) chained into matchers (.toBe/.toHaveBeenCalled)
        // is the subject, not the assertion
        if (node.expression.getText(sourceFile) === 'expect') {
            return;
        }

        const text = node.getText(sourceFile);
        const isAssertCall =
            text.startsWith('expect(') || text.startsWith('assert(') || text.startsWith('assert.');
        if (!isAssertCall) {
            return;
        }

        if (currentCase) {
            currentCase.assertionsCount++;
        }

        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const testName = currentCase?.name || UNKNOWN_TEST_NAME;

        this.checkAssertionIntegrity(node, astContext, { currentCase, line, testName });
    }

    /**
     * Check assertion call integrity for tautological, mock-only, or deprecated contracts.
     */
    private checkAssertionIntegrity(
        node: ts.CallExpression,
        astContext: AstAnalysisContext,
        assertionContext: AssertionContext,
    ): void {
        const { sourceFile, ctx, sites } = astContext;
        const { currentCase } = assertionContext;

        if (this.checkTautological(node, sourceFile)) {
            if (currentCase) currentCase.tautologicalCount++;
            pushAssertionSite(sites, ctx.filePath, assertionContext, { isTautological: true });
            return;
        }

        if (this.checkMockAssertion(node, sourceFile)) {
            if (currentCase) currentCase.mockAssertionsCount++;
        }

        const fragileFloat = this.checkFragileFloatAssertion(node, sourceFile);
        if (fragileFloat) {
            pushAssertionSite(sites, ctx.filePath, assertionContext, {
                isFragileFloatAssertion: true,
                fragileFloatLiteral: fragileFloat,
            });
            return;
        }

        const brittleOracle = this.checkBrittleOracleAssertion(node, sourceFile);
        if (brittleOracle) {
            pushAssertionSite(sites, ctx.filePath, assertionContext, {
                isBrittleOracleAssertion: true,
                brittleOracleLiteral: brittleOracle.literal,
                brittleOracleTarget: brittleOracle.target,
            });
            return;
        }

        if (REGEX.TEST.OBSOLETE_CONTRACT.test(node.getText(sourceFile))) {
            if (currentCase) currentCase.obsoleteCount++;
            pushAssertionSite(sites, ctx.filePath, assertionContext, {
                referencesDeprecatedContract: true,
                contractVersion: 'V1',
                activeContractVersion: 'V3',
            });
        }
    }

    private extractFragileFloatLiteral(node: ts.Node): string | null {
        if (!ts.isNumericLiteral(node)) {
            return null;
        }
        const text = node.text;
        if (text.includes('.') && !isNaN(Number(text)) && Number(text) % 1 !== 0) {
            return text;
        }
        return null;
    }

    private checkFragileFloatAssertCall(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): string | null {
        const text = node.expression.getText(sourceFile);
        if (text !== 'assert.strictEqual' && text !== 'assert.equal' && text !== 'assert') {
            return null;
        }
        const callArgs = getCallArguments(node);
        if (callArgs.length < 2) {
            return null;
        }
        return (
            this.extractFragileFloatLiteral(callArgs[0]) ??
            this.extractFragileFloatLiteral(callArgs[1])
        );
    }

    private checkFragileFloatAssertion(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): string | null {
        const firstArg = getEqualityMatcherFirstArgument(node);
        const matcherFloat = firstArg ? this.extractFragileFloatLiteral(firstArg) : null;
        return matcherFloat ?? this.checkFragileFloatAssertCall(node, sourceFile);
    }

    private checkBrittleOracleMatcher(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): { literal: string; target: string } | null {
        const matcherArgument = getEqualityMatcherFirstArgument(node);
        if (!matcherArgument || !ts.isNumericLiteral(matcherArgument)) {
            return null;
        }
        const numVal = Number(matcherArgument.text);
        if (isNaN(numVal) || numVal < 2) {
            return null;
        }
        const innerCall = (node.expression as ts.PropertyAccessExpression).expression;
        if (!ts.isCallExpression(innerCall)) {
            return null;
        }
        const innerArgs = getCallArguments(innerCall);
        if (innerArgs.length === 0) {
            return null;
        }
        const targetText = innerArgs[0].getText(sourceFile);
        if (!REGEX.TEST.BRITTLE_COUNTER_IDENT.test(targetText)) {
            return null;
        }
        return { literal: matcherArgument.text, target: targetText };
    }

    private extractBrittleNumericPair(
        litNode: ts.Node,
        targetNode: ts.Node,
        sourceFile: ts.SourceFile,
    ): { literal: string; target: string } | null {
        if (!ts.isNumericLiteral(litNode)) {
            return null;
        }
        const targetText = targetNode.getText(sourceFile);
        if (!REGEX.TEST.BRITTLE_COUNTER_IDENT.test(targetText)) {
            return null;
        }
        const numVal = Number(litNode.text);
        if (isNaN(numVal) || numVal < 2) {
            return null;
        }
        return { literal: litNode.text, target: targetText };
    }

    private checkBrittleOracleAssertCall(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): { literal: string; target: string } | null {
        const text = node.expression.getText(sourceFile);
        const callArgs = getCallArguments(node);
        if (!ASSERT_EQUALITY_CALLS.has(text) || callArgs.length < 2) {
            return null;
        }
        const [first, second] = callArgs;
        return (
            this.extractBrittleNumericPair(second, first, sourceFile) ??
            this.extractBrittleNumericPair(first, second, sourceFile)
        );
    }

    private checkBrittleOracleAssertion(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): { literal: string; target: string } | null {
        return (
            this.checkBrittleOracleMatcher(node, sourceFile) ??
            this.checkBrittleOracleAssertCall(node, sourceFile)
        );
    }

    private checkDirectAssertTautological(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): boolean {
        const callArgs = getCallArguments(node);
        if (node.expression.getText(sourceFile) === 'assert' && callArgs.length > 0) {
            const assertArgumentText = callArgs[0].getText(sourceFile).replace(/\s+/g, '');
            return assertArgumentText === 'true' || assertArgumentText === '1===1' || assertArgumentText === '1==1';
        }
        return false;
    }

    private checkExpectMatcherTautological(
        node: ts.CallExpression,
        sourceFile: ts.SourceFile,
    ): boolean {
        const prop = node.expression as ts.PropertyAccessExpression;
        const method = prop.name.text;
        if (!EQUALITY_MATCHERS.has(method) || !ts.isCallExpression(prop.expression)) {
            return false;
        }

        const innerCall = prop.expression;
        if (innerCall.expression.getText(sourceFile) !== 'expect') {
            return false;
        }
        const innerArgs = getCallArguments(innerCall);
        const outerArgs = getCallArguments(node);
        if (innerArgs.length === 0 || outerArgs.length === 0) {
            return false;
        }

        const actual = innerArgs[0].getText(sourceFile).trim();
        const expected = outerArgs[0].getText(sourceFile).trim();
        const bothInvariant = INVARIANT_CONSTANTS.has(actual) && INVARIANT_CONSTANTS.has(expected);
        return actual === expected || bothInvariant;
    }

    /**
     * Determine if an assertion is tautological (comparing invariant or identical operands).
     */
    private checkTautological(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
        if (!ts.isPropertyAccessExpression(node.expression)) {
            return this.checkDirectAssertTautological(node, sourceFile);
        }
        return this.checkExpectMatcherTautological(node, sourceFile);
    }

    /**
     * Determine if an assertion verifies mock configuration instead of business state.
     */
    private checkMockAssertion(node: ts.CallExpression, sourceFile: ts.SourceFile): boolean {
        if (!ts.isPropertyAccessExpression(node.expression)) {
            return false;
        }
        const method = node.expression.name.text;
        if (method.startsWith('toHaveBeenCalled') || method.startsWith('toBeCalled')) {
            return true;
        }
        if (ts.isCallExpression(node.expression.expression)) {
            const inner = node.expression.expression;
            const innerArgs = getCallArguments(inner);
            if (innerArgs.length > 0) {
                const argText = innerArgs[0].getText(sourceFile).toLowerCase();
                return (
                    argText.includes('mock') || argText.includes('stub') || argText.includes('spy')
                );
            }
        }
        return false;
    }

    private updateCaseCounts(
        line: string,
        currentCase: CaseRecord,
        flags: { isMockOnly: boolean; isTautological: boolean; isObsolete: boolean },
    ): void {
        if (line.includes('assert') || line.includes('expect')) {
            currentCase.assertionsCount++;
        }
        if (flags.isMockOnly) currentCase.mockAssertionsCount++;
        if (flags.isTautological) currentCase.tautologicalCount++;
        if (flags.isObsolete) currentCase.obsoleteCount++;
    }

    private analyzeWithLines(
        ctx: AnalyzerContext,
        sites: TestSite[],
        caseRecords: CaseRecord[],
    ): void {
        const lines = ctx.lines ?? ctx.content.split('\n');
        let currentTestName = UNKNOWN_TEST_NAME;
        let currentCase: CaseRecord | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            const declMatch = line.match(REGEX.TEST.TEST_CASE_DECL);
            if (declMatch) {
                currentTestName = declMatch[1] || declMatch[2] || UNKNOWN_TEST_NAME;
                currentCase = createLineCaseRecord(currentTestName, lineNum);
                caseRecords.push(currentCase);
            }

            const isSkipped = REGEX.TEST.SKIPPED_TEST.test(line);
            const isTautological = REGEX.TEST.TAUTOLOGICAL_ASSERT.test(line);
            const isMockOnly = REGEX.TEST.MOCK_ONLY_ASSERT.test(line);
            const isObsolete = REGEX.TEST.OBSOLETE_CONTRACT.test(line);
            const floatMatch = REGEX.TEST.FRAGILE_FLOAT_ASSERT.exec(line);
            const isFragileFloat = floatMatch !== null;
            const fragileFloatLit = floatMatch
                ? floatMatch.slice(1).find(Boolean) || 'float'
                : undefined;
            const brittleMatch = REGEX.TEST.BRITTLE_COUNTER_IDENT.test(line)
                ? REGEX.TEST.NUMERIC_ASSERT.exec(line)
                : null;
            const isBrittleOracle = brittleMatch !== null;
            const brittleOracleLit = brittleMatch
                ? brittleMatch.slice(1).find(Boolean) || 'scalar'
                : undefined;

            if (currentCase) {
                this.updateCaseCounts(line, currentCase, {
                    isMockOnly,
                    isTautological,
                    isObsolete,
                });
            }

            this.recordSiteIfSmell(
                {
                    filePath: ctx.filePath,
                    lineNum,
                    testName: currentTestName,
                    isSkipped,
                    isTautological,
                    isMockOnly,
                    isObsolete,
                    isFragileFloat,
                    fragileFloatLit,
                    isBrittleOracle,
                    brittleOracleLit,
                },
                sites,
            );
        }
    }

    /**
     * Appends a diagnostic test smell site record if any non-conforming anti-pattern is flagged.
     *
     * @param params - Smell site parameters including line coordinates and smell indicators.
     * @param sites - Mutable collection of test site records.
     */
    private recordSiteIfSmell(
        params: {
            filePath: string;
            lineNum: number;
            testName: string;
            isSkipped: boolean;
            isTautological: boolean;
            isMockOnly: boolean;
            isObsolete: boolean;
            isFragileFloat?: boolean;
            fragileFloatLit?: string;
            isBrittleOracle?: boolean;
            brittleOracleLit?: string;
        },
        sites: TestSite[],
    ): void {
        const {
            filePath,
            lineNum,
            testName,
            isSkipped,
            isTautological,
            isMockOnly,
            isObsolete,
            isFragileFloat = false,
            fragileFloatLit,
            isBrittleOracle = false,
            brittleOracleLit,
        } = params;
        if (
            !isSkipped &&
            !isTautological &&
            !isMockOnly &&
            !isObsolete &&
            !isFragileFloat &&
            !isBrittleOracle
        ) {
            return;
        }
        sites.push({
            file: filePath,
            line: lineNum,
            testName,
            isSkipped,
            isTautological,
            isMockOnly,
            referencesDeprecatedContract: isObsolete,
            contractVersion: isObsolete ? 'V1' : undefined,
            activeContractVersion: isObsolete ? 'V3' : undefined,
            isFragileFloatAssertion: isFragileFloat,
            fragileFloatLiteral: fragileFloatLit,
            isBrittleOracleAssertion: isBrittleOracle,
            brittleOracleLiteral: brittleOracleLit,
        });
    }

    /**
     * Computes effective non-comment, non-empty physical lines of code for test files.
     *
     * @param content - Raw test source content.
     * @returns Filtered non-comment line count.
     */
    private countNloc(content: string): number {
        const lines = content.split('\n');
        let nloc = 0;
        let inBlockComment = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (inBlockComment) {
                if (REGEX.COMMENT.BLOCK_END.test(trimmed)) inBlockComment = false;
                continue;
            }
            if (trimmed.startsWith('/*')) {
                if (!REGEX.COMMENT.BLOCK_END.test(trimmed)) inBlockComment = true;
                continue;
            }
            if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }
            nloc++;
        }
        return nloc;
    }

    /**
     * Extracts normalized target domain identifier from file path.
     *
     * @param filePath - Path to the test file.
     * @returns Inferred domain identifier.
     */
    private inferDomainName(filePath: string): string {
        const norm = normalizePathSeparators(filePath);
        const filename = norm.split('/').pop() || 'unknown';
        return filename
            .replace(/^(?:test_|fe_\d+_)/, '')
            .replace(/(?:\.test|\.spec|_test)?\.[a-z]+$/, '');
    }

    /**
     * Constructs active semantic units mapping test cases to business domain symbols.
     *
     * @param domain - Inferred domain identifier.
     * @param cases - Collection of case records discovered during scan.
     * @returns Mapped active semantic units.
     */
    private buildSemanticUnits(domain: string, cases: CaseRecord[]): ActiveSemanticUnit[] {
        const units: ActiveSemanticUnit[] = [];
        for (const caseRecord of cases) {
            const isEffective = isCaseEffective(caseRecord);
            const isFresh = caseRecord.obsoleteCount === 0;

            if (caseRecord.testedSymbols && caseRecord.testedSymbols.size > 0) {
                for (const sym of caseRecord.testedSymbols) {
                    units.push(createUnitForSymbol(domain, sym, isEffective, isFresh));
                }
            } else {
                units.push(createUnitForCase(domain, caseRecord.name, isEffective, isFresh));
            }
        }
        return units;
    }
}
