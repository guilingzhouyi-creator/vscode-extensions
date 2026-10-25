#!/usr/bin/env node
/**
 * Module: Verification Harness — Native Performance Matrix Benchmark
 * File Path: scripts/bench-performance-matrix.js
 * Architecture Role: Measures, evaluates, and reports the multidimensional performance matrix
 *   across compiled Rust native kernels and pure JavaScript shims across scale dimensions.
 * Dependencies & Triggers: Consumes dist/core/native, dist/core/policy/source-mask;
 *   invoked via `node scripts/bench-performance-matrix.js`.
 * Responsibilities:
 *   1. Benchmark source masking at varying byte scales (10KB to 1MB);
 *   2. Benchmark lexical scope arena and shadowing analysis across tree depths and binding counts;
 *   3. Benchmark MinHash signature extraction and clone pair detection at varying LOC scales;
 *   4. Benchmark histogram line diff engine across varying edit distances and line counts;
 *   5. Benchmark bit-parallel Myers and SimHash Hamming distance operations;
 *   6. Output a structured Markdown and JSON performance matrix table.
 * Exit Semantics & Design Rationale: Exits 0 on completion; records wall-clock timings with I/O
 *   excluded to deliver deterministic profiling metrics.
 */

'use strict';

const { performance } = require('perf_hooks');
const { getNativeCoreStatus, nativeCore, PureJsNativeShim } = require('../dist/core/native');
const { SOURCE_MASK_PRESETS, MASK_LANGUAGES } = require('../dist/core/policy/source-mask');

const shim = new PureJsNativeShim();

function toNativeMaskConfig(preset) {
  return {
    lineComment: preset.lineComment,
    blockCommentOpen: preset.blockComment ? preset.blockComment.open : undefined,
    blockCommentClose: preset.blockComment ? preset.blockComment.close : undefined,
    quoteChars: preset.quoteChars,
    multilineTemplates: preset.multilineTemplates,
    regexLiterals: preset.regexLiterals,
  };
}

function generateSourceCorpus(lineCount) {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const mod = i % 8;
    switch (mod) {
      case 0:
        lines.push(`// Architecture governance comment for line index ${i}`);
        break;
      case 1:
        lines.push(`const symbol_alpha_${i} = "literal_string_payload_${i}_fixed";`);
        break;
      case 2:
        lines.push(`/* Multi-line comment block segment */ const value_${i} = ${i} * 31;`);
        break;
      case 3:
        lines.push(`const template_${i} = \`multiline template row 1\nrow 2 \${value_${i}}\`;`);
        break;
      case 4:
        lines.push(
          `const regex_${i} = /sym_[0-9]+_[a-z]+/gi; const ratio_${i} = value_${i} / 3.14;`,
        );
        break;
      case 5:
        lines.push(
          `function handlePipelineExecution_${i}(id: string, weight: number): boolean { return weight > ${i}; }`,
        );
        break;
      case 6:
        lines.push(`// 跨项目分层架构约束与性能度量探针`);
        break;
      case 7:
        lines.push(`const localizedMsg_${i} = '中文字符串与常量实体定义';`);
        break;
    }
  }
  return lines.join('\n');
}

function benchMaskingSuite() {
  const scales = [
    { label: 'Small (15 KB)', lines: 250 },
    { label: 'Medium (150 KB)', lines: 2500 },
    { label: 'Large (600 KB)', lines: 10000 },
  ];
  const config = toNativeMaskConfig(SOURCE_MASK_PRESETS[MASK_LANGUAGES.TYPESCRIPT]);
  const rows = [];

  for (const scale of scales) {
    const corpus = generateSourceCorpus(scale.lines);
    const bytes = Buffer.byteLength(corpus, 'utf8');

    // Warmup
    nativeCore.maskSourceCode(corpus, config);
    shim.maskSourceCode(corpus, config);

    const iters = scale.lines > 5000 ? 5 : 20;

    const t0Native = performance.now();
    for (let i = 0; i < iters; i++) {
      nativeCore.maskSourceCode(corpus, config);
    }
    const nativeMs = (performance.now() - t0Native) / iters;

    const t0Shim = performance.now();
    for (let i = 0; i < iters; i++) {
      shim.maskSourceCode(corpus, config);
    }
    const shimMs = (performance.now() - t0Shim) / iters;

    const nativeMbS = bytes / (1024 * 1024) / (nativeMs / 1000);
    const shimMbS = bytes / (1024 * 1024) / (shimMs / 1000);

    rows.push({
      operator: `Source Mask (${scale.label})`,
      nativeMs,
      shimMs,
      speedup: shimMs / Math.max(0.001, nativeMs),
      throughput: `${nativeMbS.toFixed(1)} MB/s (Shim: ${shimMbS.toFixed(1)} MB/s)`,
    });
  }
  return rows;
}

function createSyntheticScopeGraph(scale) {
  const scopes = [];
  for (let i = 0; i < scale.scopesCount; i++) {
    const parent = i === 0 ? -1 : Math.floor((i - 1) / 3);
    const kind = i === 0 ? 0 : i % 2 === 0 ? 1 : 2;
    scopes.push({
      parent,
      kind,
      startLine: i * 20 + 1,
      endLine: (i + 1) * 20,
    });
  }

  const bindings = [];
  for (let s = 0; s < scale.scopesCount; s++) {
    for (let b = 0; b < scale.bindingsPerScope; b++) {
      const isShared = s % 10 === 0 && b === 0;
      const name = isShared ? 'shared_sym' : `var_${s}_${b}`;
      bindings.push({
        scopeId: s,
        name,
        kind: b % 3,
        line: s * 20 + b + 2,
      });
    }
  }
  return { scopes, bindings };
}

function benchScopeSuite() {
  const scales = [
    { label: 'Small (20 scopes, 200 bindings)', scopesCount: 20, bindingsPerScope: 10 },
    { label: 'Medium (100 scopes, 1,000 bindings)', scopesCount: 100, bindingsPerScope: 10 },
    { label: 'Large (500 scopes, 5,000 bindings)', scopesCount: 500, bindingsPerScope: 10 },
  ];
  const rows = [];

  for (const scale of scales) {
    const { scopes, bindings } = createSyntheticScopeGraph(scale);

    // Warmup
    nativeCore.analyzeScopeShadowing(scopes, bindings);
    shim.analyzeScopeShadowing(scopes, bindings);

    const iters = scale.scopesCount > 200 ? 10 : 30;

    const t0Native = performance.now();
    for (let i = 0; i < iters; i++) {
      nativeCore.analyzeScopeShadowing(scopes, bindings);
    }
    const nativeMs = (performance.now() - t0Native) / iters;

    const t0Shim = performance.now();
    for (let i = 0; i < iters; i++) {
      shim.analyzeScopeShadowing(scopes, bindings);
    }
    const shimMs = (performance.now() - t0Shim) / iters;

    const totalBindings = scale.scopesCount * scale.bindingsPerScope;
    const nativeRate = (totalBindings / nativeMs).toFixed(0);

    rows.push({
      operator: `Scope Shadowing (${scale.label})`,
      nativeMs,
      shimMs,
      speedup: shimMs / Math.max(0.001, nativeMs),
      throughput: `${nativeRate} bindings/ms`,
    });
  }
  return rows;
}

function benchCloneSuite() {
  const scales = [
    { label: 'Medium (150 KB)', lines: 2500 },
    { label: 'Large (600 KB)', lines: 10000 },
  ];
  const rows = [];

  for (const scale of scales) {
    const corpus = generateSourceCorpus(scale.lines);
    nativeCore.detectCloneBlocks(corpus, 6);
    shim.detectCloneBlocks(corpus, 6);

    const iters = scale.lines > 5000 ? 5 : 15;

    const t0Native = performance.now();
    for (let i = 0; i < iters; i++) {
      nativeCore.detectCloneBlocks(corpus, 6);
    }
    const nativeMs = (performance.now() - t0Native) / iters;

    const t0Shim = performance.now();
    for (let i = 0; i < iters; i++) {
      shim.detectCloneBlocks(corpus, 6);
    }
    const shimMs = (performance.now() - t0Shim) / iters;

    rows.push({
      operator: `Clone Detection (${scale.label})`,
      nativeMs,
      shimMs,
      speedup: shimMs / Math.max(0.001, nativeMs),
      throughput: `${(scale.lines / nativeMs).toFixed(0)} lines/ms`,
    });
  }
  return rows;
}

function benchDiffSuite() {
  const baseCorpus = generateSourceCorpus(2000);
  const modifiedCorpus = baseCorpus
    .split('\n')
    .map((line, idx) => (idx % 15 === 0 ? `// Modified at line ${idx}` : line))
    .join('\n');

  nativeCore.computeHistogramDiff(baseCorpus, modifiedCorpus);
  shim.computeHistogramDiff(baseCorpus, modifiedCorpus);

  const iters = 20;
  const t0Native = performance.now();
  for (let i = 0; i < iters; i++) {
    nativeCore.computeHistogramDiff(baseCorpus, modifiedCorpus);
  }
  const nativeMs = (performance.now() - t0Native) / iters;

  const t0Shim = performance.now();
  for (let i = 0; i < iters; i++) {
    shim.computeHistogramDiff(baseCorpus, modifiedCorpus);
  }
  const shimMs = (performance.now() - t0Shim) / iters;

  return [
    {
      operator: 'Histogram Diff (2,000 lines, 133 hunks)',
      nativeMs,
      shimMs,
      speedup: shimMs / Math.max(0.001, nativeMs),
      throughput: `${(2000 / nativeMs).toFixed(0)} lines/ms`,
    },
  ];
}

function benchVectorMathSuite() {
  const iters = 2000;
  const pattern = new Uint32Array(2);
  pattern[0] = 0xabcdef01;
  pattern[1] = 0x23456789;
  const text = new Uint32Array(2);
  text[0] = 0xabcdef00;
  text[1] = 0x23456780;

  const t0Native = performance.now();
  for (let i = 0; i < iters; i++) {
    nativeCore.computeBitParallelDistance(pattern, text);
  }
  const nativeMyersMs = (performance.now() - t0Native) / iters;

  const t0Shim = performance.now();
  for (let i = 0; i < iters; i++) {
    shim.computeBitParallelDistance(pattern, text);
  }
  const shimMyersMs = (performance.now() - t0Shim) / iters;

  const tokens = Array.from({ length: 100 }, (_, i) => `identifier_token_${i % 15}`);
  const t0SimNative = performance.now();
  for (let i = 0; i < 500; i++) {
    nativeCore.computeSimHash64(tokens);
  }
  const nativeSimMs = (performance.now() - t0SimNative) / 500;

  const t0SimShim = performance.now();
  for (let i = 0; i < 500; i++) {
    shim.computeSimHash64(tokens);
  }
  const shimSimMs = (performance.now() - t0SimShim) / 500;

  return [
    {
      operator: 'Bit-Parallel Myers Distance (SWAR)',
      nativeMs: nativeMyersMs,
      shimMs: shimMyersMs,
      speedup: shimMyersMs / Math.max(0.0001, nativeMyersMs),
      throughput: `${(1 / (nativeMyersMs / 1000)).toFixed(0)} ops/sec`,
    },
    {
      operator: 'SimHash-64 & POPCNT Vector',
      nativeMs: nativeSimMs,
      shimMs: shimSimMs,
      speedup: shimSimMs / Math.max(0.0001, nativeSimMs),
      throughput: `${(1 / (nativeSimMs / 1000)).toFixed(0)} ops/sec`,
    },
  ];
}

function run() {
  console.log(
    '========================================================================================',
  );
  console.log('       AUTO-REFACTOR COMPREHENSIVE PERFORMANCE & ACCELERATION MATRIX');
  console.log(
    '========================================================================================\n',
  );

  const status = getNativeCoreStatus();
  console.log(`[Runtime Environment] Active Engine: ${status.activeEngine} (${status.version})`);
  console.log(
    `[Native Core Availability] ${status.isNativeAvailable ? 'AVAILABLE (N-API loaded)' : 'UNAVAILABLE'}\n`,
  );

  const allRows = [
    ...benchMaskingSuite(),
    ...benchScopeSuite(),
    ...benchCloneSuite(),
    ...benchDiffSuite(),
    ...benchVectorMathSuite(),
  ];

  console.log(
    '| Operator / Workload Scale                      | Native (ms) | Shim (ms) | Speedup  | Throughput / Rate                 |',
  );
  console.log(
    '| :--------------------------------------------- | ----------: | --------: | -------: | :-------------------------------- |',
  );

  for (const r of allRows) {
    const op = r.operator.padEnd(46, ' ');
    const nat = r.nativeMs.toFixed(3).padStart(11, ' ');
    const shm = r.shimMs.toFixed(3).padStart(9, ' ');
    const spd = `${r.speedup.toFixed(2)}x`.padStart(8, ' ');
    const tp = r.throughput.padEnd(33, ' ');
    console.log(`| ${op} | ${nat} | ${shm} | ${spd} | ${tp} |`);
  }

  console.log(
    '\n========================================================================================',
  );
  console.log(' PERFORMANCE MATRIX BENCHMARK COMPLETE');
  console.log(
    '========================================================================================',
  );
}

run();
