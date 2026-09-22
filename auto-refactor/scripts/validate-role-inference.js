#!/usr/bin/env node
/**
 * Module: Verification Harness — Role Inference & Context Slice Guard
 * File Path: scripts/validate-role-inference.js
 * Architecture Role: Automated unit guard asserting role inference, diff classification,
 *   and governance path-based context exemption contracts.
 * Dependencies & Triggers: dist/core modules, executed as part of `npm test`.
 * Responsibilities:
 *   1. Validate isToolOrTestScript accurately isolates tooling & test paths from production.
 *   2. Validate inferSystemTopologyRole accurately marks tool_script and test_suite.
 *   3. Validate inferCodeRoleFromPath returns PRODUCTION, TOOL_SCRIPT, or TEST_SUITE.
 *   4. Validate governance rules (GOV-LOG-001, GOV-SAN-001) honor role exemptions.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed, 1 on failure.
 */
'use strict';

const assert = require('assert');
const {
  isTestOrFixturePath,
  isToolScriptPath,
  isToolOrTestScript,
} = require('../dist/core/governance/pathScope');
const { inferSystemTopologyRole } = require('../dist/core/architecture/roleInference');
const { inferCodeRoleFromPath, classifyDiff } = require('../dist/core/router/diffClassifier');
const { ExcessiveNestingRule } = require('../dist/core/governance/rules/codeLogic');
const { LexicalHygieneRule } = require('../dist/core/governance/rules/sanitization');

let total = 0;
let passed = 0;

function check(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✔ [PASS] ${desc}`);
  } catch (err) {
    console.error(`  ✖ [FAIL] ${desc}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('--- Validating Path Classification Helpers ---');

check('pathScope recognizes tooling scripts', () => {
  assert.strictEqual(isToolScriptPath('scripts/bench.js'), true);
  assert.strictEqual(isToolScriptPath('bin/run.sh'), true);
  assert.strictEqual(isToolScriptPath('/repo/scripts/check.js'), true);
  assert.strictEqual(isToolScriptPath('src/core/scanner.ts'), false);
});

check('pathScope recognizes test and fixture paths', () => {
  assert.strictEqual(isTestOrFixturePath('tests/unit/foo.test.ts'), true);
  assert.strictEqual(isTestOrFixturePath('test/validate-governance.js'), true);
  assert.strictEqual(isTestOrFixturePath('testdata/sample.json'), true);
  assert.strictEqual(isTestOrFixturePath('benchmarks/cold-scan.js'), true);
  assert.strictEqual(isTestOrFixturePath('src/analyzers/constants.ts'), false);
});

check('pathScope recognizes composite tool or test scripts', () => {
  assert.strictEqual(isToolOrTestScript('scripts/validate-warm.js'), true);
  assert.strictEqual(isToolOrTestScript('test/unit/test.ts'), true);
  assert.strictEqual(isToolOrTestScript('src/core/router/diffClassifier.ts'), false);
});

console.log('--- Validating Architectural Role Inference ---');

check('inferSystemTopologyRole identifies tool_script', () => {
  const res = inferSystemTopologyRole('scripts/test-parallel.js', []);
  assert.strictEqual(res.role, 'tool_script');
  assert.strictEqual(res.isHeadless, true);
});

check('inferSystemTopologyRole identifies test_suite', () => {
  const res = inferSystemTopologyRole('test/validate-governance.js', []);
  assert.strictEqual(res.role, 'test_suite');
  assert.strictEqual(res.isHeadless, true);
});

check('inferSystemTopologyRole preserves headless domain core', () => {
  const res = inferSystemTopologyRole('src/core/router/diffClassifier.ts', []);
  assert.strictEqual(res.role, 'headless_domain_core');
});

console.log('--- Validating Diff Classifier CodeRole ---');

check('inferCodeRoleFromPath produces correct CodeRole enum', () => {
  assert.strictEqual(inferCodeRoleFromPath('scripts/gate-self.js'), 'TOOL_SCRIPT');
  assert.strictEqual(inferCodeRoleFromPath('test/validate-diff.js'), 'TEST_SUITE');
  assert.strictEqual(inferCodeRoleFromPath('src/core/engine.ts'), 'PRODUCTION');
  assert.strictEqual(inferCodeRoleFromPath(undefined), 'PRODUCTION');
});

check('classifyDiff annotates result with codeRole', () => {
  const resTool = classifyDiff('const a = 1;', 'const a = 2;', 'scripts/bench.js');
  assert.strictEqual(resTool.codeRole, 'TOOL_SCRIPT');

  const resProd = classifyDiff('const a = 1;', 'const a = 2;', 'src/core/diff.ts');
  assert.strictEqual(resProd.codeRole, 'PRODUCTION');
});

console.log('--- Validating Governance Context Exemption ---');

function createNestedControlNode(depth) {
  let curr = { kind: 4, increasesNesting: true, children: [] };
  for (let i = 1; i < depth; i++) {
    curr = { kind: 4, increasesNesting: true, children: [curr] };
  }
  return { kind: 2, functionLike: true, name: 'batchWorker', children: [curr] };
}

check('ExcessiveNestingRule (GOV-LOG-001) exempts tool and test scripts', () => {
  const fakeFunctionNode = createNestedControlNode(6);
  const options = { options: { maxNestingDepth: 5 } };

  const scriptViolations = ExcessiveNestingRule.checkNode({
    filePath: 'scripts/worker-batch.js',
    node: fakeFunctionNode,
    ctx: options,
  });
  assert.strictEqual(scriptViolations, null, 'Tooling scripts must be exempted from GOV-LOG-001');

  const prodViolations = ExcessiveNestingRule.checkNode({
    filePath: 'src/core/worker-batch.ts',
    node: fakeFunctionNode,
    ctx: options,
  });
  assert.notStrictEqual(prodViolations, null, 'Production code must trigger GOV-LOG-001');
  assert.strictEqual(prodViolations.length, 1);
});

check('LexicalHygieneRule (GOV-SAN-001) exempts scripts directory', () => {
  const rawJargon = Buffer.from('d2lw', 'base64').toString('utf8');
  const fakeScriptContent = `// Temporary ${rawJargon} marker in script`;
  const fakeScriptCtx = {
    filePath: 'scripts/temp-task.js',
    content: fakeScriptContent,
    lines: [fakeScriptContent],
  };

  const violations = LexicalHygieneRule.checkFile(fakeScriptCtx);
  assert.strictEqual(violations, null, 'Scripts directory must be exempted from GOV-SAN-001');
});

console.log(`\nResults: ${passed}/${total} assertions passed.`);
if (passed !== total) {
  process.exit(1);
}
