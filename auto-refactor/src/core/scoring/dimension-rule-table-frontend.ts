/**
 * Module: Core Scoring — Frontend & Client Exposure Dimension Deduction Rules
 * File Path: src/core/scoring/dimension-rule-table-frontend.ts
 * Architecture Role: Modular deduction table for frontend UI engineering, production build
 *   hygiene, and client exposure risk rules, keeping main table strictly below 900 LOC.
 * Dependencies & Triggers: ./dimensionLiterals, ../messages; consumed by dimensionRuleTable.
 * Responsibilities: Map UI-ENG, PROD-HYG, and SEC-EXP rules to quality dimensions and point values.
 * Exit Semantics & Design Rationale: Pure constant table array; zero runtime side effects.
 */

import type { Issue } from '../types';
import { ScoringRationales } from '../messages';
import {
    ANALYZER_FRONTEND,
    ANALYZER_PRODUCTION_HYGIENE,
    ANALYZER_CLIENT_EXPOSURE,
    RULE_UI_ENG_001,
    RULE_UI_ENG_002,
    RULE_UI_ENG_003,
    RULE_UI_ENG_004,
    RULE_PROD_HYG_001,
    RULE_PROD_HYG_002,
    RULE_PROD_HYG_003,
    RULE_SEC_EXP_001,
    RULE_SEC_EXP_002,
    RULE_SEC_EXP_003,
    RULE_SEC_EXP_004,
    DEDUCTION_UI_A11Y,
    DEDUCTION_UI_DOM_DEPTH,
    DEDUCTION_UI_COMPONENT_REUSE,
    DEDUCTION_UI_NAMING,
    DEDUCTION_PROD_DEBUG_RESIDUE,
    DEDUCTION_PROD_SOURCE_MAP,
    DEDUCTION_PROD_ENV_SECRET,
    DEDUCTION_SEC_INTERNAL_ENDPOINT,
    DEDUCTION_SEC_CSS_AUTH_BYPASS,
    DEDUCTION_SEC_DISABLED_FLAG,
    DEDUCTION_SEC_UNRELEASED_ROUTE,
    DIMENSION_CODE_SECURITY,
} from './dimensionLiterals';
import type { QualityDimension } from './scoringTypes';

/**
 * One declarative finding-to-deduction mapping.
 */
export interface DimensionRule {
    analyzer: string;
    covers: (issue: Issue) => boolean;
    dimension: QualityDimension;
    points: number;
    rationale: (message: string) => string;
}

const DIMENSION_STANDARDIZATION = 'standardization';
const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';
const DIMENSION_MAINTAINABILITY = 'maintainability';

function ruleMatches(ids: string[], fragments: string[]): (issue: Issue) => boolean {
    return (issue) => {
        if (issue.rule && ids.includes(issue.rule)) return true;
        const lower = issue.message.toLowerCase();
        return fragments.some((f) => lower.includes(f));
    };
}

const anyFinding = (_issue: Issue) => true;

/**
 * Dimension rules for frontend UI engineering, build hygiene, and client exposure risks.
 */
export const FRONTEND_DIMENSION_RULES: readonly DimensionRule[] = [
    // ── Frontend Engineering & UI/UX Governance ──────────────────────────────────
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_001], ['semantic', 'accessibility', 'alt', 'aria']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_UI_A11Y,
        rationale: ScoringRationales.UI_A11Y_SEMANTICS,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_002], ['depth', 'reflow', 'animation', 'dom']),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_UI_DOM_DEPTH,
        rationale: ScoringRationales.UI_DOM_DEPTH_REFLOW,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_003], ['props', 'reuse', 'duplicate', 'template']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UI_COMPONENT_REUSE,
        rationale: ScoringRationales.UI_COMPONENT_REUSE,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_004], ['naming', 'hook', 'handler']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_UI_NAMING,
        rationale: ScoringRationales.UI_NAMING_CONVENTION,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: anyFinding,
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UI_COMPONENT_REUSE,
        rationale: ScoringRationales.UI_COMPONENT_REUSE,
    },

    // ── Production Build Hygiene ─────────────────────────────────────────────────
    {
        analyzer: ANALYZER_PRODUCTION_HYGIENE,
        covers: ruleMatches([RULE_PROD_HYG_001], ['debug', 'console', 'todo', 'path']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_PROD_DEBUG_RESIDUE,
        rationale: ScoringRationales.PROD_DEBUG_RESIDUE,
    },
    {
        analyzer: ANALYZER_PRODUCTION_HYGIENE,
        covers: ruleMatches([RULE_PROD_HYG_002], ['sourcemap', 'source-map']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_PROD_SOURCE_MAP,
        rationale: ScoringRationales.PROD_SOURCE_MAP_LEAK,
    },
    {
        analyzer: ANALYZER_PRODUCTION_HYGIENE,
        covers: ruleMatches([RULE_PROD_HYG_003], ['env', 'secret', 'key']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_PROD_ENV_SECRET,
        rationale: ScoringRationales.PROD_ENV_SECRET_LEAK,
    },
    {
        analyzer: ANALYZER_PRODUCTION_HYGIENE,
        covers: anyFinding,
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_PROD_DEBUG_RESIDUE,
        rationale: ScoringRationales.PROD_DEBUG_RESIDUE,
    },

    // ── Client Exposure Risk Governance ──────────────────────────────────────────
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: ruleMatches([RULE_SEC_EXP_001], ['internal', 'admin', 'endpoint', 'api']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_INTERNAL_ENDPOINT,
        rationale: ScoringRationales.CLIENT_INTERNAL_ENDPOINT,
    },
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: ruleMatches([RULE_SEC_EXP_002], ['css', 'display', 'hide', 'auth', 'bypass']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_CSS_AUTH_BYPASS,
        rationale: ScoringRationales.CLIENT_CSS_AUTH_BYPASS,
    },
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: ruleMatches([RULE_SEC_EXP_003], ['feature', 'flag', 'disabled']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_DISABLED_FLAG,
        rationale: ScoringRationales.CLIENT_DISABLED_FLAG_LEAK,
    },
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: ruleMatches([RULE_SEC_EXP_004], ['route', 'unreleased', 'preview', 'test']),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_UNRELEASED_ROUTE,
        rationale: ScoringRationales.CLIENT_UNRELEASED_ROUTE,
    },
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: anyFinding,
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_INTERNAL_ENDPOINT,
        rationale: ScoringRationales.CLIENT_INTERNAL_ENDPOINT,
    },
];
