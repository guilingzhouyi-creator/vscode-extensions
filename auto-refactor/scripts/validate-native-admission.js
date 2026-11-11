#!/usr/bin/env node
/**
 * Module: Verification Harness — Native Operator Admission Baseline
 * File Path: scripts/validate-native-admission.js
 * Architecture Role: Guards the condition under which an operator belongs on the native path. The
 *   Rust kernel is not faster by default — a `Vec<f64>` copied across the boundary and a per-line
 *   scan that allocates per hit can be slower than JS. Admission must be measured, not assumed.
 * Dependencies & Triggers: `dist/core/native` and
 *   `docs/01-architecture/native-admission-baseline.md`; run by `scripts/test-parallel.js`.
 * Responsibilities:
 *   1. Decode the baseline table from the architecture doc so prose and checks never drift.
 *   2. Build each payload deterministically and measure both tracks over repeated rounds.
 *   3. Fail when an `enforced` operator misses its ratio, or when the table is malformed.
 *   4. Report `documented` operators without blocking, since they record known-inadmissible shapes.
 * Exit Semantics & Design Rationale: Exits 0 when every enforced operator clears its ratio and the
 *   table parses, 1 otherwise. Ratios use best-of-N to keep the guard stable under a loaded
 *   machine: one cold run fails on noise instead of regressions, and flaky guards get disabled.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const { getNativeCoreStatus, nativeCore, PureJsNativeShim } = require('../dist/core/native');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_DOC = path.join(ROOT, 'docs', '01-architecture', 'native-admission-baseline.md');

/** Rounds per measurement; the best round is used so load spikes do not read as regressions. */
const MEASUREMENT_ROUNDS = 5;

/** Cross-boundary fixed cost measured on this host, in microseconds. Used only for the report. */
const BOUNDARY_FLOOR_US = 1.7;

/**
 * Builds a source-like payload of approximately `bytes` bytes.
 *
 * Deterministic on purpose: a randomly generated corpus would make two runs incomparable, and the
 * whole point of the baseline is comparability.
 *
 * @param bytes - Target payload size.
 * @returns Payload text.
 */
function buildSourcePayload(bytes) {
  const line = 'const value = compute(input, index); // note\n';
  const repeats = Math.ceil(bytes / line.length);
  return line.repeat(repeats);
}

/**
 * Builds a numeric series of the requested length.
 *
 * @param count - Number of values.
 * @returns Value array with a deterministic sawtooth shape.
 */
function buildNumericPayload(count) {
  const values = new Array(count);
  for (let index = 0; index < count; index += 1) values[index] = (index % 97) + Math.sin(index);
  return values;
}

/**
 * Resolves the security prefilter tokens once, from the production token list.
 *
 * Derived rather than copied so the table cannot drift or mimic dynamic code, and resolved at
 * module load so file reads never skew payload timings.
 *
 * @returns Token strings used by the security prefilter.
 */
function securityTokens() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'analyzers', 'security.ts'), 'utf8');
  const declaration = /SECURITY_FAST_FILTER_TOKENS\s*=\s*\[([\s\S]*?)\]/.exec(source);
  const fallback = ['eval', 'innerHTML', 'child_process'];
  if (!declaration) return fallback;
  const tokens = [];
  const literalPattern = /'([^']+)'/g;
  let match;
  while ((match = literalPattern.exec(declaration[1])) !== null) tokens.push(match[1]);
  return tokens.length > 0 ? tokens : fallback;
}

/** Cached prefilter tokens. */
const PREFILTER_TOKENS = securityTokens();

/**
 * Measures the best wall time of `operation` over several rounds.
 *
 * @param operation - Zero-argument closure to time.
 * @returns Best duration in milliseconds.
 */
function bestOf(operation) {
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < MEASUREMENT_ROUNDS; round += 1) {
    const startedAt = performance.now();
    operation();
    const elapsed = performance.now() - startedAt;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/**
 * Declares the measurable operators. Payload builders live here rather than in the markdown so the
 * document stays readable while the guard stays executable.
 */
const OPERATIONS = Object.freeze({
  countBracesDetailed: {
    build: () => buildSourcePayload(512 * 1024),
    native: (payload) => nativeCore.countBracesDetailed(payload),
    shim: (payload) => new PureJsNativeShim().countBracesDetailed(payload),
  },
  hasAnyPattern: {
    build: () => buildSourcePayload(256 * 1024),
    native: (payload) => nativeCore.hasAnyPattern(payload, PREFILTER_TOKENS),
    shim: (payload) => new PureJsNativeShim().hasAnyPattern(payload, PREFILTER_TOKENS),
  },
  fastPatternMatch: {
    build: () => buildSourcePayload(256 * 1024),
    native: (payload) => nativeCore.fastPatternMatch(payload, PREFILTER_TOKENS),
    shim: (payload) => new PureJsNativeShim().fastPatternMatch(payload, PREFILTER_TOKENS),
  },
  computeStatisticalMoments: {
    build: () => buildNumericPayload(2000),
    native: (payload) => nativeCore.computeStatisticalMoments(payload),
    shim: (payload) => new PureJsNativeShim().computeStatisticalMoments(payload),
  },
  computeShannonEntropy: {
    build: () => buildSourcePayload(64 * 1024),
    native: (payload) => nativeCore.computeShannonEntropy(payload),
    shim: (payload) => new PureJsNativeShim().computeShannonEntropy(payload),
  },
});

/**
 * Extracts the baseline table rows from the architecture document.
 *
 * The document is the single source of truth: reading it here means a row added for a new operator
 * is enforced without editing this script, and a row removed cannot linger as a stale assertion.
 *
 * @param markdown - Document contents.
 * @returns Parsed rows carrying name, minSpeedup and status.
 */
function parseBaselineTable(markdown) {
  const rows = [];
  const rowPattern =
    /^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|\s*([0-9.]+)\s*\|[^|]*\|\s*(enforced|documented)\s*\|/gm;
  let match;
  while ((match = rowPattern.exec(markdown)) !== null) {
    rows.push({ name: match[1], minSpeedup: Number(match[2]), status: match[3] });
  }
  return rows;
}

/**
 * Runs the admission guard.
 */
function main() {
  console.log('=== Native Operator Admission Baseline ===');

  const status = getNativeCoreStatus();
  if (!status.isNativeAvailable) {
    console.log('native kernel unavailable on this host; admission ratios cannot be measured');
    console.log('SKIP native admission baseline (no compiled addon)');
    return;
  }
  console.log(`active engine: ${status.activeEngine} (${status.capabilities.length} capabilities)`);

  assert.ok(fs.existsSync(BASELINE_DOC), `baseline document missing: ${BASELINE_DOC}`);
  const rows = parseBaselineTable(fs.readFileSync(BASELINE_DOC, 'utf8'));
  assert.ok(rows.length > 0, 'baseline document declares no operator rows');

  const unknown = rows.filter((row) => !OPERATIONS[row.name]);
  assert.deepStrictEqual(
    unknown.map((row) => row.name),
    [],
    'every baseline row must have a measurable operation in this guard',
  );

  const enforcedFailures = [];
  for (const row of rows) {
    const operation = OPERATIONS[row.name];
    const payload = operation.build();
    const nativeMs = bestOf(() => operation.native(payload));
    const shimMs = bestOf(() => operation.shim(payload));
    const ratio = nativeMs / shimMs;
    const verdict = ratio <= row.minSpeedup ? 'PASS' : 'MISS';

    console.log(
      `  [${row.status}] ${row.name.padEnd(26)} native ${nativeMs.toFixed(3)} ms  shim ${shimMs.toFixed(
        3,
      )} ms  ratio ${ratio.toFixed(2)}  limit ${row.minSpeedup.toFixed(2)}  ${verdict}`,
    );

    if (row.status === 'enforced' && ratio > row.minSpeedup) {
      enforcedFailures.push({ name: row.name, ratio, limit: row.minSpeedup });
    }
  }

  console.log(`  reference: cross-boundary fixed cost ~= ${BOUNDARY_FLOOR_US} us per call`);
  assert.deepStrictEqual(
    enforcedFailures.map(
      (entry) => `${entry.name} ratio ${entry.ratio.toFixed(2)} > ${entry.limit}`,
    ),
    [],
    'an enforced operator no longer clears its admission ratio',
  );
  console.log(`=== [Native Admission] SUCCESS: ${rows.length} baseline rows honoured. ===`);
}

main();
