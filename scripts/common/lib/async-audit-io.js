/**
 * Module: Workspace Async Governance — Atomic I/O, PID Liveness & Scheduler State
 * File Path: scripts/common/lib/async-audit-io.js
 * Architecture Role: Shared low-level filesystem, lock-guarded JSON persistence, pause flag, and
 *   PID liveness primitives consumed by async-audit-envelope.js and async-auto-commit.js.
 * Dependencies & Triggers: Pure Node.js built-ins (fs, path) and ./file-lock.
 * Responsibilities:
 *   1. Resolve isolated `.audit-logs` directory paths without modifying tracked repo files;
 *   2. Perform atomic sibling temp-write + retry-rename UTF-8 persistence (`writeAtomicUtf8`);
 *   3. Read/save scheduler state, pause sentinels, and OS PID liveness checks safely.
 * Exit Semantics & Design Rationale: Uses bounded Windows transient-lock retries on rename and
 *   clean temp-file cleanup on failure so torn reads cannot observe partial JSON.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { withFileLock, sleepSync } = require('./file-lock');

let tempWriteSeq = 0;

const AUDIT_LOG_DIR_NAME = '.audit-logs';
const FILE_LATEST_JSON = 'async-auto-audit-latest.json';
const FILE_LATEST_AAS = 'async-auto-audit-latest.aas.json';
const FILE_LATEST_MD = 'async-auto-audit-latest.md';
const FILE_HISTORY_JSONL = 'async-audit-history.jsonl';
const FILE_STATE_JSON = 'async-auto-audit-state.json';
const FILE_PID_LOCK = 'async-auto-audit.pid';
const FILE_PAUSE_ALL = 'async-auto-audit.pause';
const FILE_PAUSE_COMMIT = 'async-auto-audit.commit.pause';
const MAX_HISTORY_ENTRIES = 500;
const AUDIT_LOCK_NAME = 'async-auto-audit-telemetry';
const WIN32_RENAME_ATTEMPTS = 6;
const WIN32_RETRY_BACKOFF_MS = 5;

function resolveAuditLogDir(repoRoot) {
  return path.join(path.resolve(repoRoot), AUDIT_LOG_DIR_NAME);
}

function isTransientRenameError(err) {
  return Boolean(err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES'));
}

function removeTempFileQuietly(tmpPath) {
  try {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  } catch (cleanupErr) {
    process.stderr.write(`[async-audit-io] temp cleanup skipped: ${cleanupErr.message}\n`);
  }
}

function writeAtomicUtf8(targetPath, content) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp-${process.pid}-${++tempWriteSeq}`;
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  fs.writeFileSync(tmpPath, normalized, 'utf8');
  const maxAttempts = process.platform === 'win32' ? WIN32_RENAME_ATTEMPTS : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      if (isTransientRenameError(err) && attempt < maxAttempts) {
        sleepSync(attempt * WIN32_RETRY_BACKOFF_MS);
        continue;
      }
      removeTempFileQuietly(tmpPath);
      throw err;
    }
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    void err;
    return fallback;
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function readPauseState(repoRoot) {
  const logDir = resolveAuditLogDir(repoRoot);
  return {
    auditPaused: fs.existsSync(path.join(logDir, FILE_PAUSE_ALL)),
    commitPaused: fs.existsSync(path.join(logDir, FILE_PAUSE_COMMIT)),
  };
}

function loadSchedulerState(repoRoot) {
  const logDir = resolveAuditLogDir(repoRoot);
  return readJsonSafe(path.join(logDir, FILE_STATE_JSON), {});
}

function saveSchedulerState(repoRoot, nextState) {
  const logDir = resolveAuditLogDir(repoRoot);
  withFileLock(
    `${AUDIT_LOCK_NAME}-state`,
    () => {
      writeAtomicUtf8(path.join(logDir, FILE_STATE_JSON), JSON.stringify(nextState, null, 2));
    },
    { lockDir: logDir },
  );
}

module.exports = {
  FILE_LATEST_JSON,
  FILE_LATEST_AAS,
  FILE_LATEST_MD,
  FILE_HISTORY_JSONL,
  FILE_STATE_JSON,
  FILE_PID_LOCK,
  FILE_PAUSE_ALL,
  FILE_PAUSE_COMMIT,
  MAX_HISTORY_ENTRIES,
  AUDIT_LOCK_NAME,
  resolveAuditLogDir,
  writeAtomicUtf8,
  readJsonSafe,
  isPidAlive,
  readPauseState,
  loadSchedulerState,
  saveSchedulerState,
};
