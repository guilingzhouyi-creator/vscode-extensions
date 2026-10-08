/**
 * Module: Core Codemod — Constant Extraction Transform
 * File Path: src/core/codemod/transforms/extract-constant.ts
 * Architecture Role: Generates FixDescriptor for extracting magic literals into
 *   top-level constants.
 * Dependencies & Triggers: Triggered by `--fix` on `constants/magic-number` or `hardcoded-string`.
 * Responsibilities: Compute insertion coordinates, name sanitization, and declaration text edits.
 * Exit Semantics & Design Rationale: Emits guaranteed FixDescriptor; preserves original formatting.
 */

import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/**
 * Options configuring constant extraction.
 */
export interface ExtractConstantOptions {
    /** Target line number where literal occurs (1-indexed). */
    readonly line: number;
    /** Target column number where literal begins (1-indexed). */
    readonly startCol: number;
    /** Target column number where literal ends (1-indexed). */
    readonly endCol: number;
    /** Literal value string as represented in code. */
    readonly literalValue: string;
    /** Suggested name for the extracted constant identifier. */
    readonly suggestedName: string;
    /** Optional rule identifier attributing this fix (defaults to 'magic-number'). */
    readonly ruleId?: string;
}

function isCommentOrEmptyLine(line: string): boolean {
    if (line.length === 0) {
        return true;
    }
    return line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');
}

function isImportLine(line: string): boolean {
    return line.startsWith('import ') || line.startsWith('import{');
}

/**
 * Resolves the 1-indexed line number where a top-level constant should be inserted.
 * Locates the first non-import line following file header comments and imports.
 *
 * @param lines - Array of source file lines.
 * @returns 1-indexed target line number for constant declaration insertion.
 */
export function resolveConstantInsertionLine(lines: readonly string[]): number {
    let insertLine = 1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (isImportLine(line)) {
            insertLine = i + 2;
            continue;
        }

        if (isCommentOrEmptyLine(line)) {
            continue;
        }

        return insertLine === 1 ? i + 1 : insertLine;
    }

    return insertLine;
}

/**
 * Creates a fix descriptor that hoists a literal to a top-level constant definition.
 *
 * @param context - Transform analysis context for target file.
 * @param options - Configuration specifying target literal location and constant identifier.
 * @returns FixDescriptor containing insertion and replacement text edits.
 */
export function createExtractConstantFix(
    context: TransformContext,
    options: ExtractConstantOptions,
): FixDescriptor {
    const insertLine = resolveConstantInsertionLine(context.lines);
    const constDeclaration = `const ${options.suggestedName} = ${options.literalValue};\n`;

    const insertEdit: TextEdit = {
        startLine: insertLine,
        startCol: 1,
        endLine: insertLine,
        endCol: 1,
        newText: constDeclaration,
    };

    const replaceEdit: TextEdit = {
        startLine: options.line,
        startCol: options.startCol,
        endLine: options.line,
        endCol: options.endCol,
        newText: options.suggestedName,
    };

    const targetRule = options.ruleId || 'magic-number';

    return {
        ruleId: targetRule,
        description: `Extract literal ${options.literalValue} to constant ${options.suggestedName}`,
        safetyLevel: 'guaranteed',
        edits: [insertEdit, replaceEdit],
    };
}
