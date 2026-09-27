/**
 * Module: Core Codemod — JSDoc Template Transform
 * File Path: src/core/codemod/transforms/jsdoc-template.ts
 * Architecture Role: Generates FixDescriptor for scaffolding compliant JSDoc annotations.
 * Dependencies & Triggers: Triggered by `--fix` on `comments/CMT-DOC-001` or `CMT-CON-001`.
 * Responsibilities: Generate JSDoc skeletons with description, params, returns, and concurrency.
 * Exit Semantics & Design Rationale: Emits heuristic FixDescriptor requiring human review of text.
 */

import { FormatPreserver } from '../format-preserver';
import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/**
 * Parameter definition for JSDoc documentation generation.
 */
export interface JsDocParam {
    /** Parameter name. */
    readonly name: string;
    /** Parameter description. */
    readonly description: string;
}

/**
 * Configuration options for generating a JSDoc template.
 */
export interface JsDocTemplateOptions {
    /** Target line number of the symbol declaration (1-indexed). */
    readonly line: number;
    /** Summary description of the symbol. */
    readonly summary: string;
    /** List of parameters to document. */
    readonly params?: readonly JsDocParam[];
    /** Return description, or undefined for void functions. */
    readonly returns?: string;
    /** Optional concurrency statement (e.g. Single-thread async cooperative execution). */
    readonly concurrency?: string;
}

/**
 * Creates a fix descriptor that prepends a formatted JSDoc comment block above a declaration.
 *
 * @param context - Transform analysis context for target file.
 * @param options - Configuration specifying doc summary, params, return, and concurrency.
 * @returns FixDescriptor containing JSDoc insertion text edit.
 */
export function createJsDocTemplateFix(
    context: TransformContext,
    options: JsDocTemplateOptions,
): FixDescriptor {
    const lineIndex = options.line - 1;
    const targetLine =
        lineIndex >= 0 && lineIndex < context.lines.length ? context.lines[lineIndex] : '';
    const baseIndent = FormatPreserver.getLineIndentation(targetLine);

    const docLines: string[] = ['/**'];
    docLines.push(` * ${options.summary}`);
    docLines.push(' *');

    if (options.params && options.params.length > 0) {
        for (const p of options.params) {
            docLines.push(` * @param ${p.name} - ${p.description}`);
        }
    }

    if (options.concurrency) {
        docLines.push(` * Concurrency: ${options.concurrency}.`);
    }

    if (options.returns) {
        docLines.push(` * @returns ${options.returns}`);
    }

    docLines.push(' */\n');

    const formattedBlock = docLines.map((l, idx) => (idx === 0 ? l : baseIndent + l)).join('\n');

    const insertEdit: TextEdit = {
        startLine: options.line,
        startCol: 1,
        endLine: options.line,
        endCol: 1,
        newText: formattedBlock,
    };

    return {
        ruleId: 'CMT-DOC-001',
        description: `Prepend standard JSDoc comment template for line ${options.line}`,
        safetyLevel: 'guaranteed',
        edits: [insertEdit],
    };
}
