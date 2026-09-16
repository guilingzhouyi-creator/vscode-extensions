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
} = require('../dist/core/scoring/scoringTypes.js');

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
};

/**
 * Narrow analyzer set: everything explicitly disabled except the constants analyzer, so the
 * evaluability contract is tested against the engine's defaults rather than assumed from them.
 */
const NARROW_ANALYZERS = Object.fromEntries(
  Object.keys(ALL_ANALYZERS).map((id) => [id, { enabled: id === 'constants' }]),
);

/** Dimensions that must survive the narrow scan (their analyzers are constants-based). */
const NARROW_EVALUATED = ['semanticPurity', 'duplication'];

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
 * Write the fixture and scan it with a given analyzer set.
 *
 * @param root - Fixture project root.
 * @param analyzers - Analyzer declaration map for the config file.
 * @returns Scan report.
 */
async function scanWith(root, analyzers) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(FIXTURE)) {
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

(async () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-score-narrow-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-score-full-'));
  try {
    // ── Narrow scan: only the constants analyzer runs ─────────────────────────────────────────
    const narrow = (await scanWith(rootA, NARROW_ANALYZERS)).qualityScore;
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

    // ── Control scan: every analyzer runs ─────────────────────────────────────────────────────
    const full = (await scanWith(rootB, ALL_ANALYZERS)).qualityScore;
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
    assert.ok(
      full.formulas.composite.includes('evaluated') && full.formulas.coverage.includes('evaluated'),
      'the published formulas must describe the evaluated-dimension weighting',
    );
    console.log(
      `  [PASS] control scan: coverage=${full.coverage}, confidence=${full.confidence} ` +
        `>= narrow confidence=${narrow.confidence}`,
    );
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }

  console.log('\n ALL SCORING COVERAGE CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
