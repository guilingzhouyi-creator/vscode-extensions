#!/usr/bin/env node
/**
 * Module: Verification Harness — Scope Graph Engine (Phase 1)
 * File Path: scripts/validate-scope-graph.js
 * Architecture Role: Integration suite that locks the scope graph builder and query API:
 *     scope boundaries (module / function / class), binding recording, lookup across the
 *     parent chain, shadow detection, position-based scope lookup, and cross-language support
 *     (TypeScript + Python).
 * Dependencies & Triggers: `node scripts/validate-scope-graph.js`; imports
 *     ../dist/core/ast/scope-graph (buildScopeGraph, ScopeGraph), plus TypeScriptAdapter
 *     and PythonAdapter from dist.
 * Responsibilities: Assert scope tree structure; assert binding kinds and ownership;
 *     assert lookup walks the parent chain correctly; assert isShadowed detects name hiding;
 *     assert getScopeAtLine finds the innermost scope; assert scopeCount / bindingCount;
 *     assert Python adapter yields a valid scope graph.
 * Exit Semantics & Design Rationale: Rejects on first failed assertion and exits 1 so CI
 *     fails loudly. Uses real parsed ASTs (not synthetic nodes) to guard against adapter
 *     flag drift. Both TypeScript and Python adapters are exercised to keep the scope graph
 *     language-agnostic as designed.
 */
'use strict';

const assert = require('assert');
const { buildScopeGraph } = require('../dist/core/ast/scope-graph');
const { TypeScriptAdapter } = require('../dist/core/ast/typescript-adapter');
const { PythonAdapter } = require('../dist/core/ast/python-adapter');

const tsAdapter = new TypeScriptAdapter();
const pyAdapter = new PythonAdapter();

let passCount = 0;

/**
 * Helper: build a scope graph from TypeScript source.
 *
 * @param {string} source - TS/JS source code.
 * @returns {import('../dist/core/ast/scope-graph').ScopeGraph}
 */
function buildTS(source) {
    const ast = tsAdapter.parse(source, 'test.ts');
    return buildScopeGraph(tsAdapter, tsAdapter.root(ast));
}

/**
 * Helper: build a scope graph from Python source.
 *
 * @param {string} source - Python source code.
 * @returns {import('../dist/core/ast/scope-graph').ScopeGraph}
 */
function buildPy(source) {
    const ast = pyAdapter.parse(source, 'test.py');
    return buildScopeGraph(pyAdapter, pyAdapter.root(ast));
}

// ─── Test 1: Module scope exists ──────────────────────────────────────
function testModuleScope() {
    const graph = buildTS('const x = 1;\n');
    const root = graph.getRoot();
    assert.ok(root, 'root scope must exist');
    assert.strictEqual(root.kind, 'module', 'root scope must be module kind');
    assert.strictEqual(root.parent, null, 'root scope has no parent');
    assert.ok(graph.scopeCount >= 1, 'at least one scope (module)');
    passCount++;
    console.log('  [PASS] module scope exists with correct kind and null parent');
}

// ─── Test 2: Function scope creation ─────────────────────────────────
function testFunctionScope() {
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
    const root = graph.getRoot();

    // Module scope should have "outer" as a function binding
    assert.ok(root.bindings.has('outer'), 'module scope has "outer" binding');
    const outerBinding = root.bindings.get('outer');
    assert.strictEqual(outerBinding.kind, 'function', '"outer" is a function binding');
    assert.strictEqual(outerBinding.scope, root, '"outer" belongs to module scope');

    // Module scope should have one child (the outer function scope)
    assert.strictEqual(root.children.length, 1, 'module has one child scope');
    const fnScope = root.children[0];
    assert.strictEqual(fnScope.kind, 'function', 'child is a function scope');
    assert.strictEqual(fnScope.parent, root, 'function scope parent is module');

    // Function scope should have "x" and "inner" bindings
    assert.ok(fnScope.bindings.has('x'), 'function scope has "x" binding');
    assert.strictEqual(fnScope.bindings.get('x').kind, 'variable', '"x" is a variable (TS maps all decls to Variable)');
    assert.ok(fnScope.bindings.has('inner'), 'function scope has "inner" binding');
    assert.strictEqual(fnScope.bindings.get('inner').kind, 'function', '"inner" is a function');

    // Inner function scope exists
    assert.strictEqual(fnScope.children.length, 1, 'outer function has one child scope');
    const innerScope = fnScope.children[0];
    assert.strictEqual(innerScope.kind, 'function', 'inner is a function scope');

    passCount++;
    console.log('  [PASS] function scopes are created with correct bindings and parent chain');
}

// ─── Test 3: Class scope creation ────────────────────────────────────
function testClassScope() {
    const source = [
        'class MyClass {',
        '  method() {',
        '    const x = 1;',
        '  }',
        '}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();

    // Module scope has "MyClass" class binding
    assert.ok(root.bindings.has('MyClass'), 'module has "MyClass" binding');
    assert.strictEqual(root.bindings.get('MyClass').kind, 'class', '"MyClass" is a class binding');

    // Class scope exists as child of module
    assert.strictEqual(root.children.length, 1, 'module has one child (class)');
    const classScope = root.children[0];
    assert.strictEqual(classScope.kind, 'class', 'child is a class scope');
    assert.strictEqual(classScope.parent, root, 'class scope parent is module');

    passCount++;
    console.log('  [PASS] class scopes are created with correct kind and binding');
}

// ─── Test 4: lookup — current scope ──────────────────────────────────
function testLookupCurrentScope() {
    const source = [
        'const top = 1;',
        'function foo() {',
        '  const inner = 2;',
        '}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();
    const fnScope = root.children[0];

    // Lookup from function scope: "inner" found locally
    const innerResult = graph.lookup('inner', fnScope);
    assert.ok(innerResult.binding, 'lookup finds "inner" from function scope');
    assert.strictEqual(innerResult.binding.name, 'inner');
    assert.strictEqual(innerResult.binding.kind, 'variable');
    assert.strictEqual(innerResult.binding.scope, fnScope, '"inner" belongs to function scope');
    assert.strictEqual(innerResult.all.length, 1, 'only one "inner" binding');
    assert.strictEqual(innerResult.shadowed, false, 'not shadowed');

    passCount++;
    console.log('  [PASS] lookup finds bindings in the current (local) scope');
}

// ─── Test 5: lookup — parent scope (walk up) ─────────────────────────
function testLookupParentScope() {
    const source = [
        'const top = 1;',
        'function foo() {',
        '  const inner = 2;',
        '}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();
    const fnScope = root.children[0];

    // Lookup from function scope: "top" found in parent (module) scope
    const topResult = graph.lookup('top', fnScope);
    assert.ok(topResult.binding, 'lookup finds "top" from function scope via parent');
    assert.strictEqual(topResult.binding.name, 'top');
    assert.strictEqual(topResult.binding.scope, root, '"top" belongs to module scope');
    assert.strictEqual(topResult.all.length, 1);
    assert.strictEqual(topResult.shadowed, false);

    passCount++;
    console.log('  [PASS] lookup walks up the parent chain to find outer-scope bindings');
}

// ─── Test 6: lookup — not found ──────────────────────────────────────
function testLookupNotFound() {
    const source = 'const x = 1;\n';
    const graph = buildTS(source);
    const root = graph.getRoot();

    const result = graph.lookup('nonexistent', root);
    assert.strictEqual(result.binding, null, 'lookup returns null for unknown name');
    assert.deepStrictEqual(result.all, [], 'all array is empty');
    assert.strictEqual(result.shadowed, false, 'not shadowed when not found');

    passCount++;
    console.log('  [PASS] lookup returns null / empty for nonexistent names');
}

// ─── Test 7: isShadowed — shadowed variable ──────────────────────────
function testShadowedVariable() {
    const source = [
        'const x = 1;',
        'function foo() {',
        '  const x = 2;',
        '}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();
    const fnScope = root.children[0];

    // From function scope, "x" is shadowed (exists in both function and module)
    assert.strictEqual(graph.isShadowed('x', fnScope), true, '"x" is shadowed from function scope');

    const result = graph.lookup('x', fnScope);
    assert.strictEqual(result.all.length, 2, 'two "x" bindings in the chain');
    assert.strictEqual(result.all[0].scope, fnScope, 'first (closest) is function scope');
    assert.strictEqual(result.all[1].scope, root, 'second is module scope');

    // From module scope, "x" is NOT shadowed (only one binding)
    assert.strictEqual(graph.isShadowed('x', root), false, '"x" is not shadowed from module scope');

    passCount++;
    console.log('  [PASS] isShadowed detects name hiding across scope boundaries');
}

// ─── Test 8: isShadowed — not shadowed ───────────────────────────────
function testNotShadowed() {
    const source = [
        'const x = 1;',
        'function foo() {',
        '  const y = 2;',
        '}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();
    const fnScope = root.children[0];

    assert.strictEqual(graph.isShadowed('y', fnScope), false, '"y" is not shadowed (only local)');
    assert.strictEqual(graph.isShadowed('x', fnScope), false, '"x" is not shadowed (only outer)');

    passCount++;
    console.log('  [PASS] isShadowed returns false when there is only one binding in the chain');
}

// ─── Test 9: getScopeAtLine ──────────────────────────────────────────
function testGetScopeAtLine() {
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
    const root = graph.getRoot();
    const outerScope = root.children[0];
    const innerScope = outerScope.children[0];

    // Line 1 → module scope
    const line1 = graph.getScopeAtLine(1);
    assert.strictEqual(line1.kind, 'module', 'line 1 is in module scope');

    // Line 3 → outer function scope
    const line3 = graph.getScopeAtLine(3);
    assert.strictEqual(line3.kind, 'function', 'line 3 is in function scope');
    assert.strictEqual(line3, outerScope, 'line 3 is in outer function');

    // Line 5 → inner function scope (innermost)
    const line5 = graph.getScopeAtLine(5);
    assert.strictEqual(line5.kind, 'function', 'line 5 is in function scope');
    assert.strictEqual(line5, innerScope, 'line 5 is in inner function (innermost)');

    passCount++;
    console.log('  [PASS] getScopeAtLine finds the innermost scope containing a line');
}

// ─── Test 10: scopeCount and bindingCount ────────────────────────────
function testCounts() {
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
    assert.strictEqual(graph.scopeCount, 5, 'expected 5 scopes: module, f1, f2, Cls, method');

    // Bindings in module: a, f1, Cls = 3
    // Bindings in f1: b, f2 = 2
    // Bindings in f2: c = 1
    // Bindings in Cls: method = 1
    // Bindings in method: d = 1
    // Total = 3 + 2 + 1 + 1 + 1 = 8
    assert.strictEqual(graph.bindingCount, 8, 'expected 8 total bindings');

    passCount++;
    console.log('  [PASS] scopeCount and bindingCount report correct totals');
}

// ─── Test 11: Python adapter support ─────────────────────────────────
function testPythonScope() {
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
    const root = graph.getRoot();

    assert.ok(root, 'Python module scope exists');
    assert.strictEqual(root.kind, 'module', 'root is module scope');
    assert.ok(graph.scopeCount >= 3, 'at least 3 scopes (module, outer, class)');

    // Module should have some bindings (x, outer, MyClass)
    assert.ok(root.bindings.size > 0, 'module scope has bindings');

    // Lookup "outer" (function) from module scope
    const outerResult = graph.lookup('outer', root);
    assert.ok(outerResult.binding, 'lookup finds "outer" function in Python module');

    passCount++;
    console.log('  [PASS] Python adapter yields a valid scope graph with module + function + class');
}

// ─── Test 12: Shadow detection in Python ─────────────────────────────
function testPythonShadow() {
    const source = [
        'x = 1',
        'def foo():',
        '    x = 2',
        '',
    ].join('\n');
    const graph = buildPy(source);
    const root = graph.getRoot();

    // Find the function scope
    const fnScope = root.children.find((s) => s.kind === 'function');
    assert.ok(fnScope, 'function scope exists');

    // "x" should be shadowed
    assert.strictEqual(graph.isShadowed('x', fnScope), true, '"x" is shadowed in Python function');

    const result = graph.lookup('x', fnScope);
    assert.strictEqual(result.all.length, 2, 'two "x" bindings in Python scope chain');

    passCount++;
    console.log('  [PASS] shadow detection works with Python adapter');
}

// ─── Test 13: Deep nesting and multi-level lookup ────────────────────
function testDeepNesting() {
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
    const root = graph.getRoot();
    const scopeA = root.children[0];
    const scopeB = scopeA.children[0];
    const scopeC = scopeB.children[0];

    // From innermost (c), lookup "x" should find 4 bindings (c, b, a, module)
    const result = graph.lookup('x', scopeC);
    assert.strictEqual(result.all.length, 4, 'four "x" bindings across 4 levels');
    assert.strictEqual(result.shadowed, true, 'heavily shadowed');
    assert.strictEqual(result.binding.scope, scopeC, 'closest binding is in c');
    assert.strictEqual(result.all[1].scope, scopeB, 'second is in b');
    assert.strictEqual(result.all[2].scope, scopeA, 'third is in a');
    assert.strictEqual(result.all[3].scope, root, 'fourth is in module');

    passCount++;
    console.log('  [PASS] deep nesting: lookup walks all parent levels correctly');
}

// ─── Test 14: Performance sanity check ───────────────────────────────
function testPerformance() {
    // Build a ~1000 line file and measure build time
    const lines = [];
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
    // ~50 functions * (2 header + 10 body + 1 close) = ~650 lines + top0 = ~651

    const start = Date.now();
    const graph = buildTS(source);
    const elapsed = Date.now() - start;

    assert.ok(graph.scopeCount > 0, 'scope graph is built');
    assert.ok(graph.bindingCount > 0, 'bindings are recorded');
    // 1000-line file should build in well under 100ms even on slow machines;
    // the design target is <1ms but we use a generous threshold for CI stability.
    assert.ok(elapsed < 100, `scope graph build took ${elapsed}ms (should be < 100ms)`);

    passCount++;
    console.log(`  [PASS] performance: ${graph.scopeCount} scopes / ${graph.bindingCount} bindings built in ${elapsed}ms`);
}

// ─── Test 15: Binding kinds (adapter-dependent distinction) ─────────
function testBindingKinds() {
    const source = [
        'const C = 1;',
        'let v = 2;',
        'function f() {}',
        'class K {}',
        '',
    ].join('\n');
    const graph = buildTS(source);
    const root = graph.getRoot();

    // TypeScript adapter maps all variable declarations (const/let/var) to Variable kind.
    // The constant-vs-variable distinction is adapter-dependent.
    assert.strictEqual(root.bindings.get('C').kind, 'variable', 'const → variable binding in TS');
    assert.strictEqual(root.bindings.get('v').kind, 'variable', 'let → variable binding in TS');
    assert.strictEqual(root.bindings.get('f').kind, 'function', 'function → function binding');
    assert.strictEqual(root.bindings.get('K').kind, 'class', 'class → class binding');

    passCount++;
    console.log('  [PASS] binding kinds correctly distinguish variable / function / class');
}

// ─── Run all tests ───────────────────────────────────────────────────
function run() {
    console.log('Scope Graph (Phase 1) validation\n');

    testModuleScope();
    testFunctionScope();
    testClassScope();
    testLookupCurrentScope();
    testLookupParentScope();
    testLookupNotFound();
    testShadowedVariable();
    testNotShadowed();
    testGetScopeAtLine();
    testCounts();
    testPythonScope();
    testPythonShadow();
    testDeepNesting();
    testPerformance();
    testBindingKinds();

    console.log(`\n ALL ${passCount} SCOPE-GRAPH CHECKS PASSED SUCCESSFULLY!`);
}

run();
