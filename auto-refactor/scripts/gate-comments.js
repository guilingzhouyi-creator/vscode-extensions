#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Strict Comment Ratchet Runner
 * File Path: scripts/gate-comments.js
 * Architecture Role: Self-hosted comment gate; boots the built CLI in strict mode
 * Dependencies & Triggers: `npm run gate` / `gate:comments`; requires `npm run build` output
 * Responsibilities: Scan src/**\/*.ts and scripts/*.js with the comments analyzer at strict
 *                   level against the grouped baseline, and propagate the CLI exit code
 * Exit Semantics & Design Rationale: 0 = no new violations vs the baseline, 1 = new violation
 *                   at/above warning (or unreadable baseline), 2 = usage/precondition error.
 *                   The grouped baseline is the ratchet: line shifts are tolerated, growth is
 *                   not; `--update` is the only sanctioned rewrite path.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const BASELINE = path.join(ROOT, 'baselines', 'comments.strict.baseline.json');
const INCLUDE = 'src/**/*.ts,scripts/*.js';

const args = process.argv.slice(2);
const update = args.includes('--update');
const forceExpand = args.includes('--force-expand');

if (!fs.existsSync(CLI)) {
  process.stderr.write('[gate:comments] dist/index.js missing — run "npm run build" first\n');
  process.exit(2);
}

if (!update && !fs.existsSync(BASELINE)) {
  process.stderr.write(
    `[gate:comments] baseline missing: ${path.relative(ROOT, BASELINE)}\n` +
      '[gate:comments] run "npm run gate:comments:update" to freeze the current state first\n',
  );
  process.exit(2);
}

if (update) {
  // The CLI writes the baseline verbatim and does not create parent directories; a first-time
  // freeze must therefore make the target directory exist beforehand.
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
}

const cliArgs = [
  CLI,
  'scan',
  '--root',
  ROOT,
  '--include',
  INCLUDE,
  '--analyzers',
  'comments',
  '--comment-level',
  'strict',
  '--format',
  'text',
  '--baseline',
  BASELINE,
  '--baseline-granularity',
  'grouped',
  '--fail-on-severity',
  'warning',
  '--no-cache',
  '--no-daemon',
  '--log-level',
  'warn',
];

if (update) {
  cliArgs.push('--update-baseline', BASELINE);
  if (forceExpand) {
    cliArgs.push('--force-baseline-expand');
  }
}

const result = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });

if (result.error) {
  process.stderr.write(`[gate:comments] failed to launch CLI: ${result.error.message}\n`);
  process.exit(2);
}

const code = result.status === null ? 2 : result.status;
process.stdout.write(
  `[gate:comments] ${update ? 'baseline updated' : 'strict ratchet'} → ${code === 0 ? 'PASS' : 'FAIL'}\n`,
);
process.exit(code);
