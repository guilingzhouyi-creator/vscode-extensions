/**
 * Module: Review — Unified Snapshot Execution Tests
 * File Path: tests/unit/quality/review-path-parity.test.ts
 * Architecture Role: Exercise immutable full and diff reviews through the real dual-track engine.
 * Dependencies & Triggers: Vitest, captured source bytes and compiled production entry points.
 * Responsibilities: Detect early deep completion, skipped experts and mutable-input fallback.
 * Exit Semantics & Design Rationale: Static completion conveys no trusted gate approval.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/core/config/config';
import { captureSourceSnapshot } from '../../../src/core/review/source-snapshot';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import type { Analyzer, Issue } from '../../../src/core/types';
import type * as Executor from '../../../src/core/review/review-executor';

const require = createRequire(import.meta.url);
const { Scanner } = require('../../../dist/core/analyzer.js') as { Scanner: typeof ScannerType };
const { LoadGovernor } = require('../../../dist/core/profiler/loadGovernor.js');
const content = 'export async function run() {\n    return fs.readFileSync("a");\n}\n';
function snapshot() {
    const bytes = Buffer.from(content);
    return captureSourceSnapshot({
        repositoryId: 'review-parity', tree: { algorithm: 'git-sha1', value: 'b'.repeat(40) },
    }, [{
        path: 'src/a.ts', mode: '100644', bytes, byteLength: bytes.length,
        object: {
            algorithm: 'git-sha1',
            value: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
        },
    }], { maxEntries: 10, maxBlobBytes: 4096, maxTotalBytes: 4096 });
}
function scanner(signal?: AbortSignal, versioned = true) {
    const engine = new Scanner({
        ...getDefaultConfig(), root: process.cwd(), archetype: 'library', signal,
        cacheEnabled: false, sparseRouting: false, bypassPreflight: true,
        analyzers: { performance: { enabled: true } },
    });
    // The fixture declares its analyzer revision; production unknown versions remain incomplete.
    if (versioned) engine.getPlan()[0].instance.version = 1;
    return engine;
}
function execute(...args: Parameters<typeof Executor.executeReview>) {
    const engine = require('../../../dist/core/review/review-executor.js') as typeof Executor;
    return engine.executeReview(...args);
}
afterEach(() => vi.restoreAllMocks());

describe('unified immutable review', () => {
    it('keeps real analyzers with unknown implementation versions incomplete', async () => {
        const result = await execute({ requestId: 'unknown-version' }, snapshot(), {
            scanner: scanner(undefined, false),
        });
        expect(result.completion.status).toBe('partial');
        expect(result.coverage).toMatchObject([{
            observedVersion: null, status: 'degraded', reason: 'analyzer-version-unknown',
        }]);
    });
    it('produces the same required diagnostics for full and bounded diff entry requests', async () => {
        const full = await execute({ requestId: 'full' }, snapshot(), { scanner: scanner() });
        const diff = await execute({
            requestId: 'diff', changes: [{ path: 'src/a.ts', oldContent: '', lineBounds: [1, 1] }],
        }, snapshot(), { scanner: scanner() });
        expect(full.completion.status).toBe('complete');
        expect(diff.completion.status).toBe('complete');
        expect(full.issues.some(issue => issue.rule === 'PRF-IO-001')).toBe(true);
        expect(diff.issues.map(issue => issue.id)).toEqual(full.issues.map(issue => issue.id));
        expect(diff.coverage).toMatchObject([{ status: 'executed', path: 'src/a.ts' }]);
    });
    it('replaces speculative findings that an actual whole-file compensation refutes', async () => {
        const engine = scanner();
        let sawBody = false;
        const boundedIssue: Issue = {
            id: 'performance:PRF-IO-001:src/a.ts:1', analyzer: 'performance', rule: 'PRF-IO-001',
            severity: 'warning', message: 'Body was outside the visited scope',
            location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            evidence: { confidence: 1 },
        };
        const analyzer: Analyzer = {
            name: 'performance', version: 1, analyze: () => [],
            resetState: () => { sawBody = false; },
            visit: node => { if ((node.start?.line ?? 1) > 1) sawBody = true; },
            finalize: () => sawBody ? [] : [boundedIssue],
        };
        engine.getPlan()[0].instance = analyzer;
        engine.getPlan()[0].factory = () => analyzer;
        const result = await execute({
            requestId: 'refuted', changes: [{ path: 'src/a.ts', oldContent: '', lineBounds: [1, 1] }],
        }, snapshot(), { scanner: engine, options: { forceFull: true } });
        expect(result.execution.some(pass => pass.lineBounds)).toBe(true);
        expect(result.execution.some(pass => !pass.lineBounds)).toBe(true);
        expect(result.issues).toEqual([]);
        expect(result.completion.status).toBe('complete');
    });
    it('keeps the final result pending until the actual deep track resolves', async () => {
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        const governor = new LoadGovernor();
        vi.spyOn(governor, 'yieldEventLoop').mockImplementation(async () => {
            started();
            await gate;
        });
        let settled = false;
        const pending = execute({ requestId: 'await-deep' }, snapshot(), {
            scanner: scanner(), options: { loadGovernor: governor },
        }).then(result => { settled = true; return result; });
        await entered;
        expect(settled).toBe(false);
        release();
        expect((await pending).tracks.deep).toBe('complete');
    });
    it('retains a deep rejection as failed execution after fast analysis succeeds', async () => {
        const governor = new LoadGovernor();
        vi.spyOn(governor, 'yieldEventLoop').mockRejectedValue(new Error('deep probe failure'));
        const result = await execute({ requestId: 'deep-failure' }, snapshot(), {
            scanner: scanner(), options: { loadGovernor: governor },
        });
        expect(result.completion).toMatchObject({ status: 'failed' });
        expect(result.tracks).toMatchObject({ fast: 'complete', deep: 'failed' });
        expect(result.issues.some(issue => issue.rule === 'PRF-IO-001')).toBe(true);
    });
    it('reports cancellation without claiming completion', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await execute({ requestId: 'cancelled' }, snapshot(), {
            scanner: scanner(controller.signal),
        });
        expect(result.completion.status).toBe('cancelled');
        expect(result.execution).toEqual([]);
    });
    it('refuses a scanner already contaminated by mutable workspace execution', async () => {
        const engine = scanner();
        await engine.runAnalyzers('src/a.ts', 'export const changed = true;');
        await expect(execute({ requestId: 'mixed' }, snapshot(), {
            scanner: engine,
        })).rejects.toThrow(/fresh scanner/);
    });
    it('executes snapshot SDK reviews with the same diagnostics and truthful unknown versions', async () => {
        const { PraxisReviewClient } = require('../../../dist/core/praxis/praxis-review-client.js');
        const config = scanner(undefined, false).getConfig();
        const direct = await execute({ requestId: 'direct' }, snapshot(), {
            scanner: scanner(undefined, false),
        });
        const sdk = await new PraxisReviewClient().reviewSnapshot(
            { requestId: 'sdk' }, snapshot(), config,
        );
        expect(sdk.issues.map((issue: { id: string }) => issue.id)).toEqual(
            direct.issues.map(issue => issue.id),
        );
        expect(sdk.completion.status).toBe('partial');
        expect(sdk.tracks.deep).toBe('complete');
    });
    it('runs planned snapshot slices and compensates required diagnostics outside the window', async () => {
        const { PraxisSliceAuditService } = require('../../../dist/core/praxis/sliceAuditService.js');
        const direct = await execute({ requestId: 'direct' }, snapshot(), { scanner: scanner() });
        const slice = await new PraxisSliceAuditService().reviewSnapshotSlice({
            requestId: 'slice', filePath: 'src/a.ts', oldContent: '', changedLines: [1],
        }, snapshot(), { scanner: scanner() });
        expect(slice.plan).toBeDefined();
        expect(slice.review.completion.status).toBe('complete');
        expect(slice.review.issues.map((issue: { id: string }) => issue.id)).toEqual(
            direct.issues.map(issue => issue.id),
        );
    });
    it('keeps empty required work partial', async () => {
        const result = await execute({ requestId: 'empty', scope: [] }, snapshot(), {
            scanner: scanner(),
        });
        expect(result.completion.status).toBe('partial');
        expect(result.coverage).toEqual([]);
    });
});
