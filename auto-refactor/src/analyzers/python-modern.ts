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

/** Idiomatic single-letter / conventional names exempt from shadowing warnings. */
const SHADOW_IGNORE_NAMES = new Set(
    '_ self cls i j k n x y z e ex f fd fp fh t s v w h d r g p q a b c'.split(' '),
);

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

/** Python stdlib top-level modules (`sys.stdlib_module_names` + `__future__`). */
const PY_STDLIB_NAMES = new Set(
    (
        '__future__ _abc _aix_support _ast _asyncio _bisect _blake2 _bootsubprocess _bz2 _codecs _codecs_cn ' +
        '_codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw _collections _collections_abc _compat_pickle ' +
        '_compression _contextvars _crypt _csv _ctypes _curses _curses_panel _datetime _dbm _decimal _elementtree ' +
        '_frozen_importlib _frozen_importlib_external _functools _gdbm _hashlib _heapq _imp _io _json _locale ' +
        '_lsprof _lzma _markupbase _md5 _msi _multibytecodec _multiprocessing _opcode _operator _osx_support ' +
        '_overlapped _pickle _posixshmem _posixsubprocess _py_abc _pydecimal _pyio _queue _random _scproxy _sha1 ' +
        '_sha256 _sha3 _sha512 _signal _sitebuiltins _socket _sqlite3 _sre _ssl _stat _statistics _string ' +
        '_strptime _struct _symtable _thread _threading_local _tkinter _tokenize _tracemalloc _typing _uuid ' +
        '_warnings _weakref _weakrefset _winapi _zoneinfo abc aifc antigravity argparse array ast asynchat ' +
        'asyncio asyncore atexit audioop base64 bdb binascii bisect builtins bz2 cProfile calendar cgi cgitb ' +
        'chunk cmath cmd code codecs codeop collections colorsys compileall concurrent configparser contextlib ' +
        'contextvars copy copyreg crypt csv ctypes curses dataclasses datetime dbm decimal difflib dis distutils ' +
        'doctest email encodings ensurepip enum errno faulthandler fcntl filecmp fileinput fnmatch fractions ' +
        'ftplib functools gc genericpath getopt getpass gettext glob graphlib grp gzip hashlib heapq hmac html ' +
        'http idlelib imaplib imghdr imp importlib inspect io ipaddress itertools json keyword lib2to3 linecache ' +
        'locale logging lzma mailbox mailcap marshal math mimetypes mmap modulefinder msilib msvcrt ' +
        'multiprocessing netrc nis nntplib nt ntpath nturl2path numbers opcode operator optparse os ossaudiodev ' +
        'pathlib pdb pickle pickletools pipes pkgutil platform plistlib poplib posix posixpath pprint profile ' +
        'pstats pty pwd py_compile pyclbr pydoc pydoc_data pyexpat queue quopri random re readline reprlib ' +
        'resource rlcompleter runpy sched secrets select selectors shelve shlex shutil signal site smtpd smtplib ' +
        'sndhdr socket socketserver spwd sqlite3 sre_compile sre_constants sre_parse ssl stat statistics string ' +
        'stringprep struct subprocess sunau symtable sys sysconfig syslog tabnanny tarfile telnetlib tempfile ' +
        'termios textwrap this threading time timeit tkinter token tokenize tomllib trace traceback tracemalloc ' +
        'tty turtle turtledemo types typing unicodedata unittest urllib uu uuid venv warnings wave weakref ' +
        'webbrowser winreg winsound wsgiref xdrlib xml xmlrpc zipapp zipfile zipimport zlib zoneinfo'
    ).split(' '),
);
/** Roots treated as first-party imports when the scanned file lives outside them. */
const PY_LOCAL_ROOTS = new Set(['app', 'src', 'lib', 'tests', 'scripts', 'conftest', 'helpers']);
/** Abstract types that belong to `collections.abc` rather than `typing` (PEP 585). */
const PY_ABC_TYPING_NAMES = new Set([
    'Iterable',
    'Iterator',
    'Sequence',
    'MutableSequence',
    'Mapping',
    'MutableMapping',
    'MutableSet',
    'Callable',
    'Awaitable',
    'AsyncIterable',
    'AsyncIterator',
    'AsyncGenerator',
    'Generator',
    'Hashable',
    'Sized',
    'Container',
    'Collection',
    'Reversible',
    'KeysView',
    'ItemsView',
    'ValuesView',
]);
const PY_PEP585_RE = /\b(?:typing\.)?(List|Dict|Set|FrozenSet|Tuple|Type)\s*\[/;
const ABC_IMPORT_RE = /^from\s+typing\s+import\s+(.+)$/;
const PY_PEP604_ANN_ASSIGN_RE =
    /^\s*[A-Za-z_]\w*\s*:\s*(?:typing\.)?(?:Optional|Union)\s*\[[^\]]*\]\s*=/;
const PY_PEP604_ALIAS_RE = /^\s*[A-Za-z_]\w*\s*=\s*(?:typing\.)?(?:Optional|Union)\s*\[/;
const PY_DATACLASS_RE = /^@(?:dataclasses\.)?dataclass\b/;
const SECTION_LABELS = ['stdlib', 'third-party', 'local'];

/** One module-level import statement captured for the ordering rule (PYM-IMPORT-001). */
interface ImportRecord {
    line: number;
    text: string;
    section: number;
}

type BlockKind = typeof PYTHON_ASYNC_KEYWORD | 'def' | 'class' | 'except' | 'with' | 'other';

interface Block {
    indent: number;
    kind: BlockKind;
}

/**
 * A Python lexical scope tracked for outer-scope shadowing detection (PYM-SHADOW-001).
 *
 * Python has LEGB scoping — only modules, functions, classes, and comprehensions introduce
 * new scopes. Control-flow blocks (if/for/while/with/try) do NOT create new bindings; names
 * assigned inside them leak into the enclosing function / class / module scope.
 */
interface VarScope {
    indent: number;
    kind: 'module' | 'function' | 'class';
    names: Map<string, number>; // name -> 1-based line number of first declaration
}

/** Options shape for the shadowing rule, resolved from `ctx.options.shadowing`. */
interface ShadowingOptions {
    enabled: boolean;
    ignoreNames: Set<string>;
}

type PyEmitter = (
    lineIdx: number,
    rule: string,
    message: string,
    severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    suggestion: string,
    detail: Record<string, unknown>,
) => void;

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
     * Scan one Python file for modernization findings.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and path.
     * @returns All findings for the file.
     */
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
            { indent: -1, kind: 'module', names: new Map<string, number>() },
        ];
        const shadowOpts = this.resolveShadowingOptions(ctx.options);

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;

            const indent = line.length - line.trimStart().length;
            while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop();
            // Pop function/class scopes when indent drops back to or past their level.
            while (varScopes.length > 1 && indent <= varScopes[varScopes.length - 1].indent) {
                varScopes.pop();
            }

            const inAsync = this.hasKind(blocks, PYTHON_ASYNC_KEYWORD);
            const inExcept = this.hasKind(blocks, 'except');
            const inWith = this.hasKind(blocks, 'with');

            this.auditModernSyntax(line, trimmed, i, emit);
            this.auditModernTyping(line, trimmed, i, emit);
            this.auditControlFlow(line, trimmed, i, lines, inExcept, inWith, inAsync, emit);
            this.auditDataclassSlots(trimmed, i, lines, emit);
            this.recordModuleImports(trimmed, indent, blocks, file, i, importRecords);
            this.auditVariableShadowing(line, trimmed, i, indent, varScopes, shadowOpts, emit);

            if (BLOCK_OPEN_RE.test(trimmed)) {
                blocks.push({ indent, kind: this.kindOf(trimmed) });
            }
        }

        this.checkImportOrder(importRecords, emit);
        return issues;
    }

    private createIssueEmitter(file: string, issues: Issue[]): PyEmitter {
        return (
            lineIdx: number,
            rule: string,
            message: string,
            severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
            suggestion: string,
            detail: Record<string, unknown>,
        ): void => {
            issues.push({
                id: `python-modern:${rule}:${file}:${lineIdx + 1}`,
                analyzer: this.name,
                rule,
                severity,
                message,
                location: {
                    file,
                    start: { line: lineIdx + 1, column: 1 },
                    end: { line: lineIdx + 1, column: 1 },
                },
                detail,
                suggestion,
            });
        };
    }

    private auditModernSyntax(line: string, trimmed: string, i: number, emit: PyEmitter): void {
        if (line.includes('os.path.')) {
            emit(
                i,
                'PYM-PATH-001',
                'os.path usage: prefer pathlib.Path for path manipulation.',
                SEVERITY_WARNING,
                'Build paths with pathlib.Path (`Path(...) / name`), which is OS-neutral and self-documenting.',
                { line: trimmed },
            );
        }

        if (PERCENT_FORMAT_RE.test(line)) {
            emit(
                i,
                'PYM-FSTRING-001',
                'Percent-formatting is legacy: f-strings are faster and harder to misalign.',
                SEVERITY_WARNING,
                'Rewrite as an f-string (`f"...{value}"`).',
                { line: trimmed },
            );
        }

        if (/\btimezone\.utc\b/.test(line)) {
            emit(
                i,
                'PYM-DATETIME-001',
                'timezone.utc is superseded by the datetime.UTC singleton.',
                SEVERITY_ERROR,
                'Use `datetime.UTC` (PEP 615 / ruff UP017).',
                { line: trimmed },
            );
        }

        if (PY_PEP604_ANN_ASSIGN_RE.test(line) || PY_PEP604_ALIAS_RE.test(line)) {
            emit(
                i,
                'PYM-UNION-001',
                'Optional/Union in an annotation or alias: PEP 604 unions read better.',
                SEVERITY_ERROR,
                'Write `X | None` / `X | Y` instead of Optional/Union.',
                { line: trimmed },
            );
        }
    }

    private auditModernTyping(line: string, trimmed: string, i: number, emit: PyEmitter): void {
        if (PY_PEP585_RE.test(line)) {
            const hit = PY_PEP585_RE.exec(line)?.[1] ?? '';
            emit(
                i,
                'PYM-GENERIC-001',
                `typing.${hit}[...] is legacy: PEP 585 parameterizes the builtin instead.`,
                SEVERITY_ERROR,
                `Use \`${hit.toLowerCase()}[...]\` rather than typing.${hit}.`,
                { line: trimmed, name: hit },
            );
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
                emit(
                    i,
                    'PYM-ABC-001',
                    `Abstract type(s) ${offenders.join(', ')} belong to collections.abc, not typing.`,
                    SEVERITY_ERROR,
                    'Import these names from collections.abc (the typing aliases are deprecated).',
                    { names: offenders },
                );
            }
        }
    }

    private auditRaiseFrom(
        codeOnly: string,
        trimmed: string,
        i: number,
        lines: string[],
        emit: PyEmitter,
    ): void {
        if (!RAISE_RE.test(codeOnly)) return;
        const hasCauseAhead =
            RAISE_FROM_RE.test(codeOnly) ||
            this.followingLinesContain(i, lines, /\bfrom\b/, RAISE_CAUSE_LOOKAHEAD_LINES);
        if (!hasCauseAhead) {
            emit(
                i,
                'PYM-RAISE-001',
                '`raise` inside an except block without `from` drops the original exception chain.',
                SEVERITY_WARNING,
                'Re-raise with `raise NewError(...) from exc` (or a bare `raise` to propagate unchanged).',
                { line: trimmed },
            );
        }
    }

    private auditMutableDefaults(line: string, trimmed: string, i: number, emit: PyEmitter): void {
        const isDef = ASYNC_DEF_RE.test(line) || DEF_RE.test(line) || CLASS_RE.test(line);
        if (!isDef) return;
        const parenIdx = line.indexOf('(');
        if (parenIdx === -1) return;
        const signature = line.slice(parenIdx + 1);
        if (signature !== '' && MUTABLE_DEFAULT_RE.test(signature)) {
            emit(
                i,
                'PYM-DEFAULT-001',
                'Mutable default argument detected: the default is created once and shared by every call.',
                SEVERITY_WARNING,
                'Use a `None` sentinel and build the list/dict/set inside the body.',
                { line: trimmed },
            );
        }
    }

    private auditUnmanagedOpen(
        line: string,
        trimmed: string,
        i: number,
        inWith: boolean,
        emit: PyEmitter,
    ): void {
        if (!inWith && /\bopen\s*\(/.test(line) && !WITH_RE.test(line)) {
            emit(
                i,
                'PYM-OPEN-001',
                '`open()` without a `with` block leaks the file handle on error paths.',
                SEVERITY_WARNING,
                'Wrap the call in `with open(...) as handle:` so the handle closes deterministically.',
                { line: trimmed },
            );
        }
    }

    private auditControlFlow(
        line: string,
        trimmed: string,
        i: number,
        lines: string[],
        inExcept: boolean,
        inWith: boolean,
        inAsync: boolean,
        emit: PyEmitter,
    ): void {
        const codeOnly = trimmed.split('#')[0].trim();
        if (inExcept) {
            this.auditRaiseFrom(codeOnly, trimmed, i, lines, emit);
        }
        this.auditMutableDefaults(line, trimmed, i, emit);

        if (inAsync && !ASYNC_DEF_RE.test(line)) {
            this.auditAsyncCalls(line, trimmed, i, emit);
        }

        this.auditUnmanagedOpen(line, trimmed, i, inWith, emit);
    }

    private auditAsyncCalls(line: string, trimmed: string, i: number, emit: PyEmitter): void {
        if (BLOCKING_CALL_RE.test(line)) {
            emit(
                i,
                'PYM-ASYNC-001',
                'Blocking call inside an async function blocks the event loop.',
                SEVERITY_ERROR,
                'Use the async equivalent (asyncio.sleep, httpx, async repository) or run the blocking call in a thread.',
                { line: trimmed },
            );
        } else if (!AWAITED_ORM_CALL_RE.test(line) && SYNC_ORM_CALL_RE.test(line)) {
            emit(
                i,
                'PYM-ASYNC-001',
                'Synchronous ORM call inside an async function is not awaited.',
                SEVERITY_ERROR,
                'Await the async session (`await session.execute(...)`) or use the async repository API.',
                { line: trimmed },
            );
        }
    }

    private auditDataclassSlots(
        trimmed: string,
        i: number,
        lines: string[],
        emit: PyEmitter,
    ): void {
        if (!PY_DATACLASS_RE.test(trimmed)) return;
        let j = i + 1;
        while (j < lines.length && (lines[j].trim().startsWith('@') || lines[j].trim() === '')) {
            j++;
        }
        const next = j < lines.length ? lines[j].trim() : '';
        if (/^class\s+[A-Za-z_]\w*\s*:/.test(next) && !/\bslots\s*=/.test(trimmed)) {
            emit(
                i,
                'PYM-SLOTS-001',
                'Dataclass without slots=True: instances carry a __dict__ and typos create silent attributes.',
                SEVERITY_WARNING,
                'Add `slots=True` (or an explicit `slots=False` when __dict__ is genuinely required).',
                { line: trimmed },
            );
        }
    }

    private recordModuleImports(
        trimmed: string,
        indent: number,
        blocks: Block[],
        file: string,
        i: number,
        importRecords: ImportRecord[],
    ): void {
        const moduleLevel =
            indent === 0 &&
            !this.hasKind(blocks, 'def') &&
            !this.hasKind(blocks, PYTHON_ASYNC_KEYWORD) &&
            !this.hasKind(blocks, 'class');
        if (moduleLevel && /^(?:import|from)\s+/.test(trimmed)) {
            importRecords.push({
                line: i + 1,
                text: trimmed,
                section: this.importSection(trimmed, file),
            });
        }
    }

    /**
     * Classify the block introduced by a line that ends with a colon.
     *
     * @param trimmed - Line content with surrounding whitespace removed.
     * @returns The block kind consumed by the context checks.
     */
    /**
     * Classify one module-level import statement into the PEP 8 three-section model.
     *
     * @param text - Trimmed import statement.
     * @param file - Normalized file path (its first segment counts as a local root).
     * @returns 0 for stdlib, 1 for third-party, 2 for first-party/local.
     */
    private importSection(text: string, file: string): number {
        const fromMatch = /^from\s+([A-Za-z_][\w.]*)\s+import\b/.exec(text);
        const importMatch = /^import\s+([A-Za-z_][\w.]*)/.exec(text);
        const module = fromMatch?.[1] ?? importMatch?.[1] ?? '';
        if (module === '' || module.startsWith('.')) return 2;
        const root = module.split('.')[0];
        if (PY_STDLIB_NAMES.has(root)) return 0;
        if (PY_LOCAL_ROOTS.has(root) || root === file.split('/')[0]) return 2;
        return 1;
    }

    /**
     * Enforce the three-section import order plus per-section alphabetical ordering.
     *
     * @param records - Module-level imports in source order.
     * @param emit - Issue factory shared with the line scanner.
     */
    private checkImportOrder(
        records: ImportRecord[],
        emit: (
            lineIdx: number,
            rule: string,
            message: string,
            severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
            suggestion: string,
            detail: Record<string, unknown>,
        ) => void,
    ): void {
        if (records.length === 0) return;
        let seenSection = 0;
        for (const record of records) {
            if (record.section < seenSection) {
                emit(
                    record.line - 1,
                    'PYM-IMPORT-001',
                    `Import section order violated: a ${SECTION_LABELS[record.section]} import follows a ${SECTION_LABELS[seenSection]} import.`,
                    SEVERITY_WARNING,
                    'Group imports as stdlib → third-party → local (PEP 8), separated by blank lines.',
                    { line: record.text, section: record.section },
                );
                break;
            }
            seenSection = Math.max(seenSection, record.section);
        }
        const sections: ImportRecord[][] = [[], [], []];
        for (const record of records) sections[record.section].push(record);
        for (let index = 0; index < sections.length; index++) {
            this.checkSectionAlphabetical(sections[index], index, emit);
        }
    }

    private checkSectionAlphabetical(
        group: ImportRecord[],
        index: number,
        emit: (
            lineIdx: number,
            rule: string,
            message: string,
            severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
            suggestion: string,
            detail: Record<string, unknown>,
        ) => void,
    ): void {
        const texts = group.map((r) => r.text);
        const ordered = [...texts].sort();
        for (let pos = 0; pos < texts.length; pos++) {
            if (texts[pos] !== ordered[pos]) {
                emit(
                    group[pos].line - 1,
                    'PYM-IMPORT-001',
                    `${SECTION_LABELS[index]} imports are not alphabetically ordered (expected \`${ordered[pos]}\` at this position).`,
                    SEVERITY_WARNING,
                    'Sort each import section alphabetically by whole line.',
                    { line: texts[pos], expected: ordered[pos] },
                );
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
    private followingLinesContain(
        index: number,
        lines: string[],
        pattern: RegExp,
        lookahead: number,
    ): boolean {
        const end = Math.min(index + lookahead + 1, lines.length);
        for (let i = index + 1; i < end; i++) {
            if (pattern.test(lines[i])) return true;
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
     * @param line - Raw current line (with leading whitespace).
     * @param trimmed - Current line with surrounding whitespace removed.
     * @param lineIdx - Zero-based line index.
     * @param indent - Indentation width of the current line.
     * @param varScopes - Variable scope stack (mutated in place).
     * @param opts - Shadowing rule options (enabled flag, ignore-names set).
     * @param emit - Issue factory shared with the rest of the analyzer.
     */
    private auditVariableShadowing(
        line: string,
        trimmed: string,
        lineIdx: number,
        indent: number,
        varScopes: VarScope[],
        opts: ShadowingOptions,
        emit: PyEmitter,
    ): void {
        if (!opts.enabled) return;

        const codeOnly = trimmed.split('#')[0].trim();
        const currentScope = varScopes[varScopes.length - 1];
        const line1 = lineIdx + 1; // 1-based for user-facing messages

        // --- 1. Function / class definition: name + parameters -------------------------
        const defMatch = DEF_PARAMS_RE.exec(line);
        if (defMatch) {
            const funcName = defMatch[1];
            const paramsStr = defMatch[2];

            // Function/class name belongs to the enclosing (current) scope.
            this.registerBinding(funcName, line1, currentScope, varScopes, opts, emit);

            // Determine the new scope kind and push it.
            const isAsync = ASYNC_DEF_RE.test(line);
            const newKind: 'function' | 'class' = isAsync || DEF_RE.test(line) ? 'function' : 'class';
            const newScope: VarScope = { indent, kind: newKind, names: new Map() };
            varScopes.push(newScope);

            // Parameters belong to the new function scope. Each param may shadow outer scopes.
            if (newKind === 'function') {
                const paramNames = this.extractParamNames(paramsStr);
                for (const pName of paramNames) {
                    this.registerBinding(pName, line1, newScope, varScopes, opts, emit);
                }
            }
            return;
        }

        // Class definition (without params on the same line heuristic).
        if (CLASS_RE.test(line)) {
            const clsMatch = /^\s*class\s+([A-Za-z_]\w*)/.exec(line);
            if (clsMatch) {
                this.registerBinding(clsMatch[1], line1, currentScope, varScopes, opts, emit);
            }
            const newScope: VarScope = { indent, kind: 'class', names: new Map() };
            varScopes.push(newScope);
            return;
        }

        // --- 2. Import statements (module-level or function-level, both count) ----------
        if (/^(?:import|from)\s+/.test(codeOnly)) {
            const simpleImp = IMPORT_SIMPLE_RE.exec(line);
            if (simpleImp) {
                this.registerBinding(simpleImp[1], line1, currentScope, varScopes, opts, emit);
            }
            const fromImp = IMPORT_FROM_RE.exec(codeOnly);
            if (fromImp) {
                const namesPart = fromImp[1];
                // Handle `import a, b, c as d` style lists.
                const items = namesPart.split(',');
                for (const item of items) {
                    const trimmedItem = item.trim();
                    if (trimmedItem === '' || trimmedItem === '(' || trimmedItem === ')') continue;
                    // Strip parentheses for multi-line imports.
                    const clean = trimmedItem.replace(/[()]/g, '').trim();
                    if (clean === '') continue;
                    const asMatch = /^(.+?)\s+as\s+([A-Za-z_]\w*)$/.exec(clean);
                    const name = asMatch ? asMatch[2] : clean.split(/\s+/)[0];
                    if (/^[A-Za-z_]\w*$/.test(name)) {
                        this.registerBinding(name, line1, currentScope, varScopes, opts, emit);
                    }
                }
            }
            return;
        }

        // --- 3. for loop variable ------------------------------------------------------
        const forMatch = FOR_VAR_RE.exec(line);
        if (forMatch) {
            this.registerBinding(forMatch[1], line1, currentScope, varScopes, opts, emit);
            // Note: we do NOT return here — a for line might also have other patterns,
            // but in practice the loop variable is the only binding on a `for` line.
            return;
        }

        // --- 4. with ... as target -----------------------------------------------------
        const withMatch = WITH_AS_RE.exec(line);
        if (withMatch) {
            this.registerBinding(withMatch[1], line1, currentScope, varScopes, opts, emit);
            return;
        }

        // --- 5. except ... as target ---------------------------------------------------
        const exceptMatch = EXCEPT_AS_RE.exec(line);
        if (exceptMatch) {
            this.registerBinding(exceptMatch[1], line1, currentScope, varScopes, opts, emit);
            return;
        }

        // --- 6. Direct assignment: `name = value` --------------------------------------
        const assignMatch = ASSIGN_RE.exec(line);
        if (assignMatch) {
            // Skip augmented assigns that the regex might still match (e.g. `a == b` is
            // excluded by the negative lookahead, but double-check defensively).
            const afterEq = line.slice(assignMatch[0].length);
            if (afterEq.startsWith('=')) return;
            this.registerBinding(assignMatch[1], line1, currentScope, varScopes, opts, emit);
        }
    }

    /**
     * Register a binding in the current scope and emit a shadowing warning when the name
     * already exists in any enclosing scope.
     *
     * @param name - The variable/parameter/function name to register.
     * @param line1 - 1-based line number of the declaration.
     * @param currentScope - The scope the name belongs to (varScopes top).
     * @param varScopes - Full scope stack (used for outer-scope lookup).
     * @param opts - Shadowing options (ignore-names set).
     * @param emit - Issue factory.
     */
    private registerBinding(
        name: string,
        line1: number,
        currentScope: VarScope,
        varScopes: VarScope[],
        opts: ShadowingOptions,
        emit: PyEmitter,
    ): void {
        if (opts.ignoreNames.has(name)) return;

        // If the name already exists in the SAME scope, this is a reassignment, not shadowing.
        if (currentScope.names.has(name)) return;

        // Walk outer scopes (skip the current one) looking for a prior declaration.
        let outerLine = -1;
        for (let i = varScopes.length - 2; i >= 0; i--) {
            const found = varScopes[i].names.get(name);
            if (found !== undefined) {
                outerLine = found;
                break;
            }
        }

        if (outerLine > 0) {
            emit(
                line1 - 1,
                'PYM-SHADOW-001',
                `Variable \`${name}\` may shadow an outer-scope declaration (line ${outerLine}).`,
                SEVERITY_WARNING,
                'Rename the variable or use a different name to avoid shadowing the outer binding.',
                { name, outerLine, scope: currentScope.kind },
            );
        }

        currentScope.names.set(name, line1);
    }

    /**
     * Parse a Python function parameter string and return the parameter names.
     *
     * Handles simple names, defaults (`x=1`), type annotations (`x: int`), *args, **kwargs,
     * and `/` / `*` positional-only / keyword-only markers.  Multi-line signatures are not
     * supported — this is a heuristic, line-level parser.
     *
     * @param paramsStr - The raw text inside the parentheses of a `def` line.
     * @returns Array of parameter names in declaration order.
     */
    private extractParamNames(paramsStr: string): string[] {
        const names: string[] = [];
        // Strip nested parens/brackets/braces crudely by splitting on commas at depth 0.
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

        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed === '' || trimmed === '/' || trimmed === '*') continue;
            // Strip leading * or ** (varargs / kwargs markers).
            let cleaned = trimmed.replace(/^\*{1,2}/, '').trim();
            // Remove type annotation: everything after the first `:` before `=`.
            const eqIdx = cleaned.indexOf('=');
            const colonIdx = cleaned.indexOf(':');
            if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
                cleaned = cleaned.slice(0, colonIdx).trim();
            }
            // Remove default value: everything after `=`.
            if (eqIdx !== -1) {
                cleaned = cleaned.slice(0, eqIdx).trim();
            }
            if (/^[A-Za-z_]\w*$/.test(cleaned)) {
                names.push(cleaned);
            }
        }
        return names;
    }

    private kindOf(trimmed: string): BlockKind {
        if (ASYNC_DEF_RE.test(trimmed)) return PYTHON_ASYNC_KEYWORD;
        if (DEF_RE.test(trimmed)) return 'def';
        if (CLASS_RE.test(trimmed)) return 'class';
        if (EXCEPT_RE.test(trimmed)) return 'except';
        if (WITH_RE.test(trimmed)) return 'with';
        return 'other';
    }

    /**
     * Report whether any enclosing block has the requested kind.
     *
     * @param blocks - Active indentation block stack.
     * @param kind - Block kind to look for.
     * @returns True when the kind is present in the stack.
     */
    private hasKind(blocks: Block[], kind: BlockKind): boolean {
        return blocks.some((b) => b.kind === kind);
    }
}
