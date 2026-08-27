#!/usr/bin/env node
// validate-diff.js — diff interface equivalence gate (T04, docs/03-incremental-and-diff/02-diff-interface-spec.md).
//
// Oracle = COLD scan (scan(), no daemon, no cache, AR_INCREMENTAL=0 semantics).
// Under test = scanDiff (full) / scanDiffDelta (subset) with AR_INCREMENTAL=1, across both the
// in-process path and (best-effort) the daemon path.
//
// Scenarios:
//   D1 full-1-line        kind:'full' changed file
//   D2 ranges-1-line      kind:'ranges' (ASCII corpus → UTF-8 byte == UTF-16 offset)
//   D3 multi-file         two changed files in one diff
//   D4 out-of-bounds      editRanges with a byte offset past EOF → full fallback
//   D5 disk-mismatch      diff newContent != disk bytes → full fallback (verifyDiskContent)
//   D6 delta-subset       scanDiffDelta.report ≡ filter(scanDiff.report, changed files)
//
// Usage: node scripts/validate-diff.js   (exit 0 = PASS, 1 = FAIL)

const { scan, scanDiff, scanDiffDelta } = require('../dist/api');
const { computeEditRanges } = require('../dist/core/editDiff');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, '.diff-corpus');
const BIG = path.join(CORPUS, 'src', 'big.ts');
const SMALL = path.join(CORPUS, 'src', 'small.ts');
const CACHE_DIR = 'C:/tmp/ar-diff-validate-cache';
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

function writeConfig() {
  fs.writeFileSync(CFG, JSON.stringify({
    format: 'json',
    failOnIssue: false,
    include: ['**/*.ts'],
    exclude: ['node_modules', '.git', 'dist', 'build', 'out'],
    thresholds: {
      magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3,
      fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15,
      complexityWarn: 2, complexityFail: 12,
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
  }, null, 2));
}

function normalize(r) {
  const issues = r.issues
    .map((x) => ({ id: x.id, analyzer: x.analyzer, rule: x.rule, severity: x.severity, message: x.message, location: x.location, detail: x.detail, suggestion: x.suggestion }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics.map((m) => ({ ...m })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { filesScanned: r.summary.filesScanned, issuesTotal: r.summary.issuesTotal, byAnalyzer: r.summary.byAnalyzer, bySeverity: r.summary.bySeverity, issues, fileMetrics };
}

function rmRetry(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); }
  catch {
    try { fs.renameSync(p, path.join('C:/tmp', `ar-diff-stale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)); } catch { /* ignore */ }
  }
}

function daemonStop() {
  try { spawnSync(process.execPath, [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'stop', '--root', CORPUS], { stdio: 'ignore' }); } catch { /* ignore */ }
}

function daemonStart() {
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'index.js'), 'daemon', 'start', '--root', CORPUS], { stdio: 'ignore', detached: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

async function main() {
  const prevInc = process.env.AR_INCREMENTAL;
  const prevMin = process.env.AR_INCREMENTAL_MIN_LINES;

  rmRetry(CORPUS);
  rmRetry(CACHE_DIR);
  fs.mkdirSync(path.join(CORPUS, 'src'), { recursive: true });
  writeConfig();
  const base = baselineBig(150);
  fs.writeFileSync(BIG, base);
  fs.writeFileSync(SMALL, "export const A = 42;\nexport const B = 'hello world exported';\n");
  daemonStop();

  process.env.AR_INCREMENTAL = '1';
  process.env.AR_INCREMENTAL_MIN_LINES = '1';

  const cold = () => scan({ root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent' });
  const fullDiff = (diffs, opts = {}) => scanDiff(diffs, { root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'off', cache: false, ...opts });
  const deltaDiff = (diffs, opts = {}) => scanDiffDelta(diffs, { root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'off', cache: false, ...opts });

  let failed = 0;
  const check = (name, ok, extra) => {
    if (ok) console.log(`PASS ${name}${extra ? `  ${extra}` : ''}`);
    else { failed++; console.error(`FAIL ${name}${extra ? `  ${extra}` : ''}`); }
  };

  // ---- D1: kind:'full' ----
  {
    fs.writeFileSync(BIG, base);
    const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
    fs.writeFileSync(BIG, edited);
    const c = await cold();
    const d = await fullDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }]);
    check('D1 full-1-line', JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
      `diffFiles=${d.stats.diffFiles} byteEqual=${d.stats.byteEqual} inc=${d.stats.diffIncremental} full=${d.stats.diffFull}`);
  }

  // ---- D2: kind:'ranges' (ASCII corpus → UTF-8 byte == UTF-16 offset) ----
  {
    fs.writeFileSync(BIG, base);
    const edited = base.replace('  if (x < -50) return -100;', '  if (x < -50) return -999;');
    fs.writeFileSync(BIG, edited);
    const c = await cold();
    const edits = computeEditRanges(base, edited);
    const d = await fullDiff([{ kind: 'ranges', filePath: 'src/big.ts', newContent: edited, editRanges: edits }]);
    check('D2 ranges-1-line', JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
      `rangesProvided=${d.stats.rangesProvided} inc=${d.stats.diffIncremental} full=${d.stats.diffFull}`);
  }

  // ---- D3: multi-file ----
  {
    fs.writeFileSync(BIG, base);
    fs.writeFileSync(SMALL, "export const A = 42;\nexport const B = 'hello world exported';\n");
    const bigEdited = base.replace('  return x + 100;', '  return x + 424242;');
    const smallEdited = "export const A = 42;\nexport const B = 'changed exported string';\n";
    fs.writeFileSync(BIG, bigEdited);
    fs.writeFileSync(SMALL, smallEdited);
    const c = await cold();
    const d = await fullDiff([
      { kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: bigEdited },
      { kind: 'full', filePath: 'src/small.ts', oldContent: "export const A = 42;\nexport const B = 'hello world exported';\n", newContent: smallEdited },
    ]);
    check('D3 multi-file', JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
      `diffFiles=${d.stats.diffFiles} diffIgnored=${d.stats.diffIgnored}`);
  }

  // ---- D4: out-of-bounds ranges → full fallback ----
  {
    fs.writeFileSync(BIG, base);
    const edited = base.replace('  const LIMIT1 = 101;', '  const LIMIT1 = 555;');
    fs.writeFileSync(BIG, edited);
    const c = await cold();
    const badEdits = [{ startLine: 1, oldEndLine: 1, newEndLine: 1, startByte: 0, oldEndByte: 999999, newEndByte: 999999 }];
    const d = await fullDiff([{ kind: 'ranges', filePath: 'src/big.ts', newContent: edited, editRanges: badEdits }]);
    check('D4 out-of-bounds', JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)) && d.stats.rangesFallback >= 1,
      `rangesFallback=${d.stats.rangesFallback}`);
  }

  // ---- D5: disk-mismatch (newContent != disk) → full fallback ----
  {
    fs.writeFileSync(BIG, base);
    const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 888;');
    fs.writeFileSync(BIG, edited);
    const c = await cold();
    // newContent is stale (differs from disk) → verifyDiskContent forces a full rescan of disk.
    const d = await fullDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: base }]);
    check('D5 disk-mismatch', JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)),
      `diffFull=${d.stats.diffFull}`);
  }

  // ---- D6: delta ⊆ full ----
  {
    fs.writeFileSync(BIG, base);
    fs.writeFileSync(SMALL, "export const A = 42;\nexport const B = 'hello world exported';\n");
    const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
    fs.writeFileSync(BIG, edited);
    const full = await fullDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }]);
    const delta = await deltaDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }]);
    const fullById = new Map(full.report.issues.map((x) => [x.id, x]));
    const subsetOk = delta.report.issues.every((x) => {
      const f = fullById.get(x.id);
      return f && JSON.stringify(f) === JSON.stringify(x);
    });
    const metricsOk = delta.report.fileMetrics.every((m) => full.report.fileMetrics.some((f) => JSON.stringify(f) === JSON.stringify(m)));
    const orderOk = (() => {
      const fullOrder = full.report.issues.filter((x) => delta.report.issues.some((d) => d.id === x.id)).map((x) => x.id);
      return JSON.stringify(fullOrder) === JSON.stringify(delta.report.issues.map((x) => x.id));
    })();
    check('D6 delta-subset', subsetOk && metricsOk && orderOk && delta.report.summary.filesScanned === 1,
      `subset=${subsetOk} metrics=${metricsOk} order=${orderOk}`);
  }

  // ---- D7: daemon round-trip (best-effort) ----
  {
    const started = daemonStart();
    if (!started) {
      console.log('SKIP D7 daemon-roundtrip (daemon did not start)');
    } else {
      try {
        fs.writeFileSync(BIG, base);
        // Prime the daemon's L2 + incremental state with a warm scan.
        const warm = await scanDiff([], { root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'on', cache: true, cacheDir: CACHE_DIR });
        const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 999;');
        fs.writeFileSync(BIG, edited);
        const c = await cold();
        const d = await scanDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }],
          { root: CORPUS, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'on', cache: true, cacheDir: CACHE_DIR });
        check('D7 daemon-roundtrip',
          JSON.stringify(normalize(c)) === JSON.stringify(normalize(d.report)) && d.stats.daemonUsed === true,
          `daemonUsed=${d.stats.daemonUsed} diffIncremental=${d.stats.diffIncremental} diffFull=${d.stats.diffFull}`);
      } finally {
        daemonStop();
      }
    }
  }

  daemonStop();

  if (prevInc === undefined) delete process.env.AR_INCREMENTAL; else process.env.AR_INCREMENTAL = prevInc;
  if (prevMin === undefined) delete process.env.AR_INCREMENTAL_MIN_LINES; else process.env.AR_INCREMENTAL_MIN_LINES = prevMin;

  console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nALL DIFF SCENARIOS PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); daemonStop(); process.exit(1); });
