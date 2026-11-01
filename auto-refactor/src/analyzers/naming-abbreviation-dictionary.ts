/**
 * Module: Static Analysis — Naming Abbreviation Dictionary & Morpheme Tokenizer
 * File Path: src/analyzers/naming-abbreviation-dictionary.ts
 * Architecture Role: SSOT dictionary and morpheme token parser powering naming standardization,
 *   unapproved abbreviation detection, and synonym candidate expansion.
 * Dependencies & Triggers: Zero external AST dependencies; consumed by naming candidate helpers
 *   and polyglot naming auditors.
 * Responsibilities:
 *   1. Define approved, unapproved, and polysemic abbreviation registries;
 *   2. Tokenize complex identifiers (camelCase, PascalCase, snake_case) into morpheme tokens;
 *   3. Identify unapproved truncated abbreviations within token streams;
 *   4. Supply deterministic dictionary expansion candidates.
 * Exit Semantics & Design Rationale: Pure deterministic dictionary and string parser;
 *   zero mutable state and zero side effects.
 */

import type { NamingCandidate } from '../core/naming';
import {
    extractMorphemeTokens,
    splitIdentifierTokens as getIdentifierTokens,
} from '../core/naming/case-converter';

export { extractMorphemeTokens, getIdentifierTokens };

/**
 * Allowed short identifier names commonly accepted across domains: standard coordinates,
 * loop counters, and explicit discards.
 */
export const ALLOWED_SHORT_NAMES: ReadonlySet<string> = new Set(
    'x y z dx dy w h id ip i j k _'.split(' '),
);

/**
 * Common truncated abbreviations dictionary with standard English expansions.
 */
export const ABBREVIATION_PAIRS: ReadonlyArray<readonly [string, string]> = Object.freeze([
    ['usr', 'user'],
    ['mgr', 'manager'],
    ['btn', 'button'],
    ['cnt', 'count'],
    ['ptr', 'pointer'],
    ['cur', 'current'],
    ['auth_mgr', 'authManager'],
    ['tbl', 'table'],
    ['chk', 'check'],
    ['cb', 'callback'],
    ['cfg', 'config'],
    ['ctx', 'context'],
    ['doc', 'document'],
    ['err', 'error'],
    ['idx', 'index'],
    ['len', 'length'],
    ['msg', 'message'],
    ['num', 'number'],
    ['pos', 'position'],
    ['prev', 'previous'],
    ['req', 'request'],
    ['res', 'response'],
    ['src', 'source'],
    ['str', 'string'],
    ['fn', 'function'],
    ['sf', 'sourceFile'],
    ['db', 'database'],
    ['fs', 'fileSystem'],
    ['el', 'element'],
    ['ns', 'namespace'],
    ['op', 'operator'],
    ['re', 'regexPattern'],
    ['param', 'parameter'],
    ['arg', 'argument'],
    ['cmd', 'command'],
    ['opt', 'option'],
    ['prop', 'property'],
    ['val', 'value'],
]);

/**
 * Common truncated abbreviations dictionary with standard English expansions.
 */
export const COMMON_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(ABBREVIATION_PAIRS),
);

/**
 * Approved industry-standard domain abbreviations accepted across engineering teams.
 */
export const APPROVED_DOMAIN_ABBREVIATIONS: ReadonlySet<string> = new Set([
    'fs',
    're',
    'cmd',
    'arg',
    'args',
    'param',
    'params',
    'fn',
    'db',
    'prop',
    'props',
    'op',
    'ops',
    'ns',
    'ast',
    'id',
    'ids',
    'len',
    'idx',
    'src',
    'dst',
    'buf',
    'ctx',
]);

/**
 * Unapproved abbreviations triggering NAM-ABR-001 warnings.
 */
export const UNAPPROVED_ABBREVIATION_SET: ReadonlySet<string> = new Set([
    'usr',
    'mgr',
    'btn',
    'cnt',
    'ptr',
    'cur',
    'auth_mgr',
    'tbl',
    'chk',
    'cb',
    'sf',
    'el',
]);

/**
 * Polysemic abbreviations that introduce semantic ambiguity.
 */
export const POLYSEMIC_ABBREVIATIONS: ReadonlySet<string> = new Set([
    'cur',
    'res',
    'sec',
    'auth',
    'doc',
    'cnt',
]);

/** Canonical TypeScript primitive type keywords excluded from domain noun extraction. */
export const PRIMITIVE_TYPE_NAMES: ReadonlySet<string> = new Set(
    'string number boolean any unknown void never symbol bigint object undefined null'.split(' '),
);

const SOURCE_ABBREVIATION_EXPANSION = 'abbreviation_expansion';

/**
 * Splits a delimiter-free identifier segment into morpheme tokens and appends them in place.
 *
 * @param segment - Raw identifier segment without separators.
 * @param target - Destination token accumulator mutated in place.
 */
export function appendSegmentTokens(segment: string, target: string[]): void {
    if (!segment) return;
    const matchedTokens = extractMorphemeTokens(segment);
    if (matchedTokens.length > 0) {
        target.push(...matchedTokens);
    } else {
        target.push(segment);
    }
}

/**
 * Checks whether an identifier contains snake_case or kebab-case segment separators.
 *
 * @param name - Identifier string to inspect.
 * @returns True when underscore or hyphen delimiters are present.
 */
export function hasSegmentSeparators(name: string): boolean {
    return name.includes('_') || name.includes('-');
}

/**
 * Formats an expanded word token into camelCase position casing.
 *
 * @param text - Expanded dictionary word token.
 * @param isFirst - Whether the token occupies the leading camelCase segment.
 * @returns Lowercased token when leading, or capitalized token otherwise.
 */
export function formatTokenCase(text: string, isFirst: boolean): string {
    return isFirst ? text.toLowerCase() : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Infer naming candidate from abbreviation expansion dictionary (Stage 3).
 *
 * @param name - Identifier name to analyze.
 * @returns Inferred naming candidate or null if no expansion possible.
 */
export function inferFromAbbreviationDictionary(name: string): NamingCandidate | null {
    if (!name) return null;
    const lower = name.toLowerCase();

    if (COMMON_ABBREVIATIONS[lower]) {
        return {
            name: COMMON_ABBREVIATIONS[lower],
            confidence: 0.92,
            source: SOURCE_ABBREVIATION_EXPANSION,
            rationale: `Expanded unapproved abbreviation '${name}' -> '${COMMON_ABBREVIATIONS[lower]}'`,
        };
    }

    const tokens = getIdentifierTokens(name);
    if (tokens.length === 0) return null;

    let hasExpanded = false;
    const expandedTokens = tokens.map((token, tokenIdx) => {
        const expanded = COMMON_ABBREVIATIONS[token.toLowerCase()];
        if (expanded) {
            hasExpanded = true;
            return formatTokenCase(expanded, tokenIdx === 0);
        }
        return formatTokenCase(token, tokenIdx === 0);
    });

    if (!hasExpanded) return null;

    const candidateName = expandedTokens.join('');
    if (candidateName === name) return null;

    return {
        name: candidateName,
        confidence: 0.92,
        source: SOURCE_ABBREVIATION_EXPANSION,
        rationale: `Expanded truncated token segment(s) in identifier '${name}'`,
    };
}

/**
 * Find unapproved abbreviation in an identifier.
 *
 * @param name - Identifier name to inspect.
 * @param allowedCustomSet - Optional custom set of approved domain abbreviation tokens.
 * @returns Unapproved abbreviation record or null if compliant.
 */
export function findUnapprovedAbbreviation(
    name: string,
    allowedCustomSet?: ReadonlySet<string>,
): { unapproved: string; expanded?: string } | null {
    if (!name) return null;
    const lower = name.toLowerCase();

    if (allowedCustomSet?.has(lower) || APPROVED_DOMAIN_ABBREVIATIONS.has(lower)) {
        return null;
    }

    if (UNAPPROVED_ABBREVIATION_SET.has(lower)) {
        return { unapproved: name, expanded: COMMON_ABBREVIATIONS[lower] };
    }

    const tokens = getIdentifierTokens(name);
    for (const token of tokens) {
        const tokenLower = token.toLowerCase();
        if (allowedCustomSet?.has(tokenLower) || APPROVED_DOMAIN_ABBREVIATIONS.has(tokenLower)) {
            continue;
        }
        if (UNAPPROVED_ABBREVIATION_SET.has(tokenLower)) {
            return { unapproved: token, expanded: COMMON_ABBREVIATIONS[tokenLower] };
        }
    }

    return null;
}
