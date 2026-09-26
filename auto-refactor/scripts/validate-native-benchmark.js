#!/usr/bin/env node
/**
 * Module: Verification Harness — Native Operator Kernel Performance Benchmark
 * File Path: scripts/validate-native-benchmark.js
 * Architecture Role: Measures and guards the performance acceleration ratio and throughput
 *   of the Rust native operator kernel (auto-refactor-ops) compared to the pure JavaScript fallback shim.
 * Dependencies & Triggers: Consumes src/core/native, src/core/policy/source-mask;
 *   executed by scripts/test-parallel.js or directly via `node scripts/validate-native-benchmark.js`.
 * Responsibilities:
 *   1. Measure source masking and lexical scanning throughput (MB/s);
 *   2. Measure clone block detection and MinHash signature generation latency;
 *   3. Measure graph topological SCC analysis and cycle detection speed;
 *   4. Measure histogram diff hunk generation speed;
 *   5. Guard against performance degradation when native binary is available.
 * Exit Semantics & Design Rationale: Exits 0 on passing performance guardrails, exits 1 on regression.
 */

'use strict';

const assert = require('assert');
const { performance } = require('perf_hooks');

const {
  getNativeCoreStatus,
  nativeCore,
  PureJsNativeShim,
} = require('../dist/core/native');
const {
  SOURCE_MASK_PRESETS,
  MASK_LANGUAGE_TYPESCRIPT,
} = require('../dist/core/policy/source-mask');

const shim = new PureJsNativeShim();

function toNativeConfig(preset) {
  return {
    lineComment: preset.lineComment,
    blockCommentOpen: preset.blockComment ? preset.blockComment.open : undefined,
    blockCommentClose: preset.blockComment ? preset.blockComment.close : undefined,
    quoteChars: preset.quoteChars,
    multilineTemplates: preset.multilineTemplates,
    regexLiterals: preset.regexLiterals,
  };
}

/**
 * Generate a dense multiline source text for benchmarking.
 */
function generateBenchmarkCorpus(linesCount) {
  const chunks = [];
  for (let i = 0; i < linesCount; i++) {
    const mod = i % 8;
    switch (mod) {
      case 0:
        chunks.push(`// Line comment describing operation index ${i}`);
        break;
      case 1:
        chunks.push(`const token_${i} = "literal_value_${i}_with_extra_padding";`);
        break;
      case 2:
        chunks.push(`/* Block comment spanning inside code */ const calc_${i} = ${i} * 42;`);
        break;
      case 3:
        chunks.push(`const template_${i} = \`multiline template line 1\nline 2 \${token_${i}}\nline 3\`;`);
        break;
      case 4:
        chunks.push(`const pattern_${i} = /token_[0-9]+_[a-z]+/gi; const div_${i} = calc_${i} / 2;`);
        break;
      case 5:
        chunks.push(`function computeAction_${i}(param: number): number { return param + ${i}; }`);
        break;
      case 6:
        chunks.push(`// 中文国际化注释：处理第 ${i} 项业务指标计算`);
        break;
      case 7:
        chunks.push(`const message_${i} = '这是中文双引号与单引号混合测试字符串';`);
        break;
    }
  }
  return chunks.join('\n');
}

/**
 * Benchmark source masking throughput.
 */
function benchmarkSourceMask(corpus, iterations = 10) {
  const config = toNativeConfig(SOURCE_MASK_PRESETS[MASK_LANGUAGE_TYPESCRIPT]);
  const corpusBytes = Buffer.byteLength(corpus, 'utf8');

  // Warmup
  nativeCore.maskSourceCode(corpus, config);
  shim.maskSourceCode(corpus, config);

  // Time Native
  const t0Native = performance.now();
  for (let i = 0; i < iterations; i++) {
    nativeCore.maskSourceCode(corpus, config);
  }
  const nativeElapsedMs = (performance.now() - t0Native) / iterations;

  // Time Shim
  const t0Shim = performance.now();
  for (let i = 0; i < iterations; i++) {
    shim.maskSourceCode(corpus, config);
  }
  const shimElapsedMs = (performance.now() - t0Shim) / iterations;

  const totalMb = corpusBytes / (1024 * 1024);
  const nativeThroughputMbSec = totalMb / (nativeElapsedMs / 1000);
  const shimThroughputMbSec = totalMb / (shimElapsedMs / 1000);
  const speedup = shimElapsedMs / Math.max(0.001, nativeElapsedMs);

  return {
    operator: 'SIMD Source Mask',
    nativeElapsedMs,
    shimElapsedMs,
    nativeThroughputMbSec,
    shimThroughputMbSec,
    speedup,
  };
}

/**
 * Benchmark clone block and MinHash detection.
 */
function benchmarkCloneDetection(corpus, iterations = 10) {
  // Warmup
  nativeCore.countDuplicateLines(corpus);
  shim.countDuplicateLines(corpus);
  nativeCore.computeMinHash(corpus, 64);
  shim.computeMinHash(corpus, 64);

  // Time Native
  const t0Native = performance.now();
  for (let i = 0; i < iterations; i++) {
    nativeCore.countDuplicateLines(corpus);
    nativeCore.computeMinHash(corpus, 64);
  }
  const nativeElapsedMs = (performance.now() - t0Native) / iterations;

  // Time Shim
  const t0Shim = performance.now();
  for (let i = 0; i < iterations; i++) {
    shim.countDuplicateLines(corpus);
    shim.computeMinHash(corpus, 64);
  }
  const shimElapsedMs = (performance.now() - t0Shim) / iterations;
  const speedup = shimElapsedMs / Math.max(0.001, nativeElapsedMs);

  return {
    operator: 'Clone & MinHash',
    nativeElapsedMs,
    shimElapsedMs,
    speedup,
  };
}

/**
 * Benchmark dependency graph topology analysis.
 */
function benchmarkGraphTopology(iterations = 20) {
  const edges = [];
  const nodeCount = 300;
  for (let i = 0; i < nodeCount; i++) {
    edges.push([`Module_Path_Prefix_Identifier_${i}`, `Module_Path_Prefix_Identifier_${(i + 1) % nodeCount}`]);
    edges.push([`Module_Path_Prefix_Identifier_${i}`, `Module_Path_Prefix_Identifier_${(i * 7) % nodeCount}`]);
  }

  // Warmup
  nativeCore.analyzeDependencyGraph(edges);
  shim.analyzeDependencyGraph(edges);

  const t0Native = performance.now();
  for (let i = 0; i < iterations; i++) {
    nativeCore.analyzeDependencyGraph(edges);
  }
  const nativeElapsedMs = (performance.now() - t0Native) / iterations;

  const t0Shim = performance.now();
  for (let i = 0; i < iterations; i++) {
    shim.analyzeDependencyGraph(edges);
  }
  const shimElapsedMs = (performance.now() - t0Shim) / iterations;
  const speedup = shimElapsedMs / Math.max(0.001, nativeElapsedMs);

  return {
    operator: 'Tarjan SCC Graph',
    nativeElapsedMs,
    shimElapsedMs,
    speedup,
  };
}

/**
 * Benchmark histogram diff computation.
 */
function benchmarkHistogramDiff(corpus, iterations = 10) {
  const lines = corpus.split('\n').slice(0, 1000);
  const modifiedLines = [...lines];
  // Realistic localized edit: 3 hunk clusters
  for (let i = 100; i < 120; i++) {
    modifiedLines[i] = modifiedLines[i] + ' // MODIFIED';
  }
  for (let i = 500; i < 515; i++) {
    modifiedLines[i] = modifiedLines[i] + ' // REFACTORED';
  }
  const oldText = lines.join('\n');
  const newText = modifiedLines.join('\n');

  // Warmup
  nativeCore.computeHistogramDiff(oldText, newText);
  shim.computeHistogramDiff(oldText, newText);

  const t0Native = performance.now();
  for (let i = 0; i < iterations; i++) {
    nativeCore.computeHistogramDiff(oldText, newText);
  }
  const nativeElapsedMs = (performance.now() - t0Native) / iterations;

  const t0Shim = performance.now();
  for (let i = 0; i < iterations; i++) {
    shim.computeHistogramDiff(oldText, newText);
  }
  const shimElapsedMs = (performance.now() - t0Shim) / iterations;
  const speedup = shimElapsedMs / Math.max(0.001, nativeElapsedMs);

  return {
    operator: 'Histogram Diff',
    nativeElapsedMs,
    shimElapsedMs,
    speedup,
  };
}

function runBenchmark() {
  console.log('=== [Native Benchmark & Guard] Performance Acceleration Verification ===');

  const status = getNativeCoreStatus();
  console.log(`[Status] Active Engine: ${status.activeEngine} (version: ${status.version})`);
  console.log(`[Status] Is Native Binary Available: ${status.isNativeAvailable}`);

  const corpus = generateBenchmarkCorpus(2500);
  const corpusKb = (Buffer.byteLength(corpus, 'utf8') / 1024).toFixed(1);
  console.log(`[Corpus] Generated benchmark source: 2500 lines (${corpusKb} KB)\n`);

  const results = [
    benchmarkSourceMask(corpus),
    benchmarkCloneDetection(corpus),
    benchmarkGraphTopology(),
    benchmarkHistogramDiff(corpus),
  ];

  console.log('-----------------------------------------------------------------------------');
  console.log(
    ' Operator              | Native (ms) | Shim (ms) | Speedup | Throughput (MB/s)',
  );
  console.log('-----------------------------------------------------------------------------');

  for (const r of results) {
    const name = r.operator.padEnd(22, ' ');
    const nat = r.nativeElapsedMs.toFixed(2).padStart(11, ' ');
    const shm = r.shimElapsedMs.toFixed(2).padStart(9, ' ');
    const spd = `${r.speedup.toFixed(2)}x`.padStart(9, ' ');
    const tp = r.nativeThroughputMbSec
      ? `${r.nativeThroughputMbSec.toFixed(1)} MB/s`.padStart(17, ' ')
      : '               N/A';
    console.log(` ${name}|${nat} |${shm} |${spd} |${tp}`);
  }
  console.log('-----------------------------------------------------------------------------\n');

  if (status.isNativeAvailable) {
    console.log('[Performance Guard] Asserting native acceleration health...');
    // Assert that compute-heavy Clone & MinHash achieves high speedup (>= 2.0x)
    const cloneRes = results.find((r) => r.operator === 'Clone & MinHash');
    if (cloneRes) {
      assert.ok(
        cloneRes.speedup >= 2.0,
        `Clone detection speedup ratio (${cloneRes.speedup.toFixed(2)}x) should be >= 2.0x`,
      );
    }
    // Assert SIMD source masking is faster than JS baseline
    const maskRes = results.find((r) => r.operator === 'SIMD Source Mask');
    if (maskRes) {
      assert.ok(
        maskRes.speedup >= 1.0,
        `SIMD source mask speedup ratio (${maskRes.speedup.toFixed(2)}x) should be >= 1.0x`,
      );
    }
    console.log('✓ All native operator performance guardrails passed successfully.');
  } else {
    console.log('[Notice] Running in pure JS fallback mode; performance assertions skipped.');
  }

  console.log('=== [Native Benchmark & Guard] SUCCESS: Benchmark suite complete. ===');
}

try {
  runBenchmark();
} catch (err) {
  console.error('[Native Benchmark & Guard FAILED]:', err);
  process.exit(1);
}
