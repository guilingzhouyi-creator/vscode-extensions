/**
 * Module: Core Engine — Multi-Language File Import Profiler
 * File Path: src/core/intelligence/import-profiler.ts
 * Architecture Role: Extracts import specifiers and symbol-to-package bindings across
 *   TypeScript/JS, Python, Go, Rust, and GDScript files for autonomy ratio quantification.
 * Dependencies & Triggers: Consumes node:path; invoked by autonomy-scorer and
 *   dependency-provenance.
 * Responsibilities:
 *   1. Extract raw and canonical import specifiers across polyglot source files;
 *   2. Filter malformed tokens, logical expression fragments, and string literals;
 *   3. Extract local symbol-to-package binding maps (e.g. named and wildcard imports);
 *   4. Normalize canonical package names stripping runtime prefixes (e.g. node:).
 * Exit Semantics & Design Rationale: Never throws; deterministic stateless string and regex parser
 *   with safe fallback profiles.
 */

import * as path from 'path';

const MAX_SPECIFIER_LENGTH = 200;
const INVALID_SPECIFIER_PATTERN = /\$\{|\|\||&&|==|[;,()]/;
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[a-zA-Z]:[\\/]/;

/** File import profile containing extracted specifiers and local symbol bindings */
export interface FileImportProfile {
    specifiers: string[];
    /** Locally bound identifier name -> canonical external package name */
    symbolToPackageMap: Map<string, string>;
}

/**
 * Rejects specifier tokens that cannot denote a module path.
 *
 * Filters interposed template interpolations, logical operators, statement punctuation, and
 * Windows drive prefixes, so that regex over-matching on arbitrary source text does not
 * inflate the external autonomy ratio.
 *
 * @param spec - Raw candidate specifier token as captured from the source line.
 * @returns True when the token is plausible as an external module specifier.
 */
export function isValidPackageSpecifier(spec: string): boolean {
    if (!spec || spec.length > MAX_SPECIFIER_LENGTH) {
        return false;
    }
    if (INVALID_SPECIFIER_PATTERN.test(spec)) {
        return false;
    }
    const trimmed = spec.trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed || trimmed === ':' || WINDOWS_DRIVE_PREFIX_PATTERN.test(trimmed)) {
        return false;
    }
    return true;
}

/**
 * Reduces a specifier to the canonical package name used as the autonomy ratio key.
 *
 * Strips quotes, drops the `node:` runtime prefix, keeps both segments of a scoped package, and
 * lowercases the root segment for relative or language-specific paths.
 *
 * @param specifier - Import specifier as written in the source file.
 * @returns Canonical package identifier, or an empty string when nothing usable remains.
 */
export function extractModulePackageName(specifier: string): string {
    const trimmed = specifier.trim().replace(/^['"]|['"]$/g, '');
    const clean = trimmed.startsWith('node:') ? trimmed.slice(5) : trimmed;
    if (clean.startsWith('@')) {
        const parts = clean.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    }
    const raw = clean.split('/')[0].split('.')[0].split('::')[0].toLowerCase();
    return raw.replace(/[^a-z0-9_.-]/g, '');
}

function parseImportClause(clause: string, pkg: string, symbolToPkg: Map<string, string>): void {
    if (!clause) return;
    const nsMatch = /\*\s+as\s+([A-Za-z0-9_$]+)/.exec(clause);
    if (nsMatch) {
        symbolToPkg.set(nsMatch[1], pkg);
        return;
    }
    const namedMatch = /\{([\s\S]*?)\}/.exec(clause);
    if (namedMatch) {
        const items = namedMatch[1].split(',');
        for (const item of items) {
            const parts = item.trim().split(/\s+as\s+/);
            const local = (parts[1] || parts[0] || '').trim();
            if (local) symbolToPkg.set(local, pkg);
        }
    }
    const defaultPart = clause
        .replace(/\{[\s\S]*?\}/, '')
        .replace(/,/g, '')
        .trim();
    if (defaultPart && !defaultPart.startsWith('*')) {
        symbolToPkg.set(defaultPart, pkg);
    }
}

const KEYWORD_IMPORT = 'import';
const KEYWORD_REQUIRE = 'require';
const KEYWORD_EXPORT = 'export';

function hasTsJsImportKeyword(line: string): boolean {
    return (
        line.includes(KEYWORD_IMPORT) ||
        line.includes(KEYWORD_REQUIRE) ||
        line.includes(KEYWORD_EXPORT)
    );
}

function extractTsJsImportLine(
    trimmed: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const importFromMatch = /import\s+(?:type\s+)?(.*?)\s+from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (importFromMatch) {
        const spec = importFromMatch[2].trim();
        if (!isValidPackageSpecifier(spec)) return;
        specifiers.add(spec);
        const pkg = extractModulePackageName(spec);
        parseImportClause(importFromMatch[1].trim(), pkg, symbolToPkg);
        return;
    }
    const requireMatch = /(?:const|let|var)\s+(.*?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/.exec(
        trimmed,
    );
    if (requireMatch) {
        const spec = requireMatch[2].trim();
        if (!isValidPackageSpecifier(spec)) return;
        specifiers.add(spec);
        const pkg = extractModulePackageName(spec);
        parseImportClause(requireMatch[1].trim(), pkg, symbolToPkg);
        return;
    }
    const sideEffectMatch = /import\s*\(?\s*['"]([^'"]+)['"]\s*\)?/.exec(trimmed);
    if (sideEffectMatch) {
        const spec = sideEffectMatch[1].trim();
        if (isValidPackageSpecifier(spec)) {
            specifiers.add(spec);
        }
        return;
    }
    const exportFromMatch = /export\s+.*?\s+from\s+['"]([^'"]+)['"]/.exec(trimmed);
    if (exportFromMatch) {
        const spec = exportFromMatch[1].trim();
        if (isValidPackageSpecifier(spec)) {
            specifiers.add(spec);
        }
    }
}

function extractTsJsImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        if (!hasTsJsImportKeyword(line)) continue;
        const trimmed = line.trim();
        if (
            !trimmed ||
            trimmed.startsWith('//') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
        ) {
            continue;
        }
        extractTsJsImportLine(trimmed, specifiers, symbolToPkg);
    }
}

function parsePythonFromClause(
    spec: string,
    rawItems: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    specifiers.add(spec);
    const pkg = spec.split('.')[0].toLowerCase();
    const items = rawItems.split(',');
    for (const it of items) {
        const parts = it.trim().split(/\s+as\s+/);
        const local = (parts[1] || parts[0] || '').trim();
        if (local) symbolToPkg.set(local, pkg);
    }
}

function parsePythonImportClause(
    rawItems: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const items = rawItems.split(',');
    for (const it of items) {
        const parts = it.trim().split(/\s+as\s+/);
        const mod = parts[0].trim();
        const local = (parts[1] || parts[0] || '').trim();
        if (!mod) continue;
        specifiers.add(mod);
        const pkg = mod.split('.')[0].toLowerCase();
        if (local) symbolToPkg.set(local, pkg);
    }
}

function extractPythonImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const fromMatch = /^from\s+([A-Za-z0-9_.]+)\s+import\s+(.*)/.exec(trimmed);
        if (fromMatch) {
            parsePythonFromClause(fromMatch[1].trim(), fromMatch[2], specifiers, symbolToPkg);
            continue;
        }
        const importMatch = /^import\s+(.*)/.exec(trimmed);
        if (importMatch) {
            parsePythonImportClause(importMatch[1], specifiers, symbolToPkg);
        }
    }
}

function resolveGoImportLine(trimmed: string, inBlock: boolean): string | null {
    if (inBlock) return trimmed;
    if (trimmed.startsWith('import ')) return trimmed.slice(7).trim();
    return null;
}

function recordGoImport(
    targetLine: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const match = /^(?:([A-Za-z0-9_]+)\s+)?["']([^'"]+)["']/.exec(targetLine);
    if (!match) return;

    const alias = match[1];
    const pkgPath = match[2];
    specifiers.add(pkgPath);

    const pathParts = pkgPath.split('/');
    const boundSym = alias || pathParts[pathParts.length - 1];
    if (boundSym && boundSym !== '.' && boundSym !== '_') {
        symbolToPkg.set(boundSym, pkgPath);
    }
}

function extractGoImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    let inBlock = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('import (')) {
            inBlock = true;
            continue;
        }
        if (inBlock && trimmed === ')') {
            inBlock = false;
            continue;
        }
        const targetLine = resolveGoImportLine(trimmed, inBlock);
        if (targetLine) {
            recordGoImport(targetLine, specifiers, symbolToPkg);
        }
    }
}

function parseRustUseRemainder(
    rootPkg: string,
    remainder: string,
    symbolToPkg: Map<string, string>,
): void {
    const groupMatch = /\{([\s\S]*?)\}/.exec(remainder);
    if (groupMatch) {
        const items = groupMatch[1].split(',');
        for (const item of items) {
            const clean = item.trim();
            if (!clean || clean === 'self' || clean === '*') continue;
            const asMatch = /([A-Za-z0-9_:]+)\s+as\s+([A-Za-z0-9_]+)/.exec(clean);
            if (asMatch) {
                symbolToPkg.set(asMatch[2].trim(), rootPkg);
            } else {
                const segs = clean.split('::');
                const sym = segs[segs.length - 1].trim();
                if (sym) symbolToPkg.set(sym, rootPkg);
            }
        }
        return;
    }
    const singleAs = /([A-Za-z0-9_:]+)\s+as\s+([A-Za-z0-9_]+)/.exec(remainder);
    if (singleAs) {
        symbolToPkg.set(singleAs[2].trim(), rootPkg);
    } else {
        const segs = remainder.split('::');
        const sym = segs[segs.length - 1].trim();
        if (sym && sym !== '*') {
            symbolToPkg.set(sym, rootPkg);
        }
    }
}

function extractRustImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const useMatch = /^\s*(?:pub\s+)?use\s+([A-Za-z0-9_]+)::(.+);/.exec(trimmed);
        if (!useMatch) {
            const directMatch =
                /^\s*(?:pub\s+)?use\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z0-9_]+))?;/.exec(trimmed);
            if (directMatch) {
                const pkg = directMatch[1];
                specifiers.add(pkg);
                symbolToPkg.set(directMatch[2] || pkg, pkg);
            }
            continue;
        }
        const rootPkg = useMatch[1];
        specifiers.add(rootPkg);
        parseRustUseRemainder(rootPkg, useMatch[2].trim(), symbolToPkg);
    }
}

function extractGdScriptImportProfile(
    content: string,
    specifiers: Set<string>,
    symbolToPkg: Map<string, string>,
): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const declMatch =
            /^(?:const|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:preload|load)\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(
                trimmed,
            );
        if (declMatch) {
            specifiers.add(declMatch[2]);
            symbolToPkg.set(declMatch[1], declMatch[2]);
            continue;
        }
        const match = /(?:preload|load)\s*\(\s*['"]([^'"]+)['"]\s*\)/.exec(trimmed);
        if (match) specifiers.add(match[1]);
    }
}

/**
 * Extracts import specifiers and local symbol-to-package bindings across supported languages.
 *
 * @param content - Full source text of the file
 * @param filePath - Path of the target file for extension inference
 * @returns FileImportProfile containing discovered specifiers and symbol mappings
 */
export function extractFileImportProfile(content: string, filePath: string): FileImportProfile {
    const specifiers = new Set<string>();
    const symbolToPackageMap = new Map<string, string>();
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.py') {
        extractPythonImportProfile(content, specifiers, symbolToPackageMap);
    } else if (ext === '.go') {
        extractGoImportProfile(content, specifiers, symbolToPackageMap);
    } else if (ext === '.rs') {
        extractRustImportProfile(content, specifiers, symbolToPackageMap);
    } else if (ext === '.gd') {
        extractGdScriptImportProfile(content, specifiers, symbolToPackageMap);
    } else {
        extractTsJsImportProfile(content, specifiers, symbolToPackageMap);
    }

    return {
        specifiers: Array.from(specifiers),
        symbolToPackageMap,
    };
}
