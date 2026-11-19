#!/usr/bin/env node
/**
 * Module: Verification Harness — Warm-Scan Equivalence Regression
 * File Path: scripts/validate-warm.js
 * Architecture Role: End-to-end regression gate comparing the warm path (daemon + two-level
 *                     cache via scanWarm) with the fresh path (scan, no daemon, no cache)
 *                     across canonical cache-equivalence scenarios; documented in
 *                     docs/01-architecture/ 02-pipeline-and-caching.md Part D.
 * Dependencies & Triggers: Run manually via `node scripts/validate-warm.js` or from CI after
 *                     `npm run build`; imports scan/scanWarm from ../dist/api plus
 *                     child_process.spawnSync, fs, and path, and reuses the corpus templates
 *                     and normalize() conventions of validate-equivalence.js.
 * Responsibilities: Regenerate TS/JS and Rust corpora with configs, clear stale caches and
 *                     daemons, drive cold-start/rescan/partial-change/touch/config-change/
 *                     parser-switch/custom-analyzer/daemon-crash/rust scenarios, normalize each
 *                     report (drop generatedAt, durationMs and config; sort issues by id and
 *                     fileMetrics by file), and assert byte-identical output while requiring
 *                     stats.daemonUsed so a silent degrade to cold cannot fake a pass.
 * Exit Semantics & Design Rationale: Exits 0 only when every scenario passes and 1 otherwise;
 *                     thrown errors are logged after a best-effort daemon stop and also exit 1
 *                     for CI. Byte-identical warm vs fresh output is the property that makes
 *                     caching safe, and asserting daemonUsed prevents cached results from
 *                     masking a broken daemon path.
 */

const { scan, scanWarm } = require('../dist/api');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reportFailure } = require('./common/test-runner-harness');
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, '.corpus');
const RUST_CORPUS = path.join(__dirname, '.rust-corpus');
const SAMPLES = path.join(ROOT, 'samples');
const DAEMON_HANDSHAKE_RETRY_DELAY_MS = 100;

const DEFAULT_SCRATCH_DIR = process.env.AUTO_REFACTOR_TMPDIR || path.join(os.tmpdir(), 'ar-temp');
try {
  fs.mkdirSync(DEFAULT_SCRATCH_DIR, { recursive: true });
} catch {
  // best-effort
}

process.env.AUTO_REFACTOR_REGISTRY_DIR ||= path.join(DEFAULT_SCRATCH_DIR, 'ar-warm-registry');
try {
  fs.mkdirSync(process.env.AUTO_REFACTOR_REGISTRY_DIR, { recursive: true });
} catch {
  // best-effort
}

const CACHE_DIR = path.join(DEFAULT_SCRATCH_DIR, 'ar-warm-validate-cache');
const CACHE_DIR_RUST = path.join(DEFAULT_SCRATCH_DIR, 'ar-warm-validate-cache-rust');
const CORPUS_CFG = path.join(CORPUS, 'auto-refactor.config.json');
const RUST_CFG = path.join(RUST_CORPUS, 'auto-refactor.config.json');

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

const DEFAULT_RUST_THRESHOLDS = Object.freeze({
  magicNumberMin: 2,
  duplicateLiteralThreshold: 2,
  hardcodedStringMinLength: 3,
  fileLinesWarn: 40,
  fileLinesFail: 80,
  fileFunctionsWarn: 6,
  complexityWarn: 5,
  complexityFail: 10,
});

// ---- canonical corpus (same templates as validate-equivalence.js) ----
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
  const writeCorpusFile = (relativeFilePath, fileContent) =>
    fs.writeFileSync(path.join(CORPUS, relativeFilePath), fileContent);
  for (const [name, content] of Object.entries(TEMPLATES)) {
    for (let k = 0; k < 4; k++) writeCorpusFile(`src/unit_${name}_${k}.ts`, content);
  }
  let bigFileContent = '';
  for (let n = 0; n < 12; n++) {
    bigFileContent += `export function fn${n}(x: number): number {\n  let s = 0;\n  if (x > ${n}) s += ${n};\n  if (x < ${n}) s -= ${n};\n  return s + ${n};\n}\n`;
  }
  bigFileContent += `export const TAG = 'shared token';\n`;
  for (let n = 0; n < 8; n++) bigFileContent += `export const TOKEN${n} = 'shared token';\n`;
  writeCorpusFile('src/bigfile.ts', bigFileContent);
  writeCorpusFile(
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
  writeCorpusFile('ignored/skip.ts', `export const SECRET = 'should not be scanned';\n`);
  writeCorpusFile('.gitignore', 'ignored/\n');
}

const DEFAULT_CORE_ANALYZERS = Object.freeze({
  constants: { enabled: true },
  'large-file': { enabled: true },
  complexity: { enabled: true },
});

// Base configuration for standard warm-cache scenarios. Overrides are passed per test scenario.
function createBaseConfig(overrides = {}) {
  return {
    $schema: './config.schema.json',
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['node_modules', '.git', 'dist', 'build', 'out', 'coverage'],
    thresholds: DEFAULT_WARM_THRESHOLDS,
    analyzers: DEFAULT_CORE_ANALYZERS,
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 1,
    respectGitignore: true,
    failOnAnalyzerError: false,
    ...overrides,
  };
}

function writeConfigFile(overrides) {
  fs.writeFileSync(CORPUS_CFG, JSON.stringify(createBaseConfig(overrides), null, 2));
}

// ---- Rust corpus (same as validate-equivalence.js) ----
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
  const writeRustFile = (relativeFilePath, fileContent) =>
    fs.writeFileSync(path.join(RUST_CORPUS, relativeFilePath), fileContent);
  for (const [name, content] of Object.entries(RUST_TEMPLATES)) {
    writeRustFile(`src/${name}.rs`, content);
  }
  const config = {
    format: 'json',
    failOnIssue: false,
    include: ['**/*.rs'],
    exclude: ['node_modules', 'target', '.git', 'dist'],
    thresholds: DEFAULT_RUST_THRESHOLDS,
    analyzers: DEFAULT_CORE_ANALYZERS,
    customAnalyzers: [],
    logLevel: 'silent',
    workers: 1,
    respectGitignore: false,
    failOnAnalyzerError: true,
  };
  writeRustFile('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

/** Same normalize as validate-equivalence.js (excludes runtime/config fields). */
function normalizeReport(report) {
  const issues = report.issues
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
  const fileMetrics = report.fileMetrics
    .map((m) => ({ ...m }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return {
    filesScanned: report.summary.filesScanned,
    issuesTotal: report.summary.issuesTotal,
    byAnalyzer: report.summary.byAnalyzer,
    bySeverity: report.summary.bySeverity,
    issues,
    fileMetrics,
  };
}

function removeDirectoryWithRetry(targetPath) {
  try {
    rmSyncWithRetry(targetPath, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(
        targetPath,
        path.join(DEFAULT_SCRATCH_DIR, `ar-stale-${path.basename(targetPath)}-${Date.now()}`),
      );
    } catch {
      /* ignore */
    }
  }
}

function stopDaemonSafely(root) {
  try {
    spawnSync(
      process.execPath,
      [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'stop', '--root', root],
      { stdio: 'ignore' },
    );
  } catch {
    /* best-effort */
  }
}

async function runRustCorpusScenario(checkReporter) {
  const [freshReport, warmReport] = await Promise.all([
    scan({
      root: RUST_CORPUS,
      configFile: RUST_CFG,
      format: 'json',
      logLevel: 'silent',
    }),
    scanWarm({
      root: RUST_CORPUS,
      configFile: RUST_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'on',
      cache: true,
      cacheDir: CACHE_DIR_RUST,
    }),
  ]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-rust-corpus',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
  stopDaemonSafely(RUST_CORPUS);
}

async function runColdStartScenario(freshScan, warmScan, checkReporter) {
  const freshReport = await freshScan();
  let warmReport = await warmScan();
  if (!warmReport.stats.daemonUsed) {
    await new Promise((resolve) => setTimeout(resolve, DAEMON_HANDSHAKE_RETRY_DELAY_MS));
    warmReport = await warmScan();
  }
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-cold-start-empty-cache',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `warm analyzed=${warmReport.stats.analyzed} daemonUsed=${warmReport.stats.daemonUsed}`,
  );
}

async function runImmediateRescanScenario(freshScan, warmScan, checkReporter) {
  const freshReport = await freshScan();
  const warmReport = await warmScan();
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-immediate-rescan',
    isReportEqual && warmReport.stats.daemonUsed === true && warmReport.stats.cacheHit > 0,
    `cacheHit=${warmReport.stats.cacheHit}/${warmReport.stats.cacheTotal} analyzed=${warmReport.stats.analyzed}`,
  );
}

async function runPartialChangeScenario(freshScan, warmScan, checkReporter) {
  const modifications = [
    [
      'src/unit_magicNum_0.ts',
      'export function clamp(v: number): number {\n  if (v > 200) return 200;\n  if (v < -200) return -200;\n  return v + 1;\n}\n',
    ],
    [
      'src/unit_hardStr_1.ts',
      'export function greet(name: string): string {\n  const msg = "hello warm world";\n  return msg + name;\n}\n',
    ],
    [
      'src/unit_cls_2.ts',
      'export class Widget {\n  private count = 0;\n  inc(): void { this.count = this.count + 2; }\n  get(): number { return this.count; }\n}\n',
    ],
  ];
  for (const [relPath, content] of modifications) {
    fs.writeFileSync(path.join(CORPUS, relPath), content);
  }
  const [freshReport, warmReport] = await Promise.all([freshScan(), warmScan()]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-partial-change',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
  writeCorpus();
}

async function runTouchScenario(freshScan, warmScan, checkReporter) {
  const files = fs
    .readdirSync(path.join(CORPUS, 'src'))
    .map((name) => path.join(CORPUS, 'src', name));
  const currentTime = new Date();
  for (const file of files) fs.utimesSync(file, currentTime, currentTime);
  const [freshReport, warmReport] = await Promise.all([freshScan(), warmScan()]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-touch-no-content-change',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
}

async function runConfigChangeScenario(freshScan, warmScan, checkReporter) {
  writeConfigFile({
    thresholds: {
      magicNumberMin: 3,
      duplicateLiteralThreshold: 2,
      hardcodedStringMinLength: 4,
      fileLinesWarn: 300,
      fileLinesFail: 600,
      fileFunctionsWarn: 10,
      complexityWarn: 6,
      complexityFail: 9,
    },
  });
  const [freshReport, warmReport] = await Promise.all([freshScan(), warmScan()]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-config-change',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
  writeConfigFile();
}

async function runParserSwitchScenario(freshScan, warmScan, checkReporter) {
  const [freshReport, warmReport] = await Promise.all([
    freshScan({ parser: 'oxc' }),
    warmScan({ parser: 'oxc' }),
  ]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-parser-switch-oxc',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
}

async function runCustomAnalyzerScenario(freshScan, warmScan, checkReporter) {
  writeConfigFile({
    analyzers: {
      constants: { enabled: true },
      'large-file': { enabled: true },
      complexity: { enabled: true },
      'no-console': { enabled: true },
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
  });
  const [freshReport, warmReport] = await Promise.all([freshScan(), warmScan()]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-custom-analyzer-l2-disabled',
    isReportEqual && warmReport.stats.daemonUsed === true,
    `cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
  writeConfigFile();
}

async function runDaemonCrashDegradeScenario(freshScan, checkReporter) {
  stopDaemonSafely(CORPUS);
  const [freshReport, warmReport] = await Promise.all([
    freshScan(),
    scanWarm({
      root: CORPUS,
      configFile: CORPUS_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'auto',
      cache: true,
      cacheDir: CACHE_DIR,
    }),
  ]);
  const isReportEqual =
    JSON.stringify(normalizeReport(freshReport)) ===
    JSON.stringify(normalizeReport(warmReport.report));
  checkReporter(
    'scenario-daemon-crash-degrade',
    isReportEqual && warmReport.stats.daemonUsed === false,
    `daemonUsed=${warmReport.stats.daemonUsed} cacheHit=${warmReport.stats.cacheHit} analyzed=${warmReport.stats.analyzed}`,
  );
}

/**
 * Drive every warm-vs-fresh scenario and exit non-zero if any comparison fails.
 */
async function main() {
  removeDirectoryWithRetry(CORPUS);
  removeDirectoryWithRetry(RUST_CORPUS);
  removeDirectoryWithRetry(CACHE_DIR);
  removeDirectoryWithRetry(CACHE_DIR_RUST);
  writeCorpus();
  writeRustCorpus();
  writeConfigFile();
  stopDaemonSafely(CORPUS);
  stopDaemonSafely(RUST_CORPUS);

  let failureCount = 0;
  const checkReporter = (scenarioName, isConditionMet, extraDetails) => {
    if (isConditionMet) {
      console.log(`✔ PASS  ${scenarioName}${extraDetails ? `  ${extraDetails}` : ''}`);
    } else {
      failureCount++;
      console.error(`✖ BLOCK  ${scenarioName}${extraDetails ? `  ${extraDetails}` : ''}`);
    }
  };

  const freshScan = (options = {}) =>
    scan({ root: CORPUS, configFile: CORPUS_CFG, format: 'json', logLevel: 'silent', ...options });
  const warmScan = (options = {}) =>
    scanWarm({
      root: CORPUS,
      configFile: CORPUS_CFG,
      format: 'json',
      logLevel: 'silent',
      daemon: 'on',
      cache: true,
      cacheDir: CACHE_DIR,
      ...options,
    });

  const rustPromise = runRustCorpusScenario(checkReporter);

  await runColdStartScenario(freshScan, warmScan, checkReporter);
  await runImmediateRescanScenario(freshScan, warmScan, checkReporter);
  await runPartialChangeScenario(freshScan, warmScan, checkReporter);
  await runTouchScenario(freshScan, warmScan, checkReporter);
  await runConfigChangeScenario(freshScan, warmScan, checkReporter);
  await runParserSwitchScenario(freshScan, warmScan, checkReporter);
  await runCustomAnalyzerScenario(freshScan, warmScan, checkReporter);
  await runDaemonCrashDegradeScenario(freshScan, checkReporter);

  await rustPromise;

  cleanupAllCorpora();

  console.log(failureCount ? `\n${failureCount} scenario(s) FAILED` : '\nALL WARM SCENARIOS PASS');
  process.exit(failureCount ? 1 : 0);
}

function cleanupAllCorpora() {
  stopDaemonSafely(CORPUS);
  stopDaemonSafely(RUST_CORPUS);
  removeDirectoryWithRetry(CORPUS);
  removeDirectoryWithRetry(RUST_CORPUS);
  removeDirectoryWithRetry(CACHE_DIR);
  removeDirectoryWithRetry(CACHE_DIR_RUST);
}

main().catch(reportFailure('validate-warm.js', cleanupAllCorpora));
