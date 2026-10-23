/**
 * Module: Defensive Security — Taint-Guarded Sandbox Directory Cleanup Template
 * File Path: .agents/skills/defensive-security-and-taint-safety/templates/safe-sandbox-cleanup.js
 * Architecture Role: Reference implementation of three-step taint verification before recursive deletion.
 * Dependencies & Triggers: Node.js standard libraries (fs, os, path); invoked by skill validation or test cleanup.
 * Responsibilities:
 *   1. Reject empty, root, home-directory, or path-traversal targets before touching the filesystem (GUARD-DESTR-001).
 *   2. Assert the resolved target resides strictly inside an authorized sandbox root with depth >= 1 (EXT-DIR-001).
 *   3. Run built-in positive and negative self-probes proving dangerous paths are deterministically blocked.
 * Exit Semantics & Design Rationale: Exits 0 when self-probes pass; exits 1 if any guard fails to discriminate.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Verifies whether `candidatePath` is safe for recursive deletion under `sandboxRoot`.
 *
 * @param {object} params - Validation parameters.
 * @param {string} params.sandboxRoot - Authorized parent directory (e.g. os.tmpdir() or repo scratch dir).
 * @param {string} params.candidatePath - Target directory requested for deletion.
 * @returns {{ ok: boolean, resolvedPath: string, reason: string }} Explicit validation verdict.
 */
function verifySafeRemovalTarget(params) {
  const { sandboxRoot, candidatePath } = params || {};
  if (typeof sandboxRoot !== 'string' || sandboxRoot.trim().length === 0) {
    return { ok: false, resolvedPath: '', reason: 'sandboxRoot must be a non-empty string' };
  }
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    return { ok: false, resolvedPath: '', reason: 'candidatePath must be a non-empty string (GUARD-DESTR-001)' };
  }

  const trimmed = candidatePath.trim();
  if (trimmed === '/' || trimmed === '\\' || trimmed === '~' || trimmed.startsWith('~/')) {
    return { ok: false, resolvedPath: '', reason: 'root or home shorthand is prohibited (GUARD-DESTR-001)' };
  }

  const resolvedRoot = path.resolve(sandboxRoot);
  const resolvedTarget = path.resolve(resolvedRoot, trimmed);
  const homeDir = path.resolve(os.homedir());
  const parsedRoot = path.parse(resolvedTarget).root;

  if (resolvedTarget === parsedRoot || resolvedTarget === homeDir) {
    return { ok: false, resolvedPath: resolvedTarget, reason: 'resolved target points to filesystem root or home' };
  }

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      ok: false,
      resolvedPath: resolvedTarget,
      reason: 'target escapes sandboxRoot boundary (EXT-DIR-001)',
    };
  }

  return { ok: true, resolvedPath: resolvedTarget, reason: 'verified inside sandbox boundary' };
}

/**
 * Executes a guarded recursive removal only after passing `verifySafeRemovalTarget`.
 *
 * @param {object} params - Removal parameters.
 * @param {string} params.sandboxRoot - Authorized parent directory.
 * @param {string} params.candidatePath - Target directory to remove.
 * @returns {string} The removed resolved path.
 */
function removeSandboxSubdirSafely(params) {
  const verdict = verifySafeRemovalTarget(params);
  if (!verdict.ok) {
    throw new Error(`[GUARD-DESTR-001] Refusing destructive removal: ${verdict.reason}`);
  }
  if (fs.existsSync(verdict.resolvedPath)) {
    fs.rmSync(verdict.resolvedPath, { recursive: true, force: true });
  }
  return verdict.resolvedPath;
}

function runSelfProbes() {
  const sandboxRoot = path.join(os.tmpdir(), 'agy-safe-sandbox-probe');
  const blockedSamples = [
    { sandboxRoot, candidatePath: '' },
    { sandboxRoot, candidatePath: '/' },
    { sandboxRoot, candidatePath: '~' },
    { sandboxRoot, candidatePath: '.' },
    { sandboxRoot, candidatePath: '../escaped-dir' },
    { sandboxRoot, candidatePath: os.homedir() },
  ];

  for (const sample of blockedSamples) {
    const res = verifySafeRemovalTarget(sample);
    if (res.ok) {
      throw new Error(`Self-probe failed: dangerous sample was not blocked: ${JSON.stringify(sample)}`);
    }
  }

  const valid = verifySafeRemovalTarget({ sandboxRoot, candidatePath: 'run-session-01/artifacts' });
  if (!valid.ok) {
    throw new Error(`Self-probe failed: valid sandbox child was rejected: ${valid.reason}`);
  }
}

if (require.main === module) {
  runSelfProbes();
  console.log('✔ [PASS] Safe sandbox cleanup taint probes verified successfully.');
}

module.exports = Object.freeze({
  verifySafeRemovalTarget,
  removeSandboxSubdirSafely,
  runSelfProbes,
});
