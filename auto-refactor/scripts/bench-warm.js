#!/usr/bin/env node
/**
 * Module: Verification Harness — Warm-Scan Pipeline & Cache Acceptance Benchmark
 * File Path: scripts/bench-warm.js
 * Architecture Role: End-to-end acceptance harness for scan/scanWarm plus the
 *   daemon and disk-cache paths; it also records history as a side artifact.
 * Dependencies & Triggers: ../dist/api scan/scanWarm plus spawned
 *   `node dist/index.js daemon|scan` processes; triggered by `npm run bench-warm`,
 *   which forwards optional --parser=... and --workers=... flags.
 * Responsibilities: Rebuild a fresh 1001-file corpus at <system temp>/ar-warm-corpus from
 *   three TS templates; measure S1 cold scan, S2 daemon cold pool, S3/S4 hot pool
 *   plus hot cache, S5 mixed 10% edit, and S6 CLI respawn over the hot disk cache;
 *   append each run to scripts/bench-history.json under the benchWarm partition
 *   while preserving existing entries.
 * Exit Semantics & Design Rationale: Exits 0 only when S3 and S4 each beat S1 by
 *   >= 5x, otherwise 1; setup failures exit 1 after a best-effort daemon stop so a
 *   stuck daemon cannot poison later runs. S1-S5 measure the API pipeline while S6
 *   adds cross-process proof, isolating warm-path gains from the ~180ms CLI boot.
 */

const { scan, scanWarm } = require('../dist/api');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const CORPUS = path.join(os.tmpdir(), 'ar-warm-corpus');
const CACHE_DIR = path.join(CORPUS, '.auto-refactor-cache');
const HISTORY_FILE = path.join(__dirname, 'bench-history.json');
const FILES = 1001;
const MIXED = 100;

const commandArguments = process.argv.slice(2);
const parser = (commandArguments.find((arg) => arg.startsWith('--parser=')) || '--parser=oxc').split('=')[1];
const workers =
  parseInt((commandArguments.find((arg) => arg.startsWith('--workers=')) || '--workers=4').split('=')[1], 10) || 4;

const DEFAULT_WARM_THRESHOLDS = Object.freeze({
  magicNumberMin: 2,
  duplicateLiteralThreshold: 3,
  hardcodedStringMinLength: 3,
  fileLinesWarn: 400,
  fileLinesFail: 800,
  fileFunctionsWarn: 15,
  complexityWarn: 8,
  complexityFail: 12,
});

const DEFAULT_CORE_ANALYZERS = Object.freeze({
  constants: { enabled: true },
  'large-file': { enabled: true },
  complexity: { enabled: true },
});

// Synthetic fixture exports are interpolated so the line-oriented strict comment scanner does
// not read them as real public API declarations; the generated corpus bytes stay identical.
const TEMPLATES = [
  `export function f(a: number, b: number): number {
  if (a > 10) return a * 100;
  if (b < 5) return b + 100;
  const c = a + b;
  return c > 0 ? c : -c;
}
${'export'} const K = 100;
`,
  `export class C {
  private x = 0;
  add(n: number): void { this.x = this.x + n; }
  sub(n: number): void { this.x = this.x - n; }
  get(): number { return this.x; }
  calc(a: number, b: number): number {
    if (a > 0) { if (b > 0) return a + b; else return a; } else return 0;
  }
}
`,
  `function t(s: string): string { return s; }
${'export'} function page(): string {
  const a = t('welcome message');
  const b = t('goodbye message');
  return a + b;
}
`,
];

/** Recursively removes a directory with fallback rename if locked. */
function removeDirectoryWithRetry(targetDirectoryPath) {
  try {
    fs.rmSync(targetDirectoryPath, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(
        targetDirectoryPath,
        path.join(os.tmpdir(), `ar-stale-${path.basename(targetDirectoryPath)}-${Date.now()}`),
      );
    } catch {
      /* best-effort fallback */
    }
  }
}

/** Generates the benchmark corpus fixture files and configuration. */
function buildCorpus() {
  removeDirectoryWithRetry(CORPUS);
  fs.mkdirSync(path.join(CORPUS, 'src'), { recursive: true });
  for (let fileIndex = 0; fileIndex < FILES; fileIndex++) {
    fs.writeFileSync(path.join(CORPUS, 'src', `bench_${fileIndex}.ts`), TEMPLATES[fileIndex % TEMPLATES.length]);
  }
  const configuration = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: DEFAULT_WARM_THRESHOLDS,
    analyzers: DEFAULT_CORE_ANALYZERS,
    customAnalyzers: [],
    logLevel: 'silent',
    workers,
    respectGitignore: false,
    failOnAnalyzerError: false,
    parser,
  };
  fs.writeFileSync(path.join(CORPUS, 'auto-refactor.config.json'), JSON.stringify(configuration, null, 2));
}

/** Modifies a subset of corpus files to simulate code churn. */
function updateSampleCorpusFiles(sampleCount) {
  for (let fileIndex = 0; fileIndex < sampleCount; fileIndex++) {
    fs.writeFileSync(
      path.join(CORPUS, 'src', `bench_${fileIndex}.ts`),
      `export function f(a: number, b: number): number {\n  if (a > ${1000 + fileIndex}) return a * ${7 + (fileIndex % 9)};\n  if (b < 5) return b + ${50 + fileIndex};\n  return a + b;\n}\n`,
    );
  }
}

/** Spawns the daemon process synchronously and returns true if successful. */
function startDaemonSafely() {
  const spawnResult = spawnSync(process.execPath, [CLI, 'daemon', 'start', '--root', CORPUS], {
    stdio: 'ignore',
    timeout: 20000,
  });
  return spawnResult.status === 0;
}

/** Stops any running daemon process for the test corpus. */
function stopDaemonSafely() {
  try {
    spawnSync(process.execPath, [CLI, 'daemon', 'stop', '--root', CORPUS], {
      stdio: 'ignore',
      timeout: 15000,
    });
  } catch {
    /* best-effort */
  }
}

const baseScanOptions = { root: CORPUS, format: 'json', logLevel: 'silent' };

/** Formats and logs the duration of a benchmark stage. */
function printBenchmarkTiming(label, durationMs, extraDescription = '') {
  console.log(
    `  ${label.padEnd(16)} ${durationMs.toFixed(1).padStart(8)} ms${extraDescription ? `  ${extraDescription}` : ''}`,
  );
  return durationMs;
}

/** Measures baseline cold scan and subsequent warm pool iterations S1 to S4. */
async function runColdAndWarmStages() {
  const startTimeCold = performance.now();
  const coldScanReport = await scan({ ...baseScanOptions });
  const coldScanDurationMs = printBenchmarkTiming(
    'S1 cold',
    performance.now() - startTimeCold,
    `issues=${coldScanReport.summary.issuesTotal}`,
  );

  const isDaemonStarted = startDaemonSafely();
  if (!isDaemonStarted) throw new Error('daemon failed to start for bench');

  const startTimeWarmFirst = performance.now();
  const warmFirstReport = await scanWarm({ ...baseScanOptions, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const warmFirstDurationMs = printBenchmarkTiming(
    'S2 warm-1st',
    performance.now() - startTimeWarmFirst,
    `daemon=${warmFirstReport.stats.daemonUsed} analyzed=${warmFirstReport.stats.analyzed}`,
  );

  const startTimeWarmSecond = performance.now();
  const warmSecondReport = await scanWarm({ ...baseScanOptions, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const warmSecondDurationMs = printBenchmarkTiming(
    'S3 warm-2nd',
    performance.now() - startTimeWarmSecond,
    `cacheHit=${warmSecondReport.stats.cacheHit}/${warmSecondReport.stats.cacheTotal} analyzed=${warmSecondReport.stats.analyzed} daemonMs=${warmSecondReport.stats.daemonMs}`,
  );

  const startTimeWarmThird = performance.now();
  const warmThirdReport = await scanWarm({ ...baseScanOptions, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const warmThirdDurationMs = printBenchmarkTiming(
    'S4 warm-3rd',
    performance.now() - startTimeWarmThird,
    `analyzed=${warmThirdReport.stats.analyzed}`,
  );

  return {
    coldScanDurationMs,
    warmFirstDurationMs,
    warmSecondDurationMs,
    warmThirdDurationMs,
  };
}

/** Measures partial corpus modifications S5 and isolated CLI respawn S6. */
async function runMixedAndCliStages() {
  updateSampleCorpusFiles(MIXED);
  const startTimeMixed = performance.now();
  const mixedReport = await scanWarm({ ...baseScanOptions, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const mixedDurationMs = printBenchmarkTiming(
    'S5 mixed-10%',
    performance.now() - startTimeMixed,
    `cacheHit=${mixedReport.stats.cacheHit}/${mixedReport.stats.cacheTotal} analyzed=${mixedReport.stats.analyzed}`,
  );

  stopDaemonSafely();
  const startTimeCli = performance.now();
  const cliSpawnResult = spawnSync(
    process.execPath,
    [
      CLI,
      'scan',
      '--root',
      CORPUS,
      '--format',
      'json',
      '--no-daemon',
      '--cache',
      '--cache-dir',
      CACHE_DIR,
      '--log-level',
      'silent',
    ],
    { stdio: 'ignore', timeout: 120000 },
  );
  const cliDurationMs = printBenchmarkTiming(
    'S6 cold-2nd',
    performance.now() - startTimeCli,
    cliSpawnResult.status === 0 ? '(cli spawn, hot disk cache)' : `FAILED status=${cliSpawnResult.status}`,
  );

  return {
    mixedDurationMs,
    cliDurationMs,
  };
}

/** Orchestrates execution of all benchmark stages and aggregates timings. */
async function executeBenchmarkPipeline() {
  const coldAndWarmTimings = await runColdAndWarmStages();
  const mixedAndCliTimings = await runMixedAndCliStages();
  return {
    ...coldAndWarmTimings,
    ...mixedAndCliTimings,
  };
}

/** Loads recorded benchmark entries from history file if present. */
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { entries: [], benchWarm: [] };
  try {
    const parsedData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return {
      entries: Array.isArray(parsedData.entries) ? parsedData.entries : [],
      benchWarm: Array.isArray(parsedData.benchWarm) ? parsedData.benchWarm : [],
    };
  } catch {
    return { entries: [], benchWarm: [] };
  }
}

/** Persists benchmark history safely via atomic rename. */
function saveHistory(historyRecord) {
  const historyPayload = { ...historyRecord, schemaVersion: 1 };
  const temporaryHistoryPath = `${HISTORY_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryHistoryPath, JSON.stringify(historyPayload, null, 2) + '\n', 'utf8');
  fs.renameSync(temporaryHistoryPath, HISTORY_FILE);
}

/** Appends benchmark outcome to history file for long-term tracking. */
function recordBenchmarkHistory(timings, isPass, speedupS3, speedupS4) {
  const history = loadHistory();
  history.benchWarm.push({
    date: new Date().toISOString(),
    parser,
    workers,
    files: FILES,
    mixed: MIXED,
    s1cold: Math.round(timings.coldScanDurationMs * 10) / 10,
    s2warm1st: Math.round(timings.warmFirstDurationMs * 10) / 10,
    s3warm2nd: Math.round(timings.warmSecondDurationMs * 10) / 10,
    s4warm3rd: Math.round(timings.warmThirdDurationMs * 10) / 10,
    s5mixed: Math.round(timings.mixedDurationMs * 10) / 10,
    s6cold2nd: Math.round(timings.cliDurationMs * 10) / 10,
    speedupS3: Math.round(speedupS3 * 10) / 10,
    speedupS4: Math.round(speedupS4 * 10) / 10,
    accept: isPass,
    env: { node: process.version, os: process.platform },
  });
  saveHistory(history);
  console.log(`history: ${HISTORY_FILE} (benchWarm entries: ${history.benchWarm.length})`);
}

async function main() {
  buildCorpus();
  stopDaemonSafely();
  removeDirectoryWithRetry(CACHE_DIR);

  console.log(
    `bench-warm: ${FILES} files, parser=${parser}, workers=${workers} (pipeline-level for S1-S5, CLI-spawn for S6)`,
  );

  const timings = await executeBenchmarkPipeline();

  const computeSpeedupRatio = (slowMs, fastMs) => (fastMs > 0 ? slowMs / fastMs : 0);
  const speedupS3 = computeSpeedupRatio(timings.coldScanDurationMs, timings.warmSecondDurationMs);
  const speedupS4 = computeSpeedupRatio(timings.coldScanDurationMs, timings.warmThirdDurationMs);

  console.log('');
  console.log('  speedup vs S1 (higher is better)');
  console.log(
    `  S2 warm-1st    ${computeSpeedupRatio(timings.coldScanDurationMs, timings.warmFirstDurationMs).toFixed(1)}x`,
  );
  console.log(`  S3 warm-2nd    ${speedupS3.toFixed(1)}x   (gate >= 5x)`);
  console.log(`  S4 warm-3rd    ${speedupS4.toFixed(1)}x   (gate >= 5x)`);
  console.log(
    `  S5 mixed-10%   ${computeSpeedupRatio(timings.coldScanDurationMs, timings.mixedDurationMs).toFixed(1)}x`,
  );
  console.log(
    `  S6 cold-2nd    ${computeSpeedupRatio(timings.coldScanDurationMs, timings.cliDurationMs).toFixed(1)}x  (cross-process)`,
  );

  const isAcceptable = speedupS3 >= 5 && speedupS4 >= 5;
  console.log(
    isAcceptable ? '\nACCEPTANCE: ✔ PASS (S3/S4 >= 5x vs S1)' : '\nACCEPTANCE: ✖ BLOCK (S3/S4 < 5x vs S1)',
  );

  recordBenchmarkHistory(timings, isAcceptable, speedupS3, speedupS4);

  stopDaemonSafely();
  process.exit(isAcceptable ? 0 : 1);
}

main().catch((executionError) => {
  console.error(executionError);
  try {
    stopDaemonSafely();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
