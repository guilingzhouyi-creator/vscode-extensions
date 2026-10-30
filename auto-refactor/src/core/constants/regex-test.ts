/**
 * Module: Core Constants — Test & Modernity Regular Expression Catalog
 * File Path: src/core/constants/regex-test.ts
 * Architecture Role: Single source of truth (SSOT) for polyglot test framework declaration,
 *     tautological assertion, brittle counter, mock stub, and floating-point comparison regular expressions.
 * Dependencies & Triggers: Zero external dependencies; consumed by test modernity analyzers and quality gates.
 * Responsibilities:
 *     1. Centralize canonical test framework declaration and assertion patterns across TS, Python, and GDScript.
 *     2. Enforce the state-separation discipline: stateless immutable constants vs fresh factories.
 *     3. Expose frozen REGEX_TEST domain namespace.
 * Exit Semantics & Design Rationale: Pure, frozen regex constants; strictly immune to ReDoS
 *     back-tracking traps and zero mutable state leakage.
 */

/** Matches polyglot test declaration headers across TS, JS, Python, and GDScript. */
export const TEST_CASE_DECL_PATTERN =
    /\b(?:it|test|describe|test_case|func\s+test_|def\s+test_)\s*(?:\(\s*['"]([^'"]+)['"]|([A-Za-z0-9_]+))/;

/** Matches permanently skipped, ignored, or disabled test annotations. */
export const SKIPPED_TEST_PATTERN =
    /\b(?:\.skip\s*\(|xit\s*\(|xtest\s*\(|@pytest\.mark\.skip|@pytest\.mark\.xfail|@ignore\b)/;

/** Matches tautological assertions comparing literals or symbols to themselves. */
export const TAUTOLOGICAL_ASSERT_PATTERN =
    /\b(?:expect\s*\(\s*(true|1|'a'|[a-zA-Z0-9_$]+)\s*\)\.to(?:Be|Equal)\s*\(\s*(?:true|1|'a'|\1)\s*\)|assert\s+(?:True|1\s*==\s*1)\b)/;

/** Matches test assertions that verify mock stubs only without exercising domain logic. */
export const MOCK_ONLY_ASSERT_PATTERN =
    /\bexpect\s*\(\s*(?:mock|jest\.fn|stub|spy)[A-Za-z0-9_.]*\)\.(?:toHaveBeenCalled|toBe|toEqual)/;

/** Matches obsolete or deprecated v1 contract assertions in modern suites. */
export const OBSOLETE_CONTRACT_PATTERN =
    /\b(?:v1_contract|legacy_v1_api|contract_v1|apiVersion:\s*['"]v1['"])\b/;

/** Matches fragile equality assertions against floating-point numeric literals. */
export const FRAGILE_FLOAT_ASSERT_PATTERN =
    /\b(?:expect\([^)]+\)\.to(?:Be|Equal|toStrictEqual)\s*\(\s*([0-9]+\.[0-9]+)\s*\)|assert(?:\.strictEqual|\.equal)?\s*\([^,)]+,\s*([0-9]+\.[0-9]+)\s*\)|assert(?:\.strictEqual|\.equal)?\s*\(\s*([0-9]+\.[0-9]+)\s*,|assert_true\s*\([^,)]*==\s*([0-9]+\.[0-9]+))/;

/** Matches entity and file counter identifier tokens prone to brittle assertion coupling. */
export const BRITTLE_COUNTER_IDENT_PATTERN =
    /\b(?:totalFiles|filesScanned|scannedFiles|totalRules|rulesCount|totalIssues|issuesCount|rulesRegistered|totalRulesCount|entryCount|testsCount|totalTests)\b/i;

/** Matches equality assertions comparing an expression against an integer literal. */
export const NUMERIC_ASSERT_PATTERN =
    /\b(?:expect\s*\([^)]+\)\s*\.to(?:Be|Equal|toStrictEqual)\s*\(\s*([0-9]+)\s*\)|assert(?:\.strictEqual|\.equal)?\s*\([^,)]+,\s*([0-9]+)\s*\)|assert(?:\.strictEqual|\.equal)?\s*\(\s*([0-9]+)\s*,)/;

/**
 * Immutable Test Modernity regular expression catalog adhering to SSOT governance.
 */
export const REGEX_TEST = Object.freeze({
    TEST_CASE_DECL: TEST_CASE_DECL_PATTERN,
    SKIPPED_TEST: SKIPPED_TEST_PATTERN,
    TAUTOLOGICAL_ASSERT: TAUTOLOGICAL_ASSERT_PATTERN,
    MOCK_ONLY_ASSERT: MOCK_ONLY_ASSERT_PATTERN,
    OBSOLETE_CONTRACT: OBSOLETE_CONTRACT_PATTERN,
    FRAGILE_FLOAT_ASSERT: FRAGILE_FLOAT_ASSERT_PATTERN,
    BRITTLE_COUNTER_IDENT: BRITTLE_COUNTER_IDENT_PATTERN,
    NUMERIC_ASSERT: NUMERIC_ASSERT_PATTERN,
});
