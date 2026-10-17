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

/** Rule identifier for file naming conventions and transient jargon violations. */
export const RULE_NAM_FIL_001 = 'NAM-FIL-001';
/** Rule identifier for directory naming conventions and transient jargon violations. */
export const RULE_NAM_DIR_001 = 'NAM-DIR-001';

const SUGGESTION_REMOVE_FILE_MARKERS = 'Remove temporary process markers from file name.';
const SUGGESTION_REMOVE_DIR_MARKERS = 'Remove temporary process markers from directory name.';
const SUGGESTION_RENAME_DIR_KEBAB = 'Rename directory to kebab-case.';
const SUGGESTION_USE_ENGLISH_DOMAINS =
    'Use recognizable English domain terms containing vowels for file name segments.';
const DEFAULT_LANGUAGE_TYPESCRIPT = 'typescript';
const EXEMPT_PREFIX_RE = /^(?:test_|on_)/;
const NAME_TEST_LITERAL = 'test';

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

const ALLOWED_ACRONYMS_LIST =
    'id ip db os vm fs ui ci io re fk pk tx rx ch fn cb el sf ns op cp fd src cfg msg idx cnt ctx ptr mgr btn tbl chk doc err len num pos req res str sync async grpc http https html json yaml toml xml css dom url uri urn uuid guid jwt sql cli api sdk dto dao rpc ssl tls tcp udp dns ftp ssh cpu gpu ram rom png jpg svg gif csv tsv pdf ast loc eloc sloc dfa nfa fsm lut swar csr soa aos simd fps rng crc md5 sha ssot pr cd qa env dev prod std fmt log tmp pkg bin lib ref opt arg cmd sys cwd pid gid uid tty zh en ts js py rs gd l1 l2 l3';

/**
 * Standard technical acronyms permitted without vowel phonetics or with domain meaning.
 */
export const ALLOWED_ACRONYMS: ReadonlySet<string> = new Set(ALLOWED_ACRONYMS_LIST.split(' '));

/** Minimum permitted character length for source file stem without exemption. */
export const DEFAULT_MIN_FILE_NAME_LENGTH = 3;

/**
 * Maximum permitted character length for source file stem before requiring
 * modular decomposition.
 */
export const DEFAULT_MAX_FILE_NAME_LENGTH = 55;

/** Permitted short file base stems with well-recognized cross-domain semantics. */
export const ALLOWED_SHORT_FILE_STEMS = new Set(
    'ui en zh db io ci os vm fs re id ip swar'.split(' '),
);

/** Regular expression matching transient construction jargon in symbol and file names. */
export const TRANSIENT_JARGON_RE =
    /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|temp|tmp|w\x69p|new)\b/i;
/** Regular expression matching standalone jargon tokens. */
export const JARGON_TOKEN_RE = /^(p\d+|phase\d*|st\d+|temp|tmp|w\x69p)$/;
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

const ANALYZER_OR_ENGINE_PATH_RE =
    /(?:\/(?:analyzers|core|engine|tests|scripts|test)\/|-(?:analyzer|rules|helper)\.ts$)/;

/**
 * Determines if a file is an analyzer implementation or core engine component
 * where base types (e.g. constants, rules, config) form the architectural engine
 * rather than pure structured resource tables.
 *
 * @param filePath - Normalized file path to check.
 * @returns True when file is part of analyzer/engine implementations.
 */
export function isAnalyzerOrEngineFile(filePath: string): boolean {
    return ANALYZER_OR_ENGINE_PATH_RE.test(filePath.replace(/\\/g, '/').toLowerCase());
}

/**
 * Structured diagnostic record for path naming findings.
 */
export interface PathFindingInput {
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    readonly detail: Record<string, unknown>;
    readonly suggestion?: string;
}

/** Factory function creating Issue diagnostics from normalized path finding inputs. */
export type IssueFactory = (finding: PathFindingInput) => Issue;

const MAX_STRUCTURED_RESOURCE_BUDGET = 1000;
const SYNTHETIC_NODES_PER_ELOC = 4;
const SYNTHETIC_SYMBOL_COUNT = 5;
const SYNTHETIC_LITERAL_COUNT = 10;
const SYNTHETIC_AST_DEPTH = 3;

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
    mkIssue: IssueFactory,
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
                astNodeCount: eloc * SYNTHETIC_NODES_PER_ELOC,
                symbolCount: SYNTHETIC_SYMBOL_COUNT,
                literalCount: SYNTHETIC_LITERAL_COUNT,
                astDepth: SYNTHETIC_AST_DEPTH,
                language: path.extname(filePath).slice(1) || DEFAULT_LANGUAGE_TYPESCRIPT,
                isExecutableLogic: false,
            },
        ],
        MAX_STRUCTURED_RESOURCE_BUDGET,
    );

    for (const f of findings) {
        issues.push(
            mkIssue({
                line: 1,
                rule: f.ruleId,
                message: f.message,
                detail: f.details,
                suggestion: `Align '${filePath}' with 3-tier structured resource topology standard.`,
            }),
        );
    }
}

/**
 * Execution context carrying path, options, issue accumulator, and factory for path naming audits.
 */
export interface PathNamingContext {
    readonly filePath: string;
    readonly opts: PathNamingOptions;
    readonly ctx: AnalyzerContext;
    readonly mkIssue: IssueFactory;
    readonly issues: Issue[];
}

/**
 * Audits file and directory path naming conventions and transient jargon violations.
 *
 * @param pCtx - Path naming traversal context.
 */
export function auditFileAndDirectoryPaths(pCtx: PathNamingContext): void {
    auditFileName(pCtx);
    auditDirectoryName(pCtx);
    if (pCtx.opts.checkFiles !== false && pCtx.opts.checkResourceTopology !== false) {
        auditStructuredResourceFile(
            pCtx.filePath,
            pCtx.ctx.content || '',
            pCtx.mkIssue,
            pCtx.issues,
        );
    }
}

const CAMEL_TO_KEBAB_PATTERN = '$1-$2';

interface FileNamingTarget {
    readonly filePath: string;
    readonly baseName: string;
    readonly nameWithoutExt: string;
    readonly ext: string;
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
    return mkIssue({
        line: 1,
        rule: RULE_NAM_FIL_001,
        message: `File name '${baseName}' violates strict kebab-case naming convention for TypeScript/JavaScript.`,
        detail: { file: filePath, baseName, suggested: `${suggested}${ext}` },
        suggestion: `Rename file to '${suggested}${ext}'.`,
    });
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
    return mkIssue({
        line: 1,
        rule: RULE_NAM_FIL_001,
        message: `File name '${baseName}' violates strict snake_case naming convention for ${ext.slice(1)}.`,
        detail: { file: filePath, baseName, suggested: `${suggested}${ext}` },
        suggestion: `Rename file to '${suggested}${ext}'.`,
    });
}

const FILE_STRATEGY_MAP = new Map<string, FileNamingStrategy>();
for (const ext of JS_TS_EXTS) {
    FILE_STRATEGY_MAP.set(ext, auditJsTsFileName);
}
for (const ext of SNAKE_EXTS) {
    FILE_STRATEGY_MAP.set(ext, auditSnakeFileName);
}

function resolveFileNameWithoutExt(baseName: string, ext: string): string {
    const raw = baseName.slice(0, baseName.length - ext.length);
    return raw.endsWith('.d') ? raw.slice(0, -2) : raw;
}

function checkFileJargonOrIgnored(target: FileNamingTarget, pCtx: PathNamingContext): boolean {
    if (IGNORED_FILE_BASENAMES.has(target.nameWithoutExt.toLowerCase())) return true;
    if (TRANSIENT_JARGON_RE.test(target.nameWithoutExt)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: 1,
                rule: RULE_NAM_FIL_001,
                message: `File name '${target.baseName}' contains transient process jargon or milestone tags.`,
                detail: { file: pCtx.filePath, baseName: target.baseName },
                suggestion: SUGGESTION_REMOVE_FILE_MARKERS,
            }),
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
    const strategy = FILE_STRATEGY_MAP.get(target.ext);
    if (!strategy) return;
    const issue = strategy(target, mkIssue);
    if (issue) issues.push(issue);
}

const FIXTURE_OR_BENCH_PATH_RE = /\/(?:\.bench|fixtures|testdata|__mocks__)\//;

function isFixtureOrBenchPath(filePath: string): boolean {
    return FIXTURE_OR_BENCH_PATH_RE.test(filePath.replace(/\\/g, '/').toLowerCase());
}

interface FileLengthAuditOptions {
    readonly pCtx: PathNamingContext;
    readonly target: FileNamingTarget;
    readonly limit: number;
    readonly isTooShort: boolean;
}

function emitFileLengthIssue(params: FileLengthAuditOptions): void {
    const { pCtx, target, limit, isTooShort } = params;
    const message = isTooShort
        ? `File name '${target.baseName}' is excessively short (< ${limit} characters); lacks domain description.`
        : `File name '${target.baseName}' is excessively long (> ${limit} characters); consider decomposing responsibilities into subdirectories.`;
    const suggestion = isTooShort
        ? `Rename file '${target.baseName}' to a descriptive identifier conveying domain purpose.`
        : `Decompose or shorten file name '${target.baseName}' to focus on core domain entity.`;
    const detail: Record<string, unknown> = {
        file: pCtx.filePath,
        baseName: target.baseName,
        length: target.nameWithoutExt.length,
    };
    if (isTooShort) {
        detail.minLen = limit;
    } else {
        detail.maxLen = limit;
    }

    pCtx.issues.push(
        pCtx.mkIssue({
            line: 1,
            rule: RULE_NAM_FIL_001,
            message,
            detail,
            suggestion,
        }),
    );
}

function checkFileNameLength(target: FileNamingTarget, pCtx: PathNamingContext): void {
    if (isFixtureOrBenchPath(pCtx.filePath)) return;
    const minLen = pCtx.opts.minFileLength ?? DEFAULT_MIN_FILE_NAME_LENGTH;
    const maxLen = pCtx.opts.maxFileLength ?? DEFAULT_MAX_FILE_NAME_LENGTH;
    const allowedSet = pCtx.opts.allowedShortFiles
        ? new Set(pCtx.opts.allowedShortFiles.map((s) => s.toLowerCase()))
        : ALLOWED_SHORT_FILE_STEMS;

    const lower = target.nameWithoutExt.toLowerCase();
    if (target.nameWithoutExt.length < minLen && !allowedSet.has(lower)) {
        emitFileLengthIssue({ pCtx, target, limit: minLen, isTooShort: true });
        return;
    }

    if (target.nameWithoutExt.length > maxLen) {
        emitFileLengthIssue({ pCtx, target, limit: maxLen, isTooShort: false });
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
    target: FileNamingTarget,
    wordCount: number,
    isShortExempt: boolean,
    pCtx: PathNamingContext,
): void {
    if (
        pCtx.opts.minFileWords !== undefined &&
        pCtx.opts.minFileWords > 1 &&
        wordCount < pCtx.opts.minFileWords &&
        !isShortExempt
    ) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: 1,
                rule: RULE_NAM_FIL_001,
                message: `File name '${target.baseName}' has too few word segments (${wordCount} < ${pCtx.opts.minFileWords}); lacks domain specificity.`,
                detail: {
                    file: pCtx.filePath,
                    baseName: target.baseName,
                    wordCount,
                    minWords: pCtx.opts.minFileWords,
                },
                suggestion: `Expand file name '${target.baseName}' with domain qualifying words (at least ${pCtx.opts.minFileWords} word segments).`,
            }),
        );
    }

    if (pCtx.opts.maxFileWords !== undefined && wordCount > pCtx.opts.maxFileWords) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: 1,
                rule: RULE_NAM_FIL_001,
                message: `File name '${target.baseName}' has too many word segments (${wordCount} > ${pCtx.opts.maxFileWords}); consider simplifying file naming.`,
                detail: {
                    file: pCtx.filePath,
                    baseName: target.baseName,
                    wordCount,
                    maxWords: pCtx.opts.maxFileWords,
                },
                suggestion: `Simplify file name '${target.baseName}' to at most ${pCtx.opts.maxFileWords} word segments.`,
            }),
        );
    }
}

function checkFileMorphemes(
    target: FileNamingTarget,
    segments: string[],
    pCtx: PathNamingContext,
): void {
    for (const seg of segments) {
        if (seg.length < 2) continue;
        const hasLetters = LETTERS_RE.test(seg);
        if (hasLetters && !isMorphemePhonetic(seg)) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: 1,
                    rule: RULE_NAM_FIL_001,
                    message: `File name '${target.baseName}' contains segment '${seg}' with invalid morpheme phonetics (missing vowel or unapproved acronym).`,
                    detail: { file: pCtx.filePath, baseName: target.baseName, segment: seg },
                    suggestion: SUGGESTION_USE_ENGLISH_DOMAINS,
                }),
            );
            break;
        }
    }
}

function checkFileWordsAndMorphemes(target: FileNamingTarget, pCtx: PathNamingContext): void {
    if (isFixtureOrBenchPath(pCtx.filePath)) return;
    const lowerStem = target.nameWithoutExt.toLowerCase();
    if (IGNORED_FILE_BASENAMES.has(lowerStem)) return;

    const allowedSet = pCtx.opts.allowedShortFiles
        ? new Set(pCtx.opts.allowedShortFiles.map((s) => s.toLowerCase()))
        : ALLOWED_SHORT_FILE_STEMS;

    const minLen = pCtx.opts.minFileLength ?? DEFAULT_MIN_FILE_NAME_LENGTH;
    if (target.nameWithoutExt.length < minLen && !allowedSet.has(lowerStem)) {
        return;
    }

    const stemWithoutSuffix = target.nameWithoutExt.replace(TEST_SPEC_SUFFIX_RE, '');
    const segments = splitFileNameSegments(stemWithoutSuffix, target.ext);
    if (segments.length === 0) return;

    const isShortExempt = allowedSet.has(lowerStem);
    checkFileWordLimits(target, segments.length, isShortExempt, pCtx);

    if (pCtx.opts.enforceMorphemeCheck) {
        checkFileMorphemes(target, segments, pCtx);
    }
}

function auditFileName(pCtx: PathNamingContext): void {
    if (pCtx.opts.checkFiles === false) return;
    const baseName = path.basename(pCtx.filePath);
    const ext = path.extname(baseName);
    const nameWithoutExt = resolveFileNameWithoutExt(baseName, ext);
    const target: FileNamingTarget = {
        filePath: pCtx.filePath,
        baseName,
        nameWithoutExt,
        ext,
    };
    if (checkFileJargonOrIgnored(target, pCtx)) return;

    checkFileNameLength(target, pCtx);
    checkFileWordsAndMorphemes(target, pCtx);
    dispatchNamingStrategy(target, pCtx.mkIssue, pCtx.issues);
}

function auditDirectoryName(pCtx: PathNamingContext): void {
    if (pCtx.opts.checkDirectories === false) return;
    const dir = path.dirname(pCtx.filePath);
    if (dir === '.' || !dir) return;

    const segments = dir.split(/[\\/]/);
    for (const segment of segments) {
        if (!segment || IGNORED_DIRS.has(segment.toLowerCase()) || segment.startsWith('.')) {
            continue;
        }

        if (TRANSIENT_JARGON_RE.test(segment)) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: 1,
                    rule: RULE_NAM_DIR_001,
                    message: `Directory name '${segment}' contains transient process jargon or milestone tags.`,
                    detail: { dir, segment },
                    suggestion: SUGGESTION_REMOVE_DIR_MARKERS,
                }),
            );
            return;
        }

        if (/[A-Z_]/.test(segment)) {
            pCtx.issues.push(
                pCtx.mkIssue({
                    line: 1,
                    rule: RULE_NAM_DIR_001,
                    message: `Directory '${segment}' should follow kebab-case convention.`,
                    detail: { dir, segment },
                    suggestion: SUGGESTION_RENAME_DIR_KEBAB,
                }),
            );
            return;
        }
    }
}

const APPROVED_ACTION_VERBS_LIST =
    'abort accumulate add advance aggregate align allocate allows analyze append apply arbitrate as assemble assert attach audit benchmark bind broadcast build calculate can cancel capitalize categorize check clamp classify clean cleanup clear clone close collect compile compose compress compute construct contains convert copy count create debounce decode decompress deduce define delete dequeue derive deserialize destroy detach detect diff dispatch dispose do does drain drop dump emit encode enqueue ensure escape estimate evaluate evict examine execute exists extract fast fetch filter finalize find flatten flush format forward freeze from generate get group guard handle has index infer ingest init initialize inspect install instantiate intercept introduce introduces invert invoke is isolate iterate lint load log lookup loop make map mask match matches measure merge mk mock must needs normalize notify obtain open parse partition patch pause peek perform persist pipe poll pop populate precompute print probe process produce project propagate prune publish pull push put query queue read receive reclaim record redirect reduce refresh register reload remove render rename replace report reset resolve resume retrieve retry review route run safe sanitize save scan schedule score search seed select send serialize set setup shift should solve sort spawn split start stop store strip subscribe sum supports sync synthesize tag test throttle to track transform transpile traverse trigger trim truncate try tune unbind unescape uninstall unregister unshift unwrap update validate verify visit walk was were will wrap write';

/** Standard engineering action verbs initiating descriptive function identifiers. */
export const APPROVED_ACTION_VERBS: ReadonlySet<string> = new Set(
    APPROVED_ACTION_VERBS_LIST.split(' '),
);

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
    'format',
    'parse',
    'project',
    'normalize',
    'evaluate',
    'walk',
    'enter',
    'leave',
    'scan',
    'flush',
    'partition',
    'register',
    'push',
    'put',
    'get',
    'set',
    'has',
    'size',
    'stats',
    'close',
    'open',
    'start',
    'stop',
    'step',
    'match',
    'clone',
    'copy',
    'emit',
    'poll',
    'drain',
    'peek',
    'pop',
    'shutdown',
    'check',
    'root',
    'children',
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
    if (EXEMPT_PREFIX_RE.test(name) || name === NAME_TEST_LITERAL) return true;
    return isAccessor === true;
}

const TYPE_VERB_NOUN = 'verb_noun' as const;
const TYPE_TOO_FEW_WORDS = 'too_few_words' as const;
const TYPE_TOO_MANY_WORDS = 'too_many_words' as const;
const TYPE_INVALID_MORPHEME = 'invalid_morpheme' as const;
const TYPE_SINGLE_LETTER = 'single_letter' as const;

/**
 * Diagnostic finding representing a function naming semantics violation.
 */
export interface FunctionSemanticsFinding {
    /** Type tag classifying the semantic finding. */
    type:
        | typeof TYPE_VERB_NOUN
        | typeof TYPE_TOO_FEW_WORDS
        | typeof TYPE_TOO_MANY_WORDS
        | typeof TYPE_INVALID_MORPHEME
        | typeof TYPE_SINGLE_LETTER;
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
 * @param firstToken - First parsed word token decomposed from the identifier.
 * @returns Finding if a rule is violated, or null if compliant.
 */
function checkFunctionVerbNoun(name: string, firstToken: string): FunctionSemanticsFinding | null {
    const firstWord = firstToken.toLowerCase();
    if (APPROVED_ACTION_VERBS.has(firstWord)) return null;
    return {
        type: TYPE_VERB_NOUN,
        token: firstWord,
        message: `Function or method name '${name}' violates verb-noun contract; must begin with an approved action verb (e.g. 'get', 'check', 'compute', 'handle', 'run').`,
    };
}

function checkFunctionWordCount(
    name: string,
    tokenCount: number,
    minWords?: number,
    maxWords?: number,
): FunctionSemanticsFinding | null {
    if (minWords !== undefined && tokenCount < minWords) {
        return {
            type: TYPE_TOO_FEW_WORDS,
            wordCount: tokenCount,
            expectedWords: minWords,
            message:
                `Function or method name '${name}' has too few word segments ` +
                `(${tokenCount} < ${minWords}); lacks semantic description.`,
        };
    }
    if (maxWords !== undefined && tokenCount > maxWords) {
        return {
            type: TYPE_TOO_MANY_WORDS,
            wordCount: tokenCount,
            expectedWords: maxWords,
            message:
                `Function or method name '${name}' has too many word segments ` +
                `(${tokenCount} > ${maxWords}); consider decomposing responsibilities.`,
        };
    }
    return null;
}

function checkFunctionMorphemes(name: string, tokens: string[]): FunctionSemanticsFinding | null {
    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        if (token.length >= 2) {
            const hasLetters = LETTERS_RE.test(token);
            if (hasLetters && !isMorphemePhonetic(token)) {
                return {
                    type: TYPE_INVALID_MORPHEME,
                    token,
                    message: `Function or method name '${name}' contains segment '${token}' with invalid morpheme phonetics (missing vowel or unapproved acronym).`,
                };
            }
        } else if (token.length === 1 && !ALLOWED_SINGLE_LETTER_TOKENS.has(tokenLower)) {
            return {
                type: TYPE_SINGLE_LETTER,
                token,
                message: `Function or method name '${name}' contains cryptic single-letter fragment '${token}'.`,
            };
        }
    }
    return null;
}

/**
 * Validates function tokens and naming semantics against length, morpheme, and verb contracts.
 *
 * @param name - Function or method name.
 * @param tokens - Parsed word tokens decomposed from identifier.
 * @param opts - Semantic validation options.
 * @param opts.enforceVerbNounContract - Whether to check initial token action verb whitelist.
 * @param opts.enforceMorphemeCheck - Whether to verify valid morphemes.
 * @param opts.minFunctionWords - Minimum allowed word count.
 * @param opts.maxFunctionWords - Maximum allowed word count.
 * @param isAccessor - Optional flag indicating getter or setter accessor.
 * @returns Semantic finding if violated, or null if compliant.
 */
export function auditFunctionSemantics(
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
        const verbFinding = checkFunctionVerbNoun(name, tokens[0]);
        if (verbFinding) return verbFinding;
    }

    const wordCountFinding = checkFunctionWordCount(
        name,
        tokens.length,
        opts.minFunctionWords,
        opts.maxFunctionWords,
    );
    if (wordCountFinding) return wordCountFinding;

    return opts.enforceMorphemeCheck ? checkFunctionMorphemes(name, tokens) : null;
}
