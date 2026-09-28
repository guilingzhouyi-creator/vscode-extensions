/**
 * Module: Unit Tests — Layer 1 Universal Rules
 * File Path: tests/unit/layer1-rules.test.ts
 * Architecture Role: Proves the Layer 1 universal rules actually fire. The three performance
 *     rules in `pyramid/performanceRules.ts` previously returned an empty array from
 *     `evaluate()` unconditionally while still being registered with
 *     `UniversalPyramidEvaluator`, so the layer reported itself as covering five rules while
 *     three of them could never produce a finding. Each rule therefore needs both a positive
 *     case (a violation that must be reported) and a negative case (clean code that must not
 *     be), which is the evidence that the delegation is wired rather than silently empty.
 * Test Type: Unit test (rule evaluation over fixture sources)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    LoopTransientAllocationRule,
    HighAlgorithmicComplexityRule,
    ExpensiveLoopOperationRule,
} from '../../src/core/rules/pyramid/performanceRules';
import { SemanticGraph } from '../../src/core/semantic/semanticGraph';

let dir: string;

/**
 * A real (empty) graph: the cycle and clean-architecture rules call `findCycles` and
 * `getLayer` on it, so a hand-rolled object would not satisfy their contract.
 *
 * @returns A fresh empty graph.
 */
function emptyGraph(): SemanticGraph {
    return new SemanticGraph();
}

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-layer1-'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a fixture file and return its path.
 *
 * @param name - File name inside the temp directory.
 * @param content - Source text.
 * @returns Absolute path to the written file.
 */
function fixture(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content, 'utf8');
    return path;
}

describe('Layer 1 loop transient allocation', () => {
    const rule = new LoopTransientAllocationRule();

    it('reports an allocation constructed inside a loop body', () => {
        // The detector matches `new` expressions and spread array literals, so the fixture
        // has to construct through `new` rather than an object literal.
        const path = fixture(
            'alloc-positive.ts',
            `class Item {
    constructor(public id: string) {}
}

export function build(ids: string[]): string[] {
    const out: string[] = [];
    for (const id of ids) {
        const item = new Item(id);
        out.push(item.id);
    }
    return out;
}
`,
        );
        const issues = rule.evaluate(emptyGraph(), { currentFilePath: path });
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].rule).toBe('loop-transient-allocation');
    });

    it('reports nothing when the allocation is hoisted out of the loop', () => {
        const path = fixture(
            'alloc-negative.ts',
            `export function build(ids: string[]): string[] {
    const out: string[] = [];
    const item = { id: '' };
    for (const id of ids) {
        item.id = id;
        out.push(item.id);
    }
    return out;
}
`,
        );
        expect(rule.evaluate(emptyGraph(), { currentFilePath: path })).toEqual([]);
    });

    it('returns nothing when the context names no file', () => {
        expect(rule.evaluate(emptyGraph(), {})).toEqual([]);
    });

    it('returns nothing rather than throwing for an unreadable path', () => {
        expect(
            rule.evaluate(emptyGraph(), { currentFilePath: join(dir, 'does-not-exist.ts') }),
        ).toEqual([]);
    });
});

describe('Layer 1 high algorithmic complexity', () => {
    const rule = new HighAlgorithmicComplexityRule();

    it('reports a nested loop that implies quadratic work', () => {
        const path = fixture(
            'complexity-positive.ts',
            `export function pairs(rows: number[][]): number {
    let total = 0;
    for (const row of rows) {
        for (const cell of row) {
            total += cell;
        }
    }
    return total;
}
`,
        );
        const issues = rule.evaluate(emptyGraph(), { currentFilePath: path });
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].rule).toBe('high-algorithmic-complexity');
    });

    it('reports nothing for a single loop', () => {
        const path = fixture(
            'complexity-negative.ts',
            `export function total(values: number[]): number {
    let sum = 0;
    for (const value of values) {
        sum += value;
    }
    return sum;
}
`,
        );
        expect(rule.evaluate(emptyGraph(), { currentFilePath: path })).toEqual([]);
    });
});

describe('Layer 1 expensive operation inside loop', () => {
    const rule = new ExpensiveLoopOperationRule();

    it('reports a deep copy constructed inside a loop', () => {
        const path = fixture(
            'expensive-positive.ts',
            `export function cloneAll(nodes: object[]): object[] {
    const out: object[] = [];
    for (const node of nodes) {
        out.push(JSON.parse(JSON.stringify(node)));
    }
    return out;
}
`,
        );
        const issues = rule.evaluate(emptyGraph(), { currentFilePath: path });
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].rule).toBe('expensive-loop-operation');
    });

    it('reports nothing when no expensive call appears in a loop', () => {
        const path = fixture(
            'expensive-negative.ts',
            `export function lengths(words: string[]): number[] {
    const out: number[] = [];
    for (const word of words) {
        out.push(word.length);
    }
    return out;
}
`,
        );
        expect(rule.evaluate(emptyGraph(), { currentFilePath: path })).toEqual([]);
    });
});

describe('Layer 1 evaluator registration', () => {
    it('runs all five universal rules without an analyzer error', async () => {
        const { UniversalPyramidEvaluator } =
            await import('../../src/core/rules/pyramid/layer1Evaluator');
        const evaluator = new UniversalPyramidEvaluator();
        const path = fixture(
            'evaluator.ts',
            `export function scan(rows: number[][]): number {
    let total = 0;
    for (const row of rows) {
        for (const cell of row) {
            const copy = { cell };
            total += copy.cell;
        }
    }
    return total;
}
`,
        );
        const issues = evaluator.evaluateAllLayer1(emptyGraph(), { currentFilePath: path });
        expect(Array.isArray(issues)).toBe(true);
    });
});
