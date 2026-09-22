#!/usr/bin/env node
/**
 * Module: Verification Harness — Single-Pass AST Multiplexing Equivalence Gate
 * File Path: scripts/validate-equivalence.js
 * Architecture Role: Behavioral lock for the refactor: normalizes scan() reports from the
 *   current dist build and compares them byte-for-byte with committed golden baselines.
 * Dependencies & Triggers: Requires scan from ../dist/api plus node fs/path; reads samples/
 *   (default and custom configs), the generated scripts/.corpus TS corpus, scripts/.rust-corpus
 *   and scripts/baselines; run manually/CI, or with --update to recapture goldens.
 * Responsibilities: Materializes the TS and Rust corpora plus configs (including the
 *   gitignored fixture and the custom no-console analyzer used by samples); runs the scenario
 *   matrix samples-default/custom, corpus-inproc/workers, rust-inproc/workers and three oxc
 *   parser runs compared against the shared TS goldens; normalizes reports to
 *   id/analyzer/rule/severity/message/location/detail plus metrics, sorted by id/file; writes
 *   a per-scenario .actual.json file next to the script on mismatch; honors --update capture.
 * Exit Semantics & Design Rationale: Exits 1 if any scenario is missing a baseline or differs
 *   from it, 0 only when all match; --update captures then skips comparison. Byte-identical
 *   output is the oracle because the refactor must be behavior-preserving while the legacy
 *   mixed build used for capture is no longer runnable in the current tree.
 */

const { scan } = require('../dist/api');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, '.corpus');
const BASELINES = path.join(__dirname, 'baselines');
const SAMPLES = path.join(ROOT, 'samples');
const RUST_CORPUS = path.join(__dirname, '.rust-corpus');
const UPDATE = process.argv.includes('--update');

// ---- canonical corpus (must match the 26-file corpus that produced baselines) ----
const TEMPLATES = {
  magicNum: `export function clamp(v: number): number {
  if (v > 100) return 100;
  if (v < -100) return -100;
  return v;
}
/** Exported numeric boundary used by the magic-number fixture. */\
export const LIMIT = 100;
/** Exported scoring helper that repeats 100 for duplicate-literal detection. */\
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
/** Exported no-argument helper returning the repeated hardcoded string. */\
export function bye(): string {
  return 'hello world';
}
`,
  i18n: `function t(s: string): string { return s; }
/** Exported page helper that concatenates two i18n strings through t(). */\
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
  w(
    'src/legacy.js',
    `function compute(a, b) {
  if (a > 5) { return b * 100; }
  return a + 100;
}
console.log('legacy start');
const NAME = 'legacy name';
module.exports = { compute };
`,
  );
  w(
    'ignored/skip.ts',
    `export const SECRET = 'should not be scanned';
/** Exported fixture in an ignored directory; proves gitignore excludes it. */\
export function hidden(): number { return 999; }
`,
  );
  w('.gitignore', 'ignored/\n');
  const config = {
    $schema: './config.schema.json',
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'],
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
      'no-console': { enabled: true, options: { severity: 'warning', allowed: ['error'] } },
    },
    customAnalyzers: [
      {
        name: 'no-console',
        module: path.join(SAMPLES, 'analyzers', 'noConsole.js'),
        enabled: true,
        signals: ['LITERAL'],
        track: 'fast',
        options: { severity: 'warning', allowed: ['error'] },
      },
    ],
    logLevel: 'info',
    workers: 1,
    respectGitignore: true,
    failOnAnalyzerError: false,
  };
  w('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

// ---- Rust corpus (covers the same analyzer scenarios through the Rust adapter) ----
const RUST_TEMPLATES = {
  magic: `pub fn clamp(v: i32) -> i32 {
    if v > 100 { return 100; }
    if v < -100 { return -100; }
    v
}

pub const LIMIT: i32 = 100;

/** Public Rust scorer that repeats 100 for duplicate-literal coverage. */\
pub fn rate(x: i32) -> i32 {
    x * 100 + 100 - 100
}
`,
  greet: `pub fn greet(name: &str) -> String {
    let msg = "hello world";
    println!("{} {}", msg, name);
    format!("{} {}", msg, name)
}

/** Public Rust helper returning the shared hardcoded greeting. */\
pub fn bye() -> String {
    "hello world".to_string()
}
`,
  order: `pub struct Order {
    pub id: u64,
    pub total: i64,
}

impl Order {
    /** Constructs an Order with the given id and total for the method fixtures. */\
    pub fn new(id: u64, total: i64) -> Self {
        Order { id, total }
    }

    /** Applies a percentage-based discount to the order total for complexity coverage. */\
    pub fn apply_discount(&self, rate: i64) -> i64 {
        if rate > 50 { return self.total / 2; }
        if rate > 20 { return self.total - rate; }
        self.total
    }

    /** Classifies the order total relative to a threshold as large, ok, or empty. */\
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

/** Public nesting-heavy helper that exercises Rust complexity measurement. */\
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
      magicNumberMin: 2,
      duplicateLiteralThreshold: 2,
      hardcodedStringMinLength: 3,
      fileLinesWarn: 40,
      fileLinesFail: 80,
      fileFunctionsWarn: 6,
      complexityWarn: 5,
      complexityFail: 10,
    },
    analyzers: {
      constants: { enabled: true },
      'large-file': { enabled: true },
      complexity: { enabled: true },
    },
    logLevel: 'silent',
    workers: 1,
    respectGitignore: false,
    failOnAnalyzerError: true,
  };
  w('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

function normalize(r) {
  const issues = r.issues
    .map((x) => ({
      id: x.id,
      analyzer: x.analyzer,
      rule: x.rule,
      severity: x.severity,
      message: x.message,
      location: x.location,
      detail: x.detail,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics
    .map((m) => ({ ...m }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return {
    filesScanned: r.summary.filesScanned,
    issuesTotal: r.summary.issuesTotal,
    byAnalyzer: r.summary.byAnalyzer,
    bySeverity: r.summary.bySeverity,
    issues,
    fileMetrics,
  };
}

const SCENARIOS = [
  {
    name: 'samples-default',
    root: SAMPLES,
    config: path.join(SAMPLES, 'auto-refactor.config.json'),
    workers: 1,
  },
  {
    name: 'samples-custom',
    root: SAMPLES,
    config: path.join(SAMPLES, 'auto-refactor.custom.config.json'),
    workers: 1,
  },
  {
    name: 'corpus-inproc',
    root: CORPUS,
    config: path.join(CORPUS, 'auto-refactor.config.json'),
    workers: 1,
  },
  {
    name: 'corpus-workers',
    root: CORPUS,
    config: path.join(CORPUS, 'auto-refactor.config.json'),
    workers: 4,
  },
  {
    name: 'rust-inproc',
    root: RUST_CORPUS,
    config: path.join(RUST_CORPUS, 'auto-refactor.config.json'),
    workers: 1,
  },
  {
    name: 'rust-workers',
    root: RUST_CORPUS,
    config: path.join(RUST_CORPUS, 'auto-refactor.config.json'),
    workers: 4,
  },
  // oxc parser scenarios: the oxc adapter must produce byte-identical output to the
  // TypeScript adapter, so they compare against the EXISTING TS baselines (no --update
  // needed; the `baseline` field points at the shared golden file). Any difference means
  // a bug in the oxc adapter mapping/compensation.
  {
    name: 'samples-default-oxc',
    root: SAMPLES,
    config: path.join(SAMPLES, 'auto-refactor.config.json'),
    workers: 1,
    parser: 'oxc',
    baseline: 'samples-default',
  },
  {
    name: 'corpus-inproc-oxc',
    root: CORPUS,
    config: path.join(CORPUS, 'auto-refactor.config.json'),
    workers: 1,
    parser: 'oxc',
    baseline: 'corpus-inproc',
  },
  {
    name: 'corpus-workers-oxc',
    root: CORPUS,
    config: path.join(CORPUS, 'auto-refactor.config.json'),
    workers: 4,
    parser: 'oxc',
    baseline: 'corpus-workers',
  },
];

/**
 * Run every equivalence scenario and exit non-zero if any baseline is missing or drifts.
 *
 * The driver is deliberately single-threaded: each `await scan(...)` settles before the next
 * scenario starts, so baseline writes and comparisons never race with a later scan.
 */
async function main() {
  writeCorpus();
  writeRustCorpus();
  let failed = 0;
  for (const s of SCENARIOS) {
    const r = await scan({
      root: s.root,
      configFile: s.config,
      workers: s.workers,
      format: 'json',
      logLevel: 'silent',
      parser: s.parser,
    });
    const json = JSON.stringify(normalize(r), null, 2);
    const bp = path.join(BASELINES, (s.baseline || s.name) + '.json');
    if (UPDATE) {
      fs.writeFileSync(bp, json);
      console.log(`captured ${s.name} (issues=${r.summary.issuesTotal})`);
      continue;
    }
    if (!fs.existsSync(bp)) {
      console.error(`NO BASELINE ${s.name} — run with --update first`);
      failed++;
      continue;
    }
    if (fs.readFileSync(bp, 'utf8') === json) {
      console.log(
        `PASS ${s.name}  files=${r.summary.filesScanned} issues=${r.summary.issuesTotal}`,
      );
    } else {
      failed++;
      const actual = path.join(__dirname, `.${s.name}.actual.json`);
      fs.writeFileSync(actual, json);
      console.error(`FAIL ${s.name} — differs from baseline. Inspect: ${actual}`);
    }
  }
  console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nALL SCENARIOS PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
