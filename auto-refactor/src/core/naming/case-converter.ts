/**
 * Module: Core Naming — Casing Conventions & Identifier Converters
 * File Path: src/core/naming/case-converter.ts
 * Architecture Role: Stateless conversion utilities between identifier casing styles
 *   (camelCase, PascalCase, snake_case, kebab-case, SCREAMING_SNAKE_CASE).
 * Dependencies & Triggers: Consumes camelToSnake from core constants; consumed by
 *   polyglot naming analyzers, refactoring codemods, and candidate naming expanders.
 * Responsibilities:
 *   1. Convert identifiers to UpperPascalCase, lowerCamelCase, snake_case, and UPPER_SNAKE_CASE;
 *   2. Segment compound identifiers into normalized morpheme word sequences;
 *   3. Enforce deterministic casing normalization without side effects.
 * Exit Semantics & Design Rationale: CC <= 6, Depth <= 2; pure string transformations;
 *   never throws on empty or malformed input.
 */

import { camelToSnake } from '../constants/regex-patterns';

const WORD_SEPARATOR_PATTERN = /[_\-\s]+/;
const SPLIT_CAMEL_CASE_PATTERN = /([a-z0-9])([A-Z])/g;

/**
 * Converts a snake_case, kebab-case, or compound identifier into UpperPascalCase.
 *
 * @param ident - Source identifier string.
 * @returns PascalCase formatted identifier.
 */
export function toPascalCase(ident: string): string {
    if (!ident) return '';
    return ident
        .split(WORD_SEPARATOR_PATTERN)
        .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ''))
        .join('');
}

/**
 * Converts a camelCase, PascalCase, or mixed identifier into SCREAMING_SNAKE_CASE.
 *
 * @param ident - Source identifier string.
 * @returns UPPER_SNAKE_CASE formatted identifier.
 */
export function toUpperSnakeCase(ident: string): string {
    if (!ident) return '';
    return camelToSnake(ident).toUpperCase();
}

/**
 * Converts an identifier into lowerCamelCase.
 *
 * @param ident - Source identifier string.
 * @returns camelCase formatted identifier.
 */
export function toCamelCase(ident: string): string {
    const pascal = toPascalCase(ident);
    if (!pascal) return '';
    return pascal[0].toLowerCase() + pascal.slice(1);
}

/**
 * Converts an identifier into kebab-case.
 *
 * @param ident - Source identifier string.
 * @returns kebab-case formatted identifier.
 */
export function toKebabCase(ident: string): string {
    if (!ident) return '';
    return camelToSnake(ident).replace(/_/g, '-');
}

/**
 * Splits an identifier into individual words across camelCase, PascalCase, and delimiter boundaries.
 *
 * @param ident - Source identifier string.
 * @returns Array of lowercase constituent word tokens.
 */
export function splitIdentifierWords(ident: string): string[] {
    if (!ident) return [];
    return ident
        .replace(SPLIT_CAMEL_CASE_PATTERN, '$1_$2')
        .split(WORD_SEPARATOR_PATTERN)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0);
}
