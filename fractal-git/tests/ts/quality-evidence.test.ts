/**
 * Module: Taxis Quality Contract Regressions
 * File Path: tests/ts/quality-evidence.test.ts
 * Architecture Role: Apply the same structural contract mutations as Rust.
 * Dependencies & Triggers: Node test runner, the schema parser, and shared fixtures.
 * Responsibilities: Reject incomplete identities, illegal states and unsupported wire versions.
 * Exit Semantics & Design Rationale: Structural validity never substitutes for trusted approval.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { parseQualityDocument, receiptSigningBytes } from '../../ts/quality/evidence-validation';
import { canonicalReviewJson, canonicalReviewSm3, verifyCanonicalReview } from '../../ts/quality/canonical-json';

interface Mutation {
    name: string;
    target: string;
    pointer: string;
    action: 'set' | 'remove';
    value?: unknown;
}
interface Fixtures {
    documents: Record<string, Record<string, unknown>>;
    mutations: Mutation[];
}
const fixtures: Fixtures = JSON.parse(readFileSync(
    path.resolve(__dirname, '../../../tests/fixtures/quality/schema-vectors.json'), 'utf8',
));

function mutatedInput(mutation: Mutation): string {
    const document = structuredClone(fixtures.documents[mutation.target]);
    const components = mutation.pointer.slice(1).split('/');
    let parent: unknown = document;
    for (const component of components.slice(0, -1)) {
        assert.ok(parent !== null && typeof parent === 'object');
        parent = Reflect.get(parent, component);
    }
    assert.ok(parent !== null && typeof parent === 'object');
    const key = components[components.length - 1];
    if (mutation.action === 'remove') Reflect.deleteProperty(parent, key);
    else Object.defineProperty(parent, key, { value: mutation.value, enumerable: true, writable: true, configurable: true });
    return JSON.stringify(document);
}
for (const [name, document] of Object.entries(fixtures.documents)) {
    test(`accept structural quality document: ${name}`, () => {
        const parsed = parseQualityDocument(JSON.stringify(document));
        assert.deepEqual(parsed, document);
        assert.ok(Object.isFrozen(parsed));
        if (parsed.kind === 'analysis-evidence') {
            assert.ok(Object.isFrozen(parsed.execution.coverage));
            assert.equal(parsed.execution.status, 'partial');
            assert.deepEqual(parsed.measurements.qualityDelta, {
                status: 'measured', value: 0, provenance: { source: 'analysis', sampleIds: ['sample-1'] },
            });
        }
    });
}
for (const mutation of fixtures.mutations) {
    test(`reject quality schema mutation: ${mutation.name}`, () => {
        assert.throws(() => parseQualityDocument(mutatedInput(mutation)));
    });
}
test('structural parsing also rejects duplicate raw properties', () => {
    const request = JSON.stringify(fixtures.documents.request);
    assert.throws(() => parseQualityDocument(request.replace('{', '{"schemaVersion":1,')));
});

interface SigningVector {
    testKeyHex: string;
    requestCanonical: string;
    evidenceCanonical: string;
    signingCanonical: string;
    signingDigestSm3: string;
    receipt: { signature: string };
}

test('receipt signing covers the v1 envelope and payload with exact shared bytes', () => {
    const vector: SigningVector = JSON.parse(readFileSync(
        path.resolve(__dirname, '../../../tests/fixtures/quality/receipt-signing-vector.json'), 'utf8',
    ));
    const bytes = receiptSigningBytes(JSON.stringify(vector.receipt));
    assert.equal(bytes.toString('utf8'), vector.signingCanonical);
    assert.equal(canonicalReviewSm3(bytes).toString('hex'), vector.signingDigestSm3);
    const key = Buffer.from(vector.testKeyHex, 'hex');
    assert.equal(verifyCanonicalReview(bytes, Buffer.from(vector.receipt.signature, 'hex'), key), true);
    assert.equal(canonicalReviewJson(JSON.stringify(fixtures.documents.request)).toString('utf8'), vector.requestCanonical);
    assert.equal(canonicalReviewJson(JSON.stringify(fixtures.documents.evidence)).toString('utf8'), vector.evidenceCanonical);
    const receipt = parseQualityDocument(JSON.stringify(vector.receipt));
    assert.equal(receipt.kind, 'trusted-review-receipt');
    if (receipt.kind !== 'trusted-review-receipt') throw new Error('expected receipt');
    assert.equal(receipt.payload.decision, 'unavailable');
    assert.equal(canonicalReviewSm3(vector.requestCanonical).toString('hex'), receipt.payload.requestDigest.value);
    assert.equal(canonicalReviewSm3(vector.evidenceCanonical).toString('hex'), receipt.payload.evidenceDigest.value);
    const altered = JSON.parse(vector.signingCanonical);
    altered.payload.decision = 'approved';
    assert.equal(verifyCanonicalReview(JSON.stringify(altered), Buffer.from(vector.receipt.signature, 'hex'), key), false);
    assert.throws(() => receiptSigningBytes(JSON.stringify(fixtures.documents.request)));
});

test('measurements accept closed tenDimensions and quantMetrics and reject invalid extensions', () => {
    const base = structuredClone(fixtures.documents.evidence) as Record<string, unknown>;
    const measurements = base.measurements as Record<string, unknown>;
    measurements.tenDimensions = {
        architectureConsistency: 94.5,
        semanticPurity: 96.0,
        codeSecurity: 99.5,
        performanceEfficiency: 92.25,
        standardization: 95.0,
        modernity: 91.5,
        maintainability: 93.0,
        commentQuality: 89.75,
        duplication: 98.0,
        techDebtRisk: 97.5,
        compositeScore: 94.8,
        grade: 'A+',
    };
    measurements.quantMetrics = {
        rcr: 1.4,
        erq: 2.1,
        ddr: 1.8,
        edb95: 3.2,
        ptd: 4.5,
        dsi: 0.28,
        rcd: 1.15,
        ehl: 2.5,
        workspaceHealthScore: 93.2,
        autonomyRate: 0.96,
        polyglotIndex: 91.0,
        sqaleMinutes: 42.5,
        tdr: 0.03,
        confidence: 0.91,
    };
    const parsed = parseQualityDocument(JSON.stringify(base));
    assert.equal(parsed.kind, 'analysis-evidence');
    if (parsed.kind === 'analysis-evidence') {
        assert.equal(parsed.measurements.tenDimensions?.grade, 'A+');
        assert.equal(parsed.measurements.quantMetrics?.autonomyRate, 0.96);
    }

    const extraField = structuredClone(base) as Record<string, unknown>;
    ((extraField.measurements as Record<string, unknown>).tenDimensions as Record<string, unknown>).unknownAxis = 100;
    assert.throws(() => parseQualityDocument(JSON.stringify(extraField)));

    const outOfRange = structuredClone(base) as Record<string, unknown>;
    ((outOfRange.measurements as Record<string, unknown>).tenDimensions as Record<string, unknown>).codeSecurity = 101;
    assert.throws(() => parseQualityDocument(JSON.stringify(outOfRange)));

    const badGrade = structuredClone(base) as Record<string, unknown>;
    ((badGrade.measurements as Record<string, unknown>).tenDimensions as Record<string, unknown>).grade = 'Z';
    assert.throws(() => parseQualityDocument(JSON.stringify(badGrade)));
});
