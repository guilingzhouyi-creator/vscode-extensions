#!/usr/bin/env node
/**
 * Module: Verification Harness — Multi-Language Elastic LOC & Intra-File Zone Partitioning
 * File Path: scripts/validate-effective-loc.js
 * Architecture Role: Regression suite asserting multi-language verbosity normalization,
 *   human-readable metric parsing, and intra-file zone decomposition.
 * Dependencies & Triggers: `node scripts/validate-effective-loc.js`, part of test matrix.
 * Responsibilities:
 *   1. Assert parseHumanMetric accurately converts metric suffixes (1k, 2.5k, 50k, 1M);
 *   2. Assert multi-language verbosity matrix (Python 0.7, TS 1.0, Rust 1.25, Go 1.4);
 *   3. Assert dynamic role budget scaling under custom base effective LOC budgets;
 *   4. Assert intra-file semantic zone partitioning for compute kernels vs interface gateways;
 *   5. Assert resolveConfig cascades --effective-loc into large-file analyzer options.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on assertion failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { parseHumanMetric } = require('../dist/core/config/metric-parser');
const {
  getLanguageVerbosityFactor,
  getRoleBudget,
  LANGUAGE_VERBOSITY_FACTORS,
} = require('../dist/core/intelligence/elastic-budget-matrix');
const {
  partitionFileZones,
  ZONE_COMPUTE_KERNEL,
  ZONE_INTERFACE_GATEWAY,
  ZONE_LOOKUP_TABLE,
} = require('../dist/core/intelligence/zone-partitioner');
const { resolveConfig } = require('../dist/core/config');

function testMetricParser() {
  console.log('--- 1. Testing Human Metric Parser ---');
  assert.strictEqual(parseHumanMetric(800), 800);
  assert.strictEqual(parseHumanMetric('800'), 800);
  assert.strictEqual(parseHumanMetric('1k'), 1000);
  assert.strictEqual(parseHumanMetric('1K'), 1000);
  assert.strictEqual(parseHumanMetric('2.5k'), 2500);
  assert.strictEqual(parseHumanMetric('20k'), 20000);
  assert.strictEqual(parseHumanMetric('50k'), 50000);
  assert.strictEqual(parseHumanMetric('0.5M'), 500000);
  assert.strictEqual(parseHumanMetric('invalid', 800), 800);
  assert.strictEqual(parseHumanMetric(-100, 800), 800);
  console.log('  ✔ Metric parsing accurately converts scalar and human suffixes');
}

function testLanguageVerbosityMatrix() {
  console.log('--- 2. Testing Multi-Language Verbosity Matrix ---');
  assert.strictEqual(getLanguageVerbosityFactor('python'), 0.7);
  assert.strictEqual(getLanguageVerbosityFactor('.py'), 0.7);
  assert.strictEqual(getLanguageVerbosityFactor('typescript'), 1.0);
  assert.strictEqual(getLanguageVerbosityFactor('ts'), 1.0);
  assert.strictEqual(getLanguageVerbosityFactor('rust'), 1.25);
  assert.strictEqual(getLanguageVerbosityFactor('rs'), 1.25);
  assert.strictEqual(getLanguageVerbosityFactor('go'), 1.4);
  assert.strictEqual(getLanguageVerbosityFactor('unknown_lang'), 1.0);

  // Assert scaling on base budgets
  const pyBudget = getRoleBudget('business_module', 'python');
  const tsBudget = getRoleBudget('business_module', 'typescript');
  const rsBudget = getRoleBudget('business_module', 'rust');
  const goBudget = getRoleBudget('business_module', 'go');

  assert.strictEqual(pyBudget.effectiveLocWarn, Math.round(280 * 0.7));
  assert.strictEqual(tsBudget.effectiveLocWarn, 280);
  assert.strictEqual(rsBudget.effectiveLocWarn, Math.round(280 * 1.25));
  assert.strictEqual(goBudget.effectiveLocWarn, Math.round(280 * 1.4));

  // Assert custom base budget parameterization
  const customParamBudget = getRoleBudget('algorithm_computation', 'rust', 2000);
  assert(
    customParamBudget.effectiveLocWarn > 2000,
    'Custom base budget scales with Rust verbosity and algorithm role factor',
  );
  console.log(
    `  ✔ Dynamic multi-language elasticity confirmed: Python=${pyBudget.effectiveLocWarn} LOC, Rust=${rsBudget.effectiveLocWarn} LOC, Go=${goBudget.effectiveLocWarn} LOC`,
  );
}

function testIntraFileZonePartitioner() {
  console.log('--- 3. Testing Intra-File Semantic Zone Partitioner ---');
  const sampleContent = `
const TABLE_MATRIX = [1, 2, 3, 4, 5];
const MAPPING_DICT = { a: 1, b: 2 };

function computeKernelCore(data) {
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    acc += data[i] * 2;
  }
  return acc;
}

export function apiGatewayHandler(req) {
  return computeKernelCore(req.items);
}
`;

  const density = {
    physicalLines: 20,
    effectiveCodeLines: 14,
    effectiveDensity: 0.7,
    commentRatio: 0.0,
    blankRatio: 0.2,
    dataConfigRatio: 0.1,
    classificationCounts: {
      EFFECTIVE_CODE: 14,
      COMMENT_LINE: 0,
      BLANK_LINE: 4,
      FORMATTED_WRAP: 2,
      AUTO_GENERATED: 0,
      DATA_DECLARATION: 2,
      CONFIG_DECLARATION: 0,
      TEMPLATE_DSL: 0,
      FRAMEWORK_SCAFFOLD: 0,
    },
    isLowDensityDocumented: false,
  };

  const profile = partitionFileZones(sampleContent, 'sample-operator.ts', density);

  assert.strictEqual(typeof profile.entanglementIndex, 'number');
  assert.strictEqual(typeof profile.isDecoupled, 'boolean');
  assert(profile.segments.length >= 2, 'Detects multiple distinct semantic zones');
  assert(profile.distribution[ZONE_COMPUTE_KERNEL] > 0, 'Classifies compute kernel zone');
  console.log(
    `  ✔ Zone partitioner verified: ${profile.segments.length} segments identified, decoupled=${profile.isDecoupled}, EI=${profile.entanglementIndex}`,
  );
}

function testConfigPenetration() {
  console.log('--- 4. Testing CLI Parameter Penetration in Config ---');
  const cfg = resolveConfig({
    root: path.resolve(__dirname, '..'),
    effectiveLoc: 2000,
    fileLinesWarn: 3000,
  });

  assert.strictEqual(cfg.thresholds.fileLinesWarn, 3000);
  const largeFileOpts = cfg.analyzers['large-file']?.options || {};
  assert.strictEqual(largeFileOpts.effectiveLocWarn, 2000);
  assert.strictEqual(largeFileOpts.fileLinesWarn, 3000);
  console.log('  ✔ CLI parameter overrides successfully cascade to large-file analyzer options');
}

function main() {
  console.log('=== Running Elastic LOC & Zone Partitioner Verification ===');
  testMetricParser();
  testLanguageVerbosityMatrix();
  testIntraFileZonePartitioner();
  testConfigPenetration();
  console.log(
    '✔ [PASS] All multi-language elastic LOC & zone partitioner tests passed successfully!',
  );
}

main();
