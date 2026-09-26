/**
 * Module: Test Pipeline — Constant Library Topology & Anti-Nesting Guard
 * File Path: scripts/validate-constant-library-topology.js
 * Architecture Role: Verifies the constant library topology auditor and ensures
 *     actionable payloads for both large-scale constant library scaffolding and
 *     nested constant elimination.
 * Dependencies & Triggers: Node.js assert; executed in test-parallel runner.
 * Responsibilities:
 *   1. Validate threshold gating for constant sprawl detection.
 *   2. Validate domain-sliced module categorization (AST, rule codes, system tokens, barrel).
 *   3. Validate AgentActionablePayload generation for scaffold_constant_library.
 *   4. Validate nested-constant detection and Actionable payload generation in ConstantsAnalyzer.
 * Exit Semantics & Design Rationale: Process exits 0 on complete pass, 1 on assertion failure.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const {
  auditConstantLibraryTopology,
  inspectConstantLibraryTopology,
} = require('../dist/core/architecture/constant-library-auditor');
const { ConstantsAnalyzer } = require('../dist/analyzers/constants');

function testThresholdGating() {
  console.log('1. Testing Constant Sprawl Threshold Gating...');

  // Sub-threshold cases: should not trigger library recommendation
  const fewConstants = [
    { name: 'TIMEOUT_MS', normalizedValue: '1000', filePath: 'src/a.ts', line: 1 },
    { name: 'MAX_RETRIES', normalizedValue: '3', filePath: 'src/b.ts', line: 1 },
  ];
  const verdictFew = auditConstantLibraryTopology(fewConstants);
  assert.strictEqual(
    verdictFew.needsCentralizedLibrary,
    false,
    'Few constants should not trigger centralized library recommendation',
  );

  // Constants already in a constant library: should be ignored
  const inLibrary = [];
  for (let i = 0; i < 30; i++) {
    inLibrary.push({
      name: `TOKEN_${i}`,
      normalizedValue: `'tok_${i}'`,
      filePath: 'src/constants/tokens.ts',
      line: i + 1,
    });
  }
  const verdictInLib = auditConstantLibraryTopology(inLibrary);
  assert.strictEqual(
    verdictInLib.needsCentralizedLibrary,
    false,
    'Constants already in a constant library should not trigger recommendation',
  );

  console.log('  ✔ [PASS] Threshold gating behaves as expected.');
}

function testDomainClusteringAndScaffolding() {
  console.log('2. Testing Domain Slicing & Library Scaffolding...');

  const scattered = [];
  const files = ['src/core/parser.ts', 'src/core/eval.ts', 'src/core/util.ts', 'src/core/runner.ts'];

  // Add AST tokens
  for (let i = 0; i < 6; i++) {
    scattered.push({
      name: `AST_NODE_${i}`,
      normalizedValue: `'node_${i}'`,
      filePath: files[i % files.length],
      line: i * 10 + 1,
    });
  }
  // Add Rule codes
  for (let i = 0; i < 6; i++) {
    scattered.push({
      name: `RULE_ID_${i}`,
      normalizedValue: `'rule_${i}'`,
      filePath: files[i % files.length],
      line: i * 10 + 2,
    });
  }
  // Add System tokens
  for (let i = 0; i < 5; i++) {
    scattered.push({
      name: `PATH_DIR_${i}`,
      normalizedValue: `'/dir_${i}'`,
      filePath: files[i % files.length],
      line: i * 10 + 3,
    });
  }
  // Add Config tokens
  for (let i = 0; i < 5; i++) {
    scattered.push({
      name: `DEFAULT_TIMEOUT_${i}`,
      normalizedValue: '5000',
      filePath: files[i % files.length],
      line: i * 10 + 4,
    });
  }

  const verdict = auditConstantLibraryTopology(scattered);
  assert.strictEqual(verdict.needsCentralizedLibrary, true, 'Scattered constants should trigger recommendation');
  assert.strictEqual(verdict.recommendedDirectory, 'src/core/constants');

  const moduleFiles = verdict.suggestedModules.map((m) => path.basename(m.file));
  assert.ok(moduleFiles.includes('ast-tokens.ts'), 'Should suggest ast-tokens.ts');
  assert.ok(moduleFiles.includes('rule-codes.ts'), 'Should suggest rule-codes.ts');
  assert.ok(moduleFiles.includes('system-tokens.ts'), 'Should suggest system-tokens.ts');
  assert.ok(moduleFiles.includes('config-tokens.ts'), 'Should suggest config-tokens.ts');
  assert.ok(moduleFiles.includes('index.ts'), 'Should suggest index.ts barrel export');

  const barrel = verdict.suggestedModules.find((m) => m.isBarrel);
  assert.ok(barrel, 'Barrel module entry must exist');

  console.log('  ✔ [PASS] Domain slicing and barrel topology generated accurately.');
}

function testAgentActionableIssueEmission() {
  console.log('3. Testing Agent-Actionable Issue Emission for CONST-LIB-001...');

  const scattered = [];
  for (let i = 0; i < 25; i++) {
    scattered.push({
      name: `CONST_VAL_${i}`,
      normalizedValue: `${i}`,
      filePath: `src/mod_${i % 4}.ts`,
      line: i + 1,
    });
  }

  const issues = inspectConstantLibraryTopology(scattered, 'src/mod_0.ts');
  assert.strictEqual(issues.length, 1, 'Should emit exactly one CONST-LIB-001 issue');
  const issue = issues[0];

  assert.strictEqual(issue.analyzer, 'constants');
  assert.strictEqual(issue.rule, 'CONST-LIB-001');
  assert.strictEqual(issue.severity, 'warning');
  assert.ok(issue.message.includes('Unstructured constant sprawl'), 'Message should indicate sprawl');

  assert.ok(issue.actionable, 'Issue must carry actionable payload');
  assert.strictEqual(issue.actionable.action, 'scaffold_constant_library');
  assert.strictEqual(issue.actionable.code, 'AR:CONST:005');
  assert.strictEqual(issue.actionable.targetDirectory, 'src/constants');
  assert.ok(issue.actionable.suggestedModules.length > 0, 'suggestedModules must not be empty');
  assert.strictEqual(issue.actionable.safeToAutomate, true);

  console.log('  ✔ [PASS] CONST-LIB-001 Agent-Actionable contract verified.');
}

function testNestedConstantActionableInAnalyzer() {
  console.log('4. Testing Nested-Constant Actionable Payload in ConstantsAnalyzer...');

  const analyzer = new ConstantsAnalyzer();
  const sampleContent = [
    'export const BASE_TIMEOUT = 1000;',
    'export const DEFAULT_TIMEOUT = BASE_TIMEOUT;', // nested constant alias
  ].join('\n');

  const issues = analyzer.analyze(
    { text: sampleContent },
    {
      filePath: 'src/demo/config.ts',
      content: sampleContent,
      options: {},
    },
  );

  const nestedIssues = issues.filter((i) => i.rule === 'nested-constant');
  assert.strictEqual(nestedIssues.length, 1, 'Should detect redundant constant alias');
  const nested = nestedIssues[0];

  assert.strictEqual(nested.rule, 'nested-constant');
  assert.ok(nested.message.includes('Redundant constant alias'), 'Should warn about redundant alias');
  assert.ok(nested.actionable, 'nested-constant must carry actionable payload');
  assert.strictEqual(nested.actionable.action, 'replace_token');
  assert.strictEqual(nested.actionable.code, 'AR:CONST:004');
  assert.strictEqual(nested.actionable.targetSymbol, 'BASE_TIMEOUT');

  console.log('  ✔ [PASS] nested-constant Actionable payload verified.');
}

function main() {
  console.log('=== [Constant Library & Anti-Nesting] Running Test Suite ===');
  testThresholdGating();
  testDomainClusteringAndScaffolding();
  testAgentActionableIssueEmission();
  testNestedConstantActionableInAnalyzer();
  console.log('🎉 All Constant Library Topology & Anti-Nesting tests passed successfully!');
}

main();
