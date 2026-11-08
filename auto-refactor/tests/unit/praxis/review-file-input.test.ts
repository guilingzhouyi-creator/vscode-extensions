/**
 * Module: Praxis file review input regression tests
 * File Path: tests/unit/praxis/review-file-input.test.ts
 * Architecture Role: Exercise the public SDK's filesystem input boundary.
 * Dependencies & Triggers: Vitest, Node filesystem, and PraxisReviewClient.
 * Responsibilities: Distinguish unreadable inputs, explicit content, and root-relative files.
 * Exit Semantics & Design Rationale: Real reads verify path resolution; injected I/O errors stay local.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PraxisReviewClient } from '../../../src/core/praxis/praxis-review-client';

const testFile = fileURLToPath(import.meta.url);
const testRoot = path.dirname(testFile);

function client(root = testRoot): PraxisReviewClient {
    return new PraxisReviewClient({ root, enableMoE: false, includeDualFacedPresentation: false });
}

afterEach(() => vi.restoreAllMocks());

describe('Praxis file review input', () => {
    it('rejects a missing file instead of reviewing empty content', async () => {
        await expect(client().reviewFile('missing-quality-input.ts')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('resolves relative input against the configured root', async () => {
        const sdk = client();
        await sdk.reviewFile(path.basename(testFile));
        expect(sdk.semanticGraph.getAllNodes().length).toBeGreaterThan(0);
    });

    it('uses an explicit per-request root', async () => {
        const sdk = client(path.dirname(testRoot));
        await sdk.reviewFile(path.basename(testFile), undefined, { root: testRoot });
        expect(sdk.semanticGraph.getAllNodes().length).toBeGreaterThan(0);
    });

    it('preserves a permission failure rather than returning a clean verdict', async () => {
        const error = Object.assign(new Error('read denied'), { code: 'EACCES' });
        vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(error);
        await expect(client().reviewFile(path.basename(testFile))).rejects.toBe(error);
    });

    it('rejects a directory input', async () => {
        await expect(client().reviewFile('.')).rejects.toBeDefined();
    });

    it('rejects reading outside the review root', async () => {
        await expect(client().reviewFile('../outside.ts')).rejects.toMatchObject({
            code: 'PATH_OUTSIDE_ROOT',
        });
    });

    it('accepts explicitly supplied empty content without accessing disk', async () => {
        const read = vi.spyOn(fs.promises, 'readFile');
        const result = await client().reviewFile('empty.ts', '');
        expect(result.status).toBe('passed');
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects malformed UTF-8 instead of auditing replacement characters', async () => {
        vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(Buffer.from([0xc3, 0x28]));
        await expect(client().reviewFile(path.basename(testFile))).rejects.toMatchObject({
            code: 'INVALID_ENCODING',
        });
    });
});
