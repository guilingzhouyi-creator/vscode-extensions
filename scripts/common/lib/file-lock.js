/**
 * Module: Tooling — Lightweight Cross-Platform File & Directory Advisory Mutex
 * File Path: scripts/common/lib/file-lock.js
 * Architecture Role: Provides cross-process advisory locking for telemetry ledgers and
 *   snapshot singletons in .audit-logs/, preventing torn writes and race conditions
 *   under concurrent SubAgent or test executions.
 * Dependencies & Triggers: Pure Node.js built-ins (fs, path, os); consumed by
 *   gate-telemetry-logger.js, log-rotator.js, and record-workspace-audit.js.
 * Responsibilities:
 *   1. Atomic lock acquisition using OS-level directory creation (mkdirSync);
 *   2. Automatic stale lock eviction (default 30s TTL) to prevent permanent deadlocks;
 *   3. Zero-CPU synchronous exponential backoff sleep via Atomics.wait;
 *   4. Safe resource release in try...finally closures.
 * Exit Semantics & Design Rationale: Fails soft when lock cannot be acquired within
 *   timeout, allowing primary gate and commit flows to proceed without hard blocking.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '..', '.audit-logs');
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_TTL_MS = 30000; // 30 seconds
const INITIAL_RETRY_MS = 25;
const MAX_RETRY_MS = 250;

/**
 * Synchronous zero-CPU sleep using Atomics.wait on a SharedArrayBuffer.
 *
 * @param {number} ms - Milliseconds to sleep
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Fallback busy loop if SharedArrayBuffer is restricted
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}

/**
 * Safely removes a stale lock directory.
 *
 * @param {string} lockPath - Absolute path to lock directory
 */
function removeLockDirSafely(lockPath) {
  try {
    const metaFile = path.join(lockPath, 'meta.json');
    if (fs.existsSync(metaFile)) {
      try {
        fs.unlinkSync(metaFile);
      } catch {
        // Ignore secondary unlink error
      }
    }
    fs.rmdirSync(lockPath);
  } catch {
    // Best effort removal
  }
}

/**
 * Evaluates whether an existing lock directory is stale (exceeded TTL).
 *
 * @param {string} lockPath - Absolute path to lock directory
 * @param {number} staleTtlMs - Maximum allowed lock duration in ms
 * @returns {boolean} True if lock has expired
 */
function isLockStale(lockPath, staleTtlMs) {
  try {
    const metaFile = path.join(lockPath, 'meta.json');
    if (fs.existsSync(metaFile)) {
      const raw = fs.readFileSync(metaFile, 'utf8');
      const meta = JSON.parse(raw);
      if (typeof meta.ts === 'number') {
        return Date.now() - meta.ts > staleTtlMs;
      }
    }
    const stat = fs.statSync(lockPath);
    return Date.now() - stat.mtimeMs > staleTtlMs;
  } catch {
    return false;
  }
}

/**
 * Acquires a synchronous advisory lock using atomic directory creation.
 *
 * @param {string} lockName - Base name of the lock resource (e.g. 'telemetry-ledger')
 * @param {object} [options] - Lock options
 * @returns {{ release: Function, acquired: boolean }} Lock handle
 */
function acquireLockSync(lockName, options = {}) {
  const baseDir = options.lockDir || DEFAULT_LOG_DIR;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const cleanName = lockName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockPath = path.join(baseDir, `${cleanName}.lock`);
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const staleTtlMs = Number.isInteger(options.staleTtlMs) ? options.staleTtlMs : DEFAULT_STALE_TTL_MS;

  const deadline = Date.now() + timeoutMs;
  let retryMs = INITIAL_RETRY_MS;

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath);
      // Successfully created lock directory; record metadata
      try {
        const meta = {
          pid: process.pid,
          ts: Date.now(),
          lockName,
        };
        fs.writeFileSync(path.join(lockPath, 'meta.json'), JSON.stringify(meta), 'utf8');
      } catch {
        // Meta write is non-fatal
      }

      let released = false;
      return {
        acquired: true,
        release: () => {
          if (released) return;
          released = true;
          removeLockDirSafely(lockPath);
        },
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        if (isLockStale(lockPath, staleTtlMs)) {
          removeLockDirSafely(lockPath);
          continue;
        }
        sleepSync(retryMs);
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      } else {
        // Unexpected filesystem error; fail soft without throwing
        break;
      }
    }
  }

  // Failed to acquire lock within timeout; return no-op release handle
  return {
    acquired: false,
    release: () => {},
  };
}

/**
 * Executes a callback protected by an advisory file lock.
 * Guarantees release in try...finally.
 *
 * @param {string} lockName - Resource name
 * @param {Function} callback - Function to execute
 * @param {object} [options] - Lock options
 * @returns {*} Return value of callback
 */
function withFileLock(lockName, callback, options = {}) {
  const lock = acquireLockSync(lockName, options);
  try {
    return callback(lock.acquired);
  } finally {
    lock.release();
  }
}

module.exports = {
  acquireLockSync,
  withFileLock,
  sleepSync,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_STALE_TTL_MS,
};
