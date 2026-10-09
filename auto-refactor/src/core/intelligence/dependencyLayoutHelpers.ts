/**
 * Module: Core Intelligence — Dependency Layout Helpers
 * File Path: src/core/intelligence/dependencyLayoutHelpers.ts
 * Architecture Role: Import categorization and exemption parsing for the dependency-layout pack.
 * Dependencies & Triggers: the same imports as ./dependencyLayout; re-exported by that module so
 *   existing callers keep their single import path.
 * Responsibilities: Classify an import specifier and read its exemption reason comment.
 * Exit Semantics & Design Rationale: Pure helpers with no I/O; the analyzer keeps traversal,
 *   option defaults, and severity policy.
 */

/** Import category id for a language standard-library module. */
const CATEGORY_STDLIB = 'stdlib';
/** Import category id for a third-party package. */
const CATEGORY_THIRD_PARTY = 'third-party';
/** Import category id for a first-party module shared across domains. */
const CATEGORY_INTERNAL_SHARED = 'internal-shared';
/** Import category id for a relative in-tree module. */
const CATEGORY_LOCAL = 'local';

/**
 * Category an import specifier falls into for the dependency-layout report.
 */
export type ImportCategory =
    | typeof CATEGORY_STDLIB
    | typeof CATEGORY_THIRD_PARTY
    | typeof CATEGORY_INTERNAL_SHARED
    | typeof CATEGORY_LOCAL;

/**
 * Exemption reason for justified in-function imports.
 */
export type ExemptionReason = 'lazy' | 'optional' | 'platform' | 'cycle-breaker';

/**
 * Descriptor of an import or dependency reference in source code.
 */
export interface ImportStatementInfo {
    file: string;
    line: number;
    rawText: string;
    moduleSpecifier: string;
    category: ImportCategory;
    isInsideFunction: boolean;
    hasAuditExemption: boolean;
    exemptionReason?: ExemptionReason;
    isWildcard: boolean;
}

/** Standard library module names for Node.js environments. */
const NODE_STDLIB: ReadonlySet<string> = new Set([
    'fs',
    'path',
    'os',
    'child_process',
    'events',
    'stream',
    'util',
    'crypto',
    'http',
    'https',
    'url',
    'net',
    'assert',
    'buffer',
]);

/** Standard library module names for Python environments. */
const PYTHON_STDLIB: ReadonlySet<string> = new Set([
    'sys',
    'os',
    're',
    'json',
    'math',
    'typing',
    'collections',
    'itertools',
    'pathlib',
    'datetime',
    'time',
    'asyncio',
    'logging',
]);

/** Exemption marker mapping from trigger tokens to canonical exemption reasons. */
export const EXEMPTION_MARKER_MAP: ReadonlyMap<string, ExemptionReason> = new Map([
    ['@lazy', 'lazy'],
    ['deferred load', 'lazy'],
    ['@optional', 'optional'],
    ['optional dependency', 'optional'],
    ['@platform', 'platform'],
    ['platform-specific', 'platform'],
    ['cycle', 'cycle-breaker'],
    ['break circular', 'cycle-breaker'],
]);

/** Precompiled composite regular expression for audited exemption markers. */
const EXEMPTION_REGEX =
    /@lazy|deferred load|@optional|optional dependency|@platform|platform-specific|break circular|cycle/i;

/** Lookup table from lowercased marker tokens to canonical exemption reasons. */
const EXEMPTION_LOOKUP: Record<string, ExemptionReason> = {
    '@lazy': 'lazy',
    'deferred load': 'lazy',
    '@optional': 'optional',
    'optional dependency': 'optional',
    '@platform': 'platform',
    'platform-specific': 'platform',
    'break circular': 'cycle-breaker',
    cycle: 'cycle-breaker',
};

/**
 * Determine import category based on language and module specifier.
 *
 * @param specifier - Import target path or package name.
 * @param language - Target programming language.
 * @returns Categorized import classification.
 */
export function categorizeImport(specifier: string, language: string): ImportCategory {
    if (language === 'typescript' || language === 'javascript') {
        const clean = specifier.replace(/^node:/, '');
        if (NODE_STDLIB.has(clean)) return CATEGORY_STDLIB;
        if (specifier.startsWith('./') || specifier.startsWith('../')) return CATEGORY_LOCAL;
        if (specifier.startsWith('@shared/') || specifier.includes('/common/')) {
            return CATEGORY_INTERNAL_SHARED;
        }
        return CATEGORY_THIRD_PARTY;
    }

    if (language === 'python') {
        const firstSegment = specifier.split('.')[0];
        if (PYTHON_STDLIB.has(firstSegment)) return 'stdlib';
        if (specifier.startsWith('.')) return CATEGORY_LOCAL;
        return CATEGORY_THIRD_PARTY;
    }

    if (language === 'rust') {
        if (specifier.startsWith('std::') || specifier.startsWith('core::')) return 'stdlib';
        if (specifier.startsWith('crate::') || specifier.startsWith('super::'))
            return CATEGORY_LOCAL;
        return CATEGORY_THIRD_PARTY;
    }

    if (language === 'gdscript') {
        return CATEGORY_LOCAL;
    }

    return CATEGORY_THIRD_PARTY;
}

/** Maximum capacity of precompiled custom exemption regex cache (bounded LRU). */
const CUSTOM_EXEMPTION_CACHE_CAPACITY = 50;

/** LRU cache map for compiled composite custom exemption marker regexes. */
const customExemptionRegexCache = new Map<string, RegExp>();

/**
 * Retrieve or compile a composite regular expression for custom exemption markers.
 * Caches compiled regex in a bounded Map to eliminate per-call regex compilation
 * and inner loop includes (PRF-ALG-002).
 *
 * @param customExemptions - Array of custom exemption token strings.
 * @returns Precompiled RegExp or null if empty.
 */
export function getOrCreateCustomExemptionRegex(
    customExemptions: readonly string[],
): RegExp | null {
    if (!customExemptions || customExemptions.length === 0) {
        return null;
    }
    const cacheKey = customExemptions.join('\0');
    const cachedRegex = customExemptionRegexCache.get(cacheKey);
    if (cachedRegex) {
        customExemptionRegexCache.delete(cacheKey);
        customExemptionRegexCache.set(cacheKey, cachedRegex);
        return cachedRegex;
    }

    const validTokens = customExemptions.filter((token) => token && token.trim().length > 0);
    if (validTokens.length === 0) {
        return null;
    }

    if (customExemptionRegexCache.size >= CUSTOM_EXEMPTION_CACHE_CAPACITY) {
        const oldestKey = customExemptionRegexCache.keys().next().value;
        if (oldestKey !== undefined) {
            customExemptionRegexCache.delete(oldestKey);
        }
    }

    const escapedPattern = validTokens
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const compiledRegex = new RegExp(escapedPattern, 'i');
    customExemptionRegexCache.set(cacheKey, compiledRegex);
    return compiledRegex;
}

/**
 * Inspect in-function import comments for audited exemption tags.
 *
 * @param surroundingComment - Leading or inline comment text.
 * @param customExemptions - Project-configured custom exemption marker strings.
 * @returns Exemption reason when justified, or undefined.
 */
export function extractExemptionReason(
    surroundingComment: string,
    customExemptions?: string[],
): ExemptionReason | undefined {
    if (!surroundingComment) {
        return undefined;
    }
    if (customExemptions && customExemptions.length > 0) {
        const customRegex = getOrCreateCustomExemptionRegex(customExemptions);
        if (customRegex && customRegex.test(surroundingComment)) {
            return 'lazy';
        }
    }
    const match = surroundingComment.match(EXEMPTION_REGEX);
    if (match) {
        return EXEMPTION_LOOKUP[match[0].toLowerCase()];
    }
    return undefined;
}
