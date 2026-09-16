/**
 * Module: Verification Harness — Oxc Mode A Per-File Projection Micro-Benchmark
 * File Path: scripts/bench-oxc-modea.js
 * Architecture Role: Standalone micro-benchmark that drives the OxcAdapter and the
 *     projection traversal directly instead of going through the scan CLI or dist/api.
 * Dependencies & Triggers: `npm run bench-oxc-modea` or manual
 *     `node scripts/bench-oxc-modea.js` on a built dist; reads the light/heavy f0.ts
 *     fixtures under C:/tmp/ar-fp-bench and patches NODE_PATH so dist modules resolve
 *     the repository's node_modules.
 * Responsibilities: Under AR_FASTPATH=1, warm both paths, then time 80 materialized
 *     parse+runStreaming rounds against tryCreateProjector+runStreamingProjected rounds
 *     for ConstantsAnalyzer and LargeFileAnalyzer only (complexity disabled); print the
 *     per-fixture milliseconds and projection delta; return { mat, proj, delta }.
 * Exit Semantics & Design Rationale: No catch handler and no explicit exit code: a
 *     missing fixture or unavailable native binding throws and exits non-zero, while a
 *     complete run exits 0. Fixtures are a precondition, so failing loudly is correct.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

function bench(content, label) {
  const { OxcAdapter } = require(path.join(ROOT, 'dist', 'core', 'oxcAdapter'));
  const { runStreaming, runStreamingProjected, FileMetricCollector, tryCreateProjector } = require(
    path.join(ROOT, 'dist', 'core', 'traverse'),
  );
  const { ConstantsAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'constants'));
  const { LargeFileAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'largeFile'));
  const { countLineStats } = require(path.join(ROOT, 'dist', 'utils', 'linestats'));

  const adapter = new OxcAdapter();
  const cfg = { failOnAnalyzerError: false };
  const lineStats = countLineStats(content);
  const mkCtx = (o) => ({
    filePath: 'f0.ts',
    content,
    root: null,
    adapter,
    config: cfg,
    options: o,
    lineStats,
  });
  const buildEntries = () => [
    {
      analyzer: new ConstantsAnalyzer(),
      ctx: mkCtx({ magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 }),
    },
    {
      analyzer: new LargeFileAnalyzer(),
      ctx: mkCtx({ fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 }),
    },
    { analyzer: new FileMetricCollector(), ctx: mkCtx({}) },
  ];
  const names = ['constants', 'large-file'];
  process.env.AR_FASTPATH = '1';
  const N = 80;
  for (let k = 0; k < 3; k++) {
    const ast = adapter.parse(content, 'f0.ts');
    runStreaming(adapter, ast.root, buildEntries());
  }
  for (let k = 0; k < 3; k++) {
    const p = tryCreateProjector(adapter, content, 'f0.ts', names, 0);
    runStreamingProjected(p, buildEntries());
  }
  const t0 = performance.now();
  for (let k = 0; k < N; k++) {
    const ast = adapter.parse(content, 'f0.ts');
    runStreaming(adapter, ast.root, buildEntries());
  }
  const mat = (performance.now() - t0) / N;
  const t1 = performance.now();
  for (let k = 0; k < N; k++) {
    const p = tryCreateProjector(adapter, content, 'f0.ts', names, 0);
    runStreamingProjected(p, buildEntries());
  }
  const proj = (performance.now() - t1) / N;
  const delta = ((proj - mat) / mat) * 100;
  console.log(
    `  ${label.padEnd(8)} ${String(content.length).padStart(6)}B  mat=${mat.toFixed(3)}ms  proj=${proj.toFixed(3)}ms  Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
  );
  return { mat, proj, delta };
}

function main() {
  const light = fs.readFileSync('C:/tmp/ar-fp-bench/light/f0.ts', 'utf8');
  const heavy = fs.readFileSync('C:/tmp/ar-fp-bench/heavy/f0.ts', 'utf8');
  console.log('[Mode A per-file, parser=oxc]');
  bench(light, 'light');
  bench(heavy, 'heavy');
}

main();
