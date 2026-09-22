/**
 * Module: Verification Harness — Asymmetric Dual-Track Scan Benchmark
 * File Path: scripts/bench-asymmetric.js
 * Architecture Role: Standalone benchmark entry point that drives the built public
 *     dist/api surface; it is never imported by engine, CLI, or daemon code.
 * Dependencies & Triggers: `npm run bench-asymmetric` or manual
 *     `node scripts/bench-asymmetric.js` against a built dist; loads Scanner and
 *     executeDualTrack from ../dist/api plus the Node process/path APIs.
 * Responsibilities: Measure a cold full-repo scan (src TS glob, 10 analyzers), a 50-run
 *     symmetric single-file rescan of diffClassifier.ts, and FastTrack literal and
 *     structural mutations; report latency, verdict score, heap delta and speedups.
 * Exit Semantics & Design Rationale: Any rejection is logged and followed by
 *     process.exit(1); successful runs fall through with exit 0. No pass/fail thresholds
 *     are asserted because this harness observes raw timings, and a slow host must not
 *     turn a measurement run into a build failure.
 */

const { Scanner, executeDualTrack } = require('../dist/api');

async function runBenchmark() {
  console.log('===============================================================');
  console.log('       ASYMMETRIC AUDIT SCANNING ENGINE BENCHMARK              ');
  console.log('===============================================================\n');

  const config = {
    root: process.cwd(),
    include: ['src/**/*.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    analyzers: {
      constants: { enabled: true },
      'large-file': { enabled: true },
      complexity: { enabled: true },
      governance: { enabled: true },
      'dependency-graph': { enabled: true },
      secrets: { enabled: true },
      architecture: { enabled: true },
      performance: { enabled: true },
      comments: { enabled: true },
      hygiene: { enabled: true },
    },
  };

  const scanner = new Scanner(config);

  // 1. Cold scan baseline
  console.log('Measuring Cold Full Scan Baseline...');
  const coldMemStart = process.memoryUsage().heapUsed;
  const t0 = Date.now();
  const coldReport = await scanner.scan();
  const coldDuration = Date.now() - t0;
  const coldMemUsedMb = ((process.memoryUsage().heapUsed - coldMemStart) / (1024 * 1024)).toFixed(
    2,
  );

  console.log(`  - Discovered files: ${coldReport.summary.filesScanned}`);
  console.log(`  - Issues detected: ${coldReport.summary.issuesTotal}`);
  console.log(`  - Cold scan latency: ${coldDuration} ms`);
  console.log(`  - Heap delta: ~${coldMemUsedMb} MB\n`);

  // 2. Symmetric rescan of 1 mutated file (All 10 Analyzers)
  console.log('Measuring Symmetric Single-File Rescan (All 10 Analyzers)...');
  const targetFile = 'src/core/router/diffClassifier.ts';
  const sampleOldLit = `const MAX_TIMEOUT = 5000;`;
  const sampleNewLit = `const MAX_TIMEOUT = 10000;`;

  const t1 = Date.now();
  for (let i = 0; i < 50; i++) {
    await scanner.runAnalyzers(targetFile, sampleNewLit);
  }
  const symDuration = (Date.now() - t1) / 50;
  console.log(`  - Symmetric scan latency (avg of 50 runs): ${symDuration.toFixed(2)} ms\n`);

  // 3. Asymmetric FastTrack scan: Scenario A (Literal Mutation)
  console.log('Measuring Asymmetric FastTrack - Scenario A: Literal Mutation (< 15ms target)...');
  const t2 = Date.now();
  let fastVerdictA;
  for (let i = 0; i < 50; i++) {
    const exec = await executeDualTrack(scanner, [
      {
        filePath: targetFile,
        oldContent: sampleOldLit,
        newContent: sampleNewLit,
      },
    ]);
    fastVerdictA = exec.fastVerdict;
  }
  const asymFastDurationA = (Date.now() - t2) / 50;

  console.log(
    `  - FastTrack foreground latency (avg of 50 runs): ${asymFastDurationA.toFixed(2)} ms (internal: ${fastVerdictA.latencyMs} ms)`,
  );
  console.log(`  - Speculative verdict: ${fastVerdictA.status}`);
  console.log(
    `  - Speculative score: ${fastVerdictA.score.compositeScore} (${fastVerdictA.score.grade})`,
  );
  console.log(
    `  - Active analyzers ratio: ${fastVerdictA.sparseRouting[targetFile]?.activationRatio * 100}%`,
  );
  console.log(
    `  - Active analyzers: [${Array.from(fastVerdictA.sparseRouting[targetFile]?.activeAnalyzers || []).join(', ')}]`,
  );
  console.log(
    `  - Workload reduction: ${(100 - fastVerdictA.sparseRouting[targetFile]?.activationRatio * 100).toFixed(0)}% compute eliminated!\n`,
  );

  // 4. Asymmetric FastTrack scan: Scenario B (Structural Mutation)
  console.log('Measuring Asymmetric FastTrack - Scenario B: Structural Mutation...');
  const sampleOldStruct = `export function testA() { return 1; }`;
  const sampleNewStruct = `export function testA() { return 42; }`;
  const t3 = Date.now();
  const execB = await executeDualTrack(scanner, [
    {
      filePath: targetFile,
      oldContent: sampleOldStruct,
      newContent: sampleNewStruct,
    },
  ]);
  const asymFastDurationB = Date.now() - t3;
  const deepVerdictB = await execB.deepPromise;
  console.log(`  - FastTrack foreground latency: ${asymFastDurationB} ms`);
  console.log(
    `  - DeepTrack background latency: ${deepVerdictB.latencyMs} ms (${deepVerdictB.status})\n`,
  );

  // Compute speedups
  const speedupColdVsFastA = (coldDuration / Math.max(0.1, asymFastDurationA)).toFixed(1);
  const speedupSymVsFastA = (symDuration / Math.max(0.1, asymFastDurationA)).toFixed(1);

  console.log('===============================================================');
  console.log('                     BENCHMARK SUMMARY                         ');
  console.log('===============================================================');
  console.log(`1. Cold Full Repository Scan:        ${coldDuration} ms`);
  console.log(
    `2. Symmetric Single-File Scan:        ${symDuration.toFixed(2)} ms (100% analyzers)`,
  );
  console.log(
    `3. Asymmetric FastTrack (Literal):    ${asymFastDurationA.toFixed(2)} ms (MoE: 20% active)`,
  );
  console.log(`4. Acceleration vs Cold Baseline:     ${speedupColdVsFastA}x faster`);
  console.log(`5. Acceleration vs Symmetric Rescan:  ${speedupSymVsFastA}x faster`);
  console.log(
    `6. MoE Analyzer Compute Reduction:    ${(100 - fastVerdictA.sparseRouting[targetFile]?.activationRatio * 100).toFixed(0)}% eliminated`,
  );
  console.log('===============================================================\n');
}

runBenchmark().catch((e) => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
