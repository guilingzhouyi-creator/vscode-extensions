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
/** Import category of a language standard-library module. */
const CATEGORY_STDLIB = 'stdlib';
/** Import category of a project-local module. */
const CATEGORY_LOCAL = 'local';
/** Import category of a module shared across internal packages. */
const CATEGORY_INTERNAL_SHARED = 'internal-shared';
/** Import category of an external dependency. */
const CATEGORY_THIRD_PARTY = 'third-party';
/** Exemption reason for a deferred (lazy) dependency. */
const REASON_LAZY = 'lazy';
/** Exemption reason for an optional dependency. */
const REASON_OPTIONAL = 'optional';
/** Exemption reason for a platform-specific dependency. */
const REASON_PLATFORM = 'platform';
/** Exemption reason for a dependency that breaks an import cycle. */
const REASON_CYCLE_BREAKER = 'cycle-breaker';
/** Language id of TypeScript sources. */
const LANGUAGE_TYPESCRIPT = 'typescript';
/** Language id of JavaScript sources. */
const LANGUAGE_JAVASCRIPT = 'javascript';
/** Language id of Python sources. */
const LANGUAGE_PYTHON = 'python';
/** Language id of Rust sources. */
const LANGUAGE_RUST = 'rust';
/** Language id of GDScript sources. */
const LANGUAGE_GDSCRIPT = 'gdscript';
/** Specifier prefix of a sibling module. */
const PREFIX_RELATIVE = './';
/** Specifier prefix of a parent-directory module. */
const PREFIX_PARENT = '../';
/** Specifier prefix of the shared internal package. */
const PREFIX_SHARED = '@shared/';
/** Path fragment marking a shared common directory. */
const FRAGMENT_COMMON = '/common/';
/** Specifier prefix of a relative import. */
const PREFIX_DOT = '.';
/** Rust standard-library path prefix. */
const PREFIX_RUST_STD = 'std::';
/** Rust core-library path prefix. */
const PREFIX_RUST_CORE = 'core::';
/** Rust crate-local path prefix. */
const PREFIX_RUST_CRATE = 'crate::';
/** Rust parent-module path prefix. */
const PREFIX_RUST_SUPER = 'super::';
/** Comment marker declaring a lazy dependency. */
const MARKER_LAZY = '@lazy';
/** Comment phrase declaring a deferred load. */
const MARKER_DEFERRED = 'deferred load';
/** Comment marker declaring an optional dependency. */
const MARKER_OPTIONAL = '@optional';
/** Comment phrase declaring an optional dependency. */
const MARKER_OPTIONAL_DEP = 'optional dependency';
/** Comment marker declaring a platform-specific dependency. */
const MARKER_PLATFORM = '@platform';
/** Comment phrase declaring a platform-specific dependency. */
const MARKER_PLATFORM_SPECIFIC = 'platform-specific';
/** Comment phrase indicating an import cycle. */
const MARKER_CYCLE = 'cycle';
/** Comment phrase declaring an intentional cycle break. */
const MARKER_BREAK_CIRCULAR = 'break circular';

/**
 * Module: Core Intelligence — Import, Dependency & External Resource Layout
 * File Path: src/core/intelligence/dependencyLayout.ts
 * Architecture Role: Multi-language layout validator and dependency topology analyzer;
 *   enforces canonical file structures, audits deferred imports, and governs external URLs.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep);
 *   invoked by DependencyLayoutAnalyzer.
 * Responsibilities: Enforce language-specific file layout matrices (DEP-ORD-001); flag
 *   unjustified in-function imports while allowing audited exemptions (DEP-LAZ-001); detect
 *   unmanaged hardcoded external URLs and endpoints (DEP-RES-001); detect wildcard imports
 *   (DEP-WLD-001); flag inverted dependency references (DEP-INV-001).
 * Exit Semantics & Design Rationale: Deterministic AST- and line-assisted analysis; returns
 *   structured issues conforming to the Section VII result model.
 */

/**
 * Category an import specifier falls into for the dependency-layout report.
 */
export type ImportCategory = 'stdlib' | 'third-party' | 'internal-shared' | 'local';

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
    exemptionReason?: 'lazy' | 'optional' | 'platform' | 'cycle-breaker';
    isWildcard: boolean;
}

/**
 * Determine import category based on language and module specifier.
 *
 * @param specifier - Import target path or package name.
 * @param language - Target programming language.
 * @returns Categorized import classification.
 */
export function categorizeImport(specifier: string, language: string): ImportCategory {
    const nodeStdlib = new Set([
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
    const pyStdlib = new Set([
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

    if (language === LANGUAGE_TYPESCRIPT || language === LANGUAGE_JAVASCRIPT) {
        const clean = specifier.replace(/^node:/, '');
        if (nodeStdlib.has(clean)) return CATEGORY_STDLIB;
        if (specifier.startsWith(PREFIX_RELATIVE) || specifier.startsWith(PREFIX_PARENT))
            return CATEGORY_LOCAL;
        if (specifier.startsWith(PREFIX_SHARED) || specifier.includes(FRAGMENT_COMMON)) {
            return CATEGORY_INTERNAL_SHARED;
        }
        return CATEGORY_THIRD_PARTY;
    }

    if (language === LANGUAGE_PYTHON) {
        const firstSegment = specifier.split('.')[0];
        if (pyStdlib.has(firstSegment)) return CATEGORY_STDLIB;
        if (specifier.startsWith(PREFIX_DOT)) return CATEGORY_LOCAL;
        return CATEGORY_THIRD_PARTY;
    }

    if (language === LANGUAGE_RUST) {
        if (specifier.startsWith(PREFIX_RUST_STD) || specifier.startsWith(PREFIX_RUST_CORE))
            return CATEGORY_STDLIB;
        if (specifier.startsWith(PREFIX_RUST_CRATE) || specifier.startsWith(PREFIX_RUST_SUPER))
            return CATEGORY_LOCAL;
        return CATEGORY_THIRD_PARTY;
    }

    if (language === LANGUAGE_GDSCRIPT) {
        return CATEGORY_LOCAL;
    }

    return CATEGORY_THIRD_PARTY;
}
/**
 * Inspect in-function import comments for audited exemption tags.
 *
 * @param surroundingComment - Leading or inline comment text.
 * @returns Exemption reason when justified, or undefined.
 */
export function extractExemptionReason(
    surroundingComment: string,
): 'lazy' | 'optional' | 'platform' | 'cycle-breaker' | undefined {
    const lower = surroundingComment.toLowerCase();
    if (lower.includes(MARKER_LAZY) || lower.includes(MARKER_DEFERRED)) return REASON_LAZY;
    if (lower.includes(MARKER_OPTIONAL) || lower.includes(MARKER_OPTIONAL_DEP))
        return REASON_OPTIONAL;
    if (lower.includes(MARKER_PLATFORM) || lower.includes(MARKER_PLATFORM_SPECIFIC))
        return REASON_PLATFORM;
    if (lower.includes(MARKER_CYCLE) || lower.includes(MARKER_BREAK_CIRCULAR))
        return REASON_CYCLE_BREAKER;
    return undefined;
}
