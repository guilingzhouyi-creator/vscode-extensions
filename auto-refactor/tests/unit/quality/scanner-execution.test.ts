/**
 * Module: Review — Actual Scanner Execution Tests
 * File Path: tests/unit/quality/scanner-execution.test.ts
 * Architecture Role: Verify observations originate at production analyzer calls.
 * Dependencies & Triggers: Vitest, compiled Scanner, real TypeScript/oxc parsing.
 * Responsibilities: Distinguish skipped, failed, degraded, and completed file analysis.
 * Exit Semantics & Design Rationale: Registration and zero diagnostics cannot establish execution.
 */
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileExecutionObserver } from '../../../src/core/review/analyzer-execution';
import { TypeScriptAdapter } from '../../../src/core/ast/typescript-adapter';
import type { LanguageAdapter } from '../../../src/core/ast/multilang';
import type { Scanner as ScannerType } from '../../../src/core/analyzer';
import type { Analyzer } from '../../../src/core/types';
import type { ResolvedAnalyzer } from '../../../src/core/analyzer-registry';
import { getDefaultConfig } from '../../../src/core/config/config';

const { Scanner } = createRequire(import.meta.url)('../../../dist/core/analyzer.js') as {
    Scanner: typeof ScannerType;
};
const content = 'export function value(input: number) { return input + 1; }';
function scanner(analyzer: Analyzer, parser: 'typescript' | 'oxc' = 'typescript') {
    const engine = new Scanner({
        ...getDefaultConfig(), root: process.cwd(), parser, cacheEnabled: false,
        archetype: 'library', logLevel: 'error', bypassPreflight: true,
    });
    const planItem: ResolvedAnalyzer = {
        name: 'complexity', instance: analyzer, factory: () => analyzer,
        options: {}, modulePath: 'test-owned-analyzer',
    };
    engine.plan = [planItem];
    return engine;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('actual per-file analyzer execution', () => {
    it('leaves the normal scan path without observation instrumentation', async () => {
        const finalize = vi.fn(() => []);
        const result = await scanner({ name: 'complexity', analyze: () => [], finalize })
            .runAnalyzers('a.ts', content);
        expect(finalize).toHaveBeenCalledTimes(1);
        expect(result.execution).toBeUndefined();
    });

    it('records completed streaming hooks and preserves their original receiver', async () => {
        const analyzer = {
            name: 'complexity', calls: 0,
            analyze: () => [],
            finalize() { this.calls++; return []; },
        };
        const result = await scanner(analyzer).runAnalyzers('a.ts', content, undefined, {
            observeExecution: true,
        });
        expect(analyzer.calls).toBe(1);
        expect(result.execution).toMatchObject({
            path: 'a.ts', parser: { status: 'complete', diagnostics: 0 },
            analyzers: [{ analyzer: 'complexity', status: 'complete', calls: 1 }],
        });
        expect(Object.isFrozen(result.execution!.analyzers[0])).toBe(true);
    });

    it('retains a routed-out required candidate as unexecuted', async () => {
        const finalize = vi.fn(() => []);
        const result = await scanner({ name: 'complexity', analyze: () => [], finalize })
            .runAnalyzers('a.ts', content, undefined, {
                observeExecution: true, activeAnalyzers: new Set(),
            });
        expect(finalize).not.toHaveBeenCalled();
        expect(result.execution!.analyzers).toMatchObject([
            { analyzer: 'complexity', status: 'not-run', calls: 0, reason: 'routing-filter' },
        ]);
    });

    it.each(['visit', 'finalize'] as const)('retains a swallowed %s exception as failed', async (hook) => {
        const failure = new Error('Observed hook failure');
        const analyzer = { name: 'complexity', analyze: () => [], [hook]: () => { throw failure; } };
        const result = await scanner(analyzer).runAnalyzers('a.ts', content, undefined, {
            observeExecution: true,
        });
        expect(result.execution!.analyzers[0]).toMatchObject({
            status: 'failed', failure: 'Observed hook failure',
        });
        expect(result.execution!.analyzers[0].calls).toBeGreaterThan(0);
    });

    it('records a preflight skip without granting an applicability exemption', async () => {
        const finalize = vi.fn(() => []);
        const engine = scanner({ name: 'complexity', analyze: () => [], finalize });
        engine.config.bypassPreflight = false;
        const result = await engine.runAnalyzers('a.ts', 'export const value = 1;', undefined, {
            observeExecution: true,
        });
        expect(finalize).not.toHaveBeenCalled();
        expect(result.execution!.analyzers[0]).toMatchObject({
            status: 'not-run', calls: 0, reason: 'file-preflight',
        });
    });

    it('records a successful batch analyzer call', async () => {
        const analyze = vi.fn(() => []);
        const result = await scanner({ name: 'complexity', analyze })
            .runAnalyzers('a.ts', content, undefined, { observeExecution: true });
        expect(analyze).toHaveBeenCalledTimes(1);
        expect(result.execution!.analyzers[0]).toMatchObject({ status: 'complete', calls: 1 });
    });

    it('retains a batch exception as failed', async () => {
        const analyze = () => { throw new TypeError('Missing required AST'); };
        const result = await scanner({ name: 'complexity', analyze })
            .runAnalyzers('a.ts', content, undefined, { observeExecution: true });
        expect(result.execution!.analyzers[0]).toMatchObject({
            status: 'failed', calls: 1, failure: 'Missing required AST',
        });
    });

    it.each([
        { parser: 'typescript', fast: '0' }, { parser: 'typescript', fast: '1' },
        { parser: 'oxc', fast: '0' }, { parser: 'oxc', fast: '1' },
    ] as const)('keeps $parser parse recovery partial with fast path $fast', async ({ parser, fast }) => {
        vi.stubEnv('AR_FASTPATH', fast);
        const result = await scanner({ name: 'complexity', analyze: () => [], finalize: () => [] }, parser)
            .runAnalyzers('a.ts', 'export function broken( {', undefined, { observeExecution: true });
        expect(result.execution!.parser.status).toBe('degraded');
        expect(result.execution!.parser.diagnostics).toBeGreaterThan(0);
        expect(result.execution!.analyzers[0]).toMatchObject({ status: 'partial', calls: 1 });
    });

    it('retains the batch TypeError that the non-native AST path normally suppresses', async () => {
        const analyze = () => { throw new TypeError('Native AST required'); };
        const result = await scanner({ name: 'complexity', analyze })
            .runAnalyzers('a.gd', 'extends Node\n', undefined, { observeExecution: true });
        expect(result.issues.some((issue) => issue.rule === 'analyzer-error')).toBe(false);
        expect(result.execution!.analyzers[0]).toMatchObject({
            status: 'failed', calls: 1, failure: 'Native AST required',
        });
    });

    it.each(['lexical', undefined] as const)('keeps precision %s incomplete despite no diagnostics', (precision) => {
        const native = new TypeScriptAdapter();
        const parsed = native.parse(content, 'a.ts');
        const adapter = Object.assign(Object.create(native) as LanguageAdapter, { precision });
        const result = new FileExecutionObserver('a.ts', []).finish(adapter, parsed, true);
        expect(result.parser.status).toBe(precision === 'lexical' ? 'degraded' : 'unavailable');
    });

    it('does not promote a line window into full-file execution coverage', async () => {
        const result = await scanner({ name: 'complexity', analyze: () => [], finalize: () => [] })
            .runAnalyzers('a.ts', content, undefined, {
                observeExecution: true, lineBounds: [1, 1],
            });
        expect(result.execution!.lineBounds).toEqual([1, 1]);
        expect(result.execution!.analyzers[0]).toMatchObject({
            status: 'partial', calls: 1, reason: 'line-window',
        });
    });

    it('keeps unsupported input incomplete when its diagnostic is disabled', async () => {
        const engine = scanner({ name: 'complexity', analyze: () => [], finalize: () => [] });
        engine.config.unsupportedLanguage = 'off';
        const result = await engine.runAnalyzers('a.unknown-fixture', content, undefined, {
            observeExecution: true,
        });
        expect(result.execution!.parser.status).toBe('unsupported');
        expect(result.execution!.analyzers[0].status).toBe('partial');
    });
});
