/**
 * Module: Fractal Git — Performance Baseline Ratchet Validator
 * File Path: fractal-git/scripts/common/validate-perf-baseline.js
 * Architecture Role: Single source of truth for the micro-benchmark invocation. Normalizes
 *   manifest path, baseline path and sample count so the two platform runners cannot drift,
 *   then delegates tolerance evaluation to the Rust bench harness (15% allowance lives there).
 * Dependencies & Triggers: Invoked by audit-taxis.ps1 / audit-taxis.sh as step CRATE-BENCHMARK-03,
 *   and by `npm run gate:perf` for single-point verification. Requires the cargo toolchain; the
 *   baseline envelope is resolved from this file's own location, never from the caller's cwd.
 * Responsibilities:
 *   1. Execute `taxis bench -m 5 --verify-baseline <baseline-path>` across core hot paths;
 *   2. Assert zero regressions beyond the 15% tolerance threshold;
 *   3. Propagate child process exit codes and display benchmark output.
 * Exit Semantics & Design Rationale: Exits 0 on ratchet passing, 1 on TB-REGRESSION violation.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { prepareCargo } = require('./resolve-cargo');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(PROJECT_ROOT, 'baselines', 'taxis-perf.baseline.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'Cargo.toml');

if (!fs.existsSync(BASELINE_PATH)) {
  process.stderr.write(`[TB-REGRESSION] Baseline file not found: ${BASELINE_PATH}\n`);
  process.exit(1);
}

const cargoResolution = prepareCargo();
if (!cargoResolution) {
  process.stderr.write(
    '[TB-REGRESSION] cargo was not found through TAXIS_CARGO_BIN, ~/.cargo/bin, the rustup toolchain root, or PATH.\n',
  );
  process.exit(1);
}
const cargoCmd = cargoResolution.command;
const args = [
  'run',
  '--manifest-path',
  MANIFEST_PATH,
  '--bin',
  'taxis',
  '--',
  'bench',
  '-m',
  '5',
  '--verify-baseline',
  BASELINE_PATH,
];

const res = spawnSync(cargoCmd, args, {
  cwd: PROJECT_ROOT,
  stdio: 'inherit',
  encoding: 'utf8',
});

if (res.error) {
  process.stderr.write(
    `[TB-REGRESSION] Failed to execute cargo (${cargoResolution.source}: ${cargoCmd}): ${res.error.message}\n`,
  );
  process.exit(1);
}

process.exit(res.status ?? 0);
