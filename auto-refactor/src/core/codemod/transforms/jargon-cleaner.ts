/**
 * Module: Core Codemod — Construction Phase Jargon Sanitizer Transform
 * File Path: src/core/codemod/transforms/jargon-cleaner.ts
 * Architecture Role: Generates FixDescriptor and AAS actionable patches for HYG-STB-002.
 * Dependencies & Triggers: Consumes ../types and ../../types; invoked by fix-dispatcher.
 * Responsibilities:
 *   1. Detect temporary construction phase jargon tokens in code or comments;
 *   2. Sanitize jargon tokens into objective architectural descriptions or prune stub lines;
 *   3. Emit AAS actionable.patch payloads for automated agent remediation.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4; 100% semantics-preserving.
 */

import type { AgentActionablePayload } from '../../types';
import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/** Canonical rule identifier for construction phase jargon sanitization. */
export const RULE_HYG_STB_002 = 'HYG-STB-002';

/**
 * Options configuring construction jargon sanitization.
 */
export interface JargonCleanOptions {
    readonly line: number;
    readonly endLine?: number;
    readonly replacementText?: string;
}

/**
 * Creates an AAS actionable patch payload for HYG-STB-002.
 *
 * @param startLine - 1-indexed starting line number.
 * @param startCol - 1-indexed starting column.
 * @param endLine - 1-indexed ending line number.
 * @param endCol - 1-indexed ending column.
 * @param replacementText - Sanitized replacement text.
 * @param rationale - Descriptive reason for jargon sanitization.
 * @returns Standard AgentActionablePayload.
 */
export function createJargonActionablePayload(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    replacementText: string,
    rationale = 'Sanitize construction phase jargon from comments and code annotations',
): AgentActionablePayload {
    return {
        action: 'sanitize_prose_terminology',
        code: 'AR:HYG:002',
        patch: {
            range: { startLine, startCol, endLine, endCol },
            replacementText,
        },
        rationale,
        safeToAutomate: true,
    };
}

const JARGON_PATTERN = /\b(p\d+|phase\d+|st\d+|wip)\b/gi;
const PURE_JARGON_COMMENT = /^\s*(\/\/|\/\*)\s*(TODO:?\s*)?(p\d+|phase\d+|st\d+|wip)\s*(\*\/)?$/i;

/**
 * Sanitizes a comment line by removing construction jargon or deleting purely stub comments.
 */
function sanitizeJargonLine(lineText: string, lineNum: number): TextEdit | null {
    if (PURE_JARGON_COMMENT.test(lineText.trim())) {
        return {
            startLine: lineNum,
            startCol: 1,
            endLine: lineNum + 1,
            endCol: 1,
            newText: '',
        };
    }

    const commentMatch = lineText.match(/^(.*?)(\/\/.*|\/\*.*?\*\/)$/);
    if (commentMatch) {
        const [, codePart, commentPart] = commentMatch;
        if (JARGON_PATTERN.test(commentPart)) {
            const sanitizedComment = commentPart.replace(JARGON_PATTERN, '');
            return {
                startLine: lineNum,
                startCol: 1,
                endLine: lineNum,
                endCol: lineText.length + 1,
                newText: `${codePart}${sanitizedComment}`,
            };
        }
    }

    return null;
}

/**
 * Creates a FixDescriptor sanitizing construction phase jargon.
 *
 * @param context - Target file transform context.
 * @param options - Configuration specifying target line and replacement.
 * @returns Generated FixDescriptor with sanitization edit.
 */
export function createJargonCleanFix(
    context: TransformContext,
    options: JargonCleanOptions,
): FixDescriptor {
    const lineIdx = options.line - 1;
    if (lineIdx < 0 || lineIdx >= context.lines.length) {
        return {
            ruleId: RULE_HYG_STB_002,
            description: 'No-op construction jargon sanitization',
            safetyLevel: 'guaranteed',
            edits: [],
        };
    }

    const currentLine = context.lines[lineIdx];

    if (options.replacementText !== undefined) {
        const edit: TextEdit = {
            startLine: options.line,
            startCol: 1,
            endLine: options.endLine ?? options.line,
            endCol: currentLine.length + 1,
            newText: options.replacementText,
        };
        return {
            ruleId: RULE_HYG_STB_002,
            description: `Sanitize construction jargon at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [edit],
        };
    }

    const edit = sanitizeJargonLine(currentLine, options.line);
    if (edit) {
        return {
            ruleId: RULE_HYG_STB_002,
            description: `Sanitize construction phase jargon at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [edit],
        };
    }

    return {
        ruleId: RULE_HYG_STB_002,
        description: `Sanitize construction jargon at line ${options.line}`,
        safetyLevel: 'guaranteed',
        edits: [],
    };
}
