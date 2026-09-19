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

/** Exemption marker tuples mapping trigger tokens to canonical exemption reasons. */
const EXEMPTION_RULES: ReadonlyArray<{
    readonly markers: readonly string[];
    readonly reason: ExemptionReason;
}> = [
    { markers: ['@lazy', 'deferred load'], reason: 'lazy' },
    { markers: ['@optional', 'optional dependency'], reason: 'optional' },
    { markers: ['@platform', 'platform-specific'], reason: 'platform' },
    { markers: ['cycle', 'break circular'], reason: 'cycle-breaker' },
];

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
    const lower = surroundingComment.toLowerCase();
    if (customExemptions && customExemptions.some((m) => lower.includes(m.toLowerCase()))) {
        return 'lazy';
    }
    for (const rule of EXEMPTION_RULES) {
        for (const marker of rule.markers) {
            if (lower.includes(marker)) {
                return rule.reason;
            }
        }
    }
    return undefined;
}
