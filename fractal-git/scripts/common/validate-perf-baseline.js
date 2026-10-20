/**
 * Module: Fractal Git — Performance Baseline Ratchet Validator
 * File Path: fractal-git/scripts/common/validate-perf-baseline.js
 * Architecture Role: Enforces TB-REGRESSION monotonicity by comparing current micro-benchmark timings
 *   against frozen baselines/taxis-perf.baseline.json with a 15% hardware tolerance allowance.
 * Dependencies & Triggers: Invoked by npm run gate, audit-taxis.ps1/sh, and CI regression checks.
 * Responsibilities:
 *   1. Execute `taxis bench -m 5 --verify-baseline <baseline-path>` across core hot paths;
 *   2. Assert zero regressions beyond the 15% tolerance threshold;
 *   3. Propagate child process exit codes and display benchmark output.
 * Exit Semantics & Design Rationale: Exits 0 on performance ratchet passing, 1 on TB-REGRESSION violation.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BASELINE_PATH = path.join(PROJECT_ROOT, 'baselines', 'taxis-perf.baseline.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'Cargo.toml');

if (!fs.existsSync(BASELINE_PATH)) {
  process.stderr.write(`[TB-REGRESSION] Baseline file not found: ${BASELINE_PATH}\n`);
  process.exit(1);
}

const cargoCmd = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
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
  process.stderr.write(`[TB-REGRESSION] Failed to execute cargo: ${res.error.message}\n`);
  process.exit(1);
}

process.exit(res.status ?? 0);
