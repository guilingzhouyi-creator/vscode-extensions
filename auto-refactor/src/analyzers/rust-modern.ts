/**
 * Module: Static Analysis Engine — Rust Modernization Rules
 * File Path: src/analyzers/rust-modern.ts
 * Architecture Role: Rust-only style analyzer (a language pack bound to the language, never to a
 *     project) — the Rust counterpart of the Python/TypeScript modernization packs
 * Dependencies & Triggers: core types + the shared source masker; enabled when a config declares
 *     `analyzers.rust-modern`; specialized packs are default-off, so registering it cannot change
 *     an existing gate result
 * Responsibilities: Report seven modernization findings on `.rs` files: RSM-TRY-001 (`try!`),
 *     RSM-EXTERN-001 (`extern crate`), RSM-MACRO-001 (`#[macro_use]`), RSM-STR-001 (`&String`
 *     parameter), RSM-CLONE-001 (needless `.clone()`), RSM-UNWRAP-001 (`.unwrap()` on a fallible
 *     result) and RSM-FORMAT-001 (positional `{}` where an inline capture reads better)
 * Exit Semantics & Design Rationale: Pure line scanner over the shared masked view, never throws
 *     and returns [] for every other language. Rust's comment syntax matches the C family, so the
 *     mask only needs the slash and the C-style block delimiters; char literals and lifetimes
 *     masker that treated `'a` as a quote would silently hide the rest of the line — a missed
 *     modernization is preferred over a wrong rewrite suggestion. Every rule stays keyword-anchored
 *     and the two risky ones (`.clone()`, `.unwrap()`) report at info severity.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_RUST_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/source-mask';

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.rs';

/**
 * Masking syntax for Rust: slash comments plus double-quoted strings. Single quotes
 * are deliberately left alone so lifetimes survive, and raw strings (`r#"…"#`) stay unmasked.
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

/** `&String` in a signature, where `&str` accepts strictly more call sites. */
const AMP_STRING_RE = /&\s*String\b/;

/** `.clone()` whose only consumer is a comparison or a length check, i.e. a needless allocation. */
const NEEDLESS_CLONE_RE = /\.clone\(\)\s*(?:==|!=|\.len\(\)|\.is_empty\(\))/;

/** `.unwrap()` on a fallible result, which panics instead of propagating. */
const UNWRAP_RE = /\.unwrap\(\)/;

/** A formatting macro call, detected on the masked line (its format string is blanked). */
const FORMAT_CALL_RE = /\b(?:println|print|eprintln|eprint|format|panic|write|writeln)!\s*\(/;

/** A positional `{}` placeholder inside the macro's format string, detected on the raw line. */
const POSITIONAL_PLACEHOLDER_RE = /!\s*\(\s*"[^"]*\{\}/;

/** One keyword-anchored rule: pattern to match on the masked line plus its report text. */
interface LineRule {
    /** Canonical rule id (`RSM-TOPIC-NNN`). */
    rule: string;
    /** Finding severity. */
    severity: Severity;
    /** Pattern run against the masked line. */
    pattern: RegExp;
    /** Why the modern form is preferable. */
    message: string;
    /** One-line rewrite guidance. */
    suggestion: string;
}

/** Keyword rules, all of which fit on one physical line. */
const LINE_RULES: LineRule[] = [
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
        rule: 'RSM-STR-001',
        severity: SEVERITY_WARNING,
        pattern: AMP_STRING_RE,
        message: '`&String` forces every caller to own a String; `&str` borrows either form.',
        suggestion: 'Take `&str` (or `impl AsRef<str>`) and let callers pass `&my_string`.',
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
];

/**
 * Build one finding anchored to a source line.
 *
 * @param file - Normalized repository-relative path.
 * @param lineIndex - Zero-based line index.
 * @param rule - Canonical rule id.
 * @param severity - Finding severity.
 * @param message - Why the modern form is preferable.
 * @param suggestion - One-line rewrite guidance.
 * @param detail - Structured evidence for machines.
 * @returns The finding, ready to be pushed onto the result list.
 */
function makeIssue(
    file: string,
    lineIndex: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    const line = lineIndex + 1;
    return {
        id: `${ANALYZER_RUST_MODERN}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_RUST_MODERN,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

/** Rust modernization pack: seven rules over a masked view of the file. */
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
        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            if (code.trim().length === 0) continue;
            for (const rule of LINE_RULES) {
                if (!rule.pattern.test(code)) continue;
                out.push(
                    makeIssue(
                        file,
                        index,
                        rule.rule,
                        rule.severity,
                        rule.message,
                        rule.suggestion,
                        {
                            line: code.trim(),
                        },
                    ),
                );
            }
            if (FORMAT_CALL_RE.test(code) && POSITIONAL_PLACEHOLDER_RE.test(raw[index])) {
                out.push(
                    makeIssue(
                        file,
                        index,
                        'RSM-FORMAT-001',
                        SEVERITY_WARNING,
                        'Positional `{}` captures drift out of sync with the argument list.',
                        'Inline the binding (`format!("{value}")`) so the compiler checks it.',
                        { line: raw[index].trim() },
                    ),
                );
            }
        }
        return out;
    }
}
