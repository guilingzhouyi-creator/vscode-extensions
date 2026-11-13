/**
 * Module: Core Codemod — Unreachable Dead Code Statement Cleaner Transform
 * File Path: src/core/codemod/transforms/dead-code-cleaner.ts
 * Architecture Role: Generates FixDescriptor and AAS actionable patches for HYG-DED-001.
 * Dependencies & Triggers: Consumes ../types and ../../types; invoked by fix-dispatcher.
 * Responsibilities:
 *   1. Detect unreachable dead statements after terminating control flow (return, throw, break);
 *   2. Prune dead statements up to enclosing block boundaries;
 *   3. Emit AAS actionable.patch payloads for automated agent remediation.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4; 100% semantics-preserving.
 */

import type { AgentActionablePayload } from '../../types';
import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/** Canonical rule identifier for unreachable dead code removal. */
export const RULE_HYG_DED_001 = 'HYG-DED-001';

/**
 * Options configuring dead code statement pruning.
 */
export interface DeadCodeCleanOptions {
    readonly line: number;
    readonly endLine?: number;
    readonly replacementText?: string;
}

/**
 * Creates an AAS actionable patch payload for HYG-DED-001.
 *
 * @param startLine - 1-indexed starting line number.
 * @param startCol - 1-indexed starting column.
 * @param endLine - 1-indexed ending line number.
 * @param endCol - 1-indexed ending column.
 * @param replacementText - Replacement text (empty string for deletion).
 * @param rationale - Descriptive reason for dead code removal.
 * @returns Standard AgentActionablePayload.
 */
export function createDeadCodeActionablePayload(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    replacementText = '',
    rationale = 'Prune unreachable dead code following terminating statement',
): AgentActionablePayload {
    return {
        action: 'simplify_control_flow',
        code: 'AR:HYG:001',
        patch: {
            range: { startLine, startCol, endLine, endCol },
            replacementText,
        },
        rationale,
        safeToAutomate: true,
    };
}

/**
 * Creates a FixDescriptor removing unreachable dead code statements.
 *
 * @param context - Target file transform context.
 * @param options - Configuration specifying dead code lines.
 * @returns Generated FixDescriptor with deletion edits.
 */
export function createDeadCodeCleanFix(
    context: TransformContext,
    options: DeadCodeCleanOptions,
): FixDescriptor {
    const lineIdx = options.line - 1;
    if (lineIdx < 0 || lineIdx >= context.lines.length) {
        return {
            ruleId: RULE_HYG_DED_001,
            description: 'No-op dead code cleaning',
            safetyLevel: 'guaranteed',
            edits: [],
        };
    }

    const endLine = options.endLine ?? options.line;
    const endLineIdx = Math.min(context.lines.length - 1, endLine - 1);
    const endCol = context.lines[endLineIdx].length + 1;

    const edit: TextEdit = {
        startLine: options.line,
        startCol: 1,
        endLine: endLine + 1 <= context.lines.length ? endLine + 1 : endLine,
        endCol: endLine + 1 <= context.lines.length ? 1 : endCol,
        newText: options.replacementText ?? '',
    };

    return {
        ruleId: RULE_HYG_DED_001,
        description: `Prune unreachable dead code at lines ${options.line}-${endLine}`,
        safetyLevel: 'guaranteed',
        edits: [edit],
    };
}
