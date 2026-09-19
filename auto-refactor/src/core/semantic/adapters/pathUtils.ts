/**
 * Module: Core Engine — Semantic Adapter Path & Symbol Utilities
 * File Path: src/core/semantic/adapters/pathUtils.ts
 * Architecture Role: Provides deterministic path normalization and canonical symbol ID
 *   generation across different operating systems (POSIX and Windows).
 * Dependencies & Triggers: Consumed by all language-specific semantic adapters and the registry.
 * Responsibilities: Standardize path delimiters to forward slashes, lower-case drive letters,
 *   strip relative dot-segments, and format canonical symbols.
 * Exit Semantics & Design Rationale: Deterministic string normalization prevents cache misses,
 *   graph divergence, and cross-platform verification diffs.
 */

/**
 * Normalizes file paths across Windows and POSIX systems to a canonical forward-slash format.
 *
 * @param rawPath - File path string, potentially containing backslashes or redundant segments.
 * @returns Canonical path with lower-case drive letter (if Windows) and unified forward slashes.
 */
export function normalizeCanonicalPath(rawPath: string): string {
    if (!rawPath) {
        return '';
    }

    // 1. Convert all backslashes to forward slashes
    let normalized = rawPath.replace(/\\/g, '/');

    // 2. Lower-case Windows drive letter if present (e.g. C:/path -> c:/path)
    if (/^[A-Za-z]:\//.test(normalized)) {
        normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
    }

    // 3. Remove leading './'
    if (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }

    // 4. Collapse consecutive slashes
    normalized = normalized.replace(/\/{2,}/g, '/');

    return normalized;
}

/**
 * Formats a canonical symbol ID adhering to the unified semantic model specification:
 * `${language}:${normalizedFilePath}#${symbolPath}`
 *
 * @param language - Target language identifier (e.g. 'typescript', 'python', 'rust').
 * @param filePath - Path to the file declaring the symbol.
 * @param symbolPath - Hierarchical symbol identifier within the file (e.g. 'AuthService.login').
 * @returns Canonical symbol ID string.
 */
export function buildCanonicalSymbolId(
    language: string,
    filePath: string,
    symbolPath: string,
): string {
    const canonicalLang = (language || 'unknown').trim().toLowerCase();
    const canonicalFile = normalizeCanonicalPath(filePath);
    const canonicalSymbol = (symbolPath || 'anonymous').trim();
    return `${canonicalLang}:${canonicalFile}#${canonicalSymbol}`;
}
