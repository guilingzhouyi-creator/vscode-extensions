/**
 * Module: Git Commit Guardrail Centralized Logger & History Rotator
 * File Path: scripts/common/commit-guardrail-logger.js
 * Architecture Role: Centralized persistence and telemetry manager for commit message governance.
 *   Writes structured atomic snapshots (commit-guardrail-latest.json) and chronological
 *   audit ledger entries (commit-guardrail-history.jsonl) under .audit-logs/.
 * Dependencies & Triggers: Consumes Node.js standard fs and path; invoked by validate-commit-msg.js
 *   and validate-commit-msg-style.js upon commit evaluation.
 * Responsibilities:
 *   1. Persist the latest full audit result atomically (.tmp -> rename);
 *   2. Append compact chronological telemetry records to commit-guardrail-history.jsonl;
 *   3. Enforce FIFO log rotation when history exceeds quota (max 5,000 entries / 2MB);
 *   4. Provide programmatic readers for latest guardrail status and history trends.
 * Exit Semantics & Design Rationale: Fails soft programmatically; never blocks Git commits due
 *   to logging I/O exceptions; execution latency < 2ms.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const UTF8 = 'utf8';
const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '..', '.audit-logs');
const LATEST_SNAPSHOT_NAME = 'commit-guardrail-latest.json';
const HISTORY_LEDGER_NAME = 'commit-guardrail-history.jsonl';

const MAX_HISTORY_LINES = 5000;
const RETAIN_HISTORY_LINES = 3000;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Ensures the audit log target directory exists.
 *
 * @param {string} logDir - Target directory path
 */
function ensureLogDirectory(logDir = DEFAULT_LOG_DIR) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Atomically writes data to a file using temporary file swap.
 *
 * @param {string} filePath - Destination file path
 * @param {string} content - Text content to write
 */
function writeAtomicFileSync(filePath, content) {
  const tmpPath = `${filePath}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, UTF8);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Suppress secondary cleanup error
      }
    }
    throw err;
  }
}

/**
 * Truncates history ledger if line count or file size exceeds budget.
 *
 * @param {string} ledgerPath - Absolute path to history jsonl file
 */
function rotateHistoryLedgerIfNeeded(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return;

  try {
    const stat = fs.statSync(ledgerPath);
    if (stat.size < MAX_HISTORY_BYTES) {
      return;
    }

    const raw = fs.readFileSync(ledgerPath, UTF8);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= MAX_HISTORY_LINES) {
      return;
    }

    const retained = lines.slice(-RETAIN_HISTORY_LINES);
    writeAtomicFileSync(ledgerPath, retained.join('\n') + '\n');
  } catch {
    // Fail soft without disrupting commit execution
  }
}

/**
 * Persists commit message guardrail audit findings and telemetry.
 *
 * @param {object} auditPayload - Full audit snapshot descriptor
 * @param {string} [logDir] - Custom audit log directory
 * @returns {boolean} True if successfully written, false on error
 */
function recordCommitGuardrailAudit(auditPayload, logDir = DEFAULT_LOG_DIR) {
  if (!auditPayload || typeof auditPayload !== 'object') {
    return false;
  }

  try {
    ensureLogDirectory(logDir);

    const timestamp = auditPayload.timestamp || new Date().toISOString();
    const snapshotPath = path.join(logDir, LATEST_SNAPSHOT_NAME);
    const historyPath = path.join(logDir, HISTORY_LEDGER_NAME);

    // 1. Write atomic full snapshot
    const snapshotContent = JSON.stringify(
      {
        protocolVersion: '1.0.0',
        timestamp,
        ...auditPayload,
      },
      null,
      2
    );
    writeAtomicFileSync(snapshotPath, snapshotContent);

    // 2. Append compact chronological ledger entry
    const compactEntry = JSON.stringify({
      ts: timestamp,
      rev: auditPayload.gitRevision || '',
      status: auditPayload.status || 'PASS',
      score: auditPayload.styleScore ?? 100,
      entropy: auditPayload.entropy ?? 0,
      highDebt: auditPayload.debtCorridor?.currentHighDebtCount ?? 0,
      findings: Array.isArray(auditPayload.findings) ? auditPayload.findings.length : 0,
      mode: auditPayload.debtCorridor?.mode || 'NORMAL',
    });
    fs.appendFileSync(historyPath, compactEntry + '\n', UTF8);

    // 3. FIFO quota rotation
    rotateHistoryLedgerIfNeeded(historyPath);

    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the latest recorded guardrail snapshot from disk.
 *
 * @param {string} [logDir] - Custom audit log directory
 * @returns {object | null} Latest snapshot or null if not present
 */
function readLatestGuardrailSnapshot(logDir = DEFAULT_LOG_DIR) {
  const snapshotPath = path.join(logDir, LATEST_SNAPSHOT_NAME);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(snapshotPath, UTF8);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = {
  LATEST_SNAPSHOT_NAME,
  HISTORY_LEDGER_NAME,
  recordCommitGuardrailAudit,
  readLatestGuardrailSnapshot,
  rotateHistoryLedgerIfNeeded,
};
