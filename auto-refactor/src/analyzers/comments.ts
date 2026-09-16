/**
 * Module: Static Analysis Engine — Comment & Header Contract Rules
 * File Path: src/analyzers/comments.ts
 * Architecture Role: Self-referential contract analyzer; the executable enforcement of the
 *   six-field file header and public API documentation rules this repository mandates
 * Dependencies & Triggers: ../core/types plus SIX_FIELD_HEADERS_EN / SIX_FIELD_HEADERS_ZH and
 *   CommentMessages from ../core/messages; triggered when the declarative `analyzers.comments`
 *   entry is enabled by CLI / CI / daemon scans at the configured comment level
 * Responsibilities: Scan the first 30 lines for a header comment (CMT-HDR-001), all six header
 *   fields (CMT-HDR-002) and a declared path matching the physical path (CMT-HDR-003); require
 *   adjacent docs on public declarations in TS/JS, GDScript, Python, Rust and Go (CMT-DOC-001);
 *   reject symbol-name echo docs (CMT-DOC-002); require a concurrency note on async
 *   declarations in strict mode (CMT-CON-001); audit comment hygiene — encoding corruption
 *   (CMT-MOJI-001), over-wide comment/docstring lines (CMT-WID-001), mixed section separators
 *   (CMT-SEP-001) and file banners in small modules (CMT-BAN-001)
 * Exit Semantics & Design Rationale: Deterministic line scanner; returns [] at level `off` or
 *   for empty content and never throws. Missing docs are warnings in strict mode because legacy
 *   files must be ratcheted down, while a stale declared path stays error: broken navigation
 *   must fail loudly rather than be silently tolerated.
 */
import type { Analyzer, AnalyzerContext, Issue, CommentLevel, IssueEvidence } from '../core/types';
import { CommentMessages, SIX_FIELD_HEADERS_EN, SIX_FIELD_HEADERS_ZH } from '../core/messages';

interface CommentOptions {
    level?: CommentLevel;
    requireHeader?: boolean;
    strictSixFields?: boolean;
    requireConcurrencyNotice?: boolean;
    /**
     * Project-declared comment-directive tokens (e.g. an in-house `tool:ignore` marker).
     * Matched literally at the start of the comment body and exempt from the width rule,
     * exactly like the built-in tool directives; empty/absent keeps built-ins only.
     */
    directiveTokens?: string[];
}

/**
 * Polyglot export & public symbol declaration patterns:
 * - TypeScript / JavaScript: export (function, class, interface, type, enum, const, let, var)
 * - GDScript: class_name, func, static func (public without leading _)
 * - Python: def, class (public without leading _)
 * - Rust: pub fn, pub struct, pub enum, pub trait, pub type
 * - Go: func CapitalizedName
 */
const EXPORT_RE =
    /^\s*(?:export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+|class_name\s+|(?:static\s+)?func\s+|def\s+|class\s+|pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+|func\s+)([A-Za-z0-9_$]+)/;

/**
 * Comment-hygiene constants.
 *
 * `MOJIBAKE_RE` catches the replacement character plus the two classic double-decoding
 * artifacts (UTF-8 read as Latin-1, and the Windows-1252 smart-quote pair U+00E2 U+20AC).
 * The pattern is written with code-point escapes so this file never matches its own rule.
 * `GENERIC_DIRECTIVE_RE` exempts tool directives from the width limit; it covers the Python
 * tooling family and their TS/JS equivalents so one rule serves every supported language.
 * Project-specific markers are never hardcoded: declare them per project via
 * `comments.options.directiveTokens`.
 */
const MOJIBAKE_RE = /\ufffd|\u00c3[\u0080-\u00bf]|\u00e2\u20ac/;
const MAX_COMMENT_WIDTH = 100;
const GENERIC_DIRECTIVE_RE =
    /^(?:noqa\b|type:\s*ignore|pragma:|mypy:|pyright:|ruff:|fmt:|isort:|nosec\b|eslint-disable|prettier-ignore|@ts-(?:ignore|expect-error)|@ts-nocheck|nolint\b|istanbul\s+ignore|c8\s+ignore|coverage:\s*ignore)/i;

/**
 * The `async` KEYWORD, not the substring.
 *
 * A bare `includes('async')` matched the string literal in
 * `export type TransferType = 'direct' | 'async' | 'event'` and reported a type alias as an
 * asynchronous routine. The keyword form requires `async` to be followed by an identifier, a `(` or
 * a `*`, so occurrences inside a literal, a property key (`{ async: true }`) or prose cannot match.
 */
const ASYNC_DECLARATION_RE = /\basync\b\s*(?=[A-Za-z_$(*])/;

/**
 * Type-only declarations, which can never carry concurrency semantics.
 *
 * A `type`/`interface`/`enum` alias describes shape, not execution, so it is exempt from the
 * concurrency-notice requirement even if one of its members happens to be spelled `async`.
 */
const TYPE_ONLY_DECLARATION_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:type|interface|enum)\b/;

/**
 * Number of leading lines scanned when looking for the file-header comment (CMT-HDR-001/002/003).
 */
const HEADER_SCAN_LINES = 30;

/**
 * Maximum number of preceding comment lines retained as candidate docs for a public declaration
 * (CMT-DOC-001); older lines are shifted out.
 */
const MAX_RECENT_COMMENT_LINES = 8;

/**
 * Number of body lines scanned for a Python/GDScript docstring immediately after a declaration.
 */
const MAX_DOCSTRING_SCAN_LINES = 3;

/**
 * Compose the comment-directive matcher for a single analyze call.
 *
 * Declared tokens are matched as literals (regex metacharacters escaped) and anchored to the
 * start of the comment body, so a declared `tool:ignore` never matches `xtool:ignore`.
 *
 * @param extraTokens - Project-declared directive tokens; empty/undefined keeps built-ins only.
 * @returns Anchored case-insensitive matcher over built-ins plus declared tokens.
 */
function buildDirectiveRe(extraTokens?: string[]): RegExp {
    const tokens = (extraTokens || []).map((token) => String(token).trim()).filter(Boolean);
    if (tokens.length === 0) return GENERIC_DIRECTIVE_RE;
    const literals = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const generic = GENERIC_DIRECTIVE_RE.source.replace(/^\^/, '');
    return new RegExp(`^(?:${generic}|${literals.join('|')})`, 'i');
}
/** Bare rule of separator glyphs — decorative only, exempt from the consistency rule. */
const BARE_SEPARATOR_RE = /^[─═\-=]{3,}$/;
const SHORT_SEPARATOR_RE = /^─{2}(?!─)/;
const LONG_SEPARATOR_RE = /^─{3,}\s*[^\s─]/;
/** File-level banners are only tolerated in substantial modules. */
const BANNER_LINE_LIMIT = 150;

/** Issue severity for informational findings (missing docs in standard mode). */
const SEVERITY_INFO = 'info';

/** Issue severity for advisory findings such as over-wide comments and banners. */
const SEVERITY_WARNING = 'warning';

/** Issue severity for hard contract violations, such as a stale declared file path. */
const SEVERITY_ERROR = 'error';

/** Comment level that enables the strictest audit set, including the concurrency notice. */
const COMMENT_LEVEL_STRICT = 'strict';

/** Double-quote character used to track a Python triple-quoted docstring block. */
const DOUBLE_QUOTE = '"';

/** Single-quote character used to track a Python triple-quoted docstring block. */
const SINGLE_QUOTE = "'";

/**
 * Self-referential analyzer that enforces this repository's comment and header contract.
 *
 * It scans a file's first 30 lines for the six-field header, then walks every line to
 * require adjacent documentation on public/exported symbols across TS/JS, GDScript,
 * Python, Rust and Go. In standard/strict mode it also rejects symbol-name echo docs,
 * and in strict mode it requires an explicit concurrency note on `async` declarations.
 *
 * Contract: produces canonical `Issue` records for CMT-HDR-001/002/003, CMT-DOC-001/002
 * and CMT-CON-001. Inputs are the raw file `content`, `filePath`, and `options`
 * (`level`, `strictSixFields`, `directiveTokens`), with `config.commentLevel` as the level
 * fallback.
 * Output is an empty array when the effective level is `off`, when `content` is empty,
 * or when the file satisfies every enabled rule; otherwise issues use 1-based lines.
 * Edge cases: a `File Path` that disagrees with the physical path is an error, while
 * missing header fields and missing docs are warnings in strict mode so legacy files can
 * be ratcheted down; shebang lines are ignored and do not count as header comments.
 * Failure semantics: deterministic line scan that never throws, including for languages
 * it only partially understands.
 */
export class CommentAnalyzer implements Analyzer {
    name = 'comments' as const;

    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        const opts = (ctx.options || {}) as CommentOptions;
        const level: CommentLevel = opts.level || ctx.config.commentLevel || 'standard';

        if (level === 'off') {
            return [];
        }

        const content = ctx.content || '';
        const len = content.length;
        if (len === 0) return [];

        const issues: Issue[] = [];
        const file = ctx.filePath.replace(/\\/g, '/');
        // Markdown carries no source-comment contract: documentation prose is audited by the
        // dedicated `docs` analyzer, so header/doc rules must not fire on .md files.
        if (file.endsWith('.md')) return [];

        this.auditFileHeader(content, len, file, level, opts, ctx, issues);
        this.auditPublicApi(content, len, file, level, opts, ctx, issues);
        this.auditCommentHygiene(content, file, level, opts, ctx, issues);

        return issues;
    }

    /**
     * Audit language-agnostic comment hygiene: encoding corruption, comment width, separator
     * style consistency, and file-level banners in small modules.
     *
     * One line scanner serves every supported language. Mojibake is checked from `basic`
     * upward because encoding damage is a correctness defect; the stylistic rules start at
     * `standard`.
     *
     * @param content - Full source text of the file.
     * @param file - Normalized (forward-slash) file path used in issue ids and locations.
     * @param level - Effective comment level; controls which rule families run.
     * @param opts - Analyzer options; `directiveTokens` extends the width exemption vocabulary.
     * @param ctx - Analyzer context supplying the config for issue construction.
     * @param issues - Accumulator for the emitted issues.
     */
    private auditCommentHygiene(
        content: string,
        file: string,
        level: CommentLevel,
        opts: CommentOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const lines = content.split('\n');
        const lineCount = lines.length;
        const directiveRe = buildDirectiveRe(opts.directiveTokens);
        let inTriple: typeof DOUBLE_QUOTE | typeof SINGLE_QUOTE | null = null;
        const shortLines: number[] = [];
        const longLines: number[] = [];

        for (let i = 0; i < lineCount; i++) {
            let line = lines[i];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const lineNo = i + 1;
            const trimmed = line.trim();

            if (MOJIBAKE_RE.test(line)) {
                const desc = CommentMessages.MOJIBAKE(file);
                issues.push(
                    this.mkIssue(
                        ctx,
                        i,
                        'CMT-MOJI-001',
                        desc.message,
                        SEVERITY_ERROR,
                        { file },
                        desc.suggestion,
                    ),
                );
            }

            // Track Python docstring blocks so their physical lines count as comment lines.
            let insideTriple = false;
            if (inTriple) {
                insideTriple = true;
                const closers =
                    inTriple === DOUBLE_QUOTE
                        ? line.split('"""').length - 1
                        : line.split("'''").length - 1;
                if (closers > 0) inTriple = null;
            } else if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
                const marker = trimmed.startsWith('"""') ? DOUBLE_QUOTE : SINGLE_QUOTE;
                const occurrences =
                    marker === DOUBLE_QUOTE
                        ? line.split('"""').length - 1
                        : line.split("'''").length - 1;
                if (occurrences < 2) inTriple = marker;
            }

            const isCommentLine =
                trimmed.startsWith('//') ||
                trimmed.startsWith('#') ||
                trimmed.startsWith('/*') ||
                trimmed.startsWith('*') ||
                insideTriple ||
                trimmed.startsWith('"""') ||
                trimmed.startsWith("'''");
            if (!isCommentLine) continue;

            const body = this.commentBody(trimmed);
            const isDirective = directiveRe.test(body);

            if (level !== 'basic' && line.length > MAX_COMMENT_WIDTH && !isDirective) {
                const desc = CommentMessages.COMMENT_WIDTH(line.length, MAX_COMMENT_WIDTH);
                issues.push(
                    this.mkIssue(
                        ctx,
                        i,
                        'CMT-WID-001',
                        desc.message,
                        SEVERITY_WARNING,
                        { file, width: line.length, limit: MAX_COMMENT_WIDTH },
                        desc.suggestion,
                    ),
                );
            }

            if (level !== 'basic' && !BARE_SEPARATOR_RE.test(body)) {
                if (SHORT_SEPARATOR_RE.test(body)) shortLines.push(lineNo);
                else if (LONG_SEPARATOR_RE.test(body)) longLines.push(lineNo);
            }

            if (level !== 'basic' && lineCount < BANNER_LINE_LIMIT && body.startsWith('═')) {
                const desc = CommentMessages.BANNER_SMALL_FILE(lineCount, BANNER_LINE_LIMIT);
                issues.push(
                    this.mkIssue(
                        ctx,
                        i,
                        'CMT-BAN-001',
                        desc.message,
                        SEVERITY_WARNING,
                        { file, lineCount, limit: BANNER_LINE_LIMIT },
                        desc.suggestion,
                    ),
                );
            }
        }

        if (shortLines.length > 0 && longLines.length > 0) {
            const desc = CommentMessages.MIXED_SEPARATORS(shortLines.length, longLines.length);
            const first = Math.min(shortLines[0], longLines[0]);
            issues.push(
                this.mkIssue(
                    ctx,
                    first - 1,
                    'CMT-SEP-001',
                    desc.message,
                    SEVERITY_WARNING,
                    { file, short: shortLines.length, long: longLines.length },
                    desc.suggestion,
                ),
            );
        }
    }

    /**
     * Strip a leading comment marker from a trimmed line and return the annotation body.
     *
     * @param trimmed - Line content with surrounding whitespace removed.
     * @returns The text that follows the comment marker (`//`, `#`, `/*`, `*`), or the input
     *     unchanged when no marker is present (e.g. Python docstring bodies).
     */
    private commentBody(trimmed: string): string {
        for (const marker of ['//', '/*', '*/', '#', '*']) {
            if (trimmed.startsWith(marker)) return trimmed.slice(marker.length).trim();
        }
        return trimmed;
    }

    private auditFileHeader(
        content: string,
        len: number,
        file: string,
        level: CommentLevel,
        opts: CommentOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        let headerLinesCount = 0;
        let headerCursor = 0;
        let hasAnyHeaderComment = false;

        while (headerCursor < len && headerLinesCount < HEADER_SCAN_LINES) {
            const nextNl = content.indexOf('\n', headerCursor);
            const lineEnd = nextNl === -1 ? len : nextNl;
            let line = content.slice(headerCursor, lineEnd);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            // Skip shebang lines: '#!/usr/bin/env' is NOT a doc comment
            if (!trimmed.startsWith('#!')) {
                if (/^\s*(\/\/|\/\*|\*|#|##|""")/.test(trimmed)) {
                    hasAnyHeaderComment = true;
                }
            }

            headerLinesCount++;
            if (nextNl === -1) {
                headerCursor = len;
                break;
            }
            headerCursor = nextNl + 1;
        }
        const headerText = content.slice(0, headerCursor);

        if (!hasAnyHeaderComment) {
            const desc = CommentMessages.MISSING_FILE_HEADER(file);
            issues.push(
                this.mkIssue(
                    ctx,
                    0,
                    'CMT-HDR-001',
                    desc.message,
                    level === COMMENT_LEVEL_STRICT ? SEVERITY_WARNING : SEVERITY_INFO,
                    { file, level },
                    desc.suggestion,
                ),
            );
        } else if (level === COMMENT_LEVEL_STRICT || opts.strictSixFields) {
            // Check 6-field header contract (bilingual support)
            for (let i = 0; i < SIX_FIELD_HEADERS_EN.length; i++) {
                const enMarker = SIX_FIELD_HEADERS_EN[i];
                const zhMarker = SIX_FIELD_HEADERS_ZH[i];
                if (!headerText.includes(enMarker) && !headerText.includes(zhMarker)) {
                    const desc = CommentMessages.MISSING_HEADER_FIELD(`${enMarker} / ${zhMarker}`);
                    issues.push(
                        this.mkIssue(
                            ctx,
                            0,
                            'CMT-HDR-002',
                            desc.message,
                            SEVERITY_WARNING,
                            { file, missingField: `${enMarker} (${zhMarker})` },
                            desc.suggestion,
                        ),
                    );
                }
            }

            // Check declared path alignment (bilingual support)
            const pathMatch = headerText.match(/(?:文件路径|File Path):\s*([^\r\n]+)/i);
            if (pathMatch) {
                const declaredPath = pathMatch[1].trim().replace(/\\/g, '/');
                if (!file.endsWith(declaredPath) && !declaredPath.endsWith(file)) {
                    const desc = CommentMessages.HEADER_PATH_MISMATCH(declaredPath, file);
                    issues.push(
                        this.mkIssue(
                            ctx,
                            0,
                            'CMT-HDR-003',
                            desc.message,
                            SEVERITY_ERROR,
                            { declaredPath, physicalPath: file },
                            desc.suggestion,
                        ),
                    );
                }
            }
        }
    }

    private auditPublicApi(
        content: string,
        len: number,
        file: string,
        level: CommentLevel,
        opts: CommentOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        let cursor = 0;
        let lineIdx = 0;
        const recentCommentLines: Array<{ line: number; text: string }> = [];
        let hadBlankLineSinceComment = false;

        while (cursor < len) {
            const nextNl = content.indexOf('\n', cursor);
            const lineEnd = nextNl === -1 ? len : nextNl;
            let line = content.slice(cursor, lineEnd);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            // Track comments vs blank lines
            if (trimmed === '') {
                hadBlankLineSinceComment = true;
            } else if (trimmed.startsWith('@')) {
                // Decorators: pass through, do not clear comments
            } else if (/^\s*(\/\/|\/\*|\*|#|##|""")/.test(trimmed) && !trimmed.startsWith('#!')) {
                if (hadBlankLineSinceComment) {
                    recentCommentLines.length = 0;
                    hadBlankLineSinceComment = false;
                }
                recentCommentLines.push({ line: lineIdx, text: trimmed });
                if (recentCommentLines.length > MAX_RECENT_COMMENT_LINES)
                    recentCommentLines.shift();
            } else {
                // Code line: test for public / exported declaration
                const match = trimmed.match(EXPORT_RE);
                if (match) {
                    const symbol = match[1];
                    const isPrivate = symbol.startsWith('_');

                    if (!isPrivate) {
                        let foundDoc = false;
                        let docText = '';
                        let commentLine = lineIdx;

                        // Check preceding comments (if not separated by empty line)
                        if (!hadBlankLineSinceComment && recentCommentLines.length > 0) {
                            foundDoc = true;
                            commentLine = recentCommentLines[0].line;
                            docText = recentCommentLines.map((c) => c.text).join('\n');
                        }

                        // If not found above, check for Python/GDScript
                        // docstring directly inside body
                        if (
                            !foundDoc &&
                            (file.endsWith('.py') || file.endsWith('.gd')) &&
                            nextNl !== -1
                        ) {
                            let bodyPos = nextNl + 1;
                            let scanLines = 0;
                            while (bodyPos < len && scanLines < MAX_DOCSTRING_SCAN_LINES) {
                                const nextNl2 = content.indexOf('\n', bodyPos);
                                const rawLine = content
                                    .slice(bodyPos, nextNl2 === -1 ? len : nextNl2)
                                    .trim();
                                if (rawLine === '') {
                                    bodyPos = nextNl2 === -1 ? len : nextNl2 + 1;
                                    scanLines++;
                                    continue;
                                }
                                if (
                                    rawLine.startsWith('"""') ||
                                    rawLine.startsWith("'''") ||
                                    rawLine.startsWith('##')
                                ) {
                                    foundDoc = true;
                                    docText = rawLine;
                                    commentLine = lineIdx + 1 + scanLines;
                                }
                                break;
                            }
                        }

                        if (!foundDoc) {
                            const desc = CommentMessages.MISSING_PUBLIC_DOC(symbol);
                            issues.push(
                                this.mkIssue(
                                    ctx,
                                    lineIdx,
                                    'CMT-DOC-001',
                                    desc.message,
                                    level === COMMENT_LEVEL_STRICT
                                        ? SEVERITY_WARNING
                                        : SEVERITY_INFO,
                                    { symbol, line: lineIdx + 1 },
                                    desc.suggestion,
                                ),
                            );
                        } else {
                            // Quality checks on found comments in standard / strict modes
                            if (level === 'standard' || level === COMMENT_LEVEL_STRICT) {
                                const cleanDoc = docText
                                    .replace(/[\/*#"]/g, '')
                                    .trim()
                                    .toLowerCase();
                                if (cleanDoc === symbol.toLowerCase()) {
                                    const desc = CommentMessages.TRIVIAL_COMMENT(symbol);
                                    issues.push(
                                        this.mkIssue(
                                            ctx,
                                            commentLine,
                                            'CMT-DOC-002',
                                            desc.message,
                                            SEVERITY_WARNING,
                                            { symbol },
                                            desc.suggestion,
                                        ),
                                    );
                                }

                                // Strict mode: concurrency & thread-safety audit for
                                // async/worker methods
                                if (level === COMMENT_LEVEL_STRICT) {
                                    const isAsync =
                                        !TYPE_ONLY_DECLARATION_RE.test(trimmed) &&
                                        ASYNC_DECLARATION_RE.test(trimmed);
                                    if (
                                        isAsync &&
                                        !/(并发|thread|async|await|reentrant|idempotent|锁|race|单线程|lock|mutex|atomic|sync)/i.test(
                                            docText,
                                        )
                                    ) {
                                        const desc =
                                            CommentMessages.MISSING_CONCURRENCY_NOTE(symbol);
                                        issues.push(
                                            this.mkIssue(
                                                ctx,
                                                lineIdx,
                                                'CMT-CON-001',
                                                desc.message,
                                                SEVERITY_INFO,
                                                { symbol },
                                                desc.suggestion,
                                            ),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // Reset comment tracking after processing non-comment code
                recentCommentLines.length = 0;
                hadBlankLineSinceComment = false;
            }

            lineIdx++;
            if (nextNl === -1) break;
            cursor = nextNl + 1;
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as any, ctx);
    }

    private mkIssue(
        ctx: AnalyzerContext,
        lineIdx: number,
        rule: string,
        message: string,
        severity: typeof SEVERITY_INFO | typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
        detail: Record<string, any>,
        suggestion?: string,
        evidence?: IssueEvidence,
    ): Issue {
        const line = lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
            suggestion,
            ...(evidence ? { evidence } : {}),
        };
    }
}
