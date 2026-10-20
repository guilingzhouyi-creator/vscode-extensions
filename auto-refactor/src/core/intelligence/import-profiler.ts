/**
 * Module: Core Engine — Multi-Language File Import Profiler
 * File Path: src/core/intelligence/import-profiler.ts
 * Architecture Role: Extracts import specifiers and symbol-to-package bindings across TypeScript/JS,
 *   Python, Go, Rust, and GDScript files for autonomy ratio quantification.
 * Dependencies & Triggers: Consumes node:path; invoked by autonomy-scorer and dependency-provenance.
 * Responsibilities:
 *   1. Extract raw and canonical import specifiers across polyglot source files;
 *   2. Filter malformed tokens, logical expression fragments, and string literals;
 *   3. Extract local symbol-to-package binding maps (e.g. named and wildcard imports);
 *   4. Normalize canonical package names stripping runtime prefixes (e.g. node:).
 * Exit Semantics & Design Rationale: Never throws; deterministic stateless string and regex parser
 *   with safe fallback profiles.
 */

import * as path from 'path';

/** File import profile containing extracted specifiers and local symbol bindings */
export interface FileImportProfile {
    specifiers: string[];
    /** Locally bound identifier name -> canonical external package name */
    symbolToPackageMap: Map<string, string>;
}

export function isValidPackageSpecifier(spec: string): boolean {
    if (!spec || spec.length > 200) return false;
    if (spec.includes('${') || spec.includes('||') || spec.includes('&&') || spec.includes('==')) {
        return false;
    }
    if (spec.includes(';') || spec.includes(',') || spec.includes('(') || spec.includes(')')) {
        return false;
    }
    const trimmed = spec.trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed || trimmed === ':' || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
        return false;
    }
    return true;
}

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

function extractGoImportProfile(content: string, specifiers: Set<string>): void {
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
        if (inBlock) {
            const match = /["']([^'"]+)["']/.exec(trimmed);
            if (match) specifiers.add(match[1]);
            continue;
        }
        const singleMatch = /^import\s+(?:[A-Za-z0-9_.]+\s+)?["']([^'"]+)["']/.exec(trimmed);
        if (singleMatch) specifiers.add(singleMatch[1]);
    }
}

function extractRustImportProfile(content: string, specifiers: Set<string>): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;
        const useMatch = /^\s*(?:pub\s+)?use\s+([A-Za-z0-9_]+)::/.exec(trimmed);
        if (useMatch) specifiers.add(useMatch[1]);
    }
}

function extractGdScriptImportProfile(content: string, specifiers: Set<string>): void {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
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
        extractGoImportProfile(content, specifiers);
    } else if (ext === '.rs') {
        extractRustImportProfile(content, specifiers);
    } else if (ext === '.gd') {
        extractGdScriptImportProfile(content, specifiers);
    } else {
        extractTsJsImportProfile(content, specifiers, symbolToPackageMap);
    }

    return {
        specifiers: Array.from(specifiers),
        symbolToPackageMap,
    };
}
