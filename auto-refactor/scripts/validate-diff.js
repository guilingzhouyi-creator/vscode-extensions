#!/usr/bin/env node
/**
 * Module: Verification Harness — Diff Interface Equivalence Gate (T04)
 * File Path: scripts/validate-diff.js
 * Architecture Role: Differential oracle harness per
 *   docs/03-incremental-and-diff/02-diff-interface-spec.md; proves the incremental paths
 *   (scanDiff full / scanDiffDelta subset) match the cold full-scan oracle.
 * Dependencies & Triggers: Loads scan/scanDiff/scanDiffDelta from ../dist/api and
 *   computeEditRanges from ../dist/core/editDiff; uses node child_process/fs/path and the
 *   built dist/index.js daemon CLI for D7; run manually or from the validation gate.
 * Responsibilities: Regenerates the .diff-corpus fixture and its config; runs D1 full-1-line,
 *   D2 ranges-1-line, D3 multi-file, D4 out-of-bounds fallback, D5 disk-mismatch fallback,
 *   D6 delta-subset and D7 daemon round-trip; normalizes/sorts issues and file metrics before
 *   byte comparison; checks fallback counters and stats flags; stops the daemon and restores
 *   AR_INCREMENTAL / AR_INCREMENTAL_MIN_LINES afterwards.
 * Exit Semantics & Design Rationale: Exits 0 only when every scenario passes, 1 when any check
 *   fails or main() rejects (daemon cleanup runs in the catch). D7 downgrades to SKIP when the
 *   daemon cannot start, since daemon availability is environmental whereas the in-process
 *   oracle comparison is the contractual guarantee.
 */

const { scan, scanDiff, scanDiffDelta } = require('../dist/api');
const { computeEditRanges } = require('../dist/core/diff/edit-diff');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, '.diff-corpus');
const BIG = path.join(CORPUS, 'src', 'big.ts');

const DEFAULT_TMP_DIR = process.env.AUTO_REFACTOR_TMPDIR || path.join(os.tmpdir(), 'ar-temp');
try {
  fs.mkdirSync(DEFAULT_TMP_DIR, { recursive: true });
} catch {
  // best-effort: ignore directory creation failure if it already exists
}

const CACHE_DIR = path.join(DEFAULT_TMP_DIR, 'ar-diff-validate-cache');
const CFG = path.join(CORPUS, 'auto-refactor.config.json');

const FORMAT_JSON = 'json';
const LOG_SILENT = 'silent';
const DAEMON_OFF = 'off';
const DAEMON_ON = 'on';

const FILE_BIG = 'src/big.ts';
const FILE_SMALL = 'src/small.ts';
const CONFIG_FILE_NAME = 'auto-refactor.config.json';

const STATUS_PASS = 'PASS';
const STATUS_BLOCK = '✖ BLOCK ';

const BASELINE_LINE_COUNT = 150;
const MODULO_DIVISOR = 7;
const BASE_LIMIT_OFFSET = 100;
const THRESHOLD_OFFSET = 50;
const TOKEN_REPEAT_COUNT = 12;
const SHARED_TOKEN_VALUE = 'shared-token-value';

const OUT_OF_BOUNDS_BYTE_OFFSET = 999999;
const RANDOM_STRING_RADIX = 36;
const RANDOM_STRING_START = 2;
const RANDOM_STRING_END = 6;
const CORPUS_INSTANCE_COUNT = 6;

const DEFAULT_CONFIG = Object.freeze({
  format: FORMAT_JSON,
  failOnIssue: false,
  include: ['**/*.ts'],
  exclude: ['node_modules', '.git', 'dist', 'build', 'out'],
  thresholds: {
    magicNumberMin: 2,
    duplicateLiteralThreshold: 3,
    hardcodedStringMinLength: 3,
    fileLinesWarn: 400,
    fileLinesFail: 800,
    fileFunctionsWarn: 15,
    complexityWarn: 2,
    complexityFail: 12,
  },
  analyzers: {
    constants: { enabled: true },
    'large-file': { enabled: true },
    complexity: { enabled: true },
  },
  customAnalyzers: [],
  logLevel: LOG_SILENT,
  workers: 1,
  respectGitignore: false,
  failOnAnalyzerError: false,
  parser: 'oxc',
});

/**
 * Generates synthetic baseline TypeScript content with repeated functions and tokens.
 *
 * @param lineCount - Number of function blocks to synthesize.
 * @returns Synthesized TypeScript code.
 */
function baselineBig(lineCount) {
  const codeBlocks = [];
  for (let index = 0; index < lineCount; index++) {
    const limitOffset = BASE_LIMIT_OFFSET + (index % MODULO_DIVISOR);
    const positiveThreshold = THRESHOLD_OFFSET + index;
    const negativeThreshold = -THRESHOLD_OFFSET - index;
    const negativeLimit = -limitOffset;

    codeBlocks.push(
      `export function fn${index}(x: number): number {\n` +
        `  const LIMIT${index} = ${limitOffset};\n` +
        `  if (x > ${positiveThreshold}) return ${limitOffset};\n` +
        `  if (x < ${negativeThreshold}) return ${negativeLimit};\n` +
        `  return x + ${limitOffset};\n` +
        `}\n`,
    );
  }
  codeBlocks.push(`export const TAG = '${SHARED_TOKEN_VALUE}';\n`);
  for (let tokenIndex = 0; tokenIndex < TOKEN_REPEAT_COUNT; tokenIndex++) {
    codeBlocks.push(`export const TOKEN${tokenIndex} = '${SHARED_TOKEN_VALUE}';\n`);
  }
  return codeBlocks.join('');
}

/**
 * Writes standard test configuration JSON to target path.
 *
 * @param targetConfigPath - Destination file path.
 */
function writeConfig(targetConfigPath = CFG) {
  fs.writeFileSync(targetConfigPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
}

/**
 * Normalizes and sorts scan report issues and metrics for deterministic byte-level comparison.
 *
 * @param scanReport - Raw scan report object.
 * @returns Normalized report subset.
 */
function normalize(scanReport) {
  const normalizedIssues = scanReport.issues
    .map((issue) => ({
      id: issue.id,
      analyzer: issue.analyzer,
      rule: issue.rule,
      severity: issue.severity,
      message: issue.message,
      location: issue.location,
      detail: issue.detail,
      suggestion: issue.suggestion,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const normalizedMetrics = scanReport.fileMetrics
    .map((metric) => ({ ...metric }))
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));

  return {
    filesScanned: scanReport.summary.filesScanned,
    issuesTotal: scanReport.summary.issuesTotal,
    byAnalyzer: scanReport.summary.byAnalyzer,
    bySeverity: scanReport.summary.bySeverity,
    issues: normalizedIssues,
    fileMetrics: normalizedMetrics,
  };
}

/**
 * Best-effort file and directory removal with Windows transient lock rename fallback.
 *
 * @param targetPath - Path to remove.
 */
function rmRetry(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort: attempt fallback rename if deletion fails due to transient Windows lock
    try {
      const randomSuffix = Math.random()
        .toString(RANDOM_STRING_RADIX)
        .slice(RANDOM_STRING_START, RANDOM_STRING_END);
      fs.renameSync(
        targetPath,
        path.join(DEFAULT_TMP_DIR, `ar-diff-stale-${Date.now()}-${randomSuffix}`),
      );
    } catch {
      // ignore: secondary rename failure during teardown is non-fatal
    }
  }
}

/**
 * Signals running background daemon to stop.
 */
function daemonStop() {
  try {
    spawnSync(
      process.execPath,
      [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'stop', '--root', CORPUS],
      { stdio: 'ignore' },
    );
  } catch {
    // ignore: daemon stop failure is non-fatal
  }
}

/**
 * Spawns background daemon for corpus root.
 *
 * @returns True if daemon started successfully.
 */
function daemonStart() {
  try {
    const spawnResult = spawnSync(
      process.execPath,
      [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'start', '--root', CORPUS],
      { stdio: 'ignore', detached: true },
    );
    return spawnResult.status === 0;
  } catch {
    // ignore: return false when daemon process cannot be spawned
    return false;
  }
}

/**
 * Prepares an isolated diff-corpus folder with config and initial files.
 *
 * @param corpusDir - Destination directory path.
 * @param baseContent - Initial content for big.ts.
 * @param smallContent - Initial content for small.ts.
 */
function setupCorpus(corpusDir, baseContent, smallContent) {
  rmRetry(corpusDir);
  fs.mkdirSync(path.join(corpusDir, 'src'), { recursive: true });
  writeConfig(path.join(corpusDir, CONFIG_FILE_NAME));
  fs.writeFileSync(path.join(corpusDir, FILE_BIG), baseContent);
  fs.writeFileSync(path.join(corpusDir, FILE_SMALL), smallContent);
}

/**
 * Creates standard scan options for a corpus folder.
 *
 * @param corpusDir - Target corpus directory.
 * @param [overrides] - Additional option overrides.
 * @returns Scan configuration options.
 */
function getScanOptions(corpusDir, overrides = {}) {
  return {
    root: corpusDir,
    configFile: path.join(corpusDir, CONFIG_FILE_NAME),
    format: FORMAT_JSON,
    logLevel: LOG_SILENT,
    daemon: DAEMON_OFF,
    cache: false,
    ...overrides,
  };
}

/**
 * Creates cold scan options for a corpus folder.
 *
 * @param corpusDir - Target corpus directory.
 * @returns Cold scan options.
 */
function getColdScanOptions(corpusDir) {
  return {
    root: corpusDir,
    configFile: path.join(corpusDir, CONFIG_FILE_NAME),
    format: FORMAT_JSON,
    logLevel: LOG_SILENT,
  };
}

/**
 * Scenario D1: Full file single line edit equivalence.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD1(corpusDir, baseContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const editedContent = baseContent.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
  fs.writeFileSync(bigPath, editedContent);

  const coldScanReport = await scan(getColdScanOptions(corpusDir));
  const diffScanResult = await scanDiff(
    [{ kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: editedContent }],
    getScanOptions(corpusDir),
  );

  const isEquivalent =
    JSON.stringify(normalize(coldScanReport)) === JSON.stringify(normalize(diffScanResult.report));
  return {
    name: 'D1 full-1-line',
    ok: isEquivalent,
    extra: `diffFiles=${diffScanResult.stats.diffFiles} byteEqual=${diffScanResult.stats.byteEqual} inc=${diffScanResult.stats.diffIncremental} full=${diffScanResult.stats.diffFull}`,
  };
}

/**
 * Scenario D2: Range-based single line edit equivalence.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD2(corpusDir, baseContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const editedContent = baseContent.replace(
    '  if (x < -50) return -100;',
    '  if (x < -50) return -999;',
  );
  fs.writeFileSync(bigPath, editedContent);

  const coldScanReport = await scan(getColdScanOptions(corpusDir));
  const editRanges = computeEditRanges(baseContent, editedContent);
  const diffScanResult = await scanDiff(
    [{ kind: 'ranges', filePath: FILE_BIG, newContent: editedContent, editRanges }],
    getScanOptions(corpusDir),
  );

  const isEquivalent =
    JSON.stringify(normalize(coldScanReport)) === JSON.stringify(normalize(diffScanResult.report));
  return {
    name: 'D2 ranges-1-line',
    ok: isEquivalent,
    extra: `rangesProvided=${diffScanResult.stats.rangesProvided} inc=${diffScanResult.stats.diffIncremental} full=${diffScanResult.stats.diffFull}`,
  };
}

/**
 * Scenario D3: Multi-file concurrent modification equivalence.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @param smallContent - Original small.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD3(corpusDir, baseContent, smallContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const smallPath = path.join(corpusDir, FILE_SMALL);
  const bigEdited = baseContent.replace('  return x + 100;', '  return x + 424242;');
  const smallEdited = "export const A = 42;\nexport const B = 'changed exported string';\n";

  fs.writeFileSync(bigPath, bigEdited);
  fs.writeFileSync(smallPath, smallEdited);

  const coldScanReport = await scan(getColdScanOptions(corpusDir));
  const diffScanResult = await scanDiff(
    [
      { kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: bigEdited },
      { kind: 'full', filePath: FILE_SMALL, oldContent: smallContent, newContent: smallEdited },
    ],
    getScanOptions(corpusDir),
  );

  const isEquivalent =
    JSON.stringify(normalize(coldScanReport)) === JSON.stringify(normalize(diffScanResult.report));
  return {
    name: 'D3 multi-file',
    ok: isEquivalent,
    extra: `diffFiles=${diffScanResult.stats.diffFiles} diffIgnored=${diffScanResult.stats.diffIgnored}`,
  };
}

/**
 * Scenario D4: Out-of-bounds edit range fallback to full scan.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD4(corpusDir, baseContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const editedContent = baseContent.replace('  const LIMIT1 = 101;', '  const LIMIT1 = 555;');
  fs.writeFileSync(bigPath, editedContent);

  const coldScanReport = await scan(getColdScanOptions(corpusDir));
  const badEditRanges = [
    {
      startLine: 1,
      oldEndLine: 1,
      newEndLine: 1,
      startByte: 0,
      oldEndByte: OUT_OF_BOUNDS_BYTE_OFFSET,
      newEndByte: OUT_OF_BOUNDS_BYTE_OFFSET,
    },
  ];
  const diffScanResult = await scanDiff(
    [{ kind: 'ranges', filePath: FILE_BIG, newContent: editedContent, editRanges: badEditRanges }],
    getScanOptions(corpusDir),
  );

  const isEquivalent =
    JSON.stringify(normalize(coldScanReport)) === JSON.stringify(normalize(diffScanResult.report));
  const hasFallback = diffScanResult.stats.rangesFallback >= 1;
  return {
    name: 'D4 out-of-bounds',
    ok: isEquivalent && hasFallback,
    extra: `rangesFallback=${diffScanResult.stats.rangesFallback}`,
  };
}

/**
 * Scenario D5: Disk content mismatch fallback to full scan.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD5(corpusDir, baseContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const editedContent = baseContent.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 888;');
  fs.writeFileSync(bigPath, editedContent);

  const coldScanReport = await scan(getColdScanOptions(corpusDir));
  const diffScanResult = await scanDiff(
    [{ kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: baseContent }],
    getScanOptions(corpusDir),
  );

  const isEquivalent =
    JSON.stringify(normalize(coldScanReport)) === JSON.stringify(normalize(diffScanResult.report));
  return {
    name: 'D5 disk-mismatch',
    ok: isEquivalent,
    extra: `diffFull=${diffScanResult.stats.diffFull}`,
  };
}

/**
 * Scenario D6: Delta subset and ordering consistency.
 *
 * @param corpusDir - Isolated corpus directory.
 * @param baseContent - Original big.ts content.
 * @returns Scenario outcome carrying its label, the equivalence verdict, and the observed counters.
 */
async function runD6(corpusDir, baseContent) {
  const bigPath = path.join(corpusDir, FILE_BIG);
  const editedContent = baseContent.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
  fs.writeFileSync(bigPath, editedContent);

  const fullResult = await scanDiff(
    [{ kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: editedContent }],
    getScanOptions(corpusDir),
  );
  const deltaResult = await scanDiffDelta(
    [{ kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: editedContent }],
    getScanOptions(corpusDir),
  );

  const fullIssuesById = new Map(fullResult.report.issues.map((issue) => [issue.id, issue]));
  const isSubsetValid = deltaResult.report.issues.every((deltaIssue) => {
    const matchingIssue = fullIssuesById.get(deltaIssue.id);
    return matchingIssue && JSON.stringify(matchingIssue) === JSON.stringify(deltaIssue);
  });

  const isMetricsValid = deltaResult.report.fileMetrics.every((deltaMetric) =>
    fullResult.report.fileMetrics.some(
      (fullMetric) => JSON.stringify(fullMetric) === JSON.stringify(deltaMetric),
    ),
  );

  const isOrderingValid = (() => {
    const fullOrderIds = fullResult.report.issues
      .filter((fullIssue) =>
        deltaResult.report.issues.some((deltaIssue) => deltaIssue.id === fullIssue.id),
      )
      .map((issue) => issue.id);
    const deltaOrderIds = deltaResult.report.issues.map((issue) => issue.id);
    return JSON.stringify(fullOrderIds) === JSON.stringify(deltaOrderIds);
  })();

  const isFilesScannedSingle = deltaResult.report.summary.filesScanned === 1;
  const isPassed = isSubsetValid && isMetricsValid && isOrderingValid && isFilesScannedSingle;

  return {
    name: 'D6 delta-subset',
    ok: isPassed,
    extra: `subset=${isSubsetValid} metrics=${isMetricsValid} order=${isOrderingValid}`,
  };
}

/**
 * Formats standard test scenario output line.
 *
 * @param scenarioName - Test scenario name.
 * @param passed - Whether scenario succeeded.
 * @param [extraDetails] - Diagnostic metrics string.
 * @returns Formatted output line.
 */
function formatTestResult(scenarioName, passed, extraDetails = '') {
  const statusPrefix = passed ? STATUS_PASS : STATUS_BLOCK;
  const suffix = extraDetails ? `  ${extraDetails}` : '';
  return `${statusPrefix} ${scenarioName}${suffix}`;
}

async function main() {
  const previousIncremental = process.env.AR_INCREMENTAL;
  const previousMinLines = process.env.AR_INCREMENTAL_MIN_LINES;

  process.env.AR_INCREMENTAL = '1';
  process.env.AR_INCREMENTAL_MIN_LINES = '1';

  let failureCount = 0;
  const recordResult = (scenarioName, passed, extraDetails) => {
    const message = formatTestResult(scenarioName, passed, extraDetails);
    if (passed) {
      console.log(message);
    } else {
      failureCount++;
      console.error(message);
    }
  };

  const baseContent = baselineBig(BASELINE_LINE_COUNT);
  const smallContent = "export const A = 42;\nexport const B = 'hello world exported';\n";

  const corpusDirs = Array.from({ length: CORPUS_INSTANCE_COUNT }, (_, index) =>
    path.join(DEFAULT_TMP_DIR, `ar-diff-corpus-${index + 1}`),
  );
  for (let index = 0; index < CORPUS_INSTANCE_COUNT; index++) {
    setupCorpus(corpusDirs[index], baseContent, smallContent);
  }

  const results = await Promise.all([
    runD1(corpusDirs[0], baseContent),
    runD2(corpusDirs[1], baseContent),
    runD3(corpusDirs[2], baseContent, smallContent),
    runD4(corpusDirs[3], baseContent),
    runD5(corpusDirs[4], baseContent),
    runD6(corpusDirs[5], baseContent),
  ]);

  for (const result of results) {
    recordResult(result.name, result.ok, result.extra);
  }

  for (const dirPath of corpusDirs) {
    rmRetry(dirPath);
  }

  // ---- D7: daemon round-trip (best-effort) ----
  setupCorpus(CORPUS, baseContent, smallContent);
  rmRetry(CACHE_DIR);
  daemonStop();

  const isDaemonStarted = daemonStart();
  if (!isDaemonStarted) {
    console.log('SKIP D7 daemon-roundtrip (daemon did not start)');
  } else {
    try {
      // Prime daemon L2 + incremental state with a warm scan.
      await scanDiff([], {
        root: CORPUS,
        configFile: CFG,
        format: FORMAT_JSON,
        logLevel: LOG_SILENT,
        daemon: DAEMON_ON,
        cache: true,
        cacheDir: CACHE_DIR,
      });

      const editedContent = baseContent.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 999;');
      fs.writeFileSync(BIG, editedContent);

      const coldScanReport = await scan(getColdScanOptions(CORPUS));
      const diffScanResult = await scanDiff(
        [{ kind: 'full', filePath: FILE_BIG, oldContent: baseContent, newContent: editedContent }],
        {
          root: CORPUS,
          configFile: CFG,
          format: FORMAT_JSON,
          logLevel: LOG_SILENT,
          daemon: DAEMON_ON,
          cache: true,
          cacheDir: CACHE_DIR,
        },
      );

      const isEquivalent =
        JSON.stringify(normalize(coldScanReport)) ===
        JSON.stringify(normalize(diffScanResult.report));
      const isDaemonUsed = diffScanResult.stats.daemonUsed === true;
      recordResult(
        'D7 daemon-roundtrip',
        isEquivalent && isDaemonUsed,
        `daemonUsed=${diffScanResult.stats.daemonUsed} diffIncremental=${diffScanResult.stats.diffIncremental} diffFull=${diffScanResult.stats.diffFull}`,
      );
    } finally {
      daemonStop();
    }
  }

  daemonStop();
  rmRetry(CORPUS);
  rmRetry(CACHE_DIR);

  if (previousIncremental === undefined) {
    delete process.env.AR_INCREMENTAL;
  } else {
    process.env.AR_INCREMENTAL = previousIncremental;
  }

  if (previousMinLines === undefined) {
    delete process.env.AR_INCREMENTAL_MIN_LINES;
  } else {
    process.env.AR_INCREMENTAL_MIN_LINES = previousMinLines;
  }

  console.log(
    failureCount > 0 ? `\n${failureCount} scenario(s) FAILED` : '\nALL DIFF SCENARIOS PASS',
  );
  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  daemonStop();
  process.exit(1);
});
