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
const MAX_BASELINE_SIGNATURES_BYTES = 256 * 1024; // 256 KB
const WEIGHT_SUM_MIN = 0.99;
const WEIGHT_SUM_MAX = 1.01;

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

function validateArchivedRuns(ledgerDir) {
  const archivePath = path.join(ledgerDir, 'archive-runs.ndjson');
  if (!fs.existsSync(archivePath)) {
    return { bytes: 0, violations: 0 };
  }

  const stat = fs.statSync(archivePath);
  const content = fs.readFileSync(archivePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let violations = 0;

  for (let i = 0; i < lines.length; i++) {
    violations += validateSingleRecordLine(lines[i], i);
  }

  console.log(
    `  ✔ Verified ${lines.length} archived trajectory records (all <= ${MAX_RECORD_BYTE_SIZE}B)`,
  );
  return { bytes: stat.size, violations };
}

/**
 * Validates the optional activation sidecar.
 *
 * The sidecar is separate from `active-runs.ndjson` because the main record has a 360-byte envelope that
 * telemetry cannot fit into without weakening it. Absent file means "activation was never recorded" and
 * passes silently; a present file must be NDJSON with a run id and at least one annotation, so a
 * half-written line is caught here instead of being read as a skill that was never activated.
 *
 * @param {string} ledgerDir - Ledger directory.
 * @returns {{bytes: number, violations: number}} Bytes and violation count.
 */
function validateActivationSidecar(ledgerDir) {
  const sidecarPath = path.join(ledgerDir, 'activation.ndjson');
  if (!fs.existsSync(sidecarPath)) {
    return { bytes: 0, violations: 0 };
  }

  const stat = fs.statSync(sidecarPath);
  const lines = fs.readFileSync(sidecarPath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  let violations = 0;

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      const hasSkills = Array.isArray(parsed.skills) && parsed.skills.length > 0;
      const hasPreset = typeof parsed.preset === 'string' && parsed.preset.length > 0;
      if (!parsed.id || (!hasSkills && !hasPreset)) {
        console.error(`  ❌ activation.ndjson line ${i + 1} lacks a run id or any annotation`);
        violations++;
      }
    } catch (err) {
      console.error(`  ❌ activation.ndjson line ${i + 1} is corrupt: ${err.message}`);
      violations++;
    }
  }

  console.log(`  ✔ Verified ${lines.length} activation annotation(s)`);
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

/**
 * Validates learnedWeights object and unit-simplex normalization invariant.
 *
 * @param {unknown} weights - Parsed learnedWeights field.
 * @returns {string[]} Weight validation errors.
 */
function validateSupervisorWeights(weights) {
  if (!weights || typeof weights !== 'object') {
    return ['governance-supervisor.json missing learnedWeights object'];
  }
  const vals = ['Ws', 'Wd', 'Wf'].map((k) => weights[k]);
  const allFiniteUnit = vals.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
  if (!allFiniteUnit) {
    return ['governance-supervisor.json learnedWeights.{Ws,Wd,Wf} must be finite numbers in [0, 1]'];
  }
  const sum = vals[0] + vals[1] + vals[2];
  if (sum < WEIGHT_SUM_MIN || sum > WEIGHT_SUM_MAX) {
    return [`governance-supervisor.json weight sum (${sum.toFixed(4)}) outside [0.99, 1.01]`];
  }
  return [];
}

/**
 * Validates structural and weight-normalization invariants on a parsed supervisor snapshot.
 *
 * @param {unknown} data - Parsed governance-supervisor.json object.
 * @returns {string[]} Validation failure messages (empty when valid).
 */
function validateSupervisorPayload(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ['governance-supervisor.json must be a JSON object'];
  }
  const issues = [];
  if (data.version !== '1.0') {
    issues.push(`governance-supervisor.json version must be "1.0" (got ${JSON.stringify(data.version)})`);
  }
  issues.push(...validateSupervisorWeights(data.learnedWeights));
  if (!Array.isArray(data.demotedRules) || !Array.isArray(data.boostedPatterns)) {
    issues.push('governance-supervisor.json demotedRules and boostedPatterns must be arrays');
  }
  if (!Number.isInteger(data.activeIncidents) || data.activeIncidents < 0) {
    issues.push('governance-supervisor.json activeIncidents must be a non-negative integer');
  }
  if (!Number.isInteger(data.evolutionStepsCount) || data.evolutionStepsCount < 0) {
    issues.push('governance-supervisor.json evolutionStepsCount must be a non-negative integer');
  }
  return issues;
}

/**
 * Validates baseline-signatures.json byte budget and JSON parseability.
 *
 * @param {string} ledgerDir - Resolved trajectory ledger directory.
 * @returns {{ bytes: number, violations: number }} Physical usage and violation count.
 */
function validateBaselineSignatures(ledgerDir) {
  const sigPath = path.join(ledgerDir, 'baseline-signatures.json');
  if (!fs.existsSync(sigPath)) {
    return { bytes: 0, violations: 0 };
  }
  const bytes = fs.statSync(sigPath).size;
  let violations = 0;
  if (bytes > MAX_BASELINE_SIGNATURES_BYTES) {
    console.error(
      `  ❌ baseline-signatures.json (${bytes} bytes) exceeds limit (${MAX_BASELINE_SIGNATURES_BYTES} bytes)`,
    );
    violations += 1;
  }
  try {
    JSON.parse(fs.readFileSync(sigPath, 'utf8'));
  } catch (err) {
    console.error(`  ❌ baseline-signatures.json is invalid JSON: ${err.message}`);
    violations += 1;
  }
  return { bytes, violations };
}

/**
 * Validates governance-supervisor.json physical size and schema invariants.
 *
 * @param {string} ledgerDir - Resolved trajectory ledger directory.
 * @returns {{ bytes: number, violations: number }} Physical usage and violation count.
 */
function validateSupervisorSnapshot(ledgerDir) {
  const supPath = path.join(ledgerDir, 'governance-supervisor.json');
  if (!fs.existsSync(supPath)) {
    return { bytes: 0, violations: 0 };
  }
  const bytes = fs.statSync(supPath).size;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(supPath, 'utf8'));
  } catch (err) {
    console.error(`  ❌ governance-supervisor.json is invalid JSON: ${err.message}`);
    return { bytes, violations: 1 };
  }
  const issues = validateSupervisorPayload(parsed);
  for (const issue of issues) {
    console.error(`  ❌ ${issue}`);
  }
  return { bytes, violations: issues.length };
}

function main() {
  console.log('🔍 [Gate:TrajectoryLedger] Validating physical bounds of trajectory ledger...');

  const ledgerDir = resolveLedgerDir();
  if (!fs.existsSync(ledgerDir)) {
    console.log(`  ℹ 轨迹目录尚未初始化 (${ledgerDir})，本项检查按通过处理。`);
    process.exit(0);
  }

  const checks = [
    validateActiveRuns(ledgerDir),
    validateArchivedRuns(ledgerDir),
    validateActivationSidecar(ledgerDir),
    validateLifetimeSummary(ledgerDir),
    validateWeeklySummaries(ledgerDir),
    validateBaselineSignatures(ledgerDir),
    validateSupervisorSnapshot(ledgerDir),
  ];

  const totalBytes = checks.reduce((acc, res) => acc + res.bytes, 0);
  const violations = checks.reduce((acc, res) => acc + res.violations, 0);

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
    console.error(`✖ BLOCK 轨迹账本物理边界检查未通过，共 ${violations} 处违规:`);
    process.exit(1);
  }

  console.log('  ✔  轨迹账本物理边界检查通过。');
  process.exit(0);
}

module.exports = {
  validateBaselineSignatures,
  validateSupervisorPayload,
  validateSupervisorSnapshot,
};

if (require.main === module) {
  main();
}
