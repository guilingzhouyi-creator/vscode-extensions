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

const INFERRED_TYPE_NUMBER: ConstantInferredType = 'number';
const INFERRED_TYPE_STRING: ConstantInferredType = 'string';
const DEFAULT_SEMANTIC_KIND = 'general';
const HASH_ALGO_SHA256 = 'sha256';
const ENCODING_UTF8 = 'utf8';
const DIGEST_HEX = 'hex';

/**
 * Standard intra-file code domain hierarchy representing structural zones.
 */
export type CodeDomainKind =
    | 'file_header'
    | 'import_area'
    | 'module_constants'
    | 'type_declarations'
    | 'class_declarations'
    | 'function_declarations'
    | 'function_local'
    | 'block_local'
    | 'unknown';

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
    'number' | 'string' | 'boolean' | 'array' | 'object' | 'regex' | 'unknown';

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
