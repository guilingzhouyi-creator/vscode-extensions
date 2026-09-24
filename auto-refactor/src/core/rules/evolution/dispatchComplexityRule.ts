/**
 * Module: Core Rules — Evolution: Monolithic Dispatcher & Closure Density Rules
 * File Path: src/core/rules/evolution/dispatchComplexityRule.ts
 * Architecture Role: Implements detection for ARCH-DISP-001 (monolithic switch/if branching)
 *   and ARCH-DSP-002 (dispatcher closure fragmentation and function inflation).
 * Dependencies & Triggers: Consumes AnalyzerContext and Issue; called by ArchitectureAnalyzer
 *   and Layer 1 rule evaluators.
 * Responsibilities: Detect monolithic branch dispatchers exceeding branch threshold (ARCH-DISP-001)
 *   and object literal dispatcher tables exceeding inline closure threshold (ARCH-DSP-002).
 * Exit Semantics & Design Rationale: Pure, linear line-based scan with zero AST overhead.
 */

import type { AnalyzerContext, Issue } from '../../types';
import { SEVERITY_WARNING } from '../../types';

/** Canonical rule ID for switch dispatch complexity. */
export const ARCH_DISP_RULE_ID = 'ARCH-DISP-001';

/** Canonical rule ID for dispatcher closure fragmentation. */
export const ARCH_DSP_CLOSURE_RULE_ID = 'ARCH-DSP-002';

const ANALYZER_NAME = 'architecture';

const MSG_MONOLITHIC_SWITCH_REFACTOR =
    'Refactor monolithic switch dispatcher to a table-driven lookup ' +
    '(Map/Dictionary) or Strategy pattern.';

const MSG_DISPATCHER_TABLE_REFACTOR =
    'Refactor closure-heavy dispatcher table into orthogonal grouped switch dispatchers ' +
    '(cyclomatic complexity <= 10) or top-level handlers to reduce closure fragmentation.';

/** Default branch threshold for monolithic dispatchers. */
const DEFAULT_MAX_DISPATCH_BRANCHES = 8;

/** Default closure threshold for fragmented dispatcher tables. */
const DEFAULT_MAX_DISPATCHER_CLOSURES = 15;

/**
 * Pattern matching object property entries that define inline closures.
 */
const CLOSURE_PROP_RE =
    /(?:['"][a-zA-Z0-9_$-]+['"]|[a-zA-Z0-9_$]+)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|(?:['"][a-zA-Z0-9_$-]+['"]|[a-zA-Z0-9_$]+)\s*:\s*(?:async\s*)?function\b|(?:['"][a-zA-Z0-9_$-]+['"]|[a-zA-Z0-9_$]+)\s*:\s*lambda\b/;

interface SwitchScanState {
    active: boolean;
    startLine: number;
    depth: number;
    branchCount: number;
    lines: string[];
}

interface ObjectScanState {
    active: boolean;
    startLine: number;
    depth: number;
    closureCount: number;
}

function isCommentLine(trimmed: string): boolean {
    return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*');
}

function stripStringLiterals(line: string): string {
    return line
        .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
        .replace(/"(?:\\[\s\S]|[^"\\])*"/g, '""')
        .replace(/'(?:\\[\s\S]|[^'\\])*'/g, "''");
}

function updateBraceDepth(line: string, currentDepth: number): number {
    const cleanLine = stripStringLiterals(line.split('//')[0]);
    let depth = currentDepth;
    for (const ch of cleanLine) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
    }
    return depth;
}

function isLikelyObjectStart(trimmed: string): boolean {
    if (
        /^(?:if|else|for|while|do|switch|try|catch|finally|function|class|interface|type|enum)\b/.test(
            trimmed,
        )
    ) {
        return false;
    }
    if (trimmed.includes('=>') && !trimmed.includes('= {') && !trimmed.includes('={')) {
        return false;
    }
    return (
        /(?:=|:|\breturn|\()\s*\{/.test(trimmed) ||
        trimmed.endsWith(' = {') ||
        trimmed.endsWith('={')
    );
}

function isTrivialConstantMapping(branchLines: readonly string[]): boolean {
    for (const line of branchLines) {
        const trimmed = line.trim();
        if (
            trimmed.includes('(') &&
            !trimmed.startsWith('return ') &&
            !trimmed.startsWith('case ')
        ) {
            return false;
        }
        if (trimmed.includes('for ') || trimmed.includes('while ') || trimmed.includes('if ')) {
            return false;
        }
    }
    return true;
}

function emitSwitchIssue(
    file: string,
    startLine: number,
    branchCount: number,
    threshold: number,
): Issue {
    return {
        id: `${ANALYZER_NAME}:${ARCH_DISP_RULE_ID}:${file}:${startLine}`,
        analyzer: ANALYZER_NAME,
        rule: ARCH_DISP_RULE_ID,
        severity: SEVERITY_WARNING,
        message:
            `Monolithic dispatcher with ${branchCount} branches detected ` +
            `(threshold: ${threshold}). Tightly coupled procedural branches ` +
            `impair modular extensibility.`,
        location: {
            file,
            start: { line: startLine, column: 1 },
            end: { line: startLine, column: 1 },
        },
        detail: { branchCount, threshold },
        suggestion: MSG_MONOLITHIC_SWITCH_REFACTOR,
    };
}

function emitClosureIssue(
    file: string,
    startLine: number,
    closureCount: number,
    threshold: number,
): Issue {
    return {
        id: `${ANALYZER_NAME}:${ARCH_DSP_CLOSURE_RULE_ID}:${file}:${startLine}`,
        analyzer: ANALYZER_NAME,
        rule: ARCH_DSP_CLOSURE_RULE_ID,
        severity: SEVERITY_WARNING,
        message:
            `Dispatcher closure fragmentation: Object literal defines ${closureCount} inline ` +
            `function closures (threshold: ${threshold}). Over-fragmentation of anonymous closures ` +
            `inflates function counts and impairs maintainability.`,
        location: {
            file,
            start: { line: startLine, column: 1 },
            end: { line: startLine, column: 1 },
        },
        detail: { closureCount, threshold },
        suggestion: MSG_DISPATCHER_TABLE_REFACTOR,
    };
}

function processSwitchLine(
    line: string,
    trimmed: string,
    lineIdx: number,
    state: SwitchScanState,
    threshold: number,
    file: string,
    issues: Issue[],
): void {
    if (!state.active && (trimmed.startsWith('switch ') || trimmed.startsWith('switch('))) {
        state.active = true;
        state.startLine = lineIdx + 1;
        state.depth = 0;
        state.branchCount = 0;
        state.lines = [];
    }
    if (!state.active) return;

    state.lines.push(line);
    state.depth = updateBraceDepth(line, state.depth);
    if (trimmed.startsWith('case ') || trimmed.startsWith('default:')) {
        state.branchCount++;
    }

    if (state.depth <= 0 && lineIdx > state.startLine - 1) {
        if (state.branchCount >= threshold && !isTrivialConstantMapping(state.lines)) {
            issues.push(emitSwitchIssue(file, state.startLine, state.branchCount, threshold));
        }
        state.active = false;
        state.lines = [];
    }
}

function processObjectLine(
    line: string,
    trimmed: string,
    lineIdx: number,
    state: ObjectScanState,
    threshold: number,
    file: string,
    issues: Issue[],
): void {
    if (!state.active && isLikelyObjectStart(trimmed)) {
        state.active = true;
        state.startLine = lineIdx + 1;
        state.depth = 0;
        state.closureCount = 0;
    }
    if (!state.active) return;

    if (CLOSURE_PROP_RE.test(trimmed)) {
        state.closureCount++;
    }
    state.depth = updateBraceDepth(line, state.depth);

    if (state.depth <= 0 && lineIdx >= state.startLine - 1) {
        if (state.closureCount >= threshold) {
            issues.push(emitClosureIssue(file, state.startLine, state.closureCount, threshold));
        }
        state.active = false;
        state.closureCount = 0;
    }
}

/**
 * Audits source text for monolithic dispatchers and closure fragmentation.
 *
 * @param content - Source file content.
 * @param file - Normalized file path.
 * @param ctx - Analyzer context.
 * @returns Array of emitted ARCH-DISP-001 and ARCH-DSP-002 issues.
 */
export function auditDispatchComplexity(
    content: string,
    file: string,
    ctx: AnalyzerContext,
): Issue[] {
    const issues: Issue[] = [];
    const maxBranches =
        (ctx.options?.maxDispatchBranches as number | undefined) ?? DEFAULT_MAX_DISPATCH_BRANCHES;
    const maxClosures =
        (ctx.options?.maxDispatcherClosures as number | undefined) ??
        DEFAULT_MAX_DISPATCHER_CLOSURES;

    const swState: SwitchScanState = {
        active: false,
        startLine: 0,
        depth: 0,
        branchCount: 0,
        lines: [],
    };
    const objState: ObjectScanState = { active: false, startLine: 0, depth: 0, closureCount: 0 };

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (isCommentLine(trimmed)) continue;

        processSwitchLine(line, trimmed, i, swState, maxBranches, file, issues);
        processObjectLine(line, trimmed, i, objState, maxClosures, file, issues);
    }

    return issues;
}
