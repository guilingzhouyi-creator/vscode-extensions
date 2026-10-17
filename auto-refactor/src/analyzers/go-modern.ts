/**
 * Module: Static Analysis Engine — Go Modernization & Style Rules
 * File Path: src/analyzers/go-modern.ts
 * Architecture Role: Go-only style analyzer (a language pack bound to Go, never to a
 *     project) — the Go counterpart of the Python/Rust/TypeScript modernization packs.
 * Dependencies & Triggers: core types + declarative modern metapack; enabled when a config
 *     declares `analyzers.go-modern`; specialized packs are default-off so registering
 *     them cannot change an existing gate result.
 * Responsibilities: Report five Go style/modernization findings on `.go` files:
 *     GOM-ERR-001 (unchecked errors via `_` discard), GOM-CTX-001 (context not first arg),
 *     GOM-STYLE-001 (receiver naming conventions), GOM-STYLE-002 (error variable naming),
 *     GOM-STYLE-003 (missing package comment).
 * Exit Semantics & Design Rationale: Built on DeclarativeModernAnalyzer over the shared masked view,
 *     never throws and returns [] for every other language. Go uses C-family comment syntax, so
 *     the mask uses `//` line comments and `/*` block comments plus double-quoted and
 *     backtick-quoted strings. Rules are keyword-anchored; a missed modernization is
 *     preferred over a false positive.
 */

import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_GO_MODERN } from '../core/scoring/dimensionLiterals';
import type { SourceMaskConfig } from '../core/policy/source-mask';
import {
    DeclarativeModernAnalyzer,
    type DeclarativeLineRule,
    type LineScanContext,
} from './declarative-modern-pack';

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
    multilineTemplates: true,
};

// --- Rule patterns ---

/**
 * Unchecked error: `f, _ := os.Open(...)` or `x, _ = foo()` where `_` discards
 * the second return value (conventionally an error).
 */
const UNCHECKED_ERROR_RE = /,\s*_\s*(?::=|=)|^_\s*(?::=|=)/;

/**
 * context.Context parameter that is NOT the first parameter of a function/method.
 */
const CONTEXT_IN_PARAMS_RE = /context\.Context/;
const CONTEXT_PACKAGE_TYPE = 'context.Context';

/** Function / method signature start — used to locate parameter lists. */
const FUNC_SIGNATURE_RE =
    /^func\s+(?:\([^)]+\)\s+)?[A-Za-z_][A-Za-z0-9_]*\s*(?:\[[^\]]*\])?\s*\(/;

/**
 * Receiver naming: `func (self *Foo)` or `func (this Bar)` or overly long receiver names.
 */
const RECEIVER_RE =
    /^func\s+\(\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)/;

/** Receiver names that violate Go conventions. */
const BAD_RECEIVER_NAMES = new Set(['self', 'this', 'me', 'receiver', 'rec']);

/** Maximum receiver name length considered acceptable (Go convention: 1-2 letters). */
const MAX_RECEIVER_NAME_LEN = 3;

/**
 * Error variable naming: variables holding errors should start with `err`.
 */
const VAR_ERROR_TYPE_RE = /^var\s+([A-Za-z_][A-Za-z0-9_]*)\s+error\b/;

/**
 * Package comment: the line immediately before package declaration should be a comment.
 */
const PACKAGE_DECL_RE = /^package\s+[A-Za-z_][A-Za-z0-9_]*\s*$/;

/** Line that is a comment (starts with `//` or `/*`). */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*)/;

// --- Actionable snippet templates ---

const SNIPPET_GUARD_ERR = 'if err != nil { return err }';
const SNIPPET_CTX_FIRST = 'func $1(ctx context.Context, $2)';
const SNIPPET_RECEIVER = 'func ($1 *$2) $3()';
const SNIPPET_ERR_NAME = 'err$1';
const SNIPPET_PKG_COMMENT = '// Package $1 provides ...';

// --- Per-rule detection helpers ---

/**
 * Check if a function signature has `context.Context` but not as the first parameter.
 */
function hasContextNotFirst(code: string): boolean {
    if (!FUNC_SIGNATURE_RE.test(code) || !CONTEXT_IN_PARAMS_RE.test(code)) {
        return false;
    }

    const parenStart = code.indexOf('(');
    if (parenStart === -1) {
        return false;
    }

    const braceIdx = code.indexOf('{');
    const searchEnd = braceIdx === -1 ? code.length : braceIdx;
    const parenEnd = code.lastIndexOf(')', searchEnd);
    if (parenEnd === -1 || parenEnd <= parenStart) {
        return false;
    }

    const paramsStr = code.slice(parenStart + 1, parenEnd).trim();
    if (!paramsStr) {
        return false;
    }

    const firstParam = paramsStr.split(',')[0].trim();
    return !firstParam.includes(CONTEXT_PACKAGE_TYPE);
}

/**
 * Check if a receiver name violates Go naming conventions.
 */
function hasBadReceiverName(code: string): boolean {
    const match = RECEIVER_RE.exec(code);
    if (!match) {
        return false;
    }
    return BAD_RECEIVER_NAMES.has(match[1]) || match[1].length > MAX_RECEIVER_NAME_LEN;
}

/**
 * Check if an error variable does not follow the `err` prefix convention.
 */
function hasBadErrorName(code: string): boolean {
    const match = VAR_ERROR_TYPE_RE.exec(code);
    return match ? !/^err/i.test(match[1]) : false;
}

/**
 * Check if package declaration is preceded by a comment.
 */
function isPackageMissingComment(ctx: LineScanContext): boolean {
    if (!PACKAGE_DECL_RE.test(ctx.trimmed)) {
        return false;
    }

    let prevIdx = ctx.lineIndex - 1;
    while (prevIdx >= 0 && ctx.allRawLines[prevIdx].trim().length === 0) {
        prevIdx -= 1;
    }

    if (prevIdx < 0) {
        return true;
    }

    return !COMMENT_LINE_RE.test(ctx.allRawLines[prevIdx]);
}

// --- Declarative Rules Definition ---

const GO_MODERN_RULES: readonly DeclarativeLineRule[] = [
    {
        rule: 'GOM-ERR-001',
        severity: SEVERITY_WARNING,
        message: 'Error return value is discarded with `_`, silently hiding potential failures.',
        suggestion:
            'Check the error explicitly (`if err != nil { return err }`) or document why it is safe to ignore.',
        pattern: UNCHECKED_ERROR_RE,
        actionable: {
            action: 'apply_guard_clause',
            codeId: '001',
            templateSnippet: SNIPPET_GUARD_ERR,
        },
    },
    {
        rule: 'GOM-CTX-001',
        severity: SEVERITY_WARNING,
        message: '`context.Context` should be the first parameter of a function.',
        suggestion:
            'Move `ctx context.Context` to be the first parameter — this is the Go convention and matches `ctx`-first APIs like `net/http` and database drivers.',
        condition: (ctx) => hasContextNotFirst(ctx.trimmed),
        actionable: {
            action: 'simplify_control_flow',
            codeId: '002',
            templateSnippet: SNIPPET_CTX_FIRST,
        },
    },
    {
        rule: 'GOM-STYLE-001',
        severity: SEVERITY_INFO,
        message: 'Receiver name does not follow Go naming conventions.',
        suggestion:
            'Use a short (1-2 letter) abbreviation of the type name (e.g. `s` for `Server`, `c` for `Client`), and keep it consistent across all methods of the type.',
        condition: (ctx) => hasBadReceiverName(ctx.trimmed),
        actionable: {
            action: 'rename_symbol',
            codeId: '003',
            templateSnippet: SNIPPET_RECEIVER,
        },
    },
    {
        rule: 'GOM-STYLE-002',
        severity: SEVERITY_INFO,
        message:
            'Error variable does not follow Go naming conventions (should start with `err`).',
        suggestion:
            'Rename the variable to start with `err` (e.g. `errOpen` instead of `openErr` or `err` for a general error).',
        condition: (ctx) => hasBadErrorName(ctx.trimmed),
        actionable: {
            action: 'rename_symbol',
            codeId: '004',
            templateSnippet: SNIPPET_ERR_NAME,
        },
    },

    {
        rule: 'GOM-STYLE-003',
        severity: SEVERITY_INFO,
        message: 'Package is missing a documentation comment.',
        suggestion:
            'Add a comment before `package` that starts with `Package <name> ` and briefly describes the package purpose (Go convention for godoc).',
        condition: isPackageMissingComment,
        detailFactory: (ctx) => ({ line: ctx.rawLine }),
        actionable: {
            action: 'insert_comment_contract',
            codeId: '005',
            templateSnippet: SNIPPET_PKG_COMMENT,
        },
    },
];

/**
 * Go modernization analyzer backed by DeclarativeModernAnalyzer.
 */
export class GoModernAnalyzer implements Analyzer {
    public readonly name = ANALYZER_GO_MODERN;
    private readonly delegate: DeclarativeModernAnalyzer;

    constructor() {
        this.delegate = new DeclarativeModernAnalyzer({
            analyzerId: ANALYZER_GO_MODERN,
            fileExtensions: [SOURCE_EXTENSION],
            maskConfig: GO_MASK,
            rules: GO_MODERN_RULES,
        });
    }

    public finalize(ctx: AnalyzerContext): Issue[] {
        return this.delegate.finalize(ctx);
    }

    public analyze(sf: unknown, ctx: AnalyzerContext): Issue[] {
        return this.delegate.analyze(sf, ctx);
    }
}
