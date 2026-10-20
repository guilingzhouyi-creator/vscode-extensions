/**
 * Module: Core Scoring — Physical Hygiene & Extension Domain Deduction Rules
 * File Path: src/core/scoring/dimension-rule-table-hygiene.ts
 * Architecture Role: Modular deduction table for repository physical hygiene, encoding standards,
 *   indentation, temporary clutter files, and domain directory classification rules, keeping main
 *   table strictly below 900 LOC.
 * Dependencies & Triggers: ./dimensionLiterals, ../messages; consumed by dimensionRuleTable.
 * Responsibilities: Map HYG-NAM, HYG-DED, HYG-CLN, HYG-WRAP, HYG-EMP, HYG-BOM, HYG-TRL, HYG-IND,
 *   HYG-CLT, and EXT-DIR rules to quality dimensions and point values.
 * Exit Semantics & Design Rationale: Pure constant table array; zero runtime side effects.
 */

import type { Issue } from '../types';
import { ScoringRationales } from '../messages';
import {
    ANALYZER_HYGIENE,
    RULE_HYG_EMP_001,
    RULE_HYG_EMP_002,
    RULE_HYG_BOM_001,
    RULE_HYG_TRL_001,
    RULE_HYG_IND_001,
    RULE_HYG_CLT_001,
    RULE_EXT_DIR_001,
    DEDUCTION_NAMING_VIOLATION,
    DEDUCTION_UNREACHABLE_DEAD_CODE,
    DEDUCTION_DUPLICATE_CODE_BLOCK,
    DEDUCTION_VACUOUS_WRAPPER,
    DEDUCTION_EMPTY_FILE_PLACEHOLDER,
    DEDUCTION_COMMENT_HOLLOW_FILE,
    DEDUCTION_UTF8_BOM,
    DEDUCTION_TRAILING_NEWLINE,
    DEDUCTION_TAB_INDENTATION,
    DEDUCTION_UNCONTROLLED_CLUTTER,
    DEDUCTION_ROOT_SCRIPT_POLLUTION,
    DIMENSION_STANDARDIZATION,
    DIMENSION_SEMANTIC_PURITY,
    DIMENSION_DUPLICATION,
} from './dimensionLiterals';
import type { DimensionRule } from './dimension-rule-table-frontend';

/** Hygiene rule flagging naming drift (kebab-case / snake_case violations). */
const RULE_HYG_NAMING = 'HYG-NAM-001';
/** Hygiene rule flagging statements after a terminal statement. */
const RULE_HYG_DEAD_CODE = 'HYG-DED-001';

/**
 * Probe matching an explicit rule id, with a documented fragment fallback.
 *
 * @param rules - Built-in rule ids this row owns.
 * @param fragments - Substrings a custom rule name may carry.
 * @returns Predicate over a finding.
 */
function ruleMatches(rules: readonly string[], fragments: readonly string[]): (issue: Issue) => boolean {
    return (issue) => rules.includes(issue.rule) || fragments.some((f) => issue.rule && issue.rule.includes(f));
}

/**
 * Dimension rules for physical hygiene, whitespace, encoding, and extension-domain layout.
 */
export const HYGIENE_DIMENSION_RULES: readonly DimensionRule[] = [
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_NAMING], ['naming']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_NAMING_VIOLATION,
        rationale: ScoringRationales.NAMING_CONVENTION_VIOLATION,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_DEAD_CODE], ['dead', 'unreachable']),
        dimension: DIMENSION_SEMANTIC_PURITY,
        points: DEDUCTION_UNREACHABLE_DEAD_CODE,
        rationale: ScoringRationales.UNREACHABLE_DEAD_CODE,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches(['HYG-CLN-001'], ['clone', 'duplicat', 'extract']),
        dimension: DIMENSION_DUPLICATION,
        points: DEDUCTION_DUPLICATE_CODE_BLOCK,
        rationale: ScoringRationales.DUPLICATE_CODE_BLOCK,
    },
    {
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
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_EMP_002], ['hollow', 'comment-only']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_COMMENT_HOLLOW_FILE,
        rationale: ScoringRationales.COMMENT_HOLLOW_FILE,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_BOM_001], ['BOM', 'UTF-8 BOM']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_UTF8_BOM,
        rationale: ScoringRationales.PHYSICAL_HYGIENE_ENCODING,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_TRL_001], ['newline', 'trailing blank', 'EOF']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_TRAILING_NEWLINE,
        rationale: ScoringRationales.PHYSICAL_HYGIENE_ENCODING,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_IND_001], ['tab', 'indentation']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_TAB_INDENTATION,
        rationale: ScoringRationales.PHYSICAL_HYGIENE_INDENT,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_HYG_CLT_001], ['clutter', 'transient', 'uncontrolled']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_UNCONTROLLED_CLUTTER,
        rationale: ScoringRationales.UNCONTROLLED_CLUTTER_FILE,
    },
    {
        analyzer: ANALYZER_HYGIENE,
        covers: ruleMatches([RULE_EXT_DIR_001], ['root script', 'classification', 'domain subdirectory']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_ROOT_SCRIPT_POLLUTION,
        rationale: ScoringRationales.DIRECTORY_CLASSIFICATION_POLLUTION,
    },
];
