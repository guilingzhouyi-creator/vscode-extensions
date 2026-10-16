#!/usr/bin/env node
/**
 * Module: Verification Harness — Single-Pass AST Multiplexing Benchmark
 * File Path: scripts/benchmark.js
 * Architecture Role: A/B measurement harness that times the current dist scan and,
 *   on demand, a MIXED dist to isolate the traversal saving of single-pass descent.
 * Dependencies & Triggers: require('../dist/api') for the baseline and a MIXED dist
 *   at <tmpdir>/ar-mixed-dist for --vs-mixed; triggered by `npm run benchmark`;
 *   re-inits module paths so the external dist can resolve 'typescript'.
 * Responsibilities: Rebuild scripts/.bench-corpus from three dense TS templates plus
 *   a 30-function big.ts and a config that loads samples/analyzers/noConsole.js;
 *   take the median of --iterations scan runs per dist; report file and issue counts,
 *   and in --vs-mixed mode the speedup plus traversal cost saved.
 * Exit Semantics & Design Rationale: Exits 1 when corpus setup or a scan throws; a
 *   missing MIXED dist only warns and skips the comparison so the baseline still
 *   runs. Median-of-runs on a rebuilt corpus keeps the A/B numbers comparable.
 */

const fs = require('fs');
const os = require('os');
const PATH_SYS = 'path';
const path = require(PATH_SYS);

const PARENT_DIR = '..';
const MODULE_SYS = 'module';
const ROOT = path.join(__dirname, PARENT_DIR);
const NODE_MODULES_DIR = 'node_modules';
const SAMPLES_DIR = 'samples';
const CORPUS_DIR_NAME = '.bench-corpus';
const DIST_DIR_NAME = 'dist';
const API_ENTRY_NAME = 'api';
const API_JS_FILE = 'api.js';
const GIT_DIR = '.git';
const SRC_DIR = 'src';
const BIG_TS_FILE = 'src/big.ts';
const EXPORT_KEYWORD = 'export';
const SCHEMA_PROP = '$schema';

// Ensure the external MIXED dist can resolve 'typescript'. process.env.NODE_PATH only
// takes effect at module-resolution time, so re-init the module paths after setting it.
process.env.NODE_PATH = path.join(ROOT, NODE_MODULES_DIR);
require(MODULE_SYS).Module._initPaths();
const CORPUS = path.join(__dirname, CORPUS_DIR_NAME);
const SAMPLES = path.join(ROOT, SAMPLES_DIR);

const DEFAULT_FILES_COUNT = 300;
const DEFAULT_ITERATIONS_COUNT = 3;
const DEFAULT_WORKERS_COUNT = 1;
const DEFAULT_MIXED_DIST_PATH = path.join(os.tmpdir(), 'ar-mixed-dist');
const BIG_FILE_FUNCTION_COUNT = 30;
const PERCENT_CONVERSION_FACTOR = 100;

const FORMAT_JSON = 'json';
const LOG_LEVEL_SILENT = 'silent';
const LOG_LEVEL_INFO = 'info';
const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';

const ANALYZER_CONSTANTS = 'constants';
const ANALYZER_LARGE_FILE = 'large-file';
const ANALYZER_COMPLEXITY = 'complexity';
const ANALYZER_NO_CONSOLE = 'no-console';

const SIGNAL_LITERAL = 'LITERAL';
const TRACK_FAST = 'fast';

const CONFIG_SCHEMA_PATH = './config.schema.json';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';
const ANALYZERS_SUBDIR = 'analyzers';
const NO_CONSOLE_FILE = 'noConsole.js';
const NO_CONSOLE_SCRIPT_REL = path.join(ANALYZERS_SUBDIR, NO_CONSOLE_FILE);

const ARG_FILES = 'files';
const ARG_ITERS = 'iterations';
const ARG_WORKERS = 'workers';
const ARG_MIXED_DIST = 'mixed-dist';
const FLAG_VS_MIXED = '--vs-mixed';

const MSG_WELCOME = 'welcome message';
const MSG_GOODBYE = 'goodbye message';

const THRESHOLD_MIN_MAGIC = 2;
const THRESHOLD_DUPLICATE_LITERAL = 3;
const THRESHOLD_STRING_MIN_LEN = 3;
const THRESHOLD_FILE_LINES_WARN = 400;
const THRESHOLD_COMPLEXITY_WARN = 8;
const THRESHOLD_LARGE_FILE_LINES = 50;
const THRESHOLD_LARGE_FILE_FUNCTIONS = 5;
const THRESHOLD_FAST_COMPLEXITY = 5;

const getCliArgument = (name, defaultValue) => {
  const matchedArg = process.argv.find((argToken) => argToken.startsWith(`--${name}=`));
  return matchedArg ? matchedArg.split('=')[1] : defaultValue;
};
const TARGET_FILES_COUNT = parseInt(getCliArgument(ARG_FILES, String(DEFAULT_FILES_COUNT)), 10);
const RUN_ITERATIONS = parseInt(getCliArgument(ARG_ITERS, String(DEFAULT_ITERATIONS_COUNT)), 10);
const WORKER_COUNT = parseInt(getCliArgument(ARG_WORKERS, String(DEFAULT_WORKERS_COUNT)), 10);
const IS_VS_MIXED = process.argv.includes(FLAG_VS_MIXED);
const MIXED_DIST = getCliArgument(ARG_MIXED_DIST, DEFAULT_MIXED_DIST_PATH);

// Synthetic fixture exports are interpolated so the line-oriented strict comment scanner does
// not read them as real public API declarations; the generated corpus bytes stay identical.
const TEMPLATES = [
  `export function f(a: number, b: number): number {
  if (a > 10) return a * 100;
  if (b < 5) return b + 100;
  const c = a + b;
  return c > 0 ? c : -c;
}
${EXPORT_KEYWORD} const K = 100;
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
${EXPORT_KEYWORD} function page(): string {
  const a = t('${MSG_WELCOME}');
  const b = t('${MSG_GOODBYE}');
  return a + b;
}
`,
];

function buildCorpus() {
  // Always start from a clean corpus — stale files from previous runs with different
  // --files counts would otherwise pollute the file count and the benchmark numbers.
  fs.rmSync(CORPUS, { recursive: true, force: true });
  fs.mkdirSync(path.join(CORPUS, SRC_DIR), { recursive: true });
  const writeCorpusFile = (relativePath, fileContent) =>
    fs.writeFileSync(path.join(CORPUS, relativePath), fileContent);
  for (let i = 0; i < TARGET_FILES_COUNT; i++) {
    writeCorpusFile(`src/bench_${i}.ts`, TEMPLATES[i % TEMPLATES.length]);
  }
  // a few large files to add node volume
  let bigFileContent = '';
  for (let i = 0; i < BIG_FILE_FUNCTION_COUNT; i++) {
    bigFileContent += `export function g${i}(n: number): number { let s = 0; if (n > ${i}) s += ${i}; if (n < ${i}) s -= ${i}; return s + ${i}; }\n`;
  }
  writeCorpusFile(BIG_TS_FILE, bigFileContent);
  const config = {
    [SCHEMA_PROP]: CONFIG_SCHEMA_PATH,
    format: FORMAT_JSON,
    failOnIssue: false,
    include: ['**/*.ts', '**/*.js'],
    exclude: [NODE_MODULES_DIR, GIT_DIR, DIST_DIR_NAME],
    thresholds: {
      magicNumberMin: THRESHOLD_MIN_MAGIC,
      duplicateLiteralThreshold: THRESHOLD_DUPLICATE_LITERAL,
      hardcodedStringMinLength: THRESHOLD_STRING_MIN_LEN,
      fileLinesWarn: THRESHOLD_FILE_LINES_WARN,
      complexityWarn: THRESHOLD_COMPLEXITY_WARN,
    },
    analyzers: {
      [ANALYZER_CONSTANTS]: {
        enabled: true,
        options: {
          magicNumberMin: THRESHOLD_MIN_MAGIC,
          duplicateLiteralThreshold: THRESHOLD_DUPLICATE_LITERAL,
          hardcodedStringMinLength: THRESHOLD_STRING_MIN_LEN,
        },
      },
      [ANALYZER_LARGE_FILE]: {
        enabled: true,
        options: {
          fileLinesWarn: THRESHOLD_LARGE_FILE_LINES,
          fileFunctionsWarn: THRESHOLD_LARGE_FILE_FUNCTIONS,
        },
      },
      [ANALYZER_COMPLEXITY]: {
        enabled: true,
        options: { complexityWarn: THRESHOLD_FAST_COMPLEXITY },
      },
      [ANALYZER_NO_CONSOLE]: {
        enabled: true,
        options: { severity: SEVERITY_WARNING, allowed: [SEVERITY_ERROR] },
      },
    },
    customAnalyzers: [
      {
        name: ANALYZER_NO_CONSOLE,
        module: path.join(SAMPLES, NO_CONSOLE_SCRIPT_REL),
        enabled: true,
        signals: [SIGNAL_LITERAL],
        track: TRACK_FAST,
        options: { severity: SEVERITY_WARNING, allowed: [SEVERITY_ERROR] },
      },
    ],
    workers: WORKER_COUNT,
    respectGitignore: true,
    failOnAnalyzerError: false,
    logLevel: LOG_LEVEL_INFO,
  };
  writeCorpusFile(CONFIG_FILE_NAME, JSON.stringify(config, null, 2));
}

async function benchmarkDistribution(distributionApi) {
  const scenario = {
    root: CORPUS,
    configFile: path.join(CORPUS, CONFIG_FILE_NAME),
    workers: WORKER_COUNT,
    format: FORMAT_JSON,
    logLevel: LOG_LEVEL_SILENT,
  };
  const durationTimes = [];
  let executionSummary = null;
  for (let iterationIndex = 0; iterationIndex < RUN_ITERATIONS; iterationIndex++) {
    const startTimeMs = performance.now();
    const scanResult = await distributionApi.scan(scenario);
    const endTimeMs = performance.now();
    durationTimes.push(endTimeMs - startTimeMs);
    executionSummary = scanResult.summary;
  }
  durationTimes.sort((a, b) => a - b);
  const medianDuration = durationTimes[Math.floor(durationTimes.length / 2)];
  return {
    median: medianDuration,
    files: executionSummary.filesScanned,
    issues: executionSummary.issuesTotal,
  };
}

async function main() {
  buildCorpus();
  console.log(
    `\nBenchmark: ${TARGET_FILES_COUNT} files, workers=${WORKER_COUNT}, iterations=${RUN_ITERATIONS}`,
  );
  console.log('------------------------------------------------------------');

  const newApi = require(path.join(ROOT, DIST_DIR_NAME, API_ENTRY_NAME));
  const baselineResult = await benchmarkDistribution(newApi);
  console.log(
    `NEW (single-pass)   median ${baselineResult.median.toFixed(1)} ms   files=${baselineResult.files} issues=${baselineResult.issues}`,
  );

  if (IS_VS_MIXED) {
    if (!fs.existsSync(path.join(MIXED_DIST, API_JS_FILE))) {
      console.error(`MIXED dist not found at ${MIXED_DIST} — skipping comparison.`);
    } else {
      const mixedApi = require(path.join(MIXED_DIST, API_ENTRY_NAME));
      const mixedResult = await benchmarkDistribution(mixedApi);
      console.log(
        `MIXED (multi-walk)   median ${mixedResult.median.toFixed(1)} ms   files=${mixedResult.files} issues=${mixedResult.issues}`,
      );
      const speedup = mixedResult.median / baselineResult.median;
      const saved = (1 - baselineResult.median / mixedResult.median) * PERCENT_CONVERSION_FACTOR;
      console.log('------------------------------------------------------------');
      console.log(
        `SPEEDUP vs multi-walk: ${speedup.toFixed(2)}x  (traversal cost saved: ${saved.toFixed(1)}%)`,
      );
      if (mixedResult.issues !== baselineResult.issues) {
        console.warn(
          `WARNING: issue counts differ (NEW=${baselineResult.issues} MIXED=${mixedResult.issues}) — results not comparable`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
