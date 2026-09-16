/**
 * Module: Core Messages - Hygiene, Dead Code & Cleanliness Diagnostics
 * File Path: src/core/messages/hygiene.ts
 * Architecture Role: Static descriptor catalog for the hygiene analyzer's naming, dead-code,
 *   stub/jargon, and code-clone checks, with standard English messages for clean-code hygiene;
 *   detection logic lives entirely in the analyzer.
 * Dependencies & Triggers: Imports DiagnosticDescriptor from ./types; loaded when the hygiene
 *   analyzer imports ../core/messages, and its descriptor entries are read only when HYG-NAM,
 *   HYG-DED, HYG-STB, or HYG-CLN findings are emitted by CLI, CI, post-scan, or daemon runs.
 * Responsibilities: Supply factories for kebab-case and snake_case file-name violations, a
 *   static unreachable-code descriptor, temporary-stub and transient-jargon factories, and a
 *   duplicate-clone factory with per-rule message, suggestion, rationale, and risk text.
 * Exit Semantics & Design Rationale: Pure constant object; reading or building entries has no
 *   I/O, exceptions, or shared mutation, so repeated scans yield identical diagnostics. Keeping
 *   hygiene wording centralized makes rule-code coverage and Low/Medium risk levels auditable
 *   while analyzer code remains limited to detection and location reporting.
 */

import type { DiagnosticDescriptor } from './types';

/** Risk tier for hygiene findings that render as Medium severity. */
const RISK_MEDIUM = 'Medium';

/**
 * Hygiene-rule diagnostic descriptor catalog.
 *
 * Exposes factories for file-naming, temporary-stub, transient-jargon, and duplicate-clone
 * findings plus the shared HYG-DED-001 unreachable-code descriptor. Factories map analyzer
 * detector values such as file names, marker strings, jargon tokens, and clone metrics into
 * fresh DiagnosticDescriptor records; the unreachable-code entry carries no per-file data and
 * is therefore reusable. Inputs are interpolated verbatim, so callers own validation and
 * sanitization. All entries are plain synchronous data with no I/O or shared mutation, and
 * valid reads or calls cannot throw.
 */
export const HygieneMessages = {
    // HYG-NAM-001
    /**
     * Build the HYG-NAM-001 descriptor for a file name that mixes casing and underscores.
     *
     * @param baseName - Offending file name without directories, interpolated verbatim.
     * @returns Fresh descriptor with Low risk and kebab-case remediation guidance.
     */
    FILE_NAMING_KEBAB: (baseName: string): DiagnosticDescriptor => ({
        message: `File naming convention violation: '${baseName}' mixes casing and underscores; standardize to kebab-case`,
        suggestion:
            'TypeScript/JavaScript repositories should uniformly name source files using kebab-case',
        rationale:
            'Inconsistent file casing causes filesystem case-sensitivity bugs across Linux and Windows CI environments.',
        risk: 'Low',
    }),

    /**
     * Build the HYG-NAM-001 descriptor for a file name that violates snake_case policy.
     *
     * @param baseName - Offending file name without directories, interpolated verbatim.
     * @returns Fresh descriptor with Medium risk and snake_case remediation guidance.
     */
    FILE_NAMING_SNAKE: (baseName: string): DiagnosticDescriptor => ({
        message: `File naming convention violation: '${baseName}' does not comply with snake_case naming contract`,
        suggestion:
            'GDScript, Python, and Rust source files must strictly adhere to lowercase snake_case naming',
        rationale:
            'Python, Rust, and Godot module resolution and style conventions dictate snake_case filenames.',
        risk: RISK_MEDIUM,
    }),

    // HYG-DED-001
    /**
     * Shared descriptor for unreachable statements after return, throw, break, or continue.
     * It carries no per-file values, so one frozen object can be reused across findings.
     */
    UNREACHABLE_CODE: {
        message:
            'Dead code detected: Statement is unreachable following a terminal control flow statement (return/throw/break/continue)',
        suggestion:
            'Remove unreachable dead code or refactor surrounding branch conditions to ensure reachable execution flow',
        rationale:
            'Unreachable code confuses developers, wastes compiler cycles, and often hides incomplete refactorings.',
        risk: RISK_MEDIUM,
    } as const satisfies DiagnosticDescriptor,

    // HYG-STB-001
    /**
     * Build the HYG-STB-001 descriptor for a temporary stub or unresolved task marker.
     *
     * @param marker - Detected placeholder marker text, interpolated verbatim.
     * @returns Fresh descriptor with Low risk and stub-removal guidance.
     */
    TEMPORARY_STUB: (marker: string): DiagnosticDescriptor => ({
        message: `Temporary placeholder marker detected: Found '${marker}' stub or unresolved task indicator`,
        suggestion:
            'Complete pending logic before production release or file an external tracking issue to avoid shipping stub code',
        rationale:
            'Unfinished stubs in production code risk runtime exceptions and unhandled business edge cases.',
        risk: 'Low',
    }),

    // HYG-STB-002
    /**
     * Build the HYG-STB-002 descriptor for transient ticket or sprint jargon in a comment.
     *
     * @param jargon - Detected task-jargon token, interpolated verbatim.
     * @returns Fresh descriptor with Medium risk and neutral-wording guidance.
     */
    TRANSIENT_JARGON: (jargon: string): DiagnosticDescriptor => ({
        message: `Ephemeral project jargon or task batch marker leaked: Comment or symbol contains '${jargon}'`,
        suggestion:
            'Remove ticket or transient batch codes from long-term codebase assets; use neutral domain terms',
        rationale:
            'Coupling source comments to short-lived sprint tickets obscures business intent for future maintainers.',
        risk: RISK_MEDIUM,
    }),

    // HYG-CLN-001
    /**
     * Build the HYG-CLN-001 descriptor for a duplicated statement block.
     *
     * @param minCloneLines - Number of consecutive duplicated statements detected.
     * @param originalLine - One-based line number of the earlier clone occurrence.
     * @returns Fresh descriptor with Medium risk and extraction guidance.
     */
    DUPLICATE_CODE_CLONE: (minCloneLines: number, originalLine: number): DiagnosticDescriptor => ({
        message: `Code clone detected: Block of ${minCloneLines} consecutive statements is highly duplicated with line ${originalLine}`,
        suggestion:
            'Extract shared logic into a private helper function, utility method, or reusable component',
        rationale:
            'Duplicated code clusters lead to divergent maintenance and incomplete bugfixes across copies.',
        risk: RISK_MEDIUM,
    }),
} as const;
