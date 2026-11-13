/**
 * Module: Workspace Async Governance — Daemon Status Query & CLI Argument Parser
 * File Path: scripts/common/lib/async-audit-cli.js
 * Architecture Role: CLI option parser, live daemon status inspector, and concise terminal output
 *   formatter supporting ../async-auto-audit-daemon.js.
 * Dependencies & Triggers: Pure Node.js standard runtime and ./async-audit-envelope +
 *   ./async-audit-snapshot; imported by async-auto-audit-daemon.js.
 * Responsibilities:
 *   1. Parse polling/debounce/cooldown/reconcile cadence flags (`parseCliArgs`);
 *   2. Query PID lockfile, Taxis handoff ownership, pause flags, and latest score (`getDaemonStatus`);
 *   3. Render CLI output lines cleanly for `--status` and `--once` invocations.
 * Exit Semantics & Design Rationale: Isolates CLI argument/status formatting from polling loop.
 */
'use strict';

const path = require('path');
const {
  FILE_LATEST_JSON,
  FILE_PID_LOCK,
  isPidAlive,
  readJsonSafe,
  readPauseState,
  resolveAuditLogDir,
} = require('./async-audit-envelope');
const { inspectTaxisKernelOwnership } = require('./async-audit-snapshot');

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_POLL_MS = 15 * MS_PER_SECOND;
const DEFAULT_DEBOUNCE_MS = 20 * MS_PER_SECOND;
const DEFAULT_COOLDOWN_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
const DEFAULT_RECONCILE_MS = 30 * SECONDS_PER_MINUTE * MS_PER_SECOND;

function readNumericFlag(argv, flag, fallback) {
  const idx = argv.indexOf(flag);
  const nextVal = idx >= 0 ? argv[idx + 1] : '';
  return nextVal && /^\d+$/.test(nextVal) ? Number(nextVal) : fallback;
}

function readStringFlag(argv, flag, fallback) {
  const idx = argv.indexOf(flag);
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
}

/** Parse CLI arguments controlling daemon cadence and execution mode. */
function parseCliArgs(argv, defaultRoot) {
  return {
    once: argv.includes('--once'),
    status: argv.includes('--status'),
    json: argv.includes('--json'),
    noAutoCommit: argv.includes('--no-auto-commit'),
    root: path.resolve(readStringFlag(argv, '--root', defaultRoot)),
    pollMs: readNumericFlag(argv, '--poll-ms', DEFAULT_POLL_MS),
    debounceMs: readNumericFlag(argv, '--debounce-ms', DEFAULT_DEBOUNCE_MS),
    cooldownMs: readNumericFlag(argv, '--cooldown-ms', DEFAULT_COOLDOWN_MS),
    reconcileMs: readNumericFlag(argv, '--reconcile-ms', DEFAULT_RECONCILE_MS),
  };
}

/** Inspect daemon PID liveness, Taxis ownership, pause flags, and latest audit telemetry. */
function getDaemonStatus(repoRoot) {
  const logDir = resolveAuditLogDir(repoRoot);
  const pidMeta = readJsonSafe(path.join(logDir, FILE_PID_LOCK), null);
  const latest = readJsonSafe(path.join(logDir, FILE_LATEST_JSON), null);
  const pause = readPauseState(repoRoot);
  const taxis = inspectTaxisKernelOwnership(repoRoot);
  const running = Boolean(pidMeta && isPidAlive(pidMeta.pid));
  return {
    running,
    pid: running ? pidMeta.pid : null,
    startedAt: pidMeta?.startedAt || null,
    taxisKernelActive: taxis.active,
    pause,
    latestTimestamp: latest?.timestamp || null,
    latestScore: latest?.tenDimensions?.compositeScore ?? null,
    latestGrade: latest?.tenDimensions?.grade || null,
    latestAutoCommit: latest?.autoCommitStatus || null,
  };
}

/** Format and emit status or one-shot cycle summary to stdout. */
function printDaemonJsonOrLine(asJson, payload, fallbackLine) {
  const text = asJson ? JSON.stringify(payload, null, 2) : fallbackLine;
  process.stdout.write(`${text}\n`);
}

module.exports = {
  DEFAULT_POLL_MS,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_RECONCILE_MS,
  parseCliArgs,
  getDaemonStatus,
  printDaemonJsonOrLine,
};
