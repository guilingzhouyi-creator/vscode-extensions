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
    ANALYZER_ARCHITECTURE,
    ANALYZER_DOCS,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_STDLIB,
    ANALYZER_VSCODE_EXTENSION,
    ANALYZER_GDSCRIPT_GAME,
    ANALYZER_NAMING,
    ANALYZER_GATE_ARCHITECTURE,
    ANALYZER_SHELL_LINT,
    ANALYZER_SIMPLIFY,
    ANALYZER_GO_MODERN,
    RULE_CPX_TIME_001,
    RULE_CPX_SPACE_001,
    RULE_CPX_AMP_001,
    RULE_CPX_REC_001,
    RULE_CPX_HOP_001,
    RULE_CPX_NEST_001,
    RULE_CPX_NEST_002,
    RULE_CPX_STM_001,
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
    RULE_TST_TOP_001,
    DEDUCTION_TEST_TOPOLOGY_DISCIPLINE,
    DEDUCTION_POLYNOMIAL_TIME,
    DEDUCTION_UNBOUNDED_DATA_QUERY,
    DEDUCTION_DATA_LAYER_LEAK,
    DEDUCTION_IN_FUNCTION_IMPORT,
    DEDUCTION_TAUTOLOGICAL_ASSERTION,
    DEDUCTION_MOCK_ONLY_TEST,
    DEDUCTION_UNBOUNDED_RECURSION,
    DEDUCTION_MECHANICAL_SPLITTING,
    DEDUCTION_UNBOUNDED_NESTING,
    DEDUCTION_DEEP_CONTROL_ESCAPE,
    DEDUCTION_STATE_MACHINE_DISCIPLINE,
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
    DEDUCTION_UNDISPOSED_RESOURCE,
    DEDUCTION_MAIN_THREAD_BLOCKING_IO,
    DEDUCTION_UNLOCALIZED_TEXT,
    DEDUCTION_POOL_CONTRACT_BREACH,
    DEDUCTION_HOST_LIFECYCLE_BREACH,
    DEDUCTION_DUPLICATE_CODE_BLOCK,
    DEDUCTION_VACUOUS_WRAPPER,
    DEDUCTION_UNNECESSARY_ABSTRACTION,
    DEDUCTION_DOCUMENT_DUPLICATION,
    DEDUCTION_MEANINGLESS_COMMENT,
    DEDUCTION_UNCONSOLIDATED_LITERALS,
    DEDUCTION_CONSTANT_NAME_SPLIT,
    DEDUCTION_SCATTERED_LOCALS,
    DEDUCTION_DISTRIBUTED_REDUNDANCY,
    RULE_NAM_DEC_001,
    DEDUCTION_NAMING_DECOUPLING,
    RULE_HYG_EMP_001,
    DEDUCTION_EMPTY_FILE_PLACEHOLDER,
    DEDUCTION_GATE_ARCHITECTURE,
    DEDUCTION_GATE_RELIABILITY,
    DEDUCTION_GATE_STANDARDIZATION,
    DEDUCTION_SHELL_ERROR_DISCIPLINE,
    DEDUCTION_SHELL_STANDARDIZATION,
    DEDUCTION_SIMPLIFY_MAINTAINABILITY,
    DEDUCTION_SIMPLIFY_COMMENT,
    DEDUCTION_SIMPLIFY_STANDARDIZATION,
    DEDUCTION_GO_MODERNITY,
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
const RULES_COMMENT_BANNED = ['CMT-BAN-001', 'CMT-TRM-001'];
/** Constants rules with their own deduction, ahead of the hardcoded-string fallback. */
const RULE_DUPLICATE_LITERAL = 'duplicate-literal';
const RULE_MAGIC_NUMBER = 'magic-number';
/**
 * Modernization analyzers: every rule they emit is deprecated-language-feature evidence, which
 * is what the `modernity` axis is declared to measure in DIMENSION_ANALYZERS.
 */
const MODERNITY_ANALYZERS = [
    'ts-modern',
    'python-modern',
    'rust-modern',
    'gdscript-modern',
    ANALYZER_GO_MODERN,
];

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
    {
        analyzer: ANALYZER_NAMING,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_NAMING_VIOLATION,
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
        // HYG-CLN-001 flags a repeated code block inside one file. It had no row of its own,
        // so it fell through to the hygiene catch-all (or to nothing at all) and never
        // reached the duplication axis it describes.
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches(['HYG-CLN-001'], ['clone', 'duplicat', 'extract']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_DUPLICATE_CODE_BLOCK,
        rationale: ScoringRationales.DUPLICATE_CODE_BLOCK,
    },
    {
        // HYG-WRAP-001/002 are vacuous forwarding wrappers: a function whose whole body is
        // `return other(...)`. They are structural noise rather than a hygiene naming issue,
        // so they belong on the purity axis.
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches(
            ['HYG-WRAP-001', 'HYG-WRAP-002'],
            ['wrapper', 'passthrough', 'forward'],
        ),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_VACUOUS_WRAPPER,
        rationale: ScoringRationales.VACUOUS_WRAPPER,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_EMP_001], ['empty', '0-byte', 'vacuous']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_EMPTY_FILE_PLACEHOLDER,
        rationale: ScoringRationales.EMPTY_FILE_PLACEHOLDER,
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
    {
        analyzer: ANALYZER_NAMING,
        covers: ruleMatches([RULE_NAM_DEC_001], ['decoupling', 'NAM-DEC']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_NAMING_DECOUPLING,
        rationale: ScoringRationales.NAMING_DECOUPLING_RECOMMENDED,
    },
    // Maintainability — test topology discipline, test tautology/debt,
    // unbounded recursion, then CC fallback
    {
        analyzer: ANALYZER_TEST_MODERNITY,
        covers: ruleMatches([RULE_TST_TOP_001], ['topology', 'TST-TOP']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_TEST_TOPOLOGY_DISCIPLINE,
        rationale: ScoringRationales.TEST_TOPOLOGY_DISCIPLINE_BREACH,
    },
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
        covers: ruleMatches([RULE_CPX_NEST_001], ['nesting', 'unbounded']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UNBOUNDED_NESTING,
        rationale: ScoringRationales.UNBOUNDED_NESTING,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches([RULE_CPX_NEST_002], ['escape', 'jump']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_DEEP_CONTROL_ESCAPE,
        rationale: ScoringRationales.DEEP_CONTROL_ESCAPE,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches([RULE_CPX_STM_001], ['state', 'machine', 'discipline']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_STATE_MACHINE_DISCIPLINE,
        rationale: ScoringRationales.STATE_MACHINE_DISCIPLINE,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches([RULE_CPX_HOP_001], ['mechanical', 'hopping', 'wrapper']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_MECHANICAL_SPLITTING,
        rationale: ScoringRationales.MECHANICAL_SPLITTING,
    },
    {
        // CPX-RED-001 reports near-identical algorithms spread over several files, i.e.
        // distributed redundant complexity. Without its own row it was absorbed by the
        // cyclomatic-complexity catch-all below, which charges the same 15 points a plain
        // CC breach costs and describes the finding as a complexity problem instead of the
        // duplication it actually is.
        analyzer: ANALYZER_COMPLEXITY,
        covers: ruleMatches(['CPX-RED-001'], ['redundan', 'similar', 'duplicate']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_DISTRIBUTED_REDUNDANCY,
        rationale: ScoringRationales.DISTRIBUTED_REDUNDANCY,
    },
    {
        analyzer: ANALYZER_COMPLEXITY,
        covers: anyFinding,
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_CYCLOMATIC_COMPLEXITY,
        rationale: ScoringRationales.CYCLOMATIC_COMPLEXITY_HIGH,
    },
    {
        // ARCH-ABS-001: over-abstraction and unnecessary indirection layers. The architecture
        // analyzer is deducted by the family applier, which knows nothing about this rule, so
        // without a row here the finding was reported but never charged to any axis.
        analyzer: ANALYZER_ARCHITECTURE,
        covers: ruleMatches(['ARCH-ABS-001'], ['abstraction', 'indirection', 'unnecessary']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_UNNECESSARY_ABSTRACTION,
        rationale: ScoringRationales.UNNECESSARY_ABSTRACTION,
    },
    {
        // DOC-DUP-001: repeated prose inside one document. The docs analyzer had no row at
        // all, so its only finding type never affected the score.
        analyzer: ANALYZER_DOCS,
        covers: ruleMatches(['DOC-DUP-001'], ['duplicat', 'repeat', 'prose']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_DOCUMENT_DUPLICATION,
        rationale: ScoringRationales.DOCUMENT_DUPLICATION,
    },
    {
        // DOC-TRM-001: non-objective terminology or hyperbolic assertions in markdown
        // documentation prose.
        analyzer: ANALYZER_DOCS,
        covers: ruleMatches(['DOC-TRM-001'], ['terminology', 'prose', 'objective', 'hyperbolic']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_DOCUMENT_DUPLICATION,
        rationale: ScoringRationales.BANNED_JARGON_IN_COMMENT,
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
        // CMT-DOC-002 is a *redundant* comment (it only restates the symbol name), not a missing
        // one. It shared a rule array with CMT-DOC-001, so it was charged the "missing public
        // API doc" penalty and the two findings became indistinguishable in the audit trail.
        analyzer: ANALYZER_COMMENTS,
        covers: ruleMatches(['CMT-DOC-002'], ['redundant', 'meaningless', 'tautolog']),
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_MEANINGLESS_COMMENT,
        rationale: ScoringRationales.MEANINGLESS_COMMENT,
    },
    {
        analyzer: ANALYZER_COMMENTS,
        covers: ruleMatches(['CMT-DOC-001'], ['missing']),
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
        // CONST-CLU-001: same-domain literals left unconsolidated inside one call scope.
        // CONST-DRF-001: the same semantic constant drifting or splitting across files.
        // Both are consolidation debt on the duplication axis; previously they only reached
        // the generic constants catch-all, which charged them as hardcoded strings.
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches(['CONST-CLU-001'], ['cluster', 'consolidat', 'cluster']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_UNCONSOLIDATED_LITERALS,
        rationale: ScoringRationales.UNCONSOLIDATED_LITERALS,
    },
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches(['CONST-DRF-001'], ['drift', 'split', 'divergen']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_CONSTANT_NAME_SPLIT,
        rationale: ScoringRationales.CONSTANT_NAME_SPLIT,
    },
    {
        analyzer: ANALYZER_CONSTANTS,
        covers: ruleMatches(['CONST-SCP-002'], ['scatter', 'scoped', 'local']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_SCATTERED_LOCALS,
        rationale: ScoringRationales.SCATTERED_LOCALS,
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
        rationale: ScoringRationales.STDLIB_PANIC_ESCAPE,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_ALLOC_001], ['alloc', 'heap']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_STDLIB_ALLOC,
        rationale: ScoringRationales.STDLIB_IMPLICIT_ALLOC,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_UNSAFE_001], ['unsafe', 'SAFETY']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_STDLIB_UNSAFE,
        rationale: ScoringRationales.STDLIB_UNPROVEN_UNSAFE,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_CONST_001], ['crypto', 'constant_time']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_STDLIB_CONST,
        rationale: ScoringRationales.STDLIB_TIMING_LEAK,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_RECURSION_001], ['recursion', 'depth']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_STDLIB_RECURSION,
        rationale: ScoringRationales.STDLIB_UNBOUNDED_RECURSION,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: ruleMatches([RULE_STDLIB_PORT_001], ['cfg', 'portability']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_STDLIB_PORT,
        rationale: ScoringRationales.STDLIB_PORTABILITY_FALLBACK,
    },
    {
        analyzer: ANALYZER_STDLIB,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_STDLIB_PORT,
        rationale: ScoringRationales.STDLIB_GENERIC_MISMATCH,
    },

    // ── Host language packs (VS Code extension / Godot) ───────────────────────────
    // `vscode-extension` and `gdscript-game` were declared in DIMENSION_ANALYZERS as the
    // evidence for architectureConsistency / performanceEfficiency / commentQuality, but had
    // no row here and none in the family appliers. Enabling them therefore raised `coverage`
    // — telling the consumer those axes had been measured — while they could never deduct a
    // single point. `validate-scoring-coverage` did not catch it because its coverage-model
    // assertion only ran in one direction: "a deducting analyzer must be declared", never
    // "a declared analyzer must be able to deduct".

    {
        analyzer: ANALYZER_VSCODE_EXTENSION,
        covers: ruleMatches(
            ['VSC-MEM-001', 'VSC-UI-002'],
            ['disposable', 'subscription', 'leak', 'theme', 'color'],
        ),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_UNDISPOSED_RESOURCE,
        rationale: ScoringRationales.VSCODE_UNDISPOSED_RESOURCE,
    },
    {
        analyzer: ANALYZER_VSCODE_EXTENSION,
        covers: ruleMatches(
            ['VSC-PERF-001', 'VSC-UI-001'],
            ['blocking', 'synchronous', 'main thread', 'fold', 'density'],
        ),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_MAIN_THREAD_BLOCKING_IO,
        rationale: ScoringRationales.VSCODE_MAIN_THREAD_BLOCKING_IO,
    },
    {
        analyzer: ANALYZER_VSCODE_EXTENSION,
        covers: ruleMatches(['VSC-I18N-001'], ['hardcoded', 'localis', 'localiz', 'i18n']),
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_UNLOCALIZED_TEXT,
        rationale: ScoringRationales.VSCODE_UNLOCALIZED_TEXT,
    },
    {
        analyzer: ANALYZER_GDSCRIPT_GAME,
        covers: ruleMatches(['GDM-POOL-002'], ['pool', 'reset_state', 'contract']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_POOL_CONTRACT_BREACH,
        rationale: ScoringRationales.GDSCRIPT_POOL_CONTRACT_BREACH,
    },
    {
        analyzer: ANALYZER_GDSCRIPT_GAME,
        covers: anyFinding,
        dimension: DIMENSION_MODERNITY,
        points: DEDUCTION_HOST_LIFECYCLE_BREACH,
        rationale: ScoringRationales.GDSCRIPT_MODERNIZATION,
    },

    // ── Repository Gate Architecture & Governance ────────────────────────────────
    {
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        covers: ruleMatches(
            ['GATE-SYS-001', 'GATE-HOOK-001', 'GATE-ISO-001', 'GATE-FAC-001', 'GATE-PAIR-001'],
            ['system', 'hook', 'isolate', 'facade', 'pair'],
        ),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_GATE_ARCHITECTURE,
        rationale: ScoringRationales.GATE_ARCHITECTURE_INTEGRITY,
    },
    {
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        covers: ruleMatches(
            ['GATE-ERR-001', 'GATE-ROUTE-001', 'GATE-BUDGET-001', 'GATE-AST-001', 'GATE-PROC-001'],
            ['error', 'route', 'budget', 'ast', 'interactive'],
        ),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_GATE_RELIABILITY,
        rationale: ScoringRationales.GATE_EXECUTION_RELIABILITY,
    },
    {
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        covers: ruleMatches(
            ['GATE-MSG-001', 'GATE-MSG-002', 'GATE-MSG-003', 'GATE-SSOT-001', 'GATE-HYG-001'],
            ['msg', 'message', 'ssot', 'catalog', 'hygiene'],
        ),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_GATE_STANDARDIZATION,
        rationale: ScoringRationales.GATE_STANDARDIZATION_INTEGRITY,
    },
    {
        analyzer: ANALYZER_GATE_ARCHITECTURE,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_GATE_STANDARDIZATION,
        rationale: ScoringRationales.GATE_GENERIC_MISMATCH,
    },

    // ── Shell / PowerShell Lint Governance ───────────────────────────────────────
    {
        analyzer: ANALYZER_SHELL_LINT,
        covers: ruleMatches(
            ['SH-ERR-001', 'SH-EXIT-001', 'SH-INIT-001', 'SH-COND-001', 'PS-ERROR-001'],
            ['err', 'exit', 'init', 'cond'],
        ),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_SHELL_ERROR_DISCIPLINE,
        rationale: ScoringRationales.SHELL_ERROR_DISCIPLINE,
    },
    {
        analyzer: ANALYZER_SHELL_LINT,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_SHELL_STANDARDIZATION,
        rationale: ScoringRationales.SHELL_STANDARDIZATION,
    },

    // ── Code Simplification & Structure Smells ──────────────────────────────────
    {
        analyzer: ANALYZER_SIMPLIFY,
        covers: ruleMatches(
            [
                'SIM-TRN-001',
                'SIM-BOOL-001',
                'SIM-ELSE-001',
                'SIM-GUARD-001',
                'SIM-IMM-001',
                'SIM-FLAT-002',
                'SIM-ARGS-001',
            ],
            ['ternary', 'boolean', 'condition', 'return', 'guard', 'function', 'else', 'parameter', 'argument'],
        ),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_SIMPLIFY_MAINTAINABILITY,
        rationale: ScoringRationales.SIMPLIFY_MAINTAINABILITY,
    },
    {
        analyzer: ANALYZER_SIMPLIFY,
        covers: ruleMatches(['SIM-COMC-001'], ['comment', 'dead']),
        dimension: DIMENSION_COMMENT_QUALITY,
        points: DEDUCTION_SIMPLIFY_COMMENT,
        rationale: ScoringRationales.SIMPLIFY_COMMENT,
    },
    {
        analyzer: ANALYZER_SIMPLIFY,
        covers: ruleMatches(
            ['SIM-LONG-001', 'SIM-EMPTY-001', 'SIM-PRNT-001'],
            ['long', 'empty', 'print'],
        ),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_SIMPLIFY_STANDARDIZATION,
        rationale: ScoringRationales.SIMPLIFY_STANDARDIZATION,
    },
    {
        analyzer: ANALYZER_SIMPLIFY,
        covers: anyFinding,
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_SIMPLIFY_STANDARDIZATION,
        rationale: ScoringRationales.SIMPLIFY_STANDARDIZATION,
    },

    // ── Go Modern Language Pack ──────────────────────────────────────────────────
    {
        analyzer: ANALYZER_GO_MODERN,
        covers: ruleMatches(
            ['GOM-CTX-001', 'GOM-ERR-001', 'GOM-STYLE-001', 'GOM-STYLE-002', 'GOM-STYLE-003'],
            ['gom', 'context', 'err', 'style'],
        ),
        dimension: DIMENSION_MODERNITY,
        points: DEDUCTION_GO_MODERNITY,
        rationale: ScoringRationales.GO_MODERNITY,
    },
];

/**
 * Fast analyzer-indexed lookup table partitioning DIMENSION_RULES to avoid O(N) full-table scans.
 */
const RULES_BY_ANALYZER = new Map<string, DimensionRule[]>();
for (const rule of DIMENSION_RULES) {
    let list = RULES_BY_ANALYZER.get(rule.analyzer);
    if (!list) {
        list = [];
        RULES_BY_ANALYZER.set(rule.analyzer, list);
    }
    list.push(rule);
}

/**
 * Returns the dimension rules mapped to a specific analyzer in O(1) time.
 *
 * @param analyzer - Target analyzer identifier.
 * @returns Partitioned dimension rules array for that analyzer.
 */
export function getDimensionRulesForAnalyzer(analyzer: string): readonly DimensionRule[] {
    return RULES_BY_ANALYZER.get(analyzer) ?? [];
}

