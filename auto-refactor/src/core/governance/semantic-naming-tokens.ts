/**
 * Module: Core Governance — Semantic Naming Dictionaries & Token Registry
 * File Path: src/core/governance/semantic-naming-tokens.ts
 * Architecture Role: SSOT dictionary catalog providing frozen protocol mappings, port registries,
 *     event keywords, stop words, and canonical token prefixes for semantic naming generation.
 * Dependencies & Triggers: Zero external runtime dependencies; imported by semantic-naming-engine.
 * Responsibilities:
 *     1. Register RFC HTTP status codes to standardized SCREAMING_SNAKE_CASE tokens.
 *     2. Map standard network ports and time duration intervals to canonical identifiers.
 *     3. Maintain immutable Sets for DOM/framework events, stop words, and status descriptors.
 *     4. Provide sealed prefix, suffix, and fallback identifier constants.
 * Exit Semantics & Design Rationale: Pure frozen constant catalog; zero runtime allocation.
 */

/** Known RFC HTTP status code semantic mapping. */
export const HTTP_STATUS_MAP: Readonly<Record<number, string>> = Object.freeze({
    200: 'HTTP_STATUS_OK',
    201: 'HTTP_STATUS_CREATED',
    202: 'HTTP_STATUS_ACCEPTED',
    204: 'HTTP_STATUS_NO_CONTENT',
    301: 'HTTP_STATUS_MOVED_PERMANENTLY',
    302: 'HTTP_STATUS_FOUND',
    304: 'HTTP_STATUS_NOT_MODIFIED',
    400: 'HTTP_STATUS_BAD_REQUEST',
    401: 'HTTP_STATUS_UNAUTHORIZED',
    403: 'HTTP_STATUS_FORBIDDEN',
    404: 'HTTP_STATUS_NOT_FOUND',
    405: 'HTTP_STATUS_METHOD_NOT_ALLOWED',
    409: 'HTTP_STATUS_CONFLICT',
    410: 'HTTP_STATUS_GONE',
    422: 'HTTP_STATUS_UNPROCESSABLE_ENTITY',
    429: 'HTTP_STATUS_TOO_MANY_REQUESTS',
    500: 'HTTP_STATUS_INTERNAL_SERVER_ERROR',
    502: 'HTTP_STATUS_BAD_GATEWAY',
    503: 'HTTP_STATUS_SERVICE_UNAVAILABLE',
    504: 'HTTP_STATUS_GATEWAY_TIMEOUT',
});

/** Common network port semantic mapping. */
export const KNOWN_PORT_MAP: Readonly<Record<number, string>> = Object.freeze({
    21: 'FTP_PORT',
    22: 'SSH_PORT',
    25: 'SMTP_PORT',
    53: 'DNS_PORT',
    80: 'DEFAULT_HTTP_PORT',
    443: 'DEFAULT_HTTPS_PORT',
    3000: 'DEFAULT_DEV_PORT',
    3306: 'MYSQL_DEFAULT_PORT',
    5432: 'POSTGRES_DEFAULT_PORT',
    6379: 'REDIS_DEFAULT_PORT',
    8080: 'DEFAULT_HTTP_ALT_PORT',
    8443: 'DEFAULT_HTTPS_ALT_PORT',
    9092: 'KAFKA_DEFAULT_PORT',
    27017: 'MONGODB_DEFAULT_PORT',
});

/** Common time millisecond semantic mapping. */
export const COMMON_TIME_MS_MAP: Readonly<Record<number, string>> = Object.freeze({
    1000: 'ONE_SECOND_MS',
    2000: 'TWO_SECONDS_MS',
    3000: 'THREE_SECONDS_MS',
    5000: 'DEFAULT_TIMEOUT_MS',
    10000: 'TEN_SECONDS_MS',
    15000: 'DEFAULT_HEARTBEAT_INTERVAL_MS',
    30000: 'THIRTY_SECONDS_MS',
    60000: 'ONE_MINUTE_MS',
    300000: 'FIVE_MINUTES_MS',
    600000: 'TEN_MINUTES_MS',
    1800000: 'THIRTY_MINUTES_MS',
    3600000: 'ONE_HOUR_MS',
    86400000: 'ONE_DAY_MS',
});

/** Known DOM & framework event names. */
export const KNOWN_EVENTS: ReadonlySet<string> = Object.freeze(
    new Set([
        'click',
        'dblclick',
        'mousedown',
        'mouseup',
        'mousemove',
        'keydown',
        'keyup',
        'keypress',
        'change',
        'input',
        'submit',
        'focus',
        'blur',
        'load',
        'error',
        'resize',
        'scroll',
        'close',
        'open',
        'message',
    ]),
);

/** English stopwords to omit from generated constant names. */
export const STOP_WORDS: ReadonlySet<string> = Object.freeze(
    new Set([
        'the',
        'a',
        'an',
        'is',
        'are',
        'was',
        'were',
        'of',
        'in',
        'on',
        'at',
        'by',
        'for',
        'to',
    ]),
);

/** Common status indicators to recognize. */
export const STATUS_INDICATORS: ReadonlySet<string> = Object.freeze(
    new Set([
        'ok',
        'ready',
        'success',
        'failed',
        'pending',
        'cancelled',
        'error',
        'active',
        'inactive',
    ]),
);

/** Fallback constant name identifier for unknown numeric constants. */
export const DEFAULT_NUMERIC_CONSTANT = 'DEFAULT_NUMERIC_CONSTANT';

/** Fallback constant name identifier for numeric thresholds. */
export const DEFAULT_NUMERIC_THRESHOLD = 'DEFAULT_NUMERIC_THRESHOLD';

/** Fallback constant name identifier for general text literals. */
export const DEFAULT_TEXT_LITERAL = 'DEFAULT_TEXT_LITERAL';

/** Fallback constant name identifier for empty strings. */
export const EMPTY_STRING_CONSTANT = 'EMPTY_STRING_CONSTANT';

/** Fallback constant name identifier for external network URLs. */
export const EXTERNAL_ENDPOINT_URL = 'EXTERNAL_ENDPOINT_URL';

/** Fallback token representation for file path stems. */
export const DEFAULT_FILE_TOKEN = 'FILE';

/** Prefix token for default variable identifiers. */
export const PREFIX_DEFAULT = 'DEFAULT_';

/** Prefix token for maximum bound identifiers. */
export const PREFIX_MAX = 'MAX_';

/** Prefix token for HTTP header identifiers. */
export const PREFIX_HEADER = 'HEADER_';

/** Prefix token for event listener identifiers. */
export const PREFIX_EVENT = 'EVENT_';

/** Prefix token for route path identifiers. */
export const PREFIX_ROUTE = 'ROUTE_';

/** Prefix token for file path identifiers. */
export const PREFIX_PATH = 'PATH_';

/** Prefix token for lifecycle and state identifiers. */
export const PREFIX_STATUS = 'STATUS_';

/** Prefix token for port number identifiers. */
export const PREFIX_PORT = 'PORT_';

/** Prefix token for time duration identifiers. */
export const PREFIX_DURATION = 'DURATION_';

/** Prefix token for numeric limit identifiers. */
export const PREFIX_DEFAULT_LIMIT = 'DEFAULT_LIMIT_';

/** Prefix token for batch size identifiers. */
export const PREFIX_DEFAULT_BATCH = 'DEFAULT_BATCH_SIZE_';

/** Prefix token for generic limit values. */
export const PREFIX_LIMIT_VALUE = 'LIMIT_VALUE_';

/** Suffix token for millisecond duration units. */
export const SUFFIX_MS = '_MS';

/** Suffix token for base URL identifiers. */
export const SUFFIX_BASE_URL = '_BASE_URL';

/** Suffix token for full URL endpoint identifiers. */
export const SUFFIX_URL = '_URL';

/** Semantic classification literal kind for network port numbers. */
export const KIND_PORT = 'port';

/** Semantic classification literal kind for millisecond durations. */
export const KIND_TIME_MS = 'time-ms';

/** Semantic classification literal kind for internet URLs. */
export const KIND_URL = 'url';

/** Semantic classification literal kind for local file paths. */
export const KIND_FILE_PATH = 'file-path';

/** Maximum number of words extracted when inferring constant names. */
export const MAX_INFERRED_WORDS_COUNT = 4;

/** Maximum length limit when truncating URL pathname slugs. */
export const URL_PATH_MAX_LENGTH = 16;

/** Maximum length limit when truncating route path slugs. */
export const ROUTE_SLUG_MAX_LENGTH = 20;

/** Maximum length limit for word-based identifier slugs. */
export const WORD_SLUG_MAX_LENGTH = 30;

/** Threshold boundary for small numeric limit constants. */
export const DEFAULT_LIMIT_THRESHOLD = 10;

/** Threshold boundary for standard batch size numeric constants. */
export const DEFAULT_BATCH_SIZE_THRESHOLD = 100;
