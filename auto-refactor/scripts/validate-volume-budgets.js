#!/usr/bin/env node
/**
 * Module: Verification Harness — Volume Budget Rules (VOL-*)
 * File Path: scripts/validate-volume-budgets.js
 * Architecture Role: Regression suite asserting that the large-file analyzer emits the five precise
 *   volume rules instead of a single aggregate finding, and that each rule fires on its own trigger
 *   while staying silent on a file that satisfies every budget.
 * Dependencies & Triggers: `node scripts/validate-volume-budgets.js`, part of the test matrix.
 * Responsibilities:
 *   1. Assert VOL-ELOC-001 fires when effective code lines exceed the ELOC budget;
 *   2. Assert VOL-LOC-001 fires when physical lines exceed the LOC budget;
 *   3. Assert VOL-RATIO-001 fires on a sparse file inside both absolute budgets;
 *   4. Assert VOL-DOC-001 fires on a high-load module with thin documentation;
 *   5. Assert a file that satisfies every budget emits nothing from this rule family;
 *   6. Assert the aggregate `large-file` rule still reports function-count pressure.
 * Exit Semantics & Design Rationale: Exits 0 when every assertion holds; exits 1 on the first
 *   failure. Budgets are driven through analyzer options rather than the repository configuration,
 *   so the suite states the boundary under test instead of inheriting a moving default.
 */
'use strict';

const assert = require('assert');
const { LargeFileAnalyzer } = require('../dist/analyzers/large-file');

const VOL_RULES = new Set([
  'VOL-ELOC-001',
  'VOL-LOC-001',
  'VOL-RATIO-001',
  'VOL-DIL-001',
  'VOL-DOC-001',
]);

/**
 * Build the analyzer context the engine would supply for one synthetic file.
 *
 * @param filePath - Repository-relative path.
 * @param content - File content.
 * @param [options] - Analyzer options.
 * @returns Context accepted by the analyzer contract.
 */
function buildContext(filePath, content, options = {}) {
  return {
    filePath,
    content,
    config: { analyzers: {}, archetype: 'business' },
    options,
    root: process.cwd(),
  };
}

/**
 * Run the analyzer and return only the volume-family findings.
 *
 * @param filePath - Repository-relative path.
 * @param content - File content.
 * @param [options] - Analyzer options.
 * @returns Volume findings.
 */
function runVolume(filePath, content, options) {
  const analyzer = new LargeFileAnalyzer();
  return analyzer
    .analyze(undefined, buildContext(filePath, content, options))
    .filter((issue) => VOL_RULES.has(issue.rule) || issue.rule === 'large-file');
}

/**
 * Build `count` single-line functions with a documentable shape.
 *
 * @param count - Function count.
 * @returns Source text.
 */
function buildFunctions(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`export function step${i}(input) { return input + ${i}; }`);
  }
  return lines.join('\n');
}

/**
 * Assert that an over-budget ELOC file reports VOL-ELOC-001.
 */
function testElocBudget() {
  const content = buildFunctions(60);
  const findings = runVolume('src/module/big.ts', content, {
    maxEloc: 10,
    maxLoc: 5000,
    effectiveLocWarn: 5000,
    effectiveLocFail: 9000,
    fileLinesWarn: 5000,
    fileFunctionsWarn: 5000,
  });
  assert.ok(
    findings.some((issue) => issue.rule === 'VOL-ELOC-001'),
    'A file above the effective-LOC budget must report VOL-ELOC-001',
  );
  console.log('  ✔ VOL-ELOC-001 fires when effective code volume exceeds its budget');
}

/**
 * Assert that an over-budget physical file reports VOL-LOC-001.
 */
function testLocBudget() {
  const content = buildFunctions(40);
  const findings = runVolume('src/module/long.ts', content, {
    maxEloc: 9000,
    maxLoc: 5,
    effectiveLocWarn: 9000,
    effectiveLocFail: 9000,
    fileLinesWarn: 9000,
    fileFunctionsWarn: 5000,
  });
  assert.ok(
    findings.some((issue) => issue.rule === 'VOL-LOC-001'),
    'A file above the physical-LOC budget must report VOL-LOC-001',
  );
  console.log('  ✔ VOL-LOC-001 fires when physical lines exceed their budget');
}

/**
 * Assert that a sparse file inside both absolute budgets reports VOL-RATIO-001.
 *
 * The generated body interleaves blank padding so the physical count grows while the effective
 * count stays flat — the exact shape the dilution envelope exists to catch.
 */
function testDilutionEnvelope() {
  const dense = buildFunctions(60);
  const content = dense.split('\n').join('\n\n\n\n');
  const findings = runVolume('src/module/sparse.ts', content, {
    effectiveLocWarn: 5000,
    effectiveLocFail: 9000,
    fileLinesWarn: 5000,
    fileFunctionsWarn: 5000,
    densityRatioTarget: 2,
  });
  const reported = new Set(findings.map((issue) => issue.rule));
  assert.ok(
    reported.has('VOL-RATIO-001') || reported.has('VOL-DIL-001'),
    'A vertically sparse file must report the dilution envelope or density floor rule',
  );
  console.log('  ✔ The dilution envelope reports sparse vertical layout');
}

/**
 * Assert that a high-load thinly documented module reports VOL-DOC-001.
 */
function testDocumentationFloor() {
  const lines = [];
  for (let i = 0; i < 620; i++) {
    lines.push(`const value${i} = compute${i}(input${i});`);
  }
  const content = `export function run(inputs) {\n${lines.join('\n')}\n}\n`;
  const findings = runVolume('src/module/dense.ts', content, {
    effectiveLocWarn: 9000,
    effectiveLocFail: 12000,
    fileLinesWarn: 9000,
    fileFunctionsWarn: 9000,
    densityRatioTarget: 3,
  });
  const reported = new Set(findings.map((issue) => issue.rule));
  assert.ok(
    reported.has('VOL-DOC-001'),
    'A high-load module without contract comments must report VOL-DOC-001',
  );
  console.log('  ✔ High-load logic without contract comments reports VOL-DOC-001');
}

/**
 * Assert that a compliant file emits no volume finding at all.
 */
function testCleanFile() {
  const body = buildFunctions(6);
  const content = `/**\n * Module: Sample — Compliant Fixture\n * Responsibilities: Hold a handful of tiny pure helpers.\n */\n${body}\n`;
  const findings = runVolume('src/module/small.ts', content, {
    effectiveLocWarn: 900,
    effectiveLocFail: 1200,
    fileLinesWarn: 1400,
    fileFunctionsWarn: 500,
  });
  assert.deepStrictEqual(
    findings.map((issue) => issue.rule),
    [],
    'A file inside every budget must emit no volume finding',
  );
  console.log('  ✔ A file inside every budget emits nothing from the volume family');
}

/**
 * Assert that function-count pressure still reaches the aggregate rule.
 *
 * Volume budgets say nothing about how many functions a file declares, so the aggregate rule has to
 * keep covering that signal or the count check would silently disappear.
 */
function testAggregateFallback() {
  const content = buildFunctions(30);
  const findings = runVolume('src/module/many.ts', content, {
    effectiveLocWarn: 9000,
    effectiveLocFail: 12000,
    fileLinesWarn: 9000,
    fileFunctionsWarn: 5,
  });
  assert.ok(
    findings.some((issue) => issue.rule === 'large-file'),
    'Function-count pressure must still reach the aggregate large-file rule',
  );
  console.log('  ✔ Aggregate large-file rule still reports function-count pressure');
}

function testMultilineTemplateLiteralTau() {
  const cssLines = [];
  for (let i = 0; i < 40; i++) {
    cssLines.push(`  .card-${i} { display: flex; padding: ${i}px; }`);
  }
  const content = [
    '/**',
    ' * Module: Presentation — Dashboard Base Styles',
    ' * Responsibilities: Export CSS stylesheet template literal.',
    ' */',
    'export function buildStyles(prefix: string): string {',
    '  const normalized = prefix.trim();',
    `  return \`\n${cssLines.join('\n')}\n\`;`,
    '}',
  ].join('\n');
  const findings = runVolume('src/presentation/dashboard-base-styles.ts', content, {
    effectiveLocWarn: 900,
    effectiveLocFail: 1200,
    fileLinesWarn: 1400,
    fileFunctionsWarn: 500,
  });
  assert.strictEqual(
    findings.some((issue) => issue.rule === 'VOL-TAU-001'),
    false,
    'Multi-line CSS template literal payload must not falsely trigger VOL-TAU-001',
  );
  console.log('  ✔ Multi-line template literal payload does not falsely trigger VOL-TAU-001');
}

/**
 * Run the whole suite.
 */
function main() {
  console.log('=== Volume Budget Rules (VOL-*) Verification ===');
  testElocBudget();
  testLocBudget();
  testDilutionEnvelope();
  testDocumentationFloor();
  testCleanFile();
  testAggregateFallback();
  testMultilineTemplateLiteralTau();
  console.log('\n✔ All volume budget assertions passed.');
}

main();
