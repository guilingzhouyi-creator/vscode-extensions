/**
 * Module: Core Scoring — Declarative Dimension Deduction Table
 * File Path: src/core/scoring/dimensionRuleTable.ts
 * Architecture Role: Leaf data module holding the quantified standard: which rule deducts which
 *   quality dimension, and by how much.
 * Dependencies & Triggers: ./dimensionLiterals (rule ids, points, dimensions) and ../types for
 *   the Issue shape; consumed by ./dimensionDeductions, which runs the table.
 * Responsibilities: Name every matched rule id and analyzer, and map it to a dimension, a point
 *   value and a rationale builder.
 * Exit Semantics & Design Rationale: Data plus two tiny pure predicates and no I/O, so the
 *   standard can be read, reviewed and tested as a table instead of reconstructed from an
 *   if-chain; matching on rule ids keeps prose edits from silently disabling a deduction.
 */
import type { Issue } from '../types';
import { ScoringRationales } from '../messages';
import {
    DEDUCTION_MISSING_PUBLIC_API_DOC,
    DEDUCTION_DUPLICATE_LITERAL,
    DEDUCTION_MAGIC_NUMBER,
    DEDUCTION_HARDCODED_STRING,
    DEDUCTION_LINE_COUNT_OVERFLOW,
    DEDUCTION_CYCLOMATIC_COMPLEXITY,
    DEDUCTION_BANNED_JARGON,
    DEDUCTION_DEPRECATED_FEATURE,
    DEDUCTION_TYPE_SAFETY_ESCAPE,
    DEDUCTION_UNREACHABLE_DEAD_CODE,
    DEDUCTION_UNUSED_BINDING,
    DEDUCTION_NAMING_VIOLATION,
    DEDUCTION_SUBSTANDARD_COMMENT,
    ANALYZER_GOVERNANCE,
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_COMMENTS,
    ANALYZER_CONSTANTS,
    ANALYZER_HYGIENE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_STDLIB,
    RULE_CPX_TIME_001,
    RULE_CPX_SPACE_001,
    RULE_CPX_AMP_001,
    RULE_CPX_REC_001,
    RULE_DAT_QRY_001,
    RULE_DAT_NPL_001,
    RULE_DAT_SER_001,
    RULE_DAT_LAY_001,
    RULE_DAT_DEF_001,
    RULE_DEP_LAZ_001,
    RULE_DEP_RES_001,
    RULE_DEP_INV_001,
    RULE_DEP_ORD_001,
    RULE_DEP_WLD_001,
    RULE_TST_ILS_001,
    RULE_TST_SKP_001,
    RULE_TST_DEN_001,
    RULE_TST_TAU_001,
    RULE_TST_DBT_001,
    DEDUCTION_POLYNOMIAL_TIME,
    DEDUCTION_UNBOUNDED_DATA_QUERY,
    DEDUCTION_DATA_LAYER_LEAK,
    DEDUCTION_IN_FUNCTION_IMPORT,
    DEDUCTION_TAUTOLOGICAL_ASSERTION,
    DEDUCTION_MOCK_ONLY_TEST,
    DEDUCTION_UNBOUNDED_RECURSION,
    DEDUCTION_IMPORT_ORDER_VIOLATION,
    RULE_NESTED_CONSTANT,
    DEDUCTION_NESTED_CONSTANT,
    DIMENSION_STANDARDIZATION,
    DIMENSION_MODERNITY,
    DIMENSION_SEMANTIC_PURITY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_COMMENT_QUALITY,
    DIMENSION_DUPLICATION,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    FRAGMENT_LINES,
    FRAGMENT_PLACEHOLDER_MARKER,
    RULE_STDLIB_PANIC_001,
    RULE_STDLIB_ALLOC_001,
    RULE_STDLIB_UNSAFE_001,
    RULE_STDLIB_CONST_001,
    RULE_STDLIB_RECURSION_001,
    RULE_STDLIB_PORT_001,
    DEDUCTION_STDLIB_PANIC,
    DEDUCTION_STDLIB_ALLOC,
    DEDUCTION_STDLIB_UNSAFE,
    DEDUCTION_STDLIB_CONST,
    DEDUCTION_STDLIB_RECURSION,
    DEDUCTION_STDLIB_PORT,
} from './dimensionLiterals';
import type { QualityDimension } from './scoringTypes';

/** Hygiene rule flagging naming drift (kebab-case / snake_case violations). */
const RULE_HYG_NAMING = 'HYG-NAM-001';
/** Hygiene rule flagging statements after a terminal statement. */
const RULE_HYG_DEAD_CODE = 'HYG-DED-001';
/** Governance rule flagging deprecated constructs (`var` in TS/JS, bare `pass`). */
const RULE_GOV_DEPRECATED = 'GOV-STD-002';
/**
 * Governance type-safety rules: implicit typing, missing annotations, naked `any`,
 * forced escape, and unsafe penetration.
 */
const RULES_GOV_TYPE_SAFETY = [
    'GOV-TYP-001',
    'GOV-TYP-002',
    'GOV-TYP-003',
    'GOV-TYP-004',
    'GOV-TYP-005',
];
/** Dependency-graph rules for exported symbols nothing consumes. */
const RULES_UNUSED_BINDING = ['unused-export', 'unused-module'];
/** Comment rules for banned vocabulary and temporary markers, in precedence order. */
const RULES_COMMENT_BANNED = ['CMT-BAN-001'];
/** Comment rules for a missing public API docstring. */
const RULES_COMMENT_MISSING_DOC = ['CMT-DOC-001', 'CMT-DOC-002'];
/** Constants rules with their own deduction, ahead of the hardcoded-string fallback. */
const RULE_DUPLICATE_LITERAL = 'duplicate-literal';
const RULE_MAGIC_NUMBER = 'magic-number';
/**
 * Modernization analyzers: every rule they emit is deprecated-language-feature evidence, which
 * is what the `modernity` axis is declared to measure in DIMENSION_ANALYZERS.
 */
const MODERNITY_ANALYZERS = ['ts-modern', 'python-modern', 'rust-modern', 'gdscript-modern'];

const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';

const RULES_CPX_TIME_SPACE = [RULE_CPX_TIME_001, RULE_CPX_SPACE_001, RULE_CPX_AMP_001];
const RULES_DAT_PERF = [RULE_DAT_QRY_001, RULE_DAT_NPL_001, RULE_DAT_SER_001];
const RULES_DAT_ARCH = [RULE_DAT_LAY_001, RULE_DAT_DEF_001];
const RULES_DEP_ARCH = [RULE_DEP_LAZ_001, RULE_DEP_RES_001, RULE_DEP_INV_001];
const RULES_DEP_STD = [RULE_DEP_ORD_001, RULE_DEP_WLD_001];
const RULES_TST_MODERN = [RULE_TST_ILS_001, RULE_TST_SKP_001, RULE_TST_DEN_001];
const RULES_TST_MAINTAIN = [RULE_TST_TAU_001, RULE_TST_DBT_001];

/**
 * Probe matching a fragment of the finding message.
 *
 * Used only where one rule carries several metrics in its prose (the large-file rule reports
 * line count and function count under a single id), so the message is the only discriminator.
 *
 * @param fragment - Substring the message must contain.
 * @returns Predicate over a finding.
 */
function messageHas(fragment: string): (issue: Issue) => boolean {
    return (issue) => issue.message.includes(fragment);
}

/**
 * Probe matching an explicit rule id, with a documented fragment fallback.
 *
 * The ids are what the built-in analyzers actually emit, so a renamed rule is caught by the
 * table instead of silently losing its deduction. The fragments exist only for custom
 * analyzers, whose rule names this engine cannot know; they are never the primary match.
 *
 * @param rules - Built-in rule ids this row owns.
 * @param fragments - Substrings a custom rule name may carry.
 * @returns Predicate over a finding.
 */
function ruleMatches(rules: string[], fragments: string[]): (issue: Issue) => boolean {
    return (issue) => rules.includes(issue.rule) || fragments.some((f) => issue.rule.includes(f));
}

/** Probe accepting every finding of the row's analyzer (catch-all rows). */
const anyFinding = (): boolean => true;

/**
 * One declarative finding-to-deduction mapping.
 *
 * `covers` decides whether the row applies; the first row that covers a finding wins for its
 * dimension, so a catch-all row is written last and needs no negation. Matching on rule ids
 * keeps the table honest: prose fragments silently stopped matching once rule ids were
 * normalized, which made several axes undeductable while still reporting as measured.
 */
export interface DimensionRule {
    /** Analyzer that must own the finding. */
    analyzer: string;
    /** Whether this row covers the finding. */
    covers: (issue: Issue) => boolean;
    /** Dimension this row deducts from. */
    dimension: QualityDimension;
    /** Points removed from the dimension index. */
    points: number;
    /** Rationale builder, so every deduction stays explainable in the audit trail. */
    rationale: (message: string) => string;
}

/**
 * The quantified standard's deduction table: which rule deducts what, and by how much.
 */
export const DIMENSION_RULES: DimensionRule[] = [
    // Standardization — naming drift (hygiene) and oversized files, whose single rule reports
    // the line count in its message.
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_NAMING], ['naming']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_NAMING_VIOLATION,
        rationale: ScoringRationales.NAMING_CONVENTION_VIOLATION,
    },
    {
        analyzer: ANALYZER_LARGE_FILE,
        covers: messageHas(FRAGMENT_LINES),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_LINE_COUNT_OVERFLOW,
        rationale: ScoringRationales.LINE_COUNT_OVERFLOW,
    },
    {
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        covers: ruleMatches(RULES_DEP_STD, ['layout', 'wildcard']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_IMPORT_ORDER_VIOLATION,
        rationale: ScoringRationales.NAMING_CONVENTION_VIOLATION,
    },
    // Modernity — deprecated constructs in governance output plus every modernization pack.
    {
        analyzer: ANALYZER_GOVERNANCE,
        covers: ruleMatches([RULE_GOV_DEPRECATED], ['legacy', 'deprecated']),
        dimension: DIMENSION_MODERNITY,
        points: DEDUCTION_DEPRECATED_FEATURE,
        rationale: ScoringRationales.DEPRECATED_LANGUAGE_FEATURE,
    },
    ...MODERNITY_ANALYZERS.map((analyzer): DimensionRule => ({
        analyzer,
        covers: anyFinding,
        dimension: DIMENSION_MODERNITY,
        points: DEDUCTION_DEPRECATED_FEATURE,
        rationale: ScoringRationales.DEPRECATED_LANGUAGE_FEATURE,
    })),
    {
        analyzer: ANALYZER_TEST_MODERNITY,
        covers: ruleMatches(RULES_TST_MODERN, ['mock', 'skipped', 'density']),
        dimension: DIMENSION_MODERNITY,
        points: DEDUCTION_MOCK_ONLY_TEST,
        rationale: ScoringRationales.TEST_INTEGRITY_ILLUSION,
    },
    // Semantic purity — type-safety escapes, dead code and unused bindings.
    {
        analyzer: ANALYZER_GOVERNANCE,
        covers: ruleMatches(RULES_GOV_TYPE_SAFETY, ['type', 'escape']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_TYPE_SAFETY_ESCAPE,
        rationale: ScoringRationales.TYPE_SAFETY_ESCAPE,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_DEAD_CODE], ['dead', 'unreachable']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_UNREACHABLE_DEAD_CODE,
        rationale: ScoringRationales.UNREACHABLE_DEAD_CODE,
    },
    {
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        covers: ruleMatches(RULES_UNUSED_BINDING, ['unused']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_UNUSED_BINDING,
        rationale: ScoringRationales.UNUSED_BINDING_OR_IMPORT,
    },
    // Performance efficiency — data architecture queries/n+1 and semantic complexity
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches(RULES_CPX_TIME_SPACE, ['CPX']),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_POLYNOMIAL_TIME,
        rationale: ScoringRationales.CROSS_FUNCTION_COMPLEXITY,
    },
    {
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        covers: ruleMatches(RULES_DAT_PERF, ['query', 'nplusone', 'serialization']),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_UNBOUNDED_DATA_QUERY,
        rationale: ScoringRationales.UNBOUNDED_DATA_QUERY,
    },
    // Architecture consistency — data layer breaches, dependency layout leaks
    // and unmanaged resources
    {
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        covers: ruleMatches(RULES_DAT_ARCH, ['driver', 'defensive']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_DATA_LAYER_LEAK,
        rationale: ScoringRationales.LAYER_CONSTRAINT_VIOLATION,
    },
    {
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        covers: ruleMatches(RULES_DEP_ARCH, ['in-function', 'unmanaged', 'inversion']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_IN_FUNCTION_IMPORT,
        rationale: ScoringRationales.IN_FUNCTION_IMPORT,
    },
    // Maintainability — test tautology/debt, unbounded recursion, then CC fallback
    {
        analyzer: ANALYZER_TEST_MODERNITY,
        covers: ruleMatches(RULES_TST_MAINTAIN, ['tautological', 'debt']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_TAUTOLOGICAL_ASSERTION,
        rationale: ScoringRationales.TAUTOLOGICAL_ASSERTION,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches([RULE_CPX_REC_001], ['recursion']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UNBOUNDED_RECURSION,
        rationale: ScoringRationales.UNBOUNDED_RECURSION,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: anyFinding,
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_CYCLOMATIC_COMPLEXITY,
        rationale: ScoringRationales.CYCLOMATIC_COMPLEXITY_HIGH,
    },
    // Comment quality — banned vocabulary, then missing public docs, then everything else.
    {
        analyzer: ANALYZER_COMMENTS,
        covers: ruleMatches(RULES_COMMENT_BANNED, [
            'banned',
            'jargon',
            FRAGMENT_PLACEHOLDER_MARKER,
        ]),
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_BANNED_JARGON,
        rationale: ScoringRationales.BANNED_JARGON_IN_COMMENT,
    },
    {
        analyzer: ANALYZER_COMMENTS,
        covers: ruleMatches(RULES_COMMENT_MISSING_DOC, ['missing']),
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_MISSING_PUBLIC_API_DOC,
        rationale: ScoringRationales.MISSING_PUBLIC_API_DOC,
    },
    {
        analyzer: ANALYZER_COMMENTS,
        covers: anyFinding,
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_SUBSTANDARD_COMMENT,
        rationale: ScoringRationales.SUBSTANDARD_COMMENT_QUALITY,
    },
    // Duplication — repeated literals, magic numbers, nested constants,
    // then any other constants finding.
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches([RULE_DUPLICATE_LITERAL], ['duplicate']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_DUPLICATE_LITERAL,
        rationale: ScoringRationales.DUPLICATE_LITERAL,
    },
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches([RULE_MAGIC_NUMBER], ['magic']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_MAGIC_NUMBER,
        rationale: ScoringRationales.MAGIC_NUMBER,
    },
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches([RULE_NESTED_CONSTANT], ['nested']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_NESTED_CONSTANT,
        rationale: ScoringRationales.NESTED_CONSTANT,
    },
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: anyFinding,
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_HARDCODED_STRING,
        rationale: ScoringRationales.HARDCODED_STRING,
    },
    // Standard Library & Systems Runtime Verification
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_PANIC_001], ['panic', 'unwrap']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_STDLIB_PANIC,
        rationale: () => '标准库公开接口发生裸 panic/unwrap 逃逸调用',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_ALLOC_001], ['alloc', 'heap']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_STDLIB_ALLOC,
        rationale: () => 'no_std 裸机运行环境发生隐式动态堆内存分配',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_UNSAFE_001], ['unsafe', 'SAFETY']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_STDLIB_UNSAFE,
        rationale: () => '底层 unsafe 块缺少强制的 // SAFETY: 证明契约',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_CONST_001], ['crypto', 'constant_time']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_STDLIB_CONST,
        rationale: () => '密码学敏感比对存在非恒定时间短路时序泄露',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_RECURSION_001], ['recursion', 'depth']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_STDLIB_RECURSION,
        rationale: () => '底层核心算法存在无界深层递归且缺少栈深度防卫',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_PORT_001], ['cfg', 'portability']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_STDLIB_PORT,
        rationale: () => '平台特定条件编译缺少 compile_error 阻断兜底',
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_STDLIB_PORT,
        rationale: () => '标准库与底层系统运行时规范检查未通过',
    },
];
