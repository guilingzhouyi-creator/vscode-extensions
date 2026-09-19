/**
 * Module: Core Engine — Immutable Audit Snapshot & Sandbox Types
 * File Path: src/core/snapshot/types.ts
 * Architecture Role: Formalizes the immutable quintuple AuditSnapshot = (E, R, C, L, S),
 *   guaranteeing reproducible, cyclic-free self-audits and baseline freezes.
 * Dependencies & Triggers: Consumed by snapshotManager, api.ts, and test/verification harnesses.
 * Responsibilities: Declare VersionInfo, BaselineScoreMetrics, and AuditSnapshot interfaces.
 * Exit Semantics & Design Rationale: Pure compile-time declarations erased at runtime.
 */

/**
 * Immutable version quintuple defining the exact execution context:
 * AuditSnapshot = (E, R, C, L, S)
 */
export interface VersionInfo {
    /** Semantic version tag of the engine, e.g. "0.3.0". */
    engineVersion: string;
    /** Monotonic identifier or hash of the immutable compiled rule set. */
    ruleVersion: string;
    /** Configuration schema & defaults signature hash. */
    configVersion: string;
    /** Multi-language AST/IR adapters suite revision. */
    languageAdapterVersion: string;
    /** Quality quantification scoring model revision. */
    scoringVersion: string;
}

/**
 * Quality and performance baseline numbers frozen at milestone points.
 */
export interface BaselineScoreMetrics {
    /** Overall composite quality score (0..100). */
    compositeScore: number;
    /** Number of registered active rules evaluated. */
    ruleCount: number;
    /** Number of known suppressed findings in debt ratchet baseline. */
    suppressedCount: number;
    /** Known blocking error findings at baseline time. */
    blockingErrorCount: number;
    /** Known blocking warning findings at baseline time. */
    blockingWarningCount: number;
    /** Whole-suite test execution time in seconds. */
    testSuiteLatencySec: number;
    /** Incremental compilation build time in seconds. */
    incrementalBuildLatencySec: number;
}

/**
 * Immutable Audit Snapshot: (E, R, C, L, S).
 * Decouples analysis runtime state from mutable project sources to prevent self-audit cycles.
 */
export interface AuditSnapshot {
    /** Unique snapshot identifier. */
    snapshotId: string;
    /** ISO timestamp when snapshot was captured. */
    timestamp: string;
    /** Formal version quintuple (E, R, C, L, S). */
    versions: VersionInfo;
    /** SHA-256 digest of all registered rule definitions. */
    rulesDigest: string;
    /** SHA-256 digest of default configuration schema and cascades. */
    configDigest: string;
    /** Registered supported languages in this snapshot. */
    supportedLanguages: string[];
    /** Baseline quality & performance metrics frozen with this snapshot. */
    baselineMetrics: BaselineScoreMetrics;
    /** List of all canonical and legacy rule IDs locked into this snapshot. */
    registeredRuleIds: string[];
}
