#!/usr/bin/env node
/**
 * Module: Verification Harness — Unified AST Visitor Parity & Stack Invariants
 * File Path: scripts/validate-unified-ast-visitor.js
 * Architecture Role: End-to-end verification suite testing the UnifiedAstVisitor engine.
 * Dependencies & Triggers: Executed directly via `node scripts/validate-unified-ast-visitor.js`
 *   or CI verification steps; imports typescript and dist/core/ast/unified-ast-visitor.
 * Responsibilities:
 *   1. Verify simultaneous multi-category collection (functions & variables) in a single pass;
 *   2. Assert 100% parity against multiple traditional ts.forEachChild AST traversals;
 *   3. Assert correct LIFO call-stack ordering of enter and leave hooks;
 *   4. Validate edge cases including empty files, wildcard listeners, and deduplication.
 * Exit Semantics & Design Rationale: Exits with status 0 on clean verification pass; logs error
 *   details and exits with status 1 on any assertion failure or unexpected exception.
 */
'use strict';

const assert = require('assert');
const nodeFs = require('fs');
const nodePath = require('path');
const tsCompiler = require('typescript');

const { UnifiedAstVisitor } = require('../dist/core/ast/unified-ast-visitor');

/**
 * Traditional baseline: collects AST nodes matching targetKind using recursive ts.forEachChild.
 *
 * @param rootNode - Root node to traverse.
 * @param targetKind - Target SyntaxKind to match.
 * @returns Array of matched AST nodes in pre-order DFS sequence.
 */
function traditionalCollect(rootNode, targetKind) {
  const results = [];
  function visit(node) {
    if (node.kind === targetKind) {
      results.push(node);
    }
    tsCompiler.forEachChild(node, visit);
  }
  visit(rootNode);
  return results;
}

/**
 * Parses source text into a TypeScript SourceFile AST.
 *
 * @param sourceText - TypeScript source code text.
 * @param fileName - Synthetic or real file name.
 * @returns Parsed SourceFile AST.
 */
function parseSource(sourceText, fileName = 'sample-test.ts') {
  return tsCompiler.createSourceFile(fileName, sourceText, tsCompiler.ScriptTarget.Latest, true);
}

const COLLECTION_FIXTURE = [
  'const globalLimit = 100;',
  'let retryCount = 0;',
  'function executeWorkflow(taskName: string): boolean {',
  '    const stepId = "step_1";',
  '    function logStep(msg: string): void { const timestamp = Date.now(); }',
  '    return true;',
  '}',
  'class PipelineWorker {',
  '    private status = "idle";',
  '    public processItem(item: string): void { const processed = item.trim(); }',
  '    public shutdown(): void { const graceful = true; }',
  '}',
].join('\n');

/**
 * Test 1: Verify simultaneous collection of functions and variables in a single pass.
 */
function testSimultaneousCollection() {
  console.log('1. Testing simultaneous function & variable collection in a single pass...');

  const sourceFile = parseSource(COLLECTION_FIXTURE);
  const visitor = new UnifiedAstVisitor();
  const collectedFunctions = [];
  const collectedVariables = [];

  visitor.register({
    name: 'function-and-method-collector',
    kinds: [tsCompiler.SyntaxKind.FunctionDeclaration, tsCompiler.SyntaxKind.MethodDeclaration],
    enter(node) {
      const decl = node;
      const declName = decl.name ? decl.name.getText(sourceFile) : '<anonymous>';
      collectedFunctions.push(declName);
    },
  });

  visitor.register({
    name: 'variable-collector',
    kinds: [tsCompiler.SyntaxKind.VariableDeclaration],
    enter(node) {
      const decl = node;
      const declName = decl.name.getText(sourceFile);
      collectedVariables.push(declName);
    },
  });

  visitor.walk(sourceFile);

  assert.strictEqual(collectedFunctions.length, 4);
  assert.deepStrictEqual(collectedFunctions, [
    'executeWorkflow',
    'logStep',
    'processItem',
    'shutdown',
  ]);

  assert.strictEqual(collectedVariables.length, 6);
  assert.deepStrictEqual(collectedVariables, [
    'globalLimit',
    'retryCount',
    'stepId',
    'timestamp',
    'processed',
    'graceful',
  ]);

  console.log('   [PASS] Multi-category collection verified (4 functions, 6 variables in 1 pass).');
}

/**
 * Runs parity assertion on a single source AST across multiple kinds.
 *
 * @param label - Description label of the target source.
 * @param source - TypeScript SourceFile AST.
 */
function verifySourceParity(label, source) {
  const kindsToVerify = [
    tsCompiler.SyntaxKind.FunctionDeclaration,
    tsCompiler.SyntaxKind.MethodDeclaration,
    tsCompiler.SyntaxKind.VariableDeclaration,
    tsCompiler.SyntaxKind.ClassDeclaration,
    tsCompiler.SyntaxKind.InterfaceDeclaration,
  ];

  const baselineResultsMap = new Map();
  for (let index = 0; index < kindsToVerify.length; index++) {
    const kind = kindsToVerify[index];
    baselineResultsMap.set(kind, traditionalCollect(source, kind));
  }

  const unifiedResultsMap = new Map();
  const visitor = new UnifiedAstVisitor();
  for (let index = 0; index < kindsToVerify.length; index++) {
    const kind = kindsToVerify[index];
    const matchedList = [];
    unifiedResultsMap.set(kind, matchedList);
    visitor.register({
      name: `collector-kind-${kind}`,
      kinds: [kind],
      enter(node) {
        matchedList.push(node);
      },
    });
  }

  visitor.walk(source);

  for (let index = 0; index < kindsToVerify.length; index++) {
    const kind = kindsToVerify[index];
    const kindName = tsCompiler.SyntaxKind[kind];
    const baseline = baselineResultsMap.get(kind);
    const unified = unifiedResultsMap.get(kind);

    assert.strictEqual(
      unified.length,
      baseline.length,
      `[${label}] Count mismatch for ${kindName}: unified=${unified.length}, baseline=${baseline.length}`,
    );
    for (let nodeIdx = 0; nodeIdx < baseline.length; nodeIdx++) {
      assert.strictEqual(
        unified[nodeIdx],
        baseline[nodeIdx],
        `[${label}] Node reference mismatch for ${kindName} at index ${nodeIdx}`,
      );
    }
  }
}

/**
 * Test 2: Verify 100% strict parity against multiple traditional ts.forEachChild passes.
 */
function testParityWithTraditional() {
  console.log(
    '2. Testing 100% strict parity against multiple traditional ts.forEachChild passes...',
  );

  const syntheticSource = parseSource(
    [
      'interface Config { timeout: number; }',
      'const alpha = 1;',
      'let beta = 2;',
      'function compute(val: number): number {',
      '    const factor = 10;',
      '    return val * factor;',
      '}',
      'class Service {',
      '    public run(): void { const flag = true; }',
      '    private cleanup(): void { const err = null; }',
      '}',
    ].join('\n'),
  );

  const repoFilePath = nodePath.join(__dirname, '../src/core/ast/ts-predicates.ts');
  const realFileSource = parseSource(nodeFs.readFileSync(repoFilePath, 'utf8'), 'ts-predicates.ts');

  verifySourceParity('Synthetic Fixture', syntheticSource);
  verifySourceParity('Real File (ts-predicates.ts)', realFileSource);

  console.log('   [PASS] 100% strict parity verified across synthetic and real project files.');
}

/**
 * Test 3: Verify enter / leave call stack ordering and LIFO nesting invariants.
 */
function testEnterLeaveInvariants() {
  console.log('3. Testing enter / leave call stack order and LIFO nesting invariants...');

  const fixtureCode = 'function outer() { if (true) { const innerVal = 42; } }';
  const sourceFile = parseSource(fixtureCode);
  const visitor = new UnifiedAstVisitor();

  const activeStack = [];
  const eventLog = [];
  let enterCount = 0;
  let leaveCount = 0;

  visitor.register({
    name: 'stack-invariant-validator',
    enter(node, parent, depth) {
      enterCount++;
      if (depth === 0) {
        assert.strictEqual(parent, undefined);
        assert.strictEqual(node, sourceFile);
      } else {
        assert.ok(activeStack.length > 0);
        assert.strictEqual(parent, activeStack[activeStack.length - 1].node);
      }
      assert.strictEqual(depth, activeStack.length);
      activeStack.push({ node, parent, depth });
      eventLog.push({ type: 'enter', node, depth });
    },
    leave(node, parent, depth) {
      leaveCount++;
      assert.ok(activeStack.length > 0);
      const popped = activeStack.pop();
      assert.strictEqual(popped.node, node);
      assert.strictEqual(popped.parent, parent);
      assert.strictEqual(popped.depth, depth);
      eventLog.push({ type: 'leave', node, depth });
    },
  });

  visitor.walk(sourceFile);

  assert.strictEqual(activeStack.length, 0);
  assert.strictEqual(enterCount, leaveCount);
  assert.ok(enterCount > 0);

  const enterIndicesMap = new Map();
  const leaveIndicesMap = new Map();
  for (let index = 0; index < eventLog.length; index++) {
    const record = eventLog[index];
    if (record.type === 'enter') {
      enterIndicesMap.set(record.node, index);
    } else {
      leaveIndicesMap.set(record.node, index);
    }
  }

  for (const [node, enterIdx] of enterIndicesMap.entries()) {
    const leaveIdx = leaveIndicesMap.get(node);
    assert.ok(leaveIdx !== undefined, 'Entered node must have leave event');
    assert.ok(enterIdx < leaveIdx, 'Enter event must precede leave event');
  }

  console.log(
    `   [PASS] LIFO stack and nesting invariants verified (${enterCount} nodes balanced).`,
  );
}

/**
 * Test 4: Verify edge cases: deduplication, undefined sourceFile, and partial hooks.
 */
function testEdgeCases() {
  console.log('4. Testing edge cases and robustness...');

  const visitor = new UnifiedAstVisitor();
  visitor.walk(undefined);
  visitor.walk(null);

  const sourceFile = parseSource('function duplicateKindTest() {}');
  let duplicateKindEnterCount = 0;

  visitor.register({
    name: 'duplicate-kind-listener',
    kinds: [tsCompiler.SyntaxKind.FunctionDeclaration, tsCompiler.SyntaxKind.FunctionDeclaration],
    enter() {
      duplicateKindEnterCount++;
    },
  });

  visitor.walk(sourceFile);
  assert.strictEqual(duplicateKindEnterCount, 1);

  let enterOnlyCalled = 0;
  let leaveOnlyCalled = 0;
  const partialVisitor = new UnifiedAstVisitor();
  partialVisitor.register({
    name: 'enter-only',
    enter() {
      enterOnlyCalled++;
    },
  });
  partialVisitor.register({
    name: 'leave-only',
    leave() {
      leaveOnlyCalled++;
    },
  });

  partialVisitor.walk(sourceFile);
  assert.ok(enterOnlyCalled > 0);
  assert.ok(leaveOnlyCalled > 0);
  assert.strictEqual(enterOnlyCalled, leaveOnlyCalled);

  console.log('   [PASS] Edge cases and robustness verified.');
}

/**
 * Main verification entrypoint.
 */
function main() {
  console.log('=== UnifiedAstVisitor Verification Suite ===\n');
  try {
    testSimultaneousCollection();
    testParityWithTraditional();
    testEnterLeaveInvariants();
    testEdgeCases();

    console.log('\n[PASS] All UnifiedAstVisitor tests passed cleanly.');
    process.exit(0);
  } catch (error) {
    console.error('\n[FAIL] UnifiedAstVisitor validation failed:', error);
    process.exit(1);
  }
}

main();
