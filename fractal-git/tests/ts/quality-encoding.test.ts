/**
 * Module: Quality encoding interoperability tests
 * File Path: tests/ts/quality-encoding.test.ts
 * Architecture Role: Compare exact canonical bytes and SM3/HMAC-SM3 vectors with Rust.
 * Dependencies & Triggers: Node test runner and the shared quality fixtures.
 * Responsibilities: Preserve every payload field while rejecting ambiguous JSON inputs.
 * Exit Semantics & Design Rationale: A valid MAC alone never grants issuer or policy trust.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import {
    canonicalReviewJson,
    canonicalReviewSm3,
    signCanonicalReview,
    verifyCanonicalReview,
    MAX_REVIEW_JSON_BYTES,
} from '../../ts/quality/canonical-json';

interface VectorSet {
    testKeyHex: string;
    valid: Array<{ name: string; input: string; canonical: string; sm3: string; hmacSm3: string }>;
    invalid: Array<{ name: string; input: string }>;
}
const vectors: VectorSet = JSON.parse(readFileSync(
    path.resolve(__dirname, '../../../tests/fixtures/quality/canonical-vectors.json'), 'utf8',
));
const key = Buffer.from(vectors.testKeyHex, 'hex');

for (const vector of vectors.valid) {
    test(`canonical byte, digest and signature vector: ${vector.name}`, () => {
        assert.deepEqual(canonicalReviewJson(vector.input), Buffer.from(vector.canonical, 'utf8'));
        assert.equal(canonicalReviewSm3(vector.input).toString('hex'), vector.sm3);
        const signature = signCanonicalReview(vector.input, key);
        assert.equal(signature.toString('hex'), vector.hmacSm3);
        assert.equal(verifyCanonicalReview(vector.input, signature, key), true);
        const tampered = Buffer.from(signature);
        tampered[0] ^= 1;
        assert.equal(verifyCanonicalReview(vector.input, tampered, key), false);
        assert.equal(verifyCanonicalReview(vector.input, signature.subarray(0, 31), key), false);
    });
}
for (const vector of vectors.invalid) {
    test(`reject invalid canonical payload: ${vector.name}`, () => {
        assert.throws(() => canonicalReviewJson(vector.input));
    });
}
test('reject invalid UTF-8 and oversized inputs before signing', () => {
    assert.throws(() => canonicalReviewJson(Buffer.from([0x22, 0xff, 0x22])));
    assert.throws(() => canonicalReviewJson(' '.repeat(MAX_REVIEW_JSON_BYTES + 1)));
    assert.throws(() => signCanonicalReview('{}', Buffer.alloc(31)));
});
test('the MAC covers complete nested identities and execution state', () => {
    const original = '{"snapshot":{"tree":"abc"},"execution":{"status":"partial"}}';
    const signature = signCanonicalReview(original, key);
    assert.equal(verifyCanonicalReview(
        '{"execution":{"status":"partial"}, "snapshot":{"tree":"abc"}}', signature, key,
    ), true);
    assert.equal(verifyCanonicalReview(
        '{"snapshot":{"tree":"def"},"execution":{"status":"partial"}}', signature, key,
    ), false);
    assert.equal(verifyCanonicalReview(
        '{"snapshot":{"tree":"abc"},"execution":{"status":"complete"}}', signature, key,
    ), false);
});
