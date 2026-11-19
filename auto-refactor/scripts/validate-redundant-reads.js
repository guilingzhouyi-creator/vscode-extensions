/**
 * Module: Verification Harness — Redundant Source Read Guard
 * File Path: scripts/validate-redundant-reads.js
 * Architecture Role: Measures how many times a production scan reads each source file and fails
 *   when the multiplier exceeds a ratcheted ceiling.
 * Dependencies & Triggers: Preloads `scripts/lib/read-audit-hook.cjs` via NODE_OPTIONS so the hook
 *   shares the scanned process's `fs` singleton; invoked by `npm test` and directly.
 * Responsibilities:
 *   1. Run one production scan (default workers) with the read hook installed;
 *   2. Compute reads-per-file and redundant byte volume;
 *   3. Fail when the multiplier exceeds the recorded budget.
 * Exit Semantics & Design Rationale: Exits 0 when within budget, 1 on regression. The hook must be
 *   a CommonJS preload: patching `fs` from an ESM script creates a different module instance, which
 *   silently records nothing. A ratchet rather than an absolute target because the scan itself must
 *   read every file once, and the remaining copies are removed incrementally.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(__dirname, 'lib', 'read-audit-hook.cjs');
const SR_CACHE_DIR = '.auto-refactor-cache';

/** Reads per source file allowed after the current round of de-duplication. */
const MAX_READ_MULTIPLIER = 3.0;

/**
 * Runs one production scan with the read hook installed.
 *
 * @returns Parsed audit rows: one per distinct absolute path.
 */
function runAuditedScan() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-read-audit-'));
  const auditOut = path.join(tempDir, 'audit.json');
  const reportOut = path.join(tempDir, 'report.json');

  const result = spawnSync(
    process.execPath,
    [
      'dist/index.js',
      'scan',
      '--root',
      'src',
      '--no-cache',
      '--format',
      'json',
      '--out',
      reportOut,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        AR_READ_AUDIT_OUT: auditOut,
        NODE_OPTIONS: `--require ${HOOK}`,
      },
    },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`audited scan failed with status ${result.status}`);
  }
  assert.ok(fs.existsSync(auditOut), 'read hook did not produce an audit file');
  const rows = JSON.parse(fs.readFileSync(auditOut, 'utf8'));
  rmSyncWithRetry(tempDir, { recursive: true, force: true });
  return rows;
}

/**
 * Restricts audit rows to the scanned source tree, excluding the tool's own cache directory.
 *
 * @param rows - Audit rows from the hook.
 * @returns Rows describing scanned source files only.
 */
function sourceRows(rows) {
  const srcRoot = path.resolve(path.join(ROOT, 'src')).toLowerCase();
  return rows.filter((row) => {
    const normalized = path.resolve(row.path).toLowerCase();
    if (!normalized.startsWith(srcRoot + path.sep)) return false;
    return !normalized.includes(`${path.sep}${SR_CACHE_DIR}${path.sep}`);
  });
}

function main() {
  console.log('=== Redundant Source Read Guard ===');
  const rows = sourceRows(runAuditedScan());

  const files = rows.length;
  const calls = rows.reduce((acc, row) => acc + row.count, 0);
  const bytes = rows.reduce((acc, row) => acc + row.bytes, 0);
  const redundantCalls = calls - files;
  const redundantBytes = rows.reduce(
    (acc, row) => acc + row.bytes - Math.round(row.bytes / row.count),
    0,
  );
  const multiplier = files === 0 ? 0 : calls / files;

  console.log(`  source files          : ${files}`);
  console.log(`  read calls            : ${calls}`);
  console.log(`  bytes read            : ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(
    `  reads per file        : ${multiplier.toFixed(2)}x (budget ${MAX_READ_MULTIPLIER.toFixed(2)}x)`,
  );
  console.log(`  redundant calls       : ${redundantCalls}`);
  console.log(`  redundant bytes       : ${(redundantBytes / 1048576).toFixed(1)} MB`);

  const histogram = new Map();
  for (const row of rows) histogram.set(row.count, (histogram.get(row.count) ?? 0) + 1);
  console.log(
    '  read-count histogram  :',
    [...histogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([count, count_of_files]) => `${count}x:${count_of_files}`)
      .join(' '),
  );

  assert.ok(files > 0, 'no source files were read; the hook is not observing the scan');
  assert.ok(
    multiplier <= MAX_READ_MULTIPLIER,
    `redundant read regression: ${multiplier.toFixed(2)}x per file exceeds the ${MAX_READ_MULTIPLIER.toFixed(2)}x budget`,
  );

  console.log('\n✔  Source read amplification within budget.');
}

try {
  main();
} catch (error) {
  console.error(
    'FAIL: validate-redundant-reads.js —',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
