/**
 * Module: Core Rules — Lexical Pattern & Prefix Token Registry
 * File Path: src/core/rules/lexical-pattern-registry.ts
 * Architecture Role: Single source of truth for canonical regular expressions,
 *   keyword token sets, declaration prefixes, and fast byte triage masks across
 *   analyzers and MoE routers.
 * Dependencies & Triggers: Consumed by diffClassifier, sliceExtractor, sparseMoEGate,
 *   and individual static analyzers.
 * Responsibilities: Centralize and pre-compile regular expressions and keyword token sets
 *   to eliminate thousands of duplicate regex instances and avoid runtime ReDoS vulnerabilities.
 * Exit Semantics & Design Rationale: Immutable frozen constants and pure lookup functions
 *   with deterministic, zero-allocation behavior on hot scanning paths.
 */

/** Canonical regular expression matching single-line or multi-line comment markers. */
export const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#|--|;)/;

/** Canonical regular expression matching control-flow branch/loop keywords. */
export const CONTROL_FLOW_RE =
    /\b(if|else|for|while|switch|case|match|return|throw|try|catch|break|continue|yield|await)\b/;

/** Canonical regular expression matching asynchronous/concurrency keywords. */
export const ASYNC_CONCURRENCY_RE = /\b(async|await|Promise|Future|tokio|spawn)\b/;

/** Canonical regular expression matching system I/O, process, and network APIs. */
export const SYSTEM_IO_RE =
    /\b(fs\.|fetch|http|process\.|child_process|exec|spawn|open|socket|read|write)\b/;

/** Canonical regular expression matching type signatures, annotations, and contracts. */
export const TYPE_SIGNATURE_RE =
    /(:\s*[A-Z][A-Za-z0-9_<>[\]|&]*|\bas\s+[A-Za-z0-9_<>[\]]+|\binterface\b|\btype\b|\bstruct\b|\benum\b)/;

/** Canonical regular expression matching literal tokens (strings, numbers, booleans). */
export const LITERAL_TOKEN_RE = /(^|\s)(['"][^'"]*['"]|\b\d+(\.\d+)?\b|\btrue\b|\bfalse\b)/;

/** Canonical regular expression matching import or export module statements. */
export const IMPORT_EXPORT_RE = /\b(import\b|export\s+(?:\*|\{)|from\s+['"]|require\s*\()/;

const DECL_VARIANTS: readonly string[] = Object.freeze([
    'function\\s+([A-Za-z0-9_$]+)',
    'class\\s+([A-Za-z0-9_$]+)',
    'interface\\s+([A-Za-z0-9_$]+)',
    'type\\s+([A-Za-z0-9_$]+)',
    'const\\s+([A-Za-z0-9_$]+)\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>',
    'def\\s+([A-Za-z0-9_$]+)',
    'fn\\s+([A-Za-z0-9_$]+)',
]);

const DECL_PREFIX = '^\\s*(?:export\\s+)?(?:async\\s+)?(?:default\\s+)?';

/** Canonical regular expression matching declaration start tokens across languages. */
export const DECLARATION_START_RE: RegExp = new RegExp(
    `${DECL_PREFIX}(?:${DECL_VARIANTS.join('|')})`,
);

const LITERAL_LINE_PATTERNS: readonly string[] = Object.freeze([
    '[\'"][^\'"]*[\'"][,;]?',
    '[0-9]+[LUlu]?[,;]?',
    '(?:const|let|var)\\s+[A-Za-z0-9_$]+\\s*=\\s*(?:[\'"][^\'"]*[\'"]|[0-9]+)[,;]?',
]);

/** Canonical regular expression identifying predominantly literal lines. */
export const PREDOMINANTLY_LITERAL_LINE_RE: RegExp = new RegExp(
    `^(?:${LITERAL_LINE_PATTERNS.join('|')})$`,
);

/**
 * Check whether a trimmed code line is predominantly literal definitions or assignments.
 *
 * @param trimmed - Line text trimmed of leading and trailing whitespace.
 * @returns True when line is purely a literal assignment or enum value.
 */
export function isPredominantlyLiteralLine(trimmed: string): boolean {
    return PREDOMINANTLY_LITERAL_LINE_RE.test(trimmed);
}

/**
 * Test whether a line begins with a comment marker.
 *
 * @param trimmed - Trimmed line text.
 * @returns True if line is a comment.
 */
export function isCommentLine(trimmed: string): boolean {
    return COMMENT_LINE_RE.test(trimmed);
}

/**
 * Test whether a line contains control-flow keywords.
 *
 * @param trimmed - Trimmed line text.
 * @returns True if line contains control-flow tokens.
 */
export function isControlFlowCandidate(trimmed: string): boolean {
    return CONTROL_FLOW_RE.test(trimmed);
}

/**
 * Test whether a line contains async or concurrency primitives.
 *
 * @param trimmed - Trimmed line text.
 * @returns True if line references concurrency constructs.
 */
export function isAsyncConcurrencyToken(trimmed: string): boolean {
    return ASYNC_CONCURRENCY_RE.test(trimmed);
}

/**
 * Test whether a line invokes system I/O or network routines.
 *
 * @param trimmed - Trimmed line text.
 * @returns True if line matches system I/O patterns.
 */
export function isSystemIoApi(trimmed: string): boolean {
    return SYSTEM_IO_RE.test(trimmed);
}
