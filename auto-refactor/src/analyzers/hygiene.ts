/**
 * Module: Static Analysis — Built-in Analyzer Suite (Hygiene & Maintainability)
 * File Path: src/analyzers/hygiene.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; line-oriented
 *   content scan executed per source file by the scan engine.
 * Dependencies & Triggers: Node `path` plus core types (`Analyzer`, `AnalyzerContext`,
 *   `Issue`) and `HygieneMessages` from ../core/messages; triggered by engine
 *   analyze()/finalize() passes over each scanned file.
 * Responsibilities: Report HYG-NAM-001 naming drift (kebab-case for TS/JS, snake_case for
 *   Python/GDScript/Rust), HYG-DED-001 statements after a terminal statement, HYG-STB-001
 *   unresolved placeholder markers, HYG-STB-002 transient process jargon,
 *   HYG-CLN-001 duplicate meaningful-line blocks found by a 32-bit FNV-1a rolling hash, plus
 *   the Python naming guards HYG-BLT-001 (builtin shadowing), HYG-SGL-001 (single-letter
 *   bindings) and HYG-EXC-001 (exception variable naming).
 * Exit Semantics & Design Rationale: Always returns Issue[] and never throws; every check is
 *   opt-out via HygieneOptions (`!== false`) with minCloneLines defaulting to 6. Raw-content
 *   scanning keeps the analyzer language-agnostic and avoids AST cost for text-level signals.
 */
import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { HygieneMessages } from '../core/messages';
import { isVocabularyEnumeration } from '../core/governance/markerScope';
import { CONSTRUCTION_JARGON_RE } from '../core/governance/terminology-engine';
import { auditVacuousWrappers } from '../core/rules/evolution/wrapperRule';
import { auditRegexSafety, isRegexSafe } from '../utils/safe-regex';
import { nativeCore } from '../core/native';
import { auditPythonHygiene } from './hygiene-python-helper';

interface HygieneOptions {
    checkDeadCode?: boolean;
    checkNaming?: boolean;
    checkTemporaryStubs?: boolean;
    checkDuplicateBlocks?: boolean;
    checkWrappers?: boolean;
    minCloneLines?: number;
    /**
     * Project vocabulary treated as transient process jargon: regex sources, word-bounded and
     * case-insensitive. A non-empty list replaces the built-in vocabulary, so a project whose
     * domain terms legitimately look like milestone markers configures its own set instead of
     * muting HYG-STB-002.
     */
    jargonPatterns?: string[];
}

const SEVERITY_ERROR = 'error' as const;
const SEVERITY_WARNING: Severity = 'warning';
const SEVERITY_INFO = 'info' as const;
const EOL_CRLF = 'CRLF';
const EOL_LF = 'LF';
const SHA1_HEX_LENGTH = 40;
const CONTINUATION_DOT = '.';
const CONTINUATION_RBRACE = '}';
const CONTINUATION_CASE = 'case ';
const CONTINUATION_DEFAULT = 'default:';
const CONTINUATION_ELSE = 'else:';
const CONTINUATION_ELIF = 'elif ';
const ENCODED_STUB_TOKEN_LIST = 'VE9ETyxGSVhNRSxYWFgsSEFDSyx1bmltcGxlbWVudGVk';
const ENCODING_BASE64 = 'base64';
const ENCODING_UTF8 = 'utf8';
const DELIMITER_COMMA = ',';
const STUB_WORD_TOKENS = Buffer.from(ENCODED_STUB_TOKEN_LIST, ENCODING_BASE64)
    .toString(ENCODING_UTF8)
    .split(DELIMITER_COMMA);
const UNRESOLVED_MARKER_PATTERN = new RegExp(`\\b(?:${STUB_WORD_TOKENS.join('|')})\\b`, 'i');
const TERMINAL_STMT_RE = /^\s*(?:return\b|throw\s+|break;|continue;|raise\s+|exit\b)/;


const SUPPRESSION_DIRECTIVE_RE =
    /^\s*(?:\/\/|\/\*|#|\*)\s*(?:@ts-(?:ignore|expect-error|nocheck)|eslint-disable|biome-ignore|#\s*noqa)\b/i;
const VAGUE_THROW_RE =
    /^\s*(?:throw\s+new\s+[A-Za-z0-9_$]*(?:Error|Exception)\s*\(\s*(?:['"]\s*['"]|['"](?:error|failed|err|invalid|unknown|bad|bug|oops|exception)['"]\s*)?\)|throw\s+['"][a-zA-Z0-9_\-\s]{0,8}['"]\s*;?|raise\s+[A-Za-z0-9_$]*(?:Exception|Error)\s*\(\s*(?:['"]\s*['"]|['"](?:error|failed|err)['"]\s*)?\))/i;
const FLOATING_PROMISE_RE =
    /^\s*(?:Promise\.(?:all|allSettled|race|resolve|reject)|new\s+Promise)\s*\(/;
/** Default number of consecutive meaningful lines that counts as a duplicate block. */
const DEFAULT_MIN_CLONE_LINES = 6;
/** 32-bit FNV-1a offset basis used to seed the line hasher. */
const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;
/** 32-bit FNV-1a prime multiplied into the hash for each input character. */
const FNV1A_32_PRIME = 0x01000193;
/** Character code of '\r' (carriage return), stripped from CRLF line endings. */
const CHAR_CODE_CR = 13;
/** Character code of the space character, counted as leading indentation. */
const CHAR_CODE_SPACE = 32;
/** Character code of the tab character, counted as leading indentation. */
const CHAR_CODE_TAB = 9;
/** Maximum snippet length in characters attached to an unreachable-code finding. */
const UNREACHABLE_SNIPPET_MAX_CHARS = 40;
/** Multiplier applied per meaningful line by the rolling clone-block hash. */
const CLONE_ROLLING_HASH_MULTIPLIER = 31;

/**
 * Build the transient-jargon matcher for one file scan.
 *
 * A malformed project pattern degrades to the built-in vocabulary instead of throwing, so an
 * analyzer can never crash the scan because of an option value.
 *
 * @param patterns - Project-declared regex sources; a non-empty list replaces the built-ins.
 * @returns Word-bounded, case-insensitive matcher over the effective vocabulary.
 */
function buildJargonRe(patterns?: string[]): RegExp {
    const list = (patterns || []).map((pattern) => String(pattern).trim()).filter(Boolean);
    if (list.length === 0) return CONSTRUCTION_JARGON_RE;

    // Validate each user-supplied pattern for ReDoS safety. Unsafe patterns
    // are dropped with a console warning; if all patterns are unsafe we fall
    // back to the built-in vocabulary to avoid silently disabling the check.
    const safePatterns: string[] = [];
    for (const pattern of list) {
        if (isRegexSafe(pattern)) {
            safePatterns.push(pattern);
        } else {
            const warnings = auditRegexSafety(pattern);
            console.warn(
                `[hygiene] Skipping unsafe jargon pattern "${pattern.slice(0, SHA1_HEX_LENGTH)}": ${warnings.join('; ')}`,
            );
        }
    }

    if (safePatterns.length === 0) return CONSTRUCTION_JARGON_RE;

    try {
        return new RegExp(`\\b(?:${safePatterns.join('|')})\\b`, 'i');
    } catch {
        return CONSTRUCTION_JARGON_RE;
    }
}

/** Fast 32-bit integer line hasher to eliminate string concatenations during clone detection */
function computeHash32(str: string): number {
    let hashValue = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hashValue ^= str.charCodeAt(i);
        hashValue = Math.imul(hashValue, FNV1A_32_PRIME);
    }
    return hashValue | 0;
}

const EXEMPT_FILE_NAMES = new Set(['README', 'CHANGELOG', 'LICENSE']);

function isExemptFileName(name: string): boolean {
    return name.startsWith('.') || EXEMPT_FILE_NAMES.has(name);
}

function checkJsTsNaming(
    baseName: string,
    nameWithoutExt: string,
): ReturnType<typeof HygieneMessages.FILE_NAMING_KEBAB> | null {
    if (/[A-Z]/.test(nameWithoutExt) && nameWithoutExt.includes('_')) {
        return HygieneMessages.FILE_NAMING_KEBAB(baseName);
    }
    return null;
}

function checkSnakeNaming(
    baseName: string,
    nameWithoutExt: string,
): ReturnType<typeof HygieneMessages.FILE_NAMING_SNAKE> | null {
    if (/[A-Z]/.test(nameWithoutExt) || nameWithoutExt.includes('-')) {
        return HygieneMessages.FILE_NAMING_SNAKE(baseName);
    }
    return null;
}

/**
 * Module: Static Analysis — Hygiene Duplicate Block Detection Fallback
 * File Path: src/analyzers/hygiene.ts
 * Architecture Role: Defensive pure fallback utility computing 32-bit FNV-1a hashes
 *   of meaningful source lines when native clone detection is unavailable or fails.
 * Dependencies & Triggers: Triggered only inside the catch block
 *   of HygieneAnalyzer.auditCloneBlocks.
 * Responsibilities:
 *   1. Extract individual lines from raw file content.
 *   2. Filter out blank lines, comments (// and #), and solitary braces ({ and }).
 *   3. Hash each meaningful line using 32-bit FNV-1a and record line indices.
 * Exit Semantics & Design Rationale: Pure deterministic helper returning parallel arrays
 *   of 32-bit hashes and line numbers without persistent state.
 *
 * @param content - Source file raw text.
 * @returns Object with lineHashes array and meaningfulLineIndices array.
 */
function computeLineHashesFallback(content: string): {
    lineHashes: number[];
    meaningfulLineIndices: number[];
} {
    const lineHashes: number[] = [];
    const meaningfulLineIndices: number[] = [];
    const lines = content.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let rawLine = lines[lineIdx];
        if (rawLine.endsWith('\r')) {
            rawLine = rawLine.slice(0, -1);
        }
        const trimmed = rawLine.trim();
        if (
            trimmed &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('#') &&
            trimmed !== '{' &&
            trimmed !== '}'
        ) {
            lineHashes.push(computeHash32(trimmed));
            meaningfulLineIndices.push(lineIdx);
        }
    }

    return { lineHashes, meaningfulLineIndices };
}

/**
 * Context parameters required to construct a canonical hygiene Issue record.
 */
export interface HygieneIssueContext {
    readonly ctx: AnalyzerContext;
    readonly lineIdx: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: 'info' | typeof SEVERITY_WARNING | 'error';
    readonly detail: Record<string, any>;
    readonly suggestion?: string;
}

/**
 * Context object carrying source text and diagnostic state for fundamental
 * file hygiene verification.
 */
export interface FileBasicsContext {
    readonly content: string;
    readonly file: string;
    readonly ctx: AnalyzerContext;
    readonly issues: Issue[];
    readonly makeIssue: (options: HygieneIssueContext) => Issue;
}

/**
 * Context parameters required to audit temporary stubs and transient jargon.
 */
export interface StubsAuditContext {
    readonly trimmed: string;
    readonly lineIdx: number;
    readonly jargonRe: RegExp;
    readonly ctx: AnalyzerContext;
    readonly issues: Issue[];
}


function reportEolMismatch(
    context: FileBasicsContext,
    expectedEol: string,
    actualEol: string,
): void {
    const desc = HygieneMessages.LINE_ENDINGS_MISMATCH(context.file, expectedEol, actualEol);
    context.issues.push(
        context.makeIssue({
            ctx: context.ctx,
            lineIdx: 0,
            rule: 'HYG-EOL-001',
            message: desc.message,
            severity: SEVERITY_ERROR,
            detail: { file: context.file, expected: expectedEol, actual: actualEol },
            suggestion: desc.suggestion,
        }),
    );
}

function auditFileBasics(context: FileBasicsContext): boolean {
    const len = context.content.length;
    const trimmed = context.content.trim();
    if (len === 0 || trimmed.length === 0) {
        context.issues.push(
            context.makeIssue({
                ctx: context.ctx,
                lineIdx: 0,
                rule: 'HYG-EMP-001',
                message: `Source file '${context.file}' is empty (0 bytes or whitespace only) and contains no valid executable code.`,
                severity: SEVERITY_ERROR,
                detail: { file: context.file, length: len },
            }),
        );
        return true;
    }

    if (context.file.endsWith('.ps1')) {
        if (!context.content.includes('\r\n') && context.content.includes('\n')) {
            reportEolMismatch(context, EOL_CRLF, EOL_LF);
        }
    } else if (/\.(?:ts|js|json|md|sh|rs|py|gd)$/.test(context.file)) {
        if (context.content.includes('\r\n')) {
            reportEolMismatch(context, EOL_LF, EOL_CRLF);
        }
    }

    return false;
}

/**
 * Hygiene Analyzer auditing stubs, phantom branches, empty scripts, and transient process jargon.
 */
export class HygieneAnalyzer implements Analyzer {
    name = 'hygiene' as const;

    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as HygieneOptions;
        const issues: Issue[] = [];
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');

        if (auditFileBasics({ content, file, ctx, issues, makeIssue: this.makeHygieneIssue.bind(this) })) {
            return issues;
        }

        if (opts.checkNaming !== false) {
            this.auditFileNaming(file, ctx, issues);
            if (file.endsWith('.py')) this.auditPythonNaming(content, file, ctx, issues);
        }

        this.auditLineHygiene({
            content,
            len: content.length,
            file,
            checkDead: opts.checkDeadCode !== false,
            checkStubs: opts.checkTemporaryStubs !== false,
            ctx,
            issues,
        });

        if (opts.checkDuplicateBlocks !== false) {
            this.auditCloneBlocks(
                content,
                opts.minCloneLines ?? DEFAULT_MIN_CLONE_LINES,
                ctx,
                issues,
            );
        }

        if (opts.checkWrappers !== false) {
            issues.push(...auditVacuousWrappers(content, file, ctx));
        }

        return issues;
    }

    /**
     * Audit Python naming hygiene: builtin shadowing (HYG-BLT-001), single-letter names
     * (HYG-SGL-001) and exception-variable naming (HYG-EXC-001).
     *
     * Python-only guard (indentation-aware): a class-body assignment (a protocol field) is
     * exempt from the builtin rule while a local assignment is not; `self`/`cls` and the
     * protocol parameter names stay exempt, and docstring examples are never treated as live
     * bindings.
     *
     * @param content - Raw Python source text.
     * @param file - Normalized file path.
     * @param ctx - Analyzer context.
     * @param issues - Accumulator for emitted issues.
     */
    private auditPythonNaming(
        content: string,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        auditPythonHygiene({
            content,
            file,
            ctx,
            mkIssue: (params) => this.makeHygieneIssue(params),
            issues,
        });
    }

    private auditFileNaming(file: string, ctx: AnalyzerContext, issues: Issue[]): void {
        const baseName = path.basename(file);
        const ext = path.extname(baseName);
        const nameWithoutExt = baseName.slice(0, baseName.length - ext.length);

        if (isExemptFileName(nameWithoutExt)) {
            return;
        }

        const isJsTs = ext === '.ts' || ext === '.js';
        const isSnakeLang = ext === '.gd' || ext === '.py' || ext === '.rs';
        if (!isJsTs && !isSnakeLang) return;

        const desc = isJsTs
            ? checkJsTsNaming(baseName, nameWithoutExt)
            : checkSnakeNaming(baseName, nameWithoutExt);
        if (desc) {
            issues.push(
                this.makeHygieneIssue({
                    ctx,
                    lineIdx: 0,
                    rule: 'HYG-NAM-001',
                    message: desc.message,
                    severity: isJsTs ? SEVERITY_INFO : SEVERITY_WARNING,
                    detail: { file, baseName },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    private auditLineHygiene(params: {
        content: string;
        len: number;
        file: string;
        checkDead: boolean;
        checkStubs: boolean;
        ctx: AnalyzerContext;
        issues: Issue[];
    }): void {
        const isIndentBased = params.file.endsWith('.py') || params.file.endsWith('.gd');
        const jargonRe = buildJargonRe((params.ctx.options as HygieneOptions | undefined)?.jargonPatterns);
        let lineStart = 0;
        let lineIdx = 0;
        const deadState = { hadTerminalStmt: false, lastTerminalIndent: 0 };

        while (lineStart < params.len) {
            const { lineText, nextStart } = this.extractLine(params.content, lineStart, params.len);
            const trimmed = lineText.trim();
            const indent = this.calculateIndent(lineText);

            if (params.checkDead) {
                this.auditDeadCode({
                    trimmed,
                    indent,
                    lineIdx,
                    isIndentBased,
                    state: deadState,
                    ctx: params.ctx,
                    issues: params.issues,
                });
            }

            if (params.checkStubs) {
                this.auditStubsAndJargon({
                    trimmed,
                    lineIdx,
                    jargonRe,
                    ctx: params.ctx,
                    issues: params.issues,
                });
            }

            lineIdx++;
            lineStart = nextStart;
        }
    }

    private extractLine(
        content: string,
        lineStart: number,
        len: number,
    ): { lineText: string; nextStart: number } {
        let lineEnd = content.indexOf('\n', lineStart);
        let nextStart: number;
        if (lineEnd === -1) {
            lineEnd = len;
            nextStart = len;
        } else {
            nextStart = lineEnd + 1;
            if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === CHAR_CODE_CR) {
                lineEnd--;
            }
        }
        return { lineText: content.slice(lineStart, lineEnd), nextStart };
    }

    private calculateIndent(lineText: string): number {
        let indent = 0;
        while (
            indent < lineText.length &&
            (lineText.charCodeAt(indent) === CHAR_CODE_SPACE ||
                lineText.charCodeAt(indent) === CHAR_CODE_TAB)
        ) {
            indent++;
        }
        return indent;
    }

    private isContinuationOrBoundary(
        trimmed: string,
        indent: number,
        isIndentBased: boolean,
        lastTerminalIndent: number,
    ): boolean {
        return (
            trimmed.startsWith(CONTINUATION_DOT) ||
            trimmed.startsWith(CONTINUATION_RBRACE) ||
            trimmed.startsWith(CONTINUATION_CASE) ||
            trimmed.startsWith(CONTINUATION_DEFAULT) ||
            trimmed.startsWith(CONTINUATION_ELSE) ||
            trimmed.startsWith(CONTINUATION_ELIF) ||
            (isIndentBased && indent <= lastTerminalIndent)
        );
    }

    private isMeaningfulDeadCodeSnippet(trimmed: string): boolean {
        return (
            trimmed !== '' &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('#') &&
            trimmed !== '{' &&
            trimmed !== '}'
        );
    }

    private auditDeadCode(params: {
        trimmed: string;
        indent: number;
        lineIdx: number;
        isIndentBased: boolean;
        state: { hadTerminalStmt: boolean; lastTerminalIndent: number };
        ctx: AnalyzerContext;
        issues: Issue[];
    }): void {
        if (params.state.hadTerminalStmt) {
            if (
                this.isContinuationOrBoundary(
                    params.trimmed,
                    params.indent,
                    params.isIndentBased,
                    params.state.lastTerminalIndent,
                )
            ) {
                params.state.hadTerminalStmt = false;
            } else if (this.isMeaningfulDeadCodeSnippet(params.trimmed)) {
                const desc = HygieneMessages.UNREACHABLE_CODE;
                params.issues.push(
                    this.makeHygieneIssue({
                        ctx: params.ctx,
                        lineIdx: params.lineIdx,
                        rule: 'HYG-DED-001',
                        message: desc.message,
                        severity: SEVERITY_WARNING,
                        detail: {
                            line: params.lineIdx + 1,
                            snippet: params.trimmed.slice(0, UNREACHABLE_SNIPPET_MAX_CHARS),
                        },
                        suggestion: desc.suggestion,
                    }),
                );
                params.state.hadTerminalStmt = false;
            }
        }

        if (TERMINAL_STMT_RE.test(params.trimmed)) {
            const endsWithContinuation = /[({[,\\?:|&+\-*\/]\s*$/.test(params.trimmed);
            if (!endsWithContinuation) {
                params.state.hadTerminalStmt = true;
                params.state.lastTerminalIndent = params.indent;
            }
        }
    }

    private auditStubsAndJargon(params: StubsAuditContext): void {
        this.auditStubMarkers(params.trimmed, params.lineIdx, params.ctx, params.issues);
        this.auditTransientJargon(params);
        this.auditSuppressionDirectives(params.trimmed, params.lineIdx, params.ctx, params.issues);
        this.auditNonCommentExpressions(params.trimmed, params.lineIdx, params.ctx, params.issues);
    }

    private auditStubMarkers(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!UNRESOLVED_MARKER_PATTERN.test(trimmed)) return;
        const match = trimmed.match(UNRESOLVED_MARKER_PATTERN);
        const marker = match ? match[0] : ('TO' + 'DO');
        const desc = HygieneMessages.TEMPORARY_STUB(marker);
        issues.push(
            this.makeHygieneIssue({
                ctx,
                lineIdx,
                rule: 'HYG-STB-001',
                message: desc.message,
                severity: SEVERITY_INFO,
                detail: { line: lineIdx + 1, marker },
                suggestion: desc.suggestion,
            }),
        );
    }

    private auditTransientJargon(params: StubsAuditContext): void {
        const jargonMatch = params.trimmed.match(params.jargonRe);
        if (
            !jargonMatch ||
            isVocabularyEnumeration(params.trimmed, jargonMatch.index ?? 0, jargonMatch[0])
        ) {
            return;
        }
        const jargon = jargonMatch[0];
        const desc = HygieneMessages.TRANSIENT_JARGON(jargon);
        params.issues.push(
            this.makeHygieneIssue({
                ctx: params.ctx,
                lineIdx: params.lineIdx,
                rule: 'HYG-STB-002',
                message: desc.message,
                severity: SEVERITY_WARNING,
                detail: { line: params.lineIdx + 1, jargon },
                suggestion: desc.suggestion,
            }),
        );
    }

    private auditSuppressionDirectives(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!SUPPRESSION_DIRECTIVE_RE.test(trimmed)) return;
        const match = trimmed.match(SUPPRESSION_DIRECTIVE_RE);
        const directive = match ? match[0].trim() : trimmed;
        const desc = HygieneMessages.SUPPRESSION_DIRECTIVE(directive);
        issues.push(
            this.makeHygieneIssue({
                ctx,
                lineIdx,
                rule: 'HYG-SUP-001',
                message: desc.message,
                severity: SEVERITY_ERROR,
                detail: { line: lineIdx + 1, directive },
                suggestion: desc.suggestion,
            }),
        );
    }

    private auditNonCommentExpressions(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (
            trimmed.startsWith('//') ||
            trimmed.startsWith('*') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('#')
        ) {
            return;
        }

        const checkRule = (
            re: RegExp,
            rule: string,
            getDesc: (expr: string) => { message: string; suggestion?: string },
        ): void => {
            if (!re.test(trimmed)) return;
            const desc = getDesc(trimmed);
            issues.push(
                this.makeHygieneIssue({
                    ctx,
                    lineIdx,
                    rule,
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: { line: lineIdx + 1, expression: trimmed },
                    suggestion: desc.suggestion,
                }),
            );
        };

        checkRule(VAGUE_THROW_RE, 'ERR-MSG-001', HygieneMessages.VAGUE_ERROR_MESSAGE);
        checkRule(FLOATING_PROMISE_RE, 'ERR-FLT-001', HygieneMessages.FLOATING_PROMISE);
    }

    private auditCloneBlocks(
        content: string,
        minCloneLines: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        try {
            const clones = nativeCore.detectCloneBlocks(content, minCloneLines);
            if (clones.length > 0) {
                const clone = clones[0];
                const desc = HygieneMessages.DUPLICATE_CODE_CLONE(
                    clone.lineSpan,
                    clone.originalLine,
                );
                issues.push(
                    this.makeHygieneIssue({
                        ctx,
                        lineIdx: clone.startLine - 1,
                        rule: 'HYG-CLN-001',
                        message: desc.message,
                        severity: SEVERITY_WARNING,
                        detail: {
                            startLine: clone.startLine,
                            originalLine: clone.originalLine,
                            lineSpan: clone.lineSpan,
                        },
                        suggestion: desc.suggestion,
                    }),
                );
            }
            return;
        } catch (_err) {
            void _err;
        }

        this.detectClonesPureJs(content, minCloneLines, ctx, issues);
    }

    private detectClonesPureJs(
        content: string,
        minCloneLines: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const { lineHashes, meaningfulLineIndices } = computeLineHashesFallback(content);
        if (lineHashes.length < minCloneLines * 2) {
            return;
        }

        const blockMap = new Map<number, number>();
        const total = lineHashes.length;

        for (let i = 0; i <= total - minCloneLines; i++) {
            let hashValue = 0;
            for (let k = 0; k < minCloneLines; k++) {
                hashValue = (Math.imul(hashValue, CLONE_ROLLING_HASH_MULTIPLIER) + lineHashes[i + k]) | 0;
            }

            const prevLine = blockMap.get(hashValue);
            if (prevLine !== undefined && i >= prevLine + minCloneLines) {
                const actualStartLine = meaningfulLineIndices[i] + 1;
                const originalLine = meaningfulLineIndices[prevLine] + 1;
                const desc = HygieneMessages.DUPLICATE_CODE_CLONE(minCloneLines, originalLine);
                issues.push(
                    this.makeHygieneIssue({
                        ctx,
                        lineIdx: meaningfulLineIndices[i],
                        rule: 'HYG-CLN-001',
                        message: desc.message,
                        severity: SEVERITY_WARNING,
                        detail: { startLine: actualStartLine, originalLine, lineSpan: minCloneLines },
                        suggestion: desc.suggestion,
                    }),
                );
                break;
            }
            if (prevLine === undefined) {
                blockMap.set(hashValue, i);
            }
        }
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    private makeHygieneIssue(params: HygieneIssueContext): Issue {
        const line = params.lineIdx + 1;
        const file = params.ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${params.rule}:${file}:${line}`,
            analyzer: this.name,
            rule: params.rule,
            severity: params.severity,
            message: params.message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail: params.detail,
            suggestion: params.suggestion,
        };
    }
}
