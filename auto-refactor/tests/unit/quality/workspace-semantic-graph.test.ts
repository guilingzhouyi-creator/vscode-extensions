/**
 * Module: Review — Workspace Semantic Wiring Tests
 * File Path: tests/unit/quality/workspace-semantic-graph.test.ts
 * Architecture Role: Verify real workspace-to-diff topology and immutable workspace input.
 * Dependencies & Triggers: Temporary owned files, production SDK, scanner and semantic graph.
 * Responsibilities: Reject stale diagrams, mutable-source fallback and missing coverage claims.
 * Exit Semantics & Design Rationale: Legacy directory observations never impersonate a fixed tree.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureSourceSnapshot } from '../../../src/core/review/source-snapshot';

const require = createRequire(import.meta.url);
const { PraxisReviewClient } = require('../../../dist/core/praxis/praxis-review-client.js');
const { Scanner } = require('../../../dist/core/analyzer.js');
const files = {
    'a.ts': 'import { value } from "./b"; export function use() { return value; }',
    'b.ts': 'export function value() { return 1; }',
};
function snapshot(source: Readonly<Record<string, string>> = files) {
    return captureSourceSnapshot({ repositoryId: 'workspace-graph',
        tree: { algorithm: 'git-sha1', value: 'b'.repeat(40) } },
    Object.entries(source).map(([file, text]) => {
        const bytes = Buffer.from(text);
        return { path: file, mode: '100644' as const, bytes, byteLength: bytes.length,
            object: { algorithm: 'git-sha1' as const,
                value: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } };
    }), { maxEntries: 4, maxBlobBytes: 4096, maxTotalBytes: 8192 });
}
async function withWorkspace(run: (root: string) => Promise<void>) {
    const temporaryRoot = await fs.realpath(tmpdir());
    const root = await fs.mkdtemp(path.join(temporaryRoot, 'auto-graph-'));
    try {
        for (const [file, text] of Object.entries(files)) await fs.writeFile(path.join(root, file), text);
        await fs.writeFile(path.join(root, 'auto-refactor.config.json'), JSON.stringify({
            include: ['**/*.ts'], exclude: [], archetype: 'library', cacheEnabled: false,
            workers: 1, sparseRouting: false, bypassPreflight: true,
        }));
        await run(root);
    } finally {
        const resolved = path.resolve(root);
        if (!resolved.trim() || resolved === path.parse(resolved).root ||
            path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('auto-graph-') ||
            (await fs.lstat(resolved)).isSymbolicLink()) throw new Error('Invalid owned fixture cleanup');
        await fs.rm(resolved, { recursive: true, force: true });
    }
}
afterEach(() => vi.restoreAllMocks());

describe('workspace semantic graph wiring', () => {
    it('uses explicit immutable workspace input and never invokes mutable discovery', async () => {
        await withWorkspace(async root => {
            const source = snapshot();
            vi.spyOn(Scanner.prototype, 'scan').mockRejectedValue(new Error('Mutable discovery forbidden'));
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const verdict = await client.reviewWorkspace({
                snapshot: source, analyzers: ['performance'], includeDualFacedPresentation: false,
            });
            expect(verdict.semanticGraph.identity.snapshot).toEqual(source.identity);
            expect(client.semanticGraphGeneration).toBe(verdict.semanticGraph);
            expect(verdict.semanticGraph.getFileImpact('b.ts').files).toContain('a.ts');
            expect(verdict.execution).toBeDefined();
        });
    });

    it('backfills legacy scan observations for the following real diff review', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const verdict = await client.reviewWorkspace({
                analyzers: ['performance'], includeDualFacedPresentation: false,
            });
            expect(client.semanticGraph.getNodesByFile('a.ts').length).toBeGreaterThan(0);
            expect(verdict.execution.status).toBe('partial');
            expect(verdict.execution.coverage).toContainEqual(expect.objectContaining({
                capability: 'graph-analysis', status: 'degraded', reason: 'workspace-snapshot-unavailable',
            }));
            const result = await client.reviewDiff({ kind: 'full', filePath: 'b.ts',
                oldContent: files['b.ts'], newContent: 'export const value = 2;',
            }, { useSparseMoE: false });
            expect(result.hunks.some((hunk: { astContext?: { impactFiles?: string[] } }) =>
                hunk.astContext?.impactFiles?.includes('a.ts'))).toBe(true);
        });
    });

    it('retains incoming module impact when the changed hunk matches a function node', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            await client.reviewWorkspace({ snapshot: snapshot(), analyzers: ['performance'],
                includeDualFacedPresentation: false });
            const result = await client.reviewDiff({ kind: 'full', filePath: 'b.ts',
                oldContent: files['b.ts'], newContent: 'export function value() { return 2; }' });
            expect(result.hunks.some((hunk: { astContext?: { impactFiles?: string[] } }) =>
                hunk.astContext?.impactFiles?.includes('a.ts'))).toBe(true);
        });
    });

    it('detects global cycles from captured source even when the workspace has opposite imports', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const cyclic = { ...files, 'b.ts': 'import { use } from "./a"; export const value = use;' };
            const options = { analyzers: ['dependency-graph'], includeDualFacedPresentation: false };
            const captured = await client.reviewWorkspace({ ...options, snapshot: snapshot(cyclic) });
            expect(captured.issues.some((issue: { rule: string }) => issue.rule === 'import-cycle')).toBe(true);
            await fs.writeFile(path.join(root, 'b.ts'), cyclic['b.ts']);
            const acyclic = await client.reviewWorkspace({ ...options, snapshot: snapshot() });
            expect(acyclic.issues.some((issue: { rule: string }) => issue.rule === 'import-cycle')).toBe(false);
        });
    });

    it('never reads mutable source files while building a snapshot workspace report', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const sourceReads: string[] = [];
            const syncFs = require('node:fs');
            const originalRead = syncFs.readFileSync;
            vi.spyOn(syncFs, 'readFileSync').mockImplementation((...args: unknown[]) => {
                const file = String(args[0]);
                if (file.startsWith(root) && file.endsWith('.ts')) {
                    sourceReads.push(file);
                    throw new Error('mutable source read');
                }
                return originalRead(...args);
            });
            const verdict = await client.reviewWorkspace({ snapshot: snapshot(),
                analyzers: ['performance'], includeDualFacedPresentation: false });
            expect(verdict.scanReport.summary.filesScanned).toBe(2);
            expect(sourceReads).toEqual([]);
            expect(verdict.scanReport.autonomy).toBeUndefined();
            expect(verdict.scanReport.summary.warnings).toContain('snapshot-external-enrichment-unavailable');
            expect(verdict.execution.coverage.some((fact: { capability: string; status: string }) =>
                fact.capability === 'workspace-structural-finalization' && fact.status === 'supported')).toBe(true);
        });
    });

    it('publishes an empty diff without retaining deleted symbols or changing old readers', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            await client.reviewWorkspace({ snapshot: snapshot(), analyzers: ['performance'],
                includeDualFacedPresentation: false });
            const previous = client.semanticGraph;
            const generation = client.semanticGraphGeneration;
            await client.reviewDiff({ kind: 'full', filePath: 'b.ts',
                oldContent: files['b.ts'], newContent: '', });
            expect(client.semanticGraph.getNodesByFile('b.ts').some(
                (node: { kind: string }) => node.kind === 'function')).toBe(false);
            expect(client.semanticGraph).not.toBe(previous);
            expect(previous.getNodesByFile('b.ts').some(
                (node: { kind: string }) => node.kind === 'function')).toBe(true);
            expect(generation.getNodesByFile('b.ts').length).toBeGreaterThan(0);
            expect(client.semanticGraphGeneration).toBeUndefined();
        });
    });

    it('reports unknown impact for absent topology and partial impact for observed topology', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const unknown = await client.reviewDiff({ kind: 'full', filePath: 'unknown.xyz',
                oldContent: 'before', newContent: 'after' });
            expect(unknown.impactSummary.completeness).toBe('unknown');
            await client.reviewWorkspace({ analyzers: ['performance'],
                includeDualFacedPresentation: false });
            const observed = await client.reviewDiff({ kind: 'full', filePath: 'b.ts',
                oldContent: files['b.ts'], newContent: 'export const value = 2;' });
            expect(observed.impactSummary.completeness).toBe('partial');
            expect(observed.hunks.every((hunk: { astContext?: { impactCompleteness?: string } }) =>
                hunk.astContext?.impactCompleteness === 'partial')).toBe(true);
        });
    });

    it('replaces the previous workspace graph after an observed file is deleted', async () => {
        await withWorkspace(async root => {
            const client = new PraxisReviewClient({ root, enableMoE: false });
            const options = { analyzers: ['performance'], includeDualFacedPresentation: false };
            await client.reviewWorkspace(options);
            const previous = client.semanticGraph;
            await fs.unlink(path.join(root, 'b.ts'));
            await client.reviewWorkspace(options);
            expect(client.semanticGraph.getNodesByFile('b.ts')).toEqual([]);
            expect(previous.getNodesByFile('b.ts').length).toBeGreaterThan(0);
        });
    });
});
