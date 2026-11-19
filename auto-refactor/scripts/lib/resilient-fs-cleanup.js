/**
 * Module: Verification Utility — Windows-Resilient Temporary Directory Cleanup
 * File Path: auto-refactor/scripts/lib/resilient-fs-cleanup.js
 * Architecture Role: Shared synchronous removal helper for verification harnesses that create
 *   and tear down scratch workspaces under parallel audit-all load on Windows.
 * Dependencies & Triggers: Uses Node.js built-in `fs` and `Atomics.wait` on a 4-byte
 *   `SharedArrayBuffer`; imported by verification scripts such as validate-review-memory.js.
 * Responsibilities:
 *   1. Delegate recursive removal to `fs.rmSync` with `maxRetries: 6` and `retryDelay: 40`;
 *   2. Retry synchronously with bounded 50..250 ms `Atomics.wait` backoff on transient Windows
 *      file-lock error codes (`EPERM`, `EBUSY`, `ENOTEMPTY`);
 *   3. Treat `ENOENT` as already-cleaned and rethrow unexpected non-transient failures.
 * Exit Semantics & Design Rationale: Pure library helper exporting `rmSyncWithRetry`. Throws on
 *   non-transient errors or retry exhaustion so real permission defects are never masked.
 */

'use strict';

const fs = require('fs');

const TRANSIENT_LOCK_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
const BACKOFF_MS = Object.freeze([50, 100, 150, 200, 250]);
const WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_RM_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 6,
  retryDelay: 40,
});

/**
 * Sleeps synchronously without spawning child processes or busy-waiting.
 *
 * @param {number} delayMs - Backoff duration in milliseconds.
 */
function sleepSync(delayMs) {
  if (delayMs <= 0) return;
  Atomics.wait(WAIT_SIGNAL, 0, 0, delayMs);
}

/**
 * Resolves normalized removal options with resilient retry defaults.
 *
 * @param {import('fs').RmOptions} [options] - Optional caller overrides for `fs.rmSync`.
 * @returns {import('fs').RmOptions} Effective removal options.
 */
function resolveRmOptions(options) {
  if (!options || typeof options !== 'object') {
    return DEFAULT_RM_OPTIONS;
  }
  return {
    recursive: options.recursive !== undefined ? options.recursive : DEFAULT_RM_OPTIONS.recursive,
    force: options.force !== undefined ? options.force : DEFAULT_RM_OPTIONS.force,
    maxRetries: options.maxRetries !== undefined ? options.maxRetries : DEFAULT_RM_OPTIONS.maxRetries,
    retryDelay: options.retryDelay !== undefined ? options.retryDelay : DEFAULT_RM_OPTIONS.retryDelay,
  };
}

/**
 * Removes a file or directory synchronously with bounded Windows transient lock retries.
 *
 * Under multi-way parallel test execution on Windows, antivirus scanners, search indexers,
 * or recently exited child processes can briefly hold handles after `fs.rmSync` exhausts its
 * built-in retries, surfacing `EPERM`, `EBUSY`, or `ENOTEMPTY`. Wrapping `fs.rmSync` in an
 * `Atomics.wait` backoff loop absorbs those transient locks while ignoring `ENOENT`.
 *
 * @param {string} targetPath - Path to file or temporary directory to remove.
 * @param {import('fs').RmOptions} [options] - Optional overrides for `fs.rmSync`.
 * @returns {void}
 */
function rmSyncWithRetry(targetPath, options) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new TypeError('rmSyncWithRetry requires a non-empty targetPath string');
  }

  const rmOptions = resolveRmOptions(options);
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    try {
      fs.rmSync(targetPath, rmOptions);
      return;
    } catch (err) {
      const code = err && typeof err.code === 'string' ? err.code : '';
      if (code === 'ENOENT') {
        return;
      }
      if (!TRANSIENT_LOCK_CODES.has(code) || attempt >= BACKOFF_MS.length) {
        throw err;
      }
      sleepSync(BACKOFF_MS[attempt]);
    }
  }
}

module.exports = Object.freeze({
  TRANSIENT_LOCK_CODES,
  BACKOFF_MS,
  rmSyncWithRetry,
});
