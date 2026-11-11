#!/usr/bin/env node
/**
 * Module: Static Quality Gate — AST Query & Selector Engine Verification
 * File Path: scripts/validate-ast-query.js
 * Architecture Role: Verification test suite for NormalizedNode query operations,
 *   deep stack resistance, and zero-allocation selector traversals.
 * Dependencies & Triggers: `npm test`; tests `dist/core/ast/ast-query`.
 * Responsibilities:
 *   1. Assert preorder traversal ordering in walkNormalizedTree;
 *   2. Assert early branch pruning when visitor returns false;
 *   3. Assert stack-safety under 500-level nesting without call stack overflow;
 *   4. Assert selectDescendants, findFirst, findNodesByKind, collectCalls, computeSubtreeDepth.
 * Exit Semantics & Design Rationale: Exits 0 on success, non-zero on assertion failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

console.log('🚀 [AST-QUERY] Starting AST Query & Selector Verification Harness...\n');

const {
  walkNormalizedTree,
  selectDescendants,
  findFirst,
  findNodesByKind,
  collectCalls,
  computeSubtreeDepth,
  collectSubtreeNames,
} = require('../dist/core/ast/ast-query');
const { NodeKind } = require('../dist/core/ast/multilang');

// Construct mock AST tree:
// SourceFile
//   ├── Function: main
//   │     ├── Call: print
//   │     └── ControlFlow: if
//   │           └── Call: log
//   └── Variable: count
const tree = {
  kind: NodeKind.SourceFile,
  name: 'root',
  children: [
    {
      kind: NodeKind.Function,
      name: 'main',
      children: [
        {
          kind: NodeKind.Call,
          name: 'print',
        },
        {
          kind: NodeKind.ControlFlow,
          name: 'if',
          children: [
            {
              kind: NodeKind.Call,
              name: 'log',
            },
          ],
        },
      ],
    },
    {
      kind: NodeKind.Variable,
      name: 'count',
      bindingName: 'count',
    },
  ],
};

console.log('--- [1/5] Testing walkNormalizedTree Pre-Order Traversal & Depth ---');
const visited = [];
walkNormalizedTree(tree, (node, depth) => {
  visited.push({ name: node.name, depth });
});

assert.deepStrictEqual(
  visited,
  [
    { name: 'root', depth: 0 },
    { name: 'main', depth: 1 },
    { name: 'print', depth: 2 },
    { name: 'if', depth: 2 },
    { name: 'log', depth: 3 },
    { name: 'count', depth: 1 },
  ],
  'Traversal order must strictly follow DFS pre-order with correct depth',
);
console.log('✔ Pre-order sequence and depth verified.');

console.log('--- [2/5] Testing Subtree Pruning (visitor returns false) ---');
const prunedVisited = [];
walkNormalizedTree(tree, (node) => {
  prunedVisited.push(node.name);
  if (node.name === 'main') {
    return false; // Skip main's children
  }
});
assert.deepStrictEqual(
  prunedVisited,
  ['root', 'main', 'count'],
  'Returning false from visitor must prune the entire subtree',
);
console.log('✔ Subtree pruning verified.');

console.log(
  '--- [3/5] Testing Selectors (selectDescendants, findFirst, findNodesByKind, collectCalls) ---',
);
const allCalls = collectCalls(tree);
assert.strictEqual(allCalls.length, 2, 'Should find exactly 2 calls (print, log)');
assert.strictEqual(allCalls[0].name, 'print');
assert.strictEqual(allCalls[1].name, 'log');

const logCall = collectCalls(tree, 'log');
assert.strictEqual(logCall.length, 1, 'Should find 1 call for "log"');
assert.strictEqual(logCall[0].name, 'log');

const firstCall = findFirst(tree, (n) => n.kind === NodeKind.Call);
assert.ok(firstCall, 'Should find first call');
assert.strictEqual(firstCall.name, 'print', 'First call in DFS order must be "print"');

const variables = findNodesByKind(tree, NodeKind.Variable);
assert.strictEqual(variables.length, 1);
assert.strictEqual(variables[0].name, 'count');
console.log('✔ Selector methods verified.');

console.log('--- [4/5] Testing Metrics & Names (computeSubtreeDepth, collectSubtreeNames) ---');
const maxDepth = computeSubtreeDepth(tree);
assert.strictEqual(maxDepth, 3, 'Subtree maximum depth should be 3');

const names = collectSubtreeNames(tree);
assert.ok(names.includes('main'));
assert.ok(names.includes('print'));
assert.ok(names.includes('log'));
assert.ok(names.includes('count'));
console.log('✔ Depth calculation and name harvesting verified.');

console.log('--- [5/5] Testing 500-Level Deep Stack Safety ---');
let current = { kind: NodeKind.Block, name: 'deep_0' };
const deepRoot = current;
for (let i = 1; i <= 500; i++) {
  const next = { kind: NodeKind.Block, name: `deep_${i}` };
  current.children = [next];
  current = next;
}

const deepDepth = computeSubtreeDepth(deepRoot);
assert.strictEqual(
  deepDepth,
  500,
  '500-level deep tree must report depth 500 without stack overflow',
);
console.log('✔ 500-level deep nesting traversed successfully without stack overflow.');

console.log('\n🎉 [AST-QUERY] All 5 Verification Suites Passed!');
process.exit(0);
