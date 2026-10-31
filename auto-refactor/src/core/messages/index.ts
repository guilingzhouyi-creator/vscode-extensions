/**
 * Module: Core Messages - Diagnostic Catalog Aggregation Barrel
 * File Path: src/core/messages/index.ts
 * Architecture Role: Public barrel for all message and type submodules; gives analyzers,
 *   scorers, and API consumers one stable import path for the message contract.
 * Dependencies & Triggers: Re-exports ./types, ./security, ./architecture, ./governance,
 *   ./performance, ./comments, ./hygiene, ./secrets, ./scoring, ./trajectory, ./guidance,
 *   and ./naming.
 *   Evaluated whenever a consumer imports ../core/messages, including CLI/CI/daemon bootstrap.
 * Responsibilities: Publish the twelve listed submodules under one namespace, exposing strongly
 *   typed descriptors, standardized English messages, remediation suggestions, scoring
 *   rationales, trajectory notifications, and agent guidance templates, with no filtering,
 *   transformation, or runtime side effects of its own.
 * Exit Semantics & Design Rationale: Static export-only module; successful load means every
 *   submodule resolved, while a missing or renamed submodule fails fast at build or import time
 *   rather than silently hiding diagnostics. Barrel re-exports preserve downstream import
 *   stability and the public src/api.ts message surface; no fallback path exists by design.
 */

export * from './types';
export * from './security';
export * from './architecture';
export * from './performance';
export * from './comments';
export * from './hygiene';
export * from './secrets';
export * from './scoring';
export * from './trajectory';
export * from './guidance';
export * from './naming';
export * from './exposure';

export { RedundantBooleanRule, ModernConstructRule } from '../governance/rules/standardization';
export { FileNamingRule, ModuleHeaderRule } from '../governance/rules/fileStructure';
export { ExcessiveNestingRule, VacuousWrapperRule } from '../governance/rules/codeLogic';
export {
    ExplicitTypingRule,
    FunctionSignatureCompletenessRule,
    UnsafeAnyRule,
} from '../governance/rules/typeSystem';
export { SwallowedExceptionRule, NakedUnwrapRule } from '../governance/rules/exceptionSafety';
export { DiagnosticLeakRule } from '../governance/rules/debugLogging';
export {
    LoopInvariantRule,
    InLoopLinearSearchRule,
    TimerLiteralRule,
    SyncIoRule,
} from '../governance/rules/performance';
export { InheritanceDepthRule, DomainDecouplingRule } from '../governance/rules/maintainability';
export { LexicalHygieneRule, DiagnosticMessageRule } from '../governance/rules/sanitization';
export { BUILTIN_GOVERNANCE_RULES } from '../governance/registry';

/**
 * Standardized governance evaluation warnings and explanations.
 */
export const GovernanceEvalMessages = {
    BONUS_NULLIFIED_OVER_ABSTRACTION:
        'Clean reuse bonus nullified due to presence of spurious indirection or cyclic over-abstraction.',

    BONUS_NULLIFIED_NEGATIVE_ROI_POOL:
        'Clean reuse bonus nullified due to presence of negative-ROI excessive micro-object pooling.',
} as const;

/**
 * Standardized human-readable descriptions for qualitative autonomy tiers (L1~L5).
 */
export const AutonomyGradeDescriptions = {
    L5_INDEPENDENT:
        'Extremely high autonomy: Core architecture and algorithms are entirely proprietary with minimal external SDK coupling',
    L4_HIGH_AUTONOMY:
        'High autonomy: Business logic and domain kernel are fully proprietary, integrating standard open-source ecosystems reasonably',
    L3_BALANCED:
        'Balanced autonomy: Core business is proprietary with moderate collaboration with mainstream frameworks and cloud ecosystems',
    L2_FRAMEWORK_DEPENDENT:
        'Framework dependent: Substantial business logic is composed as glue code around third-party external SDKs',
    L1_SHALLOW_WRAPPER:
        'Shallow wrapper: Primarily interface passthrough and third-party implementation references with low proprietary ratio',
} as const;

/**
 * Standardized messages, actions, and rationales for dual-track test topology evaluation.
 */
export const DualTrackTestMessages = {
    PROHIBITED_EMBEDDED_ZONE_MESSAGE: (ext: string): string =>
        `Embedded test code domain prohibited in ${ext} production source file. ` +
        `Enforce explicit test file topology (e.g. create dedicated *.test.ts).`,
    PROHIBITED_EMBEDDED_ZONE_RATIONALE: (filePath: string): string =>
        `Extract embedded test assertions from '${filePath}' into an explicit ` +
        `standalone test suite to maintain clean architectural boundaries.`,

    INTERLEAVED_TEST_ZONE_MESSAGE:
        'Embedded test zone is interleaved before production code. ' +
        'Move embedded test zone to the end of the file.',
    INTERLEAVED_TEST_ZONE_RATIONALE:
        'Relocate test block to file tail to maintain modern zone partitioning discipline.',

    RUST_MISSING_CFG_TEST_MESSAGE:
        'Rust embedded test module missing #[cfg(test)] conditional compilation ' +
        'attribute; risks production binary code bleed.',
    RUST_MISSING_CFG_TEST_RATIONALE:
        'Add #[cfg(test)] attribute to isolate test suite from release builds.',

    MISSING_INTENT_MESSAGE:
        'Embedded unit tests lack structured doc comments (Case/Assertion), ' +
        'inhibiting autonomous agent regression verification.',
    MISSING_INTENT_RATIONALE:
        "Add doc comments with 'Case:' and 'Assertion:' for machine-readability.",
} as const;

/**
 * Standardized risk fusion arbitration rationale formatters.
 */
export const RiskFusionRationales = {
    TELEMETRY_UNAVAILABLE:
        'Dynamic telemetry unavailable; risk inferred from static structural ' +
        'analysis with neutral dynamic baseline.',

    DUAL_CONFIRMED: (staticRisk: number, dynamicRisk: number): string =>
        `Dual-plane confirmed: High static structural risk (S=${staticRisk.toFixed(1)}) ` +
        `corroborated by runtime hotspot evidence (D=${dynamicRisk.toFixed(1)}). Risk amplified.`,

    SINGLE_SIDED_DAMPENED: (staticRisk: number, dynamicRisk: number): string =>
        `Single-sided dampening: High static complexity (S=${staticRisk.toFixed(1)}) ` +
        `refuted by cold runtime invocation evidence (D=${dynamicRisk.toFixed(1)}). Severity downgraded.`,

    HIDDEN_BOTTLENECK: (staticRisk: number, dynamicRisk: number): string =>
        `Hidden runtime bottleneck: Low static penalty (S=${staticRisk.toFixed(1)}) ` +
        `overridden by severe runtime latency/contention hotspot (D=${dynamicRisk.toFixed(1)}).`,

    STANDARD_FUSION: 'Standard dual-plane fusion across static and dynamic indicators.',

    CHURN_RELAXATION: (multiplier: number): string =>
        ` Churn relaxation applied for stable code (${multiplier.toFixed(2)}x).`,

    CHURN_AMPLIFICATION: (multiplier: number): string =>
        ` Churn amplification applied for active hotspot (${multiplier.toFixed(2)}x).`,
} as const;

/**
 * Standardized messages and actionable suggestions for anti-gaming violations.
 */
export const AntiGamingMessages = {
    ARTIFICIAL_SPLITTING_MESSAGE: (forwardingCount: number, effectiveDensity: number): string =>
        `Anti-gaming violation: detected artificial function splitting with ` +
        `${forwardingCount} trivial forwarding methods (density: ${effectiveDensity}).`,
    ARTIFICIAL_SPLITTING_SUGGESTION:
        'Avoid mechanically chopping cohesive logic into trivial forwarding wrappers; focus on domain cohesion.',

    TAUTOLOGICAL_TEST_MESSAGE: (count: number): string =>
        `Anti-gaming violation: detected ${count} tautological non-verifying assertions ` +
        `inflating test coverage artificially.`,
    TAUTOLOGICAL_TEST_SUGGESTION:
        'Replace tautological assertions with real behavioral input/output assertions.',

    RELOCATION_PADDING_MESSAGE: (relocatedCount: number): string =>
        `Anti-gaming violation: detected artificial relocation padding with ` +
        `${relocatedCount} constants moved across lines without functional or semantic changes.`,
    RELOCATION_PADDING_SUGGESTION:
        'Do not artificially move constants to inflate diff volume; pure relocations earn zero positive quality score.',

    TAUTOLOGICAL_COMMENT_MESSAGE: (effectiveCommentRatio: number): string =>
        `Detected tautological comment padding or water-logging (ECR: ${effectiveCommentRatio}).`,
    TAUTOLOGICAL_COMMENT_SUGGESTION:
        'Replace tautological line-by-line echoes with substantive design rationale and invariants.',

    NAMING_ENTROPY_MESSAGE: (entropy: number): string =>
        `Anti-gaming violation: detected low-entropy identifier sequence (entropy: ${entropy} bits/char).`,
    NAMING_ENTROPY_SUGGESTION:
        'Use meaningful semantic domain variable names instead of synthetic sequenced identifiers.',

    TAUTOLOGICAL_TRAVERSAL_MESSAGE: (count: number): string =>
        `Anti-gaming violation: detected ${count} tautological empty traversal loops ` +
        `inflating iteration volume without state change.`,
    TAUTOLOGICAL_TRAVERSAL_SUGGESTION:
        'Remove vacuous empty traversal loops; loops must mutate domain state or execute purposeful side-effects.',

    LOW_ENTROPY_TOKEN_MESSAGE: (totalLines: number, entropy: number): string =>
        `Anti-gaming violation: detected low-entropy token padding in large file ` +
        `(${totalLines} lines, H(T) = ${entropy} < 2.5 bits).`,
    LOW_ENTROPY_TOKEN_SUGGESTION:
        'Avoid inflating file volume with low-entropy repetitive tokens or repetitive dictionary definitions.',
} as const;
