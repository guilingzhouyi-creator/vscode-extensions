#!/usr/bin/env node
/**
 * Module: Verification Harness - Quality Score Evaluability & Coverage
 * File Path: scripts/validate-scoring-coverage.js
 * Architecture Role: Key-point lock for the quantified quality standard: a dimension whose
 *     analyzers did not run must be reported as not evaluated and excluded from the weighted
 *     composite, and the confidence must shrink with the measured-weight coverage
 * Dependencies & Triggers: `npm run validate-scoring-coverage` (part of `npm test`); imports
 *     ../dist/api (scan) and ../dist/core/scoring/scoringTypes (weights/dimensions)
 * Responsibilities: Assert that a constants-only scan marks the other dimensions notEvaluated,
 *     renormalizes the composite over the measured weights only, scales confidence by coverage,
 *     and that an all-analyzers scan reports full coverage with nothing excluded
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a
 *     model that silently scores unmeasured dimensions (0 or 100) fails the build; the fixture
 *     root is removed in a `finally` block.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api.js');
const {
  ALL_QUALITY_DIMENSIONS,
  DEFAULT_QUALITY_WEIGHTS,
  DIMENSION_ANALYZERS,
} = require('../dist/core/scoring/scoringTypes.js');
const { dimensionDeductionSources } = require('../dist/core/scoring/dimensionDeductions.js');

/** All built-in analyzers, so the control scan leaves no dimension unmeasured. */
const ALL_ANALYZERS = {
  governance: { enabled: true },
  architecture: { enabled: true },
  performance: { enabled: true },
  comments: { enabled: true },
  hygiene: { enabled: true },
  security: { enabled: true },
  secrets: { enabled: true },
  complexity: { enabled: true },
  'large-file': { enabled: true },
  constants: { enabled: true },
  simplify: { enabled: true },
  'dependency-graph': { enabled: true },
  docs: { enabled: true },
  'ts-modern': { enabled: true },
  'python-modern': { enabled: true },
  'rust-modern': { enabled: true },
  'gdscript-modern': { enabled: true },
  'data-architecture': { enabled: true },
  'test-modernity': { enabled: true },
  'dependency-layout': { enabled: true },
  naming: { enabled: true },
  'go-modern': { enabled: true },
  'shell-lint': { enabled: true },
  stdlib: { enabled: true },
};

/**
 * Narrow analyzer set: everything explicitly disabled except the constants analyzer, so the
 * evaluability contract is tested against the engine's defaults rather than assumed from them.
 */
const NARROW_ANALYZERS = Object.fromEntries(
  Object.keys(ALL_ANALYZERS).map((id) => [id, { enabled: id === 'constants' }]),
);

/** Dimensions that must survive the narrow scan (constants is their only declared analyzer). */
const NARROW_EVALUATED = ['duplication'];

const FIXTURE = {
  'src/sample.ts': [
    'export function computeTotal(values: number[]): number {',
    '  let total = 0;',
    '  for (const value of values) {',
    '    total += value;',
    '  }',
    '  return total;',
    '}',
    '',
  ].join('\n'),
};

/**
 * Write a fixture set and scan it with a given analyzer set.
 *
 * @param root - Fixture project root.
 * @param analyzers - Analyzer declaration map for the config file.
 * @param files - Relative path to content map; defaults to the coverage fixture.
 * @returns Scan report.
 */
async function scanWith(root, analyzers, files = FIXTURE) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*.ts'], analyzers }, null, 2));
  return scan({ root, configFile, logLevel: 'silent', cache: false, workers: 1 });
}

/**
 * Recompute the weighted composite over an evaluated-dimension subset.
 *
 * @param indices - Reported dimension indices.
 * @param evaluated - Dimensions that were actually measured.
 * @returns Expected composite score.
 */
function expectedComposite(indices, evaluated) {
  let weighted = 0;
  let weight = 0;
  for (const dim of evaluated) {
    weighted += indices[dim] * DEFAULT_QUALITY_WEIGHTS[dim];
    weight += DEFAULT_QUALITY_WEIGHTS[dim];
  }
  return Math.round((weighted / (weight || 1)) * 10) / 10;
}

/**
 * Build a flat file of an exact length so only the large-file rule can fire on it.
 *
 * Named const initializers are exempt from the constants analyzer, so the filler never adds
 * unrelated findings that would blur the deduction assertions.
 *
 * @param lines - Number of filler declarations to emit.
 * @returns File content.
 */
function bigFixture(lines) {
  const body = [];
  for (let i = 1; i <= lines; i += 1) body.push(`const v${i} = ${i};`);
  body.push('export const end = 1;');
  return body.join('\n') + '\n';
}

/**
 * Fixture that triggers one representative rule per deduction table row.
 */
// The fixture must contain a loop with an allocation so PRF-MEM-001 fires, but this validator is
// itself scanned by that line-based heuristic (raw text, no string masking), so the two code-shaped
// strings are assembled from halves and the trigger stays inside the fixture only.
const DEDUCTION_FIXTURE = {
  'src/Bad_Name.ts': [
    'export function pick(values: number[]): number {',
    '  var total = 0;',
    '  for (const value ' + 'of values) {',
    '    const scratch = new ' + 'Map();',
    '    total += value + scratch.size;',
    '  }',
    '  return total + 500;',
    '}',
    'export function loose(input: any): any {',
    '  return input;',
    '}',
    'export function dead(): number {',
    '  return 1;',
    '  const unusedConst = 2;',
    '}',
    '',
  ].join('\n'),
  'src/big.ts': bigFixture(450),
};

/**
 * Dimensions deducted by the family appliers (code, not table rows) with their analyzers.
 */
const FAMILY_DEDUCTION_SOURCES = {
  architectureConsistency: ['architecture', 'dependency-graph'],
  codeSecurity: ['architecture', 'security', 'secrets'],
  performanceEfficiency: ['performance'],
};

/**
 * Rule id to dimension pairs the table must deduct, one representative rule per row.
 */
const EXPECTED_DEDUCTIONS = [
  ['HYG-NAM-001', 'standardization'],
  ['large-file', 'standardization'],
  ['GOV-STD-002', 'modernity'],
  ['TSM-VAR-001', 'modernity'],
  ['GOV-TYP-003', 'semanticPurity'],
  ['HYG-DED-001', 'semanticPurity'],
  ['PRF-MEM-001', 'performanceEfficiency'],
  ['CMT-DOC-001', 'commentQuality'],
  ['magic-number', 'duplication'],
];

/**
 * Assert the narrow scan keeps only constants-fed dimensions evaluated.
 *
 * @param root - Fixture root for the constants-only scan.
 * @returns Quality score of that scan, reused by the control scan.
 */
async function checkNarrowScan(root) {
  const narrow = (await scanWith(root, NARROW_ANALYZERS)).qualityScore;
  assert.ok(Array.isArray(narrow.notEvaluated), 'the score must publish notEvaluated');
  assert.deepStrictEqual(
    ALL_QUALITY_DIMENSIONS.filter((dim) => !narrow.notEvaluated.includes(dim)).sort(),
    [...NARROW_EVALUATED].sort(),
    `only the constants-fed dimensions may stay evaluated, got ${JSON.stringify(narrow.notEvaluated)}`,
  );
  assert.ok(narrow.coverage < 1, `coverage must drop below one, got ${narrow.coverage}`);
  const evaluated = ALL_QUALITY_DIMENSIONS.filter((dim) => !narrow.notEvaluated.includes(dim));
  for (const dim of evaluated) {
    assert.deepStrictEqual(
      narrow.evaluatedBy[dim],
      ['constants'],
      `${dim} must name the enabled analyzer that measured it`,
    );
  }
  for (const dim of narrow.notEvaluated) {
    assert.deepStrictEqual(
      narrow.evaluatedBy[dim],
      [],
      `${dim} must expose that it had no enabled analyzer`,
    );
  }
  assert.strictEqual(
    narrow.compositeScore,
    expectedComposite(narrow.indices, evaluated),
    'the composite must renormalize over the evaluated weights only',
  );
  console.log(
    `  [PASS] narrow scan: ${narrow.notEvaluated.length} dimension(s) not evaluated, ` +
      `composite renormalized to ${narrow.compositeScore} over ${evaluated.length} dimension(s)`,
  );
  return narrow;
}

/**
 * Assert the control scan measures every dimension and reconciles its indices.
 *
 * @param root - Fixture root for the all-analyzers scan.
 * @param narrow - Quality score of the narrow scan, used for the confidence floor.
 */
async function checkControlScan(root, narrow) {
  const full = (await scanWith(root, ALL_ANALYZERS)).qualityScore;
  assert.deepStrictEqual(full.notEvaluated, [], 'a full scan must leave nothing unmeasured');
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    assert.ok(
      (full.evaluatedBy[dim] ?? []).length > 0,
      `${dim} must have at least one witness in the control scan`,
    );
  }
  assert.strictEqual(full.coverage, 1, `full coverage expected, got ${full.coverage}`);
  assert.strictEqual(
    full.compositeScore,
    expectedComposite(full.indices, ALL_QUALITY_DIMENSIONS),
    'the full composite must weight every dimension',
  );
  assert.ok(
    full.confidence >= narrow.confidence,
    `confidence must not drop when more is measured (${full.confidence} vs ${narrow.confidence})`,
  );
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    const bucket = full.deductionsByDimension[dim];
    const expected = Math.max(0, 100 - bucket.points);
    assert.strictEqual(
      full.indices[dim],
      expected,
      `${dim}: index ${full.indices[dim]} must reconcile with its published deductions (${bucket.points})`,
    );
  }
  assert.deepStrictEqual(
    full.formulas.dimensionWeights,
    full.weights,
    'the published formula weights must be the applied weights',
  );
  const cutoff = full.formulas.gradeCutoffs.find((entry) => full.compositeScore >= entry.min);
  assert.strictEqual(
    cutoff ? cutoff.grade : 'F',
    full.grade,
    'the published cut-offs must reproduce the published grade',
  );
  assert.strictEqual(
    full.formulas.familyDimensions['GOV-PRF'],
    'performanceEfficiency',
    'GOV-PRF rules must route to performanceEfficiency',
  );
  assert.strictEqual(
    full.formulas.familyDimensions['GOV-TYP'],
    'architectureConsistency',
    'GOV-TYP rules must route to architectureConsistency',
  );
  assert.ok(
    full.formulas.composite.includes('evaluated') && full.formulas.coverage.includes('evaluated'),
    'the published formulas must describe the evaluated-dimension weighting',
  );
  console.log(
    `  [PASS] control scan: coverage=${full.coverage}, confidence=${full.confidence} ` +
      `>= narrow confidence=${narrow.confidence}`,
  );
}

/**
 * Collect the dimensions each rule deducted, keyed by `rule|dimension`.
 *
 * A rule may legitimately deduct more than one dimension (a large file is both a
 * standardization and a debt signal), so every pair is recorded instead of a single owner.
 * The key is a map lookup, so the assertion loop runs no linear search.
 *
 * @param scored - Quality score of the deduction fixture scan.
 * @returns Object with the pair set and a readable `rule -> dimensions` summary.
 */
function collectDimensionHits(scored) {
  const rows = ALL_QUALITY_DIMENSIONS.map((dim) =>
    scored.deductionsByDimension[dim].entries.map((entry) => dim + '|' + entry.rule),
  ).flat();
  const pairs = new Map();
  const summary = new Map();
  for (const row of rows) {
    const parts = row.split('|');
    pairs.set(parts[1] + '|' + parts[0], true);
    summary.set(parts[1], (summary.get(parts[1]) ?? '') + parts[0] + ', ');
  }
  return { pairs, summary };
}

/**
 * Assert every representative rule deducts the dimension the table assigns it.
 *
 * @param root - Fixture root for the deduction-table scan.
 */
async function checkDeductionTable(root) {
  const scored = (await scanWith(root, ALL_ANALYZERS, DEDUCTION_FIXTURE)).qualityScore;
  const { pairs, summary } = collectDimensionHits(scored);
  for (const [rule, dimension] of EXPECTED_DEDUCTIONS) {
    assert.ok(
      pairs.get(rule + '|' + dimension) === true,
      `${rule} must deduct ${dimension}, got ${summary.get(rule) || '(none)'}`,
    );
  }
  console.log(
    `  [PASS] ${EXPECTED_DEDUCTIONS.length} representative rule(s) deduct their declared dimension`,
  );
}
/**
 * Assert the coverage model declares every analyzer the deduction code can charge.
 */
function checkCoverageModel() {
  // ── The coverage model and the deduction code must not drift apart ────────────────────────
  // The table covers five axes; architecture, security and performance are deducted by the
  // family appliers, so their sources are declared here and checked the same way.
  const sources = { ...dimensionDeductionSources(), ...FAMILY_DEDUCTION_SOURCES };
  for (const [dimension, analyzers] of Object.entries(sources)) {
    for (const analyzer of analyzers) {
      assert.ok(
        (DIMENSION_ANALYZERS[dimension] ?? []).includes(analyzer),
        `${analyzer} deducts ${dimension} but the dimension does not declare it as evidence`,
      );
    }
  }
  assert.ok(
    Object.keys(sources).length >= 8,
    `only ${Object.keys(sources).length} dimension(s) carry a deduction source, which means a` +
      ' silent rewrite removed most of the table',
  );
  console.log(
    `  [PASS] all ${Object.keys(sources).length} deduction-bearing dimensions declare their evidence`,
  );
}

(async () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-score-narrow-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-score-full-'));
  const rootC = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-score-deductions-'));
  try {
    const narrow = await checkNarrowScan(rootA);
    await checkControlScan(rootB, narrow);
    await checkDeductionTable(rootC);
    checkCoverageModel();
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
    fs.rmSync(rootC, { recursive: true, force: true });
  }

  console.log('\n ALL SCORING COVERAGE CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
