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
 * Encapsulated frozen dictionary of inferred constant types.
 */
export const INFERRED_TYPES = Object.freeze({
    NUMBER: 'number',
    STRING: 'string',
    BOOLEAN: 'boolean',
    ARRAY: 'array',
    OBJECT: 'object',
    REGEX: 'regex',
    UNKNOWN: 'unknown',
} as const);

/**
 * Inferred data type of the constant value derived from canonical type dictionary.
 */
export type ConstantInferredType =
    (typeof INFERRED_TYPES)[keyof typeof INFERRED_TYPES];

const DEFAULT_SEMANTIC_KIND = 'general';
const HASH_ALGO_SHA256 = 'sha256';
const ENCODING_UTF8 = 'utf8';
const DIGEST_HEX = 'hex';

const MIN_CONTENT_LENGTH = 20;
const MIN_EXPORT_CONST_THRESHOLD = 3;

const RUST_TYPE_F64 = ': f64';
const RUST_TYPE_I64 = ': i64';
const RUST_TYPE_STR = ': &str';

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
    const isQuote = (charCode: number) =>
        charCode === CHAR_CODE_SINGLE_QUOTE ||
        charCode === CHAR_CODE_DOUBLE_QUOTE ||
        charCode === CHAR_CODE_BACKTICK;
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
    return !Number.isNaN(num) && Number.isFinite(num) ? String(num) : trimmed;
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
        params.inferredType ?? (params.isNumeric ? INFERRED_TYPES.NUMBER : INFERRED_TYPES.STRING);
    const semanticKind = params.semanticKind ?? DEFAULT_SEMANTIC_KIND;
    const unit = params.unit;

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
 * @param firstFingerprint - First constant fingerprint.
 * @param secondFingerprint - Second constant fingerprint.
 * @returns True if both fingerprints are semantically equivalent.
 */
export function compareSemanticEquality(
    firstFingerprint: ConstantSemanticFingerprint,
    secondFingerprint: ConstantSemanticFingerprint,
): boolean {
    return (
        firstFingerprint.semanticHash === secondFingerprint.semanticHash ||
        (firstFingerprint.normalizedValue === secondFingerprint.normalizedValue &&
            firstFingerprint.inferredType === secondFingerprint.inferredType &&
            firstFingerprint.semanticKind === secondFingerprint.semanticKind)
    );
}

/** Backward compatibility alias for compareSemanticEquality. */
export const areSemanticallyEqual = compareSemanticEquality;

/** Directory pattern matching constant, token, or dictionary directories. */
const RE_CONSTANT_DIR = /(?:^|[\\/])(?:constants?|tokens?|dictionary|dictionaries)[\\/]/;

/** File pattern matching constant, token, or dictionary module names. */
const RE_CONSTANT_FILE =
    /(?:^|[\\/]|[-_.])(?:[a-z0-9-_]*[-_.])?(?:constants?|tokens?|dictionar(?:y|ies))\.[a-z0-9]+$/;

/** File pattern matching rule, status, or error code file names. */
const RE_CODE_FILE = /(?:^|[\\/]|[-_.])(?:[a-z0-9-_]*[-_.])?codes?\.[a-z0-9]+$/;

/** File pattern matching metadata catalog or table files. */
const RE_METADATA_CATALOG_FILE =
    /(?:^|[\\/])(?:[a-z0-9-_.]*?)(?:catalog|recipe|archetype|terminology|shim|table|ruletable|dimension)[a-z0-9-_.]*\.[a-z0-9]+$/i;

/** Matches control flow statement keywords. */
const RE_CONTROL_FLOW = /\b(?:if\s*\(|for\s*\(|while\s*\(|switch\s*\(|catch\s*\()/g;

/** Matches function declaration or arrow function boundaries. */
const RE_FN_LIKE = /\bfunction\s+\w+|=>\s*\{/g;

/** Matches top-level export const declarations. */
const RE_EXPORT_CONST = /\bexport\s+const\s+[A-Za-z0-9_$]+\s*[:=]/g;

function isConstantPath(filePath: string): boolean {
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    return (
        RE_CONSTANT_DIR.test(norm) ||
        RE_CONSTANT_FILE.test(norm) ||
        RE_CODE_FILE.test(norm) ||
        RE_METADATA_CATALOG_FILE.test(norm)
    );
}

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
    return (
        CONSTANT_STATEMENT_PREFIXES.some((prefix) => line.startsWith(prefix)) ||
        line.includes('as const') ||
        RE_KEY_VAL_CONSTANT.test(line)
    );
}

function isConstantContentDominant(lines: string[]): boolean {
    if (lines.length === 0) return false;
    let constLineCount = 0;
    for (const line of lines) {
        if (isConstantStatement(line)) {
            constLineCount++;
        }
    }
    return constLineCount / lines.length >= 0.5;
}

function hasConstantTableCharacteristics(content: string): boolean {
    if (!content || content.length < MIN_CONTENT_LENGTH) return false;
    const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    if (/\bclass\s+\w+/.test(stripped)) return false;

    if (countRegexMatches(stripped, RE_FN_LIKE) > 2) return false;
    if (countRegexMatches(stripped, RE_CONTROL_FLOW) > 2) return false;

    const hasEnum = /\b(?:export\s+)?enum\s+[A-Za-z0-9_$]+/.test(stripped);
    const hasAsConst = /\bas\s+const\b/.test(stripped);
    const exportConstCount = countRegexMatches(stripped, RE_EXPORT_CONST);

    const hasSufficientConstants =
        exportConstCount >= MIN_EXPORT_CONST_THRESHOLD || hasEnum || (hasAsConst && exportConstCount >= 1);
    if (!hasSufficientConstants) return false;

    const lines = stripped
        .split('\n')
        .map((line) => line.trim())
        .filter(
            (line) =>
                line.length > 0 &&
                !EXCLUDED_STATEMENT_PREFIXES.some((prefix) => line.startsWith(prefix)),
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
    return Boolean(content && hasConstantTableCharacteristics(content));
}

/**
 * Configuration options for formatting a constant declaration suggestion.
 */
export interface ConstantProposalOptions {
    filePath: string;
    name: string;
    literalValue: string;
    isNumeric: boolean;
    comment?: string;
}

/**
 * Format language-aware constant declaration proposal for analyzer suggestions.
 *
 * @param options - Configuration parameters for the declaration proposal.
 * @returns Idiomatic declaration string tailored for Python, GDScript, Rust, or TS/JS.
 */
export function formatConstantDeclarationSuggestion(
    options: ConstantProposalOptions,
): string {
    const { filePath, name, literalValue, isNumeric, comment } = options;
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    const commentText = comment ? comment.trim() : '';

    if (norm.endsWith('.py')) {
        const commentSuffix = commentText ? `  # ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `${name} = ${literalValue}${commentSuffix}`;
    }
    if (norm.endsWith('.gd')) {
        const commentSuffix = commentText ? ` # ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `const ${name} = ${literalValue}${commentSuffix}`;
    }
    if (norm.endsWith('.rs')) {
        const typeAnnotation = isNumeric
            ? literalValue.includes('.')
                ? RUST_TYPE_F64
                : RUST_TYPE_I64
            : RUST_TYPE_STR;
        const commentSuffix = commentText ? ` // ${commentText.replace(/^\/\/\s*/, '')}` : '';
        return `const ${name}${typeAnnotation} = ${literalValue};${commentSuffix}`;
    }
    const commentSuffix = commentText ? ` // ${commentText.replace(/^\/\/\s*/, '')}` : '';
    return `const ${name} = ${literalValue};${commentSuffix}`;
}
