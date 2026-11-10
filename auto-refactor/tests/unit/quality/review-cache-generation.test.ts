/**
 * Module: Review — Sparse Cache Generation Tests
 * File Path: tests/unit/quality/review-cache-generation.test.ts
 * Architecture Role: Exercise production sparse scheduling and its bounded context cache.
 * Dependencies & Triggers: Vitest, SparseOrchestrator and actual partition generation.
 * Responsibilities: Reject content collisions and reuse across different execution contexts.
 * Exit Semantics & Design Rationale: Reuse requires exact inputs and a declared analysis generation.
 */
import { describe, expect, it } from 'vitest';
import { SparseOrchestrator } from '../../../src/core/scheduler/sparse-orchestrator';
import { ReviewContextCache, computeSimpleContentHash } from '../../../src/core/scheduler/review-context-cache';
import { AgentQuotaGateway } from '../../../src/core/scheduler/agent-quota-gateway';
import { ReviewEventBus } from '../../../src/core/scheduler/review-event-bus';
import type { SparseSchedulerOptions } from '../../../src/core/scheduler/scheduler-types';

const file = 'src/service.ts';
const options: SparseSchedulerOptions = {
    enableSecondaryCheck: false, analysisGeneration: 'config-v1',
};

function scheduler(cache = new ReviewContextCache()) {
    const eventBus = new ReviewEventBus();
    const runner = new SparseOrchestrator({ cache, eventBus });
    const calls: string[] = [];
    runner.setAuditExecutor(async (path, content, partition) => {
        calls.push(`${path}:${content}:${partition.activeDomains.join(',')}`);
        return [];
    });
    return { runner, calls, cache, eventBus };
}

async function review(runner: SparseOrchestrator, content: string, config = options) {
    return runner.orchestrate([file], new Map([[file, content]]), config);
}

describe('sparse review cache generation', () => {
    it('distinguishes polynomial collisions and exact UTF-16 strings', () => {
        expect(computeSimpleContentHash('Aa')).not.toBe(computeSimpleContentHash('BB'));
        expect(computeSimpleContentHash('\ud800')).not.toBe(computeSimpleContentHash('\ud801'));
    });

    it('does not reuse findings for a different source with a legacy hash collision', async () => {
        const { runner, calls } = scheduler();
        await review(runner, 'Aa');
        const count = calls.length;
        expect(count).toBeGreaterThan(0);
        await review(runner, 'BB');
        expect(calls.length).toBeGreaterThan(count);
    });

    it('does not cache an opaque executor without its analysis generation', async () => {
        const { runner, calls } = scheduler();
        await review(runner, 'export const value = 1;', { enableSecondaryCheck: false });
        const count = calls.length;
        await review(runner, 'export const value = 1;', { enableSecondaryCheck: false });
        expect(calls.length).toBeGreaterThan(count);
    });

    it('reuses an identical versioned run, then invalidates configuration changes', async () => {
        const { runner, calls } = scheduler();
        await review(runner, 'export const value = 1;');
        const count = calls.length;
        const repeated = await review(runner, 'export const value = 1;');
        expect(calls).toHaveLength(count);
        expect(repeated.cacheHits).toBeGreaterThan(0);
        await review(runner, 'export const value = 1;', { ...options, analysisGeneration: 'config-v2' });
        expect(calls.length).toBeGreaterThan(count);
    });

    it('invalidates unchanged local bytes when another workspace file changes', async () => {
        const { runner, calls } = scheduler();
        const inputs = new Map([[file, 'export const value = 1;'], ['src/dependency.ts', 'first']]);
        await runner.orchestrate([file], inputs, options);
        const count = calls.length;
        inputs.set('src/dependency.ts', 'second');
        await runner.orchestrate([file], inputs, options);
        expect(calls.length).toBeGreaterThan(count);
    });

    it('replays cascade triggers on a cache hit without counting prior request events', async () => {
        const { runner, calls, eventBus } = scheduler();
        let dispatched = 0;
        eventBus.subscribe('*', () => { dispatched++; });
        const content = '// Pure Utility\nexport function update() { this.state = 1; }';
        const first = await review(runner, content);
        const count = calls.length;
        expect(first.cascadeEventCount).toBeGreaterThan(0);
        expect(dispatched).toBe(first.cascadeEventCount);
        const second = await review(runner, content);
        expect(calls).toHaveLength(count);
        expect(dispatched).toBe(first.cascadeEventCount * 2);
        expect(second.cascadeEventCount).toBe(first.cascadeEventCount);
        const clean = await review(runner, 'export const value = 1;');
        expect(clean.cascadeEventCount).toBe(0);
    });

    it('invalidates a changed domain partition without borrowing another domain result', async () => {
        const { runner, calls } = scheduler();
        await review(runner, 'export const value = 1;', { ...options, enabledDomains: ['ARCHITECTURE'] });
        const count = calls.length;
        expect(count).toBeGreaterThan(0);
        await review(runner, 'export const value = 1;', { ...options, enabledDomains: ['SECURITY_AND_SECRETS'] });
        expect(calls.length).toBeGreaterThan(count);
    });

    it('detaches cached entries from callers and remains bounded across generations', async () => {
        const { runner, cache } = scheduler();
        await review(runner, 'export const value = 1;');
        const entry = cache.getAllEntries()[0];
        const original = entry.role;
        entry.role = 'mutated' as typeof entry.role;
        const retained = cache.get(file, entry.contentHash, entry.contextHash)!;
        expect(retained.role).toBe(original);
        retained.contentHash = 'mutated';
        expect(cache.get(file, entry.contentHash, entry.contextHash)?.contentHash).toBe(entry.contentHash);
        for (let index = 0; index < 2001; index++) {
            cache.set({ ...retained, contextHash: `generation-${index}` });
        }
        expect(cache.getMetrics().size).toBe(2000);
        expect(cache.get(file, retained.contentHash, 'generation-0')).toBeUndefined();
    });

    it('captures source, options and the executor before asynchronous work', async () => {
        const { runner } = scheduler();
        let started!: () => void;
        let release!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        const pending = new Promise<void>(resolve => { release = resolve; });
        const observed: string[] = [];
        runner.setAuditExecutor(async (_path, content) => {
            observed.push(content);
            if (observed.length === 1) { started(); await pending; }
            return [];
        });
        const inputs = new Map([[file, 'first'], ['src/other-service.ts', 'second']]);
        const config = { ...options };
        const running = runner.orchestrate([...inputs.keys()], inputs, config);
        await entered;
        inputs.set('src/other-service.ts', 'changed');
        config.analysisGeneration = 'changed';
        let replacementCalls = 0;
        runner.setAuditExecutor(async () => { replacementCalls++; return []; });
        release();
        await running;
        expect(observed.sort()).toEqual(['first', 'second']);
        expect(replacementCalls).toBe(0);
        await runner.orchestrate([...inputs.keys()], inputs, config);
        expect(replacementCalls).toBeGreaterThan(0);
    });

    it('rejects missing source rather than treating it as an empty file', async () => {
        const { runner, calls } = scheduler();
        await expect(runner.orchestrate([file], new Map(), options)).rejects.toThrow('Missing review input');
        expect(calls).toHaveLength(0);
        await expect(review(runner, '')).resolves.toMatchObject({ totalFiles: 1 });
        expect(calls.length).toBeGreaterThan(0);
    });

    it('releases its agent lease when the executor rejects', async () => {
        const gateway = new AgentQuotaGateway();
        const runner = new SparseOrchestrator({ quotaGateway: gateway });
        const failure = new Error('audit failed');
        runner.setAuditExecutor(async () => { throw failure; });
        await expect(review(runner, 'source', { ...options, agentUid: 'executor-failure' }))
            .rejects.toBe(failure);
        expect(gateway.getMetrics('executor-failure')).toMatchObject({ activeLeases: 0, totalGranted: 1 });
    });

    it('preserves listener error isolation and releases the successful lease', async () => {
        const gateway = new AgentQuotaGateway();
        const eventBus = new ReviewEventBus();
        const runner = new SparseOrchestrator({ quotaGateway: gateway, eventBus });
        const failure = new Error('listener failed');
        eventBus.subscribe('*', () => { throw failure; });
        runner.setAuditExecutor(async () => []);
        const source = '// Pure Utility\nexport function update() { this.state = 1; }';
        await expect(review(runner, source, { ...options, agentUid: 'listener-failure' }))
            .resolves.toMatchObject({ cascadeEventCount: 1 });
        expect(gateway.getMetrics('listener-failure')).toMatchObject({ activeLeases: 0, totalGranted: 1 });
    });

    it('does not reuse another orchestrator or executor publication', async () => {
        const cache = new ReviewContextCache();
        const first = scheduler(cache);
        await review(first.runner, 'export const value = 1;');
        const second = scheduler(cache);
        await review(second.runner, 'export const value = 1;');
        expect(second.calls.length).toBeGreaterThan(0);
        let replacementCalls = 0;
        second.runner.setAuditExecutor(async () => { replacementCalls++; return []; });
        await review(second.runner, 'export const value = 1;');
        expect(replacementCalls).toBeGreaterThan(0);
    });
});
