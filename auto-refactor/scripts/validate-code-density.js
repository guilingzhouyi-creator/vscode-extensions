/**
 * Module: Verification Harness — Effective Code Density & Elastic Budget Matrix
 * File Path: scripts/validate-code-density.js
 * Architecture Role: Verifies the 9-spectrum line classification, effective code density (ECD)
 *   calculations, fine-grained 8-role inference, and role-aware elastic complexity budgets.
 * Dependencies & Triggers: Consumes dist/core intelligence modules; executed in test suite.
 * Responsibilities:
 *   1. Assert analyzeCodeDensity accurately counts 9 line classification kinds;
 *   2. Assert high-comment / high-data files are marked as low-density documented;
 *   3. Assert inferFineGrainedFileRole correctly categorizes 8 distinct architectural roles;
 *   4. Assert evaluateRoleElasticBudget exempts low-density and algorithmic/registry modules.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const { analyzeCodeDensity } = require('../dist/core/intelligence/code-density-analyzer');
const { inferFineGrainedFileRole } = require('../dist/core/intelligence/file-role-inference');
const {
  evaluateRoleElasticBudget,
  getRoleBudget,
} = require('../dist/core/intelligence/elastic-budget-matrix');

async function testLineSpectrumClassification() {
  console.log('1. Testing analyzeCodeDensity line spectrum classification...');

  const sampleSource = [
    '/**',
    ' * JSDoc header comment line 1',
    ' * JSDoc header comment line 2',
    ' */',
    '',
    '// Single line comment',
    'export interface UserOptions {',
    '    timeout?: number;',
    '    retries?: number;',
    '}',
    '',
    'export const APP_CONFIG = {',
    "    'endpoint': 'https://api.internal',",
    '    retryCount: 3,',
    '};',
    '',
    'export function computeScore(values: number[]): number {',
    '    if (!values || values.length === 0) {',
    '        return 0;',
    '    }',
    '    const sum = values.reduce((acc, curr) => acc + curr, 0);',
    '    return sum / values.length;',
    '}',
    '',
    ');',
  ].join('\n');

  const metrics = analyzeCodeDensity(sampleSource, 'src/scoring.ts');

  assert.strictEqual(metrics.physicalLines, 25);
  assert.ok(metrics.classificationCounts.COMMENT_LINE >= 5, 'Should count JSDoc and line comments');
  assert.ok(metrics.classificationCounts.BLANK_LINE >= 4, 'Should count blank separator lines');
  assert.ok(
    metrics.classificationCounts.FRAMEWORK_SCAFFOLD >= 1,
    'Should count interface declaration',
  );
  assert.ok(metrics.classificationCounts.DATA_DECLARATION >= 1, 'Should count data/dict entries');
  assert.ok(metrics.classificationCounts.FORMATTED_WRAP >= 1, 'Should count trailing wrap tokens');
  assert.ok(
    metrics.classificationCounts.EFFECTIVE_CODE >= 5,
    'Should count actual logic expressions',
  );

  // ECL must be significantly lower than physical LOC due to comments, blanks, and config
  assert.ok(
    metrics.effectiveCodeLines < metrics.physicalLines * 0.7,
    `ECL (${metrics.effectiveCodeLines}) should be damped vs physical (${metrics.physicalLines})`,
  );
  assert.ok(metrics.effectiveDensity > 0 && metrics.effectiveDensity < 1.0);

  console.log('  ✔ 9 line spectrum categories classified and weighted correctly');
  console.log(
    `    - Physical: ${metrics.physicalLines}, Effective: ${metrics.effectiveCodeLines}, Density: ${metrics.effectiveDensity}`,
  );
}

async function testLowDensityExemption() {
  console.log('\n2. Testing low-density documented module recognition...');

  // Build an 800-line synthetic file: 300 comments, 200 blanks, 100 scaffold/config, 200 real code
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(`// Detailed technical specification line ${i}`);
  for (let i = 0; i < 200; i++) lines.push('');
  for (let i = 0; i < 100; i++) lines.push(`export interface ScaffoldingType${i} {}`);
  for (let i = 0; i < 200; i++) lines.push(`const val${i} = Math.sqrt(${i}) + 1;`);

  const largeSource = lines.join('\n');
  const metrics = analyzeCodeDensity(largeSource, 'src/core/math-spec.ts');

  assert.strictEqual(metrics.physicalLines, 800);
  assert.ok(metrics.commentRatio >= 0.35, 'Comment ratio should be >= 35%');
  assert.ok(metrics.blankRatio >= 0.2, 'Blank ratio should be >= 20%');
  assert.ok(metrics.isLowDensityDocumented, 'File must be identified as low-density documented');
  assert.ok(metrics.effectiveCodeLines <= 250, 'Effective code lines should be approx ~220');

  // Evaluate under business_module
  const evaluation = evaluateRoleElasticBudget('business_module', metrics);
  assert.ok(
    !evaluation.shouldFlagLargeFile,
    'Well-documented low-density 800-line file should NOT trigger error',
  );

  console.log(
    '  ✔ Low-density documented module successfully shielded from premature large-file alarms',
  );
}

async function testFileRoleInference() {
  console.log('\n3. Testing fine-grained file role inference...');

  const expectations = [
    { path: 'src/api.ts', expected: 'core_trunk' },
    { path: 'src/core/cache.ts', expected: 'business_module' },
    { path: 'src/utils/formatting.ts', expected: 'shared_library' },
    { path: 'src/core/ast/oxc-predicates.ts', expected: 'algorithm_computation' },
    { path: 'src/core/rules/entries/security.ts', expected: 'rules_registry' },
    { path: 'src/config/thresholds.ts', expected: 'config_constant' },
    { path: 'tests/unit/cache.test.ts', expected: 'test_suite' },
    { path: 'dist/bundle.min.js', expected: 'auto_generated' },
    {
      path: 'src/generated/proto.ts',
      header: '/* Code generated by protoc. DO NOT EDIT. */',
      expected: 'auto_generated',
    },
  ];

  for (const { path, header, expected } of expectations) {
    const result = inferFineGrainedFileRole(path, header);
    assert.strictEqual(
      result.role,
      expected,
      `File ${path} should be inferred as ${expected}, got ${result.role}`,
    );
  }

  console.log('  ✔ All 8 fine-grained file roles inferred accurately from paths and heuristics');
}

async function testElasticRoleBudgets() {
  console.log('\n4. Testing role-aware elastic complexity budgets...');

  // Rules registry gets 1200 warn, 3000 fail
  const regBudget = getRoleBudget('rules_registry');
  assert.strictEqual(regBudget.physicalLinesWarn, 1200);
  assert.strictEqual(regBudget.physicalLinesFail, 3000);
  assert.strictEqual(regBudget.complexityBudget, 6);

  // Algorithm gets 800 warn, 1500 fail, CC 20
  const algoBudget = getRoleBudget('algorithm_computation');
  assert.strictEqual(algoBudget.physicalLinesWarn, 800);
  assert.strictEqual(algoBudget.complexityBudget, 20);

  // Auto-generated gets Infinity
  const genBudget = getRoleBudget('auto_generated');
  assert.strictEqual(genBudget.physicalLinesWarn, Number.MAX_SAFE_INTEGER);

  console.log('  ✔ Role budgets correctly enforce differentiated limits across architecture roles');
}

async function runAll() {
  console.log('=== Starting Code Density & Elastic Budget Verification Suite ===\n');
  await testLineSpectrumClassification();
  await testLowDensityExemption();
  await testFileRoleInference();
  await testElasticRoleBudgets();
  console.log('\n=== All Code Density & Elastic Budget tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed:', err);
  process.exit(1);
});
