/**
 * Module: Local Git Commit-Gate Receipt Engine Self-Test Suite
 * File Path: scripts/common/gate-receipts-selftest.js
 * Architecture Role: Isolated self-verification orchestrator for gate-receipts.js.
 *   Materializes ephemeral Git repositories in OS temp storage, drives lifecycle
 *   and adversarial integrity suites, and restores hook environment on exit.
 * Dependencies & Triggers: Consumes Node.js `path` plus `./lib/gate-receipts-selftest-*`.
 *   Triggered by `gate-receipts.js selftest`.
 * Responsibilities:
 *   1. Isolate parent Git hook environment variables and manage temp repo lifetime;
 *   2. Execute core receipt/ref-governance assertions and security tamper checks;
 *   3. Return deterministic pass/block exit codes from aggregated test verdicts.
 * Exit Semantics & Design Rationale: Exports `runSelftest(cliPath, cfg)` returning
 *   0 when every case passes and 1 on any assertion failure or setup exception.
 */

'use strict';

const path = require('path');
const {
  EXIT_BLOCK,
  detachGitEnvironment,
  restoreGitEnvironment,
  expectSelftestGit,
  createSelftestRepo,
  cleanupSelftestRepo,
  reportSelftest,
} = require('./lib/gate-receipts-selftest-helpers');
const { buildCoreSelftestCases } = require('./lib/gate-receipts-selftest-core');
const { buildSecuritySelftestCases } = require('./lib/gate-receipts-selftest-security');

/**
 * Runs the full isolated selftest suite against a gate-receipts CLI entrypoint.
 *
 * @param {string} cliPath - Absolute path to `gate-receipts.js`.
 * @param {object} cfg - Engine schema, filename, and environment constants.
 * @returns {number} Exit status code (0 on pass, 1 on failure).
 */
function runSelftest(cliPath, cfg) {
  const saved = detachGitEnvironment();
  const repo = createSelftestRepo();
  const previousKeyEnv = process.env[cfg.receiptKeyEnv];
  process.env[cfg.receiptKeyEnv] = path.join(repo.dir, 'receipt.key');
  try {
    const gitDir = expectSelftestGit(repo.dir, ['rev-parse', '--absolute-git-dir'], '自测读取 gitDir');
    const receiptsDir = path.join(gitDir, cfg.receiptsDirname);
    const ctx = { repo, cliPath, receiptsDir, cfg };
    const { baseSha, cases: coreCases } = buildCoreSelftestCases(ctx);
    const securityCases = buildSecuritySelftestCases(ctx, baseSha);
    return reportSelftest([...coreCases, ...securityCases]);
  } catch (error) {
    process.stderr.write(`FAIL selftest 执行异常: ${error.message}\n`);
    return EXIT_BLOCK;
  } finally {
    if (previousKeyEnv === undefined) delete process.env[cfg.receiptKeyEnv];
    else process.env[cfg.receiptKeyEnv] = previousKeyEnv;
    cleanupSelftestRepo(repo.dir);
    restoreGitEnvironment(saved);
  }
}

module.exports = { runSelftest };
