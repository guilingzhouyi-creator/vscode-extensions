/**
 * Module: Static Analysis Engine — Rust Modernization Rules
 * File Path: src/analyzers/rust-modern.ts
 * Architecture Role: Rust-only style analyzer (a language pack bound to the language, never to a
 *     project) — the Rust counterpart of the Python/TypeScript modernization packs
 * Dependencies & Triggers: core types + the shared source masker; enabled when a config declares
 *     `analyzers.rust-modern`; specialized packs are default-off, so registering it cannot change
 *     an existing gate result
 * Responsibilities: Report eleven modernization findings on `.rs` files: RSM-CAST-001 (naked
 *     numeric `as` cast), RSM-CLONE-001 (needless `.clone()`), RSM-ELSE-001 (`if let` early exit
 *     simplifiable to `let-else`), RSM-EXTERN-001 (`extern crate`), RSM-FIND-001 (manual `for`
 *     search simplifiable to `.find()`), RSM-FORMAT-001 (positional `{}` capture), RSM-LOCK-001
 *     (sync lock held across `.await`), RSM-MACRO-001 (`#[macro_use]`), RSM-STR-001 (`&String`
 *     parameter), RSM-TRY-001 (`try!`), and RSM-UNWRAP-001 (`.unwrap()`)
 * Exit Semantics & Design Rationale: Pure multiline and line scanner over masked source with raw
 *     string blanking, never throws and returns [] for every other language. Rust's comment syntax
 *     matches the C family, so the mask only needs the slash and the C-style block delimiters;
 *     char literals and lifetimes are preserved while raw string bodies are zeroed to avoid false
 *     positives. Every rule stays keyword-anchored and adheres to canonical naming.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity, AgentActionType } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_RUST_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import { buildCanonicalIssue } from '../core/reporting/canonical-issue-builder';

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.rs';

/**
 * Masking syntax for Rust: slash comments plus double-quoted strings. Single quotes
 * are deliberately left alone so lifetimes survive, and raw strings are blanked downstream.
 */
const RUST_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '"',
};

/** `try!(expr)`, superseded by the `?` operator. */
const TRY_MACRO_RE = /\btry!\s*\(/;

/** `extern crate name;`, unnecessary from edition 2018 onwards. */
const EXTERN_CRATE_RE = /^\s*extern\s+crate\s+[A-Za-z_]\w*\s*;/;

/** `#[macro_use]`, replaced by naming the macros in the `use` path. */
const MACRO_USE_RE = /#\[\s*macro_use\s*\]/;

/** `&String` in a function signature parameter. */
const AMP_STRING_RE = /&\s*String\b/;

/** `.clone()` whose only consumer is a comparison or a length check, i.e. a needless allocation. */
const NEEDLESS_CLONE_RE = /\.clone\(\)\s*(?:==|!=|\.len\(\)|\.is_empty\(\))/;

/** `.unwrap()` on a fallible result, which panics instead of propagating. */
const UNWRAP_RE = /\.unwrap\(\)/;

/** Naked `as` numeric cast susceptible to silent truncation or wrapping. */
const NUMERIC_CAST_RE = /\bas\s+(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)\b/;

/** A formatting macro call, detected on the masked line (its format string is blanked). */
const FORMAT_CALL_RE = /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\(/;

/** Positional placeholder inside macro call on a single line. */
const POSITIONAL_PLACEHOLDER_RE = /!\s*\(\s*"[^"]*\{\}/;

/** Positional format call spanning multiple lines. */
const MULTILINE_FORMAT_RE =
    /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\([^;]*"[^"]*\{\}/;

/** Function declaration prefix. */
const FN_DECL_RE = /\bfn\s+[A-Za-z_]\w*/;

/** `if let` pattern matching declaration. */
const IF_LET_RE = /\bif\s+let\s+[^{]+=\s*/;

/** `for ... in` loop header. */
const FOR_IN_RE = /\bfor\s+(?:[A-Za-z_]\w*|\([A-Za-z0-9_,\s]+\))\s+in\b/;

/** `for ... in` loop immediately checking condition and returning. */
const FOR_FIND_RE = /\bfor\s+[^{]+\{\s*if\s+[^{]+\{\s*return\b/;

/** Async function declaration. */
const ASYNC_FN_RE = /\basync\s+(?:unsafe\s+)?(?:extern(?:\s+"[^"]+")?\s+)?fn\b/;

/** Synchronous standard library lock acquisition without `.await`. */
const STD_LOCK_RE = /(?:std::sync::(?:Mutex|RwLock)|\.(?:lock|read|write)\s*\(\s*\)(?!\s*\.await))/;

/** `.await` expression. */
const AWAIT_RE = /\.await\b/;

/** State for tracking function signature parameter lists across lines. */
interface FnSigState {
    inParams: boolean;
    inSig: boolean;
}

/** Canonical issue specification for reporting Rust modernization findings. */
interface RustIssueSpec {
    /** Canonical rule id (`RSM-TOPIC-NNN`). */
    readonly rule: string;
    /** Finding severity. */
    readonly severity: Severity;
    /** Why the modern form is preferable. */
    readonly message: string;
    /** One-line rewrite guidance. */
    readonly suggestion: string;
}

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule extends RustIssueSpec {
    /** Pattern run against the masked line. */
    readonly pattern: RegExp;
}

/** Keyword rules, all of which fit on one physical line. */
const LINE_RULES: readonly LineRule[] = [
    {
        rule: 'RSM-TRY-001',
        severity: SEVERITY_WARNING,
        pattern: TRY_MACRO_RE,
        message: '`try!` predates the `?` operator and obscures the error path.',
        suggestion: 'Replace `try!(expr)` with `expr?`, which composes inside larger expressions.',
    },
    {
        rule: 'RSM-EXTERN-001',
        severity: SEVERITY_WARNING,
        pattern: EXTERN_CRATE_RE,
        message: '`extern crate` is obsolete since edition 2018: dependencies resolve by path.',
        suggestion: 'Delete the declaration and `use` the crate path directly in each module.',
    },
    {
        rule: 'RSM-MACRO-001',
        severity: SEVERITY_WARNING,
        pattern: MACRO_USE_RE,
        message: '`#[macro_use]` imports macros textually, so their origin is invisible.',
        suggestion:
            'Import the macros explicitly (`use crate::m::{a, b};`) and drop the attribute.',
    },
    {
        rule: 'RSM-CLONE-001',
        severity: SEVERITY_INFO,
        pattern: NEEDLESS_CLONE_RE,
        message: '`.clone()` result is only compared or measured, so the copy is invisible work.',
        suggestion: 'Compare or measure the borrowed value instead, or use `==` on references.',
    },
    {
        rule: 'RSM-UNWRAP-001',
        severity: SEVERITY_INFO,
        pattern: UNWRAP_RE,
        message: '`.unwrap()` panics on `None`/`Err` and hides the failure from the caller.',
        suggestion:
            'Propagate with `?`, or state the invariant with `expect("why this cannot fail")`.',
    },
    {
        rule: 'RSM-CAST-001',
        severity: SEVERITY_INFO,
        pattern: NUMERIC_CAST_RE,
        message: 'Naked `as` numeric cast can silently truncate or wrap on overflow.',
        suggestion:
            'Use `TryFrom`/`try_into()` for fallible casts, or `From`/`from()` for lossless conversions.',
    },
];

const SPEC_STR_REF: RustIssueSpec = Object.freeze({
    rule: 'RSM-STR-001',
    severity: SEVERITY_WARNING,
    message: '`&String` forces every caller to own a String; `&str` borrows either form.',
    suggestion: 'Take `&str` (or `impl AsRef<str>`) and let callers pass `&my_string`.',
});

const SPEC_FORMAT_CAPTURE: RustIssueSpec = Object.freeze({
    rule: 'RSM-FORMAT-001',
    severity: SEVERITY_WARNING,
    message: 'Positional `{}` captures drift out of sync with the argument list.',
    suggestion: 'Inline the binding (`format!("{value}")`) so the compiler checks it.',
});

const SPEC_LET_ELSE: RustIssueSpec = Object.freeze({
    rule: 'RSM-ELSE-001',
    severity: SEVERITY_WARNING,
    message: '`if let ... else { return/break }` can be simplified with `let ... else` syntax.',
    suggestion: 'Rewrite as `let Pattern = expr else { return/break; };` to reduce nesting.',
});

const SPEC_FOR_FIND: RustIssueSpec = Object.freeze({
    rule: 'RSM-FIND-001',
    severity: SEVERITY_INFO,
    message: 'Manual `for ... in` loop searching with an immediate return can be simplified.',
    suggestion: 'Use iterator methods like `.find()`, `.any()`, or `.position()`.',
});

const SPEC_LOCK_AWAIT: RustIssueSpec = Object.freeze({
    rule: 'RSM-LOCK-001',
    severity: SEVERITY_WARNING,
    message:
        'Holding a synchronous `std::sync` lock guard across `.await` can cause deadlocks and violates `Send`.',
    suggestion:
        'Use `tokio::sync::Mutex` or drop the synchronous lock guard before invoking `.await`.',
});

const MAX_MULTILINE_FORMAT_SPAN_LINES = 10;
const MAX_LET_ELSE_SPAN_LINES = 25;
const MAX_FOR_FIND_SPAN_LINES = 6;

/**
 * Test whether a formatting macro call contains positional `{}` arguments,
 * supporting single-line and multi-line macro calls.
 *
 * @param raw - Full raw lines array.
 * @param startIndex - Line index where macro call begins.
 * @returns True if positional `{}` is present in format arguments.
 */
function isPositionalFormatCall(raw: string[], startIndex: number): boolean {
    if (POSITIONAL_PLACEHOLDER_RE.test(raw[startIndex])) {
        return true;
    }
    const maxLine = Math.min(startIndex + MAX_MULTILINE_FORMAT_SPAN_LINES, raw.length);
    const chunk = raw.slice(startIndex, maxLine).join('\n');
    return MULTILINE_FORMAT_RE.test(chunk);
}

/**
 * Inspect opened function signature paren line for `&String` parameter.
 *
 * @param code - Masked code line.
 * @param state - Function signature state tracker.
 * @returns True if `&String` is found inside the parameter list.
 */
function checkSigOpenParen(code: string, state: FnSigState): boolean {
    const openParen = code.indexOf('(');
    if (openParen !== -1) {
        state.inSig = false;
        const closeParen = code.indexOf(')', openParen);
        if (closeParen !== -1) {
            return AMP_STRING_RE.test(code.slice(openParen, closeParen));
        }
        state.inParams = true;
        return AMP_STRING_RE.test(code.slice(openParen));
    }
    if (code.includes('{') || code.includes(';')) {
        state.inSig = false;
    }
    return false;
}

/**
 * Inspect function declaration line for opening paren and parameters.
 *
 * @param code - Masked code line.
 * @param state - Function signature state tracker.
 * @returns True if `&String` is found inside parameter list on this line.
 */
function checkFnDeclLine(code: string, state: FnSigState): boolean {
    const fnIdx = code.search(FN_DECL_RE);
    const openParen = code.indexOf('(', fnIdx);
    if (openParen !== -1) {
        const closeParen = code.indexOf(')', openParen);
        if (closeParen !== -1) {
            return AMP_STRING_RE.test(code.slice(openParen, closeParen));
        }
        state.inParams = true;
        return AMP_STRING_RE.test(code.slice(openParen));
    }
    state.inSig = true;
    return false;
}

/**
 * Check if a code line contains `&String` within a function parameter list,
 * strictly defending against struct fields, local variables, and return types.
 *
 * @param code - Masked code line.
 * @param state - Function signature state tracker.
 * @returns True if line declares a function parameter with `&String`.
 */
function checkAmpStringInLine(code: string, state: FnSigState): boolean {
    if (state.inParams) {
        const closeParen = code.indexOf(')');
        const slice = closeParen !== -1 ? code.slice(0, closeParen) : code;
        const hit = AMP_STRING_RE.test(slice);
        if (closeParen !== -1 || code.includes('{') || code.includes(';')) {
            state.inParams = false;
        }
        return hit;
    }
    if (state.inSig) {
        return checkSigOpenParen(code, state);
    }
    return FN_DECL_RE.test(code) ? checkFnDeclLine(code, state) : false;
}

/**
 * Find index of matching closing brace for an open brace.
 *
 * @param text - Text containing braces.
 * @param startIndex - Index of opening `{`.
 * @returns Index of matching `}` or -1 if unbalanced.
 */
function findMatchingBrace(text: string, startIndex: number): number {
    let depth = 0;
    for (let i = startIndex; i < text.length; i += 1) {
        if (text[i] === '{') {
            depth += 1;
        } else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Detect `if let ... else { return/break; }` pattern eligible for `let-else`.
 *
 * @param lines - Masked source lines.
 * @param startIndex - Line index where `if let` starts.
 * @returns True if pattern should be migrated to `let ... else`.
 */
function isLetElseCandidate(lines: string[], startIndex: number): boolean {
    if (!IF_LET_RE.test(lines[startIndex])) {
        return false;
    }
    const maxLine = Math.min(startIndex + MAX_LET_ELSE_SPAN_LINES, lines.length);
    let chunk = '';
    for (let j = startIndex; j < maxLine; j += 1) {
        chunk += (j === startIndex ? '' : '\n') + lines[j];
    }
    const openBrace = chunk.indexOf('{');
    if (openBrace === -1) {
        return false;
    }
    const ifEnd = findMatchingBrace(chunk, openBrace);
    if (ifEnd === -1) {
        return false;
    }
    const afterIf = chunk.slice(ifEnd + 1);
    const elseMatch = /^\s*else\s*\{/.exec(afterIf);
    if (!elseMatch) {
        return false;
    }
    const elseStart = ifEnd + 1 + elseMatch[0].length - 1;
    const elseEnd = findMatchingBrace(chunk, elseStart);
    const elseBody =
        elseEnd !== -1 ? chunk.slice(elseStart + 1, elseEnd) : chunk.slice(elseStart + 1);
    return /\b(?:return|break)\b/.test(elseBody);
}

/**
 * Detect manual `for item in iter` loop searching followed immediately by return.
 *
 * @param lines - Masked source lines.
 * @param startIndex - Line index where `for` loop begins.
 * @returns True if loop should use `.find()`, `.any()`, or `.position()`.
 */
function isForFindCandidate(lines: string[], startIndex: number): boolean {
    if (!FOR_IN_RE.test(lines[startIndex])) {
        return false;
    }
    const maxLine = Math.min(startIndex + MAX_FOR_FIND_SPAN_LINES, lines.length);
    const chunk = lines.slice(startIndex, maxLine).join(' ');
    return FOR_FIND_RE.test(chunk);
}

/**
 * Determine body line range of an async function.
 *
 * @param lines - Masked lines.
 * @param startIndex - Line index of async fn declaration.
 * @returns Start and end line indices of function body, or null.
 */
function resolveAsyncFnScope(
    lines: string[],
    startIndex: number,
): { bodyStart: number; bodyEnd: number } | null {
    let bodyStart = -1;
    let depth = 0;
    for (let j = startIndex; j < lines.length; j += 1) {
        const line = lines[j];
        for (let c = 0; c < line.length; c += 1) {
            if (line[c] === '{') {
                if (bodyStart === -1) bodyStart = j;
                depth += 1;
            } else if (line[c] === '}') {
                depth -= 1;
                if (depth === 0 && bodyStart !== -1) {
                    return { bodyStart, bodyEnd: j };
                }
            }
        }
    }
    return bodyStart !== -1 ? { bodyStart, bodyEnd: lines.length - 1 } : null;
}

/** Scope context for detecting synchronous lock guards across await boundaries. */
interface AsyncLockScopeContext {
    readonly file: string;
    readonly raw: string[];
    readonly lines: string[];
    readonly scope: { bodyStart: number; bodyEnd: number };
}

/**
 * Inspect and record findings for standard library guard instances held across `.await` points.
 *
 * @param ctx - Scope context for async guard inspection.
 * @param out - Issue accumulator list.
 */
function collectLocksAcrossAwait(ctx: AsyncLockScopeContext, out: Issue[]): void {
    const lockLines: number[] = [];
    let maxAwaitLine = -1;
    for (let j = ctx.scope.bodyStart; j <= ctx.scope.bodyEnd; j += 1) {
        if (STD_LOCK_RE.test(ctx.lines[j])) lockLines.push(j);
        if (AWAIT_RE.test(ctx.lines[j])) maxAwaitLine = j;
    }
    for (const lk of lockLines) {
        if (maxAwaitLine > lk) {
            out.push(makeIssue(ctx.file, lk, SPEC_LOCK_AWAIT, { line: ctx.raw[lk].trim() }));
        }
    }
}

/**
 * Scan all async functions in file for std guard instances held across `.await`.
 *
 * @param file - Relative file path.
 * @param raw - Raw source lines.
 * @param masked - Masked source lines.
 * @param out - Issue accumulator list.
 */
function scanAsyncLockIssues(file: string, raw: string[], masked: string[], out: Issue[]): void {
    for (let i = 0; i < masked.length; i += 1) {
        if (!ASYNC_FN_RE.test(masked[i])) {
            continue;
        }
        const scope = resolveAsyncFnScope(masked, i);
        if (!scope) {
            continue;
        }
        collectLocksAcrossAwait({ file, raw, lines: masked, scope }, out);
    }
}

const ACT_REPLACE_TOKEN: AgentActionType = 'replace_token';
const ACT_APPLY_GUARD_CLAUSE: AgentActionType = 'apply_guard_clause';

const SNIPPET_QUESTION = '$1?';
const SNIPPET_USE_PATH = 'use $1::$2;';
const SNIPPET_USE_GROUP = 'use $1::{$2};';
const SNIPPET_STR_REF = '&str';
const SNIPPET_BORROW = '&$1';
const SNIPPET_CONTEXT_PROPAGATE = '$1.context("$2")?';
const SNIPPET_TRY_FROM = '$1::try_from($2)?';
const SNIPPET_INLINE_FORMAT = 'format!("{var}")';
const SNIPPET_LET_ELSE = 'let $1 = $2 else { return $3; };';
const SNIPPET_ITER_FIND = '$1.iter().find(|$2| $3)';
const SNIPPET_DROP_GUARD = 'drop($guard);';

interface ActionableEntry {
    readonly rule: string;
    readonly codeId: string;
    readonly snippet: string;
    readonly action?: AgentActionType;
    readonly autoSafe?: boolean;
}

const ACTIONABLE_ENTRIES: readonly ActionableEntry[] = [
    { rule: 'RSM-TRY-001', codeId: '001', snippet: SNIPPET_QUESTION, autoSafe: true },
    { rule: 'RSM-EXTERN-001', codeId: '002', snippet: SNIPPET_USE_PATH },
    { rule: 'RSM-MACRO-001', codeId: '003', snippet: SNIPPET_USE_GROUP },
    { rule: 'RSM-STR-001', codeId: '004', snippet: SNIPPET_STR_REF },
    { rule: 'RSM-CLONE-001', codeId: '005', snippet: SNIPPET_BORROW },
    {
        rule: 'RSM-UNWRAP-001',
        codeId: '006',
        snippet: SNIPPET_CONTEXT_PROPAGATE,
        action: ACT_APPLY_GUARD_CLAUSE,
    },
    { rule: 'RSM-CAST-001', codeId: '007', snippet: SNIPPET_TRY_FROM },
    { rule: 'RSM-FORMAT-001', codeId: '008', snippet: SNIPPET_INLINE_FORMAT },
    {
        rule: 'RSM-ELSE-001',
        codeId: '009',
        snippet: SNIPPET_LET_ELSE,
        action: ACT_APPLY_GUARD_CLAUSE,
    },
    { rule: 'RSM-FIND-001', codeId: '010', snippet: SNIPPET_ITER_FIND },
    {
        rule: 'RSM-LOCK-001',
        codeId: '011',
        snippet: SNIPPET_DROP_GUARD,
        action: ACT_APPLY_GUARD_CLAUSE,
    },
];

const RSM_ACTIONABLE_MAP: Readonly<
    Record<
        string,
        { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
    >
> = Object.freeze(
    ACTIONABLE_ENTRIES.reduce(
        (acc, entry) => {
            acc[entry.rule] = {
                action: entry.action ?? ACT_REPLACE_TOKEN,
                code: `AR:RSM:${entry.codeId}`,
                safeToAutomate: entry.autoSafe ?? false,
                templateSnippet: entry.snippet,
            };
            return acc;
        },
        {} as Record<
            string,
            {
                action: AgentActionType;
                code: string;
                safeToAutomate: boolean;
                templateSnippet: string;
            }
        >,
    ),
);

/**
 * Build one finding anchored to a source line.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based line index.
 * @param spec - Canonical issue metadata specification.
 * @param detail - Structured evidence for machines.
 * @returns The finding, ready to be pushed onto the result list.
 */
function makeIssue(
    file: string,
    lineIndex: number,
    spec: RustIssueSpec,
    detail: Record<string, unknown>,
): Issue {
    const line = lineIndex + 1;
    const mapped = RSM_ACTIONABLE_MAP[spec.rule];
    const actionable = mapped
        ? {
              action: mapped.action,
              code: mapped.code,
              safeToAutomate: mapped.safeToAutomate,
              templateSnippet: mapped.templateSnippet,
          }
        : undefined;

    return buildCanonicalIssue({
        analyzer: ANALYZER_RUST_MODERN,
        rule: spec.rule,
        file,
        line,
        severity: spec.severity,
        message: spec.message,
        suggestion: spec.suggestion,
        detail,
        actionable,
    });
}

/** Context object for line-level scan procedures. */
interface LineScanContext {
    readonly file: string;
    readonly raw: string[];
    readonly masked: string[];
    readonly fnSigState: FnSigState;
    readonly out: Issue[];
}

/** Scan keyword regex patterns on the line. */
function scanPatternRules(ctx: LineScanContext, index: number, code: string): void {
    for (const rule of LINE_RULES) {
        if (!rule.pattern.test(code)) continue;
        ctx.out.push(
            makeIssue(ctx.file, index, rule, {
                line: ctx.raw[index].trim(),
            }),
        );
    }
}

/** Scan contextual and multiline syntactic rules on the line. */
function scanContextualRules(ctx: LineScanContext, index: number, code: string): void {
    if (checkAmpStringInLine(code, ctx.fnSigState)) {
        ctx.out.push(makeIssue(ctx.file, index, SPEC_STR_REF, { line: ctx.raw[index].trim() }));
    }
    if (FORMAT_CALL_RE.test(code) && isPositionalFormatCall(ctx.raw, index)) {
        ctx.out.push(
            makeIssue(ctx.file, index, SPEC_FORMAT_CAPTURE, { line: ctx.raw[index].trim() }),
        );
    }
    if (isLetElseCandidate(ctx.masked, index)) {
        ctx.out.push(makeIssue(ctx.file, index, SPEC_LET_ELSE, { line: ctx.raw[index].trim() }));
    }
    if (isForFindCandidate(ctx.masked, index)) {
        ctx.out.push(makeIssue(ctx.file, index, SPEC_FOR_FIND, { line: ctx.raw[index].trim() }));
    }
}

/**
 * Scan a single masked source line for modernization issues.
 *
 * @param ctx - Context carrying source arrays, state, and output accumulator.
 * @param index - Current line index.
 */
function scanLineRules(ctx: LineScanContext, index: number): void {
    const code = ctx.masked[index];
    if (code.trim().length === 0) return;
    scanPatternRules(ctx, index, code);
    scanContextualRules(ctx, index, code);
}

/** Rust modernization pack: eleven rules over a masked view of the file. */
export class RustModernAnalyzer implements Analyzer {
    name = ANALYZER_RUST_MODERN;

    /**
     * Streaming-path entry point: the engine invokes this once per file. Content-only analyzers
     * must expose it, because the legacy `analyze` path covers the TS-family adapters only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one Rust file for modernization findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!file.endsWith(SOURCE_EXTENSION)) return [];
        const content = ctx.content || '';
        if (content.length === 0) return [];
        const { raw, masked } = maskSourceText(content, RUST_MASK);
        const out: Issue[] = [];
        const fnSigState: FnSigState = { inParams: false, inSig: false };
        const scanCtx: LineScanContext = {
            file,
            raw,
            masked,
            fnSigState,
            out,
        };

        for (let index = 0; index < masked.length; index += 1) {
            scanLineRules(scanCtx, index);
        }

        scanAsyncLockIssues(file, raw, masked, out);
        return out;
    }
}
