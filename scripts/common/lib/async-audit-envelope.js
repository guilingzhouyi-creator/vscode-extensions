/**
 * Module: Workspace Async Governance — Audit Telemetry Envelope & History Ring
 * File Path: scripts/common/lib/async-audit-envelope.js
 * Architecture Role: Locked writer and FIFO history ring manager for asynchronous review
 *   outputs in `.audit-logs/`, completely isolated from tracked workspace baselines.
 * Dependencies & Triggers: Node built-ins (fs, path), ./file-lock, and ./async-audit-io;
 *   invoked by async-auto-audit-daemon.js and unit tests.
 * Responsibilities:
 *   1. Atomically write async-auto-audit-latest.{json,aas.json,md} under advisory lock;
 *   2. Append and bound async-audit-history.jsonl to at most 500 JSONL entries;
 *   3. Enforce PID lockfile singleton ownership without touching tracked governance files.
 * Exit Semantics & Design Rationale: Delegates low-level atomic I/O to async-audit-io so file
 *   volume remains compact and single-responsibility.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { withFileLock } = require('./file-lock');
const auditIo = require('./async-audit-io');

const SCORE_DECIMALS = 2;
const PERCENT_MULTIPLIER = 100;
const TEN_DIM_ORDER = Object.freeze([
  'architectureConsistency',
  'semanticPurity',
  'codeSecurity',
  'performanceEfficiency',
  'standardization',
  'modernity',
  'maintainability',
  'commentQuality',
  'duplication',
  'techDebtRisk',
]);

function formatScore(val) {
  return typeof val === 'number' && Number.isFinite(val) ? val.toFixed(SCORE_DECIMALS) : 'N/A';
}

function acquireDaemonPidLock(repoRoot) {
  const logDir = auditIo.resolveAuditLogDir(repoRoot);
  const pidPath = path.join(logDir, auditIo.FILE_PID_LOCK);
  return withFileLock(
    `${auditIo.AUDIT_LOCK_NAME}-pid`,
    () => {
      const existing = auditIo.readJsonSafe(pidPath, null);
      if (existing && existing.pid !== process.pid && auditIo.isPidAlive(existing.pid)) {
        return { acquired: false, existingPid: existing.pid, release: () => {} };
      }
      auditIo.writeAtomicUtf8(
        pidPath,
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      );
      return {
        acquired: true,
        existingPid: null,
        release: () => {
          const current = auditIo.readJsonSafe(pidPath, null);
          if (current && current.pid === process.pid && fs.existsSync(pidPath)) {
            fs.unlinkSync(pidPath);
          }
        },
      };
    },
    { lockDir: logDir },
  );
}

function renderAsyncAuditMarkdown(envelope) {
  const { renderEloc5dMarkdown } = require('./workspace-eloc-rollup');
  const td = envelope.tenDimensions || {};
  const qm = envelope.quantMetrics || {};
  const dimRows = TEN_DIM_ORDER.map((key) => `| ${key} | ${formatScore(td[key])} |`);
  const evalLabel = Number.isInteger(td.evaluatedDimensions) ? `${td.evaluatedDimensions}/10` : '10/10';
  const elocLines = renderEloc5dMarkdown(envelope.eloc5dSummary);
  return [
    '# Async Auto-Audit Snapshot',
    '',
    `- **Timestamp**: ${envelope.timestamp}`,
    `- **Mode**: ${envelope.mode}`,
    `- **HEAD**: \`${envelope.headOid || 'unborn'}\``,
    `- **Composite Score**: **${formatScore(td.compositeScore)}** (Grade: **${td.grade || 'N/A'}**, Evaluated: ${evalLabel})`,
    `- **Workspace Health**: ${formatScore(qm.workspaceHealthScore)} | **Polyglot**: ${formatScore(qm.polyglotIndex)} | **Autonomy (CAI)**: ${formatScore((qm.autonomyRate ?? 0) * PERCENT_MULTIPLIER)}%`,
    `- **SQALE Debt**: ${formatScore(qm.sqaleMinutes)} min (TDR: ${formatScore(qm.tdr)}%)`,
    `- **Auto-Commit**: ${envelope.autoCommitStatus?.action || 'skipped'} (${envelope.autoCommitStatus?.reason || 'none'})`,
    '',
    '## Ten-Dimensional Breakdown',
    '',
    '| Dimension | Score |',
    '| :--- | ---: |',
    ...dimRows,
    '',
    '## ADR-Q Quantitative Risk Indicators',
    '',
    `- \`RCR\`: ${formatScore(qm.rcr)} | \`ERQ\`: ${formatScore(qm.erq)} | \`DDR\`: ${formatScore(qm.ddr)} | \`EDB95\`: ${formatScore(qm.edb95)}`,
    `- \`PTD\`: ${formatScore(qm.ptd)} | \`DSI\`: ${formatScore(qm.dsi)} | \`RCD\`: ${formatScore(qm.rcd)} | \`EHL\`: ${formatScore(qm.ehl)}`,
    ...elocLines,
  ].join('\n') + '\n';
}

function appendBoundedHistory(logDir, envelope, maxHistory) {
  const historyPath = path.join(logDir, auditIo.FILE_HISTORY_JSONL);
  const entry = JSON.stringify({
    timestamp: envelope.timestamp,
    mode: envelope.mode,
    headOid: envelope.headOid,
    fingerprint: envelope.fingerprint,
    tenDimensions: envelope.tenDimensions,
    quantMetrics: envelope.quantMetrics,
    eloc5dDiff: envelope.eloc5dSummary?.currentDiff || null,
    autoCommitStatus: envelope.autoCommitStatus,
  });
  const lines = fs.existsSync(historyPath)
    ? fs.readFileSync(historyPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  lines.push(entry);
  auditIo.writeAtomicUtf8(historyPath, lines.slice(-maxHistory).join('\n'));
}

function persistAsyncAuditEnvelope(repoRoot, envelope, options = {}) {
  const logDir = auditIo.resolveAuditLogDir(repoRoot);
  const maxHistory = Number.isInteger(options.maxHistory) && options.maxHistory > 0
    ? options.maxHistory
    : auditIo.MAX_HISTORY_ENTRIES;

  return withFileLock(
    auditIo.AUDIT_LOCK_NAME,
    (acquired) => {
      if (!acquired) return { written: false, locked: false };
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      auditIo.writeAtomicUtf8(path.join(logDir, auditIo.FILE_LATEST_JSON), JSON.stringify(envelope, null, 2));
      if (envelope.aasReport) {
        auditIo.writeAtomicUtf8(path.join(logDir, auditIo.FILE_LATEST_AAS), JSON.stringify(envelope.aasReport, null, 2));
      }
      auditIo.writeAtomicUtf8(path.join(logDir, auditIo.FILE_LATEST_MD), renderAsyncAuditMarkdown(envelope));
      appendBoundedHistory(logDir, envelope, maxHistory);
      return { written: true, locked: true };
    },
    { lockDir: logDir },
  );
}

module.exports = {
  ...auditIo,
  acquireDaemonPidLock,
  renderAsyncAuditMarkdown,
  persistAsyncAuditEnvelope,
};
