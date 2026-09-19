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
    DIMENSION_STANDARDIZATION,
    DIMENSION_MODERNITY,
    DIMENSION_SEMANTIC_PURITY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_COMMENT_QUALITY,
    DIMENSION_DUPLICATION,
    FRAGMENT_LINES,
    FRAGMENT_PLACEHOLDER_MARKER,
} from './dimensionLiterals';
import type { QualityDimension } from './scoringTypes';

/** Hygiene rule flagging naming drift (kebab-case / snake_case violations). */
const RULE_HYG_NAMING = 'HYG-NAM-001';
/** Hygiene rule flagging statements after a terminal statement. */
const RULE_HYG_DEAD_CODE = 'HYG-DED-001';
/** Governance rule flagging deprecated constructs (`var` in TS/JS, bare `pass`). */
const RULE_GOV_DEPRECATED = 'GOV-STD-002';
/** Governance type-safety rules: implicit typing, missing annotations, naked `any`. */
const RULES_GOV_TYPE_SAFETY = ['GOV-TYP-001', 'GOV-TYP-002', 'GOV-TYP-003'];
/** Dependency-graph rules for exported symbols nothing consumes. */
const RULES_UNUSED_BINDING = ['unused-export', 'unused-module'];
/** Comment rules for banned vocabulary and temporary markers, in precedence order. */
const RULES_COMMENT_BANNED = ['CMT-BAN-001', 'CMT-WID-001'];
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
    // Maintainability — cyclomatic complexity (nesting depth is a metric deduction below).
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
    // Duplication — repeated literals, magic numbers, then any other constants finding.
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
        covers: anyFinding,
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_HARDCODED_STRING,
        rationale: ScoringRationales.HARDCODED_STRING,
    },
];
