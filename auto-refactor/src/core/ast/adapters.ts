/**
 * Module: Core Engine — Language Adapter Registry
 * File Path: src/core/ast/adapters.ts
 * Architecture Role: Extension/parser-to-adapter resolution boundary; owns adapter
 *   registration and lazy construction for every scanned language.
 * Dependencies & Triggers: Imports `path`, `LanguageAdapter` from ./multilang, and
 *   `ParserKind` from ./types; `adapterFor` is called per file by the scan engine, while
 *   `registerAdapter` lets runtime adapters (e.g. Rust/tree-sitter) register themselves.
 * Responsibilities: Keep the built-in factory map (`typescript`, `rust`, `oxc`, `gdscript`);
 *   lazily `require` and cache adapter modules on first use; expose `registerAdapter` to add
 *   or override adapters; resolve a file by lowercased extension, honoring parser='oxc'
 *   first, then built-in factory order, then runtime registrations, and finally falling
 *   back to the TypeScript adapter.
 * Exit Semantics & Design Rationale: `adapterFor` always returns a LanguageAdapter and never
 *   throws for unknown extensions, preserving historical fallback behavior; lazy loading
 *   keeps the heavy TypeScript stack out of oxc-only workers; deleting the cache entry in
 *   `registerAdapter` makes runtime adapters win over built-ins.
 */
import * as path from 'path';
import type { LanguageAdapter } from './multilang';
import type { ParserKind } from '../types';

/**
 * Language adapter registry.
 *
 * Adapters are declaratively registered by id; `adapterFor(filePath, parser)` picks one by
 * file extension and parser selection, falling back to TypeScript (so unknown extensions keep
 * the historical behavior). Runtime adapters (e.g. Rust via tree-sitter) register themselves
 * through `registerAdapter` so the engine core never hardcodes the language list.
 *
 * LOADING IS LAZY: adapter modules are `require`d on first use, not at import time. The
 * TypeScript adapter (and the `typescript` module it wraps) is heavy (~200ms per isolate),
 * so an oxc-only worker must never load it. The built-in factories follow the same
 * declaration order the old eager registry used (`typescript`, `rust`, `oxc`), so extension
 * resolution is byte-identical to the previous behavior; runtime-registered adapters are
 * consulted AFTER the built-ins (matching the old insertion-order precedence).
 */

/** Adapter-registry id of the default TypeScript-family adapter, also the fallback resolution. */
const ADAPTER_ID_TYPESCRIPT = 'typescript';

/** Adapter-registry id of the Rust `oxc-parser` TS/JS adapter (`parser: 'oxc'`). */
const ADAPTER_ID_OXC = 'oxc';

/** Adapter-registry id of the Go adapter. */
const ADAPTER_ID_GO = 'go';

/** Adapter-registry id of the Markdown adapter. */
const ADAPTER_ID_MARKDOWN = 'markdown';

/**
 * Extension -> built-in adapter id.
 *
 * Resolving an extension through this table keeps a scan from CONSTRUCTING every adapter just to
 * learn which one claims the file: construction order used to load the TypeScript compiler and
 * tree-sitter even for a Python-only scan. The table is asserted against each adapter's own
 * `extensions` list by scripts/validate-language-support.js, so it cannot drift silently; anything
 * not listed here (including runtime-registered adapters) takes the historical
 * construction-order path.
 */
export const EXTENSION_ADAPTER_IDS: Readonly<Record<string, string>> = {
    '.ts': ADAPTER_ID_TYPESCRIPT,
    '.tsx': ADAPTER_ID_TYPESCRIPT,
    '.js': ADAPTER_ID_TYPESCRIPT,
    '.jsx': ADAPTER_ID_TYPESCRIPT,
    '.mjs': ADAPTER_ID_TYPESCRIPT,
    '.cjs': ADAPTER_ID_TYPESCRIPT,
    '.rs': 'rust',
    '.gd': 'gdscript',
    '.py': 'python',
    '.md': ADAPTER_ID_MARKDOWN,
    '.go': ADAPTER_ID_GO,
};

const cache: Record<string, LanguageAdapter> = {};
const registered: Record<string, LanguageAdapter> = {};

const ADAPTER_MODULES = {
    typescript: './typescript-adapter',
    rust: './rust-adapter',
    oxc: './oxc-adapter',
    gdscript: './gdscript-adapter',
    python: './python-adapter',
    markdown: './markdown-adapter',
    go: './go-adapter',
} as const;

const factories: Record<string, () => LanguageAdapter> = {
    typescript: () => new (require(ADAPTER_MODULES.typescript).TypeScriptAdapter)(),
    rust: () => new (require(ADAPTER_MODULES.rust).RustAdapter)(),
    oxc: () => new (require(ADAPTER_MODULES.oxc).OxcAdapter)(),
    gdscript: () => new (require(ADAPTER_MODULES.gdscript).GDScriptAdapter)(),
    python: () => new (require(ADAPTER_MODULES.python).PythonAdapter)(),
    [ADAPTER_ID_MARKDOWN]: () => new (require(ADAPTER_MODULES.markdown).MarkdownAdapter)(),
    [ADAPTER_ID_GO]: () => new (require(ADAPTER_MODULES.go).GoAdapter)(),
};

const adapterExtensionSets = new WeakMap<LanguageAdapter, Set<string>>();

/**
 * Checks whether an adapter supports the given file extension using a cached Set lookup.
 *
 * @param adapter - The LanguageAdapter instance to query.
 * @param ext - Lowercased file extension (e.g. '.ts').
 * @returns True if the extension is claimed by the adapter, false otherwise.
 */
function adapterSupportsExtension(adapter: LanguageAdapter, ext: string): boolean {
    let set = adapterExtensionSets.get(adapter);
    if (!set) {
        set = new Set(adapter.extensions);
        adapterExtensionSets.set(adapter, set);
    }
    return set.has(ext);
}

function getAdapter(id: string): LanguageAdapter {
    if (registered[id]) return registered[id];
    return (cache[id] ??= factories[id]());
}

/**
 * Register a runtime language adapter, replacing any built-in or previously registered adapter
 * with the same `id`.
 *
 * The adapter is stored by `adapter.id`, and any lazily cached instance under that id is
 * evicted so the next `adapterFor` call resolves to this registration. Registration is
 * synchronous, process-local and last-writer-wins; a later registration always shadows an
 * earlier one for the same id.
 *
 * @param adapter - Adapter instance to register; its `id` becomes the lookup key and its
 *   `extensions` decide which files it claims. Stored by reference, so it must remain usable
 *   for the lifetime of the process.
 */
export function registerAdapter(adapter: LanguageAdapter): void {
    registered[adapter.id] = adapter;
    delete cache[adapter.id]; // a registered adapter always wins over a lazily-built built-in
}

/**
 * Pick the adapter for a file. `parser` selects between the two TS/JS-family parsers
 * ('typescript' — default, historical behavior — or 'oxc' — Rust parser). Non-TS/JS files
 * (e.g. .rs) always resolve by extension regardless of `parser`.
 *
 * @param filePath - Path to classify; only its lower-cased extension participates in the
 *   lookup, so the file does not need to exist on disk.
 * @param parser - Parser family preference for TS/JS-family extensions: 'oxc' consults the oxc
 *   adapter first, while 'typescript' follows built-in factory order and then runtime
 *   registrations.
 * @returns The matching LanguageAdapter; unknown extensions fall back to the TypeScript
 *   adapter, so the result is never undefined.
 */
export function adapterFor(filePath: string, parser: ParserKind = 'typescript'): LanguageAdapter {
    const ext = path.extname(filePath).toLowerCase();
    if (parser === ADAPTER_ID_OXC) {
        const oxc = getAdapter(ADAPTER_ID_OXC);
        if (adapterSupportsExtension(oxc, ext)) return oxc;
    }
    const known = EXTENSION_ADAPTER_IDS[ext];
    if (known && !registered[known]) {
        const adapter = getAdapter(known);
        if (adapterSupportsExtension(adapter, ext)) return adapter;
    }
    for (const id of Object.keys(factories)) {
        const a = getAdapter(id);
        if (adapterSupportsExtension(a, ext)) return a;
    }
    for (const a of Object.values(registered)) {
        if (adapterSupportsExtension(a, ext)) return a;
    }
    return getAdapter(ADAPTER_ID_TYPESCRIPT);
}

/**
 * Report whether a real language adapter claims this file's extension.
 *
 * `adapterFor` never fails: unknown extensions fall back to the TypeScript adapter for backward
 * compatibility. Callers that must distinguish "parsed by a language adapter" from "silently
 * parsed as TypeScript" use this predicate to fail closed instead of reporting zero findings.
 *
 * @param filePath - File path whose extension is inspected (case-insensitive).
 * @param parser - Selected TS-family parser; only changes which adapter is consulted first.
 * @returns True when an adapter explicitly declares the extension, false for the fallback case.
 */
export function hasAdapterFor(filePath: string, parser: ParserKind = 'typescript'): boolean {
    const ext = path.extname(filePath).toLowerCase();
    if (parser === ADAPTER_ID_OXC && adapterSupportsExtension(getAdapter(ADAPTER_ID_OXC), ext)) {
        return true;
    }
    const known = EXTENSION_ADAPTER_IDS[ext];
    if (known && !registered[known]) {
        if (adapterSupportsExtension(getAdapter(known), ext)) return true;
    }
    for (const id of Object.keys(factories)) {
        if (adapterSupportsExtension(getAdapter(id), ext)) return true;
    }
    for (const a of Object.values(registered)) {
        if (adapterSupportsExtension(a, ext)) return true;
    }
    return false;
}
