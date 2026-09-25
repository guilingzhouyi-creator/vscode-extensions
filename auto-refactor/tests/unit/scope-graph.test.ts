/**
 * Module: Unit Tests — Scope Graph Engine
 * File Path: tests/unit/scope-graph.test.ts
 * Architecture Role: Unit test suite for the scope graph builder and query API:
 *     scope boundaries (module / function / class), binding recording, lookup across
 *     the parent chain, shadow detection, position-based scope lookup, and cross-language
 *     support (TypeScript + Python).
 * Migrated from: scripts/validate-scope-graph.js
 * Test Type: Unit test (data structure + algorithm)
 */
import { describe, it, expect } from 'vitest';
import { buildScopeGraph, type ScopeGraph } from '../../src/core/ast/scope-graph';
import { TypeScriptAdapter } from '../../src/core/ast/typescript-adapter';
import { PythonAdapter } from '../../src/core/ast/python-adapter';

const tsAdapter = new TypeScriptAdapter();
const pyAdapter = new PythonAdapter();

/**
 * Helper: build a scope graph from TypeScript source.
 */
function buildTS(source: string): ScopeGraph {
    const ast = tsAdapter.parse(source, 'test.ts');
    return buildScopeGraph(tsAdapter, tsAdapter.root(ast));
}

/**
 * Helper: build a scope graph from Python source.
 */
function buildPy(source: string): ScopeGraph {
    const ast = pyAdapter.parse(source, 'test.py');
    return buildScopeGraph(pyAdapter, pyAdapter.root(ast));
}

describe('ScopeGraph', () => {
    describe('scope structure', () => {
        it('module scope exists with correct kind and null parent', () => {
            const graph = buildTS('const x = 1;\n');
            const root = graph.getRoot()!;
            expect(root).toBeTruthy();
            expect(root.kind).toBe('module');
            expect(root.parent).toBeNull();
            expect(graph.scopeCount).toBeGreaterThanOrEqual(1);
        });

        it('function scopes are created with correct bindings and parent chain', () => {
            const source = [
                'function outer() {',
                '  const x = 1;',
                '  function inner() {',
                '    const y = 2;',
                '  }',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;

            // Module scope should have "outer" as a function binding
            expect(root.bindings.has('outer')).toBe(true);
            const outerBinding = root.bindings.get('outer');
            expect(outerBinding!.kind).toBe('function');
            expect(outerBinding!.scope).toBe(root);

            // Module scope should have one child (the outer function scope)
            expect(root.children.length).toBe(1);
            const fnScope = root.children[0];
            expect(fnScope.kind).toBe('function');
            expect(fnScope.parent).toBe(root);

            // Function scope should have "x" and "inner" bindings
            expect(fnScope.bindings.has('x')).toBe(true);
            expect(fnScope.bindings.get('x')!.kind).toBe('variable');
            expect(fnScope.bindings.has('inner')).toBe(true);
            expect(fnScope.bindings.get('inner')!.kind).toBe('function');

            // Inner function scope exists
            expect(fnScope.children.length).toBe(1);
            const innerScope = fnScope.children[0];
            expect(innerScope.kind).toBe('function');
        });

        it('class scopes are created with correct kind and binding', () => {
            const source = [
                'class MyClass {',
                '  method() {',
                '    const x = 1;',
                '  }',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;

            // Module scope has "MyClass" class binding
            expect(root.bindings.has('MyClass')).toBe(true);
            expect(root.bindings.get('MyClass')!.kind).toBe('class');

            // Class scope exists as child of module
            expect(root.children.length).toBe(1);
            const classScope = root.children[0];
            expect(classScope.kind).toBe('class');
            expect(classScope.parent).toBe(root);
        });
    });

    describe('lookup', () => {
        it('finds bindings in the current (local) scope', () => {
            const source = [
                'const top = 1;',
                'function foo() {',
                '  const inner = 2;',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const fnScope = root.children[0];

            const innerResult = graph.lookup('inner', fnScope);
            expect(innerResult.binding).toBeTruthy();
            expect(innerResult.binding!.name).toBe('inner');
            expect(innerResult.binding!.kind).toBe('variable');
            expect(innerResult.binding!.scope).toBe(fnScope);
            expect(innerResult.all.length).toBe(1);
            expect(innerResult.shadowed).toBe(false);
        });

        it('walks up the parent chain to find outer-scope bindings', () => {
            const source = [
                'const top = 1;',
                'function foo() {',
                '  const inner = 2;',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const fnScope = root.children[0];

            const topResult = graph.lookup('top', fnScope);
            expect(topResult.binding).toBeTruthy();
            expect(topResult.binding!.name).toBe('top');
            expect(topResult.binding!.scope).toBe(root);
            expect(topResult.all.length).toBe(1);
            expect(topResult.shadowed).toBe(false);
        });

        it('returns null / empty for nonexistent names', () => {
            const source = 'const x = 1;\n';
            const graph = buildTS(source);
            const root = graph.getRoot()!;

            const result = graph.lookup('nonexistent', root);
            expect(result.binding).toBeNull();
            expect(result.all).toEqual([]);
            expect(result.shadowed).toBe(false);
        });
    });

    describe('shadow detection', () => {
        it('detects name hiding across scope boundaries', () => {
            const source = [
                'const x = 1;',
                'function foo() {',
                '  const x = 2;',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const fnScope = root.children[0];

            // From function scope, "x" is shadowed
            expect(graph.isShadowed('x', fnScope)).toBe(true);

            const result = graph.lookup('x', fnScope);
            expect(result.all.length).toBe(2);
            expect(result.all[0].scope).toBe(fnScope);
            expect(result.all[1].scope).toBe(root);

            // From module scope, "x" is NOT shadowed
            expect(graph.isShadowed('x', root)).toBe(false);
        });

        it('returns false when there is only one binding in the chain', () => {
            const source = [
                'const x = 1;',
                'function foo() {',
                '  const y = 2;',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const fnScope = root.children[0];

            expect(graph.isShadowed('y', fnScope)).toBe(false);
            expect(graph.isShadowed('x', fnScope)).toBe(false);
        });
    });

    describe('getScopeAtLine', () => {
        it('finds the innermost scope containing a line', () => {
            const source = [
                'const x = 1;',          // line 1
                'function outer() {',    // line 2
                '  const a = 1;',        // line 3
                '  function inner() {',  // line 4
                '    const b = 2;',      // line 5
                '  }',                   // line 6
                '}',                     // line 7
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const outerScope = root.children[0];
            const innerScope = outerScope.children[0];

            // Line 1 → module scope
            const line1 = graph.getScopeAtLine(1)!;
            expect(line1.kind).toBe('module');

            // Line 3 → outer function scope
            const line3 = graph.getScopeAtLine(3)!;
            expect(line3.kind).toBe('function');
            expect(line3).toBe(outerScope);

            // Line 5 → inner function scope (innermost)
            const line5 = graph.getScopeAtLine(5)!;
            expect(line5.kind).toBe('function');
            expect(line5).toBe(innerScope);
        });
    });

    describe('counts', () => {
        it('scopeCount and bindingCount report correct totals', () => {
            const source = [
                'const a = 1;',
                'function f1() {',
                '  const b = 2;',
                '  function f2() {',
                '    const c = 3;',
                '  }',
                '}',
                'class Cls {',
                '  method() {',
                '    const d = 4;',
                '  }',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);

            // Scopes: module + f1 + f2 + Cls + method = 5
            expect(graph.scopeCount).toBe(5);

            // Bindings: module(a, f1, Cls) + f1(b, f2) + f2(c) + Cls(method) + method(d) = 8
            expect(graph.bindingCount).toBe(8);
        });
    });

    describe('Python adapter', () => {
        it('yields a valid scope graph with module + function + class', () => {
            const source = [
                'x = 1',
                'def outer():',
                '    a = 2',
                '    def inner():',
                '        b = 3',
                '',
                'class MyClass:',
                '    def method(self):',
                '        c = 4',
                '',
            ].join('\n');
            const graph = buildPy(source);
            const root = graph.getRoot()!;

            expect(root).toBeTruthy();
            expect(root.kind).toBe('module');
            expect(graph.scopeCount).toBeGreaterThanOrEqual(3);

            // Module should have some bindings
            expect(root.bindings.size).toBeGreaterThan(0);

            // Lookup "outer" (function) from module scope
            const outerResult = graph.lookup('outer', root);
            expect(outerResult.binding).toBeTruthy();
        });

        it('shadow detection works with Python adapter', () => {
            const source = [
                'x = 1',
                'def foo():',
                '    x = 2',
                '',
            ].join('\n');
            const graph = buildPy(source);
            const root = graph.getRoot()!;

            const fnScope = root.children.find((s) => s.kind === 'function');
            expect(fnScope).toBeTruthy();

            expect(graph.isShadowed('x', fnScope!)).toBe(true);

            const result = graph.lookup('x', fnScope!);
            expect(result.all.length).toBe(2);
        });
    });

    describe('deep nesting', () => {
        it('lookup walks all parent levels correctly', () => {
            const source = [
                'const x = "module";',
                'function a() {',
                '  const x = "a";',
                '  function b() {',
                '    const x = "b";',
                '    function c() {',
                '      const x = "c";',
                '    }',
                '  }',
                '}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;
            const scopeA = root.children[0];
            const scopeB = scopeA.children[0];
            const scopeC = scopeB.children[0];

            const result = graph.lookup('x', scopeC);
            expect(result.all.length).toBe(4);
            expect(result.shadowed).toBe(true);
            expect(result.binding!.scope).toBe(scopeC);
            expect(result.all[1].scope).toBe(scopeB);
            expect(result.all[2].scope).toBe(scopeA);
            expect(result.all[3].scope).toBe(root);
        });
    });

    describe('performance', () => {
        it('builds scope graph for ~650-line file in under 100ms', () => {
            const lines: string[] = [];
            lines.push('const top0 = 0;');
            for (let i = 0; i < 50; i++) {
                lines.push(`function func${i}() {`);
                lines.push(`  const local${i} = ${i};`);
                for (let j = 0; j < 10; j++) {
                    lines.push(`  const v${i}_${j} = ${j};`);
                }
                lines.push('}');
            }
            const source = lines.join('\n');

            const start = Date.now();
            const graph = buildTS(source);
            const elapsed = Date.now() - start;

            expect(graph.scopeCount).toBeGreaterThan(0);
            expect(graph.bindingCount).toBeGreaterThan(0);
            expect(elapsed).toBeLessThan(100);
        });
    });

    describe('binding kinds', () => {
        it('correctly distinguishes variable / function / class', () => {
            const source = [
                'const C = 1;',
                'let v = 2;',
                'function f() {}',
                'class K {}',
                '',
            ].join('\n');
            const graph = buildTS(source);
            const root = graph.getRoot()!;

            expect(root.bindings.get('C')!.kind).toBe('variable');
            expect(root.bindings.get('v')!.kind).toBe('variable');
            expect(root.bindings.get('f')!.kind).toBe('function');
            expect(root.bindings.get('K')!.kind).toBe('class');
        });
    });
});
