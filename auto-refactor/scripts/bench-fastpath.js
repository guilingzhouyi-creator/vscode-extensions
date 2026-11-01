#!/usr/bin/env node
/**
 * Module: Verification Harness — Fastpath Projection Equivalence Gate & A/B Benchmark
 * File Path: scripts/bench-fastpath.js
 * Architecture Role: Dual-mode entry point: a CI-friendly equivalence gate for the
 *     AR_FASTPATH projection path and a standalone wall-clock/per-file benchmark.
 * Dependencies & Triggers: `npm run fastpath-check`/`fastpath-bench` or manual
 *     `node scripts/bench-fastpath.js [--check] [--oxc] [--iters=N]
 *     [--corpus=light|heavy]`
 *     on a built dist; reads testdata/fixtures, spawns worker scans, and generates
 *     1001-file corpora under a temporary benchmark directory.
 * Responsibilities: In --check mode compare normalized issue+fileMetric output of
 *     AR_FASTPATH=0/1 scans under the ModeA and ModeB configs for the ts or oxc parser;
 *     otherwise build the light/heavy corpora, report strictly interleaved workers=4 wall
 *     medians, and time materialized parse+runStreaming vs projected runStreamingProjected.
 * Exit Semantics & Design Rationale: --check exits 1 on any fixture divergence and 0 on
 *     equality; benchmark failures reject and exit 1. Equivalence is gated hard while
 *     timings stay advisory, so machine-load noise cannot break CI.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

const BENCH_ROOT = path.join(os.tmpdir(), 'ar-fp-bench');
const LIGHT_CORPUS_DIR = path.join(BENCH_ROOT, 'light');
const HEAVY_CORPUS_DIR = path.join(BENCH_ROOT, 'heavy');

const ARGS = process.argv.slice(2);
const CHECK_MODE = ARGS.includes('--check');
const USE_OXC = ARGS.includes('--oxc');
const ITERATION_COUNT = parseInt(
  ARGS.find((arg) => arg.startsWith('--iters='))?.split('=')[1] || '5',
  10,
);
const CORPUS_SELECTION = ARGS.find((arg) => arg.startsWith('--corpus='))?.split('=')[1] || 'both';
const PARSER_NAME = USE_OXC ? 'oxc' : 'typescript';
const ADAPTER_MODULE = USE_OXC ? 'oxcAdapter' : 'typescriptAdapter';
const ADAPTER_CLASS = USE_OXC ? 'OxcAdapter' : 'TypeScriptAdapter';

function computeMedianTime(durationList) {
  const sortedDurations = [...durationList].sort((itemA, itemB) => itemA - itemB);
  return sortedDurations[Math.floor(sortedDurations.length / 2)];
}

// ---------------------------------------------------------------------------
// --check: fixture equivalence gate
// ---------------------------------------------------------------------------

function normalizeScanReport(rawReport) {
  const issues = rawReport.issues
    .map((issueItem) => ({
      id: issueItem.id,
      analyzer: issueItem.analyzer,
      rule: issueItem.rule,
      severity: issueItem.severity,
      message: issueItem.message,
      location: issueItem.location,
      detail: issueItem.detail,
    }))
    .sort((issueA, issueB) => (issueA.id < issueB.id ? -1 : issueA.id > issueB.id ? 1 : 0));
  const fileMetrics = rawReport.fileMetrics
    .map((metricItem) => ({ ...metricItem }))
    .sort((metricA, metricB) => (metricA.file < metricB.file ? -1 : metricA.file > metricB.file ? 1 : 0));
  return JSON.stringify(
    {
      filesScanned: rawReport.summary.filesScanned,
      issuesTotal: rawReport.summary.issuesTotal,
      byAnalyzer: rawReport.summary.byAnalyzer,
      bySeverity: rawReport.summary.bySeverity,
      issues,
      fileMetrics,
    },
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
  let failedCount = 0;
  for (const [label, configPath] of configs) {
    const fullLabel = `${label}${USE_OXC ? '-oxc' : ''}`;
    const outputFastpathOff = await scanOnce(scan, fixturesDir, configPath, '0');
    const outputFastpathOn = await scanOnce(scan, fixturesDir, configPath, '1');
    const isEquivalent = outputFastpathOff === outputFastpathOn;
    if (!isEquivalent) failedCount++;
    const issuesTotalOff = JSON.parse(outputFastpathOff).issuesTotal;
    const issuesTotalOn = JSON.parse(outputFastpathOn).issuesTotal;
    console.log(
      `${isEquivalent ? '✔ PASS' : '✖ BLOCK'}  fixtures ${fullLabel}: fast=0 issues=${issuesTotalOff}  fast=1 issues=${issuesTotalOn}  byteIdentical=${isEquivalent}`,
    );
  }
  console.log(
    failedCount === 0
      ? `\nfastpath-check (${PARSER_NAME}): ALL FIXTURE CLASSES EQUIVALENT`
      : `\nfastpath-check (${PARSER_NAME}): ${failedCount} FAILED`,
  );
  return failedCount === 0;
}

async function scanOnce(scanFunction, targetRoot, configFilePath, fastpathFlag) {
  process.env.AR_FASTPATH = fastpathFlag;
  const scanReport = await scanFunction({
    root: targetRoot,
    configFile: configFilePath,
    workers: 1,
    format: 'json',
    logLevel: 'silent',
    parser: PARSER_NAME,
  });
  return normalizeScanReport(scanReport);
}

// ---------------------------------------------------------------------------
// default: dual-corpus multi-worker A/B benchmark
// ---------------------------------------------------------------------------

function writeBenchConfig(targetDir) {
  const benchmarkConfig = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: {
      magicNumberMin: 2,
      duplicateLiteralThreshold: 3,
      hardcodedStringMinLength: 3,
      fileLinesWarn: 400,
      fileLinesFail: 800,
      fileFunctionsWarn: 15,
      complexityWarn: 8,
      complexityFail: 12,
    },
    analyzers: {
      constants: {
        enabled: true,
        options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 },
      },
      'large-file': {
        enabled: true,
        options: { fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 },
      },
      complexity: { enabled: true, options: { complexityWarn: 5, complexityFail: 10 } },
    },
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 4,
    respectGitignore: false,
    failOnAnalyzerError: false,
  };
  fs.writeFileSync(
    path.join(targetDir, 'auto-refactor.config.json'),
    JSON.stringify(benchmarkConfig, null, 2),
  );
}

function generateLightFileContent(fileIndex) {
  const seedValue = fileIndex % 7;
  const contentParts = [
    `import { foo } from './dep${fileIndex % 13}';`,
    `export interface Opts${fileIndex} { mode: string; limit: number; flag?: boolean }`,
  ];
  for (let stepIndex = 0; stepIndex < 8; stepIndex++) {
    contentParts.push(
      `export function fn${fileIndex}_${stepIndex}(paramX: number, paramY: string): number {`,
    );
    contentParts.push(`  let accumulator = ${seedValue};`);
    contentParts.push(
      `  if (paramX > ${stepIndex}) { for (let loopIdx = 0; loopIdx < 4; loopIdx++) { accumulator += paramX * loopIdx ? 0 : 0; } }`,
    );
    contentParts.push(
      `  switch (paramX) { case 1: accumulator++; break; case 2: accumulator--; break; default: accumulator += 2; }`,
    );
    contentParts.push(
      `  const tokenMessage = "token ${seedValue}"; if (paramY === tokenMessage) accumulator += 1;`,
    );
    contentParts.push(`  return accumulator > 0 ? accumulator : -accumulator;`);
    contentParts.push(`}`);
  }
  return contentParts.join('\n') + '\n';
}

function generateHeavyFileContent(fileIndex) {
  const contentParts = [`import { helper } from './dep${fileIndex % 17}';`];
  const seedValue = fileIndex * 31 + 7;
  for (let stepIndex = 0; stepIndex < 14; stepIndex++) {
    const coeffA = (stepIndex * 7 + seedValue) % 1000;
    const coeffB = (stepIndex * 13 + seedValue * 3) % 1000;
    const coeffC = (stepIndex * 17 + seedValue * 5) % 1000;
    const stringLiteral = `"str token ${stepIndex} of ${fileIndex}"`;
    contentParts.push(
      `export function fn${fileIndex}_${stepIndex}(paramX: number, paramY: string): number {`,
    );
    contentParts.push(`  let accumulator = ${seedValue % 1000};`);
    contentParts.push(`  if (paramX > ${coeffA}) {`);
    contentParts.push(`    accumulator += ${coeffA};`);
    contentParts.push(
      `    if (paramX > ${coeffB}) { accumulator -= ${coeffB}; } else { accumulator += ${coeffB}; }`,
    );
    contentParts.push(`  }`);
    contentParts.push(`  for (let loopIdx = 0; loopIdx < ${(stepIndex % 5) + 2}; loopIdx++) {`);
    contentParts.push(`    accumulator += loopIdx * ${coeffC};`);
    contentParts.push(`    if (loopIdx > 2 && paramY === ${stringLiteral}) { accumulator -= ${coeffC}; }`);
    contentParts.push(`  }`);
    contentParts.push(`  while (accumulator > 100000) { accumulator -= 1000; }`);
    contentParts.push(`  const tokenMessage = ${stringLiteral};`);
    contentParts.push(
      `  switch (accumulator % 4) { case 0: accumulator += ${coeffA}; break; case 1: accumulator -= ${coeffB}; break; default: accumulator += 1; }`,
    );
    contentParts.push(`  return accumulator > 0 ? accumulator : -accumulator;`);
    contentParts.push(`}`);
  }
  return contentParts.join('\n') + '\n';
}

function buildCorpus(targetDir, fileGenerator, targetCount) {
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(
        targetDir,
        path.join(os.tmpdir(), `ar-stale-${path.basename(targetDir)}-${Date.now()}`),
      );
    } catch {
      /* ignore */
    }
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (let fileIdx = 0; fileIdx < targetCount; fileIdx++) {
    fs.writeFileSync(path.join(targetDir, `f${fileIdx}.ts`), fileGenerator(fileIdx));
  }
  writeBenchConfig(targetDir);
  let totalBytes = 0;
  let sampleCount = 0;
  for (let fileIdx = 0; fileIdx < targetCount; fileIdx += 25) {
    totalBytes += fs.statSync(path.join(targetDir, `f${fileIdx}.ts`)).size;
    sampleCount++;
  }
  return Math.round(totalBytes / sampleCount);
}

function runScan(targetDir, fastpathMode) {
  const startTime = performance.now();
  const processResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const { scan } = require(${JSON.stringify(path.join(ROOT, 'dist', 'api'))});
    scan({ root: ${JSON.stringify(targetDir)}, configFile: ${JSON.stringify(path.join(targetDir, 'auto-refactor.config.json'))}, workers: 4, format: 'json', logLevel: 'silent', parser: ${JSON.stringify(PARSER_NAME)} })
      .then((rep) => process.stdout.write(JSON.stringify({ files: rep.summary.filesScanned, issues: rep.summary.issuesTotal })))
      .catch((e) => { console.error(e); process.exit(1); });
  `,
    ],
    { env: { ...process.env, AR_FASTPATH: fastpathMode }, cwd: ROOT, encoding: 'utf8' },
  );
  if (processResult.status !== 0) {
    throw new Error(`scan failed (AR_FASTPATH=${fastpathMode}): ${processResult.stderr}`);
  }
  return { wall: performance.now() - startTime, summary: processResult.stdout.trim() };
}

function buildStreamingEntries(contextHelper) {
  const { ConstantsAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'constants'));
  const { LargeFileAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'largeFile'));
  const { ComplexityAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'complexity'));
  const { FileMetricCollector } = require(path.join(ROOT, 'dist', 'core', 'traverse'));

  return [
    {
      analyzer: new ConstantsAnalyzer(),
      ctx: contextHelper({
        magicNumberMin: 2,
        duplicateLiteralThreshold: 3,
        hardcodedStringMinLength: 3,
      }),
    },
    {
      analyzer: new LargeFileAnalyzer(),
      ctx: contextHelper({ fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 }),
    },
    {
      analyzer: new ComplexityAnalyzer(),
      ctx: contextHelper({ complexityWarn: 5, complexityFail: 10 }),
    },
    { analyzer: new FileMetricCollector(), ctx: contextHelper({}) },
  ];
}

/** In-process per-file table: parse+runStreaming vs project+runStreamingProjected. */
function perFileTable(targetDir, corpusLabel) {
  const fileContent = fs.readFileSync(path.join(targetDir, 'f0.ts'), 'utf8');
  const { [ADAPTER_CLASS]: AdapterCls } = require(path.join(ROOT, 'dist', 'core', ADAPTER_MODULE));
  const { runStreaming, runStreamingProjected, tryCreateProjector } = require(
    path.join(ROOT, 'dist', 'core', 'traverse'),
  );
  const { countLineStats } = require(path.join(ROOT, 'dist', 'utils', 'linestats'));

  const adapterInstance = new AdapterCls();
  const scanConfig = { failOnAnalyzerError: false };
  const lineStats = countLineStats(fileContent);
  const makeContext = (options) => ({
    filePath: 'f0.ts',
    content: fileContent,
    root: null,
    adapter: adapterInstance,
    config: scanConfig,
    options,
    lineStats,
  });

  const analyzerNames = ['constants', 'large-file', 'complexity'];
  process.env.AR_FASTPATH = '1';
  const sampleIterations = 60;

  for (let warmupIdx = 0; warmupIdx < 3; warmupIdx++) {
    const ast = adapterInstance.parse(fileContent, 'f0.ts');
    runStreaming(adapterInstance, ast.root, buildStreamingEntries(makeContext));
    const projector = tryCreateProjector(adapterInstance, fileContent, 'f0.ts', analyzerNames, 0);
    runStreamingProjected(projector, buildStreamingEntries(makeContext));
  }

  const startTimeMaterialized = performance.now();
  for (let runIdx = 0; runIdx < sampleIterations; runIdx++) {
    const ast = adapterInstance.parse(fileContent, 'f0.ts');
    runStreaming(adapterInstance, ast.root, buildStreamingEntries(makeContext));
  }
  const meanMaterializedMs = (performance.now() - startTimeMaterialized) / sampleIterations;

  const startTimeProjected = performance.now();
  for (let runIdx = 0; runIdx < sampleIterations; runIdx++) {
    const projector = tryCreateProjector(adapterInstance, fileContent, 'f0.ts', analyzerNames, 0);
    runStreamingProjected(projector, buildStreamingEntries(makeContext));
  }
  const meanProjectedMs = (performance.now() - startTimeProjected) / sampleIterations;
  const deltaPercent = ((meanProjectedMs - meanMaterializedMs) / meanMaterializedMs) * 100;

  console.log(
    `  ${corpusLabel.padEnd(8)} ${String(fileContent.length).padStart(6)}B  mat=${meanMaterializedMs.toFixed(3)}ms  proj=${meanProjectedMs.toFixed(3)}ms  Δ=${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%`,
  );
  return { mat: meanMaterializedMs, proj: meanProjectedMs, delta: deltaPercent };
}

async function benchCorpus(targetDir, corpusLabel, fileCount) {
  const collectedTimes = { 0: [], 1: [] };
  for (let iterIdx = 0; iterIdx < ITERATION_COUNT; iterIdx++) {
    for (const mode of [iterIdx % 2 === 0 ? '0' : '1', iterIdx % 2 === 0 ? '1' : '0']) {
      const { wall, summary } = runScan(targetDir, mode);
      collectedTimes[mode].push(wall);
      process.stderr.write(
        `  [${corpusLabel}] round ${iterIdx + 1} AR_FASTPATH=${mode}: ${wall.toFixed(1)}ms (${summary})\n`,
      );
    }
  }
  const medianFastpathOff = computeMedianTime(collectedTimes['0']);
  const medianFastpathOn = computeMedianTime(collectedTimes['1']);
  const deltaPercent = ((medianFastpathOn - medianFastpathOff) / medianFastpathOff) * 100;
  console.log(
    `\n[bench-fastpath] ${corpusLabel} (${fileCount} files, w4, ${ITERATION_COUNT} interleaved runs):`,
  );
  console.log(
    `  AR_FASTPATH=0 median: ${medianFastpathOff.toFixed(1)}ms   AR_FASTPATH=1 median: ${medianFastpathOn.toFixed(1)}ms   Δ=${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%`,
  );
  return { m0: medianFastpathOff, m1: medianFastpathOn, delta: deltaPercent };
}

async function main() {
  if (CHECK_MODE) {
    const isSuccess = await checkFixtures();
    process.exit(isSuccess ? 0 : 1);
  }

  const lightAvgBytes =
    CORPUS_SELECTION !== 'heavy' ? buildCorpus(LIGHT_CORPUS_DIR, generateLightFileContent, 1001) : null;
  const heavyAvgBytes =
    CORPUS_SELECTION !== 'light' ? buildCorpus(HEAVY_CORPUS_DIR, generateHeavyFileContent, 1001) : null;
  if (lightAvgBytes) {
    console.log(`[bench-fastpath] corpus light (${PARSER_NAME}): 1001 files, avg ~${lightAvgBytes}B`);
  }
  if (heavyAvgBytes) {
    console.log(`[bench-fastpath] corpus heavy (${PARSER_NAME}): 1001 files, avg ~${heavyAvgBytes}B`);
  }

  console.log(`\n[bench-fastpath] per-file (in-process, Mode B, ${PARSER_NAME}):`);
  if (lightAvgBytes) perFileTable(LIGHT_CORPUS_DIR, 'light');
  if (heavyAvgBytes) perFileTable(HEAVY_CORPUS_DIR, 'heavy');

  const benchmarkSummary = {};
  if (CORPUS_SELECTION !== 'heavy') {
    benchmarkSummary.light = await benchCorpus(LIGHT_CORPUS_DIR, 'light', 1001);
  }
  if (CORPUS_SELECTION !== 'light') {
    benchmarkSummary.heavy = await benchCorpus(HEAVY_CORPUS_DIR, 'heavy', 1001);
  }
  console.log('\n[bench-fastpath] DONE');
}

main().catch((errorInstance) => {
  console.error(errorInstance);
  process.exit(1);
});
