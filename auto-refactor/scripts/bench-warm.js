#!/usr/bin/env node
// bench-warm.js — warm-scan benchmark (docs/01-architecture/02-pipeline-and-caching.md Part E).
//
// 1001 light files. S1-S5 measure the SCAN PIPELINE (the design's own methodology — its
// cold/warm numbers of ~150ms/<30ms are API-level, excluding the ~180ms CLI process boot):
//   S1 cold       scan()                         — no daemon, no cache
//   S2 warm-1st   scanWarm(daemon:'on')          — daemon cold pool + empty cache (pre-started)
//   S3 warm-2nd   scanWarm                       — hot pool + hot cache (acceptance gate)
//   S4 warm-3rd   scanWarm                       — stability
//   S5 mixed-10%  scanWarm, 100 files changed
// S6 measures the FULL CLI spawn (cross-process, hot disk cache after the daemon stops):
//   S6 cold-2nd   node dist/index.js --no-daemon --cache
//
// Acceptance: S3/S4 at least 5× faster than S1 (S1/S3 >= 5 and S1/S4 >= 5).
// History: appended to scripts/bench-history.json under a new `benchWarm` partition
// (the existing `entries` array is preserved untouched).
//
// Usage:
//   node scripts/bench-warm.js                 # oxc parser, workers 4 (default)
//   node scripts/bench-warm.js --parser=typescript --workers=4

const { scan, scanWarm } = require('../dist/api');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const CORPUS = 'C:/tmp/ar-warm-corpus';
const CACHE_DIR = path.join(CORPUS, '.auto-refactor-cache');
const HISTORY_FILE = path.join(__dirname, 'bench-history.json');
const FILES = 1001;
const MIXED = 100;

const args = process.argv.slice(2);
const parser = (args.find((a) => a.startsWith('--parser=')) || '--parser=oxc').split('=')[1];
const workers = parseInt((args.find((a) => a.startsWith('--workers=')) || '--workers=4').split('=')[1], 10) || 4;

// ---- corpus ----
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

function rmRetry(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(p, path.join('C:/tmp', `ar-stale-${path.basename(p)}-${Date.now()}`));
    } catch {
      /* ignore */
    }
  }
}

function buildCorpus() {
  rmRetry(CORPUS);
  fs.mkdirSync(path.join(CORPUS, 'src'), { recursive: true });
  for (let i = 0; i < FILES; i++) {
    fs.writeFileSync(path.join(CORPUS, 'src', `bench_${i}.ts`), TEMPLATES[i % TEMPLATES.length]);
  }
  const config = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: {
      magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3,
      fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15,
      complexityWarn: 8, complexityFail: 12,
    },
    analyzers: { constants: { enabled: true }, 'large-file': { enabled: true }, complexity: { enabled: true } },
    customAnalyzers: [],
    logLevel: 'silent',
    workers,
    respectGitignore: false,
    failOnAnalyzerError: false,
    parser,
  };
  fs.writeFileSync(path.join(CORPUS, 'auto-refactor.config.json'), JSON.stringify(config, null, 2));
}

function modifyFiles(n) {
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(
      path.join(CORPUS, 'src', `bench_${i}.ts`),
      `export function f(a: number, b: number): number {\n  if (a > ${1000 + i}) return a * ${7 + (i % 9)};\n  if (b < 5) return b + ${50 + i};\n  return a + b;\n}\n`,
    );
  }
}

function daemonStart() {
  const r = spawnSync(process.execPath, [CLI, 'daemon', 'start', '--root', CORPUS], { stdio: 'ignore', timeout: 20000 });
  return r.status === 0;
}

function daemonStop() {
  try {
    spawnSync(process.execPath, [CLI, 'daemon', 'stop', '--root', CORPUS], { stdio: 'ignore', timeout: 15000 });
  } catch {
    /* best-effort */
  }
}

const baseOpts = { root: CORPUS, format: 'json', logLevel: 'silent' };

async function main() {
  buildCorpus();
  daemonStop();
  rmRetry(CACHE_DIR);

  const run = (label, ms, extra = '') => {
    console.log(`  ${label.padEnd(16)} ${ms.toFixed(1).padStart(8)} ms${extra ? `  ${extra}` : ''}`);
    return ms;
  };

  console.log(`bench-warm: ${FILES} files, parser=${parser}, workers=${workers} (pipeline-level for S1-S5, CLI-spawn for S6)`);

  // S1 cold — pure pipeline, no daemon, no cache.
  const t0 = performance.now();
  const r1 = await scan({ ...baseOpts });
  const s1 = run('S1 cold', performance.now() - t0, `issues=${r1.summary.issuesTotal}`);

  // Pre-start the daemon so S2 measures a COLD pool (not the ~2s spawn).
  const started = daemonStart();
  if (!started) throw new Error('daemon failed to start for bench');

  // S2 warm-1st — daemon cold pool + empty cache.
  const t2 = performance.now();
  const r2 = await scanWarm({ ...baseOpts, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const s2 = run('S2 warm-1st', performance.now() - t2, `daemon=${r2.stats.daemonUsed} analyzed=${r2.stats.analyzed}`);

  // S3/S4 warm-2nd/3rd — hot pool + hot cache.
  const t3 = performance.now();
  const r3 = await scanWarm({ ...baseOpts, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const s3 = run('S3 warm-2nd', performance.now() - t3, `cacheHit=${r3.stats.cacheHit}/${r3.stats.cacheTotal} analyzed=${r3.stats.analyzed} daemonMs=${r3.stats.daemonMs}`);

  const t4 = performance.now();
  const r4 = await scanWarm({ ...baseOpts, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const s4 = run('S4 warm-3rd', performance.now() - t4, `analyzed=${r4.stats.analyzed}`);

  // S5 mixed-10% — 100 files changed.
  modifyFiles(MIXED);
  const t5 = performance.now();
  const r5 = await scanWarm({ ...baseOpts, daemon: 'on', cache: true, cacheDir: CACHE_DIR });
  const s5 = run('S5 mixed-10%', performance.now() - t5, `cacheHit=${r5.stats.cacheHit}/${r5.stats.cacheTotal} analyzed=${r5.stats.analyzed}`);

  // S6 cold-2nd — fresh CLI process + hot DISK cache (cross-process proof).
  daemonStop();
  const t6 = performance.now();
  const r6 = spawnSync(
    process.execPath,
    [CLI, 'scan', '--root', CORPUS, '--format', 'json', '--no-daemon', '--cache', '--cache-dir', CACHE_DIR, '--log-level', 'silent'],
    { stdio: 'ignore', timeout: 120000 },
  );
  const s6 = run('S6 cold-2nd', performance.now() - t6, r6.status === 0 ? '(cli spawn, hot disk cache)' : `FAILED status=${r6.status}`);

  const ratio = (slow, fast) => (fast > 0 ? slow / fast : 0);
  const r3x = ratio(s1, s3);
  const r4x = ratio(s1, s4);
  console.log('');
  console.log('  speedup vs S1 (higher is better)');
  console.log(`  S2 warm-1st    ${ratio(s1, s2).toFixed(1)}x`);
  console.log(`  S3 warm-2nd    ${r3x.toFixed(1)}x   (gate >= 5x)`);
  console.log(`  S4 warm-3rd    ${r4x.toFixed(1)}x   (gate >= 5x)`);
  console.log(`  S5 mixed-10%   ${ratio(s1, s5).toFixed(1)}x`);
  console.log(`  S6 cold-2nd    ${ratio(s1, s6).toFixed(1)}x  (cross-process)`);

  const pass = r3x >= 5 && r4x >= 5;
  console.log(pass ? '\nACCEPTANCE: PASS (S3/S4 >= 5x vs S1)' : '\nACCEPTANCE: FAIL (S3/S4 < 5x vs S1)');

  const history = loadHistory();
  history.benchWarm.push({
    date: new Date().toISOString(),
    parser,
    workers,
    files: FILES,
    mixed: MIXED,
    s1cold: Math.round(s1 * 10) / 10,
    s2warm1st: Math.round(s2 * 10) / 10,
    s3warm2nd: Math.round(s3 * 10) / 10,
    s4warm3rd: Math.round(s4 * 10) / 10,
    s5mixed: Math.round(s5 * 10) / 10,
    s6cold2nd: Math.round(s6 * 10) / 10,
    speedupS3: Math.round(r3x * 10) / 10,
    speedupS4: Math.round(r4x * 10) / 10,
    accept: pass,
    env: { node: process.version, os: process.platform },
  });
  saveHistory(history);
  console.log(`history: ${HISTORY_FILE} (benchWarm entries: ${history.benchWarm.length})`);

  daemonStop();
  process.exit(pass ? 0 : 1);
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { entries: [], benchWarm: [] };
  try {
    const d = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return { entries: Array.isArray(d.entries) ? d.entries : [], benchWarm: Array.isArray(d.benchWarm) ? d.benchWarm : [] };
  } catch {
    return { entries: [], benchWarm: [] };
  }
}

function saveHistory(history) {
  const data = { ...history, schemaVersion: 1 };
  const tmp = `${HISTORY_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, HISTORY_FILE);
}

main().catch((e) => {
  console.error(e);
  try {
    daemonStop();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
