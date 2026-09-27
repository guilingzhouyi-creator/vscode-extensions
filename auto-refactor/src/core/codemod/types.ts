/**
 * Module: Core Codemod — Type Definitions & Edit Contracts
 * File Path: src/core/codemod/types.ts
 * Architecture Role: Single source of truth for AST codemod patch descriptors and text edits.
 * Dependencies & Triggers: Consumed by PatchEngine, TextEditApplier, and transform rules.
 * Responsibilities: Define TextEdit, FixSafetyLevel, FixDescriptor, and PatchApplyResult.
 * Exit Semantics & Design Rationale: Pure TypeScript interfaces and types; zero runtime cost.
 */

/**
 * Represents a single text substitution range using 1-indexed coordinates.
 */
export interface TextEdit {
    /** Starting line (1-indexed, inclusive). */
    readonly startLine: number;
    /** Starting column (1-indexed, inclusive). */
    readonly startCol: number;
    /** Ending line (1-indexed, inclusive). */
    readonly endLine: number;
    /** Ending column (1-indexed, inclusive). */
    readonly endCol: number;
    /** Replacement text to substitute into the specified range. */
    readonly newText: string;
}

/**
 * Safety guarantee level for an automated fix.
 * - guaranteed: 100% semantics preserving, safe for unattended auto-fix.
 * - heuristic: High confidence but may require syntax or lint verification.
 * - manual_review: Suggestive transformation requiring human confirmation.
 */
export type FixSafetyLevel = 'guaranteed' | 'heuristic' | 'manual_review';

/**
 * Describes a discrete fix proposed by an analyzer rule.
 */
export interface FixDescriptor {
    /** Unique rule identifier that emitted this fix. */
    readonly ruleId: string;
    /** Human-readable explanation of what this fix changes. */
    readonly description: string;
    /** Safety level classification. */
    readonly safetyLevel: FixSafetyLevel;
    /** Ordered list of atomic text edits composing this fix. */
    readonly edits: readonly TextEdit[];
}

/**
 * Execution options configuring codemod dispatch and application.
 */
export interface CodemodOptions {
    /** If true, computes diffs without mutating files on disk. */
    readonly dryRun?: boolean;
    /** Whitelist of rule IDs permitted for automated application. */
    readonly rules?: readonly string[];
    /** Minimum safety level required for applying edits. */
    readonly safetyThreshold?: FixSafetyLevel;
}

/**
 * Read-only analysis context passed to rule-specific codemod transforms.
 */
export interface TransformContext {
    /** Target file path being transformed. */
    readonly filePath: string;
    /** Complete original source content. */
    readonly sourceText: string;
    /** Cached line splits for coordinate resolution. */
    readonly lines: readonly string[];
}

/**
 * Result of applying one or more fixes to a single source file.
 */
export interface PatchApplyResult {
    /** Path to the target source file. */
    readonly filePath: string;
    /** Content prior to patch application. */
    readonly originalContent: string;
    /** Content produced after patch application. */
    readonly patchedContent: string;
    /** Unified diff representation of the applied changes. */
    readonly unifiedDiff: string;
    /** Total number of fixes successfully applied. */
    readonly appliedFixCount: number;
    /** Total number of fixes omitted due to coordinate overlaps or conflicts. */
    readonly skippedConflictCount: number;
}
