import * as path from 'path';
import { LanguageAdapter } from './multilang';
import { ParserKind } from './types';

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

const cache: Record<string, LanguageAdapter> = {};
const registered: Record<string, LanguageAdapter> = {};

const factories: Record<string, () => LanguageAdapter> = {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  typescript: () => new (require('./typescriptAdapter').TypeScriptAdapter)(),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  rust: () => new (require('./rustAdapter').RustAdapter)(),
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  oxc: () => new (require('./oxcAdapter').OxcAdapter)(),
};

function getAdapter(id: string): LanguageAdapter {
  return (cache[id] ??= factories[id]());
}

export function registerAdapter(adapter: LanguageAdapter): void {
  registered[adapter.id] = adapter;
  delete cache[adapter.id]; // a registered adapter always wins over a lazily-built built-in
}

/**
 * Pick the adapter for a file. `parser` selects between the two TS/JS-family parsers
 * ('typescript' — default, historical behavior — or 'oxc' — Rust parser). Non-TS/JS files
 * (e.g. .rs) always resolve by extension regardless of `parser`.
 */
export function adapterFor(filePath: string, parser: ParserKind = 'typescript'): LanguageAdapter {
  const ext = path.extname(filePath).toLowerCase();
  if (parser === 'oxc') {
    const oxc = getAdapter('oxc');
    if (oxc.extensions.includes(ext)) return oxc;
  }
  for (const id of Object.keys(factories)) {
    const a = getAdapter(id);
    if (a.extensions.includes(ext)) return a;
  }
  for (const a of Object.values(registered)) {
    if (a.extensions.includes(ext)) return a;
  }
  return getAdapter('typescript');
}
