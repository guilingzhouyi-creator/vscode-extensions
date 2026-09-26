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

export const SEVERITY_INFO = 'info';
export const SEVERITY_WARNING = 'warning';
export const SEVERITY_ERROR = 'error';

export const ALL_SEVERITIES = [
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
] as const;

// ============================================================================
// Architecture Risk Levels
// ============================================================================

export const RISK_LOW = 'Low';
export const RISK_MEDIUM = 'Medium';
export const RISK_HIGH = 'High';
export const RISK_CRITICAL = 'Critical';

export const ALL_RISK_LEVELS = [
    RISK_LOW,
    RISK_MEDIUM,
    RISK_HIGH,
    RISK_CRITICAL,
] as const;

// ============================================================================
// Gate and Quality Verdict Tokens
// ============================================================================

export const VERDICT_PASS = 'pass';
export const VERDICT_WARN = 'warn';
export const VERDICT_BLOCK = 'block';
export const VERDICT_FAIL = 'fail';

// ============================================================================
// Evidence and Certainty Tokens
// ============================================================================

export const EVIDENCE_STATIC_PROOF = 1.0;
export const EVIDENCE_HIGH_CONFIDENCE = 0.9;
export const EVIDENCE_HEURISTIC = 0.6;
export const EVIDENCE_SPECULATIVE = 0.3;

export const NEED_RUNTIME_EVIDENCE = 'NEED_RUNTIME_EVIDENCE';
