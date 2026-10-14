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
import type { Analyzer, AnalyzerContext, Issue, AgentActionType, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import {
    PY_STDLIB_NAMES,
    PY_LOCAL_ROOTS,
    PY_ABC_TYPING_NAMES,
    SHADOW_IGNORE_NAMES,
} from './python-modern-tables';

const RULE_PYM_PATH_001 = 'PYM-PATH-001';
const RULE_PYM_RAISE_001 = 'PYM-RAISE-001';
const RULE_PYM_DEFAULT_001 = 'PYM-DEFAULT-001';
const RULE_PYM_DATETIME_001 = 'PYM-DATETIME-001';
const RULE_PYM_UNION_001 = 'PYM-UNION-001';
const RULE_PYM_SLOTS_001 = 'PYM-SLOTS-001';
const RULE_PYM_ASYNC_001 = 'PYM-ASYNC-001';
const RULE_PYM_OPEN_001 = 'PYM-OPEN-001';
const RULE_PYM_SHADOW_001 = 'PYM-SHADOW-001';
const RULE_PYM_FSTRING_001 = 'PYM-FSTRING-001';
const RULE_PYM_GENERIC_001 = 'PYM-GENERIC-001';
const RULE_PYM_ABC_001 = 'PYM-ABC-001';
const RULE_PYM_IMPORT_001 = 'PYM-IMPORT-001';

const ACTION_APPLY_GUARD = 'apply_guard_clause';
const ACTION_RENAME_SYMBOL = 'rename_symbol';
const ACTION_SIMPLIFY_CONTROL = 'simplify_control_flow';
const ACTION_REPLACE_TOKEN = 'replace_token';

const SCOPE_KIND_MODULE = 'module';
const SCOPE_KIND_FUNCTION = 'function';
const SCOPE_KIND_CLASS = 'class';
const BLOCK_KIND_DEF = 'def';
const BLOCK_KIND_CLASS = 'class';
const BLOCK_KIND_EXCEPT = 'except';
const BLOCK_KIND_WITH = 'with';
const BLOCK_KIND_OTHER = 'other';
const PREFIX_OS_PATH = 'os.path.';

const BLOCK_OPEN_RE = /:\s*(?:#.*)?$/;
const ASYNC_DEF_RE = /^\s*async\s+def\b/;
const DEF_RE = /^\s*def\b/;
const CLASS_RE = /^\s*class\b/;
const EXCEPT_RE = /^\s*except\b/;
const WITH_RE = /^\s*(?:async\s+)?with\b/;

/* Shadowing detection (PYM-SHADOW-001) --------------------------------------------------- */

/** Direct assignment: `name = value` — excludes `==`, `+=`, `-=`, etc. */
const ASSIGN_RE = /^\s*([A-Za-z_]\w*)\s*=(?!=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=|\*\*=|\/\/=)/;
/** for loop variable: `for x in ...:` */
const FOR_VAR_RE = /^\s*for\s+([A-Za-z_]\w*)\s+in\b/;
/** Function definition with parameters: `def foo(a, b, c):` */
const DEF_PARAMS_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
/** with statement target: `with ... as f:` */
const WITH_AS_RE = /^\s*(?:async\s+)?with\b.*\bas\s+([A-Za-z_]\w*)\s*[:,#]/;
/** except clause target: `except Exception as e:` */
const EXCEPT_AS_RE = /^\s*except\b.*\bas\s+([A-Za-z_]\w*)\s*:/;
/** import statement: `import os` or `from sys import path` */
const IMPORT_SIMPLE_RE = /^\s*import\s+([A-Za-z_]\w*)/;
const IMPORT_FROM_RE = /^\s*from\s+[A-Za-z_.\w]+\s+import\s+(.+)$/;

const BLOCKING_CALL_RE =
    /\b(?:time\.sleep|requests\.(?:get|post|put|patch|delete|request)|urllib\.request\.urlopen)\s*\(/;
const SYNC_ORM_CALL_RE = /(?<![\w.])(?:[A-Za-z_]\w*\.)*(?:session|Session)\.(?:query|execute)\s*\(/;
const AWAITED_ORM_CALL_RE = /await\s+[^=;]*\b(?:session|Session)\.(?:query|execute)\s*\(/;
const MUTABLE_DEFAULT_RE = /=\s*(?:\[|\{|(?:list|dict|set)\s*\()/;
const PERCENT_FORMAT_RE = /(?:'[^']*%[sdrfioxeg%][^']*'|"[^"]*%[sdrfioxeg%][^"]*")\s*%/;
const RAISE_RE = /^raise\s+\S/;
const RAISE_FROM_RE = /^raise\b[^\n]*\bfrom\b/;

/** Maximum number of following lines inspected for a `from` cause clause on a multi-line raise. */
const RAISE_CAUSE_LOOKAHEAD_LINES = 5;

/** Block kind for an `async def` frame; mirrors the Python `async` keyword token. */
const PYTHON_ASYNC_KEYWORD = 'async';
const PY_PEP585_RE = /\b(?:typing\.)?(List|Dict|Set|FrozenSet|Tuple|Type)\s*\[/;
const ABC_IMPORT_RE = /^from\s+typing\s+import\s+(.+)$/;
const PY_PEP604_ANN_ASSIGN_RE =
    /^\s*[A-Za-z_]\w*\s*:\s*(?:typing\.)?(?:Optional|Union)\s*\[[^\]]*\]\s*=/;
const PY_PEP604_ALIAS_RE = /^\s*[A-Za-z_]\w*\s*=\s*(?:typing\.)?(?:Optional|Union)\s*\[/;
const PY_DATACLASS_RE = /^@(?:dataclasses\.)?dataclass\b/;

const SECTION_LABEL_STDLIB = 'stdlib';
const SECTION_LABEL_THIRD_PARTY = 'third-party';
const SECTION_LABEL_LOCAL = 'local';
const SECTION_LABELS: readonly string[] = Object.freeze([
    SECTION_LABEL_STDLIB,
    SECTION_LABEL_THIRD_PARTY,
    SECTION_LABEL_LOCAL,
]);

const SECTION_STDLIB_INDEX = 0;
const SECTION_THIRD_PARTY_INDEX = 1;
const SECTION_LOCAL_INDEX = 2;

const SNIPPET_PATH = 'Path($1) / $2';
const SNIPPET_RAISE = 'raise $1 from $2';
const SNIPPET_DEFAULT = '$1: $2 = None';
const SNIPPET_DATETIME = 'datetime.UTC';
const SNIPPET_UNION = '$1 | None';
const SNIPPET_SLOTS = '@dataclass(slots=True)';
const SNIPPET_ASYNC = 'await asyncio.to_thread($1)';
const SNIPPET_OPEN = 'with open($1) as $2:';
const SNIPPET_SHADOW = '$1_renamed';
const SNIPPET_FSTRING = 'f"{$1}"';
const SNIPPET_GENERIC = '$1[$2]';
const SNIPPET_ABC = 'from collections.abc import $1';
const SNIPPET_IMPORT = 'import $1';

/** Issue metadata specification for constructing structured findings. */
interface IssueSpec {
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
}

const SPEC_PATH: IssueSpec = Object.freeze({
    rule: RULE_PYM_PATH_001,
    severity: SEVERITY_WARNING,
    message: 'os.path usage: prefer pathlib.Path for path manipulation.',
    suggestion:
        'Build paths with pathlib.Path (`Path(...) / name`), which is OS-neutral and self-documenting.',
});

const SPEC_FSTRING: IssueSpec = Object.freeze({
    rule: RULE_PYM_FSTRING_001,
    severity: SEVERITY_WARNING,
    message: 'Percent-formatting is legacy: f-strings are faster and harder to misalign.',
    suggestion: 'Rewrite as an f-string (`f"...{value}"`).',
});

const SPEC_DATETIME: IssueSpec = Object.freeze({
    rule: RULE_PYM_DATETIME_001,
    severity: SEVERITY_ERROR,
    message: 'timezone.utc is superseded by the datetime.UTC singleton.',
    suggestion: 'Use `datetime.UTC` (PEP 615 / ruff UP017).',
});

const SPEC_UNION: IssueSpec = Object.freeze({
    rule: RULE_PYM_UNION_001,
    severity: SEVERITY_ERROR,
    message: 'Optional/Union in an annotation or alias: PEP 604 unions read better.',
    suggestion: 'Write `X | None` / `X | Y` instead of Optional/Union.',
});

const SPEC_RAISE: IssueSpec = Object.freeze({
    rule: RULE_PYM_RAISE_001,
    severity: SEVERITY_WARNING,
    message: '`raise` inside an except block without `from` drops the original exception chain.',
    suggestion:
        'Re-raise with `raise NewError(...) from exc` (or a bare `raise` to propagate unchanged).',
});

const SPEC_DEFAULT: IssueSpec = Object.freeze({
    rule: RULE_PYM_DEFAULT_001,
    severity: SEVERITY_WARNING,
    message:
        'Mutable default argument detected: the default is created once and shared by every call.',
    suggestion: 'Use a `None` sentinel and build the list/dict/set inside the body.',
});

const SPEC_OPEN: IssueSpec = Object.freeze({
    rule: RULE_PYM_OPEN_001,
    severity: SEVERITY_WARNING,
    message: '`open()` without a `with` block leaks the file handle on error paths.',
    suggestion:
        'Wrap the call in `with open(...) as handle:` so the handle closes deterministically.',
});

const SPEC_ASYNC_BLOCKING: IssueSpec = Object.freeze({
    rule: RULE_PYM_ASYNC_001,
    severity: SEVERITY_ERROR,
    message: 'Blocking call inside an async function blocks the event loop.',
    suggestion:
        'Use the async equivalent (asyncio.sleep, httpx, async repository) or run the blocking call in a thread.',
});

const SPEC_ASYNC_ORM: IssueSpec = Object.freeze({
    rule: RULE_PYM_ASYNC_001,
    severity: SEVERITY_ERROR,
    message: 'Synchronous ORM call inside an async function is not awaited.',
    suggestion:
        'Await the async session (`await session.execute(...)`) or use the async repository API.',
});

const SPEC_SLOTS: IssueSpec = Object.freeze({
    rule: RULE_PYM_SLOTS_001,
    severity: SEVERITY_WARNING,
    message:
        'Dataclass without slots=True: instances carry a __dict__ and typos create silent attributes.',
    suggestion:
        'Add `slots=True` (or an explicit `slots=False` when __dict__ is genuinely required).',
});

const SPEC_IMPORT_ORDER: IssueSpec = Object.freeze({
    rule: RULE_PYM_IMPORT_001,
    severity: SEVERITY_WARNING,
    message: 'Import section order violated.',
    suggestion: 'Group imports as stdlib → third-party → local (PEP 8), separated by blank lines.',
});

interface ActionableSpec {
    readonly action?: AgentActionType;
    readonly code: string;
    readonly safeToAutomate?: boolean;
    readonly templateSnippet: string;
}

interface ActionableConfigEntry {
    readonly rule: string;
    readonly codeId: string;
    readonly snippet: string;
    readonly action?: AgentActionType;
    readonly autoSafe?: boolean;
}

const ACTIONABLE_SPECS_TABLE: readonly ActionableConfigEntry[] = [
    { rule: RULE_PYM_PATH_001, codeId: '001', snippet: SNIPPET_PATH },
    {
        rule: RULE_PYM_RAISE_001,
        codeId: '002',
        snippet: SNIPPET_RAISE,
        action: ACTION_APPLY_GUARD,
    },
    {
        rule: RULE_PYM_DEFAULT_001,
        codeId: '003',
        snippet: SNIPPET_DEFAULT,
        action: ACTION_APPLY_GUARD,
    },
    { rule: RULE_PYM_DATETIME_001, codeId: '004', snippet: SNIPPET_DATETIME, autoSafe: true },
    { rule: RULE_PYM_UNION_001, codeId: '005', snippet: SNIPPET_UNION, autoSafe: true },
    { rule: RULE_PYM_SLOTS_001, codeId: '006', snippet: SNIPPET_SLOTS },
    {
        rule: RULE_PYM_ASYNC_001,
        codeId: '007',
        snippet: SNIPPET_ASYNC,
        action: ACTION_APPLY_GUARD,
    },
    {
        rule: RULE_PYM_OPEN_001,
        codeId: '008',
        snippet: SNIPPET_OPEN,
        action: ACTION_APPLY_GUARD,
    },
    {
        rule: RULE_PYM_SHADOW_001,
        codeId: '009',
        snippet: SNIPPET_SHADOW,
        action: ACTION_RENAME_SYMBOL,
    },
    { rule: RULE_PYM_FSTRING_001, codeId: '010', snippet: SNIPPET_FSTRING },
    { rule: RULE_PYM_GENERIC_001, codeId: '011', snippet: SNIPPET_GENERIC, autoSafe: true },
    { rule: RULE_PYM_ABC_001, codeId: '012', snippet: SNIPPET_ABC, autoSafe: true },
    {
        rule: RULE_PYM_IMPORT_001,
        codeId: '013',
        snippet: SNIPPET_IMPORT,
        action: ACTION_SIMPLIFY_CONTROL,
    },
];

function buildActionableSpecMap(
    entries: readonly ActionableConfigEntry[],
): Record<string, ActionableSpec> {
    const map: Record<string, ActionableSpec> = {};
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const configEntry = entries[entryIndex];
        map[configEntry.rule] = {
            action: configEntry.action ?? ACTION_REPLACE_TOKEN,
            code: `AR:PYM:${configEntry.codeId}`,
            safeToAutomate: configEntry.autoSafe ?? false,
            templateSnippet: configEntry.snippet,
        };
    }
    return map;
}

const ACTIONABLE_SPECS: Readonly<Record<string, ActionableSpec>> = Object.freeze(
    buildActionableSpecMap(ACTIONABLE_SPECS_TABLE),
);

/** One module-level import statement captured for the ordering rule (PYM-IMPORT-001). */
interface ImportRecord {
    readonly line: number;
    readonly text: string;
    readonly section: number;
}

type BlockKind = typeof PYTHON_ASYNC_KEYWORD | 'def' | 'class' | 'except' | 'with' | 'other';

interface Block {
    readonly indent: number;
    readonly kind: BlockKind;
}

/**
 * A Python lexical scope tracked for outer-scope shadowing detection (PYM-SHADOW-001).
 *
 * Python has LEGB scoping — only modules, functions, classes, and comprehensions introduce
 * new scopes. Control-flow blocks (if/for/while/with/try) do NOT create new bindings; names
 * assigned inside them leak into the enclosing function / class / module scope.
 */
interface VarScope {
    readonly indent: number;
    readonly kind: 'module' | 'function' | 'class';
    readonly names: Map<string, number>; // name -> 1-based line number of first declaration
}

/** Options shape for the shadowing rule, resolved from `ctx.options.shadowing`. */
interface ShadowingOptions {
    readonly enabled: boolean;
    readonly ignoreNames: Set<string>;
}

type PyEmitter = (
    targetLineIndex: number,
    spec: IssueSpec,
    detail: Record<string, unknown>,
) => void;

interface PyLineScanContext {
    readonly line: string;
    readonly trimmed: string;
    readonly lineIndex: number;
    readonly emit: PyEmitter;
}

interface PyBlockContext {
    readonly inExcept: boolean;
    readonly inWith: boolean;
    readonly inAsync: boolean;
}

interface PyShadowContext {
    readonly indent: number;
    readonly varScopes: VarScope[];
    readonly opts: ShadowingOptions;
    readonly emit: PyEmitter;
}

interface PyImportAccumulator {
    readonly file: string;
    readonly records: ImportRecord[];
}

/**
 * Python modernization analyzer.
 *
 * Content-only by design: `finalize` is the path the engine actually invokes (a bare `analyze`
 * would be skipped for non-TypeScript files, because only TS-family adapters materialize a
 * `ts.SourceFile`); `analyze` remains the standalone contract. Only `.py` paths are inspected.
 */
export class PythonModernAnalyzer implements Analyzer {
    name = 'python-modern' as const;

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
        const lines = content.split('\n');
        const blocks: Block[] = [];
        const importRecords: ImportRecord[] = [];
        const issues: Issue[] = [];
        const emit = this.createIssueEmitter(file, issues);

        // Shadowing: initialize with a module-level scope (indent -1 so it is never popped).
        const varScopes: VarScope[] = [
            { indent: -1, kind: SCOPE_KIND_MODULE, names: new Map<string, number>() },
        ];
        const shadowOpts = this.resolveShadowingOptions(ctx.options);
        const importAcc: PyImportAccumulator = { file, records: importRecords };

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            let line = lines[lineIndex];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;

            const indent = line.length - line.trimStart().length;
            this.popScopesForIndent(indent, blocks, varScopes);

            const scanCtx: PyLineScanContext = { line, trimmed, lineIndex, emit };
            const blockCtx: PyBlockContext = {
                inExcept: this.hasKind(blocks, BLOCK_KIND_EXCEPT),
                inWith: this.hasKind(blocks, BLOCK_KIND_WITH),
                inAsync: this.hasKind(blocks, PYTHON_ASYNC_KEYWORD),
            };
            const shadowCtx: PyShadowContext = {
                indent,
                varScopes,
                opts: shadowOpts,
                emit,
            };

            this.auditModernSyntax(scanCtx);
            this.auditModernTyping(scanCtx);
            this.auditControlFlow(scanCtx, lines, blockCtx);
            this.auditDataclassSlots(scanCtx, lines);
            this.recordModuleImports(scanCtx, indent, blocks, importAcc);
            this.auditVariableShadowing(scanCtx, shadowCtx);

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
            const lineNumber = targetLineIndex + 1;
            const issuePayload: Issue = {
                id: `python-modern:${spec.rule}:${file}:${lineNumber}`,
                analyzer: this.name,
                rule: spec.rule,
                severity: spec.severity,
                message: spec.message,
                location: {
                    file,
                    start: { line: lineNumber, column: 1 },
                    end: { line: lineNumber, column: 1 },
                },
                detail,
                suggestion: spec.suggestion,
            };

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

        if (line.includes(PREFIX_OS_PATH)) {
            emit(lineIndex, SPEC_PATH, { line: trimmed });
        }

        if (PERCENT_FORMAT_RE.test(line)) {
            emit(lineIndex, SPEC_FSTRING, { line: trimmed });
        }

        if (/\btimezone\.utc\b/.test(line)) {
            emit(lineIndex, SPEC_DATETIME, { line: trimmed });
        }

        if (PY_PEP604_ANN_ASSIGN_RE.test(line) || PY_PEP604_ALIAS_RE.test(line)) {
            emit(lineIndex, SPEC_UNION, { line: trimmed });
        }
    }

    private auditModernTyping(scanCtx: PyLineScanContext): void {
        const line = scanCtx.line;
        const lineIndex = scanCtx.lineIndex;
        const trimmed = scanCtx.trimmed;
        const emit = scanCtx.emit;

        if (PY_PEP585_RE.test(line)) {
            const hit = PY_PEP585_RE.exec(line)?.[1] ?? '';
            const spec: IssueSpec = {
                rule: RULE_PYM_GENERIC_001,
                severity: SEVERITY_ERROR,
                message: `typing.${hit}[...] is legacy: PEP 585 parameterizes the builtin instead.`,
                suggestion: `Use \`${hit.toLowerCase()}[...]\` rather than typing.${hit}.`,
            };
            emit(lineIndex, spec, { line: trimmed, name: hit });
        }

        const abcImport = ABC_IMPORT_RE.exec(trimmed);
        if (abcImport) {
            const offenders = abcImport[1]
                .replace(/[()]/g, '')
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
                    suggestion:
                        'Import these names from collections.abc (the typing aliases are deprecated).',
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
            RAISE_FROM_RE.test(codeOnly) ||
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
        const isDef = ASYNC_DEF_RE.test(line) || DEF_RE.test(line) || CLASS_RE.test(line);
        if (!isDef) return;
        const parenIdx = line.indexOf('(');
        if (parenIdx === -1) return;
        const signature = line.slice(parenIdx + 1);
        if (signature !== '' && MUTABLE_DEFAULT_RE.test(signature)) {
            scanCtx.emit(scanCtx.lineIndex, SPEC_DEFAULT, { line: scanCtx.trimmed });
        }
    }

    private auditUnmanagedOpen(scanCtx: PyLineScanContext, inWith: boolean): void {
        if (!inWith && /\bopen\s*\(/.test(scanCtx.line) && !WITH_RE.test(scanCtx.line)) {
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

        if (blockCtx.inAsync && !ASYNC_DEF_RE.test(scanCtx.line)) {
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
        if (/^class\s+[A-Za-z_]\w*\s*:/.test(next) && !/\bslots\s*=/.test(scanCtx.trimmed)) {
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
        if (moduleLevel && /^(?:import|from)\s+/.test(scanCtx.trimmed)) {
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
        const fromMatch = /^from\s+([A-Za-z_][\w.]*)\s+import\b/.exec(text);
        const importMatch = /^import\s+([A-Za-z_][\w.]*)/.exec(text);
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
        for (const record of records) sections[record.section].push(record);
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
                    suggestion: 'Sort each import section alphabetically by whole line.',
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

    /**
     * Resolve shadowing-rule options from the analyzer-level `options` bag.
     *
     * @param options - The analyzer's merged options (from `ctx.options`).
     * @returns Normalized shadowing options with defaults applied.
     */
    private resolveShadowingOptions(options: Record<string, any>): ShadowingOptions {
        const raw = (options?.shadowing ?? {}) as Record<string, unknown>;
        const enabled = raw.enabled !== false; // default: on
        const ignoreNames = new Set<string>(SHADOW_IGNORE_NAMES);
        if (Array.isArray(raw.ignoreNames)) {
            for (const name of raw.ignoreNames) {
                if (typeof name === 'string') ignoreNames.add(name);
            }
        }
        return { enabled, ignoreNames };
    }

    /**
     * Detect outer-scope variable shadowing (PYM-SHADOW-001).
     *
     * Heuristic, text-level implementation: tracks names per function/class/module scope
     * on a parallel stack (`varScopes`). Assignments, for-loop variables, function
     * parameters, `with ... as`, `except ... as`, and imports are all treated as bindings.
     * Control-flow blocks (if/for/while/with/try) do NOT create new scopes — matching
     * Python's actual LEGB rule.
     *
     * @param scanCtx - Current line scan context.
     * @param shadowCtx - Active lexical scoping and shadowing context.
     */
    private auditVariableShadowing(scanCtx: PyLineScanContext, shadowCtx: PyShadowContext): void {
        if (!shadowCtx.opts.enabled) return;

        const codeOnly = scanCtx.trimmed.split('#')[0].trim();
        const targetLine = scanCtx.lineIndex + 1;

        if (this.auditDefAndClassShadowing(scanCtx.line, targetLine, shadowCtx)) {
            return;
        }
        if (this.auditImportShadowing(scanCtx.line, codeOnly, targetLine, shadowCtx)) {
            return;
        }
        if (this.auditContextBindingShadowing(scanCtx.line, targetLine, shadowCtx)) {
            return;
        }
        this.auditAssignShadowing(scanCtx.line, targetLine, shadowCtx);
    }

    private getTopScope(shadowCtx: PyShadowContext): VarScope {
        return shadowCtx.varScopes[shadowCtx.varScopes.length - 1];
    }

    private auditDefAndClassShadowing(
        line: string,
        targetLine: number,
        shadowCtx: PyShadowContext,
    ): boolean {
        const enclosingScope = this.getTopScope(shadowCtx);
        const defMatch = DEF_PARAMS_RE.exec(line);
        if (defMatch) {
            const funcName = defMatch[1];
            const paramsStr = defMatch[2];
            this.registerBinding(funcName, targetLine, enclosingScope, shadowCtx);
            const isAsync = ASYNC_DEF_RE.test(line);
            const newKind = isAsync || DEF_RE.test(line) ? SCOPE_KIND_FUNCTION : SCOPE_KIND_CLASS;
            const newScope: VarScope = {
                indent: shadowCtx.indent,
                kind: newKind,
                names: new Map(),
            };
            shadowCtx.varScopes.push(newScope);

            if (newKind === SCOPE_KIND_FUNCTION) {
                const paramNames = this.extractParamNames(paramsStr);
                for (const paramName of paramNames) {
                    this.registerBinding(paramName, targetLine, newScope, shadowCtx);
                }
            }
            return true;
        }

        if (CLASS_RE.test(line)) {
            const clsMatch = /^\s*class\s+([A-Za-z_]\w*)/.exec(line);
            if (clsMatch) {
                this.registerBinding(clsMatch[1], targetLine, enclosingScope, shadowCtx);
            }
            const newScope: VarScope = {
                indent: shadowCtx.indent,
                kind: SCOPE_KIND_CLASS,
                names: new Map(),
            };
            shadowCtx.varScopes.push(newScope);
            return true;
        }

        return false;
    }

    private auditImportShadowing(
        line: string,
        codeOnly: string,
        targetLine: number,
        shadowCtx: PyShadowContext,
    ): boolean {
        if (!/^(?:import|from)\s+/.test(codeOnly)) return false;
        const moduleScope = this.getTopScope(shadowCtx);

        const simpleImp = IMPORT_SIMPLE_RE.exec(line);
        if (simpleImp) {
            this.registerBinding(simpleImp[1], targetLine, moduleScope, shadowCtx);
        }
        const fromImp = IMPORT_FROM_RE.exec(codeOnly);
        if (fromImp) {
            const namesPart = fromImp[1];
            const items = namesPart.split(',');
            for (const item of items) {
                const trimmedItem = item.trim();
                if (trimmedItem === '' || trimmedItem === '(' || trimmedItem === ')') continue;
                const clean = trimmedItem.replace(/[()]/g, '').trim();
                if (clean === '') continue;
                const asMatch = /^(.+?)\s+as\s+([A-Za-z_]\w*)$/.exec(clean);
                const name = asMatch ? asMatch[2] : clean.split(/\s+/)[0];
                if (/^[A-Za-z_]\w*$/.test(name)) {
                    this.registerBinding(name, targetLine, moduleScope, shadowCtx);
                }
            }
        }
        return true;
    }

    private auditContextBindingShadowing(
        line: string,
        targetLine: number,
        shadowCtx: PyShadowContext,
    ): boolean {
        const activeScope = this.getTopScope(shadowCtx);
        const forMatch = FOR_VAR_RE.exec(line);
        if (forMatch) {
            this.registerBinding(forMatch[1], targetLine, activeScope, shadowCtx);
            return true;
        }

        const withMatch = WITH_AS_RE.exec(line);
        if (withMatch) {
            this.registerBinding(withMatch[1], targetLine, activeScope, shadowCtx);
            return true;
        }

        const exceptMatch = EXCEPT_AS_RE.exec(line);
        if (exceptMatch) {
            this.registerBinding(exceptMatch[1], targetLine, activeScope, shadowCtx);
            return true;
        }

        return false;
    }

    private auditAssignShadowing(
        line: string,
        targetLine: number,
        shadowCtx: PyShadowContext,
    ): void {
        const assignMatch = ASSIGN_RE.exec(line);
        if (assignMatch) {
            const afterEq = line.slice(assignMatch[0].length);
            if (afterEq.startsWith('=')) return;
            const targetScope = this.getTopScope(shadowCtx);
            this.registerBinding(assignMatch[1], targetLine, targetScope, shadowCtx);
        }
    }

    /**
     * Register a binding in the current scope and emit a shadowing warning when the name
     * already exists in any enclosing scope.
     *
     * @param name - The variable/parameter/function name to register.
     * @param targetLine - 1-based line number of the declaration.
     * @param targetScope - The scope the name belongs to.
     * @param shadowCtx - Full shadowing options and scope stack.
     */
    private registerBinding(
        name: string,
        targetLine: number,
        targetScope: VarScope,
        shadowCtx: PyShadowContext,
    ): void {
        if (shadowCtx.opts.ignoreNames.has(name)) return;

        // If the name already exists in the SAME scope, this is a reassignment, not shadowing.
        if (targetScope.names.has(name)) return;

        // Walk outer scopes (skip the current one) looking for a prior declaration.
        let outerLine = -1;
        const scopes = shadowCtx.varScopes;
        for (let scopeIndex = scopes.length - 2; scopeIndex >= 0; scopeIndex--) {
            const found = scopes[scopeIndex].names.get(name);
            if (found !== undefined) {
                outerLine = found;
                break;
            }
        }

        if (outerLine > 0) {
            const spec: IssueSpec = {
                rule: RULE_PYM_SHADOW_001,
                severity: SEVERITY_WARNING,
                message: `Variable \`${name}\` may shadow an outer-scope declaration (line ${outerLine}).`,
                suggestion:
                    'Rename the variable or use a different name to avoid shadowing the outer binding.',
            };
            shadowCtx.emit(targetLine - 1, spec, {
                name,
                outerLine,
                scope: targetScope.kind,
            });
        }

        targetScope.names.set(name, targetLine);
    }

    /**
     * Parse a Python function parameter string and return the parameter names.
     *
     * Handles simple names, defaults (`x=1`), type annotations (`x: int`), *args, **kwargs,
     * and `/` / `*` positional-only / keyword-only markers. Multi-line signatures are not
     * supported — this is a heuristic, line-level parser.
     *
     * @param paramsStr - The raw text inside the parentheses of a `def` line.
     * @returns Array of parameter names in declaration order.
     */
    private extractParamNames(paramsStr: string): string[] {
        const parts = this.splitParamParts(paramsStr);
        const names: string[] = [];
        for (const part of parts) {
            const name = this.sanitizeParamName(part);
            if (name) {
                names.push(name);
            }
        }
        return names;
    }

    private splitParamParts(paramsStr: string): string[] {
        let depth = 0;
        let current = '';
        const parts: string[] = [];
        for (const ch of paramsStr) {
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            else if (ch === ')' || ch === ']' || ch === '}') depth--;
            if (ch === ',' && depth === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim() !== '') parts.push(current);
        return parts;
    }

    private sanitizeParamName(part: string): string | null {
        const trimmed = part.trim();
        if (trimmed === '' || trimmed === '/' || trimmed === '*') return null;
        let cleaned = trimmed.replace(/^\*{1,2}/, '').trim();
        const eqIdx = cleaned.indexOf('=');
        const colonIdx = cleaned.indexOf(':');
        if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
            cleaned = cleaned.slice(0, colonIdx).trim();
        }
        if (eqIdx !== -1) {
            cleaned = cleaned.slice(0, eqIdx).trim();
        }
        return /^[A-Za-z_]\w*$/.test(cleaned) ? cleaned : null;
    }

    private resolveBlockKind(trimmed: string): BlockKind {
        if (ASYNC_DEF_RE.test(trimmed)) return PYTHON_ASYNC_KEYWORD;
        if (DEF_RE.test(trimmed)) return BLOCK_KIND_DEF;
        if (CLASS_RE.test(trimmed)) return BLOCK_KIND_CLASS;
        if (EXCEPT_RE.test(trimmed)) return BLOCK_KIND_EXCEPT;
        return WITH_RE.test(trimmed) ? BLOCK_KIND_WITH : BLOCK_KIND_OTHER;
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
