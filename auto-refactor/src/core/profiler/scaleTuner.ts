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
import type { ScaleGrade, Thresholds } from '../types';

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
/** Analyzer id for simplify option tuning. */
const ANALYZER_SIMPLIFY = 'simplify';

/** Scale grade identifier for medium projects. */
const SCALE_GRADE_MEDIUM = 'medium';

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

// ── Simplify limits per scale ──
const MICRO_MAX_TERNARY_LENGTH = 100;
const ENTERPRISE_MAX_TERNARY_LENGTH = 80;
const MICRO_MAX_GUARD_NESTING = 4;
const ENTERPRISE_MAX_GUARD_NESTING = 3;

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
 * Tune simplify analyzer options by scale grade.
 *
 * @param grade - Scale grade.
 * @param tuned - Tuned options bag to mutate.
 */
function tuneSimplifyByGrade(grade: ScaleGrade, tuned: Record<string, any>): void {
    if (grade === SCALE_GRADE_MICRO || grade === SCALE_GRADE_SMALL) {
        tuned.maxTernaryLength = MICRO_MAX_TERNARY_LENGTH;
        tuned.maxGuardClauseNesting = MICRO_MAX_GUARD_NESTING;
    } else if (grade === SCALE_GRADE_ENTERPRISE || grade === SCALE_GRADE_LARGE) {
        tuned.maxTernaryLength = ENTERPRISE_MAX_TERNARY_LENGTH;
        tuned.maxGuardClauseNesting = ENTERPRISE_MAX_GUARD_NESTING;
    }
}

/**
 * Tune analyzer options by scale grade.
 *
 * @param grade - Scale grade.
 * @param analyzerName - Analyzer id.
 * @param baseOpts - Base option bag.
 * @returns Shallow-copied options with grade overrides applied.
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
        tuned.enforceCleanLayers = grade !== SCALE_GRADE_MICRO && grade !== SCALE_GRADE_SMALL;
    } else if (analyzerName === ANALYZER_COMMENTS) {
        if (grade === SCALE_GRADE_ENTERPRISE || grade === SCALE_GRADE_LARGE) {
            tuned.requirePublicApiDocs = true;
        }
    } else if (analyzerName === ANALYZER_SIMPLIFY) {
        tuneSimplifyByGrade(grade, tuned);
    }

    return tuned;
}

import { getMaturityTunedThresholds, getMaturityTunedAnalyzerOptions } from './scale-tuner-tiers';

export { getMaturityTunedThresholds, getMaturityTunedAnalyzerOptions };
