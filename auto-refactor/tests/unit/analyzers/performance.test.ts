/**
 * Module: Unit Test — Performance Analyzer & Algorithmic Guard Validation
 * File Path: tests/unit/analyzers/performance.test.ts
 * Architecture Role: Exercises PerformanceAnalyzer loop linear lookup (.shift/.unshift)
 *   detection (PRF-ALG-002) and recursive depth guard whitelisting (CPX-REC-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports PerformanceAnalyzer,
 *   extractLinearLookupMethod, LINEAR_LOOKUP_RE, extractGuardedRecursiveSymbols,
 *   and detectUnboundedRecursion.
 * Responsibilities: Assert PRF-ALG-002 detection and suggestions for shift/unshift in loops;
 *   assert depth guard parameter extraction and suppression of CPX-REC-001 for guarded recursion.
 * Exit Semantics & Design Rationale: Standard Vitest suite; passes when all assertions hold.
 */

import { describe, it, expect } from 'vitest';
import { PerformanceAnalyzer } from '../../../src/analyzers/performance';
import {
    extractLinearLookupMethod,
    LINEAR_LOOKUP_RE,
} from '../../../src/analyzers/performance-helpers';
import {
    extractGuardedRecursiveSymbols,
    detectUnboundedRecursion,
    isGuardParameter,
} from '../../../src/core/intelligence/semanticComplexity';
import { SymbolIndex } from '../../../src/core/intelligence/symbolIndex';
import { CallGraph } from '../../../src/core/intelligence/callGraph';
import type { AnalyzerContext } from '../../../src/core/types';

describe('PerformanceAnalyzer - Array Shift/Unshift in Loops (PRF-ALG-002)', () => {
    const analyzer = new PerformanceAnalyzer();

    function createCtx(content: string): AnalyzerContext {
        return {
            filePath: 'src/buffer-queue.ts',
            content,
            options: { checkLinearLookups: true },
            config: {},
        };
    }

    it('matches .shift() and .unshift() in LINEAR_LOOKUP_RE', () => {
        expect(LINEAR_LOOKUP_RE.test('.shift()')).toBe(true);
        expect(LINEAR_LOOKUP_RE.test('.unshift(item)')).toBe(true);
        expect(extractLinearLookupMethod('items.shift()')).toBe('shift');
        expect(extractLinearLookupMethod('items.unshift(x)')).toBe('unshift');
    });

    it('detects array .shift() inside for loop and provides dedicated Deque/RingBuffer suggestion', () => {
        const code = [
            'export function drainQueue(queue: number[]): void {',
            '    for (let i = 0; i < 100; i++) {',
            '        const next = queue.shift();',
            '        console.log(next);',
            '    }',
            '}',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createCtx(code));
        const shiftIssues = issues.filter((i) => i.rule === 'PRF-ALG-002');

        expect(shiftIssues.length).toBe(1);
        expect(shiftIssues[0].severity).toBe('warning');
        expect(shiftIssues[0].detail.methodName).toBe('shift');
        expect(shiftIssues[0].suggestion).toBe(
            'Calling shift()/unshift() inside a loop causes O(N) array memory shifts per iteration, degrading to O(N^2). Use an index cursor or a Deque/RingBuffer.',
        );
    });

    it('detects array .unshift() inside while loop and provides dedicated Deque/RingBuffer suggestion', () => {
        const code = [
            'export function prependBatch(list: string[], batch: string[]): void {',
            '    let idx = 0;',
            '    while (idx < batch.length) {',
            '        list.unshift(batch[idx++]);',
            '    }',
            '}',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createCtx(code));
        const unshiftIssues = issues.filter((i) => i.rule === 'PRF-ALG-002');

        expect(unshiftIssues.length).toBe(1);
        expect(unshiftIssues[0].severity).toBe('warning');
        expect(unshiftIssues[0].detail.methodName).toBe('unshift');
        expect(unshiftIssues[0].suggestion).toBe(
            'Calling shift()/unshift() inside a loop causes O(N) array memory shifts per iteration, degrading to O(N^2). Use an index cursor or a Deque/RingBuffer.',
        );
    });

    it('retains standard Map/Set pre-indexing suggestion for .includes() and .find()', () => {
        const code = [
            'export function findUsers(ids: string[], all: any[]): void {',
            '    for (const id of ids) {',
            '        const found = all.find((u) => u.id === id);',
            '    }',
            '}',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createCtx(code));
        const findIssues = issues.filter((i) => i.rule === 'PRF-ALG-002');

        expect(findIssues.length).toBe(1);
        expect(findIssues[0].detail.methodName).toBe('find');
        expect(findIssues[0].suggestion).toContain('Pre-build a Map, Set, or Dictionary index outside the loop');
    });

    it('does not flag .push() or .pop() which have O(1) amortized complexity', () => {
        const code = [
            'export function pushPopBatch(queue: number[]): void {',
            '    for (let i = 0; i < 100; i++) {',
            '        queue.push(i);',
            '        queue.pop();',
            '    }',
            '}',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createCtx(code));
        const algIssues = issues.filter((i) => i.rule === 'PRF-ALG-002');

        expect(algIssues.length).toBe(0);
    });

    it('does not flag shift/unshift outside of loops', () => {
        const code = [
            'export function popFirst(queue: number[]): number | undefined {',
            '    return queue.shift();',
            '}',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createCtx(code));
        const algIssues = issues.filter((i) => i.rule === 'PRF-ALG-002');

        expect(algIssues.length).toBe(0);
    });
});

describe('Recursive Depth Termination Guard Whitelist (CPX-REC-001)', () => {
    it('correctly classifies depth guard parameter names', () => {
        expect(isGuardParameter('depth')).toBe(true);
        expect(isGuardParameter('depth: number')).toBe(true);
        expect(isGuardParameter('maxDepth')).toBe(true);
        expect(isGuardParameter('max_depth: int = 10')).toBe(true);
        expect(isGuardParameter('limit: number')).toBe(true);
        expect(isGuardParameter('level')).toBe(true);
        expect(isGuardParameter('maxLevel')).toBe(true);
        expect(isGuardParameter('currentDepth')).toBe(true);
        expect(isGuardParameter('recursionLimit')).toBe(true);

        expect(isGuardParameter('node')).toBe(false);
        expect(isGuardParameter('items: any[]')).toBe(false);
        expect(isGuardParameter('delimiter: string')).toBe(false);
    });

    it('extracts guarded recursive symbols when parameter contains depth guard', () => {
        const symbolIndex = new SymbolIndex();
        symbolIndex.addDefinitions([
            {
                name: 'guardedDfs',
                kind: 'function',
                file: 'src/algo.ts',
                line: 1,
                parameters: ['node: Node', 'depth: number'],
            } as any,
            {
                name: 'unguardedRecurse',
                kind: 'function',
                file: 'src/algo.ts',
                line: 10,
                parameters: ['node: Node'],
            } as any,
            {
                name: 'limitedWalk',
                kind: 'function',
                file: 'src/algo.ts',
                line: 20,
                parameters: ['node: Node', 'limit: number'],
            } as any,
        ]);

        symbolIndex.addReferences([
            { name: 'guardedDfs', file: 'src/algo.ts', line: 3, kind: 'call', caller: 'guardedDfs' },
            { name: 'unguardedRecurse', file: 'src/algo.ts', line: 12, kind: 'call', caller: 'unguardedRecurse' },
            { name: 'limitedWalk', file: 'src/algo.ts', line: 22, kind: 'call', caller: 'limitedWalk' },
        ]);

        const callGraph = new CallGraph(symbolIndex);
        const guarded = extractGuardedRecursiveSymbols(symbolIndex, callGraph);

        expect(guarded.has('guardedDfs')).toBe(true);
        expect(guarded.has('limitedWalk')).toBe(true);
        expect(guarded.has('unguardedRecurse')).toBe(false);
    });

    it('suppresses CPX-REC-001 finding for guarded recursive functions while flagging unguarded recursion', () => {
        const symbolIndex = new SymbolIndex();
        symbolIndex.addDefinitions([
            {
                name: 'guardedDfs',
                kind: 'function',
                file: 'src/algo.ts',
                line: 1,
                parameters: ['node: Node', 'depth: number'],
            } as any,
            {
                name: 'unguardedRecurse',
                kind: 'function',
                file: 'src/algo.ts',
                line: 10,
                parameters: ['node: Node'],
            } as any,
        ]);

        symbolIndex.addReferences([
            { name: 'guardedDfs', file: 'src/algo.ts', line: 3, kind: 'call', caller: 'guardedDfs' },
            { name: 'unguardedRecurse', file: 'src/algo.ts', line: 12, kind: 'call', caller: 'unguardedRecurse' },
        ]);

        const callGraph = new CallGraph(symbolIndex);
        const guarded = extractGuardedRecursiveSymbols(symbolIndex, callGraph);

        const issues = detectUnboundedRecursion(callGraph, guarded);

        // Unguarded recursion must be reported as CPX-REC-001 error
        const unguardedIssue = issues.find((i) => i.detail.symbol === 'unguardedRecurse');
        expect(unguardedIssue).toBeDefined();
        expect(unguardedIssue?.rule).toBe('CPX-REC-001');

        // Guarded recursion must be exempted (no issue emitted)
        const guardedIssue = issues.find((i) => i.detail.symbol === 'guardedDfs');
        expect(guardedIssue).toBeUndefined();
    });
});
