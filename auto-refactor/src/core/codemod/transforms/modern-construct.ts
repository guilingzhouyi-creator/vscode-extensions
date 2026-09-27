/**
 * Module: Core Codemod — Modern Construct Transform
 * File Path: src/core/codemod/transforms/modern-construct.ts
 * Architecture Role: Generates FixDescriptor for simplifying redundant boolean or
 *   ternary constructs.
 * Dependencies & Triggers: Triggered by `--fix` on `simplify/boolean` or related modernizer rules.
 * Responsibilities: Rewrite verbose boolean comparisons into concise canonical expressions.
 * Exit Semantics & Design Rationale: Emits guaranteed FixDescriptor; zero semantic deviation.
 */

import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/**
 * Configuration options for simplifying redundant boolean constructs.
 */
export interface SimplifyBooleanOptions {
    /** Target line number where expression begins (1-indexed). */
    readonly line: number;
    /** Starting column of the expression (1-indexed). */
    readonly startCol: number;
    /** Ending column of the expression (1-indexed). */
    readonly endCol: number;
    /** Simplified replacement expression text. */
    readonly replacementText: string;
}

/**
 * Creates a fix descriptor that simplifies redundant boolean or syntax constructs.
 *
 * @param _context - Transform analysis context for target file.
 * @param options - Configuration specifying target range and modernized replacement.
 * @returns FixDescriptor containing textual substitution edit.
 */
export function createSimplifyBooleanFix(
    _context: TransformContext,
    options: SimplifyBooleanOptions,
): FixDescriptor {
    const edit: TextEdit = {
        startLine: options.line,
        startCol: options.startCol,
        endLine: options.line,
        endCol: options.endCol,
        newText: options.replacementText,
    };

    return {
        ruleId: 'SIM-BOOL-001',
        description: `Simplify redundant boolean expression to '${options.replacementText}'`,
        safetyLevel: 'guaranteed',
        edits: [edit],
    };
}
