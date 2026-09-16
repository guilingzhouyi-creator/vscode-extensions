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

/**
 * Semantic domains a hardcoded literal can be classified into.
 *
 * The kind drives grouping and reporting only and carries no severity of its own; `general`
 * means no specialized domain matched. Several kinds are reasonable by design (delimiters,
 * paths, globs and report prose); see `classifyLiteral`.
 */
export type LiteralSemanticKind =
    | 'url'
    | 'file-path'
    | 'inline-svg'
    | 'port'
    | 'http-status'
    | 'time-ms'
    | 'glob-pattern'
    | 'message-text'
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
    'void 0',
    'application/json',
    'text/plain',
    'text/html',
    'development',
    'production',
    'test',
    'staging',
]);

/** Minimum length before a spaced/CJK string counts as report prose rather than a value. */
const MIN_MESSAGE_LENGTH = 8;

/** Longest path-like specifier still treated as a structural pattern. */
const MAX_PATTERN_LENGTH = 256;

/** Decorative run: one character repeated at least this many times (ASCII banners). */
const MIN_BANNER_RUN = 8;
const BANNER_RE = new RegExp(`^(.)\\1{${MIN_BANNER_RUN - 1},}$`);
const GLOB_META_RE = /[*?{}[\]]/;
const RELATIVE_SPECIFIER_RE = /^(?:\.{1,2}\/|[A-Za-z0-9_@.-]+\/)/;
const CJK_RE = /[　-〿一-鿿＀-￯]/;
const CREDENTIAL_RE =
    /(?:ghp_|gho_|github_pat_|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-|-----BEGIN|Bearer\s)/i;

/**
 * Detect report/specifier vocabulary that must not be treated as extractable literal values.
 *
 * @param raw - Raw literal spelling.
 * @returns The benign semantic kind, or null when the value carries real payload.
 */
function reportVocabularyKind(raw: string): LiteralSemanticKind | null {
    if (raw.length === 0) return null;
    if (BANNER_RE.test(raw)) return 'message-text';
    if (raw.length >= MIN_MESSAGE_LENGTH && (/\s/.test(raw) || CJK_RE.test(raw)))
        return 'message-text';
    if (
        raw.length <= MAX_PATTERN_LENGTH &&
        !/\s/.test(raw) &&
        (GLOB_META_RE.test(raw) || RELATIVE_SPECIFIER_RE.test(raw))
    ) {
        return 'glob-pattern';
    }
    return null;
}

/**
 * Classifies a raw literal into its semantic domain.
 *
 * Numeric input is matched against the HTTP-status, duration and port sets before the generic
 * number rules apply; string input is stripped of surrounding quotes and matched against inline
 * SVG, URL, path and benign-delimiter sets. The function is total: anything unmatched falls
 * back to `kind: 'general'`, with `isReasonable` derived from the value instead of failing.
 *
 * @param rawVal - Literal text exactly as written in source, quotes included for strings; it is
 *   pattern-matched, never evaluated as code, so hostile text cannot execute here.
 * @param numeric - `true` when the literal is a numeric literal and the number rules should run;
 *   `false` selects the string rules and quote stripping.
 * @returns The matched domain, the reasonableness verdict, the recommended constant-name
 *   prefix and a rationale; never throws, so callers can classify every literal unconditionally.
 */
export function classifyLiteral(rawVal: string, numeric: boolean): SemanticClassification {
    if (numeric) {
        const num = Number(rawVal);
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

        if (
            COMMON_PORTS.has(num) ||
            (Number.isInteger(num) && num >= EPHEMERAL_PORT_MIN && num <= PORT_MAX)
        ) {
            return {
                kind: 'port',
                isReasonable: false,
                suggestedConstPrefix: `PORT_${num}`,
                rationale:
                    'Network port should be configured via environment or server configuration',
            };
        }

        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: Math.abs(num) <= 1, // 0, 1, -1 are universally reasonable
            suggestedConstPrefix: `CONST_${Math.abs(Math.round(num))}`,
            rationale: 'Generic magic number',
        };
    }

    // String literals
    const unquoted = rawVal.replace(/^['"`]|['"`]$/g, '').trim();

    if (REASONABLE_STRINGS.has(unquoted.toLowerCase())) {
        return {
            kind: GENERAL_LITERAL_KIND,
            isReasonable: true,
            suggestedConstPrefix: 'LITERAL',
            rationale: 'Standard delimiter, format keyword, or benign literal',
        };
    }

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

    // Vocabulary is checked last so specialised domains keep their identity (an inline SVG is
    // still an SVG, not prose), while credential-shaped values are vetoed first.
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
