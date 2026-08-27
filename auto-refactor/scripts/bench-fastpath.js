#!/usr/bin/env node
// bench-fastpath.js — P1-1 lazy-projection equivalence gate + A/B benchmark (T05).
//
//   node scripts/bench-fastpath.js --check    # fixture equivalence gate (CI-friendly)
//   node scripts/bench-fastpath.js            # dual-corpus w4 wall A/B + per-file table
//   node scripts/bench-fastpath.js --iters=5 --corpus=light|heavy
//   node scripts/bench-fastpath.js --check --oxc   # same gate with parser='oxc' (T04)
//   node scripts/bench-fastpath.js --oxc --corpus=light  # oxc A/B (T04)
//
// --check (fixture equivalence gate):
//   Scans testdata/fixtures under BOTH canonical configs — ModeA (constants + large-file,
//   complexity explicitly disabled) and ModeB (all three built-ins) — once with
//   AR_FASTPATH=0 (materialized baseline) and once with AR_FASTPATH=1 (projection), and
//   asserts normalize(issues+fileMetrics) is byte-identical. Exit 1 on any diff.
//   With --oxc the same comparison runs through parser='oxc' (OxcProjector vs materialized
//   OxcAdapter); the ts mode is unchanged.
//
// default (A/B benchmark):
//   Builds a 1001-file lightweight (~2.5KB) and a 1001-file heavy (~6.5KB) TS corpus under
//   C:/tmp/ar-fp-bench/, then runs a STRICTLY INTERLEAVED workers=4 A/B (AR_FASTPATH=0 vs
//   =1, --iters runs each, alternating so machine-load drift hits both modes equally) and
//   prints a wall table (median) plus an in-process per-file table measured directly on the
//   adapter (parse+runStreaming vs project+runStreamingProjected).
//   With --oxc the same A/B runs parser='oxc' (OxcAdapter materialized vs OxcProjector).
//
// Does NOT touch scripts/validate-equivalence.js / bench-baselines.js / baselines/*.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

const BENCH_ROOT = 'C:/tmp/ar-fp-bench';
const LIGHT = path.join(BENCH_ROOT, 'light');
const HEAVY = path.join(BENCH_ROOT, 'heavy');

const ARGS = process.argv.slice(2);
const CHECK = ARGS.includes('--check');
const OXC = ARGS.includes('--oxc');
const ITERS = parseInt(ARGS.find((a) => a.startsWith('--iters='))?.split('=')[1] || '5', 10);
const CORPUS_ONLY = ARGS.find((a) => a.startsWith('--corpus='))?.split('=')[1] || 'both';
const PARSER = OXC ? 'oxc' : 'typescript';
const ADAPTER_MODULE = OXC ? 'oxcAdapter' : 'typescriptAdapter';
const ADAPTER_CLASS = OXC ? 'OxcAdapter' : 'TypeScriptAdapter';

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// ---------------------------------------------------------------------------
// --check: fixture equivalence gate
// ---------------------------------------------------------------------------

function normalize(r) {
  const issues = r.issues
    .map((x) => ({ id: x.id, analyzer: x.analyzer, rule: x.rule, severity: x.severity, message: x.message, location: x.location, detail: x.detail }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics.map((m) => ({ ...m })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return JSON.stringify(
    { filesScanned: r.summary.filesScanned, issuesTotal: r.summary.issuesTotal, byAnalyzer: r.summary.byAnalyzer, bySeverity: r.summary.bySeverity, issues, fileMetrics },
    null,
    2,
  );
}

async function checkFixtures() {
  const { scan } = require(path.join(ROOT, 'dist', 'api'));
  const fixturesDir = path.join(ROOT, 'testdata', 'fixtures');
  const configs = [
    ['ModeA', path.join(fixturesDir, 'config-mode-a.json')],
    ['ModeB', path.join(fixturesDir, 'config-mode-b.json')],
  ];
  let failed = 0;
  for (const [label, cfg] of configs) {
    const fullLabel = `${label}${OXC ? '-oxc' : ''}`;
    const out0 = await scanOnce(scan, fixturesDir, cfg, '0');
    const out1 = await scanOnce(scan, fixturesDir, cfg, '1');
    const ok = out0 === out1;
    if (!ok) failed++;
    const n0 = JSON.parse(out0).issuesTotal;
    const n1 = JSON.parse(out1).issuesTotal;
    console.log(`${ok ? 'PASS' : 'FAIL'}  fixtures ${fullLabel}: fast=0 issues=${n0}  fast=1 issues=${n1}  byteIdentical=${ok}`);
  }
  console.log(failed === 0 ? `\nfastpath-check (${PARSER}): ALL FIXTURE CLASSES EQUIVALENT` : `\nfastpath-check (${PARSER}): ${failed} FAILED`);
  return failed === 0;
}

async function scanOnce(scan, root, configFile, fast) {
  process.env.AR_FASTPATH = fast;
  const r = await scan({ root, configFile, workers: 1, format: 'json', logLevel: 'silent', parser: PARSER });
  return normalize(r);
}

// ---------------------------------------------------------------------------
// default: dual-corpus w4 A/B benchmark
// ---------------------------------------------------------------------------

function writeBenchConfig(dir) {
  const cfg = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: {
      magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3,
      fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15,
      complexityWarn: 8, complexityFail: 12,
    },
    analyzers: {
      constants: { enabled: true, options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 } },
      'large-file': { enabled: true, options: { fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 } },
      complexity: { enabled: true, options: { complexityWarn: 5, complexityFail: 10 } },
    },
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 4,
    respectGitignore: false,
    failOnAnalyzerError: false,
  };
  fs.writeFileSync(path.join(dir, 'auto-refactor.config.json'), JSON.stringify(cfg, null, 2));
}

function lightFile(i) {
  const seed = i % 7;
  const parts = [`import { foo } from './dep${i % 13}';`, `export interface Opts${i} { mode: string; limit: number; flag?: boolean }`];
  for (let k = 0; k < 8; k++) {
    parts.push(`export function fn${i}_${k}(x: number, y: string): number {`);
    parts.push(`  let acc = ${seed};`);
    parts.push(`  if (x > ${k}) { for (let j = 0; j < 4; j++) { acc += x * j ? 0 : 0; } }`);
    parts.push(`  switch (x) { case 1: acc++; break; case 2: acc--; break; default: acc += 2; }`);
    parts.push(`  const msg = "token ${seed}"; if (y === msg) acc += 1;`);
    parts.push(`  return acc > 0 ? acc : -acc;`);
    parts.push(`}`);
  }
  return parts.join('\n') + '\n';
}

function heavyFile(i) {
  const parts = [`import { helper } from './dep${i % 17}';`];
  const seed = i * 31 + 7;
  for (let k = 0; k < 14; k++) {
    const a = (k * 7 + seed) % 1000;
    const b = (k * 13 + seed * 3) % 1000;
    const c = (k * 17 + seed * 5) % 1000;
    const s = `"str token ${k} of ${i}"`;
    parts.push(`export function fn${i}_${k}(x: number, y: string): number {`);
    parts.push(`  let acc = ${seed % 1000};`);
    parts.push(`  if (x > ${a}) {`);
    parts.push(`    acc += ${a};`);
    parts.push(`    if (x > ${b}) { acc -= ${b}; } else { acc += ${b}; }`);
    parts.push(`  }`);
    parts.push(`  for (let j = 0; j < ${k % 5 + 2}; j++) {`);
    parts.push(`    acc += j * ${c};`);
    parts.push(`    if (j > 2 && y === ${s}) { acc -= ${c}; }`);
    parts.push(`  }`);
    parts.push(`  while (acc > 100000) { acc -= 1000; }`);
    parts.push(`  const msg = ${s};`);
    parts.push(`  switch (acc % 4) { case 0: acc += ${a}; break; case 1: acc -= ${b}; break; default: acc += 1; }`);
    parts.push(`  return acc > 0 ? acc : -acc;`);
    parts.push(`}`);
  }
  return parts.join('\n') + '\n';
}

function buildCorpus(dir, gen, count) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(dir, path.join('C:/tmp', `ar-stale-${path.basename(dir)}-${Date.now()}`));
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), gen(i));
  writeBenchConfig(dir);
  let total = 0;
  let n = 0;
  for (let i = 0; i < count; i += 25) {
    total += fs.statSync(path.join(dir, `f${i}.ts`)).size;
    n++;
  }
  return Math.round(total / n);
}

function runScan(dir, fast) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, ['-e', `
    const { scan } = require(${JSON.stringify(path.join(ROOT, 'dist', 'api'))});
    scan({ root: ${JSON.stringify(dir)}, configFile: ${JSON.stringify(path.join(dir, 'auto-refactor.config.json'))}, workers: 4, format: 'json', logLevel: 'silent', parser: ${JSON.stringify(PARSER)} })
      .then((rep) => process.stdout.write(JSON.stringify({ files: rep.summary.filesScanned, issues: rep.summary.issuesTotal })))
      .catch((e) => { console.error(e); process.exit(1); });
  `], { env: { ...process.env, AR_FASTPATH: fast }, cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`scan failed (AR_FASTPATH=${fast}): ${r.stderr}`);
  return { wall: performance.now() - t0, summary: r.stdout.trim() };
}

/** In-process per-file table: parse+runStreaming vs project+runStreamingProjected. */
function perFileTable(dir, label) {
  const content = fs.readFileSync(path.join(dir, 'f0.ts'), 'utf8');
  const { [ADAPTER_CLASS]: AdapterCls } = require(path.join(ROOT, 'dist', 'core', ADAPTER_MODULE));
  const {
    runStreaming, runStreamingProjected, FileMetricCollector, tryCreateProjector,
  } = require(path.join(ROOT, 'dist', 'core', 'traverse'));
  const { ConstantsAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'constants'));
  const { LargeFileAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'largeFile'));
  const { ComplexityAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'complexity'));
  const { countLineStats } = require(path.join(ROOT, 'dist', 'utils', 'linestats'));

  const adapter = new AdapterCls();
  const cfg = { failOnAnalyzerError: false };
  const lineStats = countLineStats(content);
  const mkCtx = (o) => ({ filePath: 'f0.ts', content, root: null, adapter, config: cfg, options: o, lineStats });
  // Fresh analyzer instances PER iteration — streaming analyzers accumulate visit state
  // (constants' literals, complexity's issues), so sharing instances across iterations
  // would inflate later iterations and skew the per-file numbers.
  const buildEntries = () => [
    { analyzer: new ConstantsAnalyzer(), ctx: mkCtx({ magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 }) },
    { analyzer: new LargeFileAnalyzer(), ctx: mkCtx({ fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 }) },
    { analyzer: new ComplexityAnalyzer(), ctx: mkCtx({ complexityWarn: 5, complexityFail: 10 }) },
    { analyzer: new FileMetricCollector(), ctx: mkCtx({}) },
  ];
  const names = ['constants', 'large-file', 'complexity'];
  process.env.AR_FASTPATH = '1';
  const N = 60;
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
async function benchCorpus(dir, label, count) {
  const times = { 0: [], 1: [] };
  for (let k = 0; k < ITERS; k++) {
    for (const mode of [k % 2 === 0 ? '0' : '1', k % 2 === 0 ? '1' : '0']) {
      const { wall, summary } = runScan(dir, mode);
      times[mode].push(wall);
      process.stderr.write(`  [${label}] round ${k + 1} AR_FASTPATH=${mode}: ${wall.toFixed(1)}ms (${summary})\n`);
    }
  }
  const m0 = median(times['0']);
  const m1 = median(times['1']);
  const delta = ((m1 - m0) / m0) * 100;
  console.log(`\n[bench-fastpath] ${label} (${count} files, w4, ${ITERS} interleaved runs):`);
  console.log(`  AR_FASTPATH=0 median: ${m0.toFixed(1)}ms   AR_FASTPATH=1 median: ${m1.toFixed(1)}ms   Δ=${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`);
  return { m0, m1, delta };
}

async function main() {
  if (CHECK) {
    const ok = await checkFixtures();
    process.exit(ok ? 0 : 1);
  }

  const lightAvg = CORPUS_ONLY !== 'heavy' ? buildCorpus(LIGHT, lightFile, 1001) : null;
  const heavyAvg = CORPUS_ONLY !== 'light' ? buildCorpus(HEAVY, heavyFile, 1001) : null;
  if (lightAvg) console.log(`[bench-fastpath] corpus light (${PARSER}): 1001 files, avg ~${lightAvg}B`);
  if (heavyAvg) console.log(`[bench-fastpath] corpus heavy (${PARSER}): 1001 files, avg ~${heavyAvg}B`);

  console.log(`\n[bench-fastpath] per-file (in-process, Mode B, ${PARSER}):`);
  if (lightAvg) perFileTable(LIGHT, 'light');
  if (heavyAvg) perFileTable(HEAVY, 'heavy');

  const out = {};
  if (CORPUS_ONLY !== 'heavy') out.light = await benchCorpus(LIGHT, 'light', 1001);
  if (CORPUS_ONLY !== 'light') out.heavy = await benchCorpus(HEAVY, 'heavy', 1001);
  console.log('\n[bench-fastpath] DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
