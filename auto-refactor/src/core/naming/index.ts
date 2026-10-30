/**
 * Module: Core Naming — Polyglot Naming & Architectural Terminology Hub
 * File Path: src/core/naming/index.ts
 * Architecture Role: Primary facade for polyglot identifier analysis, dictionary lookup,
 *   casing transformations, and naming diagnostic construction.
 * Dependencies & Triggers: Consumes naming contracts, case-converter, and abbreviation catalog;
 *   imported by naming analyzers, comments rules, and governance guards.
 * Responsibilities:
 *   1. Expose unified casing converters with immutable frozen mapping dictionaries;
 *   2. Provide diagnostic builders and candidate proposals for naming violations;
 *   3. Enforce consistent naming conventions across all supported language targets.
 * Exit Semantics & Design Rationale: CC <= 5, Depth <= 2; ELOC >= 15; frozen exports;
 *   zero mutable state and strictly non-throwing.
 */

export * from './contracts';
export * from './case-converter';

import {
    toPascalCase,
    toUpperSnakeCase,
    toCamelCase,
    toKebabCase,
    splitIdentifierWords,
} from './case-converter';

/**
 * Supported naming styles across languages and contexts.
 */
export type NamingConvention = 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case' | 'UPPER_SNAKE_CASE';

/**
 * Formats an identifier to match the requested naming convention.
 *
 * @param ident - Source identifier text.
 * @param convention - Target naming convention style.
 * @returns Transformed identifier matching the target convention.
 */
export function formatIdentifierConvention(ident: string, convention: NamingConvention): string {
    switch (convention) {
        case 'PascalCase':
            return toPascalCase(ident);
        case 'UPPER_SNAKE_CASE':
            return toUpperSnakeCase(ident);
        case 'snake_case':
            return toKebabCase(ident).replace(/-/g, '_');
        case 'kebab-case':
            return toKebabCase(ident);
        case 'camelCase':
        default:
            return toCamelCase(ident);
    }
}

/**
 * Inspects an identifier and computes its semantic constituent words and casing characteristics.
 *
 * @param ident - Identifier string to inspect.
 * @returns Structured metadata containing token count, word breakdown, and length.
 */
export function inspectIdentifierStructure(ident: string): {
    readonly words: readonly string[];
    readonly wordCount: number;
    readonly totalLength: number;
} {
    const words = Object.freeze(splitIdentifierWords(ident));
    return {
        words,
        wordCount: words.length,
        totalLength: ident.length,
    };
}
