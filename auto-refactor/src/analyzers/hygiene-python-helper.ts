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

import type { AnalyzerContext, Issue, Severity } from '../core/types';

/** Callback factory for instantiating canonical Issue records. */
export type HygieneIssueFactory = (params: {
    ctx: AnalyzerContext;
    lineIdx: number;
    rule: string;
    message: string;
    severity: Severity;
    detail: Record<string, unknown>;
    suggestion?: string;
}) => Issue;

const PY_BUILTIN_NAMES = new Set([
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

const PY_PROTOCOL_FIELDS = new Set(['id', 'type', 'help', 'format', 'input', 'next']);
const PY_SHORT_ALLOWED = new Set(['i', 'j', 'k', '_']);
const PY_EXCEPT_NAME = 'exc';
const PY_SELF_NAME = 'self';
const PY_CLS_NAME = 'cls';
const PY_KIND_CLASS = 'class';
const PY_KIND_DEF = 'def';
const PY_KIND_PARAMETER = 'parameter';
const PY_BINDING_ASSIGNMENT = 'assignment';
const SEVERITY_WARNING: Severity = 'warning';
const PY_ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;
const PY_FOR_RE = /^for\s+([A-Za-z_]\w*)\s+in\b/;
const PY_EXCEPT_AS_RE = /^except\b[^:]*\bas\s+([A-Za-z_]\w*)\s*:/;
const PY_CLASS_RE = /^class\s+[A-Za-z_]\w*/;
const PY_DEF_LINE_RE = /^(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/;
const PY_WITH_AS_RE = /\bas\s+([A-Za-z_]\w*)\s*(?:,|:)/g;

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
    while (blocks.length > 0 && indent <= (blocks[blocks.length - 1]?.indent ?? -1)) {
        blocks.pop();
    }
    const current = blocks[blocks.length - 1];
    return Boolean(current && current.kind === PY_KIND_CLASS);
}

function computeBracketDelta(code: string): number {
    let depth = 0;
    for (const ch of code) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
    }
    return depth;
}

interface PythonNameContext {
    readonly lineIdx: number;
    readonly name: string;
    readonly kind: typeof PY_BINDING_ASSIGNMENT | typeof PY_KIND_PARAMETER;
    readonly inClassBody: boolean;
    readonly file: string;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: HygieneIssueFactory;
    readonly issues: Issue[];
}

function checkPythonName(params: PythonNameContext): void {
    if (params.name === PY_SELF_NAME || params.name === PY_CLS_NAME) return;
    const builtinExempt = params.inClassBody || (params.kind === PY_KIND_PARAMETER && PY_PROTOCOL_FIELDS.has(params.name));
    if (!builtinExempt && PY_BUILTIN_NAMES.has(params.name)) {
        params.issues.push(
            params.mkIssue({
                ctx: params.ctx,
                lineIdx: params.lineIdx,
                rule: 'HYG-BLT-001',
                message: `Name '${params.name}' shadows a Python builtin`,
                severity: SEVERITY_WARNING,
                detail: { file: params.file, name: params.name, kind: params.kind },
                suggestion: 'Rename the binding (e.g. add a domain qualifier); shadowing builtins hides the standard meaning.',
            }),
        );
    }
    if (params.name.length === 1 && !PY_SHORT_ALLOWED.has(params.name)) {
        params.issues.push(
            params.mkIssue({
                ctx: params.ctx,
                lineIdx: params.lineIdx,
                rule: 'HYG-SGL-001',
                message: `Single-letter name '${params.name}' hurts readability`,
                severity: SEVERITY_WARNING,
                detail: { file: params.file, name: params.name, kind: params.kind },
                suggestion: "Use a descriptive name; only 'i'/'j'/'k' and '_' are tolerated as throwaways.",
            }),
        );
    }
}

interface PythonDefContext {
    readonly rawArgsList: string;
    readonly lineIdx: number;
    readonly file: string;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: HygieneIssueFactory;
    readonly issues: Issue[];
}

function auditPythonDefParameters(params: PythonDefContext): void {
    for (const rawArg of params.rawArgsList.split(',')) {
        const cleaned = rawArg.trim().replace(/^\*{0,2}/, '');
        const name = cleaned.split(/[:=]/)[0].trim();
        if (!name || name === '/') continue;
        checkPythonName({
            lineIdx: params.lineIdx,
            name,
            kind: PY_KIND_PARAMETER,
            inClassBody: false,
            file: params.file,
            ctx: params.ctx,
            mkIssue: params.mkIssue,
            issues: params.issues,
        });
    }
}

interface PythonLineContext {
    readonly trimmed: string;
    readonly lineIdx: number;
    readonly inClassBody: boolean;
    readonly file: string;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: HygieneIssueFactory;
    readonly issues: Issue[];
}

function dispatchNameCheck(
    lineCtx: PythonLineContext,
    targetName: string,
    bindingKind: typeof PY_BINDING_ASSIGNMENT | typeof PY_KIND_PARAMETER = PY_BINDING_ASSIGNMENT,
): void {
    checkPythonName({
        lineIdx: lineCtx.lineIdx,
        name: targetName,
        kind: bindingKind,
        inClassBody: lineCtx.inClassBody,
        file: lineCtx.file,
        ctx: lineCtx.ctx,
        mkIssue: lineCtx.mkIssue,
        issues: lineCtx.issues,
    });
}

function auditPythonWithBindings(params: PythonLineContext): void {
    PY_WITH_AS_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_WITH_AS_RE.exec(params.trimmed)) !== null) {
        dispatchNameCheck(params, match[1]);
    }
}

function auditPythonLineBindings(params: PythonLineContext): void {
    const exceptMatch = PY_EXCEPT_AS_RE.exec(params.trimmed);
    if (exceptMatch && exceptMatch[1] !== PY_EXCEPT_NAME) {
        params.issues.push(
            params.mkIssue({
                ctx: params.ctx,
                lineIdx: params.lineIdx,
                rule: 'HYG-EXC-001',
                message: `Exception variable '${exceptMatch[1]}' should be named '${PY_EXCEPT_NAME}'`,
                severity: SEVERITY_WARNING,
                detail: { file: params.file, name: exceptMatch[1] },
                suggestion: `Rename the handler binding to '${PY_EXCEPT_NAME}' so error-handling code reads uniformly.`,
            }),
        );
    }

    const defMatch = PY_DEF_LINE_RE.exec(params.trimmed);
    if (defMatch) {
        auditPythonDefParameters({
            rawArgsList: defMatch[1],
            lineIdx: params.lineIdx,
            file: params.file,
            ctx: params.ctx,
            mkIssue: params.mkIssue,
            issues: params.issues,
        });
    }

    const assignMatch = PY_ASSIGN_RE.exec(params.trimmed);
    if (assignMatch) {
        dispatchNameCheck(params, assignMatch[1]);
    }

    const forMatch = PY_FOR_RE.exec(params.trimmed);
    if (forMatch) {
        dispatchNameCheck(params, forMatch[1]);
    }

    if (/^(?:async\s+)?with\b/.test(params.trimmed)) {
        auditPythonWithBindings(params);
    }
}

/**
 * Context object for executing Python naming hygiene analysis.
 */
export interface PythonHygieneContext {
    readonly content: string;
    readonly file: string;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: HygieneIssueFactory;
    readonly issues: Issue[];
}

/**
 * Audit Python naming hygiene: builtin shadowing (HYG-BLT-001), single-letter names
 * (HYG-SGL-001) and exception-variable naming (HYG-EXC-001).
 *
 * @param params - Execution context containing source content, file path, and callbacks.
 */
export function auditPythonHygiene(params: PythonHygieneContext): void {
    const lines = params.content.split('\n');
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
        bracketDepth += computeBracketDelta(codeOnly);

        const indent = line.length - line.trimStart().length;
        const inClassBody = updateBlockNesting(indent, blocks);

        // Inside an open call/collection every `name=` is a keyword argument, not a binding.
        if (depthAtStart > 0) continue;

        auditPythonLineBindings({
            trimmed,
            lineIdx: i,
            inClassBody,
            file: params.file,
            ctx: params.ctx,
            mkIssue: params.mkIssue,
            issues: params.issues,
        });

        if (PY_CLASS_RE.test(trimmed)) blocks.push({ indent, kind: PY_KIND_CLASS });
        else if (PY_DEF_LINE_RE.test(trimmed)) blocks.push({ indent, kind: PY_KIND_DEF });
    }
}
