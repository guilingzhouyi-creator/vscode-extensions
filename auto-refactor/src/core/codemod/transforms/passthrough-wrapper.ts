/**
 * Module: Core Codemod — Passthrough Wrapper Function Melting Transform
 * File Path: src/core/codemod/transforms/passthrough-wrapper.ts
 * Architecture Role: Generates FixDescriptor and AAS actionable patches for HYG-WRAP-001.
 * Dependencies & Triggers: Consumes ../types and ../../types; invoked by fix-dispatcher.
 * Responsibilities:
 *   1. Detect trivial forwarding arrow functions and wrapper declarations delegating directly;
 *   2. Melt redundant forwarding wrappers into direct references or inline delegations;
 *   3. Emit AAS actionable.patch payloads for automated agent remediation.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4; 100% semantics-preserving.
 */

import type { AgentActionablePayload } from '../../types';
import type { FixDescriptor, TextEdit, TransformContext } from '../types';

/** Canonical rule identifier for passthrough wrapper melting. */
export const RULE_HYG_WRAP_001 = 'HYG-WRAP-001';

/**
 * Options configuring passthrough wrapper function melting.
 */
export interface PassthroughWrapperOptions {
    readonly line: number;
    readonly endLine?: number;
    readonly replacementText?: string;
    readonly targetFunction?: string;
}

/**
 * Creates an AAS actionable patch payload for HYG-WRAP-001.
 *
 * @param startLine - 1-indexed starting line number.
 * @param startCol - 1-indexed starting column.
 * @param endLine - 1-indexed ending line number.
 * @param endCol - 1-indexed ending column.
 * @param replacementText - Replacement melted function code.
 * @param rationale - Descriptive reason for wrapper melting.
 * @returns Standard AgentActionablePayload.
 */
export function createPassthroughActionablePayload(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    replacementText: string,
    rationale = 'Melt redundant passthrough wrapper function into direct target delegation',
): AgentActionablePayload {
    return {
        action: 'melt_trampoline',
        code: 'AR:HYG:001',
        patch: {
            range: { startLine, startCol, endLine, endCol },
            replacementText,
        },
        rationale,
        safeToAutomate: true,
    };
}

const ARROW_WRAPPER_PATTERN =
    /^(export\s+)?(const|let)\s+([a-zA-Z0-9_$]+)\s*=\s*\(([^)]*)\)\s*(?::\s*[^=]+)?=>\s*([a-zA-Z0-9_$]+)\(([^)]*)\);?$/;

function matchesForwardingArguments(paramsRaw: string, argsRaw: string): boolean {
    const params = paramsRaw
        .split(',')
        .map((p) => p.split(':')[0].trim())
        .filter(Boolean);
    const args = argsRaw
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    if (params.length !== args.length) return false;
    return params.every((p, idx) => p === args[idx]);
}

/**
 * Creates a FixDescriptor melting a trivial passthrough wrapper function.
 *
 * @param context - Target file transform context.
 * @param options - Configuration specifying target line and replacement.
 * @returns Generated FixDescriptor with replacement edit.
 */
export function createPassthroughWrapperFix(
    context: TransformContext,
    options: PassthroughWrapperOptions,
): FixDescriptor {
    const lineIdx = options.line - 1;
    if (lineIdx < 0 || lineIdx >= context.lines.length) {
        return {
            ruleId: RULE_HYG_WRAP_001,
            description: 'No-op passthrough wrapper melting',
            safetyLevel: 'guaranteed',
            edits: [],
        };
    }

    const currentLine = context.lines[lineIdx];

    if (options.replacementText) {
        const edit: TextEdit = {
            startLine: options.line,
            startCol: 1,
            endLine: options.endLine ?? options.line,
            endCol: currentLine.length + 1,
            newText: options.replacementText,
        };
        return {
            ruleId: RULE_HYG_WRAP_001,
            description: `Melt passthrough wrapper function at line ${options.line}`,
            safetyLevel: 'guaranteed',
            edits: [edit],
        };
    }

    const trimmed = currentLine.trim();
    const arrowMatch = trimmed.match(ARROW_WRAPPER_PATTERN);
    if (arrowMatch) {
        const [, exp, decl, wrapperName, paramsRaw, targetFn, argsRaw] = arrowMatch;
        if (matchesForwardingArguments(paramsRaw, argsRaw)) {
            const indent = currentLine.match(/^\s*/)?.[0] ?? '';
            const exportPrefix = exp ? 'export ' : '';
            const newText = `${indent}${exportPrefix}${decl} ${wrapperName} = ${targetFn};`;
            const edit: TextEdit = {
                startLine: options.line,
                startCol: 1,
                endLine: options.line,
                endCol: currentLine.length + 1,
                newText,
            };
            return {
                ruleId: RULE_HYG_WRAP_001,
                description: `Melt forwarding wrapper '${wrapperName}' directly to '${targetFn}'`,
                safetyLevel: 'guaranteed',
                edits: [edit],
            };
        }
    }

    return {
        ruleId: RULE_HYG_WRAP_001,
        description: `Melt passthrough wrapper at line ${options.line}`,
        safetyLevel: 'guaranteed',
        edits: [],
    };
}
