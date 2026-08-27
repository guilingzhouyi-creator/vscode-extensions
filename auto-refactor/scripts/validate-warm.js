#!/usr/bin/env node
// validate-warm.js — warm-scan equivalence regression (docs/01-architecture/02-pipeline-and-caching.md Part D).
//
// Proves the warm path (daemon + two-level cache) produces output BYTE-IDENTICAL to the
// fresh path, per scenario W1-W9. Corpus generation + normalize are reused from
// validate-equivalence.js (same templates, same normalization: excludes generatedAt /
// durationMs / config, issues sorted by id, fileMetrics sorted by file).
//
//   fresh = scan()                — no daemon, no cache (exact cold semantics)
//   warm  = scanWarm(daemon:'on') — daemon + cache (empty cache on W1, hot thereafter)
//
// Every warm scenario additionally asserts stats.daemonUsed so a silent degrade-to-cold
// cannot fake a pass. Exit code 0 = PASS, 1 = FAIL (CI gate).
//
// Usage:
//   node scripts/validate-warm.js

const { scan, scanWarm } = require('../dist/api');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, '.corpus');
const RUST_CORPUS = path.join(__dirname, '.rust-corpus');
const SAMPLES = path.join(ROOT, 'samples');
const CACHE_DIR = 'C:/tmp/ar-warm-validate-cache';
const CACHE_DIR_RUST = 'C:/tmp/ar-warm-validate-cache-rust';
const CORPUS_CFG = path.join(CORPUS, 'auto-refactor.config.json');
const RUST_CFG = path.join(RUST_CORPUS, 'auto-refactor.config.json');

// ---- canonical corpus (same templates as validate-equivalence.js) ----
const TEMPLATES = {
  magicNum: `export function clamp(v: number): number {
  if (v > 100) return 100;
  if (v < -100) return -100;
  return v;
}
export const LIMIT = 100;
export function rate(x: number): number {
  // 100 repeated several times -> duplicate-literal
  return x * 100 + 100 - 100;
}
`,
  hardStr: `export function greet(name: string): string {
  const msg = 'hello world';
  console.log('hello world');
  return 'hello world ' + name;
}
export function bye(): string {
  return 'hello world';
}
`,
  i18n: `function t(s: string): string { return s; }
export function page(): string {
  const a = t('welcome message');
  const b = t('goodbye message');
  return a + b;
}
`,
  binding: `export const handler = () => {
  const self = () => { return 'inner'; };
  const obj = { onClick: () => { return self(); } };
  obj.onClick = () => 42;
  exports.foo = function () { return 7; };
  return obj.onClick();
};
`,
  cls: `export class Widget {
  private count = 0;
  inc(): void { this.count = this.count + 1; }
  dec(): void { this.count = this.count - 1; }
  get(): number { return this.count; }
  heavy(a: number, b: number, c: number): number {
    if (a > 0) { if (b > 0) { if (c > 0) return a + b + c; else return a + b; } else return a; }
    else if (a < 0) return -a;
    return 0;
  }
}
`,
  complex: `export function decide(x: number, y: number, z: number): string {
  let out = '';
  if (x === 1) out += 'a'; else if (x === 2) out += 'b'; else if (x === 3) out += 'c'; else out += 'd';
  if (y === 1) out += 'A'; else if (y === 2) out += 'B'; else if (y === 3) out += 'C'; else out += 'D';
  if (z === 1) out += '1'; else if (z === 2) out += '2'; else if (z === 3) out += '3'; else out += '4';
  switch (out.length) {
    case 1: return out + 'x';
    case 2: return out + 'y';
    case 3: return out + 'z';
    default: return out;
  }
}
`,
};

function writeCorpus() {
  fs.mkdirSync(path.join(CORPUS, 'src'), { recursive: true });
  fs.mkdirSync(path.join(CORPUS, 'ignored'), { recursive: true });
  const w = (p, c) => fs.writeFileSync(path.join(CORPUS, p), c);
  for (const [name, content] of Object.entries(TEMPLATES)) {
    for (let k = 0; k < 4; k++) w(`src/unit_${name}_${k}.ts`, content);
  }
  let big = '';
  for (let n = 0; n < 12; n++) {
    big += `export function fn${n}(x: number): number {\n  let s = 0;\n  if (x > ${n}) s += ${n};\n  if (x < ${n}) s -= ${n};\n  return s + ${n};\n}\n`;
  }
  big += `export const TAG = 'shared token';\n`;
  for (let n = 0; n < 8; n++) big += `export const TOKEN${n} = 'shared token';\n`;
  w('src/bigfile.ts', big);
  w('src/legacy.js', `function compute(a, b) {
  if (a > 5) { return b * 100; }
  return a + 100;
}
console.log('legacy start');
const NAME = 'legacy name';
module.exports = { compute };
`);
  w('ignored/skip.ts', `export const SECRET = 'should not be scanned';\n`);
  w('.gitignore', 'ignored/\n');
}

// Built-ins-only config (W1-W6/W8). W5 overwrites thresholds; W7 adds the custom analyzer.
function baseConfig(overrides = {}) {
  return {
    $schema: './config.schema.json',
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'],
    thresholds: {
      magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3,
      fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15,
      complexityWarn: 8, complexityFail: 12,
    },
    analyzers: {
      constants: { enabled: true },
      'large-file': { enabled: true },
      complexity: { enabled: true },
    },
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 1,
    respectGitignore: true,
    failOnAnalyzerError: false,
    ...overrides,
  };
}

function writeConfig(overrides) {
  fs.writeFileSync(CORPUS_CFG, JSON.stringify(baseConfig(overrides), null, 2));
}

// ---- Rust corpus (same as validate-equivalence.js) ----
const RUST_TEMPLATES = {
  magic: `pub fn clamp(v: i32) -> i32 {
    if v > 100 { return 100; }
    if v < -100 { return -100; }
    v
}

pub const LIMIT: i32 = 100;

pub fn rate(x: i32) -> i32 {
    x * 100 + 100 - 100
}
`,
  greet: `pub fn greet(name: &str) -> String {
    let msg = "hello world";
    println!("{} {}", msg, name);
    format!("{} {}", msg, name)
}

pub fn bye() -> String {
    "hello world".to_string()
}
`,
  order: `pub struct Order {
    pub id: u64,
    pub total: i64,
}

impl Order {
    pub fn new(id: u64, total: i64) -> Self {
        Order { id, total }
    }

    pub fn apply_discount(&self, rate: i64) -> i64 {
        if rate > 50 { return self.total / 2; }
        if rate > 20 { return self.total - rate; }
        self.total
    }

    pub fn status(&self, threshold: i64) -> &'static str {
        if self.total > threshold {
            "large"
        } else if self.total > 0 {
            "ok"
        } else {
            "empty"
        }
    }
}

pub fn heavy(a: i32, b: i32, c: i32) -> i32 {
    let mut out = 0;
    if a > 0 {
        if b > 0 {
            if c > 0 {
                out = a + b + c;
            } else {
                out = a + b;
            }
        } else {
            out = a;
        }
    }
    match out {
        0 => 1,
        1 => 2,
        2 => 3,
        _ => 0,
    }
}
`,
  legacy: `fn compute(a: i32, b: i32) -> i32 {
    if a > 5 {
        return b * 100;
    }
    a + 100
}

fn main() {
    let closure = |x: i32| x * 2;
    println!("legacy start");
    let name = "legacy name";
    println!("{} {}", closure(21), name);
}
`,
};

function writeRustCorpus() {
  fs.mkdirSync(path.join(RUST_CORPUS, 'src'), { recursive: true });
  const w = (p, c) => fs.writeFileSync(path.join(RUST_CORPUS, p), c);
  for (const [name, content] of Object.entries(RUST_TEMPLATES)) {
    w(`src/${name}.rs`, content);
  }
  const config = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.rs'],
    exclude: ['node_modules', 'target', '.git', 'dist'],
    thresholds: {
      magicNumberMin: 2, duplicateLiteralThreshold: 2, hardcodedStringMinLength: 3,
      fileLinesWarn: 40, fileLinesFail: 80, fileFunctionsWarn: 6,
      complexityWarn: 5, complexityFail: 10,
    },
    analyzers: { constants: { enabled: true }, 'large-file': { enabled: true }, complexity: { enabled: true } },
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 1,
    respectGitignore: false,
    failOnAnalyzerError: true,
  };
  w('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

/** Same normalize as validate-equivalence.js (excludes runtime/config fields). */
function normalize(r) {
  const issues = r.issues
    .map((x) => ({ id: x.id, analyzer: x.analyzer, rule: x.rule, severity: x.severity, message: x.message, location: x.location, detail: x.detail }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics.map((m) => ({ ...m })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { filesScanned: r.summary.filesScanned, issuesTotal: r.summary.issuesTotal, byAnalyzer: r.summary.byAnalyzer, bySeverity: r.summary.bySeverity, issues, fileMetrics };
}

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

function daemonStop(root) {
  try {
    spawnSync(process.execPath, [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'stop', '--root', root], { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }
}

async function main() {
  // Fresh corpora + empty caches + no daemon.
  rmRetry(CORPUS);
  rmRetry(RUST_CORPUS);
  rmRetry(CACHE_DIR);
  rmRetry(CACHE_DIR_RUST);
  writeCorpus();
  writeRustCorpus();
  writeConfig();
  daemonStop(CORPUS);
  daemonStop(RUST_CORPUS);

  let failed = 0;
  const check = (name, ok, extra) => {
    if (ok) console.log(`PASS ${name}${extra ? `  ${extra}` : ''}`);
    else {
      failed++;
      console.error(`FAIL ${name}${extra ? `  ${extra}` : ''}`);
    }
  };

  const freshScan = (opts = {}) =>
    scan({ root: CORPUS, configFile: CORPUS_CFG, format: 'json', logLevel: 'silent', ...opts });
  const warmScan = (opts = {}) =>
    scanWarm({
      root: CORPUS,
      configFile: CORPUS_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'on',
      cache: true,
      cacheDir: CACHE_DIR,
      ...opts,
    });

  // ---- W1: cold-start empty cache (warm-1st: daemon cold pool + empty cache) ----
  {
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W1 cold-start-empty-cache', eq && w.stats.daemonUsed === true, `warm analyzed=${w.stats.analyzed} daemonUsed=${w.stats.daemonUsed}`);
  }

  // ---- W2: immediate rescan (warm-2nd: hot pool + hot cache, all cached) ----
  {
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W2 immediate-rescan', eq && w.stats.daemonUsed === true && w.stats.cacheHit > 0, `cacheHit=${w.stats.cacheHit}/${w.stats.cacheTotal} analyzed=${w.stats.analyzed}`);
  }

  // ---- W3: partial change (modify 3 files) ----
  {
    const mod = [
      ['src/unit_magicNum_0.ts', 'export function clamp(v: number): number {\n  if (v > 200) return 200;\n  if (v < -200) return -200;\n  return v + 1;\n}\n'],
      ['src/unit_hardStr_1.ts', 'export function greet(name: string): string {\n  const msg = "hello warm world";\n  return msg + name;\n}\n'],
      ['src/unit_cls_2.ts', 'export class Widget {\n  private count = 0;\n  inc(): void { this.count = this.count + 2; }\n  get(): number { return this.count; }\n}\n'],
    ];
    for (const [p, c] of mod) fs.writeFileSync(path.join(CORPUS, p), c);
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W3 partial-change', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
    writeCorpus(); // restore original content for W4+
  }

  // ---- W4: touch without content change (L1 miss -> L2 hit fallback) ----
  {
    const files = fs.readdirSync(path.join(CORPUS, 'src')).map((n) => path.join(CORPUS, 'src', n));
    const now = new Date();
    for (const f of files) fs.utimesSync(f, now, now);
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W4 touch-no-content-change', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
  }

  // ---- W5: config change (new thresholds → fpHash changes → full invalidation) ----
  {
    writeConfig({
      thresholds: {
        magicNumberMin: 3, duplicateLiteralThreshold: 2, hardcodedStringMinLength: 4,
        fileLinesWarn: 300, fileLinesFail: 600, fileFunctionsWarn: 10,
        complexityWarn: 6, complexityFail: 9,
      },
    });
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W5 config-change', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
    writeConfig(); // restore
  }

  // ---- W6: parser switch (oxc — cache key distinguishes parser) ----
  {
    const f = await freshScan({ parser: 'oxc' });
    const w = await warmScan({ parser: 'oxc' });
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W6 parser-switch-oxc', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
  }

  // ---- W7: customAnalyzer (L2 disabled by default; output still byte-equal) ----
  {
    writeConfig({
      analyzers: {
        constants: { enabled: true },
        'large-file': { enabled: true },
        complexity: { enabled: true },
        'no-console': { enabled: true },
      },
      customAnalyzers: [
        { name: 'no-console', module: path.join(SAMPLES, 'analyzers', 'noConsole.js'), enabled: true, options: { severity: 'warning', allowed: ['error'] } },
      ],
    });
    const f = await freshScan();
    const w = await warmScan();
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W7 custom-analyzer-l2-disabled', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
    writeConfig(); // restore
  }

  // ---- W8: daemon crash → warm degrades to cold (daemon:'auto' never auto-starts) ----
  {
    daemonStop(CORPUS);
    const f = await freshScan();
    const w = await scanWarm({
      root: CORPUS,
      configFile: CORPUS_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'auto', // probe only — daemon is dead → degrade to cold
      cache: true,
      cacheDir: CACHE_DIR,
    });
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W8 daemon-crash-degrade', eq && w.stats.daemonUsed === false, `daemonUsed=${w.stats.daemonUsed} cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
  }

  // ---- W9: rust corpus (rust cache-key path) ----
  {
    const f = await scan({ root: RUST_CORPUS, configFile: RUST_CFG, format: 'json', logLevel: 'silent' });
    const w = await scanWarm({
      root: RUST_CORPUS,
      configFile: RUST_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'on',
      cache: true,
      cacheDir: CACHE_DIR_RUST,
    });
    const eq = JSON.stringify(normalize(f)) === JSON.stringify(normalize(w.report));
    check('W9 rust-corpus', eq && w.stats.daemonUsed === true, `cacheHit=${w.stats.cacheHit} analyzed=${w.stats.analyzed}`);
  }

  daemonStop(CORPUS);
  daemonStop(RUST_CORPUS);

  console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nALL WARM SCENARIOS PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  try {
    daemonStop(CORPUS);
    daemonStop(RUST_CORPUS);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
