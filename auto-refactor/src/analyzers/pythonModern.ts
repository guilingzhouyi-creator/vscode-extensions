/**
 * Module: Static Analysis Engine — Python Modernization Rules
 * File Path: src/analyzers/pythonModern.ts
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

const BLOCK_OPEN_RE = /:\s*(?:#.*)?$/;
const ASYNC_DEF_RE = /^\s*async\s+def\b/;
const DEF_RE = /^\s*def\b/;
const CLASS_RE = /^\s*class\b/;
const EXCEPT_RE = /^\s*except\b/;
const WITH_RE = /^\s*(?:async\s+)?with\b/;

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

/** Severity for advisory modernization findings that can be staged over time. */
const SEVERITY_WARNING = 'warning';

/** Severity for findings that indicate a functional or correctness defect. */
const SEVERITY_ERROR = 'error';

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
        const emit = (
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

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.endsWith('\r')) line = line.slice(0, -1);
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) continue;
            const indent = line.length - line.trimStart().length;
            while (blocks.length > 0 && indent <= blocks[blocks.length - 1].indent) blocks.pop();
            const inAsync = this.hasKind(blocks, PYTHON_ASYNC_KEYWORD);
            const inExcept = this.hasKind(blocks, 'except');
            const inWith = this.hasKind(blocks, 'with');

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

            // Trailing comments must not masquerade as the raised expression: a bare `raise`
            // followed by a comment is a deliberate re-raise and carries no new exception.
            const codeOnly = trimmed.split('#')[0].trim();
            const hasCauseAhead =
                RAISE_FROM_RE.test(codeOnly) ||
                this.followingLinesContain(i, lines, /\bfrom\b/, RAISE_CAUSE_LOOKAHEAD_LINES);
            if (inExcept && RAISE_RE.test(codeOnly) && !hasCauseAhead) {
                emit(
                    i,
                    'PYM-RAISE-001',
                    '`raise` inside an except block without `from` drops the original exception chain.',
                    SEVERITY_WARNING,
                    'Re-raise with `raise NewError(...) from exc` (or a bare `raise` to propagate unchanged).',
                    { line: trimmed },
                );
            }

            const isAsyncDef = ASYNC_DEF_RE.test(line);
            const isDef = isAsyncDef || DEF_RE.test(line) || CLASS_RE.test(line);
            const signature = line.includes('(') ? line.slice(line.indexOf('(') + 1) : '';
            if (isDef && signature !== '' && MUTABLE_DEFAULT_RE.test(signature)) {
                emit(
                    i,
                    'PYM-DEFAULT-001',
                    'Mutable default argument detected: the default is created once and shared by every call.',
                    SEVERITY_WARNING,
                    'Use a `None` sentinel and build the list/dict/set inside the body.',
                    { line: trimmed },
                );
            }

            if (inAsync && !ASYNC_DEF_RE.test(line)) {
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

            if (/\bopen\s*\(/.test(line) && !inWith && !WITH_RE.test(line)) {
                emit(
                    i,
                    'PYM-OPEN-001',
                    '`open()` without a `with` block leaks the file handle on error paths.',
                    SEVERITY_WARNING,
                    'Wrap the call in `with open(...) as handle:` so the handle closes deterministically.',
                    { line: trimmed },
                );
            }

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

            if (PY_DATACLASS_RE.test(trimmed)) {
                let j = i + 1;
                while (
                    j < lines.length &&
                    (lines[j].trim().startsWith('@') || lines[j].trim() === '')
                )
                    j++;
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

            if (BLOCK_OPEN_RE.test(trimmed)) {
                blocks.push({ indent, kind: this.kindOf(trimmed) });
            }
        }

        this.checkImportOrder(importRecords, emit);
        return issues;
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
            const group = sections[index];
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
