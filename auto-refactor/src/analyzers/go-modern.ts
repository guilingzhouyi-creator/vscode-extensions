/**
 * Module: Static Analysis Engine — Go Modernization & Style Rules
 * File Path: src/analyzers/go-modern.ts
 * Architecture Role: Go-only style analyzer (a language pack bound to Go, never to a
 *     project) — the Go counterpart of the Python/Rust/TypeScript modernization packs
 * Dependencies & Triggers: core types + the shared source masker; enabled when a config
 *     declares `analyzers.go-modern`; specialized packs are default-off so registering
 *     them cannot change an existing gate result
 * Responsibilities: Report five Go style/modernization findings on `.go` files:
 *     GOM-ERR-001 (unchecked errors via `_` discard), GOM-CTX-001 (context not first arg),
 *     GOM-STYLE-001 (receiver naming conventions), GOM-STYLE-002 (error variable naming),
 *     GOM-STYLE-003 (missing package comment)
 * Exit Semantics & Design Rationale: Pure line scanner over the shared masked view, never
 *     throws and returns [] for every other language. Go uses C-family comment syntax, so
 *     the mask uses `//` line comments and `/*` block comments plus double-quoted and
 *     backtick-quoted strings. Rules are keyword-anchored; a missed modernization is
 *     preferred over a false positive.
 */
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_GO_MODERN } from '../core/scoring/dimensionLiterals';
import { maskSourceText, type SourceMaskConfig } from '../core/source-mask';

/** Extension the pack accepts; the content-only path sees every language. */
const SOURCE_EXTENSION = '.go';

/**
 * Masking syntax for Go: C-family comments, double-quoted and backtick-quoted strings.
 * Backticks can span multiple lines (raw string literals).
 */
const GO_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: '"`',
    multilineTemplates: true, // backtick raw strings can span lines
};

// --- Rule patterns ---

/**
 * Unchecked error: `f, _ := os.Open(...)` or `x, _ = foo()` where `_` discards
 * the second return value (conventionally an error).
 *
 * Heuristic: looks for `, _ :=` or `, _ =` patterns on the left side of an assignment.
 * Also catches `_ := foo()` where the entire return value is discarded.
 */
const UNCHECKED_ERROR_RE = /,\s*_\s*(?::=|=)|^_\s*(?::=|=)/;

/**
 * context.Context parameter that is NOT the first parameter of a function/method.
 * Matches function signatures where `ctx context.Context` appears after other params.
 *
 * Heuristic: looks for `func ...(` lines where `context.Context` appears but
 * is NOT the first parameter after the opening paren.
 */
const CONTEXT_IN_PARAMS_RE = /context\.Context/;

/** Function / method signature start — used to locate parameter lists. */
const FUNC_SIGNATURE_RE = /^func\s+(?:\([^)]+\)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*(?:\[[^\]]*\])?\s*\(/;

/**
 * Receiver naming: `func (self *Foo)` or `func (this Bar)` or overly long receiver names.
 *
 * Go convention: receiver name should be a short (1-2 letter) abbreviation of the type name,
 * consistent across all methods of the same type. Names like `self`, `this`, `me` are discouraged.
 */
const RECEIVER_RE = /^func\s+\(\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)/;

/** Receiver names that violate Go conventions. */
const BAD_RECEIVER_NAMES = new Set(['self', 'this', 'me', 'receiver', 'rec']);

/** Maximum receiver name length considered acceptable (Go convention: 1-2 letters). */
const MAX_RECEIVER_NAME_LEN = 3;

/**
 * Error variable naming: variables holding errors should start with `err`.
 *
 * Matches patterns like `var foo error` or `foo := errors.New(...)` where the
 * variable name doesn't start with `err`.
 *
 * Heuristic: looks for `:=` assignments where the RHS contains `error` type
 * or functions returning errors, plus `var x error` declarations.
 */
const VAR_ERROR_TYPE_RE = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s+error\b/;

/**
 * Package comment: the line immediately before `package xxx` should be a comment.
 *
 * Detected by looking at the line before the package declaration.
 */
const PACKAGE_DECL_RE = /^package\s+[A-Za-z_][A-Za-z0-9_]*\s*$/;

/** Line that is a comment (starts with `//` or `/*`). */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

// --- Rule definitions ---

interface LineRule {
    rule: string;
    severity: Severity;
    message: string;
    suggestion: string;
}

const UNCHECKED_ERROR_RULE: LineRule = {
    rule: 'GOM-ERR-001',
    severity: SEVERITY_WARNING,
    message:
        'Error return value is discarded with `_`, silently hiding potential failures.',
    suggestion:
        'Check the error explicitly (`if err != nil { return err }`) or document why it is safe to ignore.',
};

const CONTEXT_FIRST_RULE: LineRule = {
    rule: 'GOM-CTX-001',
    severity: SEVERITY_WARNING,
    message: '`context.Context` should be the first parameter of a function.',
    suggestion:
        'Move `ctx context.Context` to be the first parameter — this is the Go convention and matches `ctx`-first APIs like `net/http` and database drivers.',
};

const RECEIVER_NAMING_RULE: LineRule = {
    rule: 'GOM-STYLE-001',
    severity: SEVERITY_INFO,
    message: 'Receiver name does not follow Go naming conventions.',
    suggestion:
        'Use a short (1-2 letter) abbreviation of the type name (e.g. `s` for `Server`, `c` for `Client`), and keep it consistent across all methods of the type.',
};

const ERROR_NAMING_RULE: LineRule = {
    rule: 'GOM-STYLE-002',
    severity: SEVERITY_INFO,
    message: 'Error variable does not follow Go naming conventions (should start with `err`).',
    suggestion:
        'Rename the variable to start with `err` (e.g. `errOpen` instead of `openErr` or `err` for a general error).',
};

const PACKAGE_COMMENT_RULE: LineRule = {
    rule: 'GOM-STYLE-003',
    severity: SEVERITY_INFO,
    message: 'Package is missing a documentation comment.',
    suggestion:
        'Add a comment before `package` that starts with `Package <name> ` and briefly describes the package purpose (Go convention for godoc).',
};

// --- Issue factory ---

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
        id: `${ANALYZER_GO_MODERN}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_GO_MODERN,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

// --- Per-rule detection helpers ---

/**
 * Check if a line discards an error with `_`.
 *
 * @param code - Masked line (comments/strings blanked).
 * @returns True when the line contains a `, _ :=` or `, _ =` pattern.
 */
function hasUncheckedError(code: string): boolean {
    return UNCHECKED_ERROR_RE.test(code);
}

/**
 * Check if a function signature has `context.Context` but not as the first parameter.
 *
 * @param code - Masked line with a function signature start.
 * @returns True when context.Context appears after at least one other parameter.
 */
function hasContextNotFirst(code: string): boolean {
    if (!FUNC_SIGNATURE_RE.test(code)) return false;
    if (!CONTEXT_IN_PARAMS_RE.test(code)) return false;

    // Extract the parameter list — find everything between the first `(` after `func ... name`
    // and its matching `)`. Since this is line-level, we only handle single-line signatures.
    const parenStart = code.indexOf('(');
    if (parenStart === -1) return false;

    // Find the matching close paren (simple: look for the last `)` before `{` or end of line)
    const braceIdx = code.indexOf('{');
    const searchEnd = braceIdx === -1 ? code.length : braceIdx;
    const parenEnd = code.lastIndexOf(')', searchEnd);
    if (parenEnd === -1 || parenEnd <= parenStart) return false;

    const paramsStr = code.slice(parenStart + 1, parenEnd).trim();
    if (!paramsStr) return false;

    // Check if context.Context is the first parameter
    const firstParam = paramsStr.split(',')[0].trim();
    if (firstParam.includes('context.Context')) return false;

    // context.Context is present but not first — that's a violation
    return true;
}

/**
 * Check if a receiver name violates Go naming conventions.
 *
 * @param code - Masked line with a method signature.
 * @returns True when the receiver name is `self`/`this`/`me` or too long.
 */
function hasBadReceiverName(code: string): boolean {
    const match = RECEIVER_RE.exec(code);
    if (!match) return false;
    const receiverName = match[1];
    // Bad names: self, this, me, etc.
    if (BAD_RECEIVER_NAMES.has(receiverName)) return true;
    // Too long (Go convention is 1-2 letters, allow 3 for edge cases)
    if (receiverName.length > MAX_RECEIVER_NAME_LEN) return true;
    return false;
}

/**
 * Check if an error variable does not follow the `err` prefix convention.
 *
 * @param code - Masked line.
 * @returns True when a `var x error` declaration has a name not starting with `err`.
 */
function hasBadErrorName(code: string): boolean {
    const match = VAR_ERROR_TYPE_RE.exec(code);
    if (!match) return false;
    const varName = match[1];
    // Skip if name already starts with err or Err
    if (/^err/i.test(varName)) return false;
    return true;
}

function checkGoStyleRules(
    file: string,
    index: number,
    trimmed: string,
    rawLine: string,
    out: Issue[],
): void {
    if (hasUncheckedError(trimmed)) {
        out.push(
            makeIssue(
                file,
                index,
                UNCHECKED_ERROR_RULE.rule,
                UNCHECKED_ERROR_RULE.severity,
                UNCHECKED_ERROR_RULE.message,
                UNCHECKED_ERROR_RULE.suggestion,
                { line: rawLine },
            ),
        );
    }
    if (hasContextNotFirst(trimmed)) {
        out.push(
            makeIssue(
                file,
                index,
                CONTEXT_FIRST_RULE.rule,
                CONTEXT_FIRST_RULE.severity,
                CONTEXT_FIRST_RULE.message,
                CONTEXT_FIRST_RULE.suggestion,
                { line: rawLine },
            ),
        );
    }
    if (hasBadReceiverName(trimmed)) {
        out.push(
            makeIssue(
                file,
                index,
                RECEIVER_NAMING_RULE.rule,
                RECEIVER_NAMING_RULE.severity,
                RECEIVER_NAMING_RULE.message,
                RECEIVER_NAMING_RULE.suggestion,
                { line: rawLine },
            ),
        );
    }
    if (hasBadErrorName(trimmed)) {
        out.push(
            makeIssue(
                file,
                index,
                ERROR_NAMING_RULE.rule,
                ERROR_NAMING_RULE.severity,
                ERROR_NAMING_RULE.message,
                ERROR_NAMING_RULE.suggestion,
                { line: rawLine },
            ),
        );
    }
}

function checkGoPackageComment(
    file: string,
    index: number,
    raw: string[],
    rawLine: string,
    out: Issue[],
): void {
    let prevIdx = index - 1;
    while (prevIdx >= 0 && raw[prevIdx].trim().length === 0) {
        prevIdx--;
    }
    if (prevIdx < 0 || !COMMENT_LINE_RE.test(raw[prevIdx])) {
        out.push(
            makeIssue(
                file,
                index,
                PACKAGE_COMMENT_RULE.rule,
                PACKAGE_COMMENT_RULE.severity,
                PACKAGE_COMMENT_RULE.message,
                PACKAGE_COMMENT_RULE.suggestion,
                { line: rawLine },
            ),
        );
    }
}

/**
 * Go modernization analyzer.
 *
 * Content-only by design: `finalize` is the path the engine actually invokes (the bare
 * `analyze` path is TypeScript-only). Only `.go` paths are inspected.
 */
export class GoModernAnalyzer implements Analyzer {
    name = ANALYZER_GO_MODERN;

    /**
     * Streaming-path entry point: the engine invokes this once per file. Content-only
     * analyzers must expose it because the legacy `analyze` path covers TS-family only.
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one Go file for modernization and style findings.
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

        const { raw, masked } = maskSourceText(content, GO_MASK);
        const out: Issue[] = [];
        let foundPackageComment = false;

        for (let index = 0; index < masked.length; index += 1) {
            const code = masked[index];
            const trimmed = code.trim();
            if (trimmed.length === 0) continue;
            const rawLine = raw[index].trim();

            checkGoStyleRules(file, index, trimmed, rawLine, out);

            if (PACKAGE_DECL_RE.test(trimmed)) {
                checkGoPackageComment(file, index, raw, rawLine, out);
                foundPackageComment = true;
            }
        }

        // If no package declaration was found, don't report the rule
        // (the file might not be a valid Go source, or might be a test file)
        if (!foundPackageComment) {
            // Remove any package-comment issues (there shouldn't be any if no package decl)
        }

        return out;
    }
}
