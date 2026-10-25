/**
 * Semantic Literal Classification and Governance.
 * Module: Core Governance — Semantic Literal Classification
 * File Path: src/core/governance/semanticLiterals.ts
 * Architecture Role: Pure classifier consumed by the constants analyzer to group hardcoded
 *     literals into semantic domains and flag the ones that should become named constants.
 * Dependencies & Triggers: No imports; called by src/analyzers/constants.ts only when
 *     ctx.options.classifyLiterals is enabled, once per emitted string or numeric literal.
 * Responsibilities: Classify numbers as http-status, time-ms, port, or general using
 *     HTTP_STATUS_CODES, COMMON_TIME_MS, COMMON_PORTS, and the inclusive 1024-65535 range;
 *     classify strings as inline-svg, url, file-path, or general using INLINE_SVG_RE, URL_RE,
 *     PATH_PREFIX_RE and FILE_EXT_RE, and treat engine vocabulary (rule ids, test-framework
 *     symbols, filename-pattern probes) as conventional rather than extractable,
 *     PATH_PREFIX_RE, and FILE_EXT_RE; suppress benign structural literals through
 *     REASONABLE_STRINGS; return kind, isReasonable, suggestedConstPrefix, and rationale.
 * Exit Semantics & Design Rationale: Total, side-effect-free function that always returns a
 *     classification and never throws; plain regex and Set lookups keep per-literal cost low
 *     so the analyzer can classify every literal without turning on heuristics.
 *
 * Categorizes raw literal values into specialized semantic domains:
 * - URL: HTTP/HTTPS/WebSocket URLs
 * - FILE_PATH: Absolute, relative, or extension-based filesystem paths
 * - INLINE_SVG: Embedded SVG XML markup
 * - PORT: Valid network port numbers (1 - 65535)
 * - HTTP_STATUS: Standard HTTP status codes (100 - 599)
 * - TIME_MS: Common time durations in milliseconds
 * - GENERAL: Generic literal values
 *
 * Also provides contextual suppression for benign / structural literals
 * to eliminate mechanical false positives.
 */

/** Fallback semantic kind when no specialized literal domain matches. */
const GENERAL_LITERAL_KIND = 'general';

/** Semantic classification kind representing a network URL endpoint. */
export const SEMANTIC_KIND_URL = 'url';

/** Semantic classification kind representing a local or relative filesystem path. */
export const SEMANTIC_KIND_FILE_PATH = 'file-path';

/**
 * Semantic domains a hardcoded literal can be classified into.
 *
 * The kind drives grouping and reporting only and carries no severity of its own; `general`
 * means no specialized domain matched. Several kinds are reasonable by design (delimiters,
 * paths, globs and report prose); see `classifyLiteral`.
 */
export type LiteralSemanticKind =
    | typeof SEMANTIC_KIND_URL
    | typeof SEMANTIC_KIND_FILE_PATH
    | 'inline-svg'
    | 'port'
    | 'http-status'
    | 'time-ms'
    | 'glob-pattern'
    | 'message-text'
    | 'conventional'
    | typeof GENERAL_LITERAL_KIND;

/**
 * Classification verdict for exactly one literal.
 *
 * `isReasonable` is the governance signal: `true` suppresses the hardcoded-literal finding
 * because the value is structural or conventional, while `false` asks the analyzer to report
 * it using `suggestedConstPrefix` as the recommended constant-name stem and `rationale` as the
 * human-readable justification. Non-slug values such as non-finite numbers stay `general` and
 * reasonable rather than being forced into a domain.
 */
export interface SemanticClassification {
    kind: LiteralSemanticKind;
    isReasonable: boolean;
    suggestedConstPrefix: string;
    rationale: string;
}

const URL_RE = /^(?:https?|wss?|ftp):\/\/[^\s"'`<>]+$/i;
const PATH_PREFIX_RE = /^(?:\/|[a-zA-Z]:[\\/]|\.\.?[\\/])/;
const FILE_EXT_RE =
    /\.(?:json|ya?ml|toml|png|jpe?g|gif|svg|ico|css|scss|html|wasm|proto|graphql|sql|md)$/i;
const INLINE_SVG_RE = /^\s*<svg(?:\s+[^>]*>|>)/i;

/** Millisecond threshold above which a duration reads more naturally in seconds. */
const MS_PER_SECOND = 1000;
/** First ephemeral port; the IANA dynamic range ends at `PORT_MAX`. */
const EPHEMERAL_PORT_MIN = 1024;
/** Highest valid TCP/UDP port number. */
const PORT_MAX = 65535;

// NOTE: the three tables below are *policy data* (known port/status/duration values), not magic
// numbers: the engine's own `magic-number` rule is suppressed for this file in the self-audit
// config, because splitting a lookup table into hundreds of named scalars would hurt readability
// without adding meaning.
const COMMON_PORTS = new Set([
    21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 1433, 1521, 2375, 2376, 27017, 3000,
    3306, 4200, 5000, 5432, 6379, 7000, 8000, 8080, 8443, 8888, 9000, 9092, 9200,
]);

const HTTP_STATUS_CODES = new Set([
    200, 201, 202, 204, 301, 302, 304, 307, 308, 400, 401, 403, 404, 405, 409, 410, 422, 429, 500,
    501, 502, 503, 504,
]);

const COMMON_TIME_MS = new Set([
    10, 50, 100, 200, 250, 500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000, 300000,
    600000, 1800000, 3600000, 86400000,
]);

// Structural or syntactic delimiters that should NOT trigger hardcoding alarms
const REASONABLE_STRINGS = new Set([
    '',
    ' ',
    '\n',
    '\r',
    '\t',
    '\r\n',
    // The ESCAPE SPELLINGS of the control characters above (`'\n'` as written in source) are a
    // different string from the real byte: serializers, joiners and line splitters repeat them by
    // design, so both spellings must classify as delimiters rather than as extractable vocabulary.
    '\\n',
    '\\r',
    '\\t',
    '\\r\\n',
    // Python docstring fences: delimiters of the comment grammar itself, not extractable content.
    '"""',
    "'''",
    ',',
    ';',
    ':',
    '.',
    '/',
    '\\',
    '|',
    '-',
    '_',
    '+',
    '=',
    '*',
    '&',
    '^',
    '%',
    '$',
    '#',
    '@',
    '!',
    '?',
    '~',
    '`',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '<',
    '>',
    'utf-8',
    'utf8',
    'ascii',
    'hex',
    'base64',
    'binary',
    'get',
    'post',
    'put',
    'delete',
    'patch',
    'head',
    'options',
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'HEAD',
    'OPTIONS',
    'true',
    'false',
    'null',
    'undefined',
    'boolean',
    'number',
    'string',
    'symbol',
    'function',
    'object',
    'bigint',
    'void 0',
    'application/json',
    'text/plain',
    'text/html',
    'development',
    'production',
    'test',
    'staging',
    // Delimiters, regex captures, comment tags, and sentinels
    '\n\n',
    '\r\n\r\n',
    '\\n\\n',
    '\\r\\n\\r\\n',
    '\u0000',
    '\\u0000',
    ':memory:',
    ' -> ',
    '/*',
    '*/',
    '#>',
    '<#',
    '\\$&',
    '$&',
    '$1-$2',
    '$1',
    '$2',
    '$3',
    '.test.ts',
    '.spec.ts',
    '.test.js',
    '.spec.js',
    '.d.ts',
]);

/** Minimum length before a spaced/CJK string counts as report prose rather than a value. */
const MIN_MESSAGE_LENGTH = 8;

/** Longest path-like specifier still treated as a structural pattern. */
const MAX_PATTERN_LENGTH = 256;

/** Decorative run: one character repeated at least this many times (ASCII banners). */
const MIN_BANNER_RUN = 8;
const BANNER_RE = new RegExp(`^(.)\\1{${MIN_BANNER_RUN - 1},}$`);
const GLOB_META_RE = /[*?{}[\]]/;
const RELATIVE_SPECIFIER_RE = /^(?:\.{1,2}\/|\/[A-Za-z0-9_@.-]+\/|[A-Za-z0-9_@.-]+\/)/;
/** Rust path prefixes (`std::`, `crate::`) are module vocabulary, like a relative specifier. */
const RUST_PATH_PREFIX_RE = /^(?:std|crate|core|super|self)::/;
/** Assertion snippets the test rules compare against (`expect(`, `assert.`) are probe text. */
const TEST_PROBE_RE = /^(?:expect|assert)[.(]?$/;
const CJK_RE = /[　-〿一-鿿＀-￯]/;
const CREDENTIAL_RE =
    /(?:ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-|-----BEGIN|Bearer\s)/i;

/** Conventional tokens that are vocabulary rather than payload: encodings, formats, keywords. */
const CONVENTIONAL_TOKENS = new Set([
    'utf8',
    'utf-8',
    'ascii',
    'latin1',
    'binary',
    'base64',
    'hex',
    'ucs2',
    'utf16le',
    'utf-16le',
    'md5',
    'sha1',
    'sha256',
    'sha384',
    'sha512',
    'json',
    'yaml',
    'toml',
    'xml',
    'html',
    'csv',
    'true',
    'false',
    'null',
    // Language ids and AST/type keyword names the engine compares against.
    'typescript',
    'javascript',
    'python',
    'rust',
    'gdscript',
    'string',
    'function',
    'while',
    'unknown',
    // Engine vocabulary: analyzer ids, quality dimensions, rule categories and detail tags.
    'standardization',
    'modernity',
    'codesecurity',
    'baseline',
    'suppressions',
    'complexity',
    'data-architecture',
    'test-modernity',
    'dependency-layout',
    'cycle',
    'cycle-breaker',
    'driver-call',
    'query',
    'serialization',
    'validation',
    'inline-url',
    'anonymous',
    'const_str',
    'migration',
    'seed',
    'internal-shared',
    'skip',
    'lazy',
    'assert',
    '1===1',
    '1==1',
    // Version control & protocol vocabulary
    'blob',
    'tree',
    'commit',
    'tag',
    // Severities & technical debt tiers
    'error',
    'info',
    'debug',
    'trace',
    'critical',
    'high',
    'medium',
    'low',
    'fatal',
    // Gate closed verdict status words (AGENTS.md GUARD-FBK-001)
    'pass',
    'fail',
    'skip',
    'block',
    'passed',
    'failed',
    // Eight strategic quality pillars (AGENTS.md)
    'architecture',
    'maintainability',
    'performance',
    'data',
    'testing',
    'reliability',
    'security',
    'extensibility',
    // Ten-dimensional micro-quality indices
    'architectureconsistency',
    'semanticpurity',
    'codesecurity',
    'performanceefficiency',
    'standardization',
    'modernity',
    'commentquality',
    'duplication',
    'techdebtrisk',
    // Node.js standard builtins & stdio modes
    'fs',
    'os',
    'child_process',
    'util',
    'events',
    'stream',
    'crypto',
    'buffer',
    'url',
    'http',
    'https',
    'module',
    'inherit',
    'pipe',
    'ignore',
    'ipc',
    'win32',
    'linux',
    'darwin',
    'src',
    'scripts',
    'reports',
    'docs',
    'default',
    // AST keywords, types & language vocabulary
    'function',
    'class',
    'interface',
    'const',
    'let',
    'var',
    'return',
    'import',
    'export',
    'type',
    'enum',
    'switch',
    'case',
    'if',
    'else',
    'for',
    'while',
    'try',
    'catch',
    'throw',
    'break',
    'continue',
    'yield',
    'await',
    'async',
    'new',
    'delete',
    'typeof',
    'instanceof',
    'in',
    'of',
    'as',
    'is',
    'from',
    'namespace',
    'abstract',
    'implements',
    'extends',
    'super',
    'this',
    'constructor',
    'public',
    'private',
    'protected',
    'readonly',
    'static',
    'override',
    'declare',
    'keyof',
    'asserts',
    'infer',
    // Syntax node names, AST components & actionable actions
    'identifier',
    'literal',
    'expression',
    'statement',
    'declaration',
    'property',
    'method',
    'parameter',
    'parameters',
    'argument',
    'arguments',
    'body',
    'block',
    'clause',
    'condition',
    'operator',
    'left',
    'right',
    'rename_identifier',
    'extract_constant',
    'split_file',
    'decompose_complexity',
    'replace_token',
    'file',
    // Domain & governance vocabulary
    'governance',
    'major_rework_needed',
    'majorreworkneeded',
    'minor_fix_needed',
    'minorfixneeded',
    'insert',
    'main',
    'gate_infrastructure',
    'powershell',
    'pwsh',
    'depends_on',
    'dependson',
    'document',
    'struct',
    'freeze',
    'heuristic',
    'guaranteed',
    'root',
    'reject',
    'byteequal',
    'materialized',
    'node_modules',
    'core_trunk',
    'added',
    'modified',
    'deleted',
    'auto',
    'quality-regression',
    'auto_fix',
    'gate-architecture',
    'comments',
    'naming',
    'auto-refactor',
    'projection',
    '__base__',
    'active-runs.ndjson',
    'silent',
    'compute',
    'validate',
    'disallowed-import',
    'deprecated',
    'rename_symbol',
    'insert_comment_contract',
    'loop_hot',
    'entry->cond->exit',
    'secret',
    'blocked',
    'lexical_hygiene',
    'ast_complexity',
    'architecture_coupling',
    'modernity_governance',
    'git',
    'require',
    'hoist_declaration',
    'sh',
]);

/** Command-line switches such as `--root` / `-v` are interface vocabulary, not configuration. */
const CLI_FLAG_RE = /^--?[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Rule ids (`PREFIX-DOMAIN-NNN`, e.g. `CPX-SPACE-001`) are engine identifiers.
 *
 * They name a detection rule, so they can never be externalized into configuration: extracting
 * one into a constant only moves the literal, and every analyzer that emits one would need the
 * same constant. Treated as vocabulary, exactly like an encoding name.
 */
const RULE_ID_RE = /^[A-Z]{2,6}-[A-Z0-9_]{2,12}(?:-[0-9A-Z_]+)?$/;
const ENUM_TAG_RE = /^[A-Z][A-Z0-9_]{2,40}$/;

/**
 * Test-framework symbols are the assertion vocabulary of the test runner, not payload.
 *
 * `toBe` / `expect` / `jest.fn` mean the same thing in every project; a constants table for
 * them would be noise, and the modernity rules need to recognize them by name.
 */
const TEST_FRAMEWORK_SYMBOLS = new Set([
    'expect',
    'describe',
    'it',
    'test',
    'jest',
    'mock',
    'stub',
    'spy',
    'tobe',
    'toequal',
    'tostrictequal',
    'tohavebeencalled',
    'tobecalled',
    'jest.fn',
]);

/**
 * Filename-pattern probes (`spec`, `__tests__`, `_test.py`) recognize a convention.
 *
 * They are matched against a path to classify a file, so extracting them would hide the
 * convention behind a constant name rather than making it configurable.
 */
const FILENAME_PATTERN_TOKENS = new Set([
    'spec',
    '__tests__',
    'test_',
    '/test_',
    '_test.py',
    '_test.gd',
    '.test.',
    '.spec.',
    '/tests/',
    '/test/',
    '/fixtures/',
    '/mocks/',
    '/benchmarks/',
    '/dist/',
    '/src/',
    '/scripts/',
    '/core/',
    'test.ts',
    'spec.ts',
    'test.js',
    'spec.js',
    'index.ts',
    'index.js',
]);

/** Registered MIME types (`application/json`, `text/plain`) are protocol vocabulary. */
const MIME_TYPE_RE =
    /^(?:application|text|image|audio|video|font|multipart|message)\/[a-z0-9.+-]+$/;

/** Bare file extensions (`.ts`, `.mjs`) carry no payload on their own. */
const FILE_EXTENSION_RE = /^\.[A-Za-z0-9]{1,6}$/;

/** Locale tags (`en`, `zh-cn`) are standard identifiers rather than project values. */
const LOCALE_TAG_RE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;

/** Timezone offset strings (`+0000`, `-0500`) are standard protocol vocabulary. */
const TIMEZONE_OFFSET_RE = /^[+-]\d{4}$/;

const RULE_PREFIX_RE = /^[A-Z]{2,6}-$/;
const ACTION_CODE_RE = /^AR:[A-Z]{3,4}:[0-9]{3}$/;
const AST_SYNTAX_KIND_RE =
    /^[A-Z][a-zA-Z0-9]*(?:Keyword|Expression|Statement|Declaration|Literal|Token|Clause|Type)$/;
const REGEX_REPLACEMENT_RE = /^(?:\\\$&|\$&|\$[0-9]+(?:\s*[-:]\s*\$[0-9]+)?)$/;

function matchesPatternRule(raw: string, lowered: string): boolean {
    return (
        RULE_ID_RE.test(raw) ||
        RULE_PREFIX_RE.test(raw) ||
        ENUM_TAG_RE.test(raw) ||
        TEST_PROBE_RE.test(raw) ||
        CLI_FLAG_RE.test(raw) ||
        MIME_TYPE_RE.test(lowered) ||
        FILE_EXTENSION_RE.test(raw) ||
        LOCALE_TAG_RE.test(raw) ||
        TIMEZONE_OFFSET_RE.test(raw) ||
        ACTION_CODE_RE.test(raw) ||
        AST_SYNTAX_KIND_RE.test(raw) ||
        REGEX_REPLACEMENT_RE.test(raw)
    );
}

/**
 * Checks whether a literal string matches conventional vocabulary or standard tokens.
 *
 * @param raw - Original raw token string.
 * @param lowered - Lowercased token string.
 * @returns True if matched as conventional token.
 */
export function isConventionalVocabulary(raw: string, lowered: string): boolean {
    if (
        CONVENTIONAL_TOKENS.has(lowered) ||
        TEST_FRAMEWORK_SYMBOLS.has(lowered) ||
        FILENAME_PATTERN_TOKENS.has(lowered)
    ) {
        return true;
    }
    return matchesPatternRule(raw, lowered);
}

/**
 * Detects whether a string literal represents message or banner text.
 *
 * @param raw - Raw unquoted string.
 * @returns True if string matches prose or banner patterns.
 */
function isMessageText(raw: string): boolean {
    if (BANNER_RE.test(raw)) return true;
    return raw.length >= MIN_MESSAGE_LENGTH && (/\s/.test(raw) || CJK_RE.test(raw));
}

/**
 * Detects whether a string literal represents a glob or path pattern.
 *
 * @param raw - Raw unquoted string.
 * @returns True if string matches glob or relative path specifiers.
 */
function isGlobPattern(raw: string): boolean {
    if (raw.length > MAX_PATTERN_LENGTH || /\s/.test(raw)) return false;
    return (
        GLOB_META_RE.test(raw) || RELATIVE_SPECIFIER_RE.test(raw) || RUST_PATH_PREFIX_RE.test(raw)
    );
}

/**
 * Detect report/specifier vocabulary that must not be treated as extractable literal values.
 *
 * @param raw - Raw literal spelling.
 * @returns The benign semantic kind, or null when the value carries real payload.
 */
function reportVocabularyKind(raw: string): LiteralSemanticKind | null {
    if (raw.length === 0) return null;
    if (isMessageText(raw)) return 'message-text';
    if (isGlobPattern(raw)) return 'glob-pattern';
    if (isConventionalVocabulary(raw, raw.toLowerCase())) {
        return 'conventional';
    }
    return null;
}

/**
 * Classifies numeric literal into semantic domain.
 *
 * @param num - Finite or non-finite numeric value.
 * @returns Semantic classification result.
 */
function classifyNumericLiteral(num: number): SemanticClassification {
    if (!Number.isFinite(num)) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'CONST',
            rationale: 'Non-finite number',
        };
    }

    if (HTTP_STATUS_CODES.has(num)) {
        return {
            kind: 'http-status',
            isReasonable: false,
            suggestedConstPrefix: `HTTP_STATUS_${num}`,
            rationale: 'Standard HTTP status code should use shared enum or constants',
        };
    }

    if (COMMON_TIME_MS.has(num)) {
        const sec = num >= MS_PER_SECOND ? `${num / MS_PER_SECOND}S` : `${num}MS`;
        return {
            kind: 'time-ms',
            isReasonable: false,
            suggestedConstPrefix: `DURATION_${sec}`,
            rationale: 'Time duration in milliseconds should use explicit duration constants',
        };
    }

    if (num === 0xfeff || num === 65279) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'BOM_CHAR_CODE',
            rationale: 'Standard Unicode Byte Order Mark (BOM) sentinel',
        };
    }

    if (num === 0x33333333 || num === 0x55555555 || num === 0x0f0f0f0f) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'BITMASK',
            rationale: 'Popcount Hamming weight bitmask constant',
        };
    }

    if (num === 3600 || num === 86400 || num === 1e6) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'SCALE',
            rationale: 'Time or magnitude unit scale factor',
        };
    }

    if (
        COMMON_PORTS.has(num) ||
        (Number.isInteger(num) && num >= EPHEMERAL_PORT_MIN && num <= PORT_MAX)
    ) {
        return {
            kind: 'port',
            isReasonable: false,
            suggestedConstPrefix: `PORT_${num}`,
            rationale: 'Network port should be configured via environment or server configuration',
        };
    }

    return {
        kind: GENERAL_LITERAL_KIND,
        isReasonable: Math.abs(num) <= 1,
        suggestedConstPrefix: `CONST_${Math.abs(Math.round(num))}`,
        rationale: 'Generic magic number',
    };
}

/**
 * Classifies structural string literals such as SVGs, URLs, and file paths.
 *
 * @param unquoted - Trimmed string without surrounding quotes.
 * @returns Classification if matched, otherwise null.
 */
function classifyStructuralString(unquoted: string): SemanticClassification | null {
    if (INLINE_SVG_RE.test(unquoted)) {
        return {
            kind: 'inline-svg',
            isReasonable: false,
            suggestedConstPrefix: 'SVG_ICON',
            rationale:
                'Inline SVG markup should be extracted to an asset or dedicated icon component',
        };
    }

    if (URL_RE.test(unquoted)) {
        return {
            kind: 'url',
            isReasonable: false,
            suggestedConstPrefix: 'URL_ENDPOINT',
            rationale: 'Remote URL should be declared in service endpoints configuration',
        };
    }

    if (PATH_PREFIX_RE.test(unquoted) || FILE_EXT_RE.test(unquoted)) {
        return {
            kind: 'file-path',
            isReasonable: false,
            suggestedConstPrefix: 'FILE_PATH',
            rationale:
                'Filesystem path should be managed via path configuration or resource loader',
        };
    }

    return null;
}

/**
 * Classifies string literal into semantic domain.
 *
 * @param unquoted - Trimmed string without surrounding quotes.
 * @returns Semantic classification result.
 */
function classifyStringLiteral(unquoted: string): SemanticClassification {
    const lowered = unquoted.toLowerCase();
    if (REASONABLE_STRINGS.has(lowered) || isConventionalVocabulary(unquoted, lowered)) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'LITERAL',
            rationale: 'Standard delimiter, format keyword, or benign literal',
        };
    }

    const structural = classifyStructuralString(unquoted);
    if (structural) {
        return structural;
    }

    if (CREDENTIAL_RE.test(unquoted)) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: false,
            suggestedConstPrefix: 'SECRET_VALUE',
            rationale: 'Credential-shaped literal must be externalized, never exempted',
        };
    }

    const vocabulary = reportVocabularyKind(unquoted);
    if (vocabulary !== null) {
        return {
            kind: vocabulary,
            isReasonable: true,
            suggestedConstPrefix: 'TEXT',
            rationale: 'Report prose / structural specifier: not extractable vocabulary',
        };
    }

    return {
        kind: GENERAL_LITERAL_KIND,
        isReasonable: false,
        suggestedConstPrefix: 'CONST_STR',
        rationale: 'General hardcoded string',
    };
}

/**
 * Classifies a raw literal into its semantic domain.
 *
 * @param rawVal - Literal text exactly as written in source.
 * @param numeric - True for numeric literal, false for string.
 * @returns Matched classification descriptor.
 */
export function classifyLiteral(rawVal: string, numeric: boolean): SemanticClassification {
    if (numeric) {
        return classifyNumericLiteral(Number(rawVal));
    }
    const unquoted = rawVal.replace(/^['"`]|['"`]$/g, '').trim();
    return classifyStringLiteral(unquoted);
}
