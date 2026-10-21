/**
 * Module: Core Cache Key — Engine Digest Invalidation Contract
 * File Path: tests/unit/core/cache-key-engine-digest.test.ts
 * Architecture Role: Pins the fingerprint contract that any analyzer or AST-projection change
 *   makes previously cached results unreachable without a manual `ANALYZER_VERSIONS` bump.
 * Dependencies & Triggers: Consumes src/core/cache-key; runs inside the vitest in-memory lane.
 * Responsibilities: Assert the digest is a stable hex digest, is embedded in the fingerprint
 *   payload, distinguishes sub-trees, and shifts the L2 key when engine bytes change.
 * Exit Semantics & Design Rationale: Pure assertions over compiled module bytes; no I/O fixtures.
 */
import { describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    computeEngineDigest,
    computeFingerprintHash,
    computeL2Key,
    getFingerprintAnalyzerDescs,
    buildFingerprintPayload,
} from '../../../src/core/cache-key';
import type { ScanConfig } from '../../../src/core/types';

const ENGINE_DIST_ROOT = path.join(__dirname, '..', '..', '..', 'dist');
const ANALYZER_DIR = path.join(ENGINE_DIST_ROOT, 'analyzers');
const AST_DIR = path.join(ENGINE_DIST_ROOT, 'core', 'ast');
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function minimalConfig(): ScanConfig {
    return {
        root: process.cwd(),
        include: ['src/**/*.ts'],
        exclude: [],
        thresholds: { magicNumberMin: 3 },
        analyzers: { constants: { enabled: true } },
    } as unknown as ScanConfig;
}

describe('computeEngineDigest — stale-cache invalidation contract', () => {
    it('returns a stable sha256 hex digest', () => {
        const digest = computeEngineDigest();
        expectSha256(digest);
        expect(computeEngineDigest()).toBe(digest);
    });

    it('covers both the analyzer and the AST-projection subtrees', () => {
        const analyzerDigest = digestSubtree(ANALYZER_DIR);
        const astDigest = digestSubtree(AST_DIR);
        expectSha256(analyzerDigest);
        expectSha256(astDigest);
        // The combined engine digest must not equal either single subtree: a projection-only
        // change has to invalidate the cache too, so both trees must feed the hash.
        const engineDigest = computeEngineDigest();
        expect(engineDigest).not.toBe(analyzerDigest);
        expect(engineDigest).not.toBe(astDigest);
    });

    it('is embedded in the fingerprint payload and therefore in the L2 key', () => {
        const config = minimalConfig();
        const descs = getFingerprintAnalyzerDescs(config);
        const payload = buildFingerprintPayload(config, 'oxc', '.ts', { descs, customHash: null });
        expect(payload.engineDigest).toBe(computeEngineDigest());
        expectSha256(payload.engineDigest);

        const fp = computeFingerprintHash(payload);
        const key = computeL2Key(fp, 'content-hash');
        expect(key).toBe(`v1:${fp}:content-hash`);
    });

    it('changes the fingerprint when the engine digest changes', () => {
        const config = minimalConfig();
        const descs = getFingerprintAnalyzerDescs(config);
        const baseline = buildFingerprintPayload(config, 'oxc', '.ts', { descs, customHash: null });
        const mutated = { ...baseline, engineDigest: 'f'.repeat(64) };
        expect(computeFingerprintHash(mutated)).not.toBe(computeFingerprintHash(baseline));
    });

    it('keeps analyzer versions informational rather than the sole invalidation trigger', () => {
        const config = minimalConfig();
        const descs = getFingerprintAnalyzerDescs(config);
        const bumped = descs.map((desc) => ({ ...desc, version: desc.version + 1 }));
        const baseline = buildFingerprintPayload(config, 'oxc', '.ts', { descs, customHash: null });
        const versionBumped = buildFingerprintPayload(config, 'oxc', '.ts', {
            descs: bumped,
            customHash: null,
        });
        // Version bumps still change the key, but the digest must remain identical: it derives
        // from bytes on disk, not from the hand-maintained version table.
        expect(versionBumped.engineDigest).toBe(baseline.engineDigest);
        expect(computeFingerprintHash(versionBumped)).not.toBe(computeFingerprintHash(baseline));
    });
});

function expectSha256(value: string): void {
    expect(SHA256_HEX_RE.test(value)).toBe(true);
}

function digestSubtree(dir: string): string {
    const hash = crypto.createHash('sha256');
    const files: string[] = [];
    collectJs(dir, files);
    files.sort();
    for (const file of files) {
        hash.update(path.relative(dir, file));
        hash.update('\u0000');
        hash.update(fs.readFileSync(file));
        hash.update('\u0000');
    }
    return hash.digest('hex');
}

function collectJs(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) collectJs(entryPath, out);
        else if (entry.name.endsWith('.js')) out.push(entryPath);
    }
}
