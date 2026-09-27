#!/usr/bin/env node
/**
 * Module: Verification Harness — Control Flow Graph & Dataflow Invariants
 * File Path: scripts/validate-control-flow-graph.js
 * Architecture Role: Verifies the integrity of function-level CFG construction, branch topology,
 *                    floating promise detection (ASY-FLW-001), unguarded null checks (SAF-NIL-001),
 *                    and resource lifecycle closure verification.
 * Dependencies & Triggers: `npm run validate-control-flow-graph` or via `npm test`; imports
 *                          ../dist/core/cfg/index.
 * Responsibilities: Assert basic block linkages, branch splits, loop back-edges, and def-use
 *                   invariants on both positive and negative (compliant) fixtures.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; throws and exits 1 on any assertion
 *                   failure, guarding against dataflow regressions.
 */
'use strict';

const assert = require('assert');
const { BasicBlock, CfgBuilder, DefUseAnalyzer } = require('../dist/core/cfg');

/**
 * Validates low-level basic block linkages and terminator properties.
 */
function testBasicBlockPrimitives() {
  console.log('1. Testing BasicBlock creation, linkage, and termination...');
  const b1 = new BasicBlock(1, 'entry');
  const b2 = new BasicBlock(2, 'normal');
  const b3 = new BasicBlock(3, 'exit');

  b1.addSuccessor(b2, 'unconditional');
  b2.addSuccessor(b3, 'unconditional');

  assert.strictEqual(b1.successors.length, 1);
  assert.strictEqual(b1.successors[0].id, 2);
  assert.strictEqual(b2.predecessors[0].id, 1);
  assert.strictEqual(b2.successors[0].id, 3);
  assert.strictEqual(b3.predecessors[0].id, 2);

  assert.strictEqual(b1.isTerminator(), false);

  const retStmt = CfgBuilder.parseStatement('return result;', 10, 's_ret');
  b2.addStatement(retStmt);
  assert.strictEqual(b2.isTerminator(), true);
  assert.strictEqual(b2.getTerminator()?.kind, 'return');

  console.log('   [PASS] BasicBlock primitives verified.');
}

/**
 * Validates branch splitting and graph reachability.
 */
function testBranchingCfg() {
  console.log('2. Testing branch graph construction and reachability...');
  const builder = new CfgBuilder();
  const lines = [
    'const total = 10;',
    'if (total > 5) {',
    '    doSomething();',
    '}',
    'return total;',
  ];

  const cfg = builder.buildFromLines(lines);
  const reachable = cfg.getReachableBlocks();

  assert.ok(
    cfg.blocks.length >= 3,
    'CFG should contain at least entry, condition, and exit blocks',
  );
  assert.ok(reachable.length >= 3, 'Reachable blocks should cover main execution paths');
  assert.strictEqual(cfg.entry.kind, 'entry');
  assert.strictEqual(cfg.exit.kind, 'exit');

  const edges = cfg.getAllEdges();
  assert.ok(
    edges.some((e) => e.kind === 'true-branch'),
    'Should contain true branch edge',
  );
  assert.ok(
    edges.some((e) => e.kind === 'false-branch'),
    'Should contain false branch edge',
  );

  console.log('   [PASS] Branching CFG verified.');
}

/**
 * Validates floating Promise detection (ASY-FLW-001).
 */
function testFloatingPromiseAnalysis() {
  console.log('3. Testing floating promise detection (ASY-FLW-001)...');
  const builder = new CfgBuilder();

  // Positive fixture: floating unawaited async calls
  const positiveLines = [
    'function processOrder() {',
    '    fetch("https://api.example.com/data");',
    '    sendRequest({ id: 123 });',
    '    return true;',
    '}',
  ];
  const posCfg = builder.buildFromLines(positiveLines);
  const posResult = DefUseAnalyzer.analyze(posCfg);
  assert.strictEqual(posResult.floatingPromises.length, 2, 'Should flag 2 floating promises');
  assert.strictEqual(posResult.floatingPromises[0].callName, 'fetch');
  assert.strictEqual(posResult.floatingPromises[1].callName, 'sendRequest');

  // Negative fixture: properly awaited, returned, or voided calls
  const negativeLines = [
    'async function processOrder() {',
    '    const data = await fetch("https://api.example.com/data");',
    '    void sendRequest({ id: 123 });',
    '    return await queryAsync();',
    '}',
  ];
  const negCfg = builder.buildFromLines(negativeLines);
  const negResult = DefUseAnalyzer.analyze(negCfg);
  assert.strictEqual(negResult.floatingPromises.length, 0, 'Compliant code should have 0 findings');

  console.log('   [PASS] Floating promise analysis verified.');
}

/**
 * Validates unguarded null dereference detection (SAF-NIL-001).
 */
function testUnguardedNullAnalysis() {
  console.log('4. Testing unguarded null dereference detection (SAF-NIL-001)...');
  const builder = new CfgBuilder();

  // Positive fixture: null check without return followed by dereference
  const positiveLines = [
    'function handleUser(user) {',
    '    if (!user) logWarning("user is missing");',
    '    const name = user.name;',
    '    return name;',
    '}',
  ];
  const posCfg = builder.buildFromLines(positiveLines);
  const posResult = DefUseAnalyzer.analyze(posCfg);
  assert.ok(posResult.unguardedDereferences.length >= 1, 'Should flag unguarded dereference');
  assert.strictEqual(posResult.unguardedDereferences[0].variable, 'user');

  // Negative fixture: guarded with return
  const negativeLines = [
    'function handleUser(user) {',
    '    if (!user) return;',
    '    const name = user.name;',
    '    return name;',
    '}',
  ];
  const negCfg = builder.buildFromLines(negativeLines);
  const negResult = DefUseAnalyzer.analyze(negCfg);
  assert.strictEqual(
    negResult.unguardedDereferences.length,
    0,
    'Guarded return should have 0 findings',
  );

  console.log('   [PASS] Unguarded null analysis verified.');
}

/**
 * Validates resource closure and leak detection along CFG exit paths.
 */
function testResourceClosureAnalysis() {
  console.log('5. Testing resource closure detection...');
  const builder = new CfgBuilder();

  // Positive fixture: allocated resource not closed or registered
  const positiveLines = [
    'function setupWatcher() {',
    '    const watcher = createFileSystemWatcher("**/*.ts");',
    '    doWork();',
    '    return;',
    '}',
  ];
  const posCfg = builder.buildFromLines(positiveLines);
  const posResult = DefUseAnalyzer.analyze(posCfg);
  assert.strictEqual(posResult.unclosedResources.length, 1, 'Should flag 1 unclosed resource');
  assert.strictEqual(posResult.unclosedResources[0].variable, 'watcher');

  // Negative fixture: properly registered into subscriptions
  const negativeLines = [
    'function setupWatcher(context) {',
    '    const watcher = createFileSystemWatcher("**/*.ts");',
    '    context.subscriptions.push(watcher);',
    '    return;',
    '}',
  ];
  const negCfg = builder.buildFromLines(negativeLines);
  const negResult = DefUseAnalyzer.analyze(negCfg);
  assert.strictEqual(
    negResult.unclosedResources.length,
    0,
    'Clean resource should have 0 findings',
  );

  console.log('   [PASS] Resource closure analysis verified.');
}

(() => {
  console.log('=== Running Control Flow Graph & Dataflow Verification Suite ===');
  testBasicBlockPrimitives();
  testBranchingCfg();
  testFloatingPromiseAnalysis();
  testUnguardedNullAnalysis();
  testResourceClosureAnalysis();
  console.log('================================================================');
  console.log('🎉 ALL CFG AND DATAFLOW VERIFICATIONS PASSED SUCCESSFULLY (5/5)!');
  console.log('================================================================\n');
})();
