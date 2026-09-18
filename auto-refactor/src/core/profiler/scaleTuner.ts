/**
 * Module: Core Profiler — Scale & Maturity Adaptive Threshold Tuning
 * File Path: src/core/profiler/scaleTuner.ts
 * Architecture Role: Pure policy tuner between raw project statistics and analyzer
 *   configuration; both axes (scale grade, maturity tier) fan out to threshold and
 *   analyzer-option overrides consumed by config resolution.
 * Dependencies & Triggers: ScaleGrade, MaturityTier, and Thresholds from ../types; invoked by
 *   config resolution after project profiling, for every scan, to shape analyzer options.
 * Responsibilities: Grade projects micro/small/medium/large/enterprise from fileCount and
 *   sloc; scale file-line and complexity thresholds per grade; tune governance nesting and
 *   inheritance limits, architecture enforceCleanLayers, and comments requirePublicApiDocs;
 *   relax or tighten thresholds per demo/prototype/production/industrial maturity; and switch
 *   comments/architecture/hygiene/performance options per tier.
 * Exit Semantics & Design Rationale: All functions are deterministic, side-effect free, and
 *   never throw or mutate the supplied base (each returns a spread copy); tuning is capped by
 *   Math.max/Math.min so caller baselines remain the floor for relaxations and the ceiling for
 *   industrial tightening; medium/production keep the base values as the neutral baseline.
 *   Every policy number is a named constant (the engine's own constants rule flags inline
 *   literals), so tuning intent reads as decisions rather than a wall of digits.
 */
import type { ScaleGrade, MaturityTier, Thresholds } from '../types';

/**
 * Input metrics describing project size for scale grading.
 * Only `fileCount` and `sloc` drive the grade; the optional `moduleCount` and `edgeCount`
 * are reserved for callers that profile graph shape and are ignored by grading.
 */
export interface ScaleStats {
    fileCount: number;
    sloc: number;
    moduleCount?: number;
    edgeCount?: number;
}

// ── Scale grade and analyzer identifiers ──
/** Scale grade identifier for micro projects; the smallest band grading can return. */
const SCALE_GRADE_MICRO = 'micro';
/** Scale grade identifier for small projects. */
const SCALE_GRADE_SMALL = 'small';
/** Scale grade identifier for large projects. */
const SCALE_GRADE_LARGE = 'large';
/** Scale grade identifier for enterprise projects; the fallback when no band matches. */
const SCALE_GRADE_ENTERPRISE = 'enterprise';
/** Analyzer id for the architecture analyzer's option tuning. */
const ANALYZER_ARCHITECTURE = 'architecture';
/** Analyzer id for the comments analyzer's option tuning. */
const ANALYZER_COMMENTS = 'comments';
/** Analyzer id for governance option tuning. */
const ANALYZER_GOVERNANCE = 'governance';
/** Analyzer id for hygiene option tuning. */
const ANALYZER_HYGIENE = 'hygiene';
/** Analyzer id for performance option tuning. */
const ANALYZER_PERFORMANCE = 'performance';

/** Scale grade identifier for medium projects. */
const SCALE_GRADE_MEDIUM = 'medium';

/** Maturity tier identifiers. */
const TIER_DEMO_NAME = 'demo';
const TIER_PROTOTYPE_NAME = 'prototype';
const TIER_PRODUCTION_NAME = 'production';
const TIER_INDUSTRIAL_NAME = 'industrial';

/** Comment level values. */
const COMMENT_LEVEL_OFF = 'off';
const COMMENT_LEVEL_BASIC = 'basic';
const COMMENT_LEVEL_STRICT = 'strict';

// ── Scale bands: inclusive ceilings, evaluated in order; enterprise is the fallback ──
const MICRO_MAX_FILES = 10;
const MICRO_MAX_SLOC = 1_500;
const SMALL_MAX_FILES = 50;
const SMALL_MAX_SLOC = 12_000;
const MEDIUM_MAX_FILES = 350;
const MEDIUM_MAX_SLOC = 90_000;
const LARGE_MAX_FILES = 1_500;
const LARGE_MAX_SLOC = 400_000;

// ── Per-grade threshold rows ──
const MICRO_FILE_LINES_WARN = 500;
const MICRO_FILE_LINES_FAIL = 1_000;
const MICRO_COMPLEXITY_WARN = 8;
const MICRO_COMPLEXITY_FAIL = 16;
const SMALL_FILE_LINES_WARN = 450;
const SMALL_FILE_LINES_FAIL = 900;
const SMALL_COMPLEXITY_WARN = 9;
const SMALL_COMPLEXITY_FAIL = 18;
const LARGE_FILE_LINES_WARN = 450;
const LARGE_FILE_LINES_FAIL = 850;
const LARGE_COMPLEXITY_WARN = 12;
const LARGE_COMPLEXITY_FAIL = 24;
const ENTERPRISE_FILE_LINES_WARN = 500;
const ENTERPRISE_FILE_LINES_FAIL = 950;
const ENTERPRISE_COMPLEXITY_WARN = 15;
const ENTERPRISE_COMPLEXITY_FAIL = 30;

// ── Governance limits per scale grade ──
const SMALL_SCALE_MAX_NESTING = 4;
const MEDIUM_SCALE_MAX_NESTING = 5;
const LARGE_SCALE_MAX_NESTING = 6;
const BASE_MAX_INHERITANCE = 2;
const LARGE_SCALE_MAX_INHERITANCE = 3;

// ── Maturity threshold rows ──
const DEMO_FILE_LINES_WARN = 800;
const DEMO_FILE_LINES_FAIL = 1_500;
const DEMO_COMPLEXITY_WARN = 20;
const DEMO_COMPLEXITY_FAIL = 35;
const PROTOTYPE_FILE_LINES_WARN = 600;
const PROTOTYPE_FILE_LINES_FAIL = 1_200;
const PROTOTYPE_COMPLEXITY_WARN = 15;
const PROTOTYPE_COMPLEXITY_FAIL = 25;
const INDUSTRIAL_FILE_LINES_WARN = 350;
const INDUSTRIAL_FILE_LINES_FAIL = 700;
const INDUSTRIAL_COMPLEXITY_WARN = 8;
const INDUSTRIAL_COMPLEXITY_FAIL = 14;

/** Industrial tier is the only tightening maturity row; demo/prototype relax. */
const INDUSTRIAL_MAX_LOOP_NESTING = 2;

/**
 * Classify a project into a scale grade from its file count and source lines of code.
 * The bands are cumulative (micro, small, medium, large, enterprise): the first band whose
 * fileCount AND sloc limits both hold wins, so oversized inputs fall through to enterprise.
 *
 * @param stats - Project size metrics; only `fileCount` and `sloc` affect the band, and both
 *   limits are inclusive.
 * @returns The matched scale grade; always one of the five grades and never throws.
 */
export function evaluateScaleGrade(stats: ScaleStats): ScaleGrade {
    const { fileCount, sloc } = stats;

    if (fileCount <= MICRO_MAX_FILES && sloc <= MICRO_MAX_SLOC) {
        return SCALE_GRADE_MICRO;
    }
    if (fileCount <= SMALL_MAX_FILES && sloc <= SMALL_MAX_SLOC) {
        return SCALE_GRADE_SMALL;
    }
    if (fileCount <= MEDIUM_MAX_FILES && sloc <= MEDIUM_MAX_SLOC) {
        return 'medium';
    }
    if (fileCount <= LARGE_MAX_FILES && sloc <= LARGE_MAX_SLOC) {
        return SCALE_GRADE_LARGE;
    }
    return SCALE_GRADE_ENTERPRISE;
}

/**
 * Derive elastic file-line and complexity thresholds for a project scale grade.
 * Thresholds move with project size instead of applying one rigid profile to every codebase:
 * relaxations use Math.max (never below the caller baseline) and tightenings use Math.min
 * (never above it), and the supplied base object is never mutated.
 *
 * @param grade - Scale grade returned by `evaluateScaleGrade`; selects the adjustment row.
 * @param base - Caller baseline thresholds, used as the floor for relaxations and the
 *   ceiling for tightenings; `medium` keeps the baseline unchanged.
 * @returns A new Thresholds object with the grade-specific limits; the input stays untouched.
 */
export function getTunedThresholds(grade: ScaleGrade, base: Thresholds): Thresholds {
    const tuned: Thresholds = { ...base };

    switch (grade) {
        case SCALE_GRADE_MICRO:
            // Micro tools: allow cohesive single-file scripts, but demand low complexity
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, MICRO_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, MICRO_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.min(base.complexityWarn, MICRO_COMPLEXITY_WARN);
            tuned.complexityFail = Math.min(base.complexityFail, MICRO_COMPLEXITY_FAIL);
            break;

        case SCALE_GRADE_SMALL:
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, SMALL_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, SMALL_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.min(base.complexityWarn, SMALL_COMPLEXITY_WARN);
            tuned.complexityFail = Math.min(base.complexityFail, SMALL_COMPLEXITY_FAIL);
            break;

        case 'medium':
            // Standard baseline
            break;

        case SCALE_GRADE_LARGE:
            // Large systems: slightly relax file size / complexity to avoid noise
            // drowning key defects
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, LARGE_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, LARGE_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.max(base.complexityWarn, LARGE_COMPLEXITY_WARN);
            tuned.complexityFail = Math.max(base.complexityFail, LARGE_COMPLEXITY_FAIL);
            break;

        case SCALE_GRADE_ENTERPRISE:
            tuned.fileLinesWarn = Math.max(base.fileLinesWarn, ENTERPRISE_FILE_LINES_WARN);
            tuned.fileLinesFail = Math.max(base.fileLinesFail, ENTERPRISE_FILE_LINES_FAIL);
            tuned.complexityWarn = Math.max(base.complexityWarn, ENTERPRISE_COMPLEXITY_WARN);
            tuned.complexityFail = Math.max(base.complexityFail, ENTERPRISE_COMPLEXITY_FAIL);
            break;
    }

    return tuned;
}

/**
 * Tune governance options by project scale grade.
 *
 * @param grade - Scale grade.
 * @param tuned - Mutable options object to update.
 */
function tuneGovernanceByGrade(grade: ScaleGrade, tuned: Record<string, any>): void {
    switch (grade) {
        case SCALE_GRADE_MICRO:
        case SCALE_GRADE_SMALL:
            tuned.maxNestingDepth = SMALL_SCALE_MAX_NESTING;
            tuned.maxInheritanceDepth = BASE_MAX_INHERITANCE;
            break;
        case SCALE_GRADE_MEDIUM:
            tuned.maxNestingDepth = MEDIUM_SCALE_MAX_NESTING;
            tuned.maxInheritanceDepth = BASE_MAX_INHERITANCE;
            break;
        case SCALE_GRADE_LARGE:
        case SCALE_GRADE_ENTERPRISE:
            tuned.maxNestingDepth = LARGE_SCALE_MAX_NESTING;
            tuned.maxInheritanceDepth = LARGE_SCALE_MAX_INHERITANCE;
            break;
    }
}

/**
 * Layer scale-grade overrides onto analyzer options.
 * Governance nesting limits relax with scale, inheritance limits step from 2 to 3 at large
 * scale, clean-layer enforcement is disabled for micro/small projects, and public API docs
 * become mandatory for large/enterprise. Other analyzers pass through unchanged.
 *
 * @param grade - Scale grade; unknown values apply no overrides.
 * @param analyzerName - Analyzer id to tune; matching is exact and case-sensitive.
 * @param baseOpts - Base option bag; shallow-copied, never mutated.
 * @returns A shallow copy of baseOpts with the grade-specific overrides applied.
 */
export function getTunedAnalyzerOptions(
    grade: ScaleGrade,
    analyzerName: string,
    baseOpts: Record<string, any>,
): Record<string, any> {
    const tuned = { ...baseOpts };

    if (analyzerName === ANALYZER_GOVERNANCE) {
        tuneGovernanceByGrade(grade, tuned);
    } else if (analyzerName === ANALYZER_ARCHITECTURE) {
        // Micro/small projects don't enforce strict multi-tier DDD separation by default
        tuned.enforceCleanLayers = grade !== SCALE_GRADE_MICRO && grade !== SCALE_GRADE_SMALL;
    } else if (analyzerName === ANALYZER_COMMENTS) {
        if (grade === SCALE_GRADE_ENTERPRISE || grade === SCALE_GRADE_LARGE) {
            tuned.requirePublicApiDocs = true;
        }
    }

    return tuned;
}

/**
 * Derive elastic thresholds for a project maturity tier (demo, prototype, production,
 * industrial). demo/prototype relax limits with Math.max, industrial tightens them with
 * Math.min, and production keeps the caller baseline; the base object is never mutated.
 *
 * @param tier - Maturity tier; selects the adjustment row.
 * @param base - Caller baseline thresholds, used as the floor for relaxations and the
 *   ceiling for industrial tightening.
 * @returns A new Thresholds object with the tier-specific file-line and complexity limits;
 *   the input stays untouched.
 */
export function getMaturityTunedThresholds(tier: MaturityTier, base: Thresholds): Thresholds {
    const tuned: Thresholds = { ...base };

    switch (tier) {
        case TIER_DEMO_NAME:
            // Demos: allow relaxed thresholds, prototype scripting, and fast iteration
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
            // Production baseline standard
            break;

        case TIER_INDUSTRIAL_NAME:
            // Industrial / Mission-critical: strict gates
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
 * @param analyzerName - Target analyzer identifier.
 * @param tuned - Mutable options object to update.
 */
function tuneByDemoTier(analyzerName: string, tuned: Record<string, any>): void {
    if (analyzerName === ANALYZER_COMMENTS) {
        tuned.requireHeader = false;
        tuned.level = COMMENT_LEVEL_OFF;
    } else if (analyzerName === ANALYZER_ARCHITECTURE) {
        tuned.enforceCleanLayers = false;
        tuned.allowSkipLayers = true;
        tuned.checkDtoCredentialLeakage = false;
    } else if (analyzerName === ANALYZER_HYGIENE) {
        tuned.checkDeadCode = false;
        tuned.checkTemporaryStubs = false;
    }
}

/**
 * Tune analyzer options for prototype-tier projects.
 *
 * @param analyzerName - Target analyzer identifier.
 * @param tuned - Mutable options object to update.
 */
function tuneByPrototypeTier(analyzerName: string, tuned: Record<string, any>): void {
    if (analyzerName === ANALYZER_COMMENTS) {
        tuned.requireHeader = false;
        tuned.level = COMMENT_LEVEL_BASIC;
    } else if (analyzerName === ANALYZER_ARCHITECTURE) {
        tuned.allowSkipLayers = true;
    } else if (analyzerName === ANALYZER_HYGIENE) {
        tuned.checkTemporaryStubs = false;
    }
}

/**
 * Tune analyzer options for industrial-tier projects.
 *
 * @param analyzerName - Target analyzer identifier.
 * @param tuned - Mutable options object to update.
 */
function tuneByIndustrialTier(analyzerName: string, tuned: Record<string, any>): void {
    if (analyzerName === ANALYZER_COMMENTS) {
        tuned.requireHeader = true;
        tuned.level = COMMENT_LEVEL_STRICT;
    } else if (analyzerName === ANALYZER_ARCHITECTURE) {
        tuned.enforceCleanLayers = true;
        tuned.allowSkipLayers = false;
        tuned.checkDtoCredentialLeakage = true;
    } else if (analyzerName === ANALYZER_PERFORMANCE) {
        tuned.maxLoopNesting = INDUSTRIAL_MAX_LOOP_NESTING;
        tuned.checkBlockingIO = true;
        tuned.checkTransientAllocations = true;
    }
}

/**
 * Layer maturity-tier overrides onto analyzer options.
 * demo disables header and strict comment checks plus several architecture/hygiene checks,
 * prototype softens comments to `basic`, and industrial enforces strict comments, clean
 * layers, credential-leak detection and tighter performance checks. Unlisted analyzers and
 * tiers keep the base options.
 *
 * @param tier - Maturity tier; only demo, prototype and industrial carry overrides.
 * @param analyzerName - Analyzer id to tune; matching is exact and case-sensitive.
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
