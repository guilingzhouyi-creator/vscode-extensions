/**
 * Module: Core Engine — Configuration Tuning & Level Cascades
 * File Path: src/core/config/config-tuning.ts
 * Architecture Role: Tuning stage of config resolution: scale/maturity auto-tuning plus the
 *   literal-classification, comment-level, and security-level cascades into analyzers.
 * Dependencies & Triggers: ./types, ./profiler/projectProfiler, ./profiler/scaleTuner; called by
 *   resolveConfig after the defaults/file/CLI layers are merged.
 * Responsibilities: Own the built-in analyzer ids shared with the defaults, resolve the effective
 *   scale grade and maturity tier, tune thresholds and analyzer options for each, and cascade the
 *   semantic/security levels onto the analyzers that consume them.
 * Exit Semantics & Design Rationale: Pure in-memory mutation of the analyzer map handed in;
 *   explicit threshold overrides always win over auto-tuning, so a caller that pinned a number
 *   never sees it silently retuned.
 */

import type {
    AnalyzerDeclaration,
    CommentLevel,
    ScanConfig,
    SecurityLevel,
    Thresholds,
} from '../types';
import { detectMaturityTier, detectProjectProfile } from '../profiler/projectProfiler';
import {
    evaluateScaleGrade,
    getMaturityTunedAnalyzerOptions,
    getMaturityTunedThresholds,
    getTunedAnalyzerOptions,
    getTunedThresholds,
} from '../profiler/scaleTuner';

import {
    ANALYZER_CONSTANTS,
    ANALYZER_SECRETS,
    ANALYZER_ARCHITECTURE,
    ANALYZER_COMMENTS,
    ANALYZER_SECURITY,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_GOVERNANCE,
    ANALYZER_PERFORMANCE,
    ANALYZER_HYGIENE,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_DOCS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_NAMING,
    ANALYZER_GO_MODERN,
    ANALYZER_SHELL_LINT,
} from '../scoring/dimensionLiterals';

export {
    ANALYZER_CONSTANTS,
    ANALYZER_SECRETS,
    ANALYZER_ARCHITECTURE,
    ANALYZER_COMMENTS,
    ANALYZER_SECURITY,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
};

/**
 * Analyzers that stay disabled until a config or CLI allow-list declares them.
 *
 * A Set keeps the lookup flat: the previous `name === 'x' || …` chain pushed the enclosing
 * function over the complexity threshold every time a pack was added, and the membership test is
 * the same question for every entry.
 */
export const SPECIALIZED_ANALYZERS = new Set<string>([
    ANALYZER_GOVERNANCE,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_DOCS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_NAMING,
    ANALYZER_GO_MODERN,
    ANALYZER_SHELL_LINT,
]);

/** Auto-tune estimate: source lines per profiled language entry. */
export const SLOC_PER_LANGUAGE_SAMPLE = 100;

/** Auto-tune secret heuristics (securityLevel=full) are slightly looser than the defaults. */
export const AUTO_TUNE_SECRET_MIN_LENGTH = 24;

/** Auto-tune secret entropy floor used when `securityLevel` is `full`. */
export const AUTO_TUNE_SECRET_ENTROPY_THRESHOLD = 4.2;

/** Effective scale grade resolved by the tuning stage. */
type ScaleGrade = NonNullable<ScanConfig['scaleGrade']>;

/** Effective maturity tier resolved by the tuning stage. */
type MaturityTier = NonNullable<ScanConfig['maturityTier']>;

/** CLI, API, or caller overrides accepted by `resolveConfig`. */
export type ConfigOverrides = Partial<Omit<ScanConfig, 'analyzers'>> & {
    configFile?: string;
    analyzers?: string[];
};

/** Everything the tuning stage hands back to the assembly stage. */
export interface AutoTuningResult {
    profile: ReturnType<typeof detectProjectProfile>;
    autoTuneScale: boolean;
    scaleGrade: ScanConfig['scaleGrade'];
    maturityTier: ScanConfig['maturityTier'];
    tunedThresholds: Thresholds;
}

/** Effective semantic and security levels after the cascade. */
export interface SemanticSecurityResult {
    commentLevel: CommentLevel;
    securityLevel: SecurityLevel;
    classifyLiterals: ScanConfig['classifyLiterals'];
    granularRules: ScanConfig['granularRules'];
}

/**
 * Layer base, config-file, and CLI thresholds (CLI wins over file, file over base).
 *
 * @param baseThresholds - Built-in thresholds from `defaultThresholds()`.
 * @param fileCfg - Config-file layer of the resolved config.
 * @param overrides - CLI/API override layer.
 * @returns The merged thresholds object.
 */
function mergeThresholds(
    baseThresholds: Thresholds,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): Thresholds {
    return { ...baseThresholds, ...(fileCfg.thresholds || {}), ...(overrides.thresholds || {}) };
}

/**
 * Estimate the scale grade from the profiled language mix when the caller pinned none.
 *
 * @param profile - Detected project profile.
 * @returns The evaluated scale grade.
 */
function scaleFromProfile(profile: ReturnType<typeof detectProjectProfile>): ScaleGrade {
    const sampleCount = Object.values(profile.languages).reduce((a, b) => a + b, 0);
    return evaluateScaleGrade({
        fileCount: sampleCount * 2,
        sloc: sampleCount * 2 * SLOC_PER_LANGUAGE_SAMPLE,
    });
}

/**
 * Apply scale-grade tuning to thresholds and analyzer options.
 *
 * @param scaleGrade - Effective scale grade.
 * @param tunedThresholds - Thresholds to tune (unchanged when the caller pinned thresholds).
 * @param analyzers - Mutable analyzer declarations map.
 * @param hasExplicitThresholds - True when file/CLI layers pinned thresholds explicitly.
 * @returns The tuned thresholds.
 */
function applyScaleTuning(
    scaleGrade: ScaleGrade,
    tunedThresholds: Thresholds,
    analyzers: Record<string, AnalyzerDeclaration>,
    hasExplicitThresholds: boolean,
): Thresholds {
    const next = hasExplicitThresholds
        ? tunedThresholds
        : getTunedThresholds(scaleGrade, tunedThresholds);
    for (const [name, decl] of Object.entries(analyzers)) {
        decl.options = getTunedAnalyzerOptions(scaleGrade, name, decl.options || {});
    }
    return next;
}

/**
 * Apply maturity-tier tuning to thresholds and analyzer options.
 *
 * @param maturityTier - Effective maturity tier.
 * @param tunedThresholds - Thresholds to tune (unchanged when the caller pinned thresholds).
 * @param analyzers - Mutable analyzer declarations map.
 * @param hasExplicitThresholds - True when file/CLI layers pinned thresholds explicitly.
 * @returns The tuned thresholds.
 */
function applyMaturityTuning(
    maturityTier: MaturityTier,
    tunedThresholds: Thresholds,
    analyzers: Record<string, AnalyzerDeclaration>,
    hasExplicitThresholds: boolean,
): Thresholds {
    const next = hasExplicitThresholds
        ? tunedThresholds
        : getMaturityTunedThresholds(maturityTier, tunedThresholds);
    for (const [name, decl] of Object.entries(analyzers)) {
        decl.options = getMaturityTunedAnalyzerOptions(maturityTier, name, decl.options || {});
    }
    return next;
}

/**
 * Resolve the effective maturity tier: CLI wins over config file, then auto-detection.
 *
 * Auto-detection only runs when auto-tuning is on, matching the historical behaviour where a
 * plain scan never pays for a maturity probe.
 *
 * @param root - Project root directory.
 * @param fileCfg - Config-file layer of the resolved config.
 * @param overrides - CLI/API override layer.
 * @param autoTuneScale - Whether scale auto-tuning is enabled.
 * @returns The effective tier, or undefined when none applies.
 */
function resolveMaturityTier(
    root: string,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
    autoTuneScale: boolean,
): ScanConfig['maturityTier'] {
    if (overrides.maturityTier || fileCfg.maturityTier) {
        return overrides.maturityTier || fileCfg.maturityTier;
    }
    return autoTuneScale ? detectMaturityTier(root) : undefined;
}

/**
 * Auto-tune scale grades, maturity tiers, and corresponding thresholds/analyzer options.
 *
 * @param root - Project root directory.
 * @param fileCfg - File-level configuration overrides.
 * @param overrides - CLI/API overrides.
 * @param baseThresholds - Base built-in thresholds.
 * @param analyzers - Mutable analyzer declarations map to update with tuned options.
 * @returns The profile, resolved tuning knobs, and the tuned thresholds.
 */
export function applyAutoTuning(
    root: string,
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
    baseThresholds: Thresholds,
    analyzers: Record<string, AnalyzerDeclaration>,
): AutoTuningResult {
    const profile = fileCfg.profile || overrides.profile || detectProjectProfile(root);
    const autoTuneScale = overrides.autoTuneScale ?? fileCfg.autoTuneScale ?? false;
    const hasExplicitThresholds = Boolean(fileCfg.thresholds || overrides.thresholds);
    let tunedThresholds = mergeThresholds(baseThresholds, fileCfg, overrides);
    let scaleGrade = fileCfg.scaleGrade || overrides.scaleGrade;

    if (autoTuneScale) {
        scaleGrade ||= scaleFromProfile(profile);
        tunedThresholds = applyScaleTuning(
            scaleGrade,
            tunedThresholds,
            analyzers,
            hasExplicitThresholds,
        );
    }

    const maturityTier = resolveMaturityTier(root, fileCfg, overrides, autoTuneScale);
    if (maturityTier) {
        tunedThresholds = applyMaturityTuning(
            maturityTier,
            tunedThresholds,
            analyzers,
            hasExplicitThresholds,
        );
    }

    return { profile, autoTuneScale, scaleGrade, maturityTier, tunedThresholds };
}
