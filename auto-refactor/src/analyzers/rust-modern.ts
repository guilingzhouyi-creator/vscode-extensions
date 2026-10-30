/**
 * Module: Static Analysis Engine — Rust Modernization Rules
 * File Path: src/analyzers/rust-modern.ts
 * Architecture Role: Rust-only style analyzer (a language pack bound to the language, never to a
 *     project) — the Rust counterpart of the Python/TypeScript modernization packs.
 * Dependencies & Triggers: core types + declarative modern metapack; enabled when a config declares
 *     `analyzers.rust-modern`; specialized packs are default-off, so registering it cannot change
 *     an existing gate result.
 * Responsibilities: Report fourteen modernization findings on `.rs` files: RSM-CAST-001 (naked
 *     numeric `as` cast), RSM-CLONE-001 (needless `.clone()`), RSM-ELSE-001 (`if let` early exit
 *     simplifiable to `let-else`), RSM-EXP-001 (naked `.expect()`), RSM-EXTERN-001
 *     (`extern crate`), RSM-FIND-001 (manual `for` search simplifiable to `.find()`),
 *     RSM-FORMAT-001 (positional `{}` capture),
 *     RSM-LOCK-001 (sync lock held across `.await`), RSM-MACRO-001 (`#[macro_use]`), RSM-PNC-001
 *     (production crash macro), RSM-SAF-001 (undocumented `unsafe`), RSM-STR-001 (`&String`
 *     parameter), RSM-TRY-001 (`try!`), and RSM-UNWRAP-001 (`.unwrap()`).
 * Exit Semantics & Design Rationale: Built on DeclarativeModernAnalyzer over masked source with raw
 *     string blanking, never throws and returns [] for every other language. Rust's comment syntax
 *     matches the C family, so the mask only needs the slash and the C-style block delimiters;
 *     char literals and lifetimes are preserved while raw string bodies are zeroed to avoid false
 *     positives. Every rule stays keyword-anchored and adheres to canonical naming.
 */

import type { Analyzer, AnalyzerContext, Issue, AgentActionType } from '../core/types';

import { SEVERITY_WARNING, SEVERITY_INFO, SEVERITY_ERROR } from '../core/types';
import { ANALYZER_RUST_MODERN } from '../core/scoring/dimensionLiterals';
import { REGEX } from '../core/constants';
import { findMatchingBraceInText } from '../core/ast/block-scope-utils';
import type { SourceMaskConfig } from '../core/policy/source-mask';
import {
    DeclarativeModernAnalyzer,
    type DeclarativeLineRule,
    type LineScanContext,
} from './declarative-modern-pack';

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

// --- Keyword regular expressions ---

/** `unsafe` block or function signature. */
const UNSAFE_KEYWORD_RE = REGEX.RUST.UNSAFE_KEYWORD;

/** `// SAFETY:` invariant proof comment. */
const SAFETY_PROOF_COMMENT_RE = REGEX.RUST.SAFETY_PROOF_COMMENT;

const MAX_MULTILINE_FORMAT_SPAN_LINES = 10;
const MAX_LET_ELSE_SPAN_LINES = 25;
const MAX_FOR_FIND_SPAN_LINES = 6;

// --- Actionable snippet templates ---

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
const SNIPPET_CRASH_REPLACE = 'return Err(FractalError::...);';
const SNIPPET_MAP_ERR = '$1.map_err(...)?';
const SNIPPET_SAFETY_PROOF = '// SAFETY: $1';

/** State for tracking function signature parameter lists across lines. */
interface FnSigState {
    inParams: boolean;
    inSig: boolean;
}

/**
 * Test whether a formatting macro call contains positional `{}` arguments.
 */
function isPositionalFormatCall(raw: readonly string[], startIndex: number): boolean {
    if (REGEX.SYNTAX.RUST_POSITIONAL_PLACEHOLDER.test(raw[startIndex])) {
        return true;
    }
    const maxLine = Math.min(startIndex + MAX_MULTILINE_FORMAT_SPAN_LINES, raw.length);
    const chunk = raw.slice(startIndex, maxLine).join('\n');
    return REGEX.SYNTAX.RUST_MULTILINE_FORMAT.test(chunk);
}

/**
 * Inspect opened function signature paren line for `&String` parameter.
 */
function checkSigOpenParen(code: string, state: FnSigState): boolean {
    const openParen = code.indexOf('(');
    if (openParen !== -1) {
        state.inSig = false;
        const closeParen = code.indexOf(')', openParen);
        if (closeParen !== -1) {
            return REGEX.SYNTAX.RUST_AMP_STRING.test(code.slice(openParen, closeParen));
        }
        state.inParams = true;
        return REGEX.SYNTAX.RUST_AMP_STRING.test(code.slice(openParen));
    }
    if (code.includes('{') || code.includes(';')) {
        state.inSig = false;
    }
    return false;
}

/**
 * Inspect function declaration line for opening paren and parameters.
 */
function checkFnDeclLine(code: string, state: FnSigState): boolean {
    const fnIdx = code.search(REGEX.SYNTAX.RUST_FN);
    const openParen = code.indexOf('(', fnIdx);
    if (openParen !== -1) {
        const closeParen = code.indexOf(')', openParen);
        if (closeParen !== -1) {
            return REGEX.SYNTAX.RUST_AMP_STRING.test(code.slice(openParen, closeParen));
        }
        state.inParams = true;
        return REGEX.SYNTAX.RUST_AMP_STRING.test(code.slice(openParen));
    }
    state.inSig = true;
    return false;
}

/**
 * Check if a code line contains `&String` within a function parameter list.
 */
function checkAmpStringInLine(code: string, state: FnSigState): boolean {
    if (state.inParams) {
        const closeParen = code.indexOf(')');
        const slice = closeParen !== -1 ? code.slice(0, closeParen) : code;
        const hit = REGEX.SYNTAX.RUST_AMP_STRING.test(slice);
        if (closeParen !== -1 || code.includes('{') || code.includes(';')) {
            state.inParams = false;
        }
        return hit;
    }
    if (state.inSig) {
        return checkSigOpenParen(code, state);
    }
    return REGEX.SYNTAX.RUST_FN.test(code) ? checkFnDeclLine(code, state) : false;
}

/**
 * Detect `if let ... else { return/break; }` pattern eligible for `let-else`.
 */
function isLetElseCandidate(lines: readonly string[], startIndex: number): boolean {
    if (!REGEX.SYNTAX.RUST_IF_LET.test(lines[startIndex])) {
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
    const ifEnd = findMatchingBraceInText(chunk, openBrace);
    if (ifEnd === -1) {
        return false;
    }
    const afterIf = chunk.slice(ifEnd + 1);
    const elseMatch = /^\s*else\s*\{/.exec(afterIf);
    if (!elseMatch) {
        return false;
    }
    const elseStart = ifEnd + 1 + elseMatch[0].length - 1;
    const elseEnd = findMatchingBraceInText(chunk, elseStart);
    const elseBody =
        elseEnd !== -1 ? chunk.slice(elseStart + 1, elseEnd) : chunk.slice(elseStart + 1);
    return /\b(?:return|break)\b/.test(elseBody);
}

/**
 * Detect manual `for item in iter` loop searching followed immediately by return.
 */
function isForFindCandidate(lines: readonly string[], startIndex: number): boolean {
    if (!REGEX.SYNTAX.RUST_FOR_IN.test(lines[startIndex])) {
        return false;
    }
    const maxLine = Math.min(startIndex + MAX_FOR_FIND_SPAN_LINES, lines.length);
    const chunk = lines.slice(startIndex, maxLine).join(' ');
    return REGEX.SYNTAX.RUST_FOR_FIND.test(chunk);
}

/**
 * Determine body line range of an async function.
 */
function resolveAsyncFnScope(
    lines: readonly string[],
    startIndex: number,
): { bodyStart: number; bodyEnd: number } | null {
    let bodyStart = -1;
    let depth = 0;
    for (let j = startIndex; j < lines.length; j += 1) {
        const line = lines[j];
        for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
            if (line[charIndex] === '{') {
                if (bodyStart === -1) bodyStart = j;
                depth += 1;
            } else if (line[charIndex] === '}') {
                depth -= 1;
                if (depth === 0 && bodyStart !== -1) {
                    return { bodyStart, bodyEnd: j };
                }
            }
        }
    }
    return bodyStart !== -1 ? { bodyStart, bodyEnd: lines.length - 1 } : null;
}

const RUST_TEST_FILE_RE = REGEX.RUST.TEST_FILE;

/**
 * Determine whether the line is located inside a test file or a `#[test]` / `#[cfg(test)]` block.
 */
function isTestScopeOrFile(ctx: LineScanContext): boolean {
    if (RUST_TEST_FILE_RE.test(ctx.file)) {
        return true;
    }
    let depth = 0;
    for (let i = ctx.lineIndex; i >= 0; i -= 1) {
        const line = ctx.allRawLines[i];
        for (let charIndex = line.length - 1; charIndex >= 0; charIndex -= 1) {
            if (line[charIndex] === '}') depth += 1;
            else if (line[charIndex] === '{' && depth > 0) depth -= 1;
        }
        if (REGEX.SYNTAX.RUST_TEST_ATTR.test(line)) {
            return true;
        }
    }
    return false;
}

/** Declarative rule for synchronous lock guard held across await point. */
const RULE_LOCK_AWAIT: DeclarativeLineRule = Object.freeze({
    rule: 'RSM-LOCK-001',
    severity: SEVERITY_WARNING,
    message:
        'Holding a synchronous `std::sync` lock guard across `.await` can cause deadlocks and violates `Send`.',
    suggestion:
        'Use `tokio::sync::Mutex` or drop the synchronous lock guard before invoking `.await`.',
    actionable: {
        action: 'apply_guard_clause' as AgentActionType,
        codeId: '011',
        templateSnippet: SNIPPET_DROP_GUARD,
    },
});

/**
 * Scan all async functions in file for std guard instances held across `.await`.
 */
function scanAsyncLockIssues(
    file: string,
    raw: readonly string[],
    masked: readonly string[],
    delegate: DeclarativeModernAnalyzer,
    issues: Issue[],
): void {
    for (let i = 0; i < masked.length; i += 1) {
        if (!REGEX.SYNTAX.RUST_ASYNC_FN.test(masked[i])) {
            continue;
        }
        const scope = resolveAsyncFnScope(masked, i);
        if (!scope) {
            continue;
        }

        const lockLines: number[] = [];
        let maxAwaitLine = -1;
        for (let j = scope.bodyStart; j <= scope.bodyEnd; j += 1) {
            if (REGEX.SYNTAX.RUST_STD_LOCK.test(masked[j])) lockLines.push(j);
            if (REGEX.SYNTAX.RUST_AWAIT.test(masked[j])) maxAwaitLine = j;
        }
        for (const lockLineIdx of lockLines) {
            if (maxAwaitLine > lockLineIdx) {
                issues.push(
                    delegate.emitIssue(RULE_LOCK_AWAIT, file, lockLineIdx + 1, {
                        line: raw[lockLineIdx].trim(),
                    }),
                );
            }
        }
    }
}

/** Declarative rule for unsafe blocks/functions lacking // SAFETY: proof. */
const RULE_UNSAFE_SAFETY: DeclarativeLineRule = Object.freeze({
    rule: 'RSM-SAF-001',
    severity: SEVERITY_WARNING,
    message: 'Unsafe block or function lacks documented `// SAFETY:` invariant proof.',
    suggestion:
        'Document validity, lifetime, and bounds invariants with a preceding `// SAFETY:` comment.',
    actionable: {
        action: 'apply_guard_clause' as AgentActionType,
        codeId: '014',
        templateSnippet: SNIPPET_SAFETY_PROOF,
    },
});

/**
 * Scan source lines for unsafe blocks/functions lacking preceding `// SAFETY:` proof comments.
 */
function scanUnsafeSafetyProofs(
    file: string,
    raw: readonly string[],
    masked: readonly string[],
    delegate: DeclarativeModernAnalyzer,
    issues: Issue[],
): void {
    if (RUST_TEST_FILE_RE.test(file)) {
        return;
    }
    for (let i = 0; i < masked.length; i += 1) {
        if (!UNSAFE_KEYWORD_RE.test(masked[i])) {
            continue;
        }
        let hasProof = false;
        for (let offset = -2; offset <= 1; offset += 1) {
            const checkIdx = i + offset;
            if (checkIdx >= 0 && checkIdx < raw.length) {
                if (SAFETY_PROOF_COMMENT_RE.test(raw[checkIdx])) {
                    hasProof = true;
                    break;
                }
            }
        }
        if (!hasProof) {
            issues.push(
                delegate.emitIssue(RULE_UNSAFE_SAFETY, file, i + 1, {
                    line: raw[i].trim(),
                }),
            );
        }
    }
}

/**
 * Rust modernization analyzer backed by DeclarativeModernAnalyzer.
 */
export class RustModernAnalyzer implements Analyzer {
    public readonly name = ANALYZER_RUST_MODERN;
    private readonly delegate: DeclarativeModernAnalyzer;
    private fnSigState: FnSigState = { inParams: false, inSig: false };

    constructor() {
        const rules: readonly DeclarativeLineRule[] = [
            {
                rule: 'RSM-TRY-001',
                severity: SEVERITY_WARNING,
                pattern: REGEX.SYNTAX.RUST_TRY_MACRO,
                message: '`try!` predates the `?` operator and obscures the error path.',
                suggestion:
                    'Replace `try!(expr)` with `expr?`, which composes inside larger expressions.',
                actionable: {
                    action: 'replace_token',
                    codeId: '001',
                    templateSnippet: SNIPPET_QUESTION,
                    autoSafe: true,
                },
            },
            {
                rule: 'RSM-EXTERN-001',
                severity: SEVERITY_WARNING,
                pattern: REGEX.SYNTAX.RUST_EXTERN_CRATE,
                message:
                    '`extern crate` is obsolete since edition 2018: dependencies resolve by path.',
                suggestion:
                    'Delete the declaration and `use` the crate path directly in each module.',
                actionable: {
                    action: 'replace_token',
                    codeId: '002',
                    templateSnippet: SNIPPET_USE_PATH,
                },
            },
            {
                rule: 'RSM-MACRO-001',
                severity: SEVERITY_WARNING,
                pattern: REGEX.SYNTAX.RUST_MACRO_USE,
                message: '`#[macro_use]` imports macros textually, so their origin is invisible.',
                suggestion:
                    'Import the macros explicitly (`use crate::m::{a, b};`) and drop the attribute.',
                actionable: {
                    action: 'replace_token',
                    codeId: '003',
                    templateSnippet: SNIPPET_USE_GROUP,
                },
            },
            {
                rule: 'RSM-CLONE-001',
                severity: SEVERITY_INFO,
                pattern: REGEX.SYNTAX.RUST_NEEDLESS_CLONE,
                message:
                    '`.clone()` result is only compared or measured, so the copy is invisible work.',
                suggestion:
                    'Compare or measure the borrowed value instead, or use `==` on references.',
                actionable: {
                    action: 'replace_token',
                    codeId: '005',
                    templateSnippet: SNIPPET_BORROW,
                },
            },
            {
                rule: 'RSM-UNWRAP-001',
                severity: SEVERITY_INFO,
                pattern: REGEX.SYNTAX.RUST_UNWRAP,
                condition: (ctx) => !isTestScopeOrFile(ctx),
                message:
                    '`.unwrap()` panics on `None`/`Err` and hides the failure from the caller.',
                suggestion:
                    'Propagate with `?`, or state the invariant with `expect("why this cannot fail")`.',
                actionable: {
                    action: 'apply_guard_clause',
                    codeId: '006',
                    templateSnippet: SNIPPET_CONTEXT_PROPAGATE,
                },
            },
            {
                rule: 'RSM-CAST-001',
                severity: SEVERITY_INFO,
                pattern: REGEX.SYNTAX.RUST_NUMERIC_CAST,
                condition: (ctx) => !isTestScopeOrFile(ctx),
                message: 'Naked `as` numeric cast can silently truncate or wrap on overflow.',
                suggestion:
                    'Use `TryFrom`/`try_into()` for fallible casts, or `From`/`from()` for lossless conversions.',
                actionable: {
                    action: 'replace_token',
                    codeId: '007',
                    templateSnippet: SNIPPET_TRY_FROM,
                },
            },
            {
                rule: 'RSM-STR-001',
                severity: SEVERITY_WARNING,
                message:
                    '`&String` forces every caller to own a String; `&str` borrows either form.',
                suggestion: 'Take `&str` (or `impl AsRef<str>`) and let callers pass `&my_string`.',
                condition: (ctx) => checkAmpStringInLine(ctx.trimmed, this.fnSigState),
                actionable: {
                    action: 'replace_token',
                    codeId: '004',
                    templateSnippet: SNIPPET_STR_REF,
                },
            },
            {
                rule: 'RSM-FORMAT-001',
                severity: SEVERITY_WARNING,
                message: 'Positional `{}` captures drift out of sync with the argument list.',
                suggestion: 'Inline the binding (`format!("{value}")`) so the compiler checks it.',
                condition: (ctx) =>
                    REGEX.SYNTAX.RUST_FORMAT_CALL.test(ctx.maskedLine) &&
                    isPositionalFormatCall(ctx.allRawLines, ctx.lineIndex),
                actionable: {
                    action: 'replace_token',
                    codeId: '008',
                    templateSnippet: SNIPPET_INLINE_FORMAT,
                },
            },
            {
                rule: 'RSM-ELSE-001',
                severity: SEVERITY_WARNING,
                message:
                    '`if let ... else { return/break }` can be simplified with `let ... else` syntax.',
                suggestion:
                    'Rewrite as `let Pattern = expr else { return/break; };` to reduce nesting.',
                condition: (ctx) => isLetElseCandidate(ctx.allMaskedLines, ctx.lineIndex),
                actionable: {
                    action: 'apply_guard_clause',
                    codeId: '009',
                    templateSnippet: SNIPPET_LET_ELSE,
                },
            },
            {
                rule: 'RSM-FIND-001',
                severity: SEVERITY_INFO,
                message:
                    'Manual `for ... in` loop searching with an immediate return can be simplified.',
                suggestion: 'Use iterator methods like `.find()`, `.any()`, or `.position()`.',
                condition: (ctx) => isForFindCandidate(ctx.allMaskedLines, ctx.lineIndex),
                actionable: {
                    action: 'replace_token',
                    codeId: '010',
                    templateSnippet: SNIPPET_ITER_FIND,
                },
            },
            {
                rule: 'RSM-EXP-001',
                severity: SEVERITY_INFO,
                pattern: REGEX.SYNTAX.RUST_EXPECT_CALL,
                condition: (ctx) => !isTestScopeOrFile(ctx),
                message:
                    '`.expect()` panics if unfulfilled; prefer strong-typed error propagation in production.',
                suggestion:
                    'Propagate with `?` or map to a strongly-typed error using `.context(...)` or `.map_err(...)`.',
                actionable: {
                    action: 'apply_guard_clause',
                    codeId: '012',
                    templateSnippet: SNIPPET_MAP_ERR,
                },
            },
            {
                rule: 'RSM-PNC-001',
                severity: SEVERITY_ERROR,
                pattern: REGEX.SYNTAX.RUST_CRASH_MACRO,
                condition: (ctx) => !isTestScopeOrFile(ctx),
                message:
                    'Naked crash macro (`panic!`, `todo!`, `unimplemented!`, or `unreachable!`) in production code.',
                suggestion:
                    'Return a strongly-typed `Result` error with domain classification instead of crashing the process.',
                actionable: {
                    action: 'apply_guard_clause',
                    codeId: '013',
                    templateSnippet: SNIPPET_CRASH_REPLACE,
                },
            },
            RULE_LOCK_AWAIT,
            RULE_UNSAFE_SAFETY,
        ];

        this.delegate = new DeclarativeModernAnalyzer({
            analyzerId: ANALYZER_RUST_MODERN,
            fileExtensions: [SOURCE_EXTENSION],
            maskConfig: RUST_MASK,
            rules,
            multiLineScanner: (raw, masked, file, issues) => {
                scanAsyncLockIssues(file, raw, masked, this.delegate, issues);
                scanUnsafeSafetyProofs(file, raw, masked, this.delegate, issues);
            },
        });
    }

    public finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    public analyze(sourceFile: unknown, ctx: AnalyzerContext): Issue[] {
        this.fnSigState = { inParams: false, inSig: false };
        return this.delegate.analyze(sourceFile, ctx);
    }
}
