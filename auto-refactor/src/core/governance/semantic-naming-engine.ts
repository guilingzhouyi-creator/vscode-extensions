/**
 * Module: Core Governance — Domain-Aware Semantic Constant Naming Engine
 * File Path: src/core/governance/semantic-naming-engine.ts
 * Architecture Role: Generates high-quality, domain-specific, unit-aware, and protocol-standard
 *     constant names, replacing mechanical and naive names like CONST_3000 or EXTRACTED_STRING.
 * Dependencies & Triggers: Consumes classifyLiteral from core/governance/semanticLiterals.ts and
 *     tokens from ./semantic-naming-tokens; consumed by ConstantsAnalyzer.
 * Responsibilities:
 *     1. Map RFC and industry protocol codes to canonical names (HTTP status, port numbers).
 *     2. Recognize unit semantics (milliseconds, seconds, bytes, retries, ratios).
 *     3. Infer contextual roles from parent AST properties, parameter names, or enclosing scopes.
 *     4. Enforce SCREAMING_SNAKE_CASE conventions adhering to target language standards.
 * Exit Semantics & Design Rationale: Deterministic pure function without side effects.
 */

import { classifyLiteral } from './semanticLiterals';
import { stripLiteralQuotes } from '../intelligence/constant-identity';
import {
    HTTP_STATUS_MAP,
    KNOWN_PORT_MAP,
    COMMON_TIME_MS_MAP,
    KNOWN_EVENTS,
    STOP_WORDS,
    STATUS_INDICATORS,
    DEFAULT_NUMERIC_CONSTANT,
    DEFAULT_NUMERIC_THRESHOLD,
    DEFAULT_TEXT_LITERAL,
    EMPTY_STRING_CONSTANT,
    EXTERNAL_ENDPOINT_URL,
    DEFAULT_FILE_TOKEN,
    PREFIX_DEFAULT,
    PREFIX_MAX,
    PREFIX_HEADER,
    PREFIX_EVENT,
    PREFIX_ROUTE,
    PREFIX_PATH,
    PREFIX_STATUS,
    PREFIX_PORT,
    PREFIX_DURATION,
    PREFIX_DEFAULT_LIMIT,
    PREFIX_DEFAULT_BATCH,
    PREFIX_LIMIT_VALUE,
    SUFFIX_MS,
    SUFFIX_BASE_URL,
    SUFFIX_URL,
    KIND_PORT,
    KIND_TIME_MS,
    KIND_URL,
    KIND_FILE_PATH,
    MAX_INFERRED_WORDS_COUNT,
    URL_PATH_MAX_LENGTH,
    ROUTE_SLUG_MAX_LENGTH,
    WORD_SLUG_MAX_LENGTH,
    DEFAULT_LIMIT_THRESHOLD,
    DEFAULT_BATCH_SIZE_THRESHOLD,
} from './semantic-naming-tokens';

/** Contextual AST metadata surrounding the literal observation */
export interface SemanticNamingContext {
    parentPropertyName?: string;
    parentParameterName?: string;
    parentLeftHandName?: string;
    enclosingScopeName?: string;
    filePath?: string;
    semanticKind?: string;
}

const KEYWORD_TIMEOUT = 'TIMEOUT';
const KEYWORD_INTERVAL = 'INTERVAL';
const KEYWORD_DELAY = 'DELAY';
const KEYWORD_DURATION = 'DURATION';
const KEYWORD_PORT = 'PORT';
const KEYWORD_RETRY = 'RETRY';
const KEYWORD_ATTEMPT = 'ATTEMPT';
const KEYWORD_HEADER = 'HEADER';
const KEYWORD_EVENT = 'EVENT';
const KEYWORD_ROUTE = 'ROUTE';
const KEYWORD_PATH = 'PATH';
const KEYWORD_URL = 'URL';
const CAMEL_SPLIT_REPLACEMENT = '$1_$2';

/**
 * Converts camelCase or kebab-case or space-delimited string to UPPER_SNAKE_CASE.
 */
function toUpperSnakeCase(sourceText: string): string {
    return sourceText
        .replace(/([a-z0-9])([A-Z])/g, CAMEL_SPLIT_REPLACEMENT)
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
}

/**
 * Resolves naming for known protocols (HTTP status or known network port).
 *
 * @param numericValue - Numeric literal value.
 * @returns Protocol constant name or null if unmapped.
 */
function resolveProtocolNumericName(numericValue: number): string | null {
    return HTTP_STATUS_MAP[numericValue] ?? KNOWN_PORT_MAP[numericValue] ?? null;
}

/**
 * Resolves naming for common time duration in milliseconds with contextual property hint.
 *
 * @param numericValue - Millisecond duration number.
 * @param context - Optional AST naming context.
 * @returns Time duration constant name or null if unmapped.
 */
function resolveTimeMsName(numericValue: number, context?: SemanticNamingContext): string | null {
    if (!COMMON_TIME_MS_MAP[numericValue]) {
        return null;
    }
    const hint = context?.parentPropertyName ?? context?.parentParameterName;
    if (hint) {
        const upper = toUpperSnakeCase(hint);
        if (
            upper.includes(KEYWORD_TIMEOUT) ||
            upper.includes(KEYWORD_INTERVAL) ||
            upper.includes(KEYWORD_DELAY)
        ) {
            return upper.endsWith(SUFFIX_MS) ? upper : `${upper}${SUFFIX_MS}`;
        }
    }
    return COMMON_TIME_MS_MAP[numericValue];
}

/**
 * Resolves naming based on surrounding parameter, property, or variable identifier.
 *
 * @param anchorIdentifier - Surrounding AST identifier name.
 * @returns Inferred constant name.
 */
function resolveAnchorName(anchorIdentifier: string): string {
    const snake = toUpperSnakeCase(anchorIdentifier);
    if (snake.includes(KEYWORD_PORT)) {
        return `${PREFIX_DEFAULT}${snake}`;
    }
    if (
        snake.includes(KEYWORD_TIMEOUT) ||
        snake.includes(KEYWORD_DELAY) ||
        snake.includes(KEYWORD_INTERVAL) ||
        snake.includes(KEYWORD_DURATION)
    ) {
        return snake.endsWith(SUFFIX_MS) ? snake : `${snake}${SUFFIX_MS}`;
    }
    if (snake.includes(KEYWORD_RETRY) || snake.includes(KEYWORD_ATTEMPT)) {
        return snake.startsWith(PREFIX_MAX) ? snake : `${PREFIX_MAX}${snake}`;
    }
    return `${PREFIX_DEFAULT}${snake}`;
}

/**
 * Resolves fallback naming based on classification kind or integer magnitude.
 *
 * @param numericValue - Numeric literal value.
 * @param rawLiteralText - Raw literal string text.
 * @returns Fallback constant name.
 */
function resolveFallbackNumericName(numericValue: number, rawLiteralText: string): string {
    const classification = classifyLiteral(rawLiteralText, true);
    if (classification.kind === KIND_PORT) {
        return `${PREFIX_PORT}${numericValue}`;
    }
    if (classification.kind === KIND_TIME_MS) {
        return `${PREFIX_DURATION}${numericValue}${SUFFIX_MS}`;
    }
    if (Number.isInteger(numericValue)) {
        if (numericValue > 0 && numericValue <= DEFAULT_LIMIT_THRESHOLD) {
            return `${PREFIX_DEFAULT_LIMIT}${numericValue}`;
        }
        if (
            numericValue > DEFAULT_LIMIT_THRESHOLD &&
            numericValue <= DEFAULT_BATCH_SIZE_THRESHOLD
        ) {
            return `${PREFIX_DEFAULT_BATCH}${numericValue}`;
        }
        return `${PREFIX_LIMIT_VALUE}${numericValue}`;
    }
    return DEFAULT_NUMERIC_THRESHOLD;
}

/**
 * Suggests a domain-aware constant name for numeric literals.
 *
 * @param literalText - Raw numeric literal text.
 * @param context - Optional AST naming context.
 * @returns Inferred semantic constant name.
 */
function suggestNumericName(literalText: string, context?: SemanticNamingContext): string {
    const numericValue = Number(literalText);
    if (!Number.isFinite(numericValue)) {
        return DEFAULT_NUMERIC_CONSTANT;
    }
    const protocolName = resolveProtocolNumericName(numericValue);
    if (protocolName) {
        return protocolName;
    }

    const timeName = resolveTimeMsName(numericValue, context);
    if (timeName) {
        return timeName;
    }

    const anchorIdentifier =
        context?.parentPropertyName ?? context?.parentParameterName ?? context?.parentLeftHandName;
    if (anchorIdentifier) {
        return resolveAnchorName(anchorIdentifier);
    }

    return resolveFallbackNumericName(numericValue, literalText);
}

function inferAnchorStringName(anchorIdentifier: string, rawText: string): string | null {
    const snake = toUpperSnakeCase(anchorIdentifier);
    if (snake.includes(KEYWORD_HEADER)) {
        return `${PREFIX_HEADER}${toUpperSnakeCase(rawText)}`;
    }
    if (snake.includes(KEYWORD_EVENT)) {
        return `${PREFIX_EVENT}${toUpperSnakeCase(rawText)}`;
    }
    if (
        snake.includes(KEYWORD_ROUTE) ||
        snake.includes(KEYWORD_PATH) ||
        snake.includes(KEYWORD_URL)
    ) {
        return `${snake}_${toUpperSnakeCase(rawText).slice(0, ROUTE_SLUG_MAX_LENGTH)}`;
    }
    return null;
}

function inferUrlConstantName(rawText: string): string {
    try {
        const parsedUrl = new URL(rawText);
        const hostSlug = toUpperSnakeCase(parsedUrl.hostname.replace(/^www\./, ''));
        const pathSlug = toUpperSnakeCase(parsedUrl.pathname).slice(0, URL_PATH_MAX_LENGTH);
        return pathSlug ? `${hostSlug}_${pathSlug}${SUFFIX_URL}` : `${hostSlug}${SUFFIX_BASE_URL}`;
    } catch {
        return EXTERNAL_ENDPOINT_URL;
    }
}

function inferFilePathConstantName(rawText: string): string {
    const segments = rawText.split(/[\\/]/).filter(Boolean);
    const last = segments[segments.length - 1] || DEFAULT_FILE_TOKEN;
    const cleaned = toUpperSnakeCase(last.replace(/\.[^.]+$/, ''));
    return `${PREFIX_PATH}${cleaned}`;
}

function inferWordsConstantName(rawText: string): string | null {
    const words = rawText
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((wordToken) => !STOP_WORDS.has(wordToken.toLowerCase()))
        .slice(0, MAX_INFERRED_WORDS_COUNT);

    if (words.length === 0) {
        return null;
    }
    const slug = words.map((wordToken) => wordToken.toUpperCase()).join('_');
    if (rawText.startsWith('/') || rawText.includes('/')) {
        return `${PREFIX_ROUTE}${slug}`;
    }
    return slug.length > WORD_SLUG_MAX_LENGTH ? slug.slice(0, WORD_SLUG_MAX_LENGTH) : slug;
}

/**
 * Suggests a domain-aware constant name for string literals.
 */
function suggestStringName(literalText: string, context?: SemanticNamingContext): string {
    const rawText = stripLiteralQuotes(literalText).trim();
    if (!rawText) {
        return EMPTY_STRING_CONSTANT;
    }

    if (KNOWN_EVENTS.has(rawText.toLowerCase())) {
        return `${PREFIX_EVENT}${rawText.toUpperCase()}`;
    }

    const anchorIdentifier =
        context?.parentPropertyName || context?.parentParameterName || context?.parentLeftHandName;
    if (anchorIdentifier) {
        const anchorName = inferAnchorStringName(anchorIdentifier, rawText);
        if (anchorName) {
            return anchorName;
        }
    }

    const classification = classifyLiteral(rawText, false);
    if (classification.kind === KIND_URL) {
        return inferUrlConstantName(rawText);
    }
    if (classification.kind === KIND_FILE_PATH) {
        return inferFilePathConstantName(rawText);
    }

    const lower = rawText.toLowerCase();
    if (STATUS_INDICATORS.has(lower)) {
        return `${PREFIX_STATUS}${lower.toUpperCase()}`;
    }

    const wordSlug = inferWordsConstantName(rawText);
    return wordSlug ? wordSlug : DEFAULT_TEXT_LITERAL;
}

/**
 * Generates a refined, domain-aware constant name.
 *
 * @param literalText - Raw or quoted literal string representation.
 * @param isNumeric - True if literal represents a numeric value.
 * @param context - Optional AST and scope context.
 * @returns Refined uppercase constant identifier.
 */
export function generateSemanticConstantName(
    literalText: string,
    isNumeric: boolean,
    context?: SemanticNamingContext,
): string {
    if (isNumeric) {
        return suggestNumericName(literalText, context);
    }
    return suggestStringName(literalText, context);
}
