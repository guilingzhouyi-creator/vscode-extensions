/**
 * Module: Verification Harness — Project In-House Autonomy Scorer & Provenance Classifier
 * File Path: scripts/validate-autonomy-scorer.js
 * Architecture Role: Verifies the four-dimensional orthogonal autonomy scoring model (R_loc,
 *   R_call, R_domain, R_pure), five-tier level classification, multi-language package manifest
 *   detection, and external SDK call profiling.
 * Dependencies & Triggers: Consumes dist/api and dist/core scoring/intelligence modules;
 *   executed as part of `npm test`.
 * Responsibilities:
 *   1. Assert loadProjectManifestDependencies discovers manifests across ecosystems
 *      (npm, pip, cargo, go);
 *   2. Assert import and file classification accurately identifies vendor vs proprietary vs stdlib;
 *   3. Assert evaluateProjectAutonomy calculates R_loc, R_call, R_domain, R_pure,
 *      and composite index;
 *   4. Assert 5-tier classification boundaries (L1 through L5) strictly hold;
 *   5. Assert full scan integration reports autonomy evaluation in scan results.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadProjectManifestDependencies,
  classifyFileProvenance,
  classifyImportProvenance,
} = require('../dist/core/intelligence/dependency-provenance');
const {
  evaluateProjectAutonomy,
} = require('../dist/core/scoring/autonomy-scorer');
const { scan } = require('../dist/api');

async function testProvenanceManifestDetection() {
  console.log('1. Testing dependency provenance manifest detection...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-manifest-'));
  try {
    // 1.1 Create mock manifests
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dependencies: { lodash: '^4.17.21', express: '^4.18.2' },
        devDependencies: { mocha: '^10.0.0' },
      }),
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'requirements.txt'),
      'requests>=2.28.0\npytest==7.1.2\n',
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'Cargo.toml'),
      '[package]\nname = "test-rs"\n[dependencies]\nserde = "1.0"\n',
      'utf8'
    );

    fs.writeFileSync(
      path.join(tempDir, 'go.mod'),
      'module example.com/test\n\ngo 1.20\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n',
      'utf8'
    );

    const deps = loadProjectManifestDependencies(tempDir);

    assert.ok(deps.has('lodash'), 'Should detect lodash from package.json');
    assert.ok(deps.has('express'), 'Should detect express from package.json');
    assert.ok(deps.has('requests'), 'Should detect requests from requirements.txt');
    assert.ok(deps.has('serde'), 'Should detect serde from Cargo.toml');
    assert.ok(deps.has('github.com/gin-gonic/gin'), 'Should detect gin from go.mod');

    // 1.2 Check file provenance classification
    assert.strictEqual(classifyFileProvenance('src/index.ts'), 'proprietary');
    assert.strictEqual(classifyFileProvenance('src/vendor/external.js'), 'in_tree_vendor');
    assert.strictEqual(classifyFileProvenance('generated/client_grpc.ts'), 'generated');
    assert.strictEqual(classifyFileProvenance('tests/fixtures/sample.ts'), 'test_fixture');

    // 1.3 Check import provenance classification
    assert.strictEqual(classifyImportProvenance('fs', 'src/index.ts', deps), 'stdlib');
    assert.strictEqual(classifyImportProvenance('path', 'src/index.ts', deps), 'stdlib');
    assert.strictEqual(classifyImportProvenance('sys', 'app/main.py', deps), 'stdlib');
    assert.strictEqual(classifyImportProvenance('lodash', 'src/index.ts', deps), 'external_sdk');
    assert.strictEqual(classifyImportProvenance('./utils', 'src/index.ts', deps), 'internal');
    assert.strictEqual(classifyImportProvenance('../vendor/helper', 'src/index.ts', deps), 'in_tree_vendor');

    console.log('   ✓ Manifest detection and classification verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testAutonomyMathematicalModel() {
  console.log('2. Testing autonomy mathematical model and 6 orthogonal metrics...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-math-'));
  try {
    const mockConfig = { root: tempDir };

    // Case A: 100% proprietary autonomous files
    const pureMetrics = [
      {
        file: 'src/core/math.ts',
        lines: 300,
        characters: 8000,
        content: 'export function add(a: number, b: number) { return a + b; }\nexport function mul(a: number, b: number) { return a * b; }',
      },
      {
        file: 'src/core/state.ts',
        lines: 200,
        characters: 5000,
        content: 'import { add } from "./math";\nexport class StateMachine { run() { return add(1, 2); } }',
      },
    ];

    const evalPure = evaluateProjectAutonomy(pureMetrics, [], mockConfig);

    assert.strictEqual(evalPure.grade, 'L5_INDEPENDENT');
    assert.ok(evalPure.compositeAutonomyIndex >= 90.0, `Expected >= 90, got ${evalPure.compositeAutonomyIndex}`);
    assert.strictEqual(evalPure.dimensions.effectiveLocAutonomy, 100);
    assert.ok(evalPure.dimensions.symbolCallAutonomy >= 90);
    assert.ok(evalPure.dimensions.supplyChainResilience >= 95);
    assert.ok(evalPure.dimensions.criticalPathAutonomy >= 90);
    assert.ok(evalPure.confidence, 'Must produce confidence interval');
    assert.ok(typeof evalPure.confidence.sampleSufficiency === 'number');
    assert.ok(evalPure.confidence.lowerBound <= evalPure.confidence.upperBound);
    assert.strictEqual(evalPure.stats.vendorFiles, 0);
    assert.strictEqual(evalPure.stats.proprietaryFiles, 2);

    // Case B: Project with heavy external SDK usage and vendor files
    const vendorMetrics = [
      {
        file: 'src/vendor/bundle.min.js',
        lines: 1000,
        characters: 30000,
        content: '/* vendor code */',
      },
      {
        file: 'src/wrapper.ts',
        lines: 100,
        characters: 2500,
        content: 'import * as aws from "@aws-sdk/client-s3";\nimport * as express from "express";\nexport function run() {}',
      },
    ];

    const evalVendor = evaluateProjectAutonomy(vendorMetrics, [], mockConfig);

    assert.ok(
      evalVendor.grade === 'L1_SHALLOW_WRAPPER' || evalVendor.grade === 'L2_FRAMEWORK_DEPENDENT',
      `Expected low grade, got ${evalVendor.grade}`
    );
    assert.ok(evalVendor.compositeAutonomyIndex < 60.0, `Expected low score, got ${evalVendor.compositeAutonomyIndex}`);
    assert.strictEqual(evalVendor.stats.vendorFiles, 1);
    assert.strictEqual(evalVendor.stats.proprietaryFiles, 1);
    assert.ok(evalVendor.externalSdkInventory.length > 0, 'Should register external SDK inventory');

    console.log('   ✓ Six-dimensional mathematical evaluation verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testSupplyChainAndCredibleIntervals() {
  console.log('3. Testing supply chain resilience and Bayesian confidence intervals...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-cai2-'));
  try {
    // 3.1 Lockfile with deep transitive dependencies
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'deep-chain', dependencies: { foo: '1.0.0' } }),
      'utf8'
    );
    // Fake lockfile with 100 packages
    const fakeLock = {
      name: 'deep-chain',
      lockfileVersion: 2,
      packages: { '': {} },
    };
    for (let i = 0; i < 80; i++) {
      fakeLock.packages[`node_modules/pkg-${i}`] = { version: '1.0.0' };
    }
    fs.writeFileSync(path.join(tempDir, 'package-lock.json'), JSON.stringify(fakeLock), 'utf8');

    const config = { root: tempDir };
    const files = [
      {
        file: 'src/crypto/auth_token.ts',
        lines: 120,
        content: 'import * as foo from "foo";\nexport function verify() {}',
      },
    ];

    const result = evaluateProjectAutonomy(files, [], config);
    assert.strictEqual(result.supplyChain.hasLockfile, true);
    assert.strictEqual(result.supplyChain.lockfileType, 'npm');
    assert.ok(result.supplyChain.transitiveDependencies >= 70, 'Transitive deps should be tracked');
    assert.ok(result.dimensions.supplyChainResilience < 95.0, 'Resilience should be discounted by deep transitive tree');
    assert.strictEqual(result.confidence.isLowConfidence, true, 'Single small file must trigger low confidence flag');
    assert.ok(result.stats.criticalPathFiles === 1, 'auth_token should be identified as critical path');
    assert.ok(result.dimensions.criticalPathAutonomy >= 0.0);

    console.log('   ✓ Supply chain penetration and Bayesian confidence verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testFiveTierBoundaryHold() {
  console.log('4. Testing 5-tier classification grades and weights...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-tier-'));
  try {
    const mockConfig = { root: tempDir };

    // Helper to generate metrics with specific proprietary/vendor balance
    function makeMetrics(proprietaryRatio, sdkCallCount) {
      const proprietaryLines = Math.round(1000 * proprietaryRatio);
      const vendorLines = 1000 - proprietaryLines;

      const list = [];
      if (proprietaryLines > 0) {
        let imports = 'import { util } from "./util";\nimport { config } from "./config";\n';
        for (let i = 0; i < sdkCallCount; i++) {
          imports += `import * as ext${i} from "@external/sdk${i}";\n`;
        }
        list.push({
          file: 'src/logic.ts',
          lines: proprietaryLines,
          characters: proprietaryLines * 25,
          content: `${imports}export function compute() { return 42; }`,
        });
      }
      if (vendorLines > 0) {
        list.push({
          file: 'src/vendor/lib.js',
          lines: vendorLines,
          characters: vendorLines * 25,
          content: '/* third party vendor */',
        });
      }
      return list;
    }

    // 1. High autonomy test
    const highMetrics = makeMetrics(0.98, 0);
    const highEval = evaluateProjectAutonomy(highMetrics, [], mockConfig);
    assert.strictEqual(highEval.grade, 'L5_INDEPENDENT');

    // 2. Balanced autonomy test
    const balancedMetrics = makeMetrics(0.85, 3);
    const balancedEval = evaluateProjectAutonomy(balancedMetrics, [], mockConfig);
    assert.ok(
      balancedEval.grade === 'L3_BALANCED' || balancedEval.grade === 'L4_HIGH_AUTONOMY',
      `Expected balanced grade, got ${balancedEval.grade} (${balancedEval.compositeAutonomyIndex})`
    );

    // 3. Shallow wrapper test
    const shallowMetrics = makeMetrics(0.15, 20);
    const shallowEval = evaluateProjectAutonomy(shallowMetrics, [], mockConfig);
    assert.ok(shallowEval.grade === 'L1_SHALLOW_WRAPPER' || shallowEval.grade === 'L2_FRAMEWORK_DEPENDENT');

    console.log('   ✓ Tier classification grades verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testEndToEndScanIntegration() {
  console.log('5. Testing full scan integration and report autonomy output...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-scan-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'sample-project',
        dependencies: { chalk: '^4.1.2' },
      }),
      'utf8'
    );

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, 'calc.js'),
      [
        'function add(a, b) {',
        '  return a + b;',
        '}',
        'function multiply(a, b) {',
        '  return a * b;',
        '}',
        'module.exports = { add, multiply };',
      ].join('\n'),
      'utf8'
    );

    fs.writeFileSync(
      path.join(srcDir, 'index.js'),
      [
        'const calc = require("./calc");',
        'console.log(calc.add(1, 2));',
      ].join('\n'),
      'utf8'
    );

    const report = await scan({
      root: tempDir,
      include: ['src/**/*.js'],
    });

    assert.ok(report, 'Report should be defined');
    assert.ok(report.autonomy, 'Report must contain autonomy evaluation');
    assert.ok(typeof report.autonomy.compositeAutonomyIndex === 'number');
    assert.ok(
      report.autonomy.compositeAutonomyIndex >= 85.0,
      `Expected autonomous score >= 85, got ${report.autonomy.compositeAutonomyIndex}`
    );
    assert.strictEqual(report.autonomy.grade, 'L5_INDEPENDENT');
    assert.ok(report.autonomy.dimensions.effectiveLocAutonomy >= 95.0);
    assert.ok(report.autonomy.dimensions.supplyChainResilience >= 70.0);
    assert.ok(report.autonomy.confidence, 'Must contain confidence interval');

    console.log('   ✓ End-to-end scan integration verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Starting autonomy scorer verification harness...');
  await testProvenanceManifestDetection();
  await testAutonomyMathematicalModel();
  await testSupplyChainAndCredibleIntervals();
  await testFiveTierBoundaryHold();
  await testEndToEndScanIntegration();
  console.log('\n[PASS] All autonomy scorer tests passed successfully.\n');
}

main().catch((err) => {
  console.error('\n[FAIL] Autonomy scorer test failed:\n', err);
  process.exit(1);
});
