/**
 * Module: Core Codemod — Unused Import Transform
 * File Path: src/core/codemod/transforms/unused-imports.ts
 * Architecture Role: Generates FixDescriptor for pruning unused import specifiers and statements.
 * Dependencies & Triggers: Triggered by `--fix` on `hygiene/unused-imports` or `dead-code`.
 * Responsibilities: Prune individual unused import specifiers or delete entire empty import lines.
 * Exit Semantics & Design Rationale: Emits guaranteed FixDescriptor; cleans trailing
 *   commas and whitespace.
 */

import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/**
 * Options configuring unused import elimination.
 */
export interface UnusedImportOptions {
    /** Target line number of the import statement (1-indexed). */
    readonly line: number;
    /** Specific symbol identifier to remove, or undefined to remove entire import line. */
    readonly unusedSymbol?: string;
}

/**
 * Creates a fix descriptor that safely removes an unused import statement or specifier.
 *
 * @param context - Transform analysis context for target file.
 * @param options - Configuration specifying target line and optional symbol to prune.
 * @returns FixDescriptor containing text deletion edits.
 */
export function createUnusedImportFix(
    context: TransformContext,
    options: UnusedImportOptions,
): FixDescriptor {
    const lineIndex = options.line - 1;
    if (lineIndex < 0 || lineIndex >= context.lines.length) {
        return {
            ruleId: 'HYG-DED-001',
            description: `Prune unused import at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [],
        };
    }

    const currentLine = context.lines[lineIndex];

    // If no specific symbol is specified or the import only imports this single symbol, delete line
    if (!options.unusedSymbol || !currentLine.includes(',')) {
        const deleteEdit: TextEdit = {
            startLine: options.line,
            startCol: 1,
            endLine: options.line + 1,
            endCol: 1,
            newText: '',
        };
        return {
            ruleId: 'HYG-DED-001',
            description: `Remove unused import line: ${currentLine.trim()}`,
            safetyLevel: 'guaranteed',
            edits: [deleteEdit],
        };
    }

    // Specific symbol inside destructuring: e.g. `import { A, B } from 'mod';`
    const symbol = options.unusedSymbol;
    const regex = new RegExp(`(\\s*\\b${symbol}\\b\\s*,?|,\\s*\\b${symbol}\\b)`);
    const match = currentLine.match(regex);

    if (match && match.index !== undefined) {
        const startCol = match.index + 1;
        const endCol = startCol + match[0].length;
        const removeSpecifierEdit: TextEdit = {
            startLine: options.line,
            startCol,
            endLine: options.line,
            endCol,
            newText: '',
        };
        return {
            ruleId: 'HYG-DED-001',
            description: `Prune unused import specifier '${symbol}' from line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [removeSpecifierEdit],
        };
    }

    return {
        ruleId: 'HYG-DED-001',
        description: `Prune unused import at line ${options.line}`,
        safetyLevel: 'guaranteed',
        edits: [],
    };
}
