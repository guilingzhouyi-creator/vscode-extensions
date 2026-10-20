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
import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    CommentLevel,
    IssueEvidence,
    Severity,
} from '../core/types';
import { CommentMessages, SIX_FIELD_HEADERS_EN, SIX_FIELD_HEADERS_ZH } from '../core/messages';
import {
    auditCommentLanguage,
    auditCommentDensity,
    auditCommentSemanticDuty,
    type IssueFactory,
} from '../core/comments/comment-auditor';
import {
    auditTerminologyProse,
    DEFAULT_RULES_FAST_CANDIDATE_RE,
} from '../core/governance/terminology-engine';
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
 * asynchronous routine. The keyword form requires `async` to be followed by an identifier,
 * a `(` or a `*`, so occurrences inside a literal, a property key (`{ async: true }`) or
 * prose cannot match.
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

const REGEX_ESCAPE_REPLACEMENT = '\\$&';

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
    const literals = tokens.map((token) =>
        token.replace(/[.*+?^${}()|[\]\\]/g, REGEX_ESCAPE_REPLACEMENT),
    );
    const generic = GENERIC_DIRECTIVE_RE.source.replace(/^\^/, '');
    return new RegExp(`^(?:${generic}|${literals.join('|')})`, 'i');
}
/** Bare rule of separator glyphs — decorative only, exempt from the consistency rule. */
const BARE_SEPARATOR_RE = /^[─═\-=]{3,}$/;
const SHORT_SEPARATOR_RE = /^─{2}(?!─)/;
const LONG_SEPARATOR_RE = /^─{3,}\s*[^\s─]/;
/** File-level banners are only tolerated in substantial modules. */
const BANNER_LINE_LIMIT = 150;

/** Canonical comment levels to eliminate repetitive string literals across scanner methods. */
const AUDIT_LEVEL = Object.freeze({
    OFF: 'off' as const,
    BASIC: 'basic' as const,
    STANDARD: 'standard' as const,
    STRICT: 'strict' as const,
});
const PREFIX_RES = 'res://';
const SEVERITY_INFO: Severity = 'info';
const SEVERITY_WARNING: Severity = 'warning';
const SEVERITY_ERROR: Severity = 'error';

/** Precompiled pattern of test and fixture path segments used for path exemption checks. */
const EXEMPT_TERMINOLOGY_PATH_RE =
    /\/(?:tests|test|fixtures)\/|scripts\/validate-|src\/core\/praxis\/presentation\/dictionaries\//;

/** Character codes for high-throughput zero-allocation char inspections. */
const CHAR_CODE_LF = 10;
const CHAR_CODE_CR = 13;
const CHAR_CODE_BACKTICK = 96; /* '`' */
const CHAR_CODE_BACKSLASH = 92; /* '\\' */

/** Double-quote character used to track a Python triple-quoted docstring block. */
const DOUBLE_QUOTE = '"';

/** Single-quote character used to track a Python triple-quoted docstring block. */
const SINGLE_QUOTE = "'";

/**
 * Frozen singleton of comment prefix markers to eliminate transient allocations in
 * extractCommentBody.
 */
const COMMENT_MARKERS: readonly string[] = Object.freeze(['//', '/*', '*/', '#', '*']);
const RUST_COMMENT_MARKERS: readonly string[] = Object.freeze(['//', '/*', '*/', '*']);
const URL_OR_INLINE_CODE_RE = /https?:\/\/\S+|`[^`]{20,}`/;
const HEADER_COMMENT_PREFIX_RE = /^\s*(\/\/|\/\*|\*|#|##|""")/;

const HEADER_DEPENDENCY_TRIGGER_ZH = '依赖与触发';
const HEADER_EXIT_DESIGN_ZH = '退出语义与设计依据';

const SIX_FIELD_ALIASES_ZH: Readonly<Record<string, readonly string[]>> = Object.freeze({
    [HEADER_DEPENDENCY_TRIGGER_ZH]: Object.freeze(['依赖与触发', '跨域依赖', '依赖和触发']),
    [HEADER_EXIT_DESIGN_ZH]: Object.freeze([
        '退出语义与设计依据',
        '设计依据',
        '退出语义与设计权衡',
        '退出语义与架构依据',
    ]),
});

const SIX_FIELD_PATTERNS: ReadonlyArray<{
    readonly en: string;
    readonly zh: string;
    readonly regex: RegExp;
}> = Object.freeze(
    SIX_FIELD_HEADERS_EN.map((headerEn, i) => {
        const headerZh = SIX_FIELD_HEADERS_ZH[i];
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, REGEX_ESCAPE_REPLACEMENT);
        const aliases = SIX_FIELD_ALIASES_ZH[headerZh] || [headerZh];
        const allZh = aliases.map(esc).join('|');
        return Object.freeze({
            en: headerEn,
            zh: headerZh,
            regex: new RegExp(`${esc(headerEn)}|${allZh}`),
        });
    }),
);

/**
 * State and context passed through comment audit routines.
 */
interface FileAuditState {
    file: string;
    level: CommentLevel;
    opts: CommentOptions;
    ctx: AnalyzerContext;
    issues: Issue[];
}

interface LineScanContext {
    line: string;
    trimmed: string;
    lineIdx: number;
    lineCount: number;
    directiveRe: RegExp;
    shortLines: number[];
    longLines: number[];
    shouldCheckTerminology: boolean;
}

interface PublicApiLineParams {
    lines: string[];
    trimmed: string;
    lineIdx: number;
    recentCommentLines: Array<{ line: number; text: string }>;
    hadBlankLineSinceComment: boolean;
}

interface SymbolDocInfo {
    foundDoc: boolean;
    docText: string;
    commentLine: number;
}

interface DocQualityParams {
    symbol: string;
    docInfo: SymbolDocInfo;
    trimmed: string;
    lineIdx: number;
}

interface IssueDescriptor {
    rule: string;
    message: string;
    severity: Severity;
    detail: Record<string, unknown>;
    suggestion?: string;
    evidence?: IssueEvidence;
}

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
function isExemptCommentTerminologyPath(filePath: string): boolean {
    return EXEMPT_TERMINOLOGY_PATH_RE.test(filePath.replace(/\\/g, '/'));
}

function shouldRunSubAudit(
    override: boolean | undefined,
    level: CommentLevel,
    strictOnly = false,
): boolean {
    if (override !== undefined) return override;
    if (strictOnly) return level === AUDIT_LEVEL.STRICT;
    return level === AUDIT_LEVEL.STANDARD || level === AUDIT_LEVEL.STRICT;
}

/**
 * Self-referential analyzer enforcing comment, header, and public API documentation contracts.
 */
export class CommentAnalyzer implements Analyzer {
    name = 'comments' as const;

    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as CommentOptions;
        const level: CommentLevel = opts.level || ctx.config.commentLevel || AUDIT_LEVEL.STANDARD;

        if (level === AUDIT_LEVEL.OFF) {
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

        const lines = content.split('\n');
        const state: FileAuditState = { file, level, opts, ctx, issues };

        this.auditFileHeader(content, len, state);
        this.auditPublicApi(lines, state);
        this.verifyCommentHygiene(lines, content, state);

        const issueFactory: IssueFactory = (...args) =>
            this.createIssue(args[0], args[1], {
                rule: args[2],
                message: args[3],
                severity: args[4],
                detail: args[5] || {},
                suggestion: args[6],
            });

        if (shouldRunSubAudit(opts.enableLanguageGovernance, level)) {
            auditCommentLanguage(content, opts, ctx, issues, issueFactory);
        }
        if (shouldRunSubAudit(opts.enableDensityGovernance, level)) {
            auditCommentDensity(content, ctx, issues, issueFactory);
        }
        if (shouldRunSubAudit(opts.enableSemanticDutyCheck, level, true)) {
            auditCommentSemanticDuty(content, ctx, issues, issueFactory);
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
     */
    private verifyCommentHygiene(lines: string[], content: string, state: FileAuditState): void {
        const lineCount = lines.length;
        const directiveRe = buildDirectiveRe(state.opts.directiveTokens);
        const shouldCheckTerminology =
            !isExemptCommentTerminologyPath(state.file) &&
            DEFAULT_RULES_FAST_CANDIDATE_RE.test(content);
        let inTriple: typeof DOUBLE_QUOTE | typeof SINGLE_QUOTE | null = null;
        const shortLines: number[] = [];
        const longLines: number[] = [];

        const isRust = state.file.endsWith('.rs');
        for (let i = 0; i < lineCount; i++) {
            let line = lines[i];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            this.checkMojibake(line, i, state);

            const tripleResult = this.updateTripleQuoteState(trimmed, line, inTriple);
            inTriple = tripleResult.inTriple;

            if (!this.isCommentLine(trimmed, tripleResult.insideTriple, isRust)) {
                continue;
            }

            const lineScanCtx: LineScanContext = {
                line,
                trimmed,
                lineIdx: i,
                lineCount,
                directiveRe,
                shortLines,
                longLines,
                shouldCheckTerminology,
            };

            this.scanCommentLine(lineScanCtx, state, isRust);
        }

        this.auditSeparators(shortLines, longLines, state);
    }

    private checkMojibake(line: string, lineIdx: number, state: FileAuditState): void {
        if (!MOJIBAKE_RE.test(line)) return;
        const desc = CommentMessages.MOJIBAKE(state.file);
        state.issues.push(
            this.createIssue(state.ctx, lineIdx, {
                rule: 'CMT-MOJI-001',
                message: desc.message,
                severity: SEVERITY_ERROR,
                detail: { file: state.file },
                suggestion: desc.suggestion,
            }),
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

    private isCommentLine(trimmed: string, insideTriple: boolean, isRust = false): boolean {
        if (trimmed.startsWith('#[') || trimmed.startsWith('#![')) {
            return false;
        }
        if (isRust && trimmed.startsWith('#')) {
            return false;
        }
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

    private scanCommentLine(lineCtx: LineScanContext, state: FileAuditState, isRust: boolean): void {
        if (state.level === AUDIT_LEVEL.BASIC) return;
        const body = this.extractCommentBody(lineCtx.trimmed, isRust);
        this.checkCommentWidth(lineCtx, body, state);
        this.recordSeparatorLine(body, lineCtx.lineIdx + 1, lineCtx.shortLines, lineCtx.longLines);
        this.auditBannerSmallFile(lineCtx, body, state);
        if (lineCtx.shouldCheckTerminology) {
            this.checkProseTerminology(body, lineCtx.lineIdx, state);
        }
    }

    private checkCommentWidth(lineCtx: LineScanContext, body: string, state: FileAuditState): void {
        const isExempt =
            lineCtx.line.length <= MAX_COMMENT_WIDTH ||
            lineCtx.directiveRe.test(body) ||
            URL_OR_INLINE_CODE_RE.test(body);
        if (isExempt) {
            return;
        }
        const desc = CommentMessages.COMMENT_WIDTH(lineCtx.line.length, MAX_COMMENT_WIDTH);
        state.issues.push(
            this.createIssue(state.ctx, lineCtx.lineIdx, {
                rule: 'CMT-WID-001',
                message: desc.message,
                severity: SEVERITY_WARNING,
                detail: { file: state.file, width: lineCtx.line.length, limit: MAX_COMMENT_WIDTH },
                suggestion: desc.suggestion,
            }),
        );
    }

    private recordSeparatorLine(
        body: string,
        lineNo: number,
        shortLines: number[],
        longLines: number[],
    ): void {
        if (BARE_SEPARATOR_RE.test(body)) return;
        if (SHORT_SEPARATOR_RE.test(body)) shortLines.push(lineNo);
        else if (LONG_SEPARATOR_RE.test(body)) longLines.push(lineNo);
    }

    private auditBannerSmallFile(
        lineCtx: LineScanContext,
        body: string,
        state: FileAuditState,
    ): void {
        if (lineCtx.lineCount >= BANNER_LINE_LIMIT || !body.startsWith('═')) return;
        const desc = CommentMessages.BANNER_SMALL_FILE(lineCtx.lineCount, BANNER_LINE_LIMIT);
        state.issues.push(
            this.createIssue(state.ctx, lineCtx.lineIdx, {
                rule: 'CMT-BAN-001',
                message: desc.message,
                severity: SEVERITY_WARNING,
                detail: {
                    file: state.file,
                    lineCount: lineCtx.lineCount,
                    limit: BANNER_LINE_LIMIT,
                },
                suggestion: desc.suggestion,
            }),
        );
    }

    private checkProseTerminology(body: string, lineIdx: number, state: FileAuditState): void {
        if (
            isExemptCommentTerminologyPath(state.file) ||
            !DEFAULT_RULES_FAST_CANDIDATE_RE.test(body)
        ) {
            return;
        }
        for (const finding of auditTerminologyProse(body)) {
            const desc = CommentMessages.BANNED_TERMINOLOGY(finding.term, finding.message);
            state.issues.push(
                this.createIssue(state.ctx, lineIdx, {
                    rule: 'CMT-TRM-001',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: {
                        file: state.file,
                        term: finding.term,
                        category: finding.category,
                        line: lineIdx + 1,
                    },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    private auditSeparators(
        shortLines: number[],
        longLines: number[],
        state: FileAuditState,
    ): void {
        if (shortLines.length === 0 || longLines.length === 0) return;
        const desc = CommentMessages.MIXED_SEPARATORS(shortLines.length, longLines.length);
        const first = Math.min(shortLines[0], longLines[0]);
        state.issues.push(
            this.createIssue(state.ctx, first - 1, {
                rule: 'CMT-SEP-001',
                message: desc.message,
                severity: SEVERITY_WARNING,
                detail: { file: state.file, short: shortLines.length, long: longLines.length },
                suggestion: desc.suggestion,
            }),
        );
    }

    /**
     * Strip a leading comment marker from a trimmed line and return the annotation body.
     *
     * @param trimmed - Line content with surrounding whitespace removed.
     * @returns The text that follows the comment marker (`//`, `#`, `/*`, `*`), or the input
     *     unchanged when no marker is present (e.g. Python docstring bodies).
     */
    private extractCommentBody(trimmed: string, isRust = false): string {
        const markers = isRust ? RUST_COMMENT_MARKERS : COMMENT_MARKERS;
        for (const marker of markers) {
            if (trimmed.startsWith(marker)) return trimmed.slice(marker.length).trim();
        }
        return trimmed;
    }

    private auditFileHeader(content: string, len: number, state: FileAuditState): void {
        const isRust = state.file.endsWith('.rs');
        const { headerText, hasAnyHeaderComment, headerStartLine, firstCodeLine } =
            this.extractHeaderText(content, len, isRust);

        if (!hasAnyHeaderComment) {
            const desc = CommentMessages.MISSING_FILE_HEADER(state.file);
            state.issues.push(
                this.createIssue(state.ctx, 0, {
                    rule: 'CMT-HDR-001',
                    message: desc.message,
                    severity: state.level === AUDIT_LEVEL.STRICT ? SEVERITY_WARNING : SEVERITY_INFO,
                    detail: { file: state.file, level: state.level },
                    suggestion: desc.suggestion,
                }),
            );
            return;
        }

        if (firstCodeLine > 0 && headerStartLine > firstCodeLine) {
            const desc = CommentMessages.INVERTED_FILE_HEADER(firstCodeLine, headerStartLine);
            state.issues.push(
                this.createIssue(state.ctx, headerStartLine - 1, {
                    rule: 'CMT-HDR-004',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: { file: state.file, firstCodeLine, headerStartLine },
                    suggestion: desc.suggestion,
                }),
            );
        }

        if (state.level === AUDIT_LEVEL.STRICT || state.opts.strictSixFields) {
            this.auditSixFields(headerText, state);
            this.auditDeclaredPath(headerText, state);
        }
    }

    private extractHeaderText(
        content: string,
        len: number,
        isRust = false,
    ): {
        headerText: string;
        hasAnyHeaderComment: boolean;
        headerStartLine: number;
        firstCodeLine: number;
    } {
        let headerLinesCount = 0;
        let lineStart = 0;
        let headerCursor = 0;
        let hasAnyHeaderComment = false;
        let headerStartLine = 0;
        let firstCodeLine = 0;

        const inspectLine = (start: number, end: number, lineNo: number): void => {
            const lineEnd = this.trimCarriageReturn(content, start, end);
            const trimmed = content.slice(start, lineEnd).trim();
            if (
                !trimmed ||
                trimmed.startsWith('#!') ||
                (isRust && trimmed.startsWith('#')) ||
                /^#\s*-\*-\s*coding/i.test(trimmed)
            ) {
                return;
            }
            if (this.isHeaderCommentLine(trimmed, isRust)) {
                if (headerStartLine === 0) headerStartLine = lineNo;
                hasAnyHeaderComment = true;
            } else if (firstCodeLine === 0 && headerStartLine === 0) {
                firstCodeLine = lineNo;
            }
        };

        for (let i = 0; i < len && headerLinesCount < HEADER_SCAN_LINES; i++) {
            if (content.charCodeAt(i) === CHAR_CODE_LF) {
                inspectLine(lineStart, i, headerLinesCount + 1);
                headerLinesCount++;
                headerCursor = i + 1;
                lineStart = i + 1;
            }
        }

        if (headerLinesCount < HEADER_SCAN_LINES && lineStart < len) {
            inspectLine(lineStart, len, headerLinesCount + 1);
            headerCursor = len;
        }

        return {
            headerText: content.slice(0, headerCursor),
            hasAnyHeaderComment,
            headerStartLine,
            firstCodeLine,
        };
    }

    private trimCarriageReturn(content: string, start: number, end: number): number {
        if (end > start && content.charCodeAt(end - 1) === CHAR_CODE_CR) {
            return end - 1;
        }
        return end;
    }

    private checkHeaderSlice(content: string, start: number, end: number, isRust = false): boolean {
        const lineEnd = this.trimCarriageReturn(content, start, end);
        return this.isHeaderCommentLine(content.slice(start, lineEnd).trim(), isRust);
    }

    private isHeaderCommentLine(trimmed: string, isRust = false): boolean {
        if (trimmed.startsWith('#!') || trimmed.startsWith('#[')) {
            return false;
        }
        if (isRust && trimmed.startsWith('#')) {
            return false;
        }
        return HEADER_COMMENT_PREFIX_RE.test(trimmed);
    }

    private auditSixFields(headerText: string, state: FileAuditState): void {
        for (let i = 0; i < SIX_FIELD_PATTERNS.length; i++) {
            const field = SIX_FIELD_PATTERNS[i];
            if (field.regex.test(headerText)) continue;
            const desc = CommentMessages.MISSING_HEADER_FIELD(`${field.en} / ${field.zh}`);
            state.issues.push(
                this.createIssue(state.ctx, 0, {
                    rule: 'CMT-HDR-002',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: { file: state.file, missingField: `${field.en} (${field.zh})` },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    private auditDeclaredPath(headerText: string, state: FileAuditState): void {
        const pathMatch = headerText.match(/(?:文件路径|File Path):\s*([^\r\n]+)/i);
        if (!pathMatch) return;

        const declaredPath = pathMatch[1].trim().replace(/\\/g, '/');
        const normalizedDeclared = declaredPath.startsWith(PREFIX_RES)
            ? declaredPath.slice(PREFIX_RES.length)
            : declaredPath;
        if (
            state.file.endsWith(declaredPath) ||
            declaredPath.endsWith(state.file) ||
            state.file.endsWith(normalizedDeclared) ||
            normalizedDeclared.endsWith(state.file)
        ) {
            return;
        }

        const desc = CommentMessages.HEADER_PATH_MISMATCH(declaredPath, state.file);
        state.issues.push(
            this.createIssue(state.ctx, 0, {
                rule: 'CMT-HDR-003',
                message: desc.message,
                severity: SEVERITY_ERROR,
                detail: { declaredPath, physicalPath: state.file },
                suggestion: desc.suggestion,
            }),
        );
    }

    private auditPublicApi(lines: string[], state: FileAuditState): void {
        const lineCount = lines.length;
        const recentCommentLines: Array<{ line: number; text: string }> = [];
        const lineState = { hadBlankLineSinceComment: false };
        let inTemplateLiteral = false;

        for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
            let line = lines[lineIdx];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            const isCode = this.collectRecentComments(
                trimmed,
                lineIdx,
                recentCommentLines,
                lineState,
            );

            const backticks = countUnescapedBackticks(line);
            const wasInTemplate = inTemplateLiteral;
            if (backticks % 2 === 1) {
                inTemplateLiteral = !inTemplateLiteral;
            }

            if (isCode && !wasInTemplate) {
                const params: PublicApiLineParams = {
                    lines,
                    trimmed,
                    lineIdx,
                    recentCommentLines,
                    hadBlankLineSinceComment: lineState.hadBlankLineSinceComment,
                };
                this.processPublicApiLine(params, state);
                recentCommentLines.length = 0;
                lineState.hadBlankLineSinceComment = false;
            }
        }
    }

    private collectRecentComments(
        trimmed: string,
        lineIdx: number,
        recentCommentLines: Array<{ line: number; text: string }>,
        lineState: { hadBlankLineSinceComment: boolean },
    ): boolean {
        if (trimmed === '') {
            lineState.hadBlankLineSinceComment = true;
            return false;
        }
        if (trimmed.startsWith('@')) {
            return false;
        }
        if (/^\s*(\/\/|\/\*|\*|#|##|""")/.test(trimmed) && !trimmed.startsWith('#!')) {
            if (lineState.hadBlankLineSinceComment) {
                recentCommentLines.length = 0;
                lineState.hadBlankLineSinceComment = false;
            }
            recentCommentLines.push({ line: lineIdx, text: trimmed });
            if (recentCommentLines.length > MAX_RECENT_COMMENT_LINES) {
                recentCommentLines.shift();
            }
            return false;
        }
        return true;
    }

    private processPublicApiLine(params: PublicApiLineParams, state: FileAuditState): void {
        const match = params.trimmed.match(EXPORT_RE);
        if (!match) return;

        const symbol = match[1];
        if (symbol.startsWith('_')) return;

        const docInfo = this.resolveSymbolDoc(params, state.file);

        if (!docInfo.foundDoc) {
            this.emitMissingDoc(symbol, params.lineIdx, state);
            return;
        }

        const qualityParams: DocQualityParams = {
            symbol,
            docInfo,
            trimmed: params.trimmed,
            lineIdx: params.lineIdx,
        };
        this.auditDocQuality(qualityParams, state);
    }

    private resolveSymbolDoc(params: PublicApiLineParams, file: string): SymbolDocInfo {
        if (!params.hadBlankLineSinceComment && params.recentCommentLines.length > 0) {
            return {
                foundDoc: true,
                commentLine: params.recentCommentLines[0].line,
                docText: params.recentCommentLines.map((c) => c.text).join('\n'),
            };
        }

        if (
            (file.endsWith('.py') || file.endsWith('.gd')) &&
            params.lineIdx + 1 < params.lines.length
        ) {
            return this.scanInlineDocstring(params.lines, params.lineIdx);
        }

        return { foundDoc: false, docText: '', commentLine: params.lineIdx };
    }

    private scanInlineDocstring(lines: string[], lineIdx: number): SymbolDocInfo {
        const total = lines.length;
        for (let scanLines = 0; scanLines < MAX_DOCSTRING_SCAN_LINES; scanLines++) {
            const targetIdx = lineIdx + 1 + scanLines;
            if (targetIdx >= total) break;
            const rawLine = lines[targetIdx].trim();
            if (rawLine === '') {
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
                    commentLine: targetIdx,
                };
            }
            break;
        }
        return { foundDoc: false, docText: '', commentLine: lineIdx };
    }

    private emitMissingDoc(symbol: string, lineIdx: number, state: FileAuditState): void {
        const desc = CommentMessages.MISSING_PUBLIC_DOC(symbol);
        state.issues.push(
            this.createIssue(state.ctx, lineIdx, {
                rule: 'CMT-DOC-001',
                message: desc.message,
                severity: state.level === AUDIT_LEVEL.STRICT ? SEVERITY_WARNING : SEVERITY_INFO,
                detail: { symbol, line: lineIdx + 1 },
                suggestion: desc.suggestion,
            }),
        );
    }

    private auditDocQuality(params: DocQualityParams, state: FileAuditState): void {
        if (state.level !== AUDIT_LEVEL.STANDARD && state.level !== AUDIT_LEVEL.STRICT) return;

        const cleanDoc = params.docInfo.docText
            .replace(/[\/*#"]/g, '')
            .trim()
            .toLowerCase();
        if (cleanDoc === params.symbol.toLowerCase()) {
            const desc = CommentMessages.TRIVIAL_COMMENT(params.symbol);
            state.issues.push(
                this.createIssue(state.ctx, params.docInfo.commentLine, {
                    rule: 'CMT-DOC-002',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: { symbol: params.symbol },
                    suggestion: desc.suggestion,
                }),
            );
        }

        if (state.level === AUDIT_LEVEL.STRICT) {
            this.auditAsyncConcurrency(params, state);
        }
    }

    private auditAsyncConcurrency(params: DocQualityParams, state: FileAuditState): void {
        const isAsync =
            !TYPE_ONLY_DECLARATION_RE.test(params.trimmed) &&
            ASYNC_DECLARATION_RE.test(params.trimmed);
        if (!isAsync) return;

        const hasConcurrency =
            /(并发|thread|async|await|reentrant|idempotent|锁|race|单线程|lock|mutex|atomic|sync)/i.test(
                params.docInfo.docText,
            );
        if (!hasConcurrency) {
            const desc = CommentMessages.MISSING_CONCURRENCY_NOTE(params.symbol);
            state.issues.push(
                this.createIssue(state.ctx, params.lineIdx, {
                    rule: 'CMT-CON-001',
                    message: desc.message,
                    severity: SEVERITY_INFO,
                    detail: { symbol: params.symbol },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    private createIssue(ctx: AnalyzerContext, lineIdx: number, descriptor: IssueDescriptor): Issue {
        const line = lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${descriptor.rule}:${file}:${line}`,
            analyzer: this.name,
            rule: descriptor.rule,
            severity: descriptor.severity,
            message: descriptor.message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail: descriptor.detail,
            suggestion: descriptor.suggestion,
            ...(descriptor.evidence ? { evidence: descriptor.evidence } : {}),
        };
    }
}

/**
 * Count unescaped backtick characters in a source line without heap allocation.
 *
 * @param line - Line text to inspect.
 * @returns Number of unescaped backtick characters found.
 */
function countUnescapedBackticks(line: string): number {
    let count = 0;
    const len = line.length;
    for (let i = 0; i < len; i++) {
        if (line.charCodeAt(i) === CHAR_CODE_BACKTICK) {
            if (i === 0 || line.charCodeAt(i - 1) !== CHAR_CODE_BACKSLASH) {
                count++;
            }
        }
    }
    return count;
}
