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

    if (language === 'typescript' || language === 'javascript') {
        const clean = specifier.replace(/^node:/, '');
        if (nodeStdlib.has(clean)) return 'stdlib';
        if (specifier.startsWith('./') || specifier.startsWith('../')) return 'local';
        if (specifier.startsWith('@shared/') || specifier.includes('/common/')) {
            return 'internal-shared';
        }
        return 'third-party';
    }

    if (language === 'python') {
        const firstSegment = specifier.split('.')[0];
        if (pyStdlib.has(firstSegment)) return 'stdlib';
        if (specifier.startsWith('.')) return 'local';
        return 'third-party';
    }

    if (language === 'rust') {
        if (specifier.startsWith('std::') || specifier.startsWith('core::')) return 'stdlib';
        if (specifier.startsWith('crate::') || specifier.startsWith('super::')) return 'local';
        return 'third-party';
    }

    if (language === 'gdscript') {
        return 'local';
    }

    return 'third-party';
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
    if (lower.includes('@lazy') || lower.includes('deferred load')) return 'lazy';
    if (lower.includes('@optional') || lower.includes('optional dependency')) return 'optional';
    if (lower.includes('@platform') || lower.includes('platform-specific')) return 'platform';
    if (lower.includes('cycle') || lower.includes('break circular')) return 'cycle-breaker';
    return undefined;
}
