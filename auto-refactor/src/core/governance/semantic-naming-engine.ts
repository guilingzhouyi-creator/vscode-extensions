/**
 * Module: Core Governance — Domain-Aware Semantic Constant Naming Engine
 * File Path: src/core/governance/semantic-naming-engine.ts
 * Architecture Role: Generates high-quality, domain-specific, unit-aware, and protocol-standard
 *     constant names, replacing mechanical and naive names like CONST_3000 or EXTRACTED_STRING.
 * Dependencies & Triggers: Consumes classifyLiteral from core/governance/semanticLiterals.ts;
 *     consumed by ConstantsAnalyzer and NearLiteralClusterScanner.
 * Responsibilities:
 *     1. Map RFC and industry protocol codes to canonical names
 *        (HTTP status, port numbers, event names).
 *     2. Recognize unit semantics (milliseconds, seconds, bytes, retries, ratios)
 *        and append appropriate suffixes.
 *     3. Infer contextual roles from parent AST properties, parameter names, or enclosing scopes.
 *     4. Enforce SCREAMING_SNAKE_CASE conventions adhering to target language standards.
 * Exit Semantics & Design Rationale: Deterministic pure function without side effects.
 */

import { classifyLiteral } from './semanticLiterals';
import { stripLiteralQuotes } from '../intelligence/constant-identity';

/** Contextual AST metadata surrounding the literal observation */
export interface SemanticNamingContext {
    parentPropertyName?: string;
    parentParameterName?: string;
    parentLeftHandName?: string;
    enclosingScopeName?: string;
    filePath?: string;
    semanticKind?: string;
}

/** Known RFC HTTP status code semantic mapping */
const HTTP_STATUS_MAP: Record<number, string> = {
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
};

/** Common network port semantic mapping */
const KNOWN_PORT_MAP: Record<number, string> = {
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
};

/** Common time millisecond semantic mapping */
const COMMON_TIME_MS_MAP: Record<number, string> = {
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
};

/** Known DOM & framework event names */
const KNOWN_EVENTS = new Set([
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
]);

/** English stopwords to omit from generated constant names */
const STOP_WORDS = new Set([
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
]);

/** Common status indicators to recognize */
const STATUS_INDICATORS = new Set([
    'ok',
    'ready',
    'success',
    'failed',
    'pending',
    'cancelled',
    'error',
    'active',
    'inactive',
]);

/**
 * Converts camelCase or kebab-case or space-delimited string to UPPER_SNAKE_CASE.
 */
function toUpperSnakeCase(str: string): string {
    return str
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

/**
 * Resolves naming for known protocols (HTTP status or known network port).
 *
 * @param num - Numeric literal value.
 * @returns Protocol constant name or null if unmapped.
 */
function resolveProtocolNumericName(num: number): string | null {
    return HTTP_STATUS_MAP[num] ?? KNOWN_PORT_MAP[num] ?? null;
}

/**
 * Resolves naming for common time duration in milliseconds with contextual property hint.
 *
 * @param num - Millisecond duration number.
 * @param context - Optional AST naming context.
 * @returns Time duration constant name or null if unmapped.
 */
function resolveTimeMsName(num: number, context?: SemanticNamingContext): string | null {
    if (!COMMON_TIME_MS_MAP[num]) return null;
    const hint = context?.parentPropertyName ?? context?.parentParameterName;
    if (hint) {
        const upper = toUpperSnakeCase(hint);
        if (upper.includes('TIMEOUT') || upper.includes('INTERVAL') || upper.includes('DELAY')) {
            return upper.endsWith('_MS') ? upper : `${upper}_MS`;
        }
    }
    return COMMON_TIME_MS_MAP[num];
}

/**
 * Resolves naming based on surrounding parameter, property, or variable identifier.
 *
 * @param anchor - Surrounding AST identifier name.
 * @returns Inferred constant name.
 */
function resolveAnchorName(anchor: string): string {
    const snake = toUpperSnakeCase(anchor);
    if (snake.includes('PORT')) return `DEFAULT_${snake}`;
    if (
        snake.includes('TIMEOUT') ||
        snake.includes('DELAY') ||
        snake.includes('INTERVAL') ||
        snake.includes('DURATION')
    ) {
        return snake.endsWith('_MS') ? snake : `${snake}_MS`;
    }
    if (snake.includes('RETRY') || snake.includes('ATTEMPT')) {
        return snake.startsWith('MAX_') ? snake : `MAX_${snake}`;
    }
    return `DEFAULT_${snake}`;
}

/**
 * Resolves fallback naming based on classification kind or integer magnitude.
 *
 * @param num - Numeric literal value.
 * @param value - Raw literal string text.
 * @returns Fallback constant name.
 */
function resolveFallbackNumericName(num: number, value: string): string {
    const classification = classifyLiteral(value, true);
    if (classification.kind === 'port') return `PORT_${num}`;
    if (classification.kind === 'time-ms') return `DURATION_${num}_MS`;
    if (Number.isInteger(num)) {
        if (num > 0 && num <= 10) return `DEFAULT_LIMIT_${num}`;
        if (num > 10 && num <= 100) return `DEFAULT_BATCH_SIZE_${num}`;
        return `LIMIT_VALUE_${num}`;
    }
    return 'DEFAULT_NUMERIC_THRESHOLD';
}

/**
 * Suggests a domain-aware constant name for numeric literals.
 *
 * @param value - Raw numeric literal text.
 * @param context - Optional AST naming context.
 * @returns Inferred semantic constant name.
 */
function suggestNumericName(value: string, context?: SemanticNamingContext): string {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return 'DEFAULT_NUMERIC_CONSTANT';
    }
    const protocolName = resolveProtocolNumericName(num);
    if (protocolName) return protocolName;

    const timeName = resolveTimeMsName(num, context);
    if (timeName) return timeName;

    const anchor =
        context?.parentPropertyName ?? context?.parentParameterName ?? context?.parentLeftHandName;
    if (anchor) return resolveAnchorName(anchor);

    return resolveFallbackNumericName(num, value);
}

function inferAnchorStringName(anchor: string, raw: string): string | null {
    const snake = toUpperSnakeCase(anchor);
    if (snake.includes('HEADER')) return `HEADER_${toUpperSnakeCase(raw)}`;
    if (snake.includes('EVENT')) return `EVENT_${toUpperSnakeCase(raw)}`;
    if (snake.includes('ROUTE') || snake.includes('PATH') || snake.includes('URL')) {
        return `${snake}_${toUpperSnakeCase(raw).slice(0, 20)}`;
    }
    return null;
}

function inferUrlConstantName(raw: string): string {
    try {
        const u = new URL(raw);
        const hostSlug = toUpperSnakeCase(u.hostname.replace(/^www\./, ''));
        const pathSlug = toUpperSnakeCase(u.pathname).slice(0, 16);
        return pathSlug ? `${hostSlug}_${pathSlug}_URL` : `${hostSlug}_BASE_URL`;
    } catch {
        return 'EXTERNAL_ENDPOINT_URL';
    }
}

function inferFilePathConstantName(raw: string): string {
    const segments = raw.split(/[\\/]/).filter(Boolean);
    const last = segments[segments.length - 1] || 'FILE';
    const cleaned = toUpperSnakeCase(last.replace(/\.[^.]+$/, ''));
    return `PATH_${cleaned}`;
}

function inferWordsConstantName(raw: string): string | null {
    const words = raw
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
        .slice(0, 4);

    if (words.length === 0) return null;
    const slug = words.map((w) => w.toUpperCase()).join('_');
    if (raw.startsWith('/') || raw.includes('/')) {
        return `ROUTE_${slug}`;
    }
    return slug.length > 30 ? slug.slice(0, 30) : slug;
}

/**
 * Suggests a domain-aware constant name for string literals.
 */
function suggestStringName(value: string, context?: SemanticNamingContext): string {
    const raw = stripLiteralQuotes(value).trim();
    if (!raw) return 'EMPTY_STRING_CONSTANT';

    if (KNOWN_EVENTS.has(raw.toLowerCase())) {
        return `EVENT_${raw.toUpperCase()}`;
    }

    const anchor =
        context?.parentPropertyName || context?.parentParameterName || context?.parentLeftHandName;
    if (anchor) {
        const anchorName = inferAnchorStringName(anchor, raw);
        if (anchorName) return anchorName;
    }

    const classification = classifyLiteral(raw, false);
    if (classification.kind === 'url') return inferUrlConstantName(raw);
    if (classification.kind === 'file-path') return inferFilePathConstantName(raw);

    const lower = raw.toLowerCase();
    if (STATUS_INDICATORS.has(lower)) {
        return `STATUS_${lower.toUpperCase()}`;
    }

    const wordSlug = inferWordsConstantName(raw);
    if (wordSlug) return wordSlug;

    return 'DEFAULT_TEXT_LITERAL';
}

/**
 * Generates a refined, domain-aware constant name.
 *
 * @param value - Raw or quoted literal string representation.
 * @param isNumeric - True if literal represents a numeric value.
 * @param context - Optional AST and scope context.
 * @returns Refined uppercase constant identifier.
 */
export function generateSemanticConstantName(
    value: string,
    isNumeric: boolean,
    context?: SemanticNamingContext,
): string {
    if (isNumeric) {
        return suggestNumericName(value, context);
    }
    return suggestStringName(value, context);
}
