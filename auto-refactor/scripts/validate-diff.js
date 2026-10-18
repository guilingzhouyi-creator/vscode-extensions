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
const SMALL = path.join(CORPUS, 'src', 'small.ts');

const DEFAULT_TMP_DIR = process.env.AUTO_REFACTOR_TMPDIR || path.join(os.tmpdir(), 'ar-temp');
try {
  fs.mkdirSync(DEFAULT_TMP_DIR, { recursive: true });
} catch {
  // best-effort
}

const CACHE_DIR = path.join(DEFAULT_TMP_DIR, 'ar-diff-validate-cache');
const CFG = path.join(CORPUS, 'auto-refactor.config.json');

function baselineBig(lines) {
  let s = '';
  for (let i = 0; i < lines; i++) {
    s += `export function fn${i}(x: number): number {\n`;
    s += `  const LIMIT${i} = ${100 + (i % 7)};\n`;
    s += `  if (x > ${50 + i}) return ${100 + (i % 7)};\n`;
    s += `  if (x < ${-50 - i}) return ${-100 - (i % 7)};\n`;
    s += `  return x + ${100 + (i % 7)};\n`;
    s += `}\n`;
  }
  s += `export const TAG = 'shared-token-value';\n`;
  for (let i = 0; i < 12; i++) s += `export const TOKEN${i} = 'shared-token-value';\n`;
  return s;
}

function writeConfig(targetCfg = CFG) {
  fs.writeFileSync(
    targetCfg,
    JSON.stringify(
      {
        format: 'json',
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
        logLevel: 'silent',
        workers: 1,
        respectGitignore: false,
        failOnAnalyzerError: false,
        parser: 'oxc',
      },
      null,
      2,
    ),
  );
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
      suggestion: x.suggestion,
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

function rmRetry(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(
        p,
        path.join(
          DEFAULT_TMP_DIR,
          `ar-diff-stale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ),
      );
    } catch {
      /* ignore */
    }
  }
}

function daemonStop() {
  try {
    spawnSync(
      process.execPath,
      [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'stop', '--root', CORPUS],
      { stdio: 'ignore' },
    );
  } catch {
    /* ignore */
  }
}

function daemonStart() {
  try {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'start', '--root', CORPUS],
      { stdio: 'ignore', detached: true },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

function setupCorpus(corpusDir, baseContent, smallContent) {
  rmRetry(corpusDir);
  fs.mkdirSync(path.join(corpusDir, 'src'), { recursive: true });
  writeConfig(path.join(corpusDir, 'auto-refactor.config.json'));
  fs.writeFileSync(path.join(corpusDir, 'src', 'big.ts'), baseContent);
  fs.writeFileSync(path.join(corpusDir, 'src', 'small.ts'), smallContent);
}

async function runD1(corpusDir, base) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
  fs.writeFileSync(bigPath, edited);
  const c = await scan({ root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent' });
  const d = await scanDiff(
    [{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  return {
    name: 'D1 full-1-line',
    ok: JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
    extra: `diffFiles=${d.stats.diffFiles} byteEqual=${d.stats.byteEqual} inc=${d.stats.diffIncremental} full=${d.stats.diffFull}`,
  };
}

async function runD2(corpusDir, base) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const edited = base.replace('  if (x < -50) return -100;', '  if (x < -50) return -999;');
  fs.writeFileSync(bigPath, edited);
  const c = await scan({ root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent' });
  const edits = computeEditRanges(base, edited);
  const d = await scanDiff(
    [{ kind: 'ranges', filePath: 'src/big.ts', newContent: edited, editRanges: edits }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  return {
    name: 'D2 ranges-1-line',
    ok: JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
    extra: `rangesProvided=${d.stats.rangesProvided} inc=${d.stats.diffIncremental} full=${d.stats.diffFull}`,
  };
}

async function runD3(corpusDir, base, small) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const smallPath = path.join(corpusDir, 'src', 'small.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const bigEdited = base.replace('  return x + 100;', '  return x + 424242;');
  const smallEdited = "export const A = 42;\nexport const B = 'changed exported string';\n";
  fs.writeFileSync(bigPath, bigEdited);
  fs.writeFileSync(smallPath, smallEdited);
  const c = await scan({ root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent' });
  const d = await scanDiff(
    [
      { kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: bigEdited },
      { kind: 'full', filePath: 'src/small.ts', oldContent: small, newContent: smallEdited },
    ],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  return {
    name: 'D3 multi-file',
    ok: JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
    extra: `diffFiles=${d.stats.diffFiles} diffIgnored=${d.stats.diffIgnored}`,
  };
}

async function runD4(corpusDir, base) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const edited = base.replace('  const LIMIT1 = 101;', '  const LIMIT1 = 555;');
  fs.writeFileSync(bigPath, edited);
  const c = await scan({ root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent' });
  const badEdits = [
    { startLine: 1, oldEndLine: 1, newEndLine: 1, startByte: 0, oldEndByte: 999999, newEndByte: 999999 },
  ];
  const d = await scanDiff(
    [{ kind: 'ranges', filePath: 'src/big.ts', newContent: edited, editRanges: badEdits }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  return {
    name: 'D4 out-of-bounds',
    ok: JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)) && d.stats.rangesFallback >= 1,
    extra: `rangesFallback=${d.stats.rangesFallback}`,
  };
}

async function runD5(corpusDir, base) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 888;');
  fs.writeFileSync(bigPath, edited);
  const c = await scan({ root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent' });
  const d = await scanDiff(
    [{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: base }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  return {
    name: 'D5 disk-mismatch',
    ok: JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
    extra: `diffFull=${d.stats.diffFull}`,
  };
}

async function runD6(corpusDir, base) {
  const bigPath = path.join(corpusDir, 'src', 'big.ts');
  const cfgPath = path.join(corpusDir, 'auto-refactor.config.json');
  const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
  fs.writeFileSync(bigPath, edited);
  const full = await scanDiff(
    [{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  const delta = await scanDiffDelta(
    [{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }],
    { root: corpusDir, configFile: cfgPath, format: 'json', logLevel: 'silent', daemon: 'off', cache: false }
  );
  const fullById = new Map(full.report.issues.map((x) => [x.id, x]));
  const subsetOk = delta.report.issues.every((x) => {
    const f = fullById.get(x.id);
    return f && JSON.stringify(f) === JSON.stringify(x);
  });
  const metricsOk = delta.report.fileMetrics.every((m) =>
    full.report.fileMetrics.some((f) => JSON.stringify(f) === JSON.stringify(m)),
  );
  const orderOk = (() => {
    const fullOrder = full.report.issues
      .filter((x) => delta.report.issues.some((d) => d.id === x.id))
      .map((x) => x.id);
    return JSON.stringify(fullOrder) === JSON.stringify(delta.report.issues.map((x) => x.id));
  })();
  return {
    name: 'D6 delta-subset',
    ok: subsetOk && metricsOk && orderOk && delta.report.summary.filesScanned === 1,
    extra: `subset=${subsetOk} metrics=${metricsOk} order=${orderOk}`,
  };
}

let failed = 0;
const check = (name, ok, extra) => {
  if (ok) console.log(`PASS ${name}${extra ? `  ${extra}` : ''}`);
  else {
    failed++;
    console.error(`FAIL ${name}${extra ? `  ${extra}` : ''}`);
  }
};

async function main() {
  const prevInc = process.env.AR_INCREMENTAL;
  const prevMin = process.env.AR_INCREMENTAL_MIN_LINES;

  process.env.AR_INCREMENTAL = '1';
  process.env.AR_INCREMENTAL_MIN_LINES = '1';

  const base = baselineBig(150);
  const small = "export const A = 42;\nexport const B = 'hello world exported';\n";

  const dirs = [1, 2, 3, 4, 5, 6].map((i) => path.join(DEFAULT_TMP_DIR, `ar-diff-corpus-${i}`));
  for (let i = 0; i < 6; i++) {
    setupCorpus(dirs[i], base, small);
  }

  const results = await Promise.all([
    runD1(dirs[0], base),
    runD2(dirs[1], base),
    runD3(dirs[2], base, small),
    runD4(dirs[3], base),
    runD5(dirs[4], base),
    runD6(dirs[5], base),
  ]);

  for (const r of results) {
    check(r.name, r.ok, r.extra);
  }

  for (const d of dirs) rmRetry(d);

  // ---- D7: daemon round-trip (best-effort) ----
  setupCorpus(CORPUS, base, small);
  rmRetry(CACHE_DIR);
  daemonStop();

  const started = daemonStart();
  if (!started) {
    console.log('SKIP D7 daemon-roundtrip (daemon did not start)');
  } else {
    try {
      // Prime the daemon's L2 + incremental state with a warm scan.
      await scanDiff([], {
        root: CORPUS,
        configFile: CFG,
        format: 'json',
        logLevel: 'silent',
        daemon: 'on',
        cache: true,
        cacheDir: CACHE_DIR,
      });
      const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 999;');
      fs.writeFileSync(BIG, edited);
      const c = await scan({ root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent' });
      const d = await scanDiff(
        [{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }],
        {
          root: CORPUS,
          configFile: CFG,
          format: 'json',
          logLevel: 'silent',
          daemon: 'on',
          cache: true,
          cacheDir: CACHE_DIR,
        },
      );
      check(
        'D7 daemon-roundtrip',
        JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)) &&
          d.stats.daemonUsed === true,
        `daemonUsed=${d.stats.daemonUsed} diffIncremental=${d.stats.diffIncremental} diffFull=${d.stats.diffFull}`,
      );
    } finally {
      daemonStop();
    }
  }

  daemonStop();
  rmRetry(CORPUS);
  rmRetry(CACHE_DIR);

  if (prevInc === undefined) delete process.env.AR_INCREMENTAL;
  else process.env.AR_INCREMENTAL = prevInc;
  if (prevMin === undefined) delete process.env.AR_INCREMENTAL_MIN_LINES;
  else process.env.AR_INCREMENTAL_MIN_LINES = prevMin;

  console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nALL DIFF SCENARIOS PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  daemonStop();
  process.exit(1);
});
