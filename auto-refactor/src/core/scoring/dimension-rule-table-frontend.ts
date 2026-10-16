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
    RULE_UI_ENG_005,
    RULE_UI_ENG_006,
    RULE_UI_ENG_007,
    RULE_UI_ENG_008,
    RULE_PROD_HYG_001,
    RULE_PROD_HYG_002,
    RULE_PROD_HYG_003,
    RULE_SEC_EXP_001,
    RULE_SEC_EXP_002,
    RULE_SEC_EXP_003,
    RULE_SEC_EXP_004,
    RULE_SEC_EXP_005,
    RULE_VSC_UI_004,
    RULE_ARCH_PLM_001,
    RULE_SIM_INL_001,
    RULE_CPX_TRV_001,
    DEDUCTION_UI_A11Y,
    DEDUCTION_UI_DOM_DEPTH,
    DEDUCTION_UI_COMPONENT_REUSE,
    DEDUCTION_UI_NAMING,
    DEDUCTION_UI_IME_GUARD,
    DEDUCTION_UI_TABULAR_NUMS,
    DEDUCTION_UI_NESTED_BORDER,
    DEDUCTION_UI_CONTAINER_QUERY,
    DEDUCTION_PROD_DEBUG_RESIDUE,
    DEDUCTION_PROD_SOURCE_MAP,
    DEDUCTION_PROD_ENV_SECRET,
    DEDUCTION_SEC_INTERNAL_ENDPOINT,
    DEDUCTION_SEC_CSS_AUTH_BYPASS,
    DEDUCTION_SEC_DISABLED_FLAG,
    DEDUCTION_SEC_UNRELEASED_ROUTE,
    DEDUCTION_SEC_IFRAME_ACTIVATION,
    DEDUCTION_VSC_BORDER_JITTER,
    DEDUCTION_PLUMBING_OVERHEAD,
    DEDUCTION_ORPHAN_INLINE,
    DEDUCTION_TAUTOLOGICAL_LOOP,
    ANALYZER_VSCODE_EXTENSION,
    ANALYZER_TOKEN_DENSITY,
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
const DIMENSION_ARCHITECTURE_CONSISTENCY = 'architectureConsistency';

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
        covers: ruleMatches([RULE_UI_ENG_005], ['ime', 'composing', 'composition', 'enter']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UI_IME_GUARD,
        rationale: ScoringRationales.UI_IME_GUARD,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_006], ['tabular', 'tnum', 'counter', 'jitter']),
        dimension: DIMENSION_STANDARDIZATION,
        points: DEDUCTION_UI_TABULAR_NUMS,
        rationale: ScoringRationales.UI_TABULAR_NUMS,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches([RULE_UI_ENG_007], ['border', 'nested', 'enclosure']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UI_NESTED_BORDER,
        rationale: ScoringRationales.UI_NESTED_BORDER,
    },
    {
        analyzer: ANALYZER_FRONTEND,
        covers: ruleMatches(
            [RULE_UI_ENG_008],
            ['container', 'media', 'squash', 'text-wrap', 'overflow-wrap'],
        ),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_UI_CONTAINER_QUERY,
        rationale: ScoringRationales.UI_CONTAINER_QUERY_ANTI_SQUASH,
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
        covers: ruleMatches(
            [RULE_SEC_EXP_005],
            ['useractivation', 'activation', 'postmessage', 'message', 'synthetic'],
        ),
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_IFRAME_ACTIVATION,
        rationale: ScoringRationales.CLIENT_IFRAME_USER_ACTIVATION,
    },
    {
        analyzer: ANALYZER_CLIENT_EXPOSURE,
        covers: anyFinding,
        dimension: DIMENSION_CODE_SECURITY,
        points: DEDUCTION_SEC_INTERNAL_ENDPOINT,
        rationale: ScoringRationales.CLIENT_INTERNAL_ENDPOINT,
    },
    {
        analyzer: ANALYZER_VSCODE_EXTENSION,
        covers: ruleMatches([RULE_VSC_UI_004], ['jitter', 'border', 'inset']),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_VSC_BORDER_JITTER,
        rationale: ScoringRationales.VSCODE_BORDER_JITTER,
    },
    {
        analyzer: ANALYZER_TOKEN_DENSITY,
        covers: ruleMatches([RULE_ARCH_PLM_001], ['plumbing', 'por']),
        dimension: DIMENSION_ARCHITECTURE_CONSISTENCY,
        points: DEDUCTION_PLUMBING_OVERHEAD,
        rationale: ScoringRationales.LAYER_CONSTRAINT_VIOLATION,
    },
    {
        analyzer: ANALYZER_TOKEN_DENSITY,
        covers: ruleMatches([RULE_SIM_INL_001], ['orphan', 'inline']),
        dimension: DIMENSION_MAINTAINABILITY,
        points: DEDUCTION_ORPHAN_INLINE,
        rationale: ScoringRationales.SIMPLIFY_MAINTAINABILITY,
    },
    {
        analyzer: ANALYZER_TOKEN_DENSITY,
        covers: ruleMatches([RULE_CPX_TRV_001], ['tautological', 'loop']),
        dimension: DIMENSION_PERFORMANCE_EFFICIENCY,
        points: DEDUCTION_TAUTOLOGICAL_LOOP,
        rationale: ScoringRationales.INEFFICIENT_ALGORITHM_PATH,
    },
];
