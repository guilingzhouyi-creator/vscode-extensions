/**
 * Module: Static Analysis — Test Modernity & Business Contract Fulfillment
 * File Path: src/analyzers/testModernity.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects test suites
 *   for effective business risk mitigation, contract freshness, and assertion validity.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), testModernity
 *   intelligence module; triggered when 'test-modernity' analyzer is enabled.
 * Responsibilities: Detect test integrity illusions (TST-ILS-001); detect orphaned skipped
 *   tests (TST-SKP-001); detect tautological assertions (TST-TAU-001); track test debt tickets
 *   lacking milestone convergence (TST-DBT-001).
 * Exit Semantics & Design Rationale: Stateless and synchronous per file; returns Issue[] and
 *   never throws.
 */

import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type { TestModernityOptions, TestSite } from '../core/intelligence/testModernity';
import { analyzeTestModernitySites } from '../core/intelligence/testModernity';

/** Pattern identifying test case declarations. */
const TEST_DECL_RE = /\b(?:it|test|describe|test_case)\s*\(\s*['"]([^'"]+)['"]/;

/** Pattern identifying permanently skipped or disabled tests. */
const SKIPPED_TEST_RE = /\b(?:\.skip\s*\(|xit\s*\(|xtest\s*\(|@pytest\.mark\.skip|@ignore\b)/;

/** Pattern identifying tautological assertions. */
const TAUTOLOGICAL_ASSERT_RE =
    /\b(?:expect\s*\(\s*(?:true|1|'a')\s*\)\.to(?:Be|Equal)\s*\(\s*(?:true|1|'a')\s*\)|assert\s+(?:True|1\s*==\s*1)\b)/;

/** Pattern identifying assertions that test mock stubs only. */
const MOCK_ONLY_ASSERT_RE =
    /\bexpect\s*\(\s*(?:mock|jest\.fn|stub|spy)[A-Za-z0-9_.]*\)\.(?:toHaveBeenCalled|toBe|toEqual)/;

/** Pattern identifying tests asserting obsolete V1 contract versions. */
const OBSOLETE_CONTRACT_RE =
    /\b(?:v1_contract|legacy_v1_api|contract_v1|apiVersion:\s*['"]v1['"])\b/;

/**
 * Analyzer detecting test integrity illusions and obsolete test suites.
 */
export class TestModernityAnalyzer implements Analyzer {
    name = 'test-modernity' as const;

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        void sf;
        // Only run on test files
        const lowerPath = ctx.filePath.toLowerCase();
        const isTestFile =
            lowerPath.includes('test') ||
            lowerPath.includes('spec') ||
            lowerPath.includes('__tests__') ||
            lowerPath.endsWith('_test.py') ||
            lowerPath.endsWith('_test.gd');

        if (!isTestFile) {
            return [];
        }

        const options = (ctx.config.analyzers['test-modernity']?.options ||
            {}) as TestModernityOptions;
        const lines = ctx.content.split('\n');
        const sites: TestSite[] = [];
        let currentTestName = 'unknown-test';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            const declMatch = line.match(TEST_DECL_RE);
            if (declMatch) {
                currentTestName = declMatch[1];
            }

            const isSkipped = SKIPPED_TEST_RE.test(line);
            const isTautological = TAUTOLOGICAL_ASSERT_RE.test(line);
            const isMockOnly = MOCK_ONLY_ASSERT_RE.test(line);
            const isObsolete = OBSOLETE_CONTRACT_RE.test(line);

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

        return analyzeTestModernitySites(sites, [], options);
    }
}
