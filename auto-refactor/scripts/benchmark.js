#!/usr/bin/env node
// Performance benchmark for the single-pass AST multiplexing refactor.
//
// Generates a larger synthetic corpus (default 300 dense .ts files) and times the
// scan. With --vs-mixed it also times a MIXED dist (single orchestration descent +
// per-analyzer internal walks == OLD walk count) so the traversal saving is isolated.
//
// Usage:
//   node scripts/benchmark.js                       # time the current (NEW) build
//   node scripts/benchmark.js --vs-mixed            # also compare against MIXED dist
//   node scripts/benchmark.js --files=600 --iterations=5 --workers=4
//
// The MIXED dist defaults to C:/tmp/ar-mixed-dist (override: --mixed-dist=<path>).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Ensure the external MIXED dist can resolve 'typescript'. process.env.NODE_PATH only
// takes effect at module-resolution time, so re-init the module paths after setting it.
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();
const CORPUS = path.join(__dirname, '.bench-corpus');
const SAMPLES = path.join(ROOT, 'samples');

const arg = (name, dflt) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : dflt;
};
const FILES = parseInt(arg('files', '300'), 10);
const ITERS = parseInt(arg('iterations', '3'), 10);
const WORKERS = parseInt(arg('workers', '1'), 10);
const VS_MIXED = process.argv.includes('--vs-mixed');
const MIXED_DIST = arg('mixed-dist', 'C:/tmp/ar-mixed-dist');

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

function buildCorpus() {
  // Always start from a clean corpus — stale files from previous runs with different
  // --files counts would otherwise pollute the file count and the benchmark numbers.
  fs.rmSync(CORPUS, { recursive: true, force: true });
  fs.mkdirSync(path.join(CORPUS, 'src'), { recursive: true });
  const w = (p, c) => fs.writeFileSync(path.join(CORPUS, p), c);
  for (let i = 0; i < FILES; i++) w(`src/bench_${i}.ts`, TEMPLATES[i % TEMPLATES.length]);
  // a few large files to add node volume
  let big = '';
  for (let i = 0; i < 30; i++) big += `export function g${i}(n: number): number { let s = 0; if (n > ${i}) s += ${i}; if (n < ${i}) s -= ${i}; return s + ${i}; }\n`;
  w('src/big.ts', big);
  const config = {
    $schema: './config.schema.json',
    format: 'json', failOnIssue: false,
    include: ['**/*.ts', '**/*.js'],
    exclude: ['node_modules', '.git', 'dist'],
    thresholds: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3, fileLinesWarn: 400, complexityWarn: 8 },
    analyzers: {
      constants: { enabled: true, options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 } },
      'large-file': { enabled: true, options: { fileLinesWarn: 50, fileFunctionsWarn: 5 } },
      complexity: { enabled: true, options: { complexityWarn: 5 } },
      'no-console': { enabled: true, options: { severity: 'warning', allowed: ['error'] } },
    },
    customAnalyzers: [{ name: 'no-console', module: path.join(SAMPLES, 'analyzers', 'noConsole.js'), enabled: true, options: { severity: 'warning', allowed: ['error'] } }],
    workers: WORKERS, respectGitignore: true, failOnAnalyzerError: false, logLevel: 'info',
  };
  w('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

async function timeDist(api) {
  const scenario = { root: CORPUS, configFile: path.join(CORPUS, 'auto-refactor.config.json'), workers: WORKERS, format: 'json', logLevel: 'silent' };
  const times = [];
  let summary = null;
  for (let k = 0; k < ITERS; k++) {
    const t0 = performance.now();
    const r = await api.scan(scenario);
    const t1 = performance.now();
    times.push(t1 - t0);
    summary = r.summary;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  return { median, files: summary.filesScanned, issues: summary.issuesTotal };
}

async function main() {
  buildCorpus();
  console.log(`\nBenchmark: ${FILES} files, workers=${WORKERS}, iterations=${ITERS}`);
  console.log('------------------------------------------------------------');

  const newApi = require(path.join(ROOT, 'dist', 'api'));
  const neu = await timeDist(newApi);
  console.log(`NEW (single-pass)   median ${neu.median.toFixed(1)} ms   files=${neu.files} issues=${neu.issues}`);

  if (VS_MIXED) {
    if (!fs.existsSync(path.join(MIXED_DIST, 'api.js'))) {
      console.error(`MIXED dist not found at ${MIXED_DIST} — skipping comparison.`);
    } else {
      const mixedApi = require(path.join(MIXED_DIST, 'api'));
      const mix = await timeDist(mixedApi);
      console.log(`MIXED (multi-walk)   median ${mix.median.toFixed(1)} ms   files=${mix.files} issues=${mix.issues}`);
      const speedup = mix.median / neu.median;
      const saved = (1 - neu.median / mix.median) * 100;
      console.log('------------------------------------------------------------');
      console.log(`SPEEDUP vs multi-walk: ${speedup.toFixed(2)}x  (traversal cost saved: ${saved.toFixed(1)}%)`);
      if (mix.issues !== neu.issues) console.warn(`WARNING: issue counts differ (NEW=${neu.issues} MIXED=${mix.issues}) — results not comparable`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
