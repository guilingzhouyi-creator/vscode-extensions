#!/usr/bin/env node
/**
 * Empirical Quantitative Benchmark Suite — Data-Driven Performance Audit.
 *
 * Includes SIMD & 64-bit SWAR (SIMD Within A Register) Vectorization benchmarks:
 * - 64-bit SWAR ASCII verification (8 bytes/cycle)
 * - 64-bit Bit-Parallel Myers (BPM) vs standard Myers
 * - 50,000 ~ 100,000 lines ultra-massive file scaling
 * - Multi-scale Diff & Memory throughput
 */

const {
  myersDiff,
  histogramDiff,
  fastDiff,
  hashLinesDirect,
  computeLineStarts,
  computeLineStartsAndHashes,
  computeEditRanges,
  computeEditRangesWithOps,
  computeDetailedHunks,
  ModuleDependencyGraph,
  isPureAsciiSWAR64,
  bitParallelMyers64Distance,
} = require('../dist/api');
const { isPureAscii, normalizeEditRanges } = require('../dist/core/utf8');

function generateSyntheticSource(lineCount, editSpacing = 50) {
  const oldLines = [];
  const newLines = [];

  for (let i = 1; i <= lineCount; i++) {
    if (i % editSpacing === 0) {
      oldLines.push(`  function calculateMetric_${i}(val: number): number { return val * 10; }`);
      newLines.push(`  function calculateMetric_${i}(val: number): number { return val * 42 + 100; }`);
    } else {
      oldLines.push(`  const staticConfigEntry_${i} = "system_setting_value_${i}";`);
      newLines.push(`  const staticConfigEntry_${i} = "system_setting_value_${i}";`);
    }
  }

  return {
    oldContent: oldLines.join('\n'),
    newContent: newLines.join('\n'),
  };
}

function timeFn(fn, warmup = 3, runs = 10) {
  for (let i = 0; i < warmup; i++) fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function main() {
  console.log('================================================================');
  console.log('⚡ SIMD & 64-BIT SWAR HARDWARE-ALIGNED EMPIRICAL BENCHMARK SUITE');
  console.log('================================================================\n');

  // --- BENCHMARK 1: Multi-Scale Diff Scaling ---
  console.log('1. Multi-Scale Diff Execution Time (Median of 10 runs):');
  console.log('----------------------------------------------------------------');
  console.log('Scale (Lines) | Myers (ms) | FastDiff (ms) | Speedup Factor');
  console.log('----------------------------------------------------------------');

  const scales = [100, 500, 1500, 5000];
  for (const count of scales) {
    const { oldContent, newContent } = generateSyntheticSource(count);
    const oldIdx = computeLineStartsAndHashes(oldContent);
    const newIdx = computeLineStartsAndHashes(newContent);
    const a = oldIdx.starts.map((_, i) => oldContent.slice(oldIdx.starts[i], oldIdx.starts[i + 1] ? oldIdx.starts[i + 1] - 1 : oldContent.length));
    const b = newIdx.starts.map((_, i) => newContent.slice(newIdx.starts[i], newIdx.starts[i + 1] ? newIdx.starts[i + 1] - 1 : newContent.length));

    const tMyers = timeFn(() => myersDiff(a, b, oldIdx.hashes, newIdx.hashes), 2, 5);
    const tFast = timeFn(() => fastDiff(a, b, oldIdx.hashes, newIdx.hashes), 2, 5);
    const speedup = (tMyers / tFast).toFixed(2);

    console.log(
      `${String(count).padEnd(13)} | ${tMyers.toFixed(3).padEnd(10)} | ${tFast.toFixed(3).padEnd(13)} | ${speedup}x`
    );
  }

  // --- BENCHMARK 2: P0-1 Myers Flat Int32Array Trace (Disjoint Worst-Case) ---
  console.log('\n2. P0-1: Myers Disjoint Worst-Case (Zero Common Lines):');
  console.log('----------------------------------------------------------------');
  const a256 = Array.from({ length: 256 }, (_, i) => `old_disjoint_line_alpha_${i}`);
  const b256 = Array.from({ length: 256 }, (_, i) => `new_disjoint_line_beta_${i}`);
  const tDisjoint256 = timeFn(() => myersDiff(a256, b256), 2, 5);

  const a1000 = Array.from({ length: 1000 }, (_, i) => `old_disjoint_line_gamma_${i}`);
  const b1000 = Array.from({ length: 1000 }, (_, i) => `new_disjoint_line_delta_${i}`);
  const tDisjoint1000 = timeFn(() => myersDiff(a1000, b1000), 2, 5);

  console.log(`- 256 lines completely disjoint (Baseline 9.09ms) : ${tDisjoint256.toFixed(3)} ms`);
  console.log(`- 1000 lines completely disjoint (Baseline 40.17ms): ${tDisjoint1000.toFixed(3)} ms`);

  // --- BENCHMARK 3: P0-2 Single-Pass computeLineStartsAndHashes ---
  console.log('\n3. P0-2: computeLineStartsAndHashes Single-Pass vs computeEditRanges:');
  console.log('----------------------------------------------------------------');
  const src5000 = generateSyntheticSource(5000);
  const tSinglePass = timeFn(() => computeLineStartsAndHashes(src5000.oldContent), 5, 10);
  const tRangesWithOps = timeFn(() => computeEditRangesWithOps(src5000.oldContent, src5000.newContent), 5, 10);
  const tHunks = timeFn(() => computeDetailedHunks(src5000.oldContent, src5000.newContent), 5, 10);

  console.log(`- Single-pass line starts + hashes (5000 lines): ${tSinglePass.toFixed(3)} ms`);
  console.log(`- computeEditRangesWithOps (5000 lines, total)  : ${tRangesWithOps.toFixed(3)} ms`);
  console.log(`- computeDetailedHunks (5000 lines, total)      : ${tHunks.toFixed(3)} ms`);

  // --- BENCHMARK 4: P0-4 Dispersed 10-Edit vs 1-Edit on 5000 Lines ---
  console.log('\n4. P0-4: Dispersed 10-Edit vs 1-Edit on 5000 Lines:');
  console.log('----------------------------------------------------------------');
  const src1Edit = generateSyntheticSource(5000, 5000); // 1 edit at end
  const src10Edit = generateSyntheticSource(5000, 500);  // 10 edits scattered
  const t1Edit = timeFn(() => computeEditRanges(src1Edit.oldContent, src1Edit.newContent), 5, 10);
  const t10Edit = timeFn(() => computeEditRanges(src10Edit.oldContent, src10Edit.newContent), 5, 10);

  console.log(`- 1-edit 5000 lines  : ${t1Edit.toFixed(3)} ms`);
  console.log(`- 10-edit 5000 lines (Baseline 63.28ms): ${t10Edit.toFixed(3)} ms`);

  // --- BENCHMARK 5: 64-bit SWAR ASCII Validation & Zero-Allocation Path ---
  console.log('\n5. 64-bit SWAR ASCII Vector Scanning (8 Bytes/Cycle):');
  console.log('----------------------------------------------------------------');
  const asciiBuf = Buffer.from(src5000.oldContent.repeat(2), 'utf8'); // ~550KB
  const tSwarAscii = timeFn(() => isPureAsciiSWAR64(asciiBuf), 10, 50);

  const dummyEdits = [
    { startLine: 10, oldEndLine: 12, newEndLine: 12, startByte: 100, oldEndByte: 150, newEndByte: 150 },
    { startLine: 50, oldEndLine: 52, newEndLine: 52, startByte: 1000, oldEndByte: 1050, newEndByte: 1050 },
  ];
  const tAsciiNormalize = timeFn(() => normalizeEditRanges(dummyEdits, asciiBuf), 10, 50);

  console.log(`- Buffer size                 : ${(asciiBuf.length / 1024).toFixed(1)} KB`);
  console.log(`- 64-bit SWAR isPureAscii     : ${tSwarAscii.toFixed(4)} ms (${(asciiBuf.length / 1024 / 1024 / (tSwarAscii / 1000)).toFixed(1)} MB/s throughput)`);
  console.log(`- normalizeEditRanges (ASCII) : ${tAsciiNormalize.toFixed(4)} ms`);

  // --- BENCHMARK 6: Bit-Parallel Myers (BPM) 64-bit Vector Acceleration ---
  console.log('\n6. Bit-Parallel Myers (BPM) 64-bit Vector vs Standard Myers:');
  console.log('----------------------------------------------------------------');
  const pat64 = new Uint32Array(Array.from({ length: 64 }, (_, i) => i * 1337));
  const text64 = new Uint32Array(Array.from({ length: 64 }, (_, i) => (i % 5 === 0 ? i * 9999 : i * 1337)));

  const tBpm = timeFn(() => bitParallelMyers64Distance(pat64, text64), 20, 100);
  const patStrings = Array.from(pat64, String);
  const textStrings = Array.from(text64, String);
  const tStdMyers = timeFn(() => myersDiff(patStrings, textStrings), 20, 100);

  console.log(`- 64-line Pattern Bit-Parallel Myers : ${tBpm.toFixed(4)} ms (${(tBpm * 1000).toFixed(1)} μs)`);
  console.log(`- 64-line Standard Myers Graph Search: ${tStdMyers.toFixed(4)} ms`);
  console.log(`- Bit-Parallel Vector Speedup        : ${(tStdMyers / tBpm).toFixed(2)}x`);

  // --- BENCHMARK 7: Ultra-Massive Scale Stress (50,000 Lines Source) ---
  console.log('\n7. Ultra-Massive Scale Stress (50,000 Lines):');
  console.log('----------------------------------------------------------------');
  const src50k = generateSyntheticSource(50000, 1000);
  const t50kIndex = timeFn(() => computeLineStartsAndHashes(src50k.oldContent), 2, 5);
  const t50kFastDiff = timeFn(() => computeEditRanges(src50k.oldContent, src50k.newContent), 2, 5);

  console.log(`- 50,000 Lines File Size             : ${(src50k.oldContent.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`- Single-Pass 50k Starts + Hashes    : ${t50kIndex.toFixed(2)} ms`);
  console.log(`- 50,000 Lines FastDiff (50 edits)   : ${t50kFastDiff.toFixed(2)} ms`);

  // --- BENCHMARK 8: Memory & Throughput Stress Test (500 Consecutive Diffs) ---
  console.log('\n8. Memory & Throughput (500 Consecutive Diffs on 1500 lines):');
  console.log('----------------------------------------------------------------');
  const sample1500 = generateSyntheticSource(1500);
  if (global.gc) global.gc();

  const memBefore = process.memoryUsage().heapUsed;
  const startStamp = Date.now();

  for (let i = 0; i < 500; i++) {
    computeDetailedHunks(sample1500.oldContent, sample1500.newContent, 3);
  }

  const durationMs = Date.now() - startStamp;
  const memAfter = process.memoryUsage().heapUsed;
  const heapDeltaMB = ((memAfter - memBefore) / 1024 / 1024).toFixed(2);
  const throughput = ((500 / durationMs) * 1000).toFixed(1);

  console.log(`- 500 Diffs Total Duration           : ${durationMs} ms`);
  console.log(`- Throughput                         : ${throughput} diffs/sec`);
  console.log(`- Heap Delta After 500 Runs          : ${heapDeltaMB} MB`);

  // --- BENCHMARK 9: Module Reverse Dependency Graph Scalability ---
  console.log('\n9. Module Dependency Graph Scalability (1000 Nodes DAG):');
  console.log('----------------------------------------------------------------');
  const graph = new ModuleDependencyGraph();
  for (let i = 0; i < 1000; i++) {
    const file = `src/module_${i}.ts`;
    const imports = [
      `./module_${Math.max(0, i - 1)}.ts`,
      `./module_${Math.max(0, i - 2)}.ts`,
    ];
    const exports = [`exportSymbol_${i}`, `helper_${i}`];
    graph.registerModule(file, imports, exports);
  }

  const tQuery = timeFn(() => graph.getAffectedFiles('src/module_0.ts', 10), 10, 50);
  const affected = graph.getAffectedFiles('src/module_0.ts', 10);

  console.log(`- Graph Size                         : ${graph.size()} modules`);
  console.log(`- Affected Downstream Count          : ${affected.length} files`);
  console.log(`- Query Latency                      : ${tQuery.toFixed(4)} ms`);

  console.log('\n================================================================');
  console.log('🎉 SIMD & 64-BIT SWAR VECTORIZATION BENCHMARK COMPLETE');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
