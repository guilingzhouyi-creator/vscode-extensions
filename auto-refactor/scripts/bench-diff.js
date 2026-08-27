#!/usr/bin/env node
// bench-diff.js — diff interface A/B benchmark (T04, docs/03-incremental-and-diff/02-diff-interface-spec.md).
//
// Measures, on a big-file small-change corpus:
//   A. cold full scan            (scan, no cache, no daemon)
//   B. scanDiff full (kind:'full')   — Myers runs inside resolveDiff
//   C. scanDiff ranges (kind:'ranges') — Myers SKIPPED (editRanges provided)
//   D. scanDiffDelta (changed-file subset only)
// plus the Myers-vs-ranges micro cost, and asserts full byte-equivalence vs cold.
//
// Usage: node scripts/bench-diff.js [lines]

const { scan, scanDiff, scanDiffDelta } = require('../dist/api');
const { computeEditRanges, changedLineCount, countLines } = require('../dist/core/editDiff');
const { normalizeEditRanges } = require('../dist/core/utf8');
const fs = require('fs');
const path = require('path');

const LINES = parseInt(process.argv[2], 10) || 1500;
const ROOT = path.join(__dirname, '.bench-diff-corpus');
const CACHE = 'C:/tmp/ar-bench-diff-cache';
const CFG = path.join(ROOT, 'auto-refactor.config.json');
const BIG = path.join(ROOT, 'src', 'big.ts');

function bigSource(lines) {
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

function norm(r) {
  return JSON.stringify(r.issues.map((x) => ({ id: x.id, message: x.message, location: x.location, detail: x.detail })).sort((a, b) => (a.id < b.id ? -1 : 1)));
}

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
  fs.writeFileSync(CFG, JSON.stringify({
    format: 'json', failOnIssue: false, include: ['**/*.ts'], exclude: ['node_modules', '.git', 'dist', 'build', 'out'],
    thresholds: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3, fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15, complexityWarn: 8, complexityFail: 12 },
    analyzers: { constants: { enabled: true }, 'large-file': { enabled: true }, complexity: { enabled: true } },
    customAnalyzers: [], logLevel: 'silent', workers: 1, respectGitignore: false, failOnAnalyzerError: false,
  }, null, 2));

  const base = bigSource(LINES);
  const edited = base.replace('  const LIMIT0 = 100;', '  const LIMIT0 = 777;');
  fs.writeFileSync(BIG, base);
  // also add a couple of small files so full scan has "unchanged files"
  fs.writeFileSync(path.join(ROOT, 'src', 'a.ts'), "export const A = 1;\n");
  fs.writeFileSync(path.join(ROOT, 'src', 'b.ts'), "export const B = 'hello world';\n");

  // micro: Myers vs ranges-normalize cost
  let t0 = process.hrtime.bigint();
  const edits = computeEditRanges(base, edited);
  const tMyers = Number(process.hrtime.bigint() - t0) / 1e6;
  const buf = Buffer.from(edited, 'utf8');
  t0 = process.hrtime.bigint();
  normalizeEditRanges(edits, buf);
  const tNorm = Number(process.hrtime.bigint() - t0) / 1e6;

  process.env.AR_INCREMENTAL = '1';
  process.env.AR_INCREMENTAL_MIN_LINES = '1';

  // A: cold
  let t0a = Date.now();
  const cold = await scan({ root: ROOT, configFile: CFG, format: 'json', logLevel: 'silent' });
  const coldMs = Date.now() - t0a;

  // B: full diff
  fs.writeFileSync(BIG, edited);
  let t0b = Date.now();
  const dFull = await scanDiff([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }], { root: ROOT, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'off', cache: false });
  const fullMs = Date.now() - t0b;

  // C: ranges diff
  let t0c = Date.now();
  const dRanges = await scanDiff([{ kind: 'ranges', filePath: 'src/big.ts', newContent: edited, editRanges: edits }], { root: ROOT, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'off', cache: false });
  const rangesMs = Date.now() - t0c;

  // D: delta
  let t0d = Date.now();
  const dDelta = await scanDiffDelta([{ kind: 'full', filePath: 'src/big.ts', oldContent: base, newContent: edited }], { root: ROOT, configFile: CFG, format: 'json', logLevel: 'silent', daemon: 'off', cache: false });
  const deltaMs = Date.now() - t0d;

  const byteEqFull = norm(dFull.report) === norm(cold);
  const byteEqRanges = norm(dRanges.report) === norm(cold);

  console.log(`big-file lines=${LINES} (myers=${tMyers.toFixed(2)}ms ranges-normalize=${tNorm.toFixed(3)}ms)`);
  console.log(`cold=${coldMs}ms  scanDiff-full=${fullMs}ms  scanDiff-ranges=${rangesMs}ms  scanDiffDelta=${deltaMs}ms`);
  console.log(`full vs cold=${(coldMs / fullMs).toFixed(2)}x  ranges vs cold=${(coldMs / rangesMs).toFixed(2)}x  delta vs full=${(fullMs / deltaMs).toFixed(2)}x`);
  console.log(`byteEq-full=${byteEqFull} byteEq-ranges=${byteEqRanges}  full.stats=${JSON.stringify({ diffFiles: dFull.stats.diffFiles, diffIncremental: dFull.stats.diffIncremental, diffFull: dFull.stats.diffFull, rangesProvided: dRanges.stats.rangesProvided })}`);

  delete process.env.AR_INCREMENTAL;
  delete process.env.AR_INCREMENTAL_MIN_LINES;
  process.exit(byteEqFull && byteEqRanges ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
