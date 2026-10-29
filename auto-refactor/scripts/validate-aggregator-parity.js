#!/usr/bin/env node
/**
 * Module: Verification Harness — Backend-Agnostic Adjudication
 * File Path: scripts/validate-aggregator-parity.js
 * Architecture Role: Proves the adjudication layer is not coupled to the engine's own analyzers.
 *   A second stage that only works on the findings of the first stage is not an adjudicator, it is
 *   a continuation of the generator — it can only ever agree with what its sibling produced. The
 *   point of separating proposal from judgement is that the judge accepts proposals from anywhere.
 * Dependencies & Triggers: consumes ../dist/core/scoring/finding-confidence-arbiter,
 *   ../dist/core/scoring/confidence-calibration and ../dist/core/reporting/review-queue; run by
 *   `npm test` through scripts/test-parallel.js.
 * Responsibilities:
 *   1. Synthesize records in the shapes four foreign backends actually emit (the engine's own
 *      analyzers, ESLint, Clippy, Semgrep), mapping each to the shared `Issue` contract.
 *   2. Assert identical inputs adjudicate to identical tiers regardless of which backend the
 *      record claims to come from — the backend name must be metadata, never a decision input.
 *   3. Assert the two things that legitimately change a verdict (severity and an executable
 *      patch) change it for every backend in exactly the same way.
 *   4. Assert recorded outcomes calibrate a foreign rule just as they calibrate a native one.
 * Exit Semantics & Design Rationale: Exits 0 when foreign input adjudicates like native input,
 *   1 naming the first divergence. Byte-identical tiering is the assertion, not "no crash": an
 *   arbiter that silently downgrades unknown analyzers to advisory would pass a smoke test and be
 *   exactly the coupling this suite exists to catch.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arbiterModule = require(path.join(ROOT, 'dist/core/scoring/finding-confidence-arbiter'));
const queueModule = require(path.join(ROOT, 'dist/core/reporting/review-queue'));

const { FindingConfidenceArbiter } = arbiterModule;
const { categorizeForReview, buildReviewQueue } = queueModule;

/**
 * Describes one foreign backend's record shape and how to normalize it.
 *
 * Each entry mirrors the fields the real tool emits: ESLint reports a float `severity` and a
 * `messageId`; Clippy reports a `code.code` lint name and a span; Semgrep reports `check_id` with
 * a metadata confidence string. None of that reaches the arbiter unchanged — the adapter maps it
 * all onto the same `Issue` contract, which is precisely why the arbiter must not care.
 */
const BACKENDS = [
  {
    name: 'engine',
    toIssue: (normalized) => ({
      id: `constants:${normalized.rule}:src/a.ts:1`,
      analyzer: 'constants',
      rule: normalized.rule,
      severity: normalized.severity,
      message: normalized.message,
      location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
      detail: {},
      ...(normalized.patch
        ? {
            actionable: {
              action: 'extract_constant',
              code: 'AR:CONST:001',
              safeToAutomate: true,
              templateSnippet: normalized.patch,
            },
          }
        : {}),
    }),
  },
  {
    name: 'eslint',
    toIssue: (normalized) => ({
      id: `eslint:${normalized.rule}:src/a.ts:1`,
      analyzer: 'eslint',
      rule: normalized.rule,
      severity: normalized.severity,
      message: normalized.message,
      location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
      detail: {
        messageId: normalized.rule,
        backendSeverity: normalized.severity === 'error' ? 2 : 1,
      },
      ...(normalized.patch
        ? {
            actionable: {
              action: 'replace_inline',
              code: 'ESLINT:FIX',
              safeToAutomate: true,
              templateSnippet: normalized.patch,
            },
          }
        : {}),
    }),
  },
  {
    name: 'clippy',
    toIssue: (normalized) => ({
      id: `clippy:${normalized.rule}:src/a.ts:1`,
      analyzer: 'clippy',
      rule: normalized.rule,
      severity: normalized.severity === 'error' ? 'error' : 'warning',
      message: normalized.message,
      location: { file: 'src/a.rs', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
      detail: { code: { code: normalized.rule, explanation: null } },
      ...(normalized.patch
        ? {
            actionable: {
              action: 'replace_inline',
              code: 'CLIPPY:SUGGESTION',
              safeToAutomate: true,
              templateSnippet: normalized.patch,
            },
          }
        : {}),
    }),
  },
  {
    name: 'semgrep',
    toIssue: (normalized) => ({
      id: `semgrep:${normalized.rule}:src/a.ts:1`,
      analyzer: 'semgrep',
      rule: normalized.rule,
      severity: normalized.severity,
      message: normalized.message,
      location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
      detail: { check_id: normalized.rule, metadata: { confidence: 'MEDIUM' } },
      ...(normalized.patch
        ? {
            actionable: {
              action: 'replace_inline',
              code: 'SEMGREP:AUTOFIX',
              safeToAutomate: true,
              templateSnippet: normalized.patch,
            },
          }
        : {}),
    }),
  },
];

/** Cases covering the three tiers plus both directions the severity floor can move. */
const CASES = [
  { label: 'plain warning, no patch', rule: 'AR-DEMO-001', severity: 'warning' },
  {
    label: 'plain warning, patch',
    rule: 'AR-DEMO-002',
    severity: 'warning',
    patch: 'const V = 1;',
  },
  { label: 'error, no patch', rule: 'AR-DEMO-003', severity: 'error' },
  { label: 'error, patch', rule: 'AR-DEMO-004', severity: 'error', patch: 'const V = 2;' },
  { label: 'info, no patch', rule: 'AR-DEMO-005', severity: 'info' },
  { label: 'complexity rule, no patch', rule: 'high-complexity', severity: 'warning' },
  { label: 'syntax rule, no patch', rule: 'SYN-UNEXPECTED-TOKEN', severity: 'warning' },
];

/**
 * Adjudicates every case through every backend.
 *
 * @param options - Arbiter options applied uniformly to every backend.
 * @returns Backend name to case label to adjudicated result.
 */
function adjudicateAll(options) {
  const results = new Map();
  for (const backend of BACKENDS) {
    const arbiter = new FindingConfidenceArbiter(options);
    const perCase = new Map();
    for (const testCase of CASES) {
      const normalized = {
        rule: testCase.rule,
        severity: testCase.severity,
        message: testCase.label,
        ...(testCase.patch ? { patch: testCase.patch } : {}),
      };
      perCase.set(testCase.label, arbiter.arbitrateFinding(backend.toIssue(normalized)));
    }
    results.set(backend.name, perCase);
  }
  return results;
}

/**
 * Stage 1: identical evidence must yield identical tiering across backends.
 */
function verifyTierParity() {
  console.log('\n1. Verifying identical evidence adjudicates identically across backends...');
  const results = adjudicateAll({});
  const baseline = results.get('engine');
  for (const backend of BACKENDS) {
    if (backend.name === 'engine') continue;
    const perCase = results.get(backend.name);
    for (const testCase of CASES) {
      const expected = baseline.get(testCase.label);
      const actual = perCase.get(testCase.label);
      assert.strictEqual(
        actual.tier,
        expected.tier,
        `tier diverged for "${testCase.label}": engine=${expected.tier} ` +
          `${backend.name}=${actual.tier}`,
      );
      assert.strictEqual(
        actual.mustBlock,
        expected.mustBlock,
        `gate authority diverged for "${testCase.label}" under ${backend.name}`,
      );
      assert.strictEqual(
        actual.confidence,
        expected.confidence,
        `confidence diverged for "${testCase.label}" under ${backend.name}`,
      );
      assert.strictEqual(
        actual.rationale,
        expected.rationale,
        `rationale diverged for "${testCase.label}" under ${backend.name}`,
      );
    }
  }
  const tiers = [...baseline.values()].map((entry) => entry.tier);
  assert.ok(
    new Set(tiers).size >= 2,
    `the corpus must exercise several tiers, saw ${tiers.join()}`,
  );
  console.log(
    `  ✔ ${BACKENDS.length} backends x ${CASES.length} cases byte-identical; tiers exercised: ` +
      `${[...new Set(tiers)].sort().join(', ')}.`,
  );
}

/**
 * Stage 2: the two inputs that legitimately move a verdict must move it for every backend.
 */
function verifyVerdictDrivers() {
  console.log('\n2. Verifying severity and patches drive verdicts regardless of backend...');
  const results = adjudicateAll({});
  for (const backend of BACKENDS) {
    const perCase = results.get(backend.name);
    const errorNoPatch = perCase.get('error, no patch');
    const warningNoPatch = perCase.get('plain warning, no patch');
    const warningPatch = perCase.get('plain warning, patch');
    assert.strictEqual(
      errorNoPatch.mustBlock,
      true,
      `${backend.name}: an error-severity finding on an active rule must stay blocking`,
    );
    assert.strictEqual(
      warningNoPatch.mustBlock,
      false,
      `${backend.name}: a warning without a patch must not block`,
    );
    assert.strictEqual(
      warningPatch.tier,
      'actionable',
      `${backend.name}: a mechanically patchable warning must be actionable`,
    );
    assert.ok(
      warningPatch.confidence >= warningNoPatch.confidence,
      `${backend.name}: a patch must not lower confidence`,
    );
  }
  console.log('  ✔ severity floor and patch detection hold identically for all backends.');
}

/**
 * Stage 3: recorded outcomes must calibrate a foreign rule exactly as they calibrate a native one.
 */
function verifyCalibrationParity() {
  console.log('\n3. Verifying observed outcomes calibrate foreign rules...');
  const plain = adjudicateAll({});
  const calibrated = adjudicateAll({
    ruleCalibrationStats: [{ rule: 'AR-DEMO-002', truePositives: 2, falsePositives: 60 }],
  });
  const nativeBefore = plain.get('engine').get('plain warning, patch');
  const nativeAfter = calibrated.get('engine').get('plain warning, patch');
  assert.strictEqual(nativeBefore.confidenceSource, 'uncalibrated');
  assert.strictEqual(nativeAfter.confidenceSource, 'calibrated');
  assert.ok(
    nativeAfter.confidence < nativeBefore.confidence,
    `60 rejections must lower the adjudicated confidence: ${nativeBefore.confidence} -> ` +
      `${nativeAfter.confidence}`,
  );

  for (const backend of BACKENDS) {
    const after = calibrated.get(backend.name).get('plain warning, patch');
    assert.strictEqual(
      after.confidence,
      nativeAfter.confidence,
      `${backend.name} must be calibrated to the same posterior as the engine`,
    );
    assert.strictEqual(after.calibrationSampleSize, nativeAfter.calibrationSampleSize);
  }
  console.log(
    `  ✔ a rejected foreign rule falls ${nativeBefore.confidence} -> ${nativeAfter.confidence} ` +
      `on every backend (${nativeAfter.calibrationSampleSize} observations).`,
  );
}

/**
 * Stage 4: the human queue must project foreign findings without special-casing.
 */
function verifyQueueParity() {
  console.log('\n4. Verifying the human queue projects foreign findings unchanged...');
  const results = adjudicateAll({});
  const directories = new Map();
  for (const backend of BACKENDS) {
    const queue = buildReviewQueue([...results.get(backend.name).values()]);
    directories.set(
      backend.name,
      queue.map((record) => record.category),
    );
  }
  const baseline = directories.get('engine');
  for (const backend of BACKENDS) {
    assert.deepStrictEqual(
      directories.get(backend.name),
      baseline,
      `queue categories diverged under ${backend.name}`,
    );
  }
  assert.ok(baseline.length > 0, 'the corpus must produce at least one human-review item');
  for (const backend of BACKENDS) {
    for (const finding of results.get(backend.name).values()) {
      const category = categorizeForReview(finding);
      if (finding.mustBlock || finding.executablePatch) {
        assert.strictEqual(
          category,
          undefined,
          `${backend.name}: a blocking or patchable finding must not reach a human`,
        );
      }
    }
  }
  console.log(
    `  ✔ ${baseline.length} queue entries per backend, identical categories, ` +
      'no blocking or patchable finding queued.',
  );
}

/**
 * Stage 5: an unknown analyzer name must not change the verdict.
 */
function verifyUnknownAnalyzerNeutrality() {
  console.log('\n5. Verifying an unrecognized analyzer name is metadata, not a decision input...');
  const base = {
    rule: 'AR-DEMO-001',
    severity: 'warning',
    message: 'unknown backend',
  };
  const findings = ['engine', 'eslint', 'clippy', 'semgrep', 'some-future-linter'].map(
    (analyzer) => {
      const arbiter = new FindingConfidenceArbiter();
      return {
        analyzer,
        finding: arbiter.arbitrateFinding({
          id: `${analyzer}:AR-DEMO-001:src/a.ts:1`,
          analyzer,
          rule: base.rule,
          severity: base.severity,
          message: base.message,
          location: {
            file: 'src/a.ts',
            start: { line: 1, column: 1 },
            end: { line: 1, column: 4 },
          },
          detail: {},
        }),
      };
    },
  );
  const reference = findings[0].finding;
  for (const entry of findings) {
    assert.strictEqual(entry.finding.tier, reference.tier);
    assert.strictEqual(entry.finding.confidence, reference.confidence);
    assert.strictEqual(entry.finding.mustBlock, reference.mustBlock);
  }
  console.log(`  ✔ ${findings.length} analyzer names, one verdict.`);
}

function main() {
  console.log('=== Backend-Agnostic Adjudication Parity ===');
  verifyTierParity();
  verifyVerdictDrivers();
  verifyCalibrationParity();
  verifyQueueParity();
  verifyUnknownAnalyzerNeutrality();
  console.log(
    '\nConclusion: adjudication accepts any backend that speaks the Issue contract, and its ' +
      'verdicts depend on evidence alone ✔',
  );
}

try {
  main();
} catch (error) {
  console.error(`\n✖ Aggregator parity violation: ${error.message}`);
  process.exit(1);
}
