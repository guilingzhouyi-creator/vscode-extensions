/**
 * Module: Static Analysis Engine — Python Modernization Rules
 * File Path: src/analyzers/python-modern.ts
 * Architecture Role: Python-only style analyzer (a language pack: binds to Python, not to
 *     a project) — pathlib, exception chaining, mutable defaults, async blocking, f-strings,
 * Dependencies & Triggers: core types only; enabled when a config declares
 *     `analyzers.python-modern`; runs on `.py` files during the engine's analyze/finalize pass
 * Responsibilities: Detect `os.path` usage (PYM-PATH-001), `raise` without `from` inside an
 *     except handler (PYM-RAISE-001), mutable default arguments (PYM-DEFAULT-001), blocking
 *     calls inside async functions (PYM-ASYNC-001), percent-formatting (PYM-FSTRING-001) and
 *     `open()` without a `with` block (PYM-OPEN-001)
 * Exit Semantics & Design Rationale: Pure line scanner, never throws and returns [] for
 *     non-Python content. Context (inside `async def` / `except` / `with`) is derived from an
 *     indentation block stack instead of an AST because the built-in analyzers stay
 *     content-oriented; the heuristics are keyword-anchored so a missed modernization is
 *     preferred over a wrong rewrite suggestion.
 */
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { REGEX } from '../core/constants';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { isCommentOrBlankLine, calculateIndentWidth } from '../core/ast/block-scope-utils';
import { PY_STDLIB_NAMES, PY_LOCAL_ROOTS, PY_ABC_TYPING_NAMES } from './python-modern-tables';
import {
    ACTION_REPLACE_TOKEN,
    ACTIONABLE_SPECS,
    PYTHON_ASYNC_KEYWORD,
    RULE_PYM_ABC_001,
    RULE_PYM_GENERIC_001,
    RULE_PYM_IMPORT_001,
    SECTION_LABELS,
    SECTION_LOCAL_INDEX,
    SECTION_STDLIB_INDEX,
    SECTION_THIRD_PARTY_INDEX,
    SPEC_ASYNC_BLOCKING,
    SPEC_ASYNC_ORM,
    SPEC_DEFAULT,
    SPEC_IMPORT_ORDER,
    SPEC_OPEN,
    SPEC_RAISE,
    SPEC_SLOTS,
    SUGGESTION_ABC,
    SUGGESTION_IMPORT_ORDER,
    type Block,
    type BlockKind,
    type ImportRecord,
    type IssueSpec,
    type PyBlockContext,
    type PyEmitter,
    type PyImportAccumulator,
    type PyLineScanContext,
} from './python-modern-contracts';
import {
    auditVariableShadowing,
    resolveShadowingOptions,
    type PyShadowContext,
    type VarScope,
} from './python-modern-shadowing';

const PREFIX_OS_PATH = 'os.path.';
const PYTHON_SINGLE_LINE_RULES: ReadonlyArray<{
    readonly spec: IssueSpec;
    readonly fastTrigger: string | RegExp;
    readonly matches: (line: string) => boolean;
}> = Object.freeze([
    {
        spec: {
            rule: 'PYM-PATH-001',
            severity: SEVERITY_WARNING,
            message: 'os.path usage: prefer pathlib.Path for path manipulation.',
            suggestion:
                'Build paths with pathlib.Path (`Path(...) / name`), which is OS-neutral and self-documenting.',
        },
        fastTrigger: PREFIX_OS_PATH,
        matches: (line: string) => line.includes(PREFIX_OS_PATH),
    },
    {
        spec: {
            rule: 'PYM-FSTRING-001',
            severity: SEVERITY_WARNING,
            message: 'Percent-formatting is legacy: f-strings are faster and harder to misalign.',
            suggestion: 'Rewrite as an f-string (`f"...{value}"`).',
        },
        fastTrigger: '%',
        matches: (line: string) => REGEX.PYTHON.PERCENT_FORMAT.test(line),
    },
    {
        spec: {
            rule: 'PYM-DATETIME-001',
            severity: SEVERITY_ERROR,
            message: 'timezone.utc is superseded by the datetime.UTC singleton.',
            suggestion: 'Use `datetime.UTC` (PEP 615 / ruff UP017).',
        },
        fastTrigger: 'timezone.utc',
        matches: (line: string) => REGEX.PYTHON.TIMEZONE_UTC.test(line),
    },
    {
        spec: {
            rule: 'PYM-UNION-001',
            severity: SEVERITY_ERROR,
            message: 'Optional/Union in an annotation or alias: PEP 604 unions read better.',
            suggestion: 'Write `X | None` / `X | Y` instead of Optional/Union.',
        },
        fastTrigger: /Optional|Union/,
        matches: (line: string) =>
            REGEX.PYTHON.PEP604_ANN_ASSIGN.test(line) || REGEX.PYTHON.PEP604_ALIAS.test(line),
    },
]);

function hasFastTrigger(trigger: string | RegExp, line: string): boolean {
    return typeof trigger === 'string' ? line.includes(trigger) : trigger.test(line);
}

const SCOPE_KIND_MODULE = 'module';
const BLOCK_KIND_DEF = 'def';
const BLOCK_KIND_CLASS = 'class';
const BLOCK_KIND_EXCEPT = 'except';
const BLOCK_KIND_WITH = 'with';
const BLOCK_KIND_OTHER = 'other';

const BLOCK_OPEN_RE = REGEX.PYTHON.BLOCK_OPEN;

const BLOCKING_CALL_RE = REGEX.PYTHON.BLOCKING_CALL;
const SYNC_ORM_CALL_RE = REGEX.PYTHON.SYNC_ORM_CALL;
const AWAITED_ORM_CALL_RE = REGEX.PYTHON.AWAITED_ORM_CALL;
const RAISE_RE = REGEX.PYTHON.RAISE;

/** Maximum number of following lines inspected for a `from` cause clause on a multi-line raise. */
const RAISE_CAUSE_LOOKAHEAD_LINES = 5;

const ABC_IMPORT_RE = REGEX.PYTHON.ABC_IMPORT;
const PY_DATACLASS_RE = REGEX.PYTHON.DATACLASS;

/**
 * Python modernization analyzer.
 *
 * Content-only by design: `finalize` is the path the engine actually invokes (a bare `analyze`
 * would be skipped for non-TypeScript files, because only TS-family adapters materialize a
 * `ts.SourceFile`); `analyze` remains the standalone contract. Only `.py` paths are inspected.
 */
export class PythonModernAnalyzer implements Analyzer {
    name = 'python-modern' as const;

    public resetState(): void {
        // Stateless python modernization scanner - safe for pool reuse
    }

    /**
     * Streaming-path entry point: the engine invokes this once per file. A content-only analyzer
     * must expose it, because the legacy `analyze` path is TypeScript-only (the engine
     * materializes a `ts.SourceFile` solely for TS-family adapters).
     *
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Scan one Python file for modernization findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        if (!file.endsWith('.py') || content.length === 0) return [];
        const lines = ctx.lines ?? content.split('\n');
        const blocks: Block[] = [];
        const importRecords: ImportRecord[] = [];
        const issues: Issue[] = [];
        const emit = this.createIssueEmitter(file, issues);

        // Shadowing: initialize with a module-level scope (indent -1 so it is never popped).
        const varScopes: VarScope[] = [
            { indent: -1, kind: SCOPE_KIND_MODULE, names: new Map<string, number>() },
        ];
        const shadowOpts = resolveShadowingOptions(ctx.options);
        const importAcc: PyImportAccumulator = { file, records: importRecords };

        const scanCtx: PyLineScanContext = { line: '', trimmed: '', lineIndex: 0, emit };
        const blockCtx: PyBlockContext = {
            inExcept: false,
            inWith: false,
            inAsync: false,
        };
        const shadowCtx: PyShadowContext = {
            indent: 0,
            varScopes,
            opts: shadowOpts,
            emit,
        };

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            let line = lines[lineIndex];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (isCommentOrBlankLine(line)) continue;

            const trimmed = line.trim();
            const indent = calculateIndentWidth(line);
            this.popScopesForIndent(indent, blocks, varScopes);

            scanCtx.line = line;
            scanCtx.trimmed = trimmed;
            scanCtx.lineIndex = lineIndex;
            blockCtx.inExcept = this.hasKind(blocks, BLOCK_KIND_EXCEPT);
            blockCtx.inWith = this.hasKind(blocks, BLOCK_KIND_WITH);
            blockCtx.inAsync = this.hasKind(blocks, PYTHON_ASYNC_KEYWORD);
            shadowCtx.indent = indent;

            this.auditModernSyntax(scanCtx);
            this.auditModernTyping(scanCtx);
            this.auditControlFlow(scanCtx, lines, blockCtx);
            this.auditDataclassSlots(scanCtx, lines);
            this.recordModuleImports(scanCtx, indent, blocks, importAcc);
            auditVariableShadowing(scanCtx, shadowCtx);

            if (BLOCK_OPEN_RE.test(trimmed)) {
                blocks.push({ indent, kind: this.resolveBlockKind(trimmed) });
            }
        }

        this.checkImportOrder(importRecords, emit);
        return issues;
    }

    private popScopesForIndent(indent: number, blocks: Block[], varScopes: VarScope[]): void {
        while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) {
            blocks.pop();
        }
        while (varScopes.length > 1 && indent <= varScopes[varScopes.length - 1].indent) {
            varScopes.pop();
        }
    }

    private createIssueEmitter(file: string, issues: Issue[]): PyEmitter {
        return (
            targetLineIndex: number,
            spec: IssueSpec,
            detail: Record<string, unknown>,
        ): void => {
            const mappedAction = ACTIONABLE_SPECS[spec.rule];
            const issuePayload: Issue = createLineIssue(this.name, file, {
                lineIdx: targetLineIndex,
                rule: spec.rule,
                severity: spec.severity,
                message: spec.message,
                detail,
                suggestion: spec.suggestion,
            });

            if (mappedAction) {
                issuePayload.actionable = {
                    action: mappedAction.action ?? ACTION_REPLACE_TOKEN,
                    code: mappedAction.code,
                    safeToAutomate: mappedAction.safeToAutomate ?? false,
                    templateSnippet: mappedAction.templateSnippet,
                };
            }

            issues.push(issuePayload);
        };
    }

    private auditModernSyntax(scanCtx: PyLineScanContext): void {
        const line = scanCtx.line;
        const lineIndex = scanCtx.lineIndex;
        const trimmed = scanCtx.trimmed;
        const emit = scanCtx.emit;

        for (let i = 0; i < PYTHON_SINGLE_LINE_RULES.length; i++) {
            const rule = PYTHON_SINGLE_LINE_RULES[i];
            if (hasFastTrigger(rule.fastTrigger, line) && rule.matches(line)) {
                emit(lineIndex, rule.spec, { line: trimmed });
            }
        }
    }

    private auditModernTyping(scanCtx: PyLineScanContext): void {
        const line = scanCtx.line;
        const lineIndex = scanCtx.lineIndex;
        const trimmed = scanCtx.trimmed;
        const emit = scanCtx.emit;

        if (line.includes('[') && REGEX.SYNTAX.PYTHON_PEP585.test(line)) {
            const hit = REGEX.SYNTAX.PYTHON_PEP585.exec(line)?.[1] ?? '';
            const spec: IssueSpec = {
                rule: RULE_PYM_GENERIC_001,
                severity: SEVERITY_ERROR,
                message: `typing.${hit}[...] is legacy: PEP 585 parameterizes the builtin instead.`,
                suggestion: `Use \`${hit.toLowerCase()}[...]\` rather than typing.${hit}.`,
            };
            emit(lineIndex, spec, { line: trimmed, name: hit });
        }

        if (!trimmed.includes('typing')) return;
        const abcImport = ABC_IMPORT_RE.exec(trimmed);
        if (abcImport) {
            const offenders = abcImport[1]
                .replace(REGEX.PYTHON.createParenStripScanner(), '')
                .split(',')
                .map((part) =>
                    part
                        .trim()
                        .split(/\s+as\s+/)[0]
                        .trim(),
                )
                .filter((name) => PY_ABC_TYPING_NAMES.has(name));
            if (offenders.length > 0) {
                const spec: IssueSpec = {
                    rule: RULE_PYM_ABC_001,
                    severity: SEVERITY_ERROR,
                    message: `Abstract type(s) ${offenders.join(', ')} belong to collections.abc, not typing.`,
                    suggestion: SUGGESTION_ABC,
                };
                emit(lineIndex, spec, { names: offenders });
            }
        }
    }

    private auditRaiseFrom(
        codeOnly: string,
        scanCtx: PyLineScanContext,
        lines: readonly string[],
    ): void {
        if (!RAISE_RE.test(codeOnly)) return;
        const hasCauseAhead =
            REGEX.SYNTAX.PYTHON_RAISE_FROM.test(codeOnly) ||
            this.checkFollowingLinesContain(
                scanCtx.lineIndex,
                lines,
                /\bfrom\b/,
                RAISE_CAUSE_LOOKAHEAD_LINES,
            );
        if (!hasCauseAhead) {
            scanCtx.emit(scanCtx.lineIndex, SPEC_RAISE, { line: scanCtx.trimmed });
        }
    }

    private auditMutableDefaults(scanCtx: PyLineScanContext): void {
        const line = scanCtx.line;
        const isDef =
            REGEX.SYNTAX.PYTHON_ASYNC_DEF.test(line) ||
            REGEX.SYNTAX.PYTHON_DEF_KEYWORD.test(line) ||
            REGEX.SYNTAX.PYTHON_CLASS_KEYWORD.test(line);
        if (!isDef) return;
        const parenIdx = line.indexOf('(');
        if (parenIdx === -1) return;
        const signature = line.slice(parenIdx + 1);
        if (signature !== '' && REGEX.SYNTAX.PYTHON_MUTABLE_DEFAULT.test(signature)) {
            scanCtx.emit(scanCtx.lineIndex, SPEC_DEFAULT, { line: scanCtx.trimmed });
        }
    }

    private auditUnmanagedOpen(scanCtx: PyLineScanContext, inWith: boolean): void {
        if (
            !inWith &&
            REGEX.PYTHON.OPEN_CALL.test(scanCtx.line) &&
            !REGEX.SYNTAX.PYTHON_WITH.test(scanCtx.line)
        ) {
            scanCtx.emit(scanCtx.lineIndex, SPEC_OPEN, { line: scanCtx.trimmed });
        }
    }

    private auditControlFlow(
        scanCtx: PyLineScanContext,
        lines: readonly string[],
        blockCtx: PyBlockContext,
    ): void {
        const codeOnly = scanCtx.trimmed.split('#')[0].trim();
        if (blockCtx.inExcept) {
            this.auditRaiseFrom(codeOnly, scanCtx, lines);
        }
        this.auditMutableDefaults(scanCtx);

        if (blockCtx.inAsync && !REGEX.SYNTAX.PYTHON_ASYNC_DEF.test(scanCtx.line)) {
            this.auditAsyncCalls(scanCtx);
        }

        this.auditUnmanagedOpen(scanCtx, blockCtx.inWith);
    }

    private auditAsyncCalls(scanCtx: PyLineScanContext): void {
        const line = scanCtx.line;
        const lineIndex = scanCtx.lineIndex;
        const trimmed = scanCtx.trimmed;
        const emit = scanCtx.emit;

        if (BLOCKING_CALL_RE.test(line)) {
            emit(lineIndex, SPEC_ASYNC_BLOCKING, { line: trimmed });
        } else if (!AWAITED_ORM_CALL_RE.test(line) && SYNC_ORM_CALL_RE.test(line)) {
            emit(lineIndex, SPEC_ASYNC_ORM, { line: trimmed });
        }
    }

    private auditDataclassSlots(scanCtx: PyLineScanContext, lines: readonly string[]): void {
        if (!PY_DATACLASS_RE.test(scanCtx.trimmed)) return;
        let probeLineIndex = scanCtx.lineIndex + 1;
        while (
            probeLineIndex < lines.length &&
            (lines[probeLineIndex].trim().startsWith('@') || lines[probeLineIndex].trim() === '')
        ) {
            probeLineIndex++;
        }
        const next = probeLineIndex < lines.length ? lines[probeLineIndex].trim() : '';
        if (REGEX.PYTHON.CLASS_DECL.test(next) && !/\bslots\s*=/.test(scanCtx.trimmed)) {
            scanCtx.emit(scanCtx.lineIndex, SPEC_SLOTS, { line: scanCtx.trimmed });
        }
    }

    private recordModuleImports(
        scanCtx: PyLineScanContext,
        indent: number,
        blocks: readonly Block[],
        acc: PyImportAccumulator,
    ): void {
        const moduleLevel =
            indent === 0 &&
            !this.hasKind(blocks, BLOCK_KIND_DEF) &&
            !this.hasKind(blocks, PYTHON_ASYNC_KEYWORD) &&
            !this.hasKind(blocks, BLOCK_KIND_CLASS);
        if (moduleLevel && REGEX.PYTHON.IMPORT_STMT.test(scanCtx.trimmed)) {
            acc.records.push({
                line: scanCtx.lineIndex + 1,
                text: scanCtx.trimmed,
                section: this.classifyImportSection(scanCtx.trimmed, acc.file),
            });
        }
    }

    /**
     * Classify one module-level import statement into the PEP 8 three-section model.
     *
     * @param text - Trimmed import statement.
     * @param file - Normalized file path (its first segment counts as a local root).
     * @returns 0 for stdlib, 1 for third-party, 2 for first-party/local.
     */
    private classifyImportSection(text: string, file: string): number {
        const fromMatch = REGEX.PYTHON.FROM_IMPORT_CAPTURE.exec(text);
        const importMatch = REGEX.PYTHON.IMPORT_CAPTURE.exec(text);
        const module = fromMatch?.[1] ?? importMatch?.[1] ?? '';
        if (module === '' || module.startsWith('.')) {
            return SECTION_LOCAL_INDEX;
        }
        const root = module.split('.')[0];
        if (PY_STDLIB_NAMES.has(root)) {
            return SECTION_STDLIB_INDEX;
        }
        const isLocalRoot = PY_LOCAL_ROOTS.has(root) || root === file.split('/')[0];
        return isLocalRoot ? SECTION_LOCAL_INDEX : SECTION_THIRD_PARTY_INDEX;
    }

    /**
     * Enforce the three-section import order plus per-section alphabetical ordering.
     *
     * @param records - Module-level imports in source order.
     * @param emit - Issue factory shared with the line scanner.
     */
    private checkImportOrder(records: readonly ImportRecord[], emit: PyEmitter): void {
        if (records.length === 0) return;
        let seenSection = 0;
        for (const record of records) {
            if (record.section < seenSection) {
                const spec: IssueSpec = {
                    rule: RULE_PYM_IMPORT_001,
                    severity: SEVERITY_WARNING,
                    message: `Import section order violated: a ${SECTION_LABELS[record.section]} import follows a ${SECTION_LABELS[seenSection]} import.`,
                    suggestion: SPEC_IMPORT_ORDER.suggestion,
                };
                emit(record.line - 1, spec, {
                    line: record.text,
                    section: record.section,
                });
                break;
            }
            seenSection = Math.max(seenSection, record.section);
        }
        const sections: ImportRecord[][] = [[], [], []];
        for (let idx = 0; idx < records.length; idx++) {
            const currentRecord = records[idx];
            const targetSection = sections[currentRecord.section];
            if (targetSection) {
                targetSection.push(currentRecord);
            }
        }
        for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
            this.checkSectionAlphabetical(sections[sectionIndex], sectionIndex, emit);
        }
    }

    private checkSectionAlphabetical(
        group: readonly ImportRecord[],
        sectionIndex: number,
        emit: PyEmitter,
    ): void {
        const texts = group.map((record) => record.text);
        const ordered = [...texts].sort();
        for (let recordPos = 0; recordPos < texts.length; recordPos++) {
            if (texts[recordPos] !== ordered[recordPos]) {
                const spec: IssueSpec = {
                    rule: RULE_PYM_IMPORT_001,
                    severity: SEVERITY_WARNING,
                    message: `${SECTION_LABELS[sectionIndex]} imports are not alphabetically ordered (expected \`${ordered[recordPos]}\` at this position).`,
                    suggestion: SUGGESTION_IMPORT_ORDER,
                };
                emit(group[recordPos].line - 1, spec, {
                    line: texts[recordPos],
                    expected: ordered[recordPos],
                });
                break;
            }
        }
    }

    /**
     * Look ahead a bounded number of lines for a continuation token.
     *
     * Multi-line `raise ... from exc` statements put the cause on a later physical line, so the
     * single-line check must consult the statement window before reporting a missing chain.
     *
     * @param index - Index of the current line.
     * @param lines - All file lines.
     * @param pattern - Pattern to search for in the following lines.
     * @param lookahead - Maximum number of following lines to inspect.
     * @returns True when the pattern appears within the window.
     */
    private checkFollowingLinesContain(
        index: number,
        lines: readonly string[],
        pattern: RegExp,
        lookahead: number,
    ): boolean {
        const end = Math.min(index + lookahead + 1, lines.length);
        for (let scanLineIndex = index + 1; scanLineIndex < end; scanLineIndex++) {
            if (pattern.test(lines[scanLineIndex])) return true;
        }
        return false;
    }

    private resolveBlockKind(trimmed: string): BlockKind {
        if (REGEX.SYNTAX.PYTHON_ASYNC_DEF.test(trimmed)) return PYTHON_ASYNC_KEYWORD;
        if (REGEX.SYNTAX.PYTHON_DEF_KEYWORD.test(trimmed)) return BLOCK_KIND_DEF;
        if (REGEX.SYNTAX.PYTHON_CLASS_KEYWORD.test(trimmed)) return BLOCK_KIND_CLASS;
        if (REGEX.SYNTAX.PYTHON_EXCEPT_KEYWORD.test(trimmed)) return BLOCK_KIND_EXCEPT;
        return REGEX.SYNTAX.PYTHON_WITH.test(trimmed) ? BLOCK_KIND_WITH : BLOCK_KIND_OTHER;
    }

    /**
     * Report whether any enclosing block has the requested kind.
     *
     * @param blocks - Active indentation block stack.
     * @param kind - Block kind to look for.
     * @returns True when the kind is present in the stack.
     */
    private hasKind(blocks: readonly Block[], kind: BlockKind): boolean {
        return blocks.some((block) => block.kind === kind);
    }
}
