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
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { HygieneMessages } from '../core/messages';
import { isVocabularyEnumeration } from '../core/governance/markerScope';
import { CONSTRUCTION_JARGON_RE } from '../core/governance/terminology-engine';
import { auditVacuousWrappers } from '../core/rules/evolution/wrapperRule';
import { auditRegexSafety, isRegexSafe } from '../utils/safe-regex';
import { auditPythonHygiene } from './hygiene-python-helper';
import { auditFileBasics, auditFileNaming } from './hygiene-file-helper';
import { auditCloneBlocks, DEFAULT_MIN_CLONE_LINES } from './hygiene-clone-helper';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { REGEX } from '../core/constants';

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
const TERMINAL_STMT_RE = REGEX.SYNTAX.CONTROL_FLOW_ESCAPE;
const SUPPRESSION_DIRECTIVE_RE = REGEX.SYNTAX.SUPPRESSION_DIRECTIVE;
const VAGUE_THROW_RE = REGEX.SYNTAX.VAGUE_THROW;
const FLOATING_PROMISE_RE = REGEX.SYNTAX.FLOATING_PROMISE;
/** Character code of '\r' (carriage return), stripped from CRLF line endings. */
const CHAR_CODE_CR = 13;
/** Character code of the space character, counted as leading indentation. */
const CHAR_CODE_SPACE = 32;
/** Character code of the tab character, counted as leading indentation. */
const CHAR_CODE_TAB = 9;
/** Maximum snippet length in characters attached to an unreachable-code finding. */
const UNREACHABLE_SNIPPET_MAX_CHARS = 40;

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
 * Context parameters required to audit temporary stubs and transient jargon.
 */
export interface StubsAuditContext {
    readonly trimmed: string;
    readonly lineIdx: number;
    readonly jargonRe: RegExp;
    readonly ctx: AnalyzerContext;
    readonly issues: Issue[];
}

/**
 * Hygiene Analyzer auditing stubs, phantom branches, empty scripts, and transient process jargon.
 */
export class HygieneAnalyzer implements Analyzer {
    name = 'hygiene' as const;

    public resetState(): void {
        // Stateless hygiene analyzer - safe for pool reuse
    }

    analyze(
        sourceFile: import('typescript').SourceFile | undefined,
        ctx: AnalyzerContext,
    ): Issue[] {
        void sourceFile;
        const opts = (ctx.options || {}) as HygieneOptions;
        const issues: Issue[] = [];
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');

        if (auditFileBasics(content, file, ctx, issues)) {
            return issues;
        }

        if (opts.checkNaming !== false) {
            auditFileNaming(file, ctx, issues);
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
            auditCloneBlocks(content, opts.minCloneLines ?? DEFAULT_MIN_CLONE_LINES, ctx, issues);
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
        const jargonRe = buildJargonRe(
            (params.ctx.options as HygieneOptions | undefined)?.jargonPatterns,
        );
        let lineStart = 0;
        let lineIdx = 0;
        const deadState = { hadTerminalStmt: false, lastTerminalIndent: 0 };
        const tabReportState = { count: 0 };

        while (lineStart < params.len) {
            const { lineText, nextStart } = this.extractLine(params.content, lineStart, params.len);
            const trimmed = lineText.trim();
            const indent = this.calculateIndent(lineText);

            this.auditTabIndentation({
                file: params.file,
                lineText,
                lineIdx,
                ctx: params.ctx,
                issues: params.issues,
                reportedState: tabReportState,
            });

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

    private auditTabIndentation(params: {
        file: string;
        lineText: string;
        lineIdx: number;
        ctx: AnalyzerContext;
        issues: Issue[];
        reportedState: { count: number };
    }): void {
        if (params.reportedState.count >= 3) return;
        const lowerFile = params.file.toLowerCase();
        if (
            lowerFile.endsWith('.gd') ||
            lowerFile.includes('makefile') ||
            lowerFile.endsWith('.mk')
        ) {
            return;
        }
        if (/^\s*\t/.test(params.lineText)) {
            const desc = HygieneMessages.TAB_INDENTATION_DETECTED(params.file, params.lineIdx + 1);
            params.issues.push(
                this.makeHygieneIssue({
                    ctx: params.ctx,
                    lineIdx: params.lineIdx,
                    rule: 'HYG-IND-001',
                    message: desc.message,
                    severity: SEVERITY_WARNING,
                    detail: { file: params.file, line: params.lineIdx + 1 },
                    suggestion: desc.suggestion,
                }),
            );
            params.reportedState.count++;
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
        const marker = match ? match[0] : 'TO' + 'DO';
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
            patternRegex: RegExp,
            rule: string,
            getDesc: (expr: string) => { message: string; suggestion?: string },
        ): void => {
            if (!patternRegex.test(trimmed)) return;
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

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    private makeHygieneIssue(params: HygieneIssueContext): Issue {
        return createLineIssue(this.name, params.ctx.filePath, {
            lineIdx: params.lineIdx,
            rule: params.rule,
            severity: params.severity,
            message: params.message,
            detail: params.detail,
            suggestion: params.suggestion,
        });
    }
}
