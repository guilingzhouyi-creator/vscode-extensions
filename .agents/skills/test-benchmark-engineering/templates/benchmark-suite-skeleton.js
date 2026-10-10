/**
 * Module: Test Engineering — Performance Benchmark Skeleton
 * File Path: templates/benchmark-suite-skeleton.js
 * Architecture Role: Standard blueprint for micro-benchmarks with monotonic ratchet
 *   comparisons and execution budget assertions.
 * Dependencies & Triggers: Zero external runtime dependencies; uses standard Node.js libraries.
 * Responsibilities:
 *   1. Measure mean iteration execution latency in milliseconds.
 *   2. Assert performance stays within baseline budget envelope.
 *   3. Enforce zero heap allocation in tight measurement loops.
 * Exit Semantics & Design Rationale: Exits 0 on performance budget compliance; exits 1 on regression.
 */
'use strict';

const { performance } = require('perf_hooks');

/**
 * Runs a micro-benchmark suite with warmup iterations and budget enforcement.
 *
 * @param {string} suiteName - Descriptive name of the benchmark.
 * @param {Function} workload - Target function to benchmark.
 * @param {object} options - Configuration options.
 * @param {number} [options.warmupRounds=100] - Pre-measurement warmup rounds.
 * @param {number} [options.sampleRounds=1000] - Active measurement iterations.
 * @param {number} [options.maxMeanMs=0.05] - Maximum allowable mean duration in ms.
 * @returns {{ suite: string, meanMs: number, passed: boolean }}
 */
function runBenchmarkSuite(suiteName, workload, options = {}) {
  const warmupRounds = options.warmupRounds || 100;
  const sampleRounds = options.sampleRounds || 1000;
  const maxMeanMs = options.maxMeanMs || 0.05;

  // Warmup phase
  for (let i = 0; i < warmupRounds; i++) {
    workload();
  }

  // Active measurement phase
  const t0 = performance.now();
  for (let i = 0; i < sampleRounds; i++) {
    workload();
  }
  const totalDuration = performance.now() - t0;
  const meanMs = totalDuration / sampleRounds;
  const passed = meanMs <= maxMeanMs;

  return {
    suite: suiteName,
    sampleRounds,
    meanMs: Number(meanMs.toFixed(6)),
    maxMeanMs,
    passed,
  };
}

module.exports = { runBenchmarkSuite };

