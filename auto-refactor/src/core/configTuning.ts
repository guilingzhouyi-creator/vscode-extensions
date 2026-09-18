/**
 * Module: Core Engine — Configuration Tuning & Level Cascades
 * File Path: src/core/configTuning.ts
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
} from './types';
import { detectMaturityTier, detectProjectProfile } from './profiler/projectProfiler';
import {
    evaluateScaleGrade,
    getMaturityTunedAnalyzerOptions,
    getMaturityTunedThresholds,
    getTunedAnalyzerOptions,
    getTunedThresholds,
} from './profiler/scaleTuner';

/** Built-in `constants` analyzer id; keys its `analyzers.constants` declaration. */
export const ANALYZER_CONSTANTS = 'constants';

/** Built-in `secrets` analyzer id; keys its `analyzers.secrets` declaration. */
export const ANALYZER_SECRETS = 'secrets';

/** Built-in `architecture` analyzer id; keys its `analyzers.architecture` declaration. */
export const ANALYZER_ARCHITECTURE = 'architecture';

/** Built-in `comments` analyzer id; keys its `analyzers.comments` declaration. */
export const ANALYZER_COMMENTS = 'comments';

/** Built-in `security` analyzer id; keys its `analyzers.security` declaration. */
export const ANALYZER_SECURITY = 'security';

/** Built-in `ts-modern` analyzer id; a specialized language pack, declared to be enabled. */
export const ANALYZER_TYPESCRIPT_MODERN = 'ts-modern';

/** Built-in `rust-modern` analyzer id; a specialized language pack, declared to be enabled. */
export const ANALYZER_RUST_MODERN = 'rust-modern';

/** Built-in `gdscript-modern` analyzer id; a specialized language pack, declared to be enabled. */
export const ANALYZER_GDSCRIPT_MODERN = 'gdscript-modern';

/**
 * Analyzers that stay disabled until a config or CLI allow-list declares them.
 *
 * A Set keeps the lookup flat: the previous `name === 'x' || …` chain pushed the enclosing
 * function over the complexity threshold every time a pack was added, and the membership test is
 * the same question for every entry.
 */
export const SPECIALIZED_ANALYZERS = new Set<string>([
    'governance',
    ANALYZER_ARCHITECTURE,
    'performance',
    ANALYZER_COMMENTS,
    'hygiene',
    ANALYZER_SECURITY,
    'simplify',
    'python-modern',
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    'docs',
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

/**
 * Turn the security and secrets analyzers off for `securityLevel: off`.
 *
 * @param analyzers - Mutable analyzer declarations map.
 */
function turnSecurityOff(analyzers: Record<string, AnalyzerDeclaration>): void {
    if (analyzers[ANALYZER_SECURITY]) analyzers[ANALYZER_SECURITY].enabled = false;
    if (analyzers[ANALYZER_SECRETS]) analyzers[ANALYZER_SECRETS].enabled = false;
}

/**
 * Cascade the security level onto the `security` analyzer, enabling it when declared.
 *
 * @param analyzers - Mutable analyzer declarations map.
 * @param securityLevel - Effective security level.
 */
function applySecurityAnalyzerLevel(
    analyzers: Record<string, AnalyzerDeclaration>,
    securityLevel: SecurityLevel,
): void {
    const decl = analyzers[ANALYZER_SECURITY];
    if (!decl) return;
    decl.enabled = true;
    decl.options = { ...(decl.options || {}), level: securityLevel };
}

/**
 * Cascade the security level onto the `secrets` analyzer, including the entropy block that
 * `securityLevel: full` enables and every weaker level leaves disabled.
 *
 * @param analyzers - Mutable analyzer declarations map.
 * @param securityLevel - Effective security level.
 */
function applySecretsAnalyzerLevel(
    analyzers: Record<string, AnalyzerDeclaration>,
    securityLevel: SecurityLevel,
): void {
    const decl = analyzers[ANALYZER_SECRETS];
    if (!decl) return;
    decl.enabled = true;
    decl.options = {
        ...(decl.options || {}),
        level: securityLevel,
        entropy:
            securityLevel === 'full'
                ? {
                      enabled: true,
                      minLength: AUTO_TUNE_SECRET_MIN_LENGTH,
                      threshold: AUTO_TUNE_SECRET_ENTROPY_THRESHOLD,
                  }
                : decl.options?.entropy || { enabled: false },
    };
}

/**
 * Cascade the security level onto the architecture analyzer's credential-leak check.
 *
 * @param analyzers - Mutable analyzer declarations map.
 * @param securityLevel - Effective security level.
 */
function applyArchitectureAnalyzerLevel(
    analyzers: Record<string, AnalyzerDeclaration>,
    securityLevel: SecurityLevel,
): void {
    const decl = analyzers[ANALYZER_ARCHITECTURE];
    if (!decl) return;
    decl.options = {
        ...(decl.options || {}),
        securityLevel,
        checkDtoCredentialLeakage: securityLevel === 'full',
    };
}

/**
 * Cascade security level settings to the security, secrets, and architecture analyzers.
 *
 * @param securityLevel - Effective security level.
 * @param overridesSecLevel - Security level specified in CLI/API overrides.
 * @param fileCfgSecLevel - Security level specified in the config file.
 * @param analyzers - Mutable analyzer declarations map.
 */
function cascadeSecurityLevel(
    securityLevel: SecurityLevel,
    overridesSecLevel: SecurityLevel | undefined,
    fileCfgSecLevel: SecurityLevel | undefined,
    analyzers: Record<string, AnalyzerDeclaration>,
): void {
    if (securityLevel === 'off') {
        turnSecurityOff(analyzers);
        return;
    }
    if (!overridesSecLevel && !fileCfgSecLevel) return;
    applySecurityAnalyzerLevel(analyzers, securityLevel);
    applySecretsAnalyzerLevel(analyzers, securityLevel);
    applyArchitectureAnalyzerLevel(analyzers, securityLevel);
}

/**
 * Merge literal-classification and granular-rule switches into the constants analyzer.
 *
 * @param analyzers - Mutable analyzer declarations map.
 * @param classifyLiterals - Classification switch from file/CLI layers, when set.
 * @param granularRules - Granular-rule switch from file/CLI layers, when set.
 */
function applyLiteralClassification(
    analyzers: Record<string, AnalyzerDeclaration>,
    classifyLiterals: boolean | undefined,
    granularRules: boolean | undefined,
): void {
    const decl = analyzers[ANALYZER_CONSTANTS];
    if (!decl) return;
    if (classifyLiterals === undefined && granularRules === undefined) return;
    decl.options = {
        ...(decl.options || {}),
        ...(classifyLiterals !== undefined ? { classifyLiterals } : {}),
        ...(granularRules !== undefined ? { granularRules } : {}),
    };
}

/**
 * Resolve the effective comment level (CLI wins over file, then 'standard').
 *
 * @param fileCfg - Config-file layer of the resolved config.
 * @param overrides - CLI/API override layer.
 * @returns The effective comment level.
 */
function resolveCommentLevel(
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): CommentLevel {
    return (overrides.commentLevel || fileCfg.commentLevel || 'standard') as CommentLevel;
}

/**
 * Resolve the effective security level (CLI wins over file, then 'basic').
 *
 * @param fileCfg - Config-file layer of the resolved config.
 * @param overrides - CLI/API override layer.
 * @returns The effective security level.
 */
function resolveSecurityLevel(
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
): SecurityLevel {
    return (overrides.securityLevel || fileCfg.securityLevel || 'basic') as SecurityLevel;
}

/**
 * Cascade the comment level onto the comments analyzer when any layer declared one.
 *
 * @param analyzers - Mutable analyzer declarations map.
 * @param commentLevel - Effective comment level.
 * @param declared - True when file or CLI layers declared a comment level.
 */
function applyCommentLevel(
    analyzers: Record<string, AnalyzerDeclaration>,
    commentLevel: CommentLevel,
    declared: boolean,
): void {
    const decl = analyzers[ANALYZER_COMMENTS];
    if (!decl || !declared) return;
    decl.enabled = commentLevel !== 'off';
    decl.options = { ...(decl.options || {}), level: commentLevel };
}

/**
 * Cascade literal classification, comment levels, and security levels into analyzer declarations.
 *
 * @param fileCfg - File-level configuration overrides.
 * @param overrides - CLI/API overrides.
 * @param analyzers - Mutable analyzer declarations map to update with cascaded options.
 * @returns The effective comment level, security level, and literal switches.
 */
export function applySemanticAndSecurityLevels(
    fileCfg: Partial<ScanConfig>,
    overrides: ConfigOverrides,
    analyzers: Record<string, AnalyzerDeclaration>,
): SemanticSecurityResult {
    const classifyLiterals = overrides.classifyLiterals ?? fileCfg.classifyLiterals;
    const granularRules = overrides.granularRules ?? fileCfg.granularRules;
    applyLiteralClassification(analyzers, classifyLiterals, granularRules);

    const commentLevel = resolveCommentLevel(fileCfg, overrides);
    const securityLevel = resolveSecurityLevel(fileCfg, overrides);
    applyCommentLevel(
        analyzers,
        commentLevel,
        Boolean(overrides.commentLevel || fileCfg.commentLevel),
    );
    cascadeSecurityLevel(securityLevel, overrides.securityLevel, fileCfg.securityLevel, analyzers);

    return { commentLevel, securityLevel, classifyLiterals, granularRules };
}
