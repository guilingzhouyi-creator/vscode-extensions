/**
 * Module: Architecture Analysis — Polyglot Import Specifier Extractor
 * File Path: src/core/architecture/import-specifier-extractor.ts
 * Architecture Role: Lexical/regex-based polyglot import extractor identifying module
 *   specifiers across TypeScript, GDScript, Python, Rust, Go, Java/Kotlin, and C#.
 * Dependencies & Triggers: Node.js path module; called by ArchitectureAnalyzer.
 * Responsibilities: Parse import/require/use/preload statements into SpecifierInfo descriptors.
 * Exit Semantics & Design Rationale: Pure, stateless functions returning arrays of SpecifierInfo;
 *   never throws.
 */

import * as path from 'path';

/** Clean Architecture layer name for domain code, used in comparisons and path prefixes. */
const ARCHITECTURE_LAYER_DOMAIN = 'domain';

const LAYER_PREFIX_APP = 'app';
const LAYER_PREFIX_INFRA = 'infra';
const PREFIX_JAVA = 'java.';
const PREFIX_JAVAX = 'javax.';
const PREFIX_KOTLIN = 'kotlin.';
const PREFIX_SYSTEM = 'System.';
const PREFIX_MICROSOFT = 'Microsoft.';

/**
 * Descriptor for an extracted module import or package dependency.
 */
export interface SpecifierInfo {
    raw: string;
    isExternal: boolean;
    resolvedPath?: string;
}

/**
 * Polyglot import and module reference extractors:
 * 1. TS/JS: import ... from '...', require('...'), import('...')
 * 2. GDScript: preload("res://..."), load("res://..."), extends "res://..."
 * 3. Python: from .pkg.module import ..., from pkg.module import ..., import pkg.module
 * 4. Rust: use crate::pkg::module, use super::pkg::module
 */
const JS_IMPORT_RE =
    /(?:import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?|export\s+(?:[\s\S]*?from\s+)?|import\(|require\()['"]([^'"]+)['"]/g;

const GDSCRIPT_IMPORT_RE =
    /(?:(?:preload|load)\s*\(\s*['"](?:res:\/\/)?([^'"]+)['"]\s*\)|extends\s+['"](?:res:\/\/)?([^'"]+)['"])/g;

const PYTHON_FROM_IMPORT_RE = /^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/;

const RUST_USE_RE = /^\s*use\s+(?:crate|super)::([A-Za-z0-9_:]+)/;

const GO_IMPORT_RE = /^\s*(?:import\s+)?['"]([^'"]+)['"]/;

const JAVA_IMPORT_RE = /^\s*import\s+(?:static\s+)?([A-Za-z0-9_.]+);?/;

const CSHARP_USING_RE = /^\s*using\s+([A-Za-z0-9_.]+);/;

function extractJsSpecifiers(lineText: string, file: string, specifiers: SpecifierInfo[]): void {
    JS_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = JS_IMPORT_RE.exec(lineText)) !== null) {
        if (m[1]) {
            const raw = m[1];
            const isRelative = raw.startsWith('.') || raw.startsWith('/') || raw.startsWith('@/');
            specifiers.push({
                raw,
                isExternal: !isRelative,
                resolvedPath: isRelative
                    ? path.posix.normalize(path.posix.join(path.posix.dirname(file), raw))
                    : undefined,
            });
        }
    }
}

function extractGdScriptSpecifiers(lineText: string, specifiers: SpecifierInfo[]): void {
    GDSCRIPT_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GDSCRIPT_IMPORT_RE.exec(lineText)) !== null) {
        const raw = m[1] || m[2];
        if (raw) {
            specifiers.push({
                raw,
                isExternal: false,
                resolvedPath: raw.replace(/\.(gd|tscn)$/, ''),
            });
        }
    }
}

function extractPythonSpecifiers(trimmed: string, file: string, specifiers: SpecifierInfo[]): void {
    const pyMatch = trimmed.match(PYTHON_FROM_IMPORT_RE);
    if (!pyMatch) return;
    const mod = pyMatch[1] || pyMatch[2];
    if (!mod) return;
    const isRelative = mod.startsWith('.');
    const cleanMod = mod.replace(/^\.+/, '').replace(/\./g, '/');
    specifiers.push({
        raw: mod,
        isExternal:
            !isRelative &&
            !mod.startsWith(LAYER_PREFIX_APP) &&
            !mod.startsWith(ARCHITECTURE_LAYER_DOMAIN) &&
            !mod.startsWith(LAYER_PREFIX_INFRA),
        resolvedPath: isRelative
            ? path.posix.normalize(path.posix.join(path.posix.dirname(file), cleanMod))
            : cleanMod,
    });
}

function extractRustSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
    const rustMatch = trimmed.match(RUST_USE_RE);
    if (rustMatch && rustMatch[1]) {
        specifiers.push({
            raw: rustMatch[1],
            isExternal: false,
            resolvedPath: rustMatch[1].replace(/::/g, '/'),
        });
    }
}

function extractGoSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
    const goMatch = trimmed.match(GO_IMPORT_RE);
    if (goMatch && goMatch[1]) {
        specifiers.push({
            raw: goMatch[1],
            isExternal: !goMatch[1].includes('.'),
            resolvedPath: goMatch[1],
        });
    }
}

function extractJvmSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
    const jvmMatch = trimmed.match(JAVA_IMPORT_RE);
    if (jvmMatch && jvmMatch[1]) {
        specifiers.push({
            raw: jvmMatch[1],
            isExternal:
                jvmMatch[1].startsWith(PREFIX_JAVA) ||
                jvmMatch[1].startsWith(PREFIX_JAVAX) ||
                jvmMatch[1].startsWith(PREFIX_KOTLIN),
            resolvedPath: jvmMatch[1].replace(/\./g, '/'),
        });
    }
}

function extractCSharpSpecifiers(trimmed: string, specifiers: SpecifierInfo[]): void {
    const csMatch = trimmed.match(CSHARP_USING_RE);
    if (csMatch && csMatch[1]) {
        specifiers.push({
            raw: csMatch[1],
            isExternal:
                csMatch[1].startsWith(PREFIX_SYSTEM) || csMatch[1].startsWith(PREFIX_MICROSOFT),
            resolvedPath: csMatch[1].replace(/\./g, '/'),
        });
    }
}

function dispatchPolyglotExtractor(
    trimmed: string,
    file: string,
    specifiers: SpecifierInfo[],
): void {
    if (file.endsWith('.py')) {
        extractPythonSpecifiers(trimmed, file, specifiers);
        return;
    }
    if (file.endsWith('.rs')) {
        extractRustSpecifiers(trimmed, specifiers);
        return;
    }
    if (file.endsWith('.go')) {
        extractGoSpecifiers(trimmed, specifiers);
        return;
    }
    if (file.endsWith('.java') || file.endsWith('.kt') || file.endsWith('.kts')) {
        extractJvmSpecifiers(trimmed, specifiers);
        return;
    }
    if (file.endsWith('.cs')) {
        extractCSharpSpecifiers(trimmed, specifiers);
    }
}

/**
 * Extracts import/module specifier records from a line of code across supported languages.
 *
 * @param lineText - Raw source line text.
 * @param trimmed - Whitespace-trimmed source line.
 * @param file - Normalized POSIX path of the file being audited.
 * @returns List of detected specifiers with external/relative classification and resolved paths.
 */
export function extractSpecifiers(
    lineText: string,
    trimmed: string,
    file: string,
): SpecifierInfo[] {
    const specifiers: SpecifierInfo[] = [];
    extractJsSpecifiers(lineText, file, specifiers);
    extractGdScriptSpecifiers(lineText, specifiers);
    dispatchPolyglotExtractor(trimmed, file, specifiers);
    return specifiers;
}
