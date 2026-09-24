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
 *   TODO/FIXME/XXX/HACK/unimplemented markers, HYG-STB-002 jargon such as pN/stN/phase N/wip
 *   (vocabulary replaceable per project via `jargonPatterns`),
 *   HYG-CLN-001 duplicate meaningful-line blocks found by a 32-bit FNV-1a rolling hash, plus
 *   the Python naming guards HYG-BLT-001 (builtin shadowing), HYG-SGL-001 (single-letter
 *   bindings) and HYG-EXC-001 (exception variable naming).
 * Exit Semantics & Design Rationale: Always returns Issue[] and never throws; every check is
 *   opt-out via HygieneOptions (`!== false`) with minCloneLines defaulting to 6. Raw-content
 *   scanning keeps the analyzer language-agnostic and avoids AST cost for text-level signals.
 */
import * as path from 'path';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING } from '../core/types';
import { HygieneMessages } from '../core/messages';
import { isVocabularyEnumeration } from '../core/governance/markerScope';
import { auditVacuousWrappers } from '../core/rules/evolution/wrapperRule';

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

const TERMINAL_STMT_RE = /^\s*(?:return\b|throw\s+|break;|continue;|raise\s+|exit\b)/;
const TEMP_STUB_RE = /\b(TODO|FIXME|XXX|HACK|unimplemented)\b/i;
/** Built-in transient-process jargon vocabulary; overridable per project. */
const DEFAULT_JARGON_RE = /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|wip)\b/i;
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
    if (list.length === 0) return DEFAULT_JARGON_RE;
    try {
        return new RegExp(`\\b(?:${list.join('|')})\\b`, 'i');
    } catch {
        return DEFAULT_JARGON_RE;
    }
}

/**
 * Python naming-guard constants.
 * `PY_BUILTIN_NAMES` is the commonly shadowed slice of `dir(builtins)`; `PY_PROTOCOL_FIELDS`
 * holds the protocol-style parameter names exempted from shadow reporting.
 */
const PY_BUILTIN_NAMES = new Set([
    'abs',
    'aiter',
    'all',
    'anext',
    'any',
    'ascii',
    'bin',
    'bool',
    'breakpoint',
    'bytearray',
    'bytes',
    'callable',
    'chr',
    'classmethod',
    'compile',
    'complex',
    'delattr',
    'dict',
    'dir',
    'divmod',
    'enumerate',
    'eval',
    'exec',
    'filter',
    'float',
    'format',
    'frozenset',
    'getattr',
    'globals',
    'hasattr',
    'hash',
    'help',
    'hex',
    'id',
    'input',
    'int',
    'isinstance',
    'issubclass',
    'iter',
    'len',
    'list',
    'locals',
    'map',
    'max',
    'memoryview',
    'min',
    'next',
    'object',
    'oct',
    'open',
    'ord',
    'pow',
    'print',
    'property',
    'range',
    'repr',
    'reversed',
    'round',
    'set',
    'setattr',
    'slice',
    'sorted',
    'staticmethod',
    'str',
    'sum',
    'super',
    'tuple',
    'type',
    'vars',
    'zip',
]);
const PY_PROTOCOL_FIELDS = new Set(['id', 'type', 'help', 'format', 'input', 'next']);
const PY_SHORT_ALLOWED = new Set(['i', 'j', 'k', '_']);
const PY_EXCEPT_NAME = 'exc';
const PY_ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/;
const PY_FOR_RE = /^for\s+([A-Za-z_]\w*)\s+in\b/;
const PY_EXCEPT_AS_RE = /^except\b[^:]*\bas\s+([A-Za-z_]\w*)\s*:/;
const PY_CLASS_RE = /^class\s+[A-Za-z_]\w*/;
const PY_DEF_LINE_RE = /^(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/;
const PY_WITH_AS_RE = /\bas\s+([A-Za-z_]\w*)\s*(?:,|:)/g;

/** Python binding kind for assignment/loop/with targets, as opposed to parameters. */
const PY_BINDING_ASSIGNMENT = 'assignment';

/** Fast 32-bit integer line hasher to eliminate string concatenations during clone detection */
function hashString32(str: string): number {
    let h = FNV1A_32_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, FNV1A_32_PRIME);
    }
    return h | 0;
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
 * Report hygiene and maintainability findings from a raw file content scan.
 *
 * The analyzer detects naming drift, statements after a terminal statement, stub markers
 * that signal unfinished work, transient process jargon, and duplicate meaningful-line
 * blocks found with a rolling 32-bit FNV-1a hash. Scanning raw text keeps every check
 * language-agnostic and avoids AST cost for text-level signals.
 *
 * Contract: produces canonical `Issue` records for HYG-NAM-001, HYG-DED-001,
 * HYG-STB-001/002 and HYG-CLN-001. Inputs are the file `content`/`filePath` plus
 * `options` (`checkDeadCode`, `checkNaming`, `checkTemporaryStubs`, `checkDuplicateBlocks`,
 * `minCloneLines`, `jargonPatterns`). Output is a list of findings with 1-based
 * lines, or an empty array when every check is disabled or no rule matches.
 * Edge cases: each check is opt-out via an explicit `false`; clone detection runs only
 * when the file has at least `2 * minCloneLines` meaningful lines; markers and jargon
 * match whole words, so identifiers such as `wipCount` do not false-positive.
 * Failure semantics: always returns an issue array and never throws on unusual input.
 */
export class HygieneAnalyzer implements Analyzer {
    name = 'hygiene' as const;

    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as HygieneOptions;
        const checkDead = opts.checkDeadCode !== false;
        const checkNaming = opts.checkNaming !== false;
        const checkStubs = opts.checkTemporaryStubs !== false;
        const checkClones = opts.checkDuplicateBlocks !== false;
        const minCloneLines = opts.minCloneLines ?? DEFAULT_MIN_CLONE_LINES;

        const issues: Issue[] = [];
        const content = ctx.content || '';
        const len = content.length;
        const file = ctx.filePath.replace(/\\/g, '/');

        if (checkNaming) {
            this.auditFileNaming(file, ctx, issues);
            if (file.endsWith('.py')) this.auditPythonNaming(content, file, ctx, issues);
        }

        const { lineHashes, meaningfulLineIndices } = this.auditLineHygiene(
            content,
            len,
            file,
            checkDead,
            checkStubs,
            checkClones,
            ctx,
            issues,
        );

        if (checkClones && lineHashes.length >= minCloneLines * 2) {
            this.auditCloneBlocks(lineHashes, meaningfulLineIndices, minCloneLines, ctx, issues);
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
        const lines = content.split('\n');
        const blocks: Array<{ indent: number; kind: 'class' | 'def' }> = [];
        let inTriple: '"' | "'" | null = null;
        let bracketDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();

            const docResult = this.updateDocstringState(line, trimmed, inTriple);
            inTriple = docResult.inTriple;
            if (docResult.skip || trimmed === '' || trimmed.startsWith('#')) continue;

            const depthAtStart = bracketDepth;
            const codeOnly = trimmed.split('#')[0];
            bracketDepth += this.bracketDelta(codeOnly);

            const indent = line.length - line.trimStart().length;
            const inClassBody = this.updateBlockNesting(indent, blocks);

            // Inside an open call/collection every `name=` is a keyword argument, not a binding.
            if (depthAtStart > 0) continue;

            this.auditPythonLineBindings(trimmed, i, inClassBody, file, ctx, issues);

            if (PY_CLASS_RE.test(trimmed)) blocks.push({ indent, kind: 'class' });
            else if (PY_DEF_LINE_RE.test(trimmed)) blocks.push({ indent, kind: 'def' });
        }
    }

    private updateDocstringState(
        line: string,
        trimmed: string,
        inTriple: '"' | "'" | null,
    ): { inTriple: '"' | "'" | null; skip: boolean } {
        if (inTriple) {
            const closers =
                inTriple === '"' ? line.split('"""').length - 1 : line.split("'''").length - 1;
            return { inTriple: closers > 0 ? null : inTriple, skip: true };
        }
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            const marker = trimmed.startsWith('"""') ? '"""' : "'''";
            const nextTriple =
                trimmed.split(marker).length - 1 < 2 ? (marker === '"""' ? '"' : "'") : null;
            return { inTriple: nextTriple, skip: true };
        }
        return { inTriple: null, skip: false };
    }

    private updateBlockNesting(
        indent: number,
        blocks: Array<{ indent: number; kind: 'class' | 'def' }>,
    ): boolean {
        while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop();
        return blocks.length > 0 && blocks[blocks.length - 1].kind === 'class';
    }

    private checkPythonName(
        lineIdx: number,
        name: string,
        kind: typeof PY_BINDING_ASSIGNMENT | 'parameter',
        inClassBody: boolean,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (name === 'self' || name === 'cls') return;
        const builtinExempt = inClassBody || (kind === 'parameter' && PY_PROTOCOL_FIELDS.has(name));
        if (!builtinExempt && PY_BUILTIN_NAMES.has(name)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'HYG-BLT-001',
                    `Name '${name}' shadows a Python builtin`,
                    SEVERITY_WARNING,
                    { file, name, kind },
                    'Rename the binding (e.g. add a domain qualifier); shadowing builtins hides the standard meaning.',
                ),
            );
        }
        if (name.length === 1 && !PY_SHORT_ALLOWED.has(name)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'HYG-SGL-001',
                    `Single-letter name '${name}' hurts readability`,
                    SEVERITY_WARNING,
                    { file, name, kind },
                    "Use a descriptive name; only 'i'/'j'/'k' and '_' are tolerated as throwaways.",
                ),
            );
        }
    }

    private auditPythonLineBindings(
        trimmed: string,
        lineIdx: number,
        inClassBody: boolean,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const exceptMatch = PY_EXCEPT_AS_RE.exec(trimmed);
        if (exceptMatch && exceptMatch[1] !== PY_EXCEPT_NAME) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'HYG-EXC-001',
                    `Exception variable '${exceptMatch[1]}' should be named '${PY_EXCEPT_NAME}'`,
                    SEVERITY_WARNING,
                    { file, name: exceptMatch[1] },
                    `Rename the handler binding to '${PY_EXCEPT_NAME}' so error-handling code reads uniformly.`,
                ),
            );
        }

        const defMatch = PY_DEF_LINE_RE.exec(trimmed);
        if (defMatch) {
            this.auditPythonDefParameters(defMatch[1], lineIdx, file, ctx, issues);
        }

        const assignMatch = PY_ASSIGN_RE.exec(trimmed);
        if (assignMatch) {
            this.checkPythonName(
                lineIdx,
                assignMatch[1],
                PY_BINDING_ASSIGNMENT,
                inClassBody,
                file,
                ctx,
                issues,
            );
        }

        const forMatch = PY_FOR_RE.exec(trimmed);
        if (forMatch) {
            this.checkPythonName(
                lineIdx,
                forMatch[1],
                PY_BINDING_ASSIGNMENT,
                inClassBody,
                file,
                ctx,
                issues,
            );
        }

        if (/^(?:async\s+)?with\b/.test(trimmed)) {
            this.auditPythonWithBindings(trimmed, lineIdx, inClassBody, file, ctx, issues);
        }
    }

    private auditPythonDefParameters(
        rawArgsList: string,
        lineIdx: number,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        for (const rawArg of rawArgsList.split(',')) {
            const cleaned = rawArg.trim().replace(/^\*{0,2}/, '');
            const name = cleaned.split(/[:=]/)[0].trim();
            if (!name || name === '/') continue;
            this.checkPythonName(lineIdx, name, 'parameter', false, file, ctx, issues);
        }
    }

    private auditPythonWithBindings(
        trimmed: string,
        lineIdx: number,
        inClassBody: boolean,
        file: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        PY_WITH_AS_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = PY_WITH_AS_RE.exec(trimmed)) !== null) {
            this.checkPythonName(
                lineIdx,
                match[1],
                PY_BINDING_ASSIGNMENT,
                inClassBody,
                file,
                ctx,
                issues,
            );
        }
    }

    /**
     * Net bracket balance of a code line, used to recognise multi-line call arguments.
     *
     * @param code - Line content with any trailing comment removed.
     * @returns Open minus closed brackets; a negative value means the line closed a call.
     */
    private bracketDelta(code: string): number {
        let depth = 0;
        for (const ch of code) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;
        }
        return depth;
    }

    private auditFileNaming(file: string, ctx: AnalyzerContext, issues: Issue[]): void {
        const baseName = path.basename(file);
        const ext = path.extname(baseName);
        const nameWithoutExt = baseName.slice(0, baseName.length - ext.length);

        if (isExemptFileName(nameWithoutExt)) {
            return;
        }

        if (ext === '.ts' || ext === '.js') {
            const desc = checkJsTsNaming(baseName, nameWithoutExt);
            if (desc) {
                issues.push(
                    this.mkIssue(
                        ctx,
                        0,
                        'HYG-NAM-001',
                        desc.message,
                        'info',
                        { file, baseName },
                        desc.suggestion,
                    ),
                );
            }
            return;
        }

        if (ext === '.gd' || ext === '.py' || ext === '.rs') {
            const desc = checkSnakeNaming(baseName, nameWithoutExt);
            if (desc) {
                issues.push(
                    this.mkIssue(
                        ctx,
                        0,
                        'HYG-NAM-001',
                        desc.message,
                        SEVERITY_WARNING,
                        { file, baseName },
                        desc.suggestion,
                    ),
                );
            }
        }
    }

    private auditLineHygiene(
        content: string,
        len: number,
        file: string,
        checkDead: boolean,
        checkStubs: boolean,
        checkClones: boolean,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): { lineHashes: number[]; meaningfulLineIndices: number[] } {
        const isIndentBased = file.endsWith('.py') || file.endsWith('.gd');
        const jargonRe = buildJargonRe((ctx.options as HygieneOptions | undefined)?.jargonPatterns);
        let lineStart = 0;
        let lineIdx = 0;
        const deadState = { hadTerminalStmt: false, lastTerminalIndent: 0 };

        const lineHashes: number[] = [];
        const meaningfulLineIndices: number[] = [];

        while (lineStart < len) {
            const { lineText, nextStart } = this.extractLine(content, lineStart, len);
            const trimmed = lineText.trim();
            const indent = this.calculateIndent(lineText);

            if (checkDead) {
                this.auditDeadCode(trimmed, indent, lineIdx, isIndentBased, deadState, ctx, issues);
            }

            if (checkStubs) {
                this.auditStubsAndJargon(trimmed, lineIdx, jargonRe, ctx, issues);
            }

            if (checkClones) {
                this.recordCloneCandidate(trimmed, lineIdx, lineHashes, meaningfulLineIndices);
            }

            lineIdx++;
            lineStart = nextStart;
        }

        return { lineHashes, meaningfulLineIndices };
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
            trimmed.startsWith('.') ||
            trimmed.startsWith('}') ||
            trimmed.startsWith('case ') ||
            trimmed.startsWith('default:') ||
            trimmed.startsWith('else:') ||
            trimmed.startsWith('elif ') ||
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

    private auditDeadCode(
        trimmed: string,
        indent: number,
        lineIdx: number,
        isIndentBased: boolean,
        state: { hadTerminalStmt: boolean; lastTerminalIndent: number },
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (state.hadTerminalStmt) {
            if (
                this.isContinuationOrBoundary(
                    trimmed,
                    indent,
                    isIndentBased,
                    state.lastTerminalIndent,
                )
            ) {
                state.hadTerminalStmt = false;
            } else if (this.isMeaningfulDeadCodeSnippet(trimmed)) {
                const desc = HygieneMessages.UNREACHABLE_CODE;
                issues.push(
                    this.mkIssue(
                        ctx,
                        lineIdx,
                        'HYG-DED-001',
                        desc.message,
                        SEVERITY_WARNING,
                        {
                            line: lineIdx + 1,
                            snippet: trimmed.slice(0, UNREACHABLE_SNIPPET_MAX_CHARS),
                        },
                        desc.suggestion,
                    ),
                );
                state.hadTerminalStmt = false;
            }
        }

        if (TERMINAL_STMT_RE.test(trimmed)) {
            const endsWithContinuation = /[({[,\\?:|&+\-*\/]\s*$/.test(trimmed);
            if (!endsWithContinuation) {
                state.hadTerminalStmt = true;
                state.lastTerminalIndent = indent;
            }
        }
    }

    private auditStubsAndJargon(
        trimmed: string,
        lineIdx: number,
        jargonRe: RegExp,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (TEMP_STUB_RE.test(trimmed)) {
            const match = trimmed.match(TEMP_STUB_RE);
            const marker = match ? match[0] : 'TODO';
            const desc = HygieneMessages.TEMPORARY_STUB(marker);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'HYG-STB-001',
                    desc.message,
                    'info',
                    { line: lineIdx + 1, marker },
                    desc.suggestion,
                ),
            );
        }

        const jargonMatch = trimmed.match(jargonRe);
        if (
            jargonMatch &&
            !isVocabularyEnumeration(trimmed, jargonMatch.index ?? 0, jargonMatch[0])
        ) {
            const jargon = jargonMatch[0];
            const desc = HygieneMessages.TRANSIENT_JARGON(jargon);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    'HYG-STB-002',
                    desc.message,
                    SEVERITY_WARNING,
                    { line: lineIdx + 1, jargon },
                    desc.suggestion,
                ),
            );
        }
    }

    private recordCloneCandidate(
        trimmed: string,
        lineIdx: number,
        lineHashes: number[],
        meaningfulLineIndices: number[],
    ): void {
        if (
            trimmed &&
            !trimmed.startsWith('//') &&
            !trimmed.startsWith('#') &&
            trimmed !== '{' &&
            trimmed !== '}'
        ) {
            lineHashes.push(hashString32(trimmed));
            meaningfulLineIndices.push(lineIdx);
        }
    }

    private auditCloneBlocks(
        lineHashes: number[],
        meaningfulLineIndices: number[],
        minCloneLines: number,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const blockMap = new Map<number, number>();
        const total = lineHashes.length;

        for (let i = 0; i <= total - minCloneLines; i++) {
            let h = 0;
            for (let k = 0; k < minCloneLines; k++) {
                h = (Math.imul(h, CLONE_ROLLING_HASH_MULTIPLIER) + lineHashes[i + k]) | 0;
            }

            const prevLine = blockMap.get(h);
            if (prevLine !== undefined && i >= prevLine + minCloneLines) {
                const actualStartLine = meaningfulLineIndices[i] + 1;
                const originalLine = meaningfulLineIndices[prevLine] + 1;
                const desc = HygieneMessages.DUPLICATE_CODE_CLONE(minCloneLines, originalLine);
                issues.push(
                    this.mkIssue(
                        ctx,
                        meaningfulLineIndices[i],
                        'HYG-CLN-001',
                        desc.message,
                        SEVERITY_WARNING,
                        { startLine: actualStartLine, originalLine, lineSpan: minCloneLines },
                        desc.suggestion,
                    ),
                );
                break;
            } else if (prevLine === undefined) {
                blockMap.set(h, i);
            }
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
        severity: 'info' | typeof SEVERITY_WARNING | 'error',
        detail: Record<string, any>,
        suggestion?: string,
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
        };
    }
}
