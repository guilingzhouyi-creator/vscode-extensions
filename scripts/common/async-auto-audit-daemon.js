/**
 * Module: Workspace Async Governance — VSCode Scheduled Background Audit & Commit Daemon
 * File Path: scripts/common/async-auto-audit-daemon.js
 * Architecture Role: Engineering development/testing edition of the asynchronous continuous
 *   quality audit and Git auto-commit loop (launched automatically on VSCode folderOpen).
 * Dependencies & Triggers: Consumes auto-refactor dist daemon/snapshot handlers and ./lib/async-*
 *   helpers for fingerprinting, 10D/ADR-Q extraction, atomic locking, and hybrid Git commits.
 * Responsibilities:
 *   1. Poll lightweight workspace fingerprints at 15s cadence with 20s debounce & 60s cooldown;
 *   2. Execute immutable snapshot review emitting 10D scores, ADR-Q metrics, SQALE, CAI & AAS;
 *   3. Persist `.audit-logs/async-auto-audit-latest.*` artifacts and yield when Taxis is active;
 *   4. Drive periodic single-project Git commits via Hybrid Staging Coordinator.
 * Exit Semantics & Design Rationale: Exits 0 on graceful shutdown, pause, or Taxis handoff.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { persistAsyncAuditEnvelope, readPauseState, acquireDaemonPidLock } = require('./lib/async-audit-envelope');
const {
  collectSnapshotEntries,
  computeWorkspaceFingerprint,
  inspectTaxisKernelOwnership,
} = require('./lib/async-audit-snapshot');
const { extractTenDimensions, buildQuantMetrics } = require('./lib/async-quant-metrics');
const { evaluateAndRunAutoCommit } = require('./lib/async-auto-commit');
const { buildEloc5dSummary } = require('./lib/workspace-eloc-rollup');
const cli = require('./lib/async-audit-cli');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');
const MIN_HEALTHY_SCORE = 50;

function loadAutoRefactorDaemonModule(repoRoot) {
  const roots = [path.resolve(repoRoot), DEFAULT_REPO_ROOT];
  for (const baseRoot of roots) {
    const candidate = path.join(baseRoot, 'auto-refactor', 'dist', 'daemon', 'index.js');
    if (fs.existsSync(candidate)) return require(candidate);
  }
  return null;
}

function resolveFullAnalyzerMap(repoRoot) {
  const roots = [path.resolve(repoRoot), DEFAULT_REPO_ROOT];
  for (const baseRoot of roots) {
    const cfgPath = path.join(baseRoot, 'auto-refactor', 'dist', 'core', 'config', 'config.js');
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const { BUILTIN_ANALYZERS } = require(cfgPath);
      if (Array.isArray(BUILTIN_ANALYZERS) && BUILTIN_ANALYZERS.length > 0) {
        const map = {};
        for (const name of BUILTIN_ANALYZERS) map[name] = { enabled: true };
        return map;
      }
    } catch {
      // Fallback to daemon default analyzer selection when dist config cannot be required.
    }
  }
  return undefined;
}

async function executeSnapshotReview(repoRoot, entries, options) {
  const daemonMod = loadAutoRefactorDaemonModule(repoRoot);
  if (!daemonMod || entries.length === 0) return null;
  const fullAnalyzers = resolveFullAnalyzerMap(repoRoot);
  const scanConfig = {
    root: repoRoot,
    archetype: options.archetype || 'library',
    logLevel: 'silent',
    cacheEnabled: false,
    persistGovernanceSnapshot: false,
    ...(fullAnalyzers ? { analyzers: fullAnalyzers } : {}),
  };
  const warmResult = await daemonMod.trySnapshotScan({ root: repoRoot, config: scanConfig, entries });
  return warmResult || daemonMod.handleSnapshotScan(scanConfig, entries);
}

/**
 * Execute one immutable asynchronous snapshot review and optional auto-commit evaluation.
 * ASYNC-CONCURRENCY: Protected by file locks during `.audit-logs/` persistence and `.git/` staging.
 *
 * @param {string} repoRoot - Target repository root.
 * @param {object} [options] - Control flags (`noAutoCommit`, `autoCommitOptions`, `dryRun`).
 * @returns {Promise<object>} Result summary (`status`, `envelope`, `autoCommitStatus`).
 */
async function runAsyncAuditCycle(repoRoot, options = {}) {
  const taxisState = inspectTaxisKernelOwnership(repoRoot);
  if (taxisState.active) return { status: 'yielded-to-taxis', taxisState };

  const pauseState = readPauseState(repoRoot);
  if (pauseState.auditPaused) return { status: 'paused', pauseState };

  const fp = computeWorkspaceFingerprint(repoRoot);
  const entries = collectSnapshotEntries(repoRoot, {
    maxEntries: options.maxEntries,
    maxTotalBytes: options.maxTotalBytes,
  });
  const scanResult = await executeSnapshotReview(repoRoot, entries, options);
  const report = scanResult?.report || {
    summary: { filesScanned: entries.length, issuesTotal: 0, bySeverity: { error: 0, warning: 0, info: 0 } },
    issues: [],
  };
  const tenDimensions = extractTenDimensions(report);
  const quantMetrics = await buildQuantMetrics(repoRoot, report, tenDimensions);
  const eloc5dSummary = buildEloc5dSummary(repoRoot);
  const errorCount = Number(report?.summary?.bySeverity?.error ?? 0);
  const healthy = errorCount === 0 && tenDimensions.compositeScore >= MIN_HEALTHY_SCORE;

  const autoCommitStatus = evaluateAndRunAutoCommit(repoRoot, {
    ...(options.autoCommitOptions || {}),
    disabled: Boolean(options.noAutoCommit),
    commitPaused: pauseState.commitPaused,
    dryRun: Boolean(options.dryRun),
    fingerprint: fp.fingerprint,
    latestAudit: { healthy, tenDimensions, quantMetrics },
  });

  const envelope = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    mode: 'vscode-async',
    headOid: fp.headOid,
    fingerprint: fp.fingerprint,
    healthy,
    filesCaptured: entries.length,
    issuesSummary: report.summary || { issuesTotal: 0 },
    tenDimensions,
    rawTenDimensions: { ...tenDimensions },
    quantMetrics,
    eloc5dSummary,
    aasReport: scanResult?.stats?.aas || null,
    autoCommitStatus,
  };
  persistAsyncAuditEnvelope(repoRoot, envelope);
  return { status: 'completed', envelope, autoCommitStatus };
}

async function evaluateDaemonTick(config, loopState) {
  const now = Date.now();
  const fpState = computeWorkspaceFingerprint(config.root);
  if (fpState.fingerprint !== loopState.lastSeenFp) {
    loopState.lastSeenFp = fpState.fingerprint;
    loopState.lastChangedAt = now;
  }
  const changeReady =
    now - loopState.lastChangedAt >= config.debounceMs &&
    now - loopState.lastAuditAt >= config.cooldownMs &&
    loopState.lastChangedAt > loopState.lastAuditAt;
  const due = changeReady || now - loopState.lastAuditAt >= config.reconcileMs;
  if (loopState.inFlight || !due) return;
  loopState.inFlight = true;
  try {
    await runAsyncAuditCycle(config.root, { noAutoCommit: config.noAutoCommit });
    loopState.lastAuditAt = Date.now();
  } catch (err) {
    process.stderr.write(`[async-audit] cycle failed: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    loopState.inFlight = false;
  }
}

async function runDaemonLoop(config) {
  const pidLock = acquireDaemonPidLock(config.root);
  if (!pidLock.acquired) {
    process.stdout.write(`[async-audit] daemon already active (pid=${pidLock.existingPid}); exiting\n`);
    return;
  }
  let running = true;
  const loopState = { lastSeenFp: '', lastChangedAt: 0, lastAuditAt: 0, inFlight: false };
  const stop = () => { running = false; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    while (running) {
      const taxis = inspectTaxisKernelOwnership(config.root);
      if (taxis.active) {
        process.stdout.write(`[async-audit] yielding to live Taxis daemon (pid=${taxis.pid})\n`);
        break;
      }
      await evaluateDaemonTick(config, loopState);
      await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    pidLock.release();
  }
}

async function main() {
  const config = cli.parseCliArgs(process.argv.slice(2), DEFAULT_REPO_ROOT);
  if (config.status) {
    const st = cli.getDaemonStatus(config.root);
    const line = `[async-audit] running=${st.running} taxis=${st.taxisKernelActive} score=${st.latestScore} (${st.latestGrade})`;
    cli.printDaemonJsonOrLine(config.json, st, line);
    return;
  }
  if (config.once) {
    const out = await runAsyncAuditCycle(config.root, { noAutoCommit: config.noAutoCommit });
    const td = out.envelope?.tenDimensions;
    const line = `[async-audit] status=${out.status} score=${td?.compositeScore ?? 'N/A'} (${td?.grade ?? 'N/A'}) commit=${out.autoCommitStatus?.action ?? 'n/a'}`;
    cli.printDaemonJsonOrLine(config.json, out, line);
    return;
  }
  await runDaemonLoop(config);
}

if (require.main === module) {
  void main().catch((err) => {
    process.stderr.write(`[async-audit] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_POLL_MS: cli.DEFAULT_POLL_MS,
  DEFAULT_DEBOUNCE_MS: cli.DEFAULT_DEBOUNCE_MS,
  DEFAULT_COOLDOWN_MS: cli.DEFAULT_COOLDOWN_MS,
  DEFAULT_RECONCILE_MS: cli.DEFAULT_RECONCILE_MS,
  extractTenDimensions,
  buildQuantMetrics,
  runAsyncAuditCycle,
  getDaemonStatus: cli.getDaemonStatus,
  parseCliArgs: (argv) => cli.parseCliArgs(argv, DEFAULT_REPO_ROOT),
};
