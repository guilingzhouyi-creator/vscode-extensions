/**
 * Module: Core Intelligence — Constant Semantic Identity & Fingerprint
 * File Path: src/core/intelligence/constant-identity.ts
 * Architecture Role: Provides stable symbol identity and semantic fingerprint models
 *     for constants, enabling deterministic tracking of relocation, mutation, and scope domain
 *     across revisions and diffs without relying on fragile line numbers.
 * Dependencies & Triggers: Consumed by diff relocation detector, patch quality quantification,
 *     anti-gaming guards, and constants analyzer.
 * Responsibilities:
 *     1. Model code domains (file header, imports, module constants, types, logic, local scopes).
 *     2. Define ConstantSymbolIdentity and ConstantSemanticFingerprint.
 *     3. Compute collision-resistant semantic hashes from normalized values and AST topology.
 *     4. Compare semantic identity across revisions to differentiate relocation from mutation.
 * Exit Semantics & Design Rationale: Deterministic, side-effect free, and
 *     pure in-memory calculation.
 */

import * as crypto from 'crypto';

const CHAR_CODE_SINGLE_QUOTE = 39;
const CHAR_CODE_DOUBLE_QUOTE = 34;
const CHAR_CODE_BACKTICK = 96;

/** File header code domain token. */
export const DOMAIN_FILE_HEADER = 'file_header';
/** Import area code domain token. */
export const DOMAIN_IMPORT_AREA = 'import_area';
/** Module constants code domain token. */
export const DOMAIN_MODULE_CONSTANTS = 'module_constants';
/** Type declarations code domain token. */
export const DOMAIN_TYPE_DECLARATIONS = 'type_declarations';
/** Class declarations code domain token. */
export const DOMAIN_CLASS_DECLARATIONS = 'class_declarations';
/** Function declarations code domain token. */
export const DOMAIN_FUNCTION_DECLARATIONS = 'function_declarations';
/** Function local code domain token. */
export const DOMAIN_FUNCTION_LOCAL = 'function_local';
/** Block local code domain token. */
export const DOMAIN_BLOCK_LOCAL = 'block_local';
/** Unknown code domain token. */
export const DOMAIN_UNKNOWN = 'unknown';

/** Number inferred constant type token. */
export const INFERRED_TYPE_NUMBER = 'number';
/** String inferred constant type token. */
export const INFERRED_TYPE_STRING = 'string';
/** Boolean inferred constant type token. */
export const INFERRED_TYPE_BOOLEAN = 'boolean';
/** Array inferred constant type token. */
export const INFERRED_TYPE_ARRAY = 'array';
/** Object inferred constant type token. */
export const INFERRED_TYPE_OBJECT = 'object';
/** Regular expression inferred constant type token. */
export const INFERRED_TYPE_REGEX = 'regex';
/** Unknown inferred constant type token. */
export const INFERRED_TYPE_UNKNOWN = 'unknown';

const DEFAULT_SEMANTIC_KIND = 'general';
const HASH_ALGO_SHA256 = 'sha256';
const ENCODING_UTF8 = 'utf8';
const DIGEST_HEX = 'hex';

/**
 * Standard intra-file code domain hierarchy representing structural zones.
 */
export type CodeDomainKind =
    | typeof DOMAIN_FILE_HEADER
    | typeof DOMAIN_IMPORT_AREA
    | typeof DOMAIN_MODULE_CONSTANTS
    | typeof DOMAIN_TYPE_DECLARATIONS
    | typeof DOMAIN_CLASS_DECLARATIONS
    | typeof DOMAIN_FUNCTION_DECLARATIONS
    | typeof DOMAIN_FUNCTION_LOCAL
    | typeof DOMAIN_BLOCK_LOCAL
    | typeof DOMAIN_UNKNOWN;

/**
 * Stable symbol identity descriptor identifying a constant entity across physical line shifts.
 */
export interface ConstantSymbolIdentity {
    /** Normalized symbol name as declared or suggested. */
    name: string;
    /** Repository-relative file path in POSIX format. */
    filePath: string;
    /** Structural code domain where this symbol resides. */
    codeDomain: CodeDomainKind;
    /** Enclosing declaration name (function, class, interface), or null at module level. */
    enclosingScope: string | null;
    /** Whether the constant is exported. */
    isExported: boolean;
    /** Source line number where declared, or null when unknown. */
    line: number | null;
    /** Source column number where declared, or null when unknown. */
    column?: number | null;
}

/**
 * Inferred data type of the constant value.
 */
export type ConstantInferredType =
    | typeof INFERRED_TYPE_NUMBER
    | typeof INFERRED_TYPE_STRING
    | typeof INFERRED_TYPE_BOOLEAN
    | typeof INFERRED_TYPE_ARRAY
    | typeof INFERRED_TYPE_OBJECT
    | typeof INFERRED_TYPE_REGEX
    | typeof INFERRED_TYPE_UNKNOWN;

/**
 * Content- and semantic-derived fingerprint of a constant's value and immutability.
 */
export interface ConstantSemanticFingerprint {
    /** Deterministic SHA-256 hash representing the semantic payload. */
    semanticHash: string;
    /** Stripped, trimmed, and normalized literal string representation. */
    normalizedValue: string;
    /** Inferred runtime data type. */
    inferredType: ConstantInferredType;
    /** High-level semantic domain tag (e.g., 'http-status', 'time-ms', 'port', 'path-fragment'). */
    semanticKind: string;
    /** Whether the value is strictly immutable (const binding, readonly, or frozen). */
    isImmutable: boolean;
    /** Associated unit if identifiable (e.g., 'ms', 'bytes', 'seconds'). */
    unit?: string;
}

/**
 * Composite entity linking a stable identity with its semantic fingerprint.
 */
export interface ConstantEntity {
    identity: ConstantSymbolIdentity;
    fingerprint: ConstantSemanticFingerprint;
}

/**
 * Fast strip leading and trailing quote characters without RegExp allocation.
 *
 * @param str - Input string possibly enclosed in quotes.
 * @returns Stripped string content.
 */
export function stripLiteralQuotes(str: string): string {
    const len = str.length;
    if (len === 0) return str;
    const first = str.charCodeAt(0);
    const last = str.charCodeAt(len - 1);
    const isQuote = (c: number) =>
        c === CHAR_CODE_SINGLE_QUOTE || c === CHAR_CODE_DOUBLE_QUOTE || c === CHAR_CODE_BACKTICK;
    const start = isQuote(first) ? 1 : 0;
    const end = len > start && isQuote(last) ? len - 1 : len;
    return start > 0 || end < len ? str.slice(start, end) : str;
}

/**
 * Normalizes raw literal text across quotation styles and numeric bases.
 *
 * @param raw - Raw literal string text.
 * @param isNumeric - Whether the literal is numeric.
 * @returns Normalized canonical literal representation.
 */
export function normalizeLiteralValue(raw: string, isNumeric: boolean): string {
    const trimmed = raw.trim();
    if (!isNumeric) {
        return stripLiteralQuotes(trimmed);
    }
    const num = Number(trimmed);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
        return String(num);
    }
    return trimmed;
}

/**
 * Parameters to compute a constant semantic fingerprint.
 */
export interface ComputeFingerprintParams {
    value: string;
    isNumeric: boolean;
    isImmutable?: boolean;
    semanticKind?: string;
    inferredType?: ConstantInferredType;
    unit?: string;
}

/**
 * Computes a collision-resistant deterministic semantic fingerprint.
 *
 * @param params - Configuration parameters for fingerprint computation.
 * @returns Generated semantic fingerprint structure.
 */
export function computeConstantFingerprint(
    params: ComputeFingerprintParams,
): ConstantSemanticFingerprint {
    const isImmutable = params.isImmutable ?? true;
    const normalizedValue = normalizeLiteralValue(params.value, params.isNumeric);
    const inferredType: ConstantInferredType =
        params.inferredType ?? (params.isNumeric ? INFERRED_TYPE_NUMBER : INFERRED_TYPE_STRING);
    const semanticKind = params.semanticKind ?? DEFAULT_SEMANTIC_KIND;
    const unit = params.unit;

    // Construct deterministic serialization string
    const payload = `${inferredType}:${semanticKind}:${unit ?? ''}:${isImmutable ? '1' : '0'}:${normalizedValue}`;
    const semanticHash = crypto
        .createHash(HASH_ALGO_SHA256)
        .update(payload, ENCODING_UTF8)
        .digest(DIGEST_HEX);

    return {
        semanticHash,
        normalizedValue,
        inferredType,
        semanticKind,
        isImmutable,
        unit,
    };
}

/**
 * Determines whether two constant fingerprints represent identical semantic values.
 *
 * @param a - First constant fingerprint.
 * @param b - Second constant fingerprint.
 * @returns True if both fingerprints are semantically equivalent.
 */
export function areSemanticallyEqual(
    a: ConstantSemanticFingerprint,
    b: ConstantSemanticFingerprint,
): boolean {
    return (
        a.semanticHash === b.semanticHash ||
        (a.normalizedValue === b.normalizedValue &&
            a.inferredType === b.inferredType &&
            a.semanticKind === b.semanticKind)
    );
}

/** Directory pattern matching constant, token, or dictionary directories. */
const RE_CONSTANT_DIR = /(?:^|[\\/])(?:constants?|tokens?|dictionary|dictionaries)[\\/]/;

/** File pattern matching constant, token, or dictionary module names. */
const RE_CONSTANT_FILE =
    /(?:^|[\\/]|[-_.])(?:[a-z0-9-_]*[-_.])?(?:constants?|tokens?|dictionar(?:y|ies))\.[a-z0-9]+$/;

/** File pattern matching rule, status, or error code file names. */
const RE_CODE_FILE = /(?:^|[\\/]|[-_.])(?:[a-z0-9-_]*[-_.])?codes?\.[a-z0-9]+$/;

/** Matches control flow statement keywords. */
const RE_CONTROL_FLOW = /\b(?:if\s*\(|for\s*\(|while\s*\(|switch\s*\(|catch\s*\()/g;

/** Matches function declaration or arrow function boundaries. */
const RE_FN_LIKE = /\bfunction\s+\w+|=>\s*\{/g;

/** Matches top-level export const declarations. */
const RE_EXPORT_CONST = /\bexport\s+const\s+[A-Za-z0-9_$]+\s*[:=]/g;

/**
 * Checks if a file path belongs to a recognized constant directory or filename pattern.
 *
 * @param filePath - File path to inspect.
 * @returns True if path matches constant catalog conventions.
 */
function isConstantPath(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    if (RE_CONSTANT_DIR.test(norm)) {
        return true;
    }
    return RE_CONSTANT_FILE.test(norm) || RE_CODE_FILE.test(norm);
}

/**
 * Counts non-overlapping regex matches in a given text.
 *
 * @param text - Input string to search.
 * @param regex - Regular expression with global flag.
 * @returns Total match occurrences.
 */
function countRegexMatches(text: string, regex: RegExp): number {
    const matches = text.match(regex);
    return matches ? matches.length : 0;
}

/** Statement prefixes excluded when determining constant table dominance. */
export const EXCLUDED_STATEMENT_PREFIXES: readonly string[] = [
    'import ',
    'export type ',
    'type ',
    'export interface ',
    'interface ',
];

/** Statement prefixes indicating a constant or enum declaration. */
export const CONSTANT_STATEMENT_PREFIXES: readonly string[] = [
    'export const ',
    'export enum ',
    'enum ',
];

/** Regex identifying property assignments or variable equals assignments with literals. */
const RE_KEY_VAL_CONSTANT = /^[A-Za-z0-9_$]+(?::\s*|\s*=\s*)['"`0-9]/;

function isConstantStatement(line: string): boolean {
    if (CONSTANT_STATEMENT_PREFIXES.some((prefix) => line.startsWith(prefix))) {
        return true;
    }
    if (line.includes('as const')) {
        return true;
    }
    return RE_KEY_VAL_CONSTANT.test(line);
}

/**
 * Checks whether content lines are predominantly constant or enum definitions.
 *
 * @param lines - Non-empty, non-import lines.
 * @returns True if constant definitions make up at least half of the content lines.
 */
function isConstantContentDominant(lines: string[]): boolean {
    if (lines.length === 0) return false;
    let constLineCount = 0;
    for (const l of lines) {
        if (isConstantStatement(l)) {
            constLineCount++;
        }
    }
    return constLineCount / lines.length >= 0.5;
}

/**
 * Determines whether file content exhibits high-cohesion constant table characteristics.
 *
 * @param content - Source code text to analyze.
 * @returns True if content is a dedicated constant catalog.
 */
function hasConstantTableCharacteristics(content: string): boolean {
    if (!content || content.length < 20) return false;
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    if (/\bclass\s+\w+/.test(stripped)) return false;

    const fnCount = countRegexMatches(stripped, RE_FN_LIKE);
    if (fnCount > 2) return false;

    const cfCount = countRegexMatches(stripped, RE_CONTROL_FLOW);
    if (cfCount > 2) return false;

    const hasEnum = /\b(?:export\s+)?enum\s+[A-Za-z0-9_$]+/.test(stripped);
    const hasAsConst = /\bas\s+const\b/.test(stripped);
    const exportConstCount = countRegexMatches(stripped, RE_EXPORT_CONST);

    const hasSufficientConstants =
        exportConstCount >= 3 || hasEnum || (hasAsConst && exportConstCount >= 1);
    if (!hasSufficientConstants) {
        return false;
    }

    const lines = stripped
        .split('\n')
        .map((l) => l.trim())
        .filter(
            (l) =>
                l.length > 0 &&
                !EXCLUDED_STATEMENT_PREFIXES.some((prefix) => l.startsWith(prefix)),
        );

    return isConstantContentDominant(lines);
}

/**
 * Detect if a file path or content represents a dedicated constant definition module.
 *
 * @param filePath - Path to inspect.
 * @param content - Optional source code content for semantic detection.
 * @returns True if the file name, folder, or content designates a dedicated constant catalog.
 */
export function isConstantDefinitionFile(filePath: string, content?: string): boolean {
    if (isConstantPath(filePath)) {
        return true;
    }
    if (content && hasConstantTableCharacteristics(content)) {
        return true;
    }
    return false;
}

/**
 * Format language-aware constant declaration proposal for analyzer suggestions.
 *
 * @param filePath - Target file path for language dialect determination.
 * @param name - Proposed constant identifier.
 * @param value - Literal string representation.
 * @param numeric - Whether literal is numeric.
 * @param comment - Optional diagnostic explanation comment.
 * @returns Idiomatic declaration string tailored for Python, GDScript, Rust, or TS/JS.
 */
export function formatConstantDeclarationSuggestion(
    filePath: string,
    name: string,
    value: string,
    numeric: boolean,
    comment?: string,
): string {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    const commentText = comment ? comment.trim() : '';

    if (norm.endsWith('.py')) {
        const commentSuffix = commentText ? `  # ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `${name} = ${value}${commentSuffix}`;
    }
    if (norm.endsWith('.gd')) {
        const commentSuffix = commentText ? ` # ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `const ${name} = ${value}${commentSuffix}`;
    }
    if (norm.endsWith('.rs')) {
        const typeAnnotation = numeric ? (value.includes('.') ? ': f64' : ': i64') : ': &str';
        const commentSuffix = commentText ? ` // ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `const ${name}${typeAnnotation} = ${value};${commentSuffix}`;
    }
    const commentSuffix = commentText ? ` // ${commentText.replace(/^\/\/\s*/, '')}` : '';
    return `const ${name} = ${value};${commentSuffix}`;
}
