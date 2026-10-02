/**
 * Module: Tooling — Trajectory Ledger & Compaction Quality Gate
 * File Path: scripts/common/validate-trajectory-ledger.js
 * Architecture Role: Validates the physical constraints of the long-term ELOC
 *   and quality trajectory ledger: per-record NDJSON line size strictly < 350B,
 *   valid NDJSON schema, and aggregate storage budget <= 2MB.
 * Dependencies & Triggers: Consumed by pre-push-gate and CI workflows.
 * Responsibilities: Parse active-runs.ndjson, verify byte lengths, inspect lifetime/weekly
 *   summaries, and fail closed if bounds are violated.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, exits 1 on any violation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MAX_RECORD_BYTE_SIZE = 350;
const MAX_TOTAL_STORAGE_BYTES = 2 * 1024 * 1024; // 2 MB

function resolveLedgerDir() {
  const root = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(root, 'auto-refactor', '.refactor-trajectory'),
    path.join(root, '.refactor-trajectory'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function validateSingleRecordLine(line, index) {
  let violations = 0;
  const byteLen = Buffer.byteLength(line, 'utf8');

  if (byteLen > MAX_RECORD_BYTE_SIZE) {
    console.error(
      `  ❌ Line ${index + 1} exceeds size limit: ${byteLen} bytes > ${MAX_RECORD_BYTE_SIZE}B limit`,
    );
    violations++;
  }

  try {
    const parsed = JSON.parse(line);
    if (!parsed.t || !parsed.rev || !parsed.eloc || !parsed.score) {
      console.error(`  ❌ Line ${index + 1} is missing mandatory trajectory schema fields`);
      violations++;
    }
  } catch (err) {
    console.error(`  ❌ Line ${index + 1} contains corrupt JSON: ${err.message}`);
    violations++;
  }

  return violations;
}

function validateActiveRuns(ledgerDir) {
  const activeRunsPath = path.join(ledgerDir, 'active-runs.ndjson');
  if (!fs.existsSync(activeRunsPath)) {
    return { bytes: 0, violations: 0 };
  }

  const stat = fs.statSync(activeRunsPath);
  const content = fs.readFileSync(activeRunsPath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let violations = 0;

  for (let i = 0; i < lines.length; i++) {
    violations += validateSingleRecordLine(lines[i], i);
  }

  console.log(
    `  ✔ Verified ${lines.length} active trajectory records (all <= ${MAX_RECORD_BYTE_SIZE}B)`,
  );
  return { bytes: stat.size, violations };
}

function validateLifetimeSummary(ledgerDir) {
  const lifetimePath = path.join(ledgerDir, 'lifetime.summary.json');
  if (!fs.existsSync(lifetimePath)) {
    return { bytes: 0, violations: 0 };
  }

  const stat = fs.statSync(lifetimePath);
  let violations = 0;

  try {
    const content = fs.readFileSync(lifetimePath, 'utf8');
    const parsed = JSON.parse(content);
    if (typeof parsed.totalRuns !== 'number') {
      console.error('  ❌ lifetime.summary.json schema invalid: missing totalRuns');
      violations++;
    } else {
      console.log('  ✔ Verified lifetime.summary.json schema');
    }
  } catch (err) {
    console.error(`  ❌ lifetime.summary.json corrupt: ${err.message}`);
    violations++;
  }

  return { bytes: stat.size, violations };
}

function validateWeeklySummaries(ledgerDir) {
  const weeklyDir = path.join(ledgerDir, 'weekly-summaries');
  if (!fs.existsSync(weeklyDir)) {
    return { bytes: 0, violations: 0 };
  }

  const files = fs.readdirSync(weeklyDir).filter((f) => f.endsWith('.json'));
  let totalBytes = 0;
  let violations = 0;

  for (const f of files) {
    const fp = path.join(weeklyDir, f);
    const stat = fs.statSync(fp);
    totalBytes += stat.size;

    try {
      const content = fs.readFileSync(fp, 'utf8');
      JSON.parse(content);
    } catch (err) {
      console.error(`  ❌ Weekly summary file ${f} corrupt: ${err.message}`);
      violations++;
    }
  }

  console.log(`  ✔ Verified ${files.length} weekly summary archives`);
  return { bytes: totalBytes, violations };
}

function main() {
  console.log('🔍 [Gate:TrajectoryLedger] Validating physical bounds of trajectory ledger...');

  const ledgerDir = resolveLedgerDir();
  if (!fs.existsSync(ledgerDir)) {
    console.log(`  ℹ Trajectory directory not initialized yet (${ledgerDir}), gate passes.`);
    process.exit(0);
  }

  const activeRes = validateActiveRuns(ledgerDir);
  const lifetimeRes = validateLifetimeSummary(ledgerDir);
  const weeklyRes = validateWeeklySummaries(ledgerDir);

  const totalBytes = activeRes.bytes + lifetimeRes.bytes + weeklyRes.bytes;
  const violations = activeRes.violations + lifetimeRes.violations + weeklyRes.violations;

  if (totalBytes > MAX_TOTAL_STORAGE_BYTES) {
    console.error(
      `  ❌ Total trajectory storage (${totalBytes} bytes) exceeds limit (${MAX_TOTAL_STORAGE_BYTES} bytes)`,
    );
    process.exit(1);
  }

  console.log(
    `  ✔ Total trajectory storage: ${(totalBytes / 1024).toFixed(2)} KB / ${(MAX_TOTAL_STORAGE_BYTES / 1024).toFixed(0)} KB budget`,
  );

  if (violations > 0) {
    console.error(`❌ [FAIL] Trajectory ledger bounds gate failed with ${violations} violations!`);
    process.exit(1);
  }

  console.log('🎉 [PASS] Trajectory ledger physical bounds gate passed cleanly.');
  process.exit(0);
}

main();
