#!/usr/bin/env node
/**
 * Module: Validation Suite — Incremental MoE AST Slice Self-Audit Verification
 * File Path: scripts/validate-self-slice-audit.js
 * Architecture Role: End-to-end and unit validation for the sparse MoE incremental slice
 *   self-audit subsystem. Verifies AST slice isolation, feature vector classification,
 *   conditional expert dispatching (CED) activation bounds, and gate-self-slice CLI behavior.
 * Dependencies & Triggers: `npm test` (parallel suites); requires built `dist/`.
 * Responsibilities:
 *   1. Validate ASTSliceExtractor maps changed line deltas to declaration AST nodes.
 *   2. Validate SparseMoEGateRouter routes doc, literal, and structural slices with high bypass.
 *   3. Validate gate-self-slice runner executes in smoke and targeted modes with exit 0.
 * Exit Semantics & Design Rationale:
 *   Exit 0 if all assertions PASS; exit 1 on assertion failure or unhandled exception.
 */
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'scripts', 'gate-self-slice.js');

const { ASTSliceExtractor } = require('../dist/core/router/sliceExtractor');
const { SparseMoEGateRouter } = require('../dist/core/router/sparseMoEGate');

/**
 * Test 1: Validate AST slice extractor on function and literal mutations.
 */
function testSliceExtractor() {
  const extractor = new ASTSliceExtractor();
  const oldCode = [
    'export function computeTotal(items: number[]): number {',
    '    let total = 0;',
    '    for (const item of items) {',
    '        total += item;',
    '    }',
    '    return total;',
    '}',
  ].join('\n');

  const newCode = [
    'export function computeTotal(items: number[]): number {',
    '    let total = 0;',
    '    for (const item of items) {',
    '        if (item > 0) total += item;',
    '    }',
    '    return total;',
    '}',
  ].join('\n');

  const slices = extractor.extractSlices('src/demo.ts', oldCode, newCode, [4]);
  assert.ok(slices.length >= 1, 'Should extract at least one slice');
  const slice = slices[0];
  assert.strictEqual(slice.symbolName, 'computeTotal');
  assert.strictEqual(slice.isExported, true);
  assert.strictEqual(slice.featureVector.hasControlFlowMutation, true);
  assert.strictEqual(slice.featureVector.isDocOnly, false);
}

/**
 * Test 2: Validate sparse MoE gate conditional dispatch and activation ratio bounds.
 */
function testMoEGateBypassRatio() {
  const router = new SparseMoEGateRouter();

  const docSlice = {
    sliceId: 'slice:test:docOnly:1',
    filePath: 'src/demo.ts',
    startLine: 1,
    endLine: 10,
    nodeKind: 'FunctionDeclaration',
    symbolName: 'docFn',
    isExported: false,
    featureVector: {
      addedLines: 2,
      deletedLines: 0,
      modifiedLines: 2,
      hasControlFlowMutation: false,
      hasAsyncMutation: false,
      hasIOMutation: false,
      hasTypeMutation: false,
      hasLiteralMutation: false,
      isDocOnly: true,
      hasSignatureMutation: false,
      cyclomaticDelta: 0,
      nestingDelta: 0,
    },
    primaryKind: 'doc-only',
  };

  const plan = router.routeSlice(docSlice);
  assert.ok(plan.activeAnalyzers.includes('comments'), 'Must include comments analyzer');
  assert.ok(plan.activeAnalyzers.includes('docs'), 'Must include docs analyzer');
  assert.ok(!plan.activeAnalyzers.includes('complexity'), 'Must bypass complexity analyzer');
  assert.ok(!plan.activeAnalyzers.includes('performance'), 'Must bypass performance analyzer');
  assert.ok(
    plan.activationRatio <= 0.25,
    `Doc-only activation ratio must be <= 25%, got ${plan.activationRatio}`,
  );
  assert.ok(plan.skippedAnalyzers.length >= 15, 'Must bypass at least 15 cold analyzers');
}

/**
 * Test 3: Validate combined slice routing unions analyzer subsets correctly.
 */
function testCombinedSliceRouting() {
  const router = new SparseMoEGateRouter();

  const literalSlice = {
    sliceId: 'slice:test:literalOnly:1',
    filePath: 'src/demo.ts',
    startLine: 1,
    endLine: 5,
    nodeKind: 'FunctionDeclaration',
    symbolName: 'litFn',
    isExported: false,
    featureVector: {
      addedLines: 1,
      deletedLines: 0,
      modifiedLines: 1,
      hasControlFlowMutation: false,
      hasAsyncMutation: false,
      hasIOMutation: false,
      hasTypeMutation: false,
      hasLiteralMutation: true,
      isDocOnly: false,
      hasSignatureMutation: false,
      cyclomaticDelta: 0,
      nestingDelta: 0,
    },
    primaryKind: 'literal-only',
  };

  const combinedPlan = router.routeCombinedSlices([literalSlice]);
  assert.ok(combinedPlan.activeAnalyzers.includes('constants'), 'Must include constants');
  assert.ok(combinedPlan.activeAnalyzers.includes('secrets'), 'Must include secrets');
  assert.ok(!combinedPlan.activeAnalyzers.includes('data-architecture'), 'Must bypass data-arch');
}

/**
 * Test 4: Validate gate-self-slice CLI script in smoke mode.
 */
function testGateSelfSliceCLI() {
  const res = spawnSync(process.execPath, [RUNNER, '--smoke', '--severity', 'warning'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.strictEqual(
    res.status,
    0,
    `gate-self-slice --smoke should exit 0, got ${res.status}: ${res.stderr || res.stdout}`,
  );
  assert.ok(
    res.stdout.includes('targeted-scan'),
    `Stdout should contain targeted-scan summary: ${res.stdout}`,
  );
  assert.ok(res.stdout.includes('PASS'), `Stdout should confirm PASS: ${res.stdout}`);
}

/**
 * Main test orchestrator.
 */
function main() {
  process.stdout.write('1. Testing AST slice extractor on line deltas...\n');
  testSliceExtractor();

  process.stdout.write('2. Testing Sparse MoE gate cold bypass ratio...\n');
  testMoEGateBypassRatio();

  process.stdout.write('3. Testing combined slice expert dispatch union...\n');
  testCombinedSliceRouting();

  process.stdout.write('4. Testing gate-self-slice runner in smoke mode...\n');
  testGateSelfSliceCLI();

  process.stdout.write('\n🎉 ALL 4 SLICE SELF-AUDIT VALIDATIONS PASSED!\n');
}

main();
