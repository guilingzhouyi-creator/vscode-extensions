/**
 * Module: Static Analysis — Polyglot Naming Source Auditor
 * File Path: src/analyzers/naming-polyglot-helper.ts
 * Architecture Role: Modular line scanner auditing function naming, verb-noun contract,
 *   length boundaries, and morpheme phonetic constraints across Go, Rust, and GDScript.
 * Dependencies & Triggers: Consumed by NamingAnalyzer when processing .go, .rs, or .gd files.
 * Responsibilities:
 *   1. Extract function declarations from Go, Rust, and GDScript files;
 *   2. Tokenize function names and evaluate verb-noun contract and word segment envelopes;
 *   3. Enforce length constraints, phonetic morpheme rules, and anti-jargon discipline;
 *   4. Honor domain-specific conventions (e.g. Go exported methods, Rust traits, Godot hooks).
 * Exit Semantics & Design Rationale: Pure functional helper returning Issue[]; zero side effects.
 */

import type { AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING } from '../core/types';
import { validateFunctionTokensAndSemantics, hasTransientJargon } from './naming-path-helper';
import type { NamingOptions } from './naming';

type IssueFactory = (
    ctx: AnalyzerContext,
    line: number,
    column: number,
    rule: string,
    message: string,
    severity: Severity,
    detail: Record<string, unknown>,
    suggestion?: string,
) => Issue;

const GO_FUNC_RE = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*\(/;
const RUST_FN_RE =
    /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern(?:\s*"[^"]*")?\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
const GDSCRIPT_FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

const GO_EXEMPT_NAMES = new Set([
    'init',
    'main',
    'String',
    'Error',
    'Read',
    'Write',
    'Close',
    'ServeHTTP',
    'MarshalJSON',
    'UnmarshalJSON',
]);

const RUST_EXEMPT_NAMES = new Set([
    'main',
    'new',
    'default',
    'from',
    'into',
    'fmt',
    'drop',
    'clone',
    'eq',
    'cmp',
    'hash',
]);

const GDSCRIPT_LIFECYCLE_NAMES = new Set([
    '_ready',
    '_process',
    '_physics_process',
    '_input',
    '_unhandled_input',
    '_draw',
    '_enter_tree',
    '_exit_tree',
    '_init',
    '_gui_input',
]);

function isGoFunctionExempt(name: string): boolean {
    if (GO_EXEMPT_NAMES.has(name)) return true;
    return (
        name.startsWith('Test') ||
        name.startsWith('Benchmark') ||
        name.startsWith('Fuzz') ||
        name.startsWith('Example')
    );
}

function isRustFunctionExempt(name: string): boolean {
    if (RUST_EXEMPT_NAMES.has(name)) return true;
    return name.startsWith('test_');
}

function isGDScriptFunctionExempt(name: string): boolean {
    if (GDSCRIPT_LIFECYCLE_NAMES.has(name)) return true;
    return name.startsWith('test_');
}

function tokenizePolyglotName(name: string, isSnake: boolean): string[] {
    if (isSnake) {
        return name.split('_').filter(Boolean);
    }
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .split('_')
        .filter(Boolean);
}

function auditExtractedFunction(
    fnName: string,
    lineIdx: number,
    isSnake: boolean,
    opts: NamingOptions,
    ctx: AnalyzerContext,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (opts.checkJargon !== false && hasTransientJargon(fnName)) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx + 1,
                1,
                'NAM-JRG-002',
                `Function name '${fnName}' contains transient construction jargon.`,
                SEVERITY_WARNING,
                { name: fnName },
                'Replace transient process markers with semantic domain naming.',
            ),
        );
    }

    if (opts.checkLengths === false) return;

    const minLen = opts.minFunctionLength ?? 3;
    const maxLen = opts.maxFunctionLength ?? 50;

    if (fnName.length < minLen) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx + 1,
                1,
                'NAM-LEN-002',
                `Function name '${fnName}' is too short (< ${minLen} characters); lacks description.`,
                SEVERITY_WARNING,
                { name: fnName, length: fnName.length, minLen },
                `Rename '${fnName}' to a descriptive phrase with >= ${minLen} characters.`,
            ),
        );
        return;
    }

    if (fnName.length > maxLen) {
        issues.push(
            mkIssue(
                ctx,
                lineIdx + 1,
                1,
                'NAM-LEN-002',
                `Function name '${fnName}' is too long (> ${maxLen} characters); decompose responsibilities.`,
                SEVERITY_WARNING,
                { name: fnName, length: fnName.length, maxLen },
                `Refactor '${fnName}' into a concise identifier with <= ${maxLen} characters.`,
            ),
        );
        return;
    }

    const tokens = tokenizePolyglotName(fnName, isSnake);
    const finding = validateFunctionTokensAndSemantics(fnName, tokens, opts);
    if (!finding) return;

    issues.push(
        mkIssue(
            ctx,
            lineIdx + 1,
            1,
            'NAM-LEN-002',
            finding.message,
            SEVERITY_WARNING,
            { name: fnName, findingType: finding.type },
            `Align function name '${fnName}' with semantic word and morpheme conventions.`,
        ),
    );
}

/**
 * Audit Go, Rust, or GDScript source lines for naming conventions and semantic contracts.
 *
 * @param content - Raw source file content.
 * @param ext - Normalized file extension (.go, .rs, .gd).
 * @param opts - Naming options configured for the scan.
 * @param ctx - Active analyzer context.
 * @param mkIssue - Issue factory callback.
 * @param issues - Output accumulator array.
 */
export function auditPolyglotSource(
    content: string,
    ext: string,
    opts: NamingOptions,
    ctx: AnalyzerContext,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    const lines = content.split(/\r?\n/);
    const isGo = ext === '.go';
    const isRust = ext === '.rs';
    const isGD = ext === '.gd';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        if (isGo) {
            const match = GO_FUNC_RE.exec(line);
            if (match && !isGoFunctionExempt(match[1])) {
                auditExtractedFunction(match[1], i, false, opts, ctx, mkIssue, issues);
            }
        } else if (isRust) {
            const match = RUST_FN_RE.exec(line);
            if (match && !isRustFunctionExempt(match[1])) {
                auditExtractedFunction(match[1], i, true, opts, ctx, mkIssue, issues);
            }
        } else if (isGD) {
            const match = GDSCRIPT_FUNC_RE.exec(line);
            if (match && !isGDScriptFunctionExempt(match[1])) {
                auditExtractedFunction(match[1], i, true, opts, ctx, mkIssue, issues);
            }
        }
    }
}
