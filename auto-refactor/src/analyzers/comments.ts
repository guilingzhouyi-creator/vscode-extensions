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
import { SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { CommentMessages, SIX_FIELD_HEADERS_EN, SIX_FIELD_HEADERS_ZH } from '../core/messages';
import {
    auditCommentLanguage,
    auditCommentDensity,
    auditCommentSemanticDuty,
} from '../core/comments/comment-auditor';
import type { CommentLanguageKind } from '../core/comments/comment-types';

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
    /** Whether project-level comment language consistency governance is enabled. */
    enableLanguageGovernance?: boolean;
    /** Target dominant language policy ('en' | 'zh-CN' | 'bilingual'). */
    targetDominantLanguage?: CommentLanguageKind;
    /** Whether effective comment density and water-logging checks are enabled. */
    enableDensityGovernance?: boolean;
    /** Whether semantic contract duty verification against code AST is enabled. */
    enableSemanticDutyCheck?: boolean;
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

    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
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

        const shouldAuditLanguage =
            opts.enableLanguageGovernance ?? (level === 'standard' || level === 'strict');
        const shouldAuditDensity =
            opts.enableDensityGovernance ?? (level === 'standard' || level === 'strict');
        const shouldAuditSemanticDuty = opts.enableSemanticDutyCheck ?? level === 'strict';

        if (shouldAuditLanguage) {
            auditCommentLanguage(content, opts, ctx, issues, (c, l, r, m, s, d, sug) =>
                this.mkIssue(c, l, r, m, s, d || {}, sug),
            );
        }
        if (shouldAuditDensity) {
            auditCommentDensity(content, ctx, issues, (c, l, r, m, s, d, sug) =>
                this.mkIssue(c, l, r, m, s, d || {}, sug),
            );
        }
        if (shouldAuditSemanticDuty) {
            auditCommentSemanticDuty(content, ctx, issues, (c, l, r, m, s, d, sug) =>
                this.mkIssue(c, l, r, m, s, d || {}, sug),
            );
        }

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
            const trimmed = line.trim();

            this.checkMojibake(line, i, file, ctx, issues);

            const tripleResult = this.updateTripleQuoteState(trimmed, line, inTriple);
            inTriple = tripleResult.inTriple;

            if (!this.isCommentLine(trimmed, tripleResult.insideTriple)) {
                continue;
            }

            this.auditCommentLine(
                line,
                trimmed,
                i,
                lineCount,
                file,
                level,
                directiveRe,
                ctx,
                issues,
                shortLines,
                longLines,
            );
        }

        this.auditSeparators(shortLines, longLines, file, ctx, issues);
    }

    private checkMojibake(
        line: string,
        lineIdx: number,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!MOJIBAKE_RE.test(line)) return;
        const desc = CommentMessages.MOJIBAKE(file);
        issues.push(
            this.mkIssue(
                ctx,
                lineIdx,
                'CMT-MOJI-001',
                desc.message,
                SEVERITY_ERROR,
                { file },
                desc.suggestion,
            ),
        );
    }

    private updateTripleQuoteState(
        trimmed: string,
        line: string,
        inTriple: typeof DOUBLE_QUOTE | typeof SINGLE_QUOTE | null,
    ): { inTriple: typeof DOUBLE_QUOTE | typeof SINGLE_QUOTE | null; insideTriple: boolean } {
        if (inTriple) {
            const closers =
                inTriple === DOUBLE_QUOTE
                    ? line.split('"""').length - 1
                    : line.split("'''").length - 1;
            return { inTriple: closers > 0 ? null : inTriple, insideTriple: true };
        }
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            const marker = trimmed.startsWith('"""') ? DOUBLE_QUOTE : SINGLE_QUOTE;
            const occurrences =
                marker === DOUBLE_QUOTE
                    ? line.split('"""').length - 1
                    : line.split("'''").length - 1;
            return { inTriple: occurrences < 2 ? marker : null, insideTriple: false };
        }
        return { inTriple: null, insideTriple: false };
    }

    private isCommentLine(trimmed: string, insideTriple: boolean): boolean {
        return (
            insideTriple ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('"""') ||
            trimmed.startsWith("'''")
        );
    }

    private auditCommentLine(
        line: string,
        trimmed: string,
        lineIdx: number,
        lineCount: number,
        file: string,
        level: CommentLevel,
        directiveRe: RegExp,
        ctx: AnalyzerContext,
        issues: Issue[],
        shortLines: number[],
        longLines: number[],
    ): void {
        const body = this.commentBody(trimmed);
        const lineNo = lineIdx + 1;

        if (level === 'basic') return;

        if (line.length > MAX_COMMENT_WIDTH && !directiveRe.test(body)) {
            const desc = CommentMessages.COMMENT_WIDTH(line.length, MAX_COMMENT_WIDTH);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'CMT-WID-001',
                    desc.message,
                    SEVERITY_WARNING,
                    { file, width: line.length, limit: MAX_COMMENT_WIDTH },
                    desc.suggestion,
                ),
            );
        }

        if (!BARE_SEPARATOR_RE.test(body)) {
            if (SHORT_SEPARATOR_RE.test(body)) shortLines.push(lineNo);
            else if (LONG_SEPARATOR_RE.test(body)) longLines.push(lineNo);
        }

        if (lineCount < BANNER_LINE_LIMIT && body.startsWith('═')) {
            const desc = CommentMessages.BANNER_SMALL_FILE(lineCount, BANNER_LINE_LIMIT);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'CMT-BAN-001',
                    desc.message,
                    SEVERITY_WARNING,
                    { file, lineCount, limit: BANNER_LINE_LIMIT },
                    desc.suggestion,
                ),
            );
        }
    }

    private auditSeparators(
        shortLines: number[],
        longLines: number[],
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (shortLines.length === 0 || longLines.length === 0) return;
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
        const { headerText, hasAnyHeaderComment } = this.extractHeaderText(content, len);

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
            return;
        }

        if (level === COMMENT_LEVEL_STRICT || opts.strictSixFields) {
            this.auditSixFields(headerText, file, ctx, issues);
            this.auditDeclaredPath(headerText, file, ctx, issues);
        }
    }

    private extractHeaderText(
        content: string,
        len: number,
    ): { headerText: string; hasAnyHeaderComment: boolean } {
        let headerLinesCount = 0;
        let headerCursor = 0;
        let hasAnyHeaderComment = false;

        while (headerCursor < len && headerLinesCount < HEADER_SCAN_LINES) {
            const nextNl = content.indexOf('\n', headerCursor);
            const lineEnd = nextNl === -1 ? len : nextNl;
            let line = content.slice(headerCursor, lineEnd);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            if (!trimmed.startsWith('#!') && /^\s*(\/\/|\/\*|\*|#|##|""")/.test(trimmed)) {
                hasAnyHeaderComment = true;
            }

            headerLinesCount++;
            if (nextNl === -1) {
                headerCursor = len;
                break;
            }
            headerCursor = nextNl + 1;
        }

        return { headerText: content.slice(0, headerCursor), hasAnyHeaderComment };
    }

    private auditSixFields(
        headerText: string,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        for (let i = 0; i < SIX_FIELD_HEADERS_EN.length; i++) {
            const enMarker = SIX_FIELD_HEADERS_EN[i];
            const zhMarker = SIX_FIELD_HEADERS_ZH[i];
            if (headerText.includes(enMarker) || headerText.includes(zhMarker)) continue;

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

    private auditDeclaredPath(
        headerText: string,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const pathMatch = headerText.match(/(?:文件路径|File Path):\s*([^\r\n]+)/i);
        if (!pathMatch) return;

        const declaredPath = pathMatch[1].trim().replace(/\\/g, '/');
        if (file.endsWith(declaredPath) || declaredPath.endsWith(file)) return;

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
        const state = { hadBlankLineSinceComment: false };
        let inTemplateLiteral = false;

        while (cursor < len) {
            const nextNl = content.indexOf('\n', cursor);
            const lineEnd = nextNl === -1 ? len : nextNl;
            let line = content.slice(cursor, lineEnd);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            const isCode = this.collectRecentComments(trimmed, lineIdx, recentCommentLines, state);

            const backticks = (line.match(/(?<!\\)`/g) || []).length;
            const wasInTemplate = inTemplateLiteral;
            if (backticks % 2 === 1) {
                inTemplateLiteral = !inTemplateLiteral;
            }

            if (isCode && !wasInTemplate) {
                this.processCodeLineForPublicApi(
                    content,
                    len,
                    file,
                    nextNl,
                    trimmed,
                    lineIdx,
                    level,
                    ctx,
                    issues,
                    recentCommentLines,
                    state.hadBlankLineSinceComment,
                );
                recentCommentLines.length = 0;
                state.hadBlankLineSinceComment = false;
            }

            lineIdx++;
            if (nextNl === -1) break;
            cursor = nextNl + 1;
        }
    }

    private collectRecentComments(
        trimmed: string,
        lineIdx: number,
        recentCommentLines: Array<{ line: number; text: string }>,
        state: { hadBlankLineSinceComment: boolean },
    ): boolean {
        if (trimmed === '') {
            state.hadBlankLineSinceComment = true;
            return false;
        }
        if (trimmed.startsWith('@')) {
            return false;
        }
        if (/^\s*(\/\/|\/\*|\*|#|##|""")/.test(trimmed) && !trimmed.startsWith('#!')) {
            if (state.hadBlankLineSinceComment) {
                recentCommentLines.length = 0;
                state.hadBlankLineSinceComment = false;
            }
            recentCommentLines.push({ line: lineIdx, text: trimmed });
            if (recentCommentLines.length > MAX_RECENT_COMMENT_LINES) {
                recentCommentLines.shift();
            }
            return false;
        }
        return true;
    }

    private processCodeLineForPublicApi(
        content: string,
        len: number,
        file: string,
        nextNl: number,
        trimmed: string,
        lineIdx: number,
        level: CommentLevel,
        ctx: AnalyzerContext,
        issues: Issue[],
        recentCommentLines: Array<{ line: number; text: string }>,
        hadBlankLineSinceComment: boolean,
    ): void {
        const match = trimmed.match(EXPORT_RE);
        if (!match) return;

        const symbol = match[1];
        if (symbol.startsWith('_')) return;

        const docInfo = this.resolveSymbolDoc(
            content,
            len,
            file,
            nextNl,
            lineIdx,
            recentCommentLines,
            hadBlankLineSinceComment,
        );

        if (!docInfo.foundDoc) {
            this.emitMissingDoc(symbol, lineIdx, level, ctx, issues);
            return;
        }

        this.auditDocQuality(symbol, docInfo, trimmed, lineIdx, level, ctx, issues);
    }

    private resolveSymbolDoc(
        content: string,
        len: number,
        file: string,
        nextNl: number,
        lineIdx: number,
        recentCommentLines: Array<{ line: number; text: string }>,
        hadBlankLineSinceComment: boolean,
    ): { foundDoc: boolean; docText: string; commentLine: number } {
        if (!hadBlankLineSinceComment && recentCommentLines.length > 0) {
            return {
                foundDoc: true,
                commentLine: recentCommentLines[0].line,
                docText: recentCommentLines.map((c) => c.text).join('\n'),
            };
        }

        if ((file.endsWith('.py') || file.endsWith('.gd')) && nextNl !== -1) {
            return this.scanInlineDocstring(content, len, nextNl + 1, lineIdx);
        }

        return { foundDoc: false, docText: '', commentLine: lineIdx };
    }

    private scanInlineDocstring(
        content: string,
        len: number,
        startPos: number,
        lineIdx: number,
    ): { foundDoc: boolean; docText: string; commentLine: number } {
        let bodyPos = startPos;
        let scanLines = 0;
        while (bodyPos < len && scanLines < MAX_DOCSTRING_SCAN_LINES) {
            const nextNl2 = content.indexOf('\n', bodyPos);
            const rawLine = content.slice(bodyPos, nextNl2 === -1 ? len : nextNl2).trim();
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
                return {
                    foundDoc: true,
                    docText: rawLine,
                    commentLine: lineIdx + 1 + scanLines,
                };
            }
            break;
        }
        return { foundDoc: false, docText: '', commentLine: lineIdx };
    }

    private emitMissingDoc(
        symbol: string,
        lineIdx: number,
        level: CommentLevel,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const desc = CommentMessages.MISSING_PUBLIC_DOC(symbol);
        issues.push(
            this.mkIssue(
                ctx,
                lineIdx,
                'CMT-DOC-001',
                desc.message,
                level === COMMENT_LEVEL_STRICT ? SEVERITY_WARNING : SEVERITY_INFO,
                { symbol, line: lineIdx + 1 },
                desc.suggestion,
            ),
        );
    }

    private auditDocQuality(
        symbol: string,
        docInfo: { docText: string; commentLine: number },
        trimmed: string,
        lineIdx: number,
        level: CommentLevel,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (level !== 'standard' && level !== COMMENT_LEVEL_STRICT) return;

        const cleanDoc = docInfo.docText
            .replace(/[\/*#"]/g, '')
            .trim()
            .toLowerCase();
        if (cleanDoc === symbol.toLowerCase()) {
            const desc = CommentMessages.TRIVIAL_COMMENT(symbol);
            issues.push(
                this.mkIssue(
                    ctx,
                    docInfo.commentLine,
                    'CMT-DOC-002',
                    desc.message,
                    SEVERITY_WARNING,
                    { symbol },
                    desc.suggestion,
                ),
            );
        }

        if (level === COMMENT_LEVEL_STRICT) {
            this.auditAsyncConcurrency(symbol, docInfo.docText, trimmed, lineIdx, ctx, issues);
        }
    }

    private auditAsyncConcurrency(
        symbol: string,
        docText: string,
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const isAsync =
            !TYPE_ONLY_DECLARATION_RE.test(trimmed) && ASYNC_DECLARATION_RE.test(trimmed);
        if (!isAsync) return;

        const hasConcurrency =
            /(并发|thread|async|await|reentrant|idempotent|锁|race|单线程|lock|mutex|atomic|sync)/i.test(
                docText,
            );
        if (!hasConcurrency) {
            const desc = CommentMessages.MISSING_CONCURRENCY_NOTE(symbol);
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

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
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
