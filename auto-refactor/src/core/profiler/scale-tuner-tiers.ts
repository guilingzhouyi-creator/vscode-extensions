/**
 * Module: Core Profiler — Maturity Tier Adaptive Threshold Tuning
 * File Path: src/core/profiler/scale-tuner-tiers.ts
 * Architecture Role: Tier-specific policy tuner for maturity levels (demo, prototype,
 *   production, industrial); overrides threshold limits and analyzer options.
 * Dependencies & Triggers: MaturityTier and Thresholds from ../types; invoked by
 *   config resolution and profiler scale tuning.
 * Responsibilities: Map maturity tiers to threshold relaxations or industrial tightening,
 *   and adjust comments, architecture, hygiene, performance, and simplify analyzer options.
 * Exit Semantics & Design Rationale: Deterministic, side-effect free, returns immutable copies.
 */
import type { MaturityTier, Thresholds } from '../types';

/** Maturity tier identifier: demo. */
export const TIER_DEMO_NAME = 'demo';
/** Maturity tier identifier: prototype. */
export const TIER_PROTOTYPE_NAME = 'prototype';
/** Maturity tier identifier: production. */
export const TIER_PRODUCTION_NAME = 'production';
/** Maturity tier identifier: industrial. */
export const TIER_INDUSTRIAL_NAME = 'industrial';

/** Comment level value: off. */
export const COMMENT_LEVEL_OFF = 'off';
/** Comment level value: basic. */
export const COMMENT_LEVEL_BASIC = 'basic';
/** Comment level value: strict. */
export const COMMENT_LEVEL_STRICT = 'strict';

/** File line warning threshold for demo tier. */
export const DEMO_FILE_LINES_WARN = 800;
/** File line failure threshold for demo tier. */
export const DEMO_FILE_LINES_FAIL = 1_500;
/** Complexity warning threshold for demo tier. */
export const DEMO_COMPLEXITY_WARN = 20;
/** Complexity failure threshold for demo tier. */
export const DEMO_COMPLEXITY_FAIL = 35;
/** File line warning threshold for prototype tier. */
export const PROTOTYPE_FILE_LINES_WARN = 600;
/** File line failure threshold for prototype tier. */
export const PROTOTYPE_FILE_LINES_FAIL = 1_200;
/** Complexity warning threshold for prototype tier. */
export const PROTOTYPE_COMPLEXITY_WARN = 15;
/** Complexity failure threshold for prototype tier. */
export const PROTOTYPE_COMPLEXITY_FAIL = 25;
/** File line warning threshold for industrial tier. */
export const INDUSTRIAL_FILE_LINES_WARN = 350;
/** File line failure threshold for industrial tier. */
export const INDUSTRIAL_FILE_LINES_FAIL = 700;
/** Complexity warning threshold for industrial tier. */
export const INDUSTRIAL_COMPLEXITY_WARN = 8;
/** Complexity failure threshold for industrial tier. */
export const INDUSTRIAL_COMPLEXITY_FAIL = 14;

/** Industrial tier tightening limit for loop nesting. */
export const INDUSTRIAL_MAX_LOOP_NESTING = 2;

/** Maximum ternary expression length for demo tier. */
export const DEMO_MAX_TERNARY_LENGTH = 120;
/** Maximum guard clause nesting depth for micro scale. */
export const MICRO_MAX_GUARD_NESTING = 4;
/** Maximum ternary expression length for enterprise tier. */
export const ENTERPRISE_MAX_TERNARY_LENGTH = 80;
/** Maximum guard clause nesting depth for enterprise tier. */
export const ENTERPRISE_MAX_GUARD_NESTING = 3;

const ANALYZER_ARCHITECTURE = 'architecture';
const ANALYZER_COMMENTS = 'comments';
const ANALYZER_HYGIENE = 'hygiene';
const ANALYZER_PERFORMANCE = 'performance';
const ANALYZER_SIMPLIFY = 'simplify';

/**
 * Derive elastic thresholds for a project maturity tier (demo, prototype, production,
 * industrial). demo/prototype relax limits with Math.max, industrial tightens them with
 * Math.min, and production keeps the caller baseline; the base object is never mutated.
 *
 * @param tier - Maturity tier; selects the adjustment row.
 * @param base - Caller baseline thresholds, used as the floor for relaxations and the
 *   ceiling for industrial tightening.
 * @returns A new Thresholds object with the tier-specific file-line and complexity limits.
 */
export function getMaturityTunedThresholds(tier: MaturityTier, base: Thresholds): Thresholds {
    const tuned: Thresholds = { ...base };

    switch (tier) {
        case TIER_DEMO_NAME:
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, DEMO_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, DEMO_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.max(base.complexityWarn, DEMO_COMPLEXITY_WARN);
            tuned.complexityFail = Math.max(base.complexityFail, DEMO_COMPLEXITY_FAIL);
            break;

        case TIER_PROTOTYPE_NAME:
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, PROTOTYPE_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, PROTOTYPE_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.max(base.complexityWarn, PROTOTYPE_COMPLEXITY_WARN);
            tuned.complexityFail = Math.max(base.complexityFail, PROTOTYPE_COMPLEXITY_FAIL);
            break;

        case TIER_PRODUCTION_NAME:
            break;

        case TIER_INDUSTRIAL_NAME:
            tuned.fileLinesWarn = Math.min(base.fileLinesWarn, INDUSTRIAL_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.min(base.fileLinesFail, INDUSTRIAL_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.min(base.complexityWarn, INDUSTRIAL_COMPLEXITY_WARN);
            tuned.complexityFail = Math.min(base.complexityFail, INDUSTRIAL_COMPLEXITY_FAIL);
            break;
    }

    return tuned;
}

/**
 * Tune analyzer options for demo-tier projects.
 *
 * @param analyzerName - Analyzer id.
 * @param tuned - Tuned options bag to mutate.
 */
function tuneByDemoTier(analyzerName: string, tuned: Record<string, any>): void {
    switch (analyzerName) {
        case ANALYZER_COMMENTS:
            tuned.requireHeader = false;
            tuned.level = COMMENT_LEVEL_OFF;
            break;
        case ANALYZER_ARCHITECTURE:
            tuned.enforceCleanLayers = false;
            tuned.allowSkipLayers = true;
            tuned.checkDtoCredentialLeakage = false;
            break;
        case ANALYZER_HYGIENE:
            tuned.checkDeadCode = false;
            tuned.checkTemporaryStubs = false;
            break;
        case ANALYZER_SIMPLIFY:
            tuned.maxTernaryLength = DEMO_MAX_TERNARY_LENGTH;
            tuned.maxGuardClauseNesting = MICRO_MAX_GUARD_NESTING;
            break;
    }
}

/**
 * Tune analyzer options for prototype-tier projects.
 *
 * @param analyzerName - Analyzer id.
 * @param tuned - Tuned options bag to mutate.
 */
function tuneByPrototypeTier(analyzerName: string, tuned: Record<string, any>): void {
    switch (analyzerName) {
        case ANALYZER_COMMENTS:
            tuned.requireHeader = false;
            tuned.level = COMMENT_LEVEL_BASIC;
            break;
        case ANALYZER_ARCHITECTURE:
            tuned.allowSkipLayers = true;
            break;
        case ANALYZER_HYGIENE:
            tuned.checkTemporaryStubs = false;
            break;
    }
}

/**
 * Tune analyzer options for industrial-tier projects.
 *
 * @param analyzerName - Analyzer id.
 * @param tuned - Tuned options bag to mutate.
 */
function tuneByIndustrialTier(analyzerName: string, tuned: Record<string, any>): void {
    switch (analyzerName) {
        case ANALYZER_COMMENTS:
            tuned.requireHeader = true;
            tuned.level = COMMENT_LEVEL_STRICT;
            break;
        case ANALYZER_ARCHITECTURE:
            tuned.enforceCleanLayers = true;
            tuned.allowSkipLayers = false;
            tuned.checkDtoCredentialLeakage = true;
            break;
        case ANALYZER_PERFORMANCE:
            tuned.maxLoopNesting = INDUSTRIAL_MAX_LOOP_NESTING;
            tuned.checkBlockingIO = true;
            tuned.checkTransientAllocations = true;
            break;
        case ANALYZER_SIMPLIFY:
            tuned.maxTernaryLength = ENTERPRISE_MAX_TERNARY_LENGTH;
            tuned.maxGuardClauseNesting = ENTERPRISE_MAX_GUARD_NESTING;
            break;
    }
}

/**
 * Layer maturity-tier overrides onto analyzer options.
 *
 * @param tier - Maturity tier.
 * @param analyzerName - Analyzer id to tune.
 * @param baseOpts - Base option bag; shallow-copied, never mutated.
 * @returns A shallow copy of baseOpts with the tier-specific overrides applied.
 */
export function getMaturityTunedAnalyzerOptions(
    tier: MaturityTier,
    analyzerName: string,
    baseOpts: Record<string, any>,
): Record<string, any> {
    const tuned = { ...baseOpts };

    switch (tier) {
        case TIER_DEMO_NAME:
            tuneByDemoTier(analyzerName, tuned);
            break;
        case TIER_PROTOTYPE_NAME:
            tuneByPrototypeTier(analyzerName, tuned);
            break;
        case TIER_INDUSTRIAL_NAME:
            tuneByIndustrialTier(analyzerName, tuned);
            break;
    }

    return tuned;
}
