/**
 * Module: Static Analysis — Hygiene Python Source Auditor
 * File Path: src/analyzers/hygiene-python-helper.ts
 * Architecture Role: Modular helper auditing Python source code for naming hygiene,
 *   builtin shadowing (HYG-BLT-001), single-letter bindings (HYG-SGL-001),
 *   and exception variable naming (HYG-EXC-001).
 * Dependencies & Triggers: Consumed by HygieneAnalyzer to keep file size within budget (< 900 LOC).
 * Responsibilities:
 *   1. Track Python class/def block nesting and multi-line bracket depth.
 *   2. Identify shadowed builtins while respecting class-body protocol fields.
 *   3. Enforce single-letter binding discipline and exception variable naming ('exc').
 * Exit Semantics & Design Rationale: Pure functional helper populating Issue[] with zero I/O.
 */

import type { AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING } from '../core/types';

/** Callback factory for instantiating canonical Issue records. */
export type HygieneIssueFactory = (
    ctx: AnalyzerContext,
    lineIdx: number,
    rule: string,
    message: string,
    severity: 'info' | typeof SEVERITY_WARNING | 'error',
    detail: Record<string, unknown>,
    suggestion?: string,
) => Issue;

export const PY_BUILTIN_NAMES = new Set([
    'abs',
    'aiter',
    'all',
    'anext',
    'any',
    'ascii',
    'bin',
    'bool',
    'breakpoint',
    'bytearray',
    'bytes',
    'callable',
    'chr',
    'classmethod',
    'compile',
    'complex',
    'delattr',
    'dict',
    'dir',
    'divmod',
    'enumerate',
    'eval',
    'exec',
    'filter',
    'float',
    'format',
    'frozenset',
    'getattr',
    'globals',
    'hasattr',
    'hash',
    'help',
    'hex',
    'id',
    'input',
    'int',
    'isinstance',
    'issubclass',
    'iter',
    'len',
    'list',
    'locals',
    'map',
    'max',
    'memoryview',
    'min',
    'next',
    'object',
    'oct',
    'open',
    'ord',
    'pow',
    'print',
    'property',
    'range',
    'repr',
    'reversed',
    'round',
    'set',
    'setattr',
    'slice',
    'sorted',
    'staticmethod',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'vars',
    'zip',
]);

export const PY_PROTOCOL_FIELDS = new Set(['id', 'type', 'help', 'format', 'input', 'next']);
export const PY_SHORT_ALLOWED = new Set(['i', 'j', 'k', '_']);
export const PY_EXCEPT_NAME = 'exc';
export const PY_ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;
export const PY_FOR_RE = /^for\s+([A-Za-z_]\w*)\s+in\b/;
export const PY_EXCEPT_AS_RE = /^except\b[^:]*\bas\s+([A-Za-z_]\w*)\s*:/;
export const PY_CLASS_RE = /^class\s+[A-Za-z_]\w*/;
export const PY_DEF_LINE_RE = /^(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/;
export const PY_WITH_AS_RE = /\bas\s+([A-Za-z_]\w*)\s*(?:,|:)/g;
export const PY_BINDING_ASSIGNMENT = 'assignment';

function updateDocstringState(
    line: string,
    trimmed: string,
    inTriple: '"' | "'" | null,
): { inTriple: '"' | "'" | null; skip: boolean } {
    if (inTriple) {
        const closers =
            inTriple === '"' ? line.split('"""').length - 1 : line.split("'''").length - 1;
        return { inTriple: closers > 0 ? null : inTriple, skip: true };
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        const marker = trimmed.startsWith('"""') ? '"""' : "'''";
        const nextTriple =
            trimmed.split(marker).length - 1 < 2 ? (marker === '"""' ? '"' : "'") : null;
        return { inTriple: nextTriple, skip: true };
    }
    return { inTriple: null, skip: false };
}

function updateBlockNesting(
    indent: number,
    blocks: Array<{ indent: number; kind: 'class' | 'def' }>,
): boolean {
    while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop();
    return blocks.length > 0 && blocks[blocks.length - 1].kind === 'class';
}

function bracketDelta(code: string): number {
    let depth = 0;
    for (const ch of code) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }
    return depth;
}

function checkPythonName(
    lineIdx: number,
    name: string,
    kind: typeof PY_BINDING_ASSIGNMENT | 'parameter',
    inClassBody: boolean,
    file: string,
    ctx: AnalyzerContext,
    mkIssue: HygieneIssueFactory,
    issues: Issue[],
): void {
    if (name === 'self' || name === 'cls') return;
    const builtinExempt = inClassBody || (kind === 'parameter' && PY_PROTOCOL_FIELDS.has(name));
    if (!builtinExempt && PY_BUILTIN_NAMES.has(name)) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx,
                'HYG-BLT-001',
                `Name '${name}' shadows a Python builtin`,
                SEVERITY_WARNING,
                { file, name, kind },
                'Rename the binding (e.g. add a domain qualifier); shadowing builtins hides the standard meaning.',
            ),
        );
    }
    if (name.length === 1 && !PY_SHORT_ALLOWED.has(name)) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx,
                'HYG-SGL-001',
                `Single-letter name '${name}' hurts readability`,
                SEVERITY_WARNING,
                { file, name, kind },
                "Use a descriptive name; only 'i'/'j'/'k' and '_' are tolerated as throwaways.",
            ),
        );
    }
}

function auditPythonDefParameters(
    rawArgsList: string,
    lineIdx: number,
    file: string,
    ctx: AnalyzerContext,
    mkIssue: HygieneIssueFactory,
    issues: Issue[],
): void {
    for (const rawArg of rawArgsList.split(',')) {
        const cleaned = rawArg.trim().replace(/^\*{0,2}/, '');
        const name = cleaned.split(/[:=]/)[0].trim();
        if (!name || name === '/') continue;
        checkPythonName(lineIdx, name, 'parameter', false, file, ctx, mkIssue, issues);
    }
}

function auditPythonWithBindings(
    trimmed: string,
    lineIdx: number,
    inClassBody: boolean,
    file: string,
    ctx: AnalyzerContext,
    mkIssue: HygieneIssueFactory,
    issues: Issue[],
): void {
    PY_WITH_AS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_WITH_AS_RE.exec(trimmed)) !== null) {
        checkPythonName(
            lineIdx,
            match[1],
            PY_BINDING_ASSIGNMENT,
            inClassBody,
            file,
            ctx,
            mkIssue,
            issues,
        );
    }
}

function auditPythonLineBindings(
    trimmed: string,
    lineIdx: number,
    inClassBody: boolean,
    file: string,
    ctx: AnalyzerContext,
    mkIssue: HygieneIssueFactory,
    issues: Issue[],
): void {
    const exceptMatch = PY_EXCEPT_AS_RE.exec(trimmed);
    if (exceptMatch && exceptMatch[1] !== PY_EXCEPT_NAME) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx,
                'HYG-EXC-001',
                `Exception variable '${exceptMatch[1]}' should be named '${PY_EXCEPT_NAME}'`,
                SEVERITY_WARNING,
                { file, name: exceptMatch[1] },
                `Rename the handler binding to '${PY_EXCEPT_NAME}' so error-handling code reads uniformly.`,
            ),
        );
    }

    const defMatch = PY_DEF_LINE_RE.exec(trimmed);
    if (defMatch) {
        auditPythonDefParameters(defMatch[1], lineIdx, file, ctx, mkIssue, issues);
    }

    const assignMatch = PY_ASSIGN_RE.exec(trimmed);
    if (assignMatch) {
        checkPythonName(
            lineIdx,
            assignMatch[1],
            PY_BINDING_ASSIGNMENT,
            inClassBody,
            file,
            ctx,
            mkIssue,
            issues,
        );
    }

    const forMatch = PY_FOR_RE.exec(trimmed);
    if (forMatch) {
        checkPythonName(
            lineIdx,
            forMatch[1],
            PY_BINDING_ASSIGNMENT,
            inClassBody,
            file,
            ctx,
            mkIssue,
            issues,
        );
    }

    if (/^(?:async\s+)?with\b/.test(trimmed)) {
        auditPythonWithBindings(trimmed, lineIdx, inClassBody, file, ctx, mkIssue, issues);
    }
}

/**
 * Audit Python naming hygiene: builtin shadowing (HYG-BLT-001), single-letter names
 * (HYG-SGL-001) and exception-variable naming (HYG-EXC-001).
 *
 * @param content - Raw Python source text.
 * @param file - Normalized file path.
 * @param ctx - Analyzer context.
 * @param mkIssue - Issue factory callback.
 * @param issues - Accumulator for emitted issues.
 */
export function auditPythonHygiene(
    content: string,
    file: string,
    ctx: AnalyzerContext,
    mkIssue: HygieneIssueFactory,
    issues: Issue[],
): void {
    const lines = content.split('\n');
    const blocks: Array<{ indent: number; kind: 'class' | 'def' }> = [];
    let inTriple: '"' | "'" | null = null;
    let bracketDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const trimmed = line.trim();

        const docResult = updateDocstringState(line, trimmed, inTriple);
        inTriple = docResult.inTriple;
        if (docResult.skip || trimmed === '' || trimmed.startsWith('#')) continue;

        const depthAtStart = bracketDepth;
        const codeOnly = trimmed.split('#')[0];
        bracketDepth += bracketDelta(codeOnly);

        const indent = line.length - line.trimStart().length;
        const inClassBody = updateBlockNesting(indent, blocks);

        // Inside an open call/collection every `name=` is a keyword argument, not a binding.
        if (depthAtStart > 0) continue;

        auditPythonLineBindings(trimmed, i, inClassBody, file, ctx, mkIssue, issues);

        if (PY_CLASS_RE.test(trimmed)) blocks.push({ indent, kind: 'class' });
        else if (PY_DEF_LINE_RE.test(trimmed)) blocks.push({ indent, kind: 'def' });
    }
}
