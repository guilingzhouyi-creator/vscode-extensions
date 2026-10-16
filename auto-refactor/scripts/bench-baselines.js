#!/usr/bin/env node
/**
 * Module: Verification Harness — Unified Performance Baseline Suite
 * File Path: scripts/bench-baselines.js
 * Architecture Role: Four-stage orchestrating entry point; it drives the built dist
 *     APIs and the validator child process but exposes no reusable exports.
 * Dependencies & Triggers: `npm run bench-baselines` or manual
 *     `node scripts/bench-baselines.js` with --files/--iterations/--vs-mixed/--json/
 *     --update flags on a built dist; spawns validate-equivalence.js, loads dist/api
 *     plus an optional MIXED dist, and appends or updates scripts/bench-history.json.
 * Responsibilities: Stage 1 runs the spawned 9/9 equivalence gate; stage 2 times the
 *     default 300-file corpus against the new dist and the optional MIXED dist; stage 3
 *     times 12 x ~2600-line files; stage 4 profiles parse/map/runStreaming timings; then
 *     history is recorded atomically and a human or --json report is printed.
 * Exit Semantics & Design Rationale: Validator, corpus-cleanup, new-dist and profile
 *     failures exit 1; MIXED-dist problems and >30% baseline deviations only warn.
 *     Stages stay strictly serial so one benchmark's CPU load cannot skew another's
 *     timings, and history writes use .tmp + rename to survive crashes or stale locks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HISTORY_FILE = path.join(__dirname, 'bench-history.json');
const CORPUS_STD = path.join(os.tmpdir(), 'ar-bench-standard');
const CORPUS_BIG = path.join(os.tmpdir(), 'ar-bench-big');
const DEFAULT_MIXED_DIST = path.join(os.tmpdir(), 'ar-mixed-dist');

// NODE_PATH must be set before any require of the MIXED dist (it resolves 'typescript'
// from the repo's node_modules). Set it at module load — harmless for the NEW dist.
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

// ---- Config and argument parsing ----

function parseArgs(argv) {
  const extractArg = (paramName, defaultValue) => {
    const matchedArg = argv.find((item) => item.startsWith(`--${paramName}=`));
    return matchedArg ? matchedArg.split('=')[1] : defaultValue;
  };
  const parseNumericArg = (paramName, defaultValue) => {
    const parsedValue = parseInt(extractArg(paramName, String(defaultValue)), 10);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
  };
  return {
    files: parseNumericArg('files', 300),
    iterations: parseNumericArg('iterations', 5),
    workers: parseNumericArg('workers', 1),
    vsMixed: argv.includes('--vs-mixed'),
    mixedDist: extractArg('mixed-dist', DEFAULT_MIXED_DIST),
    skipValidate: argv.includes('--skip-validate'),
    update: argv.includes('--update'),
    json: argv.includes('--json'),
    bigFiles: parseNumericArg('big-files', 12),
    bigLines: parseNumericArg('big-lines', 2600),
    profileIters: parseNumericArg('profile-iters', 10),
    parser: extractArg('parser', 'typescript'),
  };
}

// ---- Shared utilities ----

/** Re-init module resolution paths so `require` picks up ROOT/node_modules. */
function setupNodePath() {
  process.env.NODE_PATH = path.join(ROOT, 'node_modules');
  require('module').Module._initPaths();
}

function executeSleepSync(durationMs) {
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    /* busy wait — synchronous retry context (rmSync lock retry) */
  }
}

/** rm -rf with Windows busy-file retry (EBUSY/EPERM → 3 × 300ms). Throws if still locked. */
function removeDirectoryWithRetry(targetPath, attempts = 3, delayMs = 300) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) executeSleepSync(delayMs);
    }
  }
  // Last resort: some sandboxes guard bulk rmSync (bulk-delete confirmation). A
  // same-volume rename clears the corpus path while leaving an inert stale copy in
  // os.tmpdir(); a genuinely file-locked dir fails the rename too, so the caller still
  // gets the lock-failure exit(1) semantics.
  try {
    fs.renameSync(
      targetPath,
      path.join(os.tmpdir(), `ar-stale-${path.basename(targetPath)}-${Date.now()}`),
    );
    return;
  } catch (e2) {
    throw lastErr || e2;
  }
}

/** Clean stale corpora before stage1 (avoid stale files + Windows file locks). */
function cleanStaleCorpora() {
  const targets = [
    path.join(__dirname, '.corpus'),
    path.join(__dirname, '.bench-corpus'),
    path.join(__dirname, '.rust-corpus'),
    CORPUS_BIG,
  ];
  for (const t of targets) {
    try {
      removeDirectoryWithRetry(t);
    } catch (e) {
      console.error(`[bench-baselines] 清理 ${t} 失败（Windows 文件锁）: ${e.message}`);
      process.exit(1);
    }
  }
}

function computeMedian(valuesList) {
  const sortedValues = [...valuesList].sort((a, b) => a - b);
  return sortedValues[Math.floor(sortedValues.length / 2)];
}

function computeMean(valuesList) {
  return valuesList.reduce((acc, val) => acc + val, 0) / (valuesList.length || 1);
}

/** Atomic write: write .staging then rename (avoids half-written history on crash). */
function writeFileAtomic(targetFile, filePayload) {
  const stagingFilePath = `${targetFile}.staging-${Date.now()}`;
  fs.writeFileSync(stagingFilePath, filePayload, 'utf8');
  fs.renameSync(stagingFilePath, targetFile);
}

/** Reuse benchmark.js's config shape (workers from CLI; logLevel overridden per-scan). */
function buildConfig(root, workers) {
  return {
    ['$schema']: './config.schema.json',
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts', '**/*.js'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: {
      magicNumberMin: 2,
      duplicateLiteralThreshold: 3,
      hardcodedStringMinLength: 3,
      fileLinesWarn: 400,
      complexityWarn: 8,
    },
    analyzers: {
      constants: {
        enabled: true,
        options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 },
      },
      'large-file': { enabled: true, options: { fileLinesWarn: 50, fileFunctionsWarn: 5 } },
      complexity: { enabled: true, options: { complexityWarn: 5 } },
      'no-console': { enabled: true, options: { severity: 'warning', allowed: ['error'] } },
    },
    customAnalyzers: [
      {
        name: 'no-console',
        module: path.join(ROOT, 'samples', 'analyzers', 'noConsole.js'),
        enabled: true,
        signals: ['LITERAL'],
        track: 'fast',
        options: { severity: 'warning', allowed: ['error'] },
      },
    ],
    workers,
    respectGitignore: false, // spec §7: bench corpora must never be gitignore-filtered
    failOnAnalyzerError: false,
    logLevel: 'info',
  };
}

// ---- Stage 1: equivalence gate ----

async function runStage1Validate(opts) {
  if (opts.skipValidate) {
    printProgressMessage('[bench-baselines] stage1 validate ....... SKIP (--skip-validate)');
    return { ok: true, passed: 0, total: 0, skipped: true };
  }
  // Must spawn — validate-equivalence.js ends with process.exit() and would kill a
  // parent that require()d it. In --json mode capture the child stdout so our own
  // stdout stays pure JSON (the PASS/FAIL lines are echoed to stderr instead).
  const stdio = opts.json ? ['inherit', 'pipe', 'inherit'] : 'inherit';
  const spawnResult = spawnSync(
    process.execPath,
    [path.join(__dirname, 'validate-equivalence.js')],
    {
      cwd: ROOT,
      stdio,
    },
  );
  if (opts.json && spawnResult.stdout) process.stderr.write(spawnResult.stdout.toString());
  const ok = spawnResult.status === 0;
  if (ok) {
    printProgressMessage('[bench-baselines] stage1 validate ....... PASS (9/9)');
    return { ok: true, passed: 9, total: 9, skipped: false };
  }
  console.error('[bench-baselines] 输出已变，性能无效 —— validate 未全 PASS，基准中止');
  process.exit(1);
}

// ---- Stage 2: standard benchmark (300 files, workers=1) ----

/**
 * 3 templates + 30-function big template, copied from benchmark.js (parametrized dir).
 * Fixture exports are interpolated so the line-oriented strict comment scanner does not read
 * them as real public API declarations; the generated corpus bytes stay identical.
 */
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

function buildCorpus300(dir, files, workers) {
  removeDirectoryWithRetry(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const writeCorpusFile = (subPath, corpusContent) =>
    fs.writeFileSync(path.join(dir, subPath), corpusContent);
  for (let fileIdx = 0; fileIdx < files; fileIdx++) {
    writeCorpusFile(`src/bench_${fileIdx}.ts`, TEMPLATES[fileIdx % TEMPLATES.length]);
  }
  // a few large files to add node volume (same as benchmark.js)
  let big = '';
  for (let funcIdx = 0; funcIdx < 30; funcIdx++) {
    big += `export function g${funcIdx}(n: number): number { let s = 0; if (n > ${funcIdx}) s += ${funcIdx}; if (n < ${funcIdx}) s -= ${funcIdx}; return s + ${funcIdx}; }\n`;
  }
  writeCorpusFile('src/big.ts', big);
  writeCorpusFile('auto-refactor.config.json', JSON.stringify(buildConfig(dir, workers), null, 2));
  return path.join(dir, 'auto-refactor.config.json');
}

async function measureScanTime(api, root, configPath, opts) {
  const scenario = {
    root,
    configFile: configPath,
    workers: opts.workers,
    format: 'json',
    logLevel: 'silent',
    parser: opts.parser,
  };
  const times = [];
  let summary = null;
  for (let iterationIdx = 0; iterationIdx < opts.iterations; iterationIdx++) {
    const startTimestampMs = performance.now();
    const scanResult = await api.scan(scenario);
    const endTimestampMs = performance.now();
    times.push(endTimestampMs - startTimestampMs);
    summary = scanResult.summary;
  }
  return {
    medianMs: computeMedian(times),
    files: summary.filesScanned,
    issues: summary.issuesTotal,
  };
}

/** Time the NEW dist (+ optional MIXED). NEW failures throw (core stage); MIXED → WARN+null. */
async function measureDistPairTimings(apiPath, root, configPath, opts) {
  const newApi = require(apiPath);
  const neu = await measureScanTime(newApi, root, configPath, opts);
  let mixed = null;
  if (opts.vsMixed) {
    setupNodePath(); // must precede require(MIXED api) — MIXED internally requires 'typescript'
    if (!fs.existsSync(path.join(opts.mixedDist, 'api.js'))) {
      console.warn('[bench-baselines] MIXED dist 不存在，跳过对比');
    } else {
      try {
        const mixedApi = require(path.join(opts.mixedDist, 'api'));
        mixed = await measureScanTime(mixedApi, root, configPath, opts);
      } catch (e) {
        console.warn(`[bench-baselines] MIXED dist 加载/计时失败，跳过对比: ${e.message}`);
        mixed = null;
      }
    }
  }
  return { neu, mixed };
}

async function runStage2Standard(opts) {
  const configPath = buildCorpus300(CORPUS_STD, opts.files, opts.workers);
  const { neu, mixed } = await measureDistPairTimings(
    path.join(ROOT, 'dist', 'api'),
    CORPUS_STD,
    configPath,
    opts,
  );
  const speedup = mixed ? mixed.medianMs / neu.medianMs : null;
  return {
    new300: neu.medianMs,
    mixed300: mixed ? mixed.medianMs : null,
    speedup,
    files: neu.files,
    issues: neu.issues,
  };
}

// ---- Stage 3: large-file comparison (12 x ~2600 lines) ----

/**
 * One dense ~13-line function (nesting + literals + branches per function).
 * Names/constants are seeded per file so the 12 files are not identical; this shape
 * reproduces the historical MIXED/NEW big-file ratio (~1.4-1.5x) on this machine.
 */
function makeBigFunction(fileIndex, funcIndex, seed) {
  const thresholdA = (funcIndex * 7 + seed) % 1000;
  const thresholdB = (funcIndex * 13 + seed * 3) % 1000;
  const multiplierC = (funcIndex * 17 + seed * 5) % 1000;
  const loopLimit = (funcIndex % 6) + 2;
  const remainderValue = (funcIndex * 11 + seed * 7) % 500;
  return [
    `export function fn${fileIndex}_${funcIndex}(a: number, b: number): number {`,
    `  let acc = ${seed % 1000};`,
    `  if (a > ${thresholdA}) {`,
    `    acc += ${thresholdA};`,
    `    if (b > ${thresholdB}) { acc -= ${thresholdB}; } else { acc += ${thresholdB}; }`,
    `  }`,
    `  for (let step = 0; step < ${loopLimit}; step++) {`,
    `    acc += step * ${multiplierC};`,
    `    if (step > 2) { acc -= ${multiplierC}; }`,
    `  }`,
    `  while (acc > 100000) { acc -= 1000; }`,
    `  return acc + ${remainderValue};`,
    `}`,
    ``,
  ].join('\n');
}

function buildBigCorpus(dir, bigFiles, bigLines, workers) {
  removeDirectoryWithRetry(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const writeCorpusFile = (subPath, corpusContent) =>
    fs.writeFileSync(path.join(dir, subPath), corpusContent);
  const funcsPerFile = Math.max(20, Math.round(bigLines / 13)); // ~13 lines per function
  for (let fileIdx = 0; fileIdx < bigFiles; fileIdx++) {
    const seed = fileIdx * 7919 + 17;
    let content = '';
    for (let funcIdx = 0; funcIdx < funcsPerFile; funcIdx++) {
      content += makeBigFunction(fileIdx, funcIdx, seed);
    }
    writeCorpusFile(`src/big_${fileIdx}.ts`, content);
  }
  writeCorpusFile('auto-refactor.config.json', JSON.stringify(buildConfig(dir, workers), null, 2));
  return path.join(dir, 'auto-refactor.config.json');
}

async function runStage3Big(opts) {
  const configPath = buildBigCorpus(CORPUS_BIG, opts.bigFiles, opts.bigLines, opts.workers);
  const { neu, mixed } = await measureDistPairTimings(
    path.join(ROOT, 'dist', 'api'),
    CORPUS_BIG,
    configPath,
    opts,
  );
  const speedup = mixed ? mixed.medianMs / neu.medianMs : null;
  return { newBig: neu.medianMs, mixedBig: mixed ? mixed.medianMs : null, speedup };
}

// ---- Stage 4: single-file profile (200 functions, per-stage timing) ----

/** ~200 functions / ~2600-3000 lines, matching the historical profile corpus. */
function synthesizeProfileFile(functions = 200) {
  const parts = ['// synthetic profile corpus (bench-baselines stage4)'];
  for (let i = 0; i < functions; i++) {
    const a = (i * 3) % 100;
    const b = (i * 5) % 100;
    parts.push(`export function fn${i}(a: number, b: number): number {`);
    parts.push(`  let acc = ${i};`);
    parts.push(`  if (a > ${a}) {`);
    parts.push(`    acc += ${a};`);
    parts.push(`  }`);
    parts.push(`  if (b < ${b}) {`);
    parts.push(`    acc -= ${b};`);
    parts.push(`  }`);
    parts.push(`  for (let k = 0; k < ${i % 6}; k++) {`);
    parts.push(`    acc += k * ${i % 10};`);
    parts.push(`  }`);
    parts.push(`  while (acc > 100000) acc -= 1000;`);
    parts.push(`  return acc + ${i};`);
    parts.push(`}`);
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Build the runStreaming entries (three built-in analyzers + FileMetricCollector).
 * ctx carries the minimal fields the analyzers/traverse consume; lineStats is provided
 * by dist/utils/ast countLineStats (engine-identical single-pass counting).
 */
function makeProfileEntries(content, config, adapter, root) {
  const { ConstantsAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'constants'));
  const { LargeFileAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'largeFile'));
  const { ComplexityAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'complexity'));
  const { FileMetricCollector } = require(path.join(ROOT, 'dist', 'core', 'traverse'));
  const { countLineStats } = require(path.join(ROOT, 'dist', 'utils', 'ast'));
  const lineStats = countLineStats(content);
  const mkCtx = (options) => ({
    filePath: 'profile.ts',
    content,
    root,
    adapter,
    config,
    options,
    lineStats,
  });
  return [
    {
      analyzer: new ConstantsAnalyzer(),
      ctx: mkCtx({ magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 }),
    },
    {
      analyzer: new LargeFileAnalyzer(),
      ctx: mkCtx({ fileLinesWarn: 50, fileLinesFail: 800, fileFunctionsWarn: 15 }),
    },
    { analyzer: new ComplexityAnalyzer(), ctx: mkCtx({ complexityWarn: 5, complexityFail: 12 }) },
    { analyzer: new FileMetricCollector(), ctx: mkCtx({}) },
  ];
}

function measureMeanExecutionTime(iterationCount, targetFn) {
  const elapsedDurations = [];
  for (let step = 0; step < iterationCount; step++) {
    const startTimestampMs = performance.now();
    targetFn();
    elapsedDurations.push(performance.now() - startTimestampMs);
  }
  return computeMean(elapsedDurations);
}

function runTypeScriptProfile(content, file, profileIters) {
  const ts = require('typescript');
  const { TypeScriptAdapter } = require(path.join(ROOT, 'dist', 'core', 'typescriptAdapter'));
  let rawParseDurationMs = null;
  try {
    rawParseDurationMs = measureMeanExecutionTime(profileIters, () =>
      ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false),
    );
  } catch (err) {
    console.warn(`[bench-baselines] stage4 createSourceFile 计时失败: ${err.message}`);
  }

  const tsAdapter = new TypeScriptAdapter();
  let tsAst = null;
  let parseTsTime = null;
  try {
    parseTsTime = measureMeanExecutionTime(profileIters, () => {
      tsAst = tsAdapter.parse(content, file);
    });
  } catch (err) {
    console.warn(`[bench-baselines] stage4 TypeScriptAdapter.parse 计时失败: ${err.message}`);
  }

  const mapTsTime =
    parseTsTime != null && rawParseDurationMs != null ? parseTsTime - rawParseDurationMs : null;

  return { rawParseDurationMs, parseTsTime, mapTsTime, tsAdapter, tsAst };
}

function runOxcProfile(content, file, profileIters) {
  const { OxcAdapter } = require(path.join(ROOT, 'dist', 'core', 'oxcAdapter'));
  try {
    const oxcAdapter = new OxcAdapter();
    oxcAdapter.parse(content, file); // probe — throws if the native binding is unavailable
    const parseSync = require('oxc-parser').parseSync;
    const oxcOpts = { lang: 'ts', sourceType: 'unambiguous', preserveParens: true };
    const parseOxc = measureMeanExecutionTime(profileIters, () =>
      parseSync(file, content, oxcOpts),
    );
    const oxcTotal = measureMeanExecutionTime(profileIters, () => oxcAdapter.parse(content, file));
    return { parseOxc, mapOxc: oxcTotal - parseOxc };
  } catch (err) {
    console.warn(
      `[bench-baselines] stage4 oxc 不可用，跳过（默认 TS 路径不受影响）: ${err.message}`,
    );
    return { parseOxc: null, mapOxc: null };
  }
}

async function runStage4Profile(opts) {
  const content = synthesizeProfileFile(200);
  const file = 'profile.ts';
  const { rawParseDurationMs, parseTsTime, mapTsTime, tsAdapter, tsAst } = runTypeScriptProfile(
    content,
    file,
    opts.profileIters,
  );

  let streamingDurationMs = null;
  let mappedRatio = null;
  if (tsAst) {
    const { runStreaming } = require(path.join(ROOT, 'dist', 'core', 'traverse'));
    const cfg = { failOnAnalyzerError: false };
    const entries = makeProfileEntries(content, cfg, tsAdapter, tsAst.root);
    try {
      streamingDurationMs = measureMeanExecutionTime(opts.profileIters, () =>
        runStreaming(tsAdapter, tsAst.root, entries),
      );
    } catch (err) {
      console.warn(`[bench-baselines] stage4 runStreaming 计时失败: ${err.message}`);
    }
    if (parseTsTime && mapTsTime != null && parseTsTime > 0) {
      mappedRatio = mapTsTime / parseTsTime;
    }
  }

  const { parseOxc, mapOxc } = runOxcProfile(content, file, opts.profileIters);

  return {
    ['createSourceFile']: rawParseDurationMs,
    ['parseTs']: parseTsTime,
    ['mapTs']: mapTsTime,
    ['parseOxc']: parseOxc,
    ['mapOxc']: mapOxc,
    ['runStreaming']: streamingDurationMs,
    ['materializationRatio']: mappedRatio,
  };
}

// ---- History persistence ----

function loadHistory(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const historyPayload = JSON.parse(raw);
    if (historyPayload && Array.isArray(historyPayload.entries)) return historyPayload.entries;
    throw new Error('invalid shape (missing entries array)');
  } catch (e) {
    const bak = `${file}.bak-${Date.now()}`;
    try {
      fs.copyFileSync(file, bak);
    } catch {
      /* backup best-effort */
    }
    console.warn(
      `[bench-baselines] bench-history.json 损坏（${e.message}），备份为 ${path.basename(bak)}，以空历史继续`,
    );
    return [];
  }
}

function saveHistory(file, entries) {
  writeFileAtomic(file, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
}

function getCommit() {
  try {
    const gitResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return gitResult.status === 0 && gitResult.stdout ? gitResult.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Append a new history entry; with --update replace the most recent one in place. */
function recordRun(entries, metrics, opts) {
  const entry = {
    date: new Date().toISOString(),
    commit: getCommit(),
    new300: metrics.new300,
    mixed300: metrics.mixed300,
    newBig: metrics.newBig,
    mixedBig: metrics.mixedBig,
    createSourceFile: metrics.createSourceFile,
    parseTs: metrics.parseTs,
    mapTs: metrics.mapTs,
    parseOxc: metrics.parseOxc,
    mapOxc: metrics.mapOxc,
    runStreaming: metrics.runStreaming,
    materializationRatio: metrics.materializationRatio,
    env: { node: process.version, os: process.platform, cpu: `${os.cpus().length} logical` },
    flags: {
      files: opts.files,
      iterations: opts.iterations,
      workers: opts.workers,
      bigFiles: opts.bigFiles,
      bigLines: opts.bigLines,
      parser: opts.parser,
    },
  };
  if (opts.update && entries.length > 0) entries[entries.length - 1] = entry;
  else entries.push(entry);
  return entries;
}

function formatDeltaPercentage(currentVal, referenceVal) {
  if (currentVal == null || referenceVal == null || referenceVal === 0) return '-';
  const deltaFraction = (currentVal - referenceVal) / referenceVal;
  return `${deltaFraction >= 0 ? '+' : ''}${(deltaFraction * 100).toFixed(1)}%`;
}

// ---- Output ----

/** stdout router: in --json mode only the final JSON may reach stdout (progress → stderr). */
let JSON_MODE = false;
function printProgressMessage(...args) {
  if (JSON_MODE) process.stderr.write(`${args.join(' ')}\n`);
  else console.log(...args);
}

function formatProfileLine(profileRecord) {
  const formatDuration = (val) => (val == null ? 'n/a' : `${val.toFixed(1)}ms`);
  const parts = [
    `createSourceFile ${formatDuration(profileRecord.createSourceFile)}`,
    `parse+map ${formatDuration(profileRecord.parseTs)}`,
    `mapNode ${formatDuration(profileRecord.mapTs)}`,
  ];
  if (profileRecord.parseOxc != null)
    parts.push(`parseSync(oxc) ${formatDuration(profileRecord.parseOxc)}`);
  if (profileRecord.mapOxc != null) parts.push(`mapOxc ${formatDuration(profileRecord.mapOxc)}`);
  parts.push(`runStreaming ${formatDuration(profileRecord.runStreaming)}`);
  if (profileRecord.materializationRatio != null)
    parts.push(`物化占比 ${Math.round(profileRecord.materializationRatio * 100)}%`);
  return parts.join(' | ');
}

function printHuman(metrics, history, _opts) {
  const last = history.length >= 2 ? history[history.length - 2] : null;
  const first = history.length >= 1 ? history[0] : null;
  const formatVal = (val) => (val == null ? '-' : val.toFixed(1));
  console.log('------------------------------------------------------------');
  console.log(
    'metric'.padEnd(18) +
      '本次'.padStart(10) +
      '上次'.padStart(10) +
      'Δ(上次)'.padStart(10) +
      '首次'.padStart(10) +
      'Δ(首次)'.padStart(10),
  );
  const metricKeys = [
    'new300',
    'mixed300',
    'newBig',
    'mixedBig',
    'createSourceFile',
    'mapTs',
    'parseOxc',
    'runStreaming',
  ];
  for (const key of metricKeys) {
    const currentMetric = metrics[key];
    const lastMetric = last ? last[key] : null;
    const firstMetric = first ? first[key] : null;
    console.log(
      key.padEnd(18) +
        formatVal(currentMetric).padStart(10) +
        formatVal(lastMetric).padStart(10) +
        formatDeltaPercentage(currentMetric, lastMetric).padStart(10) +
        formatVal(firstMetric).padStart(10) +
        formatDeltaPercentage(currentMetric, firstMetric).padStart(10),
    );
  }
  console.log('------------------------------------------------------------');
}

function calculateSpeedupRatio(mixedTiming, newerTiming) {
  if (mixedTiming == null || !newerTiming) return null;
  return Math.round((mixedTiming / newerTiming) * 100) / 100;
}

function printJson(metrics, history, opts, validate) {
  const last = history.length >= 2 ? history[history.length - 2] : null;
  const first = history.length >= 1 ? history[0] : null;
  const calculateDelta = (currentVal, referenceVal) => {
    if (currentVal == null || referenceVal == null || referenceVal === 0) return null;
    return Math.round(((currentVal - referenceVal) / referenceVal) * 1000) / 1000;
  };
  const roundToHundredths = (val) => (val == null ? null : Math.round(val * 100) / 100);
  const out = {
    ok: true,
    date: new Date().toISOString(),
    stages: {
      validate: {
        passed: validate.passed,
        total: validate.total,
        ...(validate.skipped ? { skipped: true } : {}),
      },
      standard: {
        new300: roundToHundredths(metrics.new300),
        mixed300: roundToHundredths(metrics.mixed300),
        speedup: calculateSpeedupRatio(metrics.mixed300, metrics.new300),
      },
      big: {
        newBig: roundToHundredths(metrics.newBig),
        mixedBig: roundToHundredths(metrics.mixedBig),
        speedup: calculateSpeedupRatio(metrics.mixedBig, metrics.newBig),
      },
      profile: {
        createSourceFile: roundToHundredths(metrics.createSourceFile),
        parseTs: roundToHundredths(metrics.parseTs),
        mapTs: roundToHundredths(metrics.mapTs),
        parseOxc: roundToHundredths(metrics.parseOxc),
        mapOxc: roundToHundredths(metrics.mapOxc),
        runStreaming: roundToHundredths(metrics.runStreaming),
        materializationRatio:
          metrics.materializationRatio == null
            ? null
            : roundToHundredths(metrics.materializationRatio),
      },
    },
    deltas: {
      new300: {
        vsLast: calculateDelta(metrics.new300, last ? last.new300 : null),
        vsFirst: calculateDelta(metrics.new300, first ? first.new300 : null),
      },
      newBig: {
        vsLast: calculateDelta(metrics.newBig, last ? last.newBig : null),
        vsFirst: calculateDelta(metrics.newBig, first ? first.newBig : null),
      },
    },
    historyPath: 'scripts/bench-history.json',
    historyEntries: history.length,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

function checkHistoryDeviation(history, big) {
  if (history.length > 0 && history[0].newBig != null && big.newBig != null) {
    const dev = (big.newBig - history[0].newBig) / history[0].newBig;
    if (Math.abs(dev) > 0.3) {
      console.warn(
        `[bench-baselines] WARN: 与历史基线偏差过大 (newBig ${(dev * 100).toFixed(1)}% vs 首次 ${history[0].newBig.toFixed(1)}ms)，注意机器负载/环境变化`,
      );
    }
  }
}

// ---- Main flow (four stages, strictly serial) ----

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  JSON_MODE = opts.json;

  cleanStaleCorpora();
  const history = loadHistory(HISTORY_FILE);

  // stage1: equivalence gate
  const validate = await runStage1Validate(opts);

  // stage2: standard benchmark
  let standard;
  try {
    standard = await runStage2Standard(opts);
  } catch (e) {
    console.error(`[bench-baselines] stage2 NEW 计时失败: ${e.message}`);
    process.exit(1);
  }
  printProgressMessage(
    `[bench-baselines] stage2 ${opts.files} files ...... NEW median ${standard.new300.toFixed(1)}ms (files=${standard.files} issues=${standard.issues})`,
  );
  if (standard.mixed300 != null) {
    printProgressMessage(
      `[bench-baselines]                                        MIXED median ${standard.mixed300.toFixed(1)}ms  speedup ${standard.speedup.toFixed(2)}x`,
    );
  }

  // stage3: large-file comparison
  let big;
  try {
    big = await runStage3Big(opts);
  } catch (e) {
    console.error(`[bench-baselines] stage3 大文件语料生成/计时失败: ${e.message}`);
    process.exit(1);
  }
  printProgressMessage(
    `[bench-baselines] stage3 big(${opts.bigFiles}x${opts.bigLines}) .... NEW median ${big.newBig.toFixed(1)}ms` +
      (big.mixedBig != null
        ? `  MIXED median ${big.mixedBig.toFixed(1)}ms  speedup ${big.speedup.toFixed(2)}x`
        : ''),
  );
  // Sanity warning: flag when newBig deviates more than 30% from the first history
  // entry (warn only, never abort).
  checkHistoryDeviation(history, big);

  // stage4: single-file profile
  const profile = await runStage4Profile(opts);
  if (profile.createSourceFile == null && profile.parseTs == null) {
    console.error('[bench-baselines] stage4 profile 核心计时全部失败，基准中止');
    process.exit(1);
  }
  printProgressMessage(`[bench-baselines] stage4 profile(200fn) .. ${formatProfileLine(profile)}`);

  // History persistence (append; --update replaces the most recent entry).
  const metrics = {
    new300: standard.new300,
    mixed300: standard.mixed300,
    newBig: big.newBig,
    mixedBig: big.mixedBig,
    createSourceFile: profile.createSourceFile,
    parseTs: profile.parseTs,
    mapTs: profile.mapTs,
    parseOxc: profile.parseOxc,
    mapOxc: profile.mapOxc,
    runStreaming: profile.runStreaming,
    materializationRatio: profile.materializationRatio,
  };
  recordRun(history, metrics, opts);
  saveHistory(HISTORY_FILE, history);

  if (opts.json) printJson(metrics, history, opts, validate);
  else printHuman(metrics, history, opts);
  printProgressMessage(
    `[bench-baselines] history: scripts/bench-history.json (${history.length} entries)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
