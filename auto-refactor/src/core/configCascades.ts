/**
 * Module: Core Engine — Configuration Level Cascades
 * File Path: src/core/configCascades.ts
 * Architecture Role: Semantic, comment, and security level cascade stage of config resolution.
 * Dependencies & Triggers: ./types and ./configTuning (shared analyzer ids, auto-tune constants,
 *   ConfigOverrides, SemanticSecurityResult); invoked by resolveConfig in ./config.
 * Responsibilities: Cascade literal-classification switches, comment levels, and security levels
 *   onto the analyzer declarations that consume them, including the secrets entropy block.
 * Exit Semantics & Design Rationale: Pure in-memory mutation of the analyzer map handed in; an
 *   explicit config-file or CLI level always wins over the built-in default.
 */
import type { AnalyzerDeclaration, CommentLevel, ScanConfig, SecurityLevel } from './types';
import {
    ANALYZER_ARCHITECTURE,
    ANALYZER_COMMENTS,
    ANALYZER_CONSTANTS,
    ANALYZER_SECRETS,
    ANALYZER_SECURITY,
    AUTO_TUNE_SECRET_ENTROPY_THRESHOLD,
    AUTO_TUNE_SECRET_MIN_LENGTH,
    type ConfigOverrides,
    type SemanticSecurityResult,
} from './configTuning';

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
