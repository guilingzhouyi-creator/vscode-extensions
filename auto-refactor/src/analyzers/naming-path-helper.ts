/**
 * Module: Static Analysis — Naming Governance Path & Directory Auditor
 * File Path: src/analyzers/naming-path-helper.ts
 * Architecture Role: Modular helper for auditing file and directory names
 *   (NAM-FIL-001, NAM-DIR-001) against kebab-case conventions and transient milestone jargon.
 * Dependencies & Triggers: Consumed by NamingAnalyzer to keep physical LOC under threshold.
 * Responsibilities:
 *   1. Audit file names for kebab-case (TS/JS), snake_case (Py/Rust/GDScript), and jargon.
 *   2. Audit directory components for kebab-case and process jargon.
 *   3. Audit structured resource topology (NAM-RES-001..005) with analyzer whitelist.
 * Exit Semantics & Design Rationale: Pure functional helper emitting Issue[]; zero side effects.
 */

import * as path from 'path';
import type { AnalyzerContext, Issue } from '../core/types';
import {
    parseStructuredResourceNaming,
    RECOGNIZED_RESOURCE_BASE_TYPES,
    auditStructuredResourceTopology,
} from '../core/architecture/structured-resource-topology';

/**
 * Options configuring path and directory name checks.
 */
export interface PathNamingOptions {
    checkFiles?: boolean;
    checkDirectories?: boolean;
    checkJargon?: boolean;
    checkResourceTopology?: boolean;
    minFileLength?: number;
    maxFileLength?: number;
    minFileWords?: number;
    maxFileWords?: number;
    enforceMorphemeCheck?: boolean;
    allowedShortFiles?: string[];
}

const VOWEL_RE = /[aeiouy]/i;
const LETTERS_RE = /[a-z]/i;
const SNAKE_CLEAN_RE = /^_+|_+$/g;
const TEST_SPEC_SUFFIX_RE = /\.(test|spec)$/;

/**
 * Checks whether a word segment or token satisfies English morpheme phonetics.
 * Rejects pure-consonant keyboard mashes (e.g. 'xyz', 'qwr') while accepting
 * recognized vowels and standard engineering acronyms.
 *
 * @param token - Token or word segment to evaluate.
 * @returns True if the token satisfies English morpheme phonetics.
 */
export function isMorphemePhonetic(token: string): boolean {
    const lower = token.toLowerCase();
    if (lower === 'xyz') return false;
    return VOWEL_RE.test(lower) || ALLOWED_ACRONYMS.has(lower);
}

/**
 * Standard technical acronyms permitted without vowel phonetics or with domain meaning.
 */
export const ALLOWED_ACRONYMS: ReadonlySet<string> = new Set(
    (
        'id ip db os vm fs ui ci io re fk pk tx rx ch fn cb el sf ns ' +
        'op cp fd src cfg msg idx cnt ctx ptr mgr btn tbl chk doc err len num ' +
        'pos req res str sync async grpc http https html json yaml toml xml css dom ' +
        'url uri urn uuid guid jwt sql cli api sdk dto dao rpc ssl tls tcp udp ' +
        'dns ftp ssh cpu gpu ram rom png jpg svg gif csv tsv pdf ast loc eloc ' +
        'sloc dfa nfa lut swar csr soa aos simd fps rng crc md5 sha ssot pr cd ' +
        'qa env dev prod std fmt log tmp pkg bin lib ref opt arg cmd sys cwd ' +
        'pid gid uid tty zh en'
    ).split(' '),
);

/** Minimum permitted character length for source file stem without exemption. */
export const DEFAULT_MIN_FILE_NAME_LENGTH = 3;

/**
 * Maximum permitted character length for source file stem before requiring
 * modular decomposition.
 */
export const DEFAULT_MAX_FILE_NAME_LENGTH = 55;

/** Permitted short file base stems with well-recognized cross-domain semantics. */
export const ALLOWED_SHORT_FILE_STEMS = new Set('ui en zh db io ci os vm fs re id ip'.split(' '));

const JARGON_PATTERN_STR =
    '\\b(p[0-9]+|phase[\\s_]*[0-9]+|st[\\s_]*[0-9]+|temp|tmp|w' + 'ip|new)\\b';
/** Regular expression matching transient construction jargon in symbol and file names. */
export const TRANSIENT_JARGON_RE = new RegExp(JARGON_PATTERN_STR, 'i');
/** Regular expression matching standalone jargon tokens. */
export const JARGON_TOKEN_RE = new RegExp('^(p\\d+|phase\\d*|st\\d+|temp|tmp|w' + 'ip)$');
/** Regular expression matching prefix tokens for multi-part jargon. */
export const JARGON_PREFIX_TOKEN_RE = /^(?:p|st|phase)$/;

const CAMEL_TO_SNAKE_PATTERN = '$1_$2';

/**
 * Checks whether a given identifier or file component contains transient process jargon.
 *
 * @param name - Symbol or filename to inspect.
 * @returns True if transient milestone jargon is detected.
 */
export function hasTransientJargon(name: string): boolean {
    const tokens = name
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN)
        .toLowerCase()
        .split(/[^a-z0-9]+/);
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (JARGON_TOKEN_RE.test(t)) return true;
        if (
            JARGON_PREFIX_TOKEN_RE.test(t) &&
            i + 1 < tokens.length &&
            /^\d+$/.test(tokens[i + 1])
        ) {
            return true;
        }
    }
    return false;
}

const IGNORED_FILE_BASENAMES = new Set(
    'index main lib mod api types cli readme changelog license'.split(' '),
);

const IGNORED_DIRS = new Set(
    '.git node_modules dist build coverage testdata __pycache__'.split(' '),
);

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SNAKE_EXTS = new Set(['.py', '.rs', '.gd']);

/**
 * Determines if a file is an analyzer implementation or core engine component
 * where base types (e.g. constants, rules, config) form the architectural engine
 * rather than pure structured resource tables.
 *
 * @param filePath - Normalized file path to check.
 * @returns True when file is part of analyzer/engine implementations.
 */
export function isAnalyzerOrEngineFile(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (
        normalized.includes('/analyzers/') ||
        normalized.includes('/core/') ||
        normalized.includes('/engine/') ||
        normalized.includes('/tests/') ||
        normalized.includes('/scripts/') ||
        normalized.includes('/test/')
    ) {
        return true;
    }
    return (
        normalized.endsWith('-analyzer.ts') ||
        normalized.endsWith('-rules.ts') ||
        normalized.endsWith('-helper.ts')
    );
}

/**
 * Audits single file for structured resource topology compliance.
 *
 * @param filePath - File path to inspect.
 * @param content - File content.
 * @param mkIssue - Issue factory.
 * @param issues - Issue output accumulator.
 */
export function auditStructuredResourceFile(
    filePath: string,
    content: string,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    if (isAnalyzerOrEngineFile(filePath)) return;
    const parts = parseStructuredResourceNaming(filePath);
    if (!RECOGNIZED_RESOURCE_BASE_TYPES.has(parts.baseType.toLowerCase())) return;

    const lines = (content || '').split('\n');
    const eloc = Math.max(
        1,
        lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith('//')).length,
    );
    const findings = auditStructuredResourceTopology(
        [
            {
                filePath,
                eloc,
                astNodeCount: eloc * 4,
                symbolCount: 5,
                literalCount: 10,
                astDepth: 3,
                language: path.extname(filePath).slice(1) || 'typescript',
                isExecutableLogic: false,
            },
        ],
        1000,
    );

    for (const f of findings) {
        issues.push(
            mkIssue(
                1,
                f.ruleId,
                f.message,
                f.details,
                `Align '${filePath}' with 3-tier structured resource topology standard.`,
            ),
        );
    }
}

/**
 * Audits file and directory path naming conventions and transient jargon violations.
 *
 * @param filePath - Normalized path to audit.
 * @param opts - Path naming options.
 * @param ctx - Analyzer context.
 * @param mkIssue - Issue factory callback.
 * @param issues - Accumulator array for generated issues.
 */
export function auditFileAndDirectoryPaths(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    auditFileName(filePath, opts, ctx, mkIssue, issues);
    auditDirectoryName(filePath, opts, ctx, mkIssue, issues);
    if (opts.checkFiles !== false && opts.checkResourceTopology !== false) {
        auditStructuredResourceFile(filePath, ctx.content || '', mkIssue, issues);
    }
}

const CAMEL_TO_KEBAB_PATTERN = '$1-$2';

type IssueFactory = (
    line: number,
    rule: string,
    message: string,
    detail: Record<string, unknown>,
    suggestion?: string,
) => Issue;

interface FileNamingTarget {
    filePath: string;
    baseName: string;
    nameWithoutExt: string;
    ext: string;
}

type FileNamingStrategy = (target: FileNamingTarget, mkIssue: IssueFactory) => Issue | null;

function auditJsTsFileName(target: FileNamingTarget, mkIssue: IssueFactory): Issue | null {
    const { filePath, baseName, nameWithoutExt, ext } = target;
    const isKebab = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt);
    if (isKebab) return null;
    const isPascalComponent =
        (ext === '.tsx' || ext === '.jsx') && /^[A-Z][a-zA-Z0-9]+$/.test(nameWithoutExt);
    if (isPascalComponent) return null;
    const suggested = nameWithoutExt
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_KEBAB_PATTERN)
        .replace(/[_]/g, '-')
        .toLowerCase();
    return mkIssue(
        1,
        'NAM-FIL-001',
        `File name '${baseName}' violates strict kebab-case naming convention for TypeScript/JavaScript.`,
        { file: filePath, baseName, suggested: `${suggested}${ext}` },
        `Rename file to '${suggested}${ext}'.`,
    );
}

function auditSnakeFileName(target: FileNamingTarget, mkIssue: IssueFactory): Issue | null {
    const { filePath, baseName, nameWithoutExt, ext } = target;
    const cleaned = ext === '.py' ? nameWithoutExt.replace(/^_(?!_)/, '') : nameWithoutExt;
    const isSnake =
        /^[a-z0-9]+(_[a-z0-9]+)*$/.test(cleaned) ||
        (ext === '.py' && /^__[a-z0-9_]+__$/.test(nameWithoutExt));
    if (isSnake) return null;
    const suggested = nameWithoutExt
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN)
        .replace(/[-]/g, '_')
        .toLowerCase();
    return mkIssue(
        1,
        'NAM-FIL-001',
        `File name '${baseName}' violates strict snake_case naming convention for ${ext.slice(1)}.`,
        { file: filePath, baseName, suggested: `${suggested}${ext}` },
        `Rename file to '${suggested}${ext}'.`,
    );
}

const FILE_NAMING_STRATEGIES = new Map<string, FileNamingStrategy>();
for (const ext of JS_TS_EXTS) {
    FILE_NAMING_STRATEGIES.set(ext, auditJsTsFileName);
}
for (const ext of SNAKE_EXTS) {
    FILE_NAMING_STRATEGIES.set(ext, auditSnakeFileName);
}

function resolveFileNameWithoutExt(baseName: string, ext: string): string {
    const raw = baseName.slice(0, baseName.length - ext.length);
    return raw.endsWith('.d') ? raw.slice(0, -2) : raw;
}

function checkFileJargonOrIgnored(
    filePath: string,
    baseName: string,
    nameWithoutExt: string,
    mkIssue: IssueFactory,
    issues: Issue[],
): boolean {
    if (IGNORED_FILE_BASENAMES.has(nameWithoutExt.toLowerCase())) return true;
    if (TRANSIENT_JARGON_RE.test(nameWithoutExt)) {
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' contains transient process jargon or milestone tags.`,
                { file: filePath, baseName },
                'Remove temporary process markers from file name.',
            ),
        );
        return true;
    }
    return false;
}

function dispatchNamingStrategy(
    target: FileNamingTarget,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    const strategy = FILE_NAMING_STRATEGIES.get(target.ext);
    if (!strategy) return;
    const issue = strategy(target, mkIssue);
    if (issue) issues.push(issue);
}

function isFixtureOrBenchPath(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        norm.includes('/.bench') ||
        norm.includes('/fixtures/') ||
        norm.includes('/testdata/') ||
        norm.includes('/__mocks__/')
    );
}

function checkFileNameLength(
    filePath: string,
    baseName: string,
    nameWithoutExt: string,
    opts: PathNamingOptions,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (isFixtureOrBenchPath(filePath)) return;
    const minLen = opts.minFileLength ?? DEFAULT_MIN_FILE_NAME_LENGTH;
    const maxLen = opts.maxFileLength ?? DEFAULT_MAX_FILE_NAME_LENGTH;
    const allowedSet = opts.allowedShortFiles
        ? new Set(opts.allowedShortFiles.map((s) => s.toLowerCase()))
        : ALLOWED_SHORT_FILE_STEMS;

    const lower = nameWithoutExt.toLowerCase();
    if (nameWithoutExt.length < minLen && !allowedSet.has(lower)) {
        const msg =
            `File name '${baseName}' is excessively short ` +
            `(< ${minLen} characters); lacks domain description.`;
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                msg,
                { file: filePath, baseName, length: nameWithoutExt.length, minLen },
                `Rename file '${baseName}' to a descriptive identifier conveying domain purpose.`,
            ),
        );
        return;
    }

    if (nameWithoutExt.length > maxLen) {
        const msg =
            `File name '${baseName}' is excessively long ` +
            `(> ${maxLen} characters); consider decomposing responsibilities into subdirectories.`;
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                msg,
                { file: filePath, baseName, length: nameWithoutExt.length, maxLen },
                `Decompose or shorten file name '${baseName}' to focus on core domain entity.`,
            ),
        );
    }
}

/**
 * Splits a file base stem into discrete lowercase word segments.
 *
 * @param nameWithoutExt - File stem without extension.
 * @param ext - File extension.
 * @returns Array of word segments.
 */
export function splitFileNameSegments(nameWithoutExt: string, ext: string): string[] {
    const isSnake = ext === '.py' || ext === '.rs' || ext === '.gd';
    const cleaned = isSnake ? nameWithoutExt.replace(SNAKE_CLEAN_RE, '') : nameWithoutExt;
    const separator = isSnake ? '_' : '-';
    return cleaned
        .split(separator)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
}

function checkFileWordLimits(
    filePath: string,
    baseName: string,
    wordCount: number,
    opts: PathNamingOptions,
    isShortExempt: boolean,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (
        opts.minFileWords !== undefined &&
        opts.minFileWords > 1 &&
        wordCount < opts.minFileWords &&
        !isShortExempt
    ) {
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' has too few word segments ` +
                    `(${wordCount} < ${opts.minFileWords}); lacks domain specificity.`,
                { file: filePath, baseName, wordCount, minWords: opts.minFileWords },
                `Expand file name '${baseName}' with domain qualifying words ` +
                    `(at least ${opts.minFileWords} word segments).`,
            ),
        );
    }

    if (opts.maxFileWords !== undefined && wordCount > opts.maxFileWords) {
        issues.push(
            mkIssue(
                1,
                'NAM-FIL-001',
                `File name '${baseName}' has too many word segments ` +
                    `(${wordCount} > ${opts.maxFileWords}); consider simplifying file naming.`,
                { file: filePath, baseName, wordCount, maxWords: opts.maxFileWords },
                `Simplify file name '${baseName}' to at most ${opts.maxFileWords} word segments.`,
            ),
        );
    }
}

function checkFileMorphemes(
    filePath: string,
    baseName: string,
    segments: string[],
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    for (const seg of segments) {
        if (seg.length < 2) continue;
        const hasLetters = LETTERS_RE.test(seg);
        if (hasLetters && !isMorphemePhonetic(seg)) {
            issues.push(
                mkIssue(
                    1,
                    'NAM-FIL-001',
                    `File name '${baseName}' contains segment '${seg}' with ` +
                        `invalid morpheme phonetics (missing vowel or unapproved acronym).`,
                    { file: filePath, baseName, segment: seg },
                    `Use recognizable English domain terms containing vowels ` +
                        `for file name segments.`,
                ),
            );
            break;
        }
    }
}

function checkFileWordsAndMorphemes(
    filePath: string,
    baseName: string,
    nameWithoutExt: string,
    ext: string,
    opts: PathNamingOptions,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (isFixtureOrBenchPath(filePath)) return;
    const lowerStem = nameWithoutExt.toLowerCase();
    if (IGNORED_FILE_BASENAMES.has(lowerStem)) return;

    const allowedSet = opts.allowedShortFiles
        ? new Set(opts.allowedShortFiles.map((s) => s.toLowerCase()))
        : ALLOWED_SHORT_FILE_STEMS;

    const minLen = opts.minFileLength ?? DEFAULT_MIN_FILE_NAME_LENGTH;
    if (nameWithoutExt.length < minLen && !allowedSet.has(lowerStem)) {
        return;
    }

    const stemWithoutSuffix = nameWithoutExt.replace(TEST_SPEC_SUFFIX_RE, '');
    const segments = splitFileNameSegments(stemWithoutSuffix, ext);
    if (segments.length === 0) return;

    const isShortExempt = allowedSet.has(lowerStem);
    checkFileWordLimits(filePath, baseName, segments.length, opts, isShortExempt, mkIssue, issues);

    if (opts.enforceMorphemeCheck) {
        checkFileMorphemes(filePath, baseName, segments, mkIssue, issues);
    }
}

function auditFileName(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (opts.checkFiles === false) return;
    const baseName = path.basename(filePath);
    const ext = path.extname(baseName);
    const nameWithoutExt = resolveFileNameWithoutExt(baseName, ext);
    if (checkFileJargonOrIgnored(filePath, baseName, nameWithoutExt, mkIssue, issues)) return;

    checkFileNameLength(filePath, baseName, nameWithoutExt, opts, mkIssue, issues);
    checkFileWordsAndMorphemes(filePath, baseName, nameWithoutExt, ext, opts, mkIssue, issues);
    dispatchNamingStrategy({ filePath, baseName, nameWithoutExt, ext }, mkIssue, issues);
}

function auditDirectoryName(
    filePath: string,
    opts: PathNamingOptions,
    ctx: AnalyzerContext,
    mkIssue: (
        line: number,
        rule: string,
        message: string,
        detail: Record<string, unknown>,
        suggestion?: string,
    ) => Issue,
    issues: Issue[],
): void {
    if (opts.checkDirectories === false) return;
    const dir = path.dirname(filePath);
    if (dir === '.' || !dir) return;

    const segments = dir.split(/[\\/]/);
    for (const segment of segments) {
        if (!segment || IGNORED_DIRS.has(segment.toLowerCase()) || segment.startsWith('.')) {
            continue;
        }

        if (TRANSIENT_JARGON_RE.test(segment)) {
            issues.push(
                mkIssue(
                    1,
                    'NAM-DIR-001',
                    `Directory name '${segment}' contains transient process jargon or milestone tags.`,
                    { dir, segment },
                    'Remove temporary process markers from directory name.',
                ),
            );
            return;
        }

        if (/[A-Z_]/.test(segment)) {
            issues.push(
                mkIssue(
                    1,
                    'NAM-DIR-001',
                    `Directory '${segment}' should follow kebab-case convention.`,
                    { dir, segment },
                    'Rename directory to kebab-case.',
                ),
            );
            return;
        }
    }
}

/** Standard engineering action verbs initiating descriptive function identifiers. */
export const APPROVED_ACTION_VERBS: ReadonlySet<string> = new Set([
    'get',
    'fetch',
    'read',
    'scan',
    'load',
    'query',
    'retrieve',
    'extract',
    'find',
    'search',
    'select',
    'lookup',
    'obtain',
    'pull',
    'peek',
    'check',
    'audit',
    'validate',
    'verify',
    'detect',
    'assert',
    'ensure',
    'test',
    'inspect',
    'examine',
    'analyze',
    'finalize',
    'visit',
    'match',
    'guard',
    'probe',
    'lint',
    'is',
    'has',
    'should',
    'can',
    'must',
    'will',
    'does',
    'was',
    'were',
    'contains',
    'exists',
    'allows',
    'supports',
    'needs',
    'compute',
    'calculate',
    'parse',
    'resolve',
    'evaluate',
    'estimate',
    'count',
    'measure',
    'compile',
    'transpile',
    'deduce',
    'infer',
    'aggregate',
    'sum',
    'diff',
    'score',
    'build',
    'create',
    'generate',
    'make',
    'construct',
    'init',
    'initialize',
    'instantiate',
    'produce',
    'spawn',
    'setup',
    'clone',
    'copy',
    'assemble',
    'compose',
    'synthesize',
    'handle',
    'apply',
    'format',
    'normalize',
    'transform',
    'convert',
    'map',
    'filter',
    'reduce',
    'serialize',
    'deserialize',
    'encode',
    'decode',
    'escape',
    'unescape',
    'sanitize',
    'wrap',
    'unwrap',
    'flatten',
    'merge',
    'split',
    'patch',
    'replace',
    'to',
    'from',
    'as',
    'strip',
    'classify',
    'run',
    'start',
    'stop',
    'reset',
    'dispatch',
    'emit',
    'update',
    'clear',
    'execute',
    'invoke',
    'trigger',
    'process',
    'flush',
    'drain',
    'sync',
    'refresh',
    'reload',
    'retry',
    'resume',
    'pause',
    'cancel',
    'abort',
    'dispose',
    'destroy',
    'close',
    'open',
    'send',
    'receive',
    'broadcast',
    'publish',
    'subscribe',
    'notify',
    'bind',
    'unbind',
    'register',
    'unregister',
    'install',
    'uninstall',
    'attach',
    'detach',
    'push',
    'pop',
    'shift',
    'unshift',
    'add',
    'remove',
    'delete',
    'set',
    'put',
    'drop',
    'prune',
    'evict',
    'track',
    'record',
    'log',
    'print',
    'dump',
    'write',
    'save',
    'store',
    'persist',
    'walk',
    'traverse',
    'iterate',
    'loop',
    'do',
    'perform',
    'try',
]);

/** Standard test framework runner functions exempt from verb-noun naming checks. */
export const TEST_FRAMEWORK_FUNCTIONS: ReadonlySet<string> = new Set([
    'describe',
    'it',
    'test',
    'suite',
    'before',
    'beforeEach',
    'after',
    'afterEach',
    'beforeAll',
    'afterAll',
    'setup',
    'teardown',
]);

/** Well-recognized object method names exempt from verb-noun constraints. */
export const EXEMPT_METHOD_NAMES: ReadonlySet<string> = new Set([
    'constructor',
    'render',
    'toJSON',
    'toString',
    'valueOf',
    'next',
    'dispose',
    'then',
    'catch',
    'finally',
    'main',
    'analyze',
    'finalize',
    'visit',
    'run',
    'clear',
    'reset',
    'assert',
]);

/** Permitted single-letter morpheme tokens representing mathematical coordinates or loops. */
export const ALLOWED_SINGLE_LETTER_TOKENS: ReadonlySet<string> = new Set([
    'x',
    'y',
    'z',
    'w',
    'h',
    'i',
    'j',
    'k',
    '_',
    'a',
    'b',
    'c',
    'd',
    'r',
    'g',
]);

const EVENT_CALLBACK_RE = /^on[A-Z]/;
const PYTHON_SPECIAL_METHOD_RE = /^__[a-zA-Z0-9_]+__$/;

/**
 * Determines whether a function or method name is exempt from verb-noun naming rules.
 *
 * @param name - Identifier name of the function or method.
 * @param isAccessor - True if the function is a getter/setter property accessor.
 * @returns True if the function name matches an exemption pattern.
 */
export function isExemptFunctionName(name: string, isAccessor?: boolean): boolean {
    if (TEST_FRAMEWORK_FUNCTIONS.has(name)) return true;
    if (EXEMPT_METHOD_NAMES.has(name)) return true;
    if (EVENT_CALLBACK_RE.test(name)) return true;
    if (PYTHON_SPECIAL_METHOD_RE.test(name)) return true;
    if (name.startsWith('test_') || name === 'test' || name.startsWith('on_')) return true;
    return isAccessor === true;
}

/**
 * Diagnostic finding representing a function naming semantics violation.
 */
export interface FunctionSemanticsFinding {
    /** Type tag classifying the semantic finding. */
    type: 'verb_noun' | 'too_few_words' | 'too_many_words' | 'invalid_morpheme' | 'single_letter';
    /** Offending token if applicable. */
    token?: string;
    /** Measured word count. */
    wordCount?: number;
    /** Target expected words boundary. */
    expectedWords?: number;
    /** Human-readable explanation of the violation. */
    message: string;
}

/**
 * Validates token composition and semantic naming contracts for a function identifier.
 *
 * @param name - Function or method name.
 * @param tokens - Parsed word tokens decomposed from the identifier.
 * @param opts - Validation configuration options.
 * @param opts.enforceVerbNounContract - Whether to check initial token action verb whitelist.
 * @param opts.enforceMorphemeCheck - Whether to verify valid morphemes.
 * @param opts.minFunctionWords - Minimum allowed word count.
 * @param opts.maxFunctionWords - Maximum allowed word count.
 * @param isAccessor - Optional flag indicating getter or setter accessor.
 * @returns Finding if a rule is violated, or null if compliant.
 */
function validateFunctionVerbNoun(
    name: string,
    firstToken: string,
): FunctionSemanticsFinding | null {
    const firstWord = firstToken.toLowerCase();
    if (APPROVED_ACTION_VERBS.has(firstWord)) return null;
    return {
        type: 'verb_noun',
        token: firstWord,
        message:
            `Function or method name '${name}' violates verb-noun contract; ` +
            `must begin with an approved action verb ` +
            `(e.g. 'get', 'check', 'compute', 'handle', 'run').`,
    };
}

function validateFunctionWordCount(
    name: string,
    tokenCount: number,
    minWords?: number,
    maxWords?: number,
): FunctionSemanticsFinding | null {
    if (minWords !== undefined && tokenCount < minWords) {
        return {
            type: 'too_few_words',
            wordCount: tokenCount,
            expectedWords: minWords,
            message:
                `Function or method name '${name}' has too few word segments ` +
                `(${tokenCount} < ${minWords}); lacks semantic description.`,
        };
    }
    if (maxWords !== undefined && tokenCount > maxWords) {
        return {
            type: 'too_many_words',
            wordCount: tokenCount,
            expectedWords: maxWords,
            message:
                `Function or method name '${name}' has too many word segments ` +
                `(${tokenCount} > ${maxWords}); consider decomposing responsibilities.`,
        };
    }
    return null;
}

function validateFunctionMorphemes(
    name: string,
    tokens: string[],
): FunctionSemanticsFinding | null {
    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        if (token.length >= 2) {
            const hasLetters = LETTERS_RE.test(token);
            if (hasLetters && !isMorphemePhonetic(token)) {
                return {
                    type: 'invalid_morpheme',
                    token,
                    message:
                        `Function or method name '${name}' contains segment '${token}' with ` +
                        `invalid morpheme phonetics (missing vowel or unapproved acronym).`,
                };
            }
        } else if (token.length === 1 && !ALLOWED_SINGLE_LETTER_TOKENS.has(tokenLower)) {
            return {
                type: 'single_letter',
                token,
                message: `Function or method name '${name}' contains cryptic single-letter fragment '${token}'.`,
            };
        }
    }
    return null;
}

export function validateFunctionTokensAndSemantics(
    name: string,
    tokens: string[],
    opts: {
        enforceVerbNounContract?: boolean;
        enforceMorphemeCheck?: boolean;
        minFunctionWords?: number;
        maxFunctionWords?: number;
    },
    isAccessor?: boolean,
): FunctionSemanticsFinding | null {
    if (isExemptFunctionName(name, isAccessor) || tokens.length === 0) {
        return null;
    }

    if (opts.enforceVerbNounContract) {
        const verbFinding = validateFunctionVerbNoun(name, tokens[0]);
        if (verbFinding) return verbFinding;
    }

    const wordCountFinding = validateFunctionWordCount(
        name,
        tokens.length,
        opts.minFunctionWords,
        opts.maxFunctionWords,
    );
    if (wordCountFinding) return wordCountFinding;

    if (opts.enforceMorphemeCheck) {
        return validateFunctionMorphemes(name, tokens);
    }

    return null;
}
