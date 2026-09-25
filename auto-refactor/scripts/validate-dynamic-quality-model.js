#!/usr/bin/env node
/**
 * Module: Verification Harness — Dynamic Analysis Plane (DAP) Quality & Telemetry
 * File Path: scripts/validate-dynamic-quality-model.js
 * Architecture Role: Automated verification suite asserting the mathematical correctness
 *   of the Dynamic Analysis Plane (DAP) vector Q_d = f(L, T, M, C, E), runtime telemetry
 *   ingestion adapters, and the dynamic hotspot risk formulation D_i = B_i * F_i * R_i * V_i.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-dynamic-quality-model.js`;
 *   imports dist/api.
 * Responsibilities:
 *   1. Validate benchmark and LCOV ingestion into DynamicEvidenceDTO.
 *   2. Validate 5-axis dynamic vector synthesis and bounded scoring [0.0, 100.0].
 *   3. Validate dynamic hotspot risk D_i = B_i * F_i * R_i * V_i.
 *   4. Validate penalty triggers (deadlocks, memory leaks, high GC pauses).
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion error.
 */
'use strict';

const assert = require('assert');
const {
  ALL_DYNAMIC_QUALITY_AXES,
  DEFAULT_DYNAMIC_WEIGHTS,
  ingestBenchmarkJson,
  ingestLcovCoverage,
  createDefaultFallbackEvidence,
  computeDynamicQualityVector,
  computeDynamicQualityScore,
  computeDynamicHotspotRisk,
} = require('../dist/api');

async function main() {
  console.log('=== [Dynamic Analysis Plane] Testing Dynamic Quality Model & D_i = B_i * F_i * R_i * V_i ===\n');

  // 1. Dynamic Quality Axis Definitions
  console.log('1. Testing Dynamic Quality Axes & Default Weights...');
  assert.strictEqual(ALL_DYNAMIC_QUALITY_AXES.length, 5);
  assert.deepStrictEqual([...ALL_DYNAMIC_QUALITY_AXES], ['L', 'T', 'M', 'C', 'E']);
  const weightSum = Object.values(DEFAULT_DYNAMIC_WEIGHTS).reduce((acc, w) => acc + w, 0);
  assert.ok(Math.abs(weightSum - 1.0) < 1e-6, `Default dynamic weights must sum to 1.0 (got ${weightSum})`);
  console.log('✔ Five dynamic quality axes and normalized weights verified.');

  // 2. Telemetry Ingestion (Benchmark JSON + LCOV)
  console.log('2. Testing Telemetry Ingestion Adapters...');
  const sampleBenchmark = {
    timestamp: 1727280000000,
    environment: 'ci_runner_linux',
    latency: { p50Ms: 4.2, p95Ms: 11.5, p99Ms: 15.8, budgetMs: 16.67 },
    throughput: { opsPerSec: 1500, targetOpsPerSec: 1200 },
    memory: {
      peakHeapBytes: 45 * 1024 * 1024,
      allocationRateBytesPerSec: 5 * 1024 * 1024,
      gcPauseCount: 2,
      gcTotalPauseMs: 12.0,
      detectedLeakBytes: 0,
    },
    concurrency: {
      lockWaitCount: 5,
      totalLockWaitMs: 3.5,
      deadlockDetected: false,
      contentionRatio: 0.02,
    },
    execution: {
      callCount: 50000,
      invocationsPerHour: 72000,
      lineCoveragePct: 88.5,
      branchCoveragePct: 82.0,
    },
  };

  const dto = ingestBenchmarkJson(sampleBenchmark);
  assert.strictEqual(dto.latency.p99Ms, 15.8);
  assert.strictEqual(dto.throughput.opsPerSec, 1500);
  assert.strictEqual(dto.memory.detectedLeakBytes, 0);
  assert.strictEqual(dto.concurrency.deadlockDetected, false);
  console.log('✔ Benchmark JSON telemetry successfully ingested and normalized.');

  const sampleLcov = [
    'TN:',
    'SF:src/core/model.ts',
    'LF:200',
    'LH:180',
    'BRF:50',
    'BRH:45',
    'end_of_record',
  ].join('\n');

  const lcovResult = ingestLcovCoverage(sampleLcov);
  assert.strictEqual(lcovResult.lineCoveragePct, 90.0);
  assert.strictEqual(lcovResult.branchCoveragePct, 90.0);
  console.log(`✔ LCOV ingestion verified: line=${lcovResult.lineCoveragePct}%, branch=${lcovResult.branchCoveragePct}%`);

  // 3. Dynamic Vector Synthesis Q_d = (L, T, M, C, E)
  console.log('3. Testing Dynamic Quality Vector Synthesis...');
  const vector = computeDynamicQualityVector(dto);
  assert.strictEqual(vector.L, 100.0); // p99 <= budget
  assert.strictEqual(vector.T, 100.0); // ops >= target
  assert.strictEqual(vector.M, 100.0); // no leaks, low GC pause
  assert.strictEqual(vector.C, 98.0); // 100 * (1 - 0.02)
  assert.ok(vector.E > 80.0, `Expected strong execution evidence score (got ${vector.E})`);

  const dynamicScore = computeDynamicQualityScore(vector);
  assert.ok(dynamicScore >= 90.0 && dynamicScore <= 100.0, `Score out of expected range: ${dynamicScore}`);
  console.log(`✔ Dynamic quality vector computed: score=${dynamicScore}, Q_d=${JSON.stringify(vector)}`);

  // 4. Edge Cases: Deadlocks and Leaks
  console.log('4. Testing Dynamic Failure Penalty Edge Cases...');
  const degradedTelemetry = {
    ...sampleBenchmark,
    latency: { p99Ms: 40.0, budgetMs: 16.67 }, // overshoot
    memory: { detectedLeakBytes: 1024 * 1024, gcTotalPauseMs: 300.0 }, // leak + high GC
    concurrency: { deadlockDetected: true }, // fatal deadlock
  };
  const degradedVector = computeDynamicQualityVector(ingestBenchmarkJson(degradedTelemetry));
  assert.ok(degradedVector.L < 50.0, `Latency score should degrade heavily upon SLA overshoot: ${degradedVector.L}`);
  assert.ok(degradedVector.M <= 50.0, `Memory score must drop on detected leak: ${degradedVector.M}`);
  assert.strictEqual(degradedVector.C, 0.0, 'Concurrency score must be 0 on deadlock detection');
  console.log(`✔ Failure penalties triggered correctly: L=${degradedVector.L}, M=${degradedVector.M}, C=${degradedVector.C}`);

  // 5. Dynamic Risk Model: D_i = B_i * F_i * R_i * V_i
  console.log('5. Testing Dynamic Hotspot Risk D_i = B_i * F_i * R_i * V_i...');

  // Hotspot A: Critical hot loop with high frequency and CPU consumption
  const hotTrace = computeDynamicHotspotRisk('hotspot_render_loop', {
    behavioralScope: 4.0, // Core render pipeline
    invocationsPerHour: 360000, // 100/sec -> F = log10(360001) ~ 5.56
    resourceConsumption: 8.5, // 85% CPU in profile
    businessSensitivity: 4.5, // Core player experience
  });

  assert.strictEqual(hotTrace.B, 4.0);
  assert.ok(hotTrace.F >= 5.5 && hotTrace.F <= 5.6);
  assert.strictEqual(hotTrace.R, 8.5);
  assert.strictEqual(hotTrace.V, 4.5);
  assert.ok(hotTrace.rawRisk > 500, `Raw risk should be high: ${hotTrace.rawRisk}`);
  assert.ok(hotTrace.normalizedRisk >= 3.0, `Normalized risk should reflect hot path severity: ${hotTrace.normalizedRisk}`);
  console.log(`✔ Hotspot dynamic risk verified: D_i = ${hotTrace.normalizedRisk}/10 (raw: ${hotTrace.rawRisk})`);

  // Hotspot B: Cold async maintenance task
  const coldTrace = computeDynamicHotspotRisk('cold_cleanup_cron', {
    behavioralScope: 1.0,
    invocationsPerHour: 1, // Once per hour -> F = log10(2) ~ 0.3
    resourceConsumption: 1.0,
    businessSensitivity: 1.0,
  });
  assert.ok(coldTrace.normalizedRisk < 0.2, `Cold trace risk must be negligible: ${coldTrace.normalizedRisk}`);
  console.log(`✔ Cold task dynamic risk dampened: D_i = ${coldTrace.normalizedRisk}/10 (raw: ${coldTrace.rawRisk})`);

  // 6. Safe Fallback
  console.log('6. Testing Fallback Behavior...');
  const fallback = createDefaultFallbackEvidence();
  const fallbackVector = computeDynamicQualityVector(fallback);
  assert.ok(fallbackVector.L > 0 && fallbackVector.M > 0);
  console.log('✔ Fallback evidence evaluates safely without crashes.');

  console.log('\n🎉 ALL DYNAMIC ANALYSIS PLANE TESTS PASSED!');
}

main().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
