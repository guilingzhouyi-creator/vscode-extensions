/**
 * Module: Validation Test — Operator Kernel Dual-Track Parity
 * File Path: test/validate-ops-equivalence.js
 * Architecture Role: Verifies 100% semantic and numeric parity between Rust native
 *   operators and PureJsNativeShim for clone detection, dominator tree, and dataflow solver.
 */

'use strict';

const assert = require('assert');
const { nativeCore, PureJsNativeShim } = require('../dist/core/native/native-bridge');

function validateMinHashAndCloneParity() {
  console.log('--- Validating MinHash & Clone Detection Parity ---');
  const tokensA = ['function', 'render', 'items', 'map', 'item', 'return', 'div', 'item', 'name'];
  const tokensB = ['function', 'render', 'items', 'map', 'item', 'return', 'div', 'item', 'title'];
  const tokensC = ['class', 'DatabasePool', 'acquire', 'connection', 'release', 'close'];

  // 1. MinHash signature
  const sigA_native = nativeCore.computeMinHashSignature(tokensA, 64);
  const sigA_shim = PureJsNativeShim.computeMinHashSignature(tokensA, 64);
  assert.deepStrictEqual(sigA_native, sigA_shim, 'MinHash signature parity failed');
  console.log('  ✓ MinHash signature calculation 100% identical (64 hashes)');

  // 2. Jaccard similarity estimation
  const sigB_native = nativeCore.computeMinHashSignature(tokensB, 64);
  const sigB_shim = PureJsNativeShim.computeMinHashSignature(tokensB, 64);
  const sim_native = nativeCore.estimateJaccardSimilarity(sigA_native, sigB_native);
  const sim_shim = PureJsNativeShim.estimateJaccardSimilarity(sigA_shim, sigB_shim);
  assert.strictEqual(sim_native, sim_shim, 'Jaccard similarity parity failed');
  console.log(`  ✓ Jaccard similarity parity passed (${sim_native.toFixed(4)})`);

  // 3. Clone detection via LSH
  const fragments = [
    { id: 'f1', tokens: tokensA },
    { id: 'f2', tokens: tokensB },
    { id: 'f3', tokens: tokensC },
  ];
  const clones_native = nativeCore.detectClonesLsh(fragments, {
    similarityThreshold: 0.5,
    numPermutations: 64,
    numBands: 16,
  });
  const clones_shim = PureJsNativeShim.detectClonesLsh(fragments, {
    similarityThreshold: 0.5,
    numPermutations: 64,
    numBands: 16,
  });

  assert.strictEqual(clones_native.length, clones_shim.length, 'Clone count mismatch');
  for (let i = 0; i < clones_native.length; i++) {
    assert.strictEqual(clones_native[i].targetId, clones_shim[i].targetId);
    assert.strictEqual(clones_native[i].candidateId, clones_shim[i].candidateId);
    assert.strictEqual(clones_native[i].similarity, clones_shim[i].similarity);
  }
  console.log(`  ✓ Clone detection LSH parity passed (${clones_native.length} clone pair identified)`);
}

function validateDominatorTreeParity() {
  console.log('--- Validating Dominator Tree Parity ---');
  // Simple diamond CFG: Entry -> (B, C) -> D -> Exit
  const nodes = ['entry', 'b', 'c', 'd', 'exit'];
  const edges = [
    ['entry', 'b'],
    ['entry', 'c'],
    ['b', 'd'],
    ['c', 'd'],
    ['d', 'exit'],
  ];

  const dom_native = nativeCore.computeDominatorTree('entry', nodes, edges);
  const dom_shim = PureJsNativeShim.computeDominatorTree('entry', nodes, edges);

  assert.strictEqual(dom_native.entry, dom_shim.entry);
  for (const node of nodes) {
    assert.strictEqual(
      dom_native.immediateDominators[node],
      dom_shim.immediateDominators[node],
      `Immediate dominator mismatch for ${node}`
    );
  }
  console.log('  ✓ Immediate dominator tree 100% identical for diamond CFG');
}

function validateDataflowSolverParity() {
  console.log('--- Validating Dataflow Fixed-Point Solver Parity ---');
  const nodes = ['n1', 'n2', 'n3'];
  const edges = [
    ['n1', 'n2'],
    ['n2', 'n3'],
  ];
  const initialFacts = {
    n1: ['x'],
    n2: [],
    n3: [],
  };
  const transfer = {
    n1: { gen: ['a'], kill: [] },
    n2: { gen: ['b'], kill: ['x'] },
    n3: { gen: ['c'], kill: [] },
  };

  const df_native = nativeCore.solveDataflowForward(nodes, edges, initialFacts, transfer);
  const df_shim = PureJsNativeShim.solveDataflowForward(nodes, edges, initialFacts, transfer);

  assert.strictEqual(df_native.converged, true);
  assert.strictEqual(df_shim.converged, true);
  assert.deepStrictEqual(df_native.outFacts, df_shim.outFacts);
  console.log('  ✓ Forward dataflow fixed-point solver facts 100% identical');
}

function main() {
  console.log('=== Running Operator Kernel Dual-Track Parity Suite ===');
  validateMinHashAndCloneParity();
  validateDominatorTreeParity();
  validateDataflowSolverParity();
  console.log('\nAll operator kernel parity tests passed with 100% compliance!');
}

main();
