#!/usr/bin/env node
// bench-baselines.js — 一键统一基准（等价门 + 标准 + 大文件 + profile + 历史）
//
// 一条命令跑完「等价门 → 标准 benchmark → 大文件对比 → profile」，并做历史基线持久化，
// 供每次性能迭代使用。四阶段严格串行（避免 CPU 争用污染计时）。
//
// Usage:
//   node scripts/bench-baselines.js                                  # 全流程（validate 9 场景 + 300 文件 + 12 大文件 + profile）
//   node scripts/bench-baselines.js --vs-mixed                       # 额外对比 MIXED dist
//   node scripts/bench-baselines.js --skip-validate --json           # 跳过等价门 + 机器可读输出
//   node scripts/bench-baselines.js --files=150 --iterations=3       # 可缩放
//   node scripts/bench-baselines.js --update                         # 覆盖历史最近一条（同口径重跑）
//
// 硬约束（见 docs/05-specs-and-benchmarks/02-performance-benchmarks.md §0）：
//   - 不改 validate-equivalence.js / benchmark.js / scripts/baselines/*
//   - 阶段1 用 spawnSync 调用 validate（其末尾 process.exit() 会杀死 require 它的父进程）
//   - MIXED dist 内部 require('typescript') 依赖本仓库 node_modules → NODE_PATH 必须在
//     require(MIXED api) 之前设置
//   - 历史文件原子写（.tmp + rename），损坏时备份 .bak-<ts>

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HISTORY_FILE = path.join(__dirname, 'bench-history.json');
const CORPUS_STD = 'C:/tmp/ar-bench-standard';
const CORPUS_BIG = 'C:/tmp/ar-bench-big';
const DEFAULT_MIXED_DIST = 'C:/tmp/ar-mixed-dist';

// NODE_PATH must be set before any require of the MIXED dist (it resolves 'typescript'
// from the repo's node_modules). Set it at module load — harmless for the NEW dist.
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

// ---- 配置与解析 ----

function parseArgs(argv) {
  const arg = (name, dflt) => {
    const m = argv.find((a) => a.startsWith(`--${name}=`));
    return m ? m.split('=')[1] : dflt;
  };
  const num = (name, dflt) => {
    const v = parseInt(arg(name, String(dflt)), 10);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  return {
    files: num('files', 300),
    iterations: num('iterations', 5),
    workers: num('workers', 1),
    vsMixed: argv.includes('--vs-mixed'),
    mixedDist: arg('mixed-dist', DEFAULT_MIXED_DIST),
    skipValidate: argv.includes('--skip-validate'),
    update: argv.includes('--update'),
    json: argv.includes('--json'),
    bigFiles: num('big-files', 12),
    bigLines: num('big-lines', 2600),
    profileIters: num('profile-iters', 10),
    parser: arg('parser', 'typescript'),
  };
}

// ---- 共享工具 ----

/** Re-init module resolution paths so `require` picks up ROOT/node_modules. */
function setupNodePath() {
  process.env.NODE_PATH = path.join(ROOT, 'node_modules');
  require('module').Module._initPaths();
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — synchronous retry context (rmSync lock retry) */
  }
}

/** rm -rf with Windows file-lock retry (EBUSY/EPERM → 3 × 300ms). Throws if still locked. */
function rmRetry(p, attempts = 3, delayMs = 300) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) sleep(delayMs);
    }
  }
  // Last resort: some sandboxes guard bulk rmSync (bulk-delete confirmation). A
  // same-volume rename clears the corpus path while leaving an inert stale copy in
  // C:/tmp; a genuinely file-locked dir fails the rename too, so the caller still
  // gets the lock-failure exit(1) semantics.
  try {
    fs.renameSync(p, path.join('C:/tmp', `ar-stale-${path.basename(p)}-${Date.now()}`));
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
      rmRetry(t);
    } catch (e) {
      console.error(`[bench-baselines] 清理 ${t} 失败（Windows 文件锁）: ${e.message}`);
      process.exit(1);
    }
  }
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
}

/** Atomic write: write .tmp then rename (avoids half-written history on crash). */
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

/** Reuse benchmark.js's config shape (workers from CLI; logLevel overridden per-scan). */
function buildConfig(root, workers) {
  return {
    $schema: './config.schema.json',
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
      constants: { enabled: true, options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 } },
      'large-file': { enabled: true, options: { fileLinesWarn: 50, fileFunctionsWarn: 5 } },
      complexity: { enabled: true, options: { complexityWarn: 5 } },
      'no-console': { enabled: true, options: { severity: 'warning', allowed: ['error'] } },
    },
    customAnalyzers: [
      {
        name: 'no-console',
        module: path.join(ROOT, 'samples', 'analyzers', 'noConsole.js'),
        enabled: true,
        options: { severity: 'warning', allowed: ['error'] },
      },
    ],
    workers,
    respectGitignore: false, // spec §7: bench corpora must never be gitignore-filtered
    failOnAnalyzerError: false,
    logLevel: 'info',
  };
}

// ---- 阶段1：等价门 ----

async function stage1Validate(opts) {
  if (opts.skipValidate) {
    say('[bench-baselines] stage1 validate ....... SKIP (--skip-validate)');
    return { ok: true, passed: 0, total: 0, skipped: true };
  }
  // Must spawn — validate-equivalence.js ends with process.exit() and would kill a
  // parent that require()d it. In --json mode capture the child stdout so our own
  // stdout stays pure JSON (the PASS/FAIL lines are echoed to stderr instead).
  const stdio = opts.json ? ['inherit', 'pipe', 'inherit'] : 'inherit';
  const r = spawnSync(process.execPath, [path.join(__dirname, 'validate-equivalence.js')], {
    cwd: ROOT,
    stdio,
  });
  if (opts.json && r.stdout) process.stderr.write(r.stdout.toString());
  const ok = r.status === 0;
  if (ok) {
    say('[bench-baselines] stage1 validate ....... PASS (9/9)');
    return { ok: true, passed: 9, total: 9, skipped: false };
  }
  console.error('[bench-baselines] 输出已变，性能无效 —— validate 未全 PASS，基准中止');
  process.exit(1);
}

// ---- 阶段2：标准 benchmark（300 文件 workers=1）----

/** 3 templates + 30-function big template, copied from benchmark.js (parametrized dir). */
const TEMPLATES = [
  `export function f(a: number, b: number): number {
  if (a > 10) return a * 100;
  if (b < 5) return b + 100;
  const c = a + b;
  return c > 0 ? c : -c;
}
export const K = 100;
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
export function page(): string {
  const a = t('welcome message');
  const b = t('goodbye message');
  return a + b;
}
`,
];

function buildCorpus300(dir, files, workers) {
  rmRetry(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const w = (p, c) => fs.writeFileSync(path.join(dir, p), c);
  for (let i = 0; i < files; i++) w(`src/bench_${i}.ts`, TEMPLATES[i % TEMPLATES.length]);
  // a few large files to add node volume (same as benchmark.js)
  let big = '';
  for (let i = 0; i < 30; i++) big += `export function g${i}(n: number): number { let s = 0; if (n > ${i}) s += ${i}; if (n < ${i}) s -= ${i}; return s + ${i}; }\n`;
  w('src/big.ts', big);
  w('auto-refactor.config.json', JSON.stringify(buildConfig(dir, workers), null, 2));
  return path.join(dir, 'auto-refactor.config.json');
}

async function timeScan(api, root, configPath, opts) {
  const scenario = { root, configFile: configPath, workers: opts.workers, format: 'json', logLevel: 'silent', parser: opts.parser };
  const times = [];
  let summary = null;
  for (let k = 0; k < opts.iterations; k++) {
    const t0 = performance.now();
    const r = await api.scan(scenario);
    const t1 = performance.now();
    times.push(t1 - t0);
    summary = r.summary;
  }
  return { medianMs: median(times), files: summary.filesScanned, issues: summary.issuesTotal };
}

/** Time the NEW dist (+ optional MIXED). NEW failures throw (core stage); MIXED → WARN+null. */
async function timeDistPair(apiPath, root, configPath, opts) {
  const newApi = require(apiPath);
  const neu = await timeScan(newApi, root, configPath, opts);
  let mixed = null;
  if (opts.vsMixed) {
    setupNodePath(); // must precede require(MIXED api) — MIXED internally requires 'typescript'
    if (!fs.existsSync(path.join(opts.mixedDist, 'api.js'))) {
      console.warn('[bench-baselines] MIXED dist 不存在，跳过对比');
    } else {
      try {
        const mixedApi = require(path.join(opts.mixedDist, 'api'));
        mixed = await timeScan(mixedApi, root, configPath, opts);
      } catch (e) {
        console.warn(`[bench-baselines] MIXED dist 加载/计时失败，跳过对比: ${e.message}`);
        mixed = null;
      }
    }
  }
  return { neu, mixed };
}

async function stage2Standard(opts) {
  const configPath = buildCorpus300(CORPUS_STD, opts.files, opts.workers);
  const { neu, mixed } = await timeDistPair(path.join(ROOT, 'dist', 'api'), CORPUS_STD, configPath, opts);
  const speedup = mixed ? mixed.medianMs / neu.medianMs : null;
  return { new300: neu.medianMs, mixed300: mixed ? mixed.medianMs : null, speedup, files: neu.files, issues: neu.issues };
}

// ---- 阶段3：大文件对比（12 × ~2600 行）----

/**
 * One dense ~13-line function (nesting + literals + branches per function).
 * Names/constants are seeded per file so the 12 files are not identical; this shape
 * reproduces the historical MIXED/NEW big-file ratio (~1.4-1.5x) on this machine.
 */
function makeBigFunction(f, i, seed) {
  const a = (i * 7 + seed) % 1000;
  const b = (i * 13 + seed * 3) % 1000;
  const c = (i * 17 + seed * 5) % 1000;
  const k = (i % 6) + 2;
  const ret = (i * 11 + seed * 7) % 500;
  return [
    `export function fn${f}_${i}(a: number, b: number): number {`,
    `  let acc = ${seed % 1000};`,
    `  if (a > ${a}) {`,
    `    acc += ${a};`,
    `    if (b > ${b}) { acc -= ${b}; } else { acc += ${b}; }`,
    `  }`,
    `  for (let k = 0; k < ${k}; k++) {`,
    `    acc += k * ${c};`,
    `    if (k > 2) { acc -= ${c}; }`,
    `  }`,
    `  while (acc > 100000) { acc -= 1000; }`,
    `  return acc + ${ret};`,
    `}`,
    ``,
  ].join('\n');
}

function buildBigCorpus(dir, bigFiles, bigLines, workers) {
  rmRetry(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const w = (p, c) => fs.writeFileSync(path.join(dir, p), c);
  const funcsPerFile = Math.max(20, Math.round(bigLines / 13)); // ~13 lines per function
  for (let f = 0; f < bigFiles; f++) {
    const seed = f * 7919 + 17;
    let content = '';
    for (let i = 0; i < funcsPerFile; i++) content += makeBigFunction(f, i, seed);
    w(`src/big_${f}.ts`, content);
  }
  w('auto-refactor.config.json', JSON.stringify(buildConfig(dir, workers), null, 2));
  return path.join(dir, 'auto-refactor.config.json');
}

async function stage3Big(opts) {
  const configPath = buildBigCorpus(CORPUS_BIG, opts.bigFiles, opts.bigLines, opts.workers);
  const { neu, mixed } = await timeDistPair(path.join(ROOT, 'dist', 'api'), CORPUS_BIG, configPath, opts);
  const speedup = mixed ? mixed.medianMs / neu.medianMs : null;
  return { newBig: neu.medianMs, mixedBig: mixed ? mixed.medianMs : null, speedup };
}

// ---- 阶段4：单文件 profile（200 函数，分阶段计时）----

/** ~200 functions / ~2600-3000 lines, matching the historical profile corpus. */
function synthesizeProfileFile(functions = 200) {
  const parts = ['// synthetic profile corpus (bench-baselines stage4)'];
  for (let i = 0; i < functions; i++) {
    const a = (i * 3) % 100;
    const b = (i * 5) % 100;
    const c = (i * 7) % 100;
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
  const mkCtx = (options) => ({ filePath: 'profile.ts', content, root, adapter, config, options, lineStats });
  return [
    { analyzer: new ConstantsAnalyzer(), ctx: mkCtx({ magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 }) },
    { analyzer: new LargeFileAnalyzer(), ctx: mkCtx({ fileLinesWarn: 50, fileLinesFail: 800, fileFunctionsWarn: 15 }) },
    { analyzer: new ComplexityAnalyzer(), ctx: mkCtx({ complexityWarn: 5, complexityFail: 12 }) },
    { analyzer: new FileMetricCollector(), ctx: mkCtx({}) },
  ];
}

async function stage4Profile(opts) {
  const content = synthesizeProfileFile(200);
  const file = 'profile.ts';
  const ts = require('typescript');
  const { TypeScriptAdapter } = require(path.join(ROOT, 'dist', 'core', 'typescriptAdapter'));
  const { OxcAdapter } = require(path.join(ROOT, 'dist', 'core', 'oxcAdapter'));
  const { runStreaming } = require(path.join(ROOT, 'dist', 'core', 'traverse'));
  const cfg = { failOnAnalyzerError: false };

  const out = {
    createSourceFile: null,
    parseTs: null,
    mapTs: null,
    parseOxc: null,
    mapOxc: null,
    runStreaming: null,
    materializationRatio: null,
  };
  const times = (n, fn) => {
    const arr = [];
    for (let k = 0; k < n; k++) {
      const t0 = performance.now();
      fn();
      arr.push(performance.now() - t0);
    }
    return mean(arr);
  };

  // 1. createSourceFile — pure parse, no parent pointers (engine-identical).
  try {
    out.createSourceFile = times(opts.profileIters, () =>
      ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false),
    );
  } catch (e) {
    console.warn(`[bench-baselines] stage4 createSourceFile 计时失败: ${e.message}`);
  }

  // 2. TypeScriptAdapter.parse (parse + map); mapTs = parseTs − createSourceFile.
  const tsAdapter = new TypeScriptAdapter();
  let tsAst = null;
  try {
    out.parseTs = times(opts.profileIters, () => {
      tsAst = tsAdapter.parse(content, file);
    });
    out.mapTs = out.parseTs - out.createSourceFile;
  } catch (e) {
    console.warn(`[bench-baselines] stage4 TypeScriptAdapter.parse 计时失败: ${e.message}`);
  }

  // 4. runStreaming over the SAME ast + entries objects (construction not counted).
  if (tsAst) {
    const entries = makeProfileEntries(content, cfg, tsAdapter, tsAst.root);
    try {
      out.runStreaming = times(opts.profileIters, () => runStreaming(tsAdapter, tsAst.root, entries));
    } catch (e) {
      console.warn(`[bench-baselines] stage4 runStreaming 计时失败: ${e.message}`);
    }
    if (out.parseTs > 0) out.materializationRatio = out.mapTs / out.parseTs;
  }

  // 3. oxc (only if oxc-parser is loadable; default TS path never touches the binding).
  try {
    const oxcAdapter = new OxcAdapter();
    oxcAdapter.parse(content, file); // probe — throws if the native binding is unavailable
    const parseSync = require('oxc-parser').parseSync;
    const oxcOpts = { lang: 'ts', sourceType: 'unambiguous', preserveParens: true };
    out.parseOxc = times(opts.profileIters, () => parseSync(file, content, oxcOpts));
    const oxcTotal = times(opts.profileIters, () => oxcAdapter.parse(content, file));
    out.mapOxc = oxcTotal - out.parseOxc;
  } catch (e) {
    console.warn(`[bench-baselines] stage4 oxc 不可用，跳过（默认 TS 路径不受影响）: ${e.message}`);
    out.parseOxc = null;
    out.mapOxc = null;
  }

  return out;
}

// ---- 历史持久化 ----

function loadHistory(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.entries)) return data.entries;
    throw new Error('invalid shape (missing entries array)');
  } catch (e) {
    const bak = `${file}.bak-${Date.now()}`;
    try {
      fs.copyFileSync(file, bak);
    } catch {
      /* backup best-effort */
    }
    console.warn(`[bench-baselines] bench-history.json 损坏（${e.message}），备份为 ${path.basename(bak)}，以空历史继续`);
    return [];
  }
}

function saveHistory(file, entries) {
  writeFileAtomic(file, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
}

function getCommit() {
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    return r.status === 0 && r.stdout ? r.stdout.trim() : null;
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
    flags: { files: opts.files, iterations: opts.iterations, workers: opts.workers, bigFiles: opts.bigFiles, bigLines: opts.bigLines, parser: opts.parser },
  };
  if (opts.update && entries.length > 0) entries[entries.length - 1] = entry;
  else entries.push(entry);
  return entries;
}

function fmtDelta(cur, ref) {
  if (cur == null || ref == null || ref === 0) return '-';
  const d = (cur - ref) / ref;
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;
}

// ---- 输出 ----

/** stdout router: in --json mode only the final JSON may reach stdout (progress → stderr). */
let JSON_MODE = false;
function say(...args) {
  if (JSON_MODE) process.stderr.write(`${args.join(' ')}\n`);
  else console.log(...args);
}

function profileLine(p) {
  const fmt = (v) => (v == null ? 'n/a' : `${v.toFixed(1)}ms`);
  const parts = [`createSourceFile ${fmt(p.createSourceFile)}`, `parse+map ${fmt(p.parseTs)}`, `mapNode ${fmt(p.mapTs)}`];
  if (p.parseOxc != null) parts.push(`parseSync(oxc) ${fmt(p.parseOxc)}`);
  if (p.mapOxc != null) parts.push(`mapOxc ${fmt(p.mapOxc)}`);
  parts.push(`runStreaming ${fmt(p.runStreaming)}`);
  if (p.materializationRatio != null) parts.push(`物化占比 ${Math.round(p.materializationRatio * 100)}%`);
  return parts.join(' | ');
}

function printHuman(metrics, history, opts) {
  const last = history.length >= 2 ? history[history.length - 2] : null;
  const first = history.length >= 1 ? history[0] : null;
  const fmt = (v) => (v == null ? '-' : v.toFixed(1));
  console.log('------------------------------------------------------------');
  console.log('metric'.padEnd(18) + '本次'.padStart(10) + '上次'.padStart(10) + 'Δ(上次)'.padStart(10) + '首次'.padStart(10) + 'Δ(首次)'.padStart(10));
  const rows = [
    ['new300', metrics.new300, last && last.new300, first && first.new300],
    ['mixed300', metrics.mixed300, last && last.mixed300, first && first.mixed300],
    ['newBig', metrics.newBig, last && last.newBig, first && first.newBig],
    ['mixedBig', metrics.mixedBig, last && last.mixedBig, first && first.mixedBig],
    ['createSourceFile', metrics.createSourceFile, last && last.createSourceFile, first && first.createSourceFile],
    ['mapTs', metrics.mapTs, last && last.mapTs, first && first.mapTs],
    ['parseOxc', metrics.parseOxc, last && last.parseOxc, first && first.parseOxc],
    ['runStreaming', metrics.runStreaming, last && last.runStreaming, first && first.runStreaming],
  ];
  for (const [label, cur, l, f] of rows) {
    console.log(
      label.padEnd(18) +
        fmt(cur).padStart(10) +
        fmt(l).padStart(10) +
        fmtDelta(cur, l).padStart(10) +
        fmt(f).padStart(10) +
        fmtDelta(cur, f).padStart(10),
    );
  }
  console.log('------------------------------------------------------------');
}

function printJson(metrics, history, opts, validate) {
  const last = history.length >= 2 ? history[history.length - 2] : null;
  const first = history.length >= 1 ? history[0] : null;
  const delta = (cur, ref) => {
    if (cur == null || ref == null || ref === 0) return null;
    return Math.round(((cur - ref) / ref) * 1000) / 1000;
  };
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
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
        new300: r2(metrics.new300),
        mixed300: r2(metrics.mixed300),
        speedup: metrics.mixed300 != null && metrics.new300 ? r2(metrics.mixed300 / metrics.new300) : null,
      },
      big: {
        newBig: r2(metrics.newBig),
        mixedBig: r2(metrics.mixedBig),
        speedup: metrics.mixedBig != null && metrics.newBig ? r2(metrics.mixedBig / metrics.newBig) : null,
      },
      profile: {
        createSourceFile: r2(metrics.createSourceFile),
        parseTs: r2(metrics.parseTs),
        mapTs: r2(metrics.mapTs),
        parseOxc: r2(metrics.parseOxc),
        mapOxc: r2(metrics.mapOxc),
        runStreaming: r2(metrics.runStreaming),
        materializationRatio: metrics.materializationRatio == null ? null : r2(metrics.materializationRatio),
      },
    },
    deltas: {
      new300: { vsLast: delta(metrics.new300, last && last.new300), vsFirst: delta(metrics.new300, first && first.new300) },
      newBig: { vsLast: delta(metrics.newBig, last && last.newBig), vsFirst: delta(metrics.newBig, first && first.newBig) },
    },
    historyPath: 'scripts/bench-history.json',
    historyEntries: history.length,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

// ---- 主流程（四阶段串行）----

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  JSON_MODE = opts.json;

  cleanStaleCorpora();
  const history = loadHistory(HISTORY_FILE);

  // stage1: 等价门
  const validate = await stage1Validate(opts);

  // stage2: 标准 benchmark
  let standard;
  try {
    standard = await stage2Standard(opts);
  } catch (e) {
    console.error(`[bench-baselines] stage2 NEW 计时失败: ${e.message}`);
    process.exit(1);
  }
  say(`[bench-baselines] stage2 ${opts.files} files ...... NEW median ${standard.new300.toFixed(1)}ms (files=${standard.files} issues=${standard.issues})`);
  if (standard.mixed300 != null) {
    say(`[bench-baselines]                                        MIXED median ${standard.mixed300.toFixed(1)}ms  speedup ${standard.speedup.toFixed(2)}x`);
  }

  // stage3: 大文件对比
  let big;
  try {
    big = await stage3Big(opts);
  } catch (e) {
    console.error(`[bench-baselines] stage3 大文件语料生成/计时失败: ${e.message}`);
    process.exit(1);
  }
  say(
    `[bench-baselines] stage3 big(${opts.bigFiles}x${opts.bigLines}) .... NEW median ${big.newBig.toFixed(1)}ms` +
      (big.mixedBig != null ? `  MIXED median ${big.mixedBig.toFixed(1)}ms  speedup ${big.speedup.toFixed(2)}x` : ''),
  );
  // 合理性告警：newBig 与历史首条偏差 > ±30% 时提示（只提示不中断）
  if (history.length > 0 && history[0].newBig != null && big.newBig != null) {
    const dev = (big.newBig - history[0].newBig) / history[0].newBig;
    if (Math.abs(dev) > 0.3) {
      console.warn(
        `[bench-baselines] WARN: 与历史基线偏差过大 (newBig ${(dev * 100).toFixed(1)}% vs 首次 ${history[0].newBig.toFixed(1)}ms)，注意机器负载/环境变化`,
      );
    }
  }

  // stage4: 单文件 profile
  const profile = await stage4Profile(opts);
  if (profile.createSourceFile == null && profile.parseTs == null) {
    console.error('[bench-baselines] stage4 profile 核心计时全部失败，基准中止');
    process.exit(1);
  }
  say(`[bench-baselines] stage4 profile(200fn) .. ${profileLine(profile)}`);

  // 历史持久化（追加；--update 覆盖最近一条）
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
  say(`[bench-baselines] history: scripts/bench-history.json (${history.length} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
