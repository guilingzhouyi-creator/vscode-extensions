/**
 * Module: Test Pipeline — Logistic Marginal Deduction & Saturation Curve Validation
 * File Path: scripts/validate-logistic-deduction-curve.js
 * Architecture Role: Verifies mathematical correctness, zero-anchoring, linear fidelity
 *   at early stages, asymptotic saturation, monotonic non-decrease, and repetitive issue
 *   diminishing marginal returns.
 * Dependencies & Triggers: Node assert; executed as test suite 110 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify zero-anchor guarantee D(0) = 0 and robust handling of negative/NaN inputs.
 *   2. Verify linear fidelity zone for small penalties (points <= linearThreshold).
 *   3. Verify strict monotonic non-decrease across dense input intervals.
 *   4. Verify asymptotic saturation bounded by capacity limit L.
 *   5. Verify repetitive violation marginal dampening harmonic model.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  applyLogisticSaturation,
  calculateMarginalDeduction,
  compressDimensionDeductions,
  DEFAULT_CURVE_OPTIONS,
} = require('../dist/core/scoring/logistic-deduction-curve');

function testZeroAnchorAndRobustness() {
  console.log('1. Testing Zero-Anchor & Numeric Robustness...');

  assert.strictEqual(applyLogisticSaturation(0), 0, 'D(0) must equal 0 exactly');
  assert.strictEqual(applyLogisticSaturation(-10), 0, 'Negative points must clamp to 0');
  assert.strictEqual(applyLogisticSaturation(NaN), 0, 'NaN must clamp to 0');

  assert.strictEqual(calculateMarginalDeduction(0, 10), 0);
  assert.strictEqual(calculateMarginalDeduction(5, 0), 0);
  assert.strictEqual(compressDimensionDeductions([]), 0);

  console.log('  ✔ [PASS] Zero-anchor and numeric robustness verified.');
}

function testLinearFidelityZone() {
  console.log('2. Testing Early Stage Linear Fidelity Zone...');

  // Within linearThreshold (default 15), deductions must remain 100% exact
  for (let p = 1; p <= DEFAULT_CURVE_OPTIONS.linearThreshold; p++) {
    const res = applyLogisticSaturation(p);
    assert.strictEqual(
      res,
      p,
      `Points in linear zone must match exactly: expected ${p}, got ${res}`,
    );
  }

  console.log('  ✔ [PASS] Linear fidelity for small infractions (<=15) verified.');
}

function testStrictMonotonicity() {
  console.log('3. Testing Strict Monotonic Non-Decrease...');

  let previous = 0;
  for (let x = 0; x <= 300; x += 0.5) {
    const current = applyLogisticSaturation(x);
    assert.ok(
      current >= previous,
      `Curve must be monotonically non-decreasing: at x=${x}, prev=${previous}, curr=${current}`,
    );
    previous = current;
  }

  console.log('  ✔ [PASS] Monotonicity verified over dense interval [0, 300].');
}

function testAsymptoticSaturation() {
  console.log('4. Testing Asymptotic Saturation & Boundary Capping...');

  const L = 100;
  const p50 = applyLogisticSaturation(50);
  const p100 = applyLogisticSaturation(100);
  const p200 = applyLogisticSaturation(200);
  const p1000 = applyLogisticSaturation(1000);

  assert.ok(p50 < p100, `p50 (${p50}) must be less than p100 (${p100})`);
  assert.ok(p100 <= p200, `p100 (${p100}) must be <= p200 (${p200})`);
  assert.ok(p200 <= L, `p200 must be bounded by ${L}, got ${p200}`);
  assert.strictEqual(p1000, L, `Massive points (1000) must saturate at limit ${L}`);

  // Custom capacity limit
  const customLimit = 60;
  const customSat = applyLogisticSaturation(500, { capacityLimit: customLimit });
  assert.strictEqual(
    customSat,
    customLimit,
    `Custom capacity limit (${customLimit}) must be respected`,
  );

  console.log('  ✔ [PASS] Asymptotic saturation and capacity ceiling verified.');
}

function testRepetitiveIssueMarginalDeduction() {
  console.log('5. Testing Repetitive Issue Marginal Harmonic Model...');

  const base = 10;
  const d1 = calculateMarginalDeduction(1, base);
  const d2 = calculateMarginalDeduction(2, base);
  const d4 = calculateMarginalDeduction(4, base);
  const d10 = calculateMarginalDeduction(10, base);

  assert.strictEqual(d1, 10, 'Single violation must equal base penalty');
  // 2 violations: 10 * (1 + 1/sqrt(2)) = 10 * 1.707 = 17
  assert.ok(d2 > d1 && d2 < 20, `2 violations should damp to ~17, got ${d2}`);
  // 4 violations: 10 * (1 + 1/sqrt(2) + 1/sqrt(3) + 1/2) = 10 * 2.784 = 28
  assert.ok(d4 > d2 && d4 < 40, `4 violations should damp to ~28 (linear is 40), got ${d4}`);
  assert.ok(d10 > d4 && d10 < 100, `10 violations must increase monotonically, got ${d10}`);

  // Test compressDimensionDeductions
  const compressed = compressDimensionDeductions([10, 10, 10, 10]);
  assert.ok(
    compressed >= 25 && compressed <= 40,
    `Array compression should produce saturated total around 25-40, got ${compressed}`,
  );

  console.log('  ✔ [PASS] Repetitive violation diminishing returns verified.');
}

function runAll() {
  console.log('=== Validating Logistic Marginal Deduction & Saturation Curves ===\n');
  testZeroAnchorAndRobustness();
  testLinearFidelityZone();
  testStrictMonotonicity();
  testAsymptoticSaturation();
  testRepetitiveIssueMarginalDeduction();
  console.log('\n[PASS] All 5 Logistic Deduction Curve test suites passed successfully!');
}

runAll();
