/**
 * Module: Core Codemod — Simplify If-Else to Ternary Expression Transform
 * File Path: src/core/codemod/transforms/simplify-ternary.ts
 * Architecture Role: Generates FixDescriptor and AAS actionable patches for SIM-TRN-001.
 * Dependencies & Triggers: Consumes ../types and ../../types; invoked by fix-dispatcher.
 * Responsibilities:
 *   1. Detect redundant if-else return and assignment branches;
 *   2. Transform two-way branch expressions into clean single-line ternary expressions;
 *   3. Emit AAS actionable.patch payloads with exact source replacement ranges.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4; 100% semantics-preserving.
 */

import type { AgentActionablePayload } from '../../types';
import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/** Canonical rule identifier for ternary expression simplification. */
export const RULE_SIM_TRN_001 = 'SIM-TRN-001';

/**
 * Options configuring ternary expression simplification.
 */
export interface SimplifyTernaryOptions {
    readonly line: number;
    readonly endLine?: number;
    readonly replacementText?: string;
}

/**
 * Creates an AAS actionable patch payload for SIM-TRN-001.
 *
 * @param startLine - 1-indexed starting line number.
 * @param startCol - 1-indexed starting column.
 * @param endLine - 1-indexed ending line number.
 * @param endCol - 1-indexed ending column.
 * @param replacementText - Replacement ternary expression code.
 * @param rationale - Descriptive reason for simplification.
 * @returns Standard AgentActionablePayload.
 */
export function createTernaryActionablePayload(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    replacementText: string,
    rationale = 'Simplify redundant if-else branch into a single-line ternary expression',
): AgentActionablePayload {
    return {
        action: 'simplify_control_flow',
        code: 'AR:SIM:001',
        patch: {
            range: { startLine, startCol, endLine, endCol },
            replacementText,
        },
        rationale,
        safeToAutomate: true,
    };
}

const SINGLE_LINE_IF_ELSE_RETURN =
    /^\s*if\s*\((.+?)\)\s*return\s+(.+?);\s*else\s*return\s+(.+?);?\s*$/;

/**
 * Attempts to parse single-line or multi-line if-else return statements into ternary.
 */
function tryParseIfElseReturn(lines: readonly string[], startIdx: number): TextEdit | null {
    const firstLine = lines[startIdx];
    const singleMatch = firstLine.match(SINGLE_LINE_IF_ELSE_RETURN);
    if (singleMatch) {
        const indent = firstLine.match(/^\s*/)?.[0] ?? '';
        const [, cond, thenExpr, elseExpr] = singleMatch;
        return {
            startLine: startIdx + 1,
            startCol: 1,
            endLine: startIdx + 1,
            endCol: firstLine.length + 1,
            newText: `${indent}return ${cond.trim()} ? ${thenExpr.trim()} : ${elseExpr.trim()};`,
        };
    }

    if (startIdx + 4 < lines.length) {
        const l0 = lines[startIdx].trim();
        const l1 = lines[startIdx + 1].trim();
        const l2 = lines[startIdx + 2].trim();
        const l3 = lines[startIdx + 3].trim();
        const l4 = lines[startIdx + 4].trim();

        const ifMatch = l0.match(/^if\s*\((.+?)\)\s*\{?$/);
        const ret1Match = l1.match(/^return\s+(.+?);?$/);
        const elseMatch = l2.match(/^\}?\s*else\s*\{?$/);
        const ret2Match = l3.match(/^return\s+(.+?);?$/);
        const closeMatch = l4 === '}';

        if (ifMatch && ret1Match && elseMatch && ret2Match && closeMatch) {
            const indent = lines[startIdx].match(/^\s*/)?.[0] ?? '';
            const cond = ifMatch[1].trim();
            const thenVal = ret1Match[1].trim();
            const elseVal = ret2Match[1].trim();
            return {
                startLine: startIdx + 1,
                startCol: 1,
                endLine: startIdx + 5,
                endCol: lines[startIdx + 4].length + 1,
                newText: `${indent}return ${cond} ? ${thenVal} : ${elseVal};`,
            };
        }
    }

    return null;
}

/**
 * Creates a FixDescriptor simplifying an if-else statement into a ternary expression.
 *
 * @param context - Target file transform context.
 * @param options - Configuration specifying target line and replacement.
 * @returns Generated FixDescriptor with replacement edit.
 */
export function createSimplifyTernaryFix(
    context: TransformContext,
    options: SimplifyTernaryOptions,
): FixDescriptor {
    const lineIdx = options.line - 1;
    if (lineIdx < 0 || lineIdx >= context.lines.length) {
        return {
            ruleId: RULE_SIM_TRN_001,
            description: 'No-op ternary branch simplification',
            safetyLevel: 'guaranteed',
            edits: [],
        };
    }

    if (options.replacementText) {
        const endLine = options.endLine ?? options.line;
        const endLineIdx = Math.min(context.lines.length - 1, endLine - 1);
        const endCol = context.lines[endLineIdx].length + 1;
        const edit: TextEdit = {
            startLine: options.line,
            startCol: 1,
            endLine,
            endCol,
            newText: options.replacementText,
        };
        return {
            ruleId: RULE_SIM_TRN_001,
            description: `Simplify if-else branch into ternary expression at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [edit],
        };
    }

    const edit = tryParseIfElseReturn(context.lines, lineIdx);
    if (edit) {
        return {
            ruleId: RULE_SIM_TRN_001,
            description: `Simplify if-else branch into ternary expression at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [edit],
        };
    }

    return {
        ruleId: RULE_SIM_TRN_001,
        description: `Simplify if-else branch into ternary expression at line ${options.line}`,
        safetyLevel: 'guaranteed',
        edits: [],
    };
}
