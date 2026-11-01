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
    camelToSnake,
    REGEX,
    createSnakeCleanScanner,
    normalizePathSeparators,
} from '../core/constants';
import { isFixtureOrMockPath, isBenchmarkPath } from '../core/path';
import { toKebabCase, splitIdentifierWords } from '../core/naming/case-converter';
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
const NAME_TEST_LITERAL = 'test';

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
    return REGEX.NAMING.VOWEL.test(lower) || ALLOWED_ACRONYMS.has(lower);
}

const ALLOWED_ACRONYMS_LIST =
    'id ip db os vm fs ui ci io re fk pk tx rx ch fn cb el sf ns ms us op cp fd src cfg msg idx cnt ctx ptr mgr btn tbl chk doc err len num pos req res str sync async grpc http https html json yaml toml xml css dom url uri urn uuid guid jwt sql cli api sdk dto dao rpc ssl tls tcp udp dns ftp ssh cpu gpu ram rom png jpg svg gif csv tsv pdf ast loc eloc sloc dfa nfa fsm lut swar csr soa aos simd fps rng crc md5 sha ssot pr cd qa env dev prod std fmt log tmp pkg bin lib ref opt arg cmd sys cwd pid gid uid tty zh en ts js py rs gd l1 l2 l3';

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

/** Pattern matching transient construction jargon in symbol and file names (SSOT pointer). */
export const TRANSIENT_JARGON_RE = REGEX.NAMING.TRANSIENT_JARGON;
/** Regular expression matching standalone jargon tokens (SSOT pointer). */
export const JARGON_TOKEN_RE = REGEX.NAMING.JARGON_TOKEN;
/** Regular expression matching prefix tokens for multi-part jargon (SSOT pointer). */
export const JARGON_PREFIX_TOKEN_RE = REGEX.NAMING.JARGON_PREFIX_TOKEN;

/**
 * Checks whether an identifier or file stem contains transient process or iteration markers.
 *
 * @param name - Symbol or file stem to tokenize and inspect.
 * @returns True if any constituent token matches standalone or numbered jargon rules.
 */
export function hasTransientJargon(name: string): boolean {
    const tokens = camelToSnake(name).split(/[^a-z0-9]+/);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (JARGON_TOKEN_RE.test(token)) return true;
        if (
            JARGON_PREFIX_TOKEN_RE.test(token) &&
            i + 1 < tokens.length &&
            /^\d+$/.test(tokens[i + 1])
        ) {
            return true;
        }
    }
    return false;
}

const IGNORED_FILE_BASENAMES = new Set(
    'index main lib mod api types cli readme changelog license build tests'.split(' '),
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
    return REGEX.NAMING.ANALYZER_OR_ENGINE_PATH.test(normalizePathSeparators(filePath).toLowerCase());
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
const RESOURCE_SYMBOL_DECL_RE =
    /\b(?:const|let|var|function|class|interface|type|enum|def|fn)\s+[A-Za-z_$]/g;
const RESOURCE_LITERAL_TOKEN_RE = /(?:['"`]|(?:\b\d+(?:\.\d+)?\b)|\b(?:true|false|null)\b)/g;
const RESOURCE_AST_TOKEN_RE = /\b[A-Za-z0-9_$]+\b|[{}()[\].,:;=?+\-*/%&|^~<>!]+/g;
const RESOURCE_EXEC_STMT_RE = /\b(?:if|for|while|switch|try|catch)\s*\(/g;
const MIN_EXECUTABLE_LOGIC_STATEMENTS = 5;

function countRegexMatchesOnLine(line: string, pattern: RegExp): number {
    pattern.lastIndex = 0;
    let count = 0;
    while (pattern.exec(line) !== null) {
        count++;
    }
    return count;
}

function isIgnorableResourceLine(trimmed: string): boolean {
    return trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('#');
}

function advanceResourceBracketDepth(
    trimmed: string,
    state: { currentDepth: number; maxDepth: number },
): void {
    for (let j = 0; j < trimmed.length; j++) {
        const ch = trimmed.charCodeAt(j);
        if (ch === 123 || ch === 91) {
            state.currentDepth++;
            if (state.currentDepth > state.maxDepth) {
                state.maxDepth = state.currentDepth;
            }
        } else if ((ch === 125 || ch === 93) && state.currentDepth > 0) {
            state.currentDepth--;
        }
    }
}

function measureStructuredResourceMetrics(lines: readonly string[]): {
    eloc: number;
    astNodeCount: number;
    symbolCount: number;
    literalCount: number;
    astDepth: number;
    isExecutableLogic: boolean;
} {
    let eloc = 0;
    let astNodeCount = 0;
    let symbolCount = 0;
    let literalCount = 0;
    let execCount = 0;
    const depthState = { currentDepth: 0, maxDepth: 1 };

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (isIgnorableResourceLine(trimmed)) {
            continue;
        }
        eloc++;
        astNodeCount += countRegexMatchesOnLine(trimmed, RESOURCE_AST_TOKEN_RE);
        symbolCount += countRegexMatchesOnLine(trimmed, RESOURCE_SYMBOL_DECL_RE);
        literalCount += countRegexMatchesOnLine(trimmed, RESOURCE_LITERAL_TOKEN_RE);
        execCount += countRegexMatchesOnLine(trimmed, RESOURCE_EXEC_STMT_RE);
        advanceResourceBracketDepth(trimmed, depthState);
    }

    return {
        eloc: Math.max(1, eloc),
        astNodeCount: Math.max(1, astNodeCount),
        symbolCount,
        literalCount,
        astDepth: depthState.maxDepth,
        isExecutableLogic:
            execCount >= MIN_EXECUTABLE_LOGIC_STATEMENTS && execCount > symbolCount,
    };
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
    mkIssue: IssueFactory,
    issues: Issue[],
): void {
    if (isAnalyzerOrEngineFile(filePath)) return;
    const parts = parseStructuredResourceNaming(filePath);
    if (!RECOGNIZED_RESOURCE_BASE_TYPES.has(parts.baseType.toLowerCase())) return;

    const lines = (content || '').split('\n');
    const metrics = measureStructuredResourceMetrics(lines);
    const findings = auditStructuredResourceTopology(
        [
            {
                filePath,
                eloc: metrics.eloc,
                astNodeCount: metrics.astNodeCount,
                symbolCount: metrics.symbolCount,
                literalCount: metrics.literalCount,
                astDepth: metrics.astDepth,
                language: path.extname(filePath).slice(1) || DEFAULT_LANGUAGE_TYPESCRIPT,
                isExecutableLogic: metrics.isExecutableLogic,
            },
        ],
        MAX_STRUCTURED_RESOURCE_BUDGET,
    );

    for (const finding of findings) {
        issues.push(
            mkIssue({
                line: 1,
                rule: finding.ruleId,
                message: finding.message,
                detail: finding.details,
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
    const suggested = toKebabCase(nameWithoutExt);
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
    const suggested = camelToSnake(nameWithoutExt).replace(/[-]/g, '_');
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

function isFixtureOrBenchPath(filePath: string): boolean {
    return isFixtureOrMockPath(filePath) || isBenchmarkPath(filePath);
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
        ? new Set(pCtx.opts.allowedShortFiles.map((stem) => stem.toLowerCase()))
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
 * Splits a camelCase or PascalCase stem into its constituent words.
 *
 * Without this split, `daemonCmd` counts as a single word segment, so a camelCase file name
 * is reported twice: once for violating kebab-case and again for having too few words. The
 * second report is an artifact of the missing split rather than an independent defect.
 *
 * @param stem - File stem containing no separator, or a hyphen-delimited fragment of one.
 * @returns Lowercase word segments, preserving original order.
 */
function splitCamelStem(stem: string): string[] {
    return splitIdentifierWords(stem);
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
    const cleaned = isSnake ? nameWithoutExt.replace(createSnakeCleanScanner(), '') : nameWithoutExt;
    const separator = isSnake ? '_' : '-';
    return cleaned
        .split(separator)
        .flatMap((fragment) => (isSnake ? [fragment] : splitCamelStem(fragment)))
        .map((seg) => seg.trim().toLowerCase())
        .filter((seg) => seg.length > 0);
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
        const hasLetters = REGEX.NAMING.LETTERS.test(seg);
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
        ? new Set(pCtx.opts.allowedShortFiles.map((stem) => stem.toLowerCase()))
        : ALLOWED_SHORT_FILE_STEMS;

    const minLen = pCtx.opts.minFileLength ?? DEFAULT_MIN_FILE_NAME_LENGTH;
    if (target.nameWithoutExt.length < minLen && !allowedSet.has(lowerStem)) {
        return;
    }

    const stemWithoutSuffix = target.nameWithoutExt.replace(REGEX.NAMING.TEST_SPEC_SUFFIX, '');
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
    'abort accumulate acquire activate add adjust advance aggregate align allocate allows analyze append apply arbitrate as assemble assert assign attach attribute audit backtrack batch bench benchmark bind boost broadcast build calculate calibrate call can cancel capitalize cascade categorize check chunk clamp classify clean cleanup clear clone close coalesce collect commit compact compare compile compose compress compute connect construct consume contains converge convert copy count create debounce decide decode decompress deduce deduplicate define delete dequeue derive deserialize destroy detach detect diff discard dispatch dispose do does drain drop dump elect emit encode enforce enqueue enrich ensure escape estimate evaluate evict examine execute exists expand explore export extract fast fetch filter finalize find finish flatten flush fork format forward freeze from fuse generate get glob grid group guard handle has hash identify indent index infer ingest init initialize insert inspect install instantiate intercept introduce introduces intersect invalidate invert invoke is isolate iterate learn lint list load loc lock log lookup loop make map mark mask match matches materialize measure merge mine mk mock mount must needs normalize notify obtain open orchestrate pack parse partition pass patch pause peek perform persist ping pipe poll pop populate precompute prefilter prepare pregroup preload print probe process produce project propagate prune publish pull pump push put query queue read receive reclaim reconcile record redirect reduce refill refine refresh register release reload remap remove render rename replace report reset resolve resume retrieve retry revert review rewrite rollback rotate round route rss rule run safe sample sanitize save scale scan schedule score search seed seek select send serialize set setup shift should skip sleep slice solve sort spawn split stage start step stop store stream strip submit subscribe suggest sum summarize supports sweep swap sync synthesize tag terminate test throttle to tokenize touch trace track transform transpile traverse trigger trim truncate try tune turn unbind unescape uninstall unlock unmount unpack unregister unshift unstage unwrap unzip update validate vector verify visit wake walk warm was were will wrap write yield zip';

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
    'error',
    'warn',
    'info',
    'debug',
    'trace',
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

const EVENT_CALLBACK_RE = REGEX.NAMING.EVENT_CALLBACK;
const PYTHON_SPECIAL_METHOD_RE = REGEX.NAMING.PYTHON_SPECIAL_METHOD;

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
    if (REGEX.NAMING.EXEMPT_PREFIX.test(name) || name === NAME_TEST_LITERAL) return true;
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
            const hasLetters = REGEX.NAMING.LETTERS.test(token);
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
