/**
 * Module: Gate Verification — Rust vs TS Dual-Engine Parity Harness
 * File Path: scripts/common/verify-rust-ts-parity.js
 * Architecture Role: Executes both `fractal-git` (`taxis audit run --snapshot-dir`) and
 *   `auto-refactor` (`handleSnapshotScan`) against golden multi-language parity fixtures,
 *   asserting strict 10-dimension, SQALE, ADR-Q, and critical rule equivalence.
 * Dependencies & Triggers: Requires `auto-refactor/dist/daemon/index.js`, built `taxis` binary,
 *   and ./lib/parity-assertions; triggered by `audit-taxis.ps1` and CI parity checks.
 * Responsibilities:
 *   1. Resolve compiled `taxis` and `auto-refactor` runners without silent fallback;
 *   2. Execute Rust and TS immutable snapshot scans on golden clean and mixed fixtures;
 *   3. Delegate metric/rule assertions to parity-assertions and fail closed on any delta breach.
 * Exit Semantics & Design Rationale: Exits 0 on full parity pass; exits 1 on regression.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  createParityTracker,
  verifyCleanParity,
  verifyMixedParity,
} = require('./lib/parity-assertions');

const REPO_ROOT = path.resolve(__dirname, '../..');
const TAXIS_DIR = path.join(REPO_ROOT, 'fractal-git');
const CLEAN_FIXTURE = path.join(TAXIS_DIR, 'tests/fixtures/parity-clean');
const MIXED_FIXTURE = path.join(TAXIS_DIR, 'tests/fixtures/parity-mixed');
const DAEMON_DIST = path.join(REPO_ROOT, 'auto-refactor/dist/daemon/index.js');
const MAX_SNAPSHOT_BUFFER_BYTES = 16 * 1024 * 1024;

const MATCHED_ANALYZERS = [
  'complexity',
  'comments',
  'governance',
  'security',
  'ts-modern',
  'python-modern',
  'rust-modern',
  'hygiene',
  'dependency-graph',
  'secrets',
];

function resolveTaxisBinary() {
  const exeName = process.platform === 'win32' ? 'taxis.exe' : 'taxis';
  const debugBin = path.join(TAXIS_DIR, 'target/debug', exeName);
  const releaseBin = path.join(TAXIS_DIR, 'target/release', exeName);
  if (fs.existsSync(debugBin)) return debugBin;
  if (fs.existsSync(releaseBin)) return releaseBin;
  execFileSync('cargo', ['build', '--bin', 'taxis'], { cwd: TAXIS_DIR, stdio: 'inherit' });
  if (!fs.existsSync(debugBin)) {
    throw new Error(`Unable to locate compiled taxis binary at ${debugBin}`);
  }
  return debugBin;
}

function ensureAutoRefactorDist() {
  if (fs.existsSync(DAEMON_DIST)) return require(DAEMON_DIST);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build'], { cwd: path.join(REPO_ROOT, 'auto-refactor'), stdio: 'inherit' });
  return require(DAEMON_DIST);
}

function runRustSnapshot(taxisBin, fixtureDir) {
  const raw = execFileSync(
    taxisBin,
    ['audit', 'run', '--snapshot-dir', fixtureDir, '--archetype', 'library', '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_SNAPSHOT_BUFFER_BYTES },
  );
  return JSON.parse(raw);
}

async function runTsSnapshot(handleSnapshotScan, fixtureDir, prefixSrc) {
  const entries = fs.readdirSync(fixtureDir).sort().map((fileName) => ({
    path: prefixSrc ? `src/${fileName}` : fileName,
    content: fs.readFileSync(path.join(fixtureDir, fileName), 'utf8'),
  }));
  return handleSnapshotScan(
    { root: path.resolve(fixtureDir), archetype: 'library', analyzers: MATCHED_ANALYZERS },
    entries,
  );
}

async function main() {
  const taxisBin = resolveTaxisBinary();
  const { handleSnapshotScan } = ensureAutoRefactorDist();
  const { assertCheck, summary } = createParityTracker();

  const rustClean = runRustSnapshot(taxisBin, CLEAN_FIXTURE);
  const tsClean = await runTsSnapshot(handleSnapshotScan, CLEAN_FIXTURE, true);
  verifyCleanParity(rustClean, tsClean, assertCheck);

  const rustMixed = runRustSnapshot(taxisBin, MIXED_FIXTURE);
  const tsMixed = await runTsSnapshot(handleSnapshotScan, MIXED_FIXTURE, false);
  verifyMixedParity(rustMixed, tsMixed, assertCheck);

  assertCheck(
    'taxis snapshot writes_audit_logs_dir stays false and omits .audit-logs/',
    rustClean.writes_audit_logs_dir === false &&
      rustMixed.writes_audit_logs_dir === false &&
      !fs.existsSync(path.join(CLEAN_FIXTURE, '.audit-logs')) &&
      !fs.existsSync(path.join(MIXED_FIXTURE, '.audit-logs')),
  );

  const { passed, total } = summary();
  console.log(`\nSummary: ${passed}/${total} Rust/TS parity checks passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`verify-rust-ts-parity error: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
