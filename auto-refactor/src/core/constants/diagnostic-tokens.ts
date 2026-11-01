/**
 * Module: Core Constants — Diagnostic and Quality Evaluation Tokens
 * File Path: src/core/constants/diagnostic-tokens.ts
 * Architecture Role: Single source of truth for severity tiers, risk grades, verdicts,
 *     and rating metrics consumed by analyzers, reporters, CLI, and CI gates.
 * Dependencies & Triggers: Zero runtime dependencies; imported by core/types, analyzers,
 *     quality-printer, and report formatters.
 * Responsibilities: Export canonical constants for SARIF severities, risk levels, evaluation
 *     verdicts, and benchmark thresholds.
 * Exit Semantics & Design Rationale: Centralized immutable literal definitions avoiding
 *     drift across analyzers and reporting adapters.
 */

// ============================================================================
// Canonical Severity Levels (Aligned with SARIF 2.1.0)
// ============================================================================

/** Diagnostic severity tier for info findings. */
export const SEVERITY_INFO = 'info';
/** Diagnostic severity tier for warning findings. */
export const SEVERITY_WARNING = 'warning';
/** Diagnostic severity tier for error findings. */
export const SEVERITY_ERROR = 'error';

/** All supported diagnostic severity tiers. */
export const ALL_SEVERITIES = [SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR] as const;

/** Canonical numerical ranking for diagnostic severities. */
export const SEVERITY_RANK = Object.freeze({ info: 0, warning: 1, error: 2 } as const);

// ============================================================================
// Architecture Risk Levels
// ============================================================================

/** Architecture risk tier for low severity findings. */
export const RISK_LOW = 'Low';
/** Architecture risk tier for medium severity findings. */
export const RISK_MEDIUM = 'Medium';
/** Architecture risk tier for high severity findings. */
export const RISK_HIGH = 'High';
/** Architecture risk tier for critical severity findings. */
export const RISK_CRITICAL = 'Critical';

/** All recognized architecture risk categories. */
export const ALL_RISK_LEVELS = [RISK_LOW, RISK_MEDIUM, RISK_HIGH, RISK_CRITICAL] as const;

// ============================================================================
// Gate and Quality Verdict Tokens
// ============================================================================

/** Quality gate evaluation verdict indicating pass. */
export const VERDICT_PASS = 'pass';
/** Quality gate evaluation verdict indicating warn. */
export const VERDICT_WARN = 'warn';
/** Quality gate evaluation verdict indicating block. */
export const VERDICT_BLOCK = 'block';
/** Quality gate evaluation verdict indicating fail. */
export const VERDICT_FAIL = 'fail';

// ============================================================================
// Evidence and Certainty Tokens
// ============================================================================

/** Confidence weight for static proof evidence tier. */
export const EVIDENCE_STATIC_PROOF = 1.0;
/** Confidence weight for high confidence evidence tier. */
export const EVIDENCE_HIGH_CONFIDENCE = 0.9;
/** Confidence weight for heuristic evidence tier. */
export const EVIDENCE_HEURISTIC = 0.6;
/** Confidence weight for speculative evidence tier. */
export const EVIDENCE_SPECULATIVE = 0.3;

/** Sentinel token indicating dynamic evidence requirement. */
export const NEED_RUNTIME_EVIDENCE = 'NEED_RUNTIME_EVIDENCE';

// ============================================================================
// Diagnostic Status Tokens
// ============================================================================

/** Diagnostic status token for clean / passed state. */
export const DIAG_STATUS_PASS = 'pass';
/** Diagnostic status token for warning state. */
export const DIAG_STATUS_WARN = 'warn';
/** Diagnostic status token for error / block state. */
export const DIAG_STATUS_FAIL = 'fail';

// ============================================================================
// Metric Budget Thresholds
// ============================================================================

/**
 * Maximum control-flow nesting depth a function may reach before it is reported.
 *
 * One declaration for the two consumers that enforce it: the `GOV-LOG-001` governance rule and the
 * `maintainability` dimension deduction. They previously carried independent literals, so the rule
 * that reports deep nesting and the score that penalizes it could disagree about what "deep" means
 * while both read as authoritative. A caller may still override the limit through
 * `governance.maxNestingDepth`; this is the default both fall back to.
 */
export const MAX_CONTROL_FLOW_NESTING_DEPTH = 5;

/**
 * Maximum number of public symbols a single module may export before the deduction applies.
 *
 * Declared here rather than beside the deduction table because it is a budget a reader will
 * compare against `MAX_CONTROL_FLOW_NESTING_DEPTH`; keeping both budget thresholds in one section
 * is what makes the two limits discoverable together.
 */
export const MAX_MODULE_EXPORTED_SYMBOLS = 30;

// ============================================================================
// Actionable Remediation Markers
// ============================================================================

/** Action marker token for scaffolding a centralized constant library topology. */
export const ACTION_SCAFFOLD_CONSTANT_LIBRARY = 'scaffold_constant_library';
/** Action marker token for replacing inline token with constant reference. */
export const ACTION_REPLACE_TOKEN = 'replace_token';
/** Action marker token for extracting inline literal to constant declaration. */
export const ACTION_EXTRACT_CONSTANT = 'extract_constant';
