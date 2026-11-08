/**
 * Module: Taxis Quality — Canonical Review JSON
 * File Path: ts/quality/canonical-json.ts
 * Architecture Role: Bounded RFC 8785 bytes shared with the Rust evidence encoder.
 * Dependencies & Triggers: Native JSON, strict UTF-8 decoding, and Node SM3/HMAC-SM3.
 * Responsibilities: Reject ambiguity before canonicalizing, digesting, or signing payloads.
 * Exit Semantics & Design Rationale: MAC integrity is separate from issuer trust and gate policy.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';

export const MAX_REVIEW_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const AUTHORITY_KEY_BYTES = 32;

/** A rejected payload has no canonical evidence representation. */
export class ReviewEncodingError extends Error {
    readonly code = 'INVALID_REVIEW_EVIDENCE';

    constructor(message: string, options?: ErrorOptions) {
        super(`Invalid review evidence: ${message}`, options);
        this.name = 'ReviewEncodingError';
    }
}

function assertUnicode(value: string): void {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
                throw new ReviewEncodingError('unpaired Unicode surrogate');
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new ReviewEncodingError('unpaired Unicode surrogate');
        }
    }
}

/** Scan already grammar-checked JSON, preserving duplicate keys erased by JSON.parse. */
class PropertyScanner {
    private index = 0;

    constructor(private readonly text: string) {}

    private skipWhitespace(): void {
        while (' \t\r\n'.includes(this.text[this.index] ?? '\u0000')) this.index++;
    }

    private stringToken(): string {
        const start = this.index++;
        while (this.index < this.text.length) {
            const character = this.text[this.index++];
            if (character === '\\') this.index++;
            else if (character === '"') {
                const value: unknown = JSON.parse(this.text.slice(start, this.index));
                if (typeof value !== 'string') throw new ReviewEncodingError('invalid property token');
                return value;
            }
        }
        throw new ReviewEncodingError('unterminated string token');
    }

    private container(depth: number): void {
        if (depth >= MAX_JSON_DEPTH) throw new ReviewEncodingError('JSON depth budget exceeded');
        const object = this.text[this.index++] === '{';
        const end = object ? '}' : ']';
        const keys = object ? new Set<string>() : undefined;
        this.skipWhitespace();
        while (this.text[this.index] !== end) {
            if (keys) {
                const key = this.stringToken();
                if (keys.has(key)) throw new ReviewEncodingError('duplicate JSON property');
                keys.add(key);
                this.skipWhitespace();
                this.index++; // Colon was checked by the native JSON grammar parser.
            }
            this.value(depth + 1);
            this.skipWhitespace();
            if (this.text[this.index] === ',') {
                this.index++;
                this.skipWhitespace();
            }
        }
        this.index++;
    }

    value(depth = 0): void {
        this.skipWhitespace();
        const character = this.text[this.index];
        if (character === '{' || character === '[') this.container(depth);
        else if (character === '"') this.stringToken();
        else {
            while (this.index < this.text.length && !' \t\r\n,]}'.includes(this.text[this.index])) {
                this.index++;
            }
        }
    }
}

function canonicalValue(value: unknown): string {
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') {
        assertUnicode(value);
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
            throw new ReviewEncodingError('non-finite number or number outside the safe range');
        }
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
    if (typeof value === 'object') {
        // RFC 8785 sorts decoded UTF-16 keys. Building the object text directly also
        // avoids JavaScript's special enumeration order for integer-like properties.
        const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        return `{${entries.map(([key, child]) => {
            assertUnicode(key);
            return `${JSON.stringify(key)}:${canonicalValue(child)}`;
        }).join(',')}}`;
    }
    throw new ReviewEncodingError('unsupported JSON value');
}

/** Return exact canonical bytes after strict UTF-8, size, number, depth and uniqueness checks. */
export function canonicalReviewJson(input: string | Uint8Array): Buffer {
    if (typeof input !== 'string' && input.byteLength > MAX_REVIEW_JSON_BYTES) {
        throw new ReviewEncodingError('input payload budget exceeded');
    }
    let text: string;
    let value: unknown;
    try {
        text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
        if (Buffer.byteLength(text, 'utf8') > MAX_REVIEW_JSON_BYTES) {
            throw new ReviewEncodingError('input payload budget exceeded');
        }
        value = JSON.parse(text);
    } catch (cause) {
        if (cause instanceof ReviewEncodingError) throw cause;
        throw new ReviewEncodingError('invalid JSON or UTF-8', { cause });
    }
    new PropertyScanner(text).value();
    const bytes = Buffer.from(canonicalValue(value), 'utf8');
    if (bytes.byteLength > MAX_REVIEW_JSON_BYTES) {
        throw new ReviewEncodingError('canonical payload budget exceeded');
    }
    return bytes;
}

/** Digest the complete canonical payload with an explicitly named algorithm. */
export function canonicalReviewSm3(input: string | Uint8Array): Buffer {
    return createHash('sm3').update(canonicalReviewJson(input)).digest();
}

/** Sign canonical bytes using an explicitly supplied 32-byte key; no fallback key exists. */
export function signCanonicalReview(input: string | Uint8Array, key: Uint8Array): Buffer {
    if (key.byteLength !== AUTHORITY_KEY_BYTES) throw new ReviewEncodingError('authority key must be 32 bytes');
    return createHmac('sm3', key).update(canonicalReviewJson(input)).digest();
}

/** Check MAC integrity. Trust, revocation, freshness and policy remain required separate checks. */
export function verifyCanonicalReview(input: string | Uint8Array, signature: Uint8Array, key: Uint8Array): boolean {
    const expected = signCanonicalReview(input, key);
    return signature.byteLength === expected.byteLength && timingSafeEqual(expected, signature);
}
