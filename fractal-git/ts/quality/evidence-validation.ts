/**
 * Module: Taxis Quality — Schema Validation
 * File Path: ts/quality/evidence-validation.ts
 * Architecture Role: Construct immutable structural documents from untrusted wire bytes.
 * Dependencies & Triggers: Ajv 2020, generated schema/types, and strict canonical JSON.
 * Responsibilities: Validate the authoritative schema without coercion or external schema loading.
 * Exit Semantics & Design Rationale: Structural validity establishes neither trust nor gate authority.
 */
import Ajv2020 from 'ajv/dist/2020';
import type { QualityDocument } from './evidence-contracts';
import { qualityEvidenceSchema } from './evidence-schema';
import { canonicalReviewJson, ReviewEncodingError } from './canonical-json';

const validator = new Ajv2020({ allErrors: false, coerceTypes: false, removeAdditional: false, useDefaults: false })
    .compile<QualityDocument>(qualityEvidenceSchema);

function freezeDocument<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freezeDocument(child);
        Object.freeze(value);
    }
    return value;
}

/** Parse strict JSON into a deeply immutable v1 document. Trust verification is a separate step. */
export function parseQualityDocument(input: string | Uint8Array): QualityDocument {
    const value: unknown = JSON.parse(canonicalReviewJson(input).toString('utf8'));
    if (!validator(value)) {
        throw new ReviewEncodingError('document does not match the quality evidence v1 schema');
    }
    return freezeDocument(value);
}

/** Encode the v1 receipt envelope and full payload, excluding only its signature field. */
export function receiptSigningBytes(input: string | Uint8Array): Buffer {
    const receipt = parseQualityDocument(input);
    if (receipt.kind !== 'trusted-review-receipt') {
        throw new ReviewEncodingError('receipt signing requires a trusted-review-receipt envelope');
    }
    return canonicalReviewJson(JSON.stringify({
        schemaVersion: receipt.schemaVersion,
        kind: receipt.kind,
        payload: receipt.payload,
    }));
}
