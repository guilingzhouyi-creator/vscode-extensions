/**
 * Module: Parallel Workspace Governance Guard Orchestrator
 * File Path: scripts/common/run-workspace-guards.js
 * Architecture Role: Executes bounded-concurrency batches of workspace governance guards from the
 *   ordered registry in lib/workspace-guard-catalog.js so audit-all.ps1, audit-all.sh, and CI
 *   share one execution core.
 * Dependencies & Triggers: Node.js standard libraries (child_process, fs, os, path) and
 *   ./lib/workspace-guard-catalog; invoked by scripts/ps1/audit-all.ps1, scripts/sh/audit-all.sh,
 *   CI hygiene, and local CLI runs.
 * Responsibilities:
 *   1. Run guards from GUARD_GROUPS in bounded parallel workers reserving 1 vCPU core;
 *   2. Persist deterministic per-guard stdout/stderr logs when `--log-dir <dir>` is supplied;
 *   3. Emit an ordered `codes` array and per-guard metadata map under `--json`, or ordered
 *      human-readable verdicts in interactive/CI mode;
 *   4. Re-export catalog registries (`PILLAR2_GUARDS`, `GUARD_GROUPS`, `buildListPayload`).
 * Exit Semantics & Design Rationale: 0 = every guard in the selected group exited 0, 1 = at least
 *   one guard exited non-zero, 2 = invalid CLI arguments or unknown guard group. Preserving exact
 *   guard order in `codes` lets downstream failure collectors and summary renderers attribute
 *   blockers without spawning 23 sequential Node processes from shell loops.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  PILLAR2_GUARDS,
  GUARD_GROUPS,
  GUARD_META_BY_ID,
  buildListPayload,
} = require('./lib/workspace-guard-catalog');

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Computes bounded parallel worker concurrency while reserving 1 vCPU core.
 *
 * @returns {number} Bounded worker pool size in [2, 6].
 */
function resolveWorkerConcurrency() {
  const cpuCount = os.cpus().length || 2;
  return Math.max(2, Math.min(6, cpuCount - 1));
}

/**
 * Parses CLI flags into an immutable configuration object.
 *
 * @param {string[]} argv - Command-line arguments excluding node executable and script path.
 * @returns {{ group: string, logDir: string, json: boolean, listJson: boolean, help: boolean, error: string }}
 */
function parseCliArgs(argv) {
  const state = { group: 'pillar2', logDir: '', json: false, listJson: false, help: false, error: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { state.json = true; continue; }
    if (arg === '--list-json') { state.listJson = true; continue; }
    if (arg === '--help' || arg === '-h') { state.help = true; continue; }
    if (arg === '--group' || arg === '--log-dir') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) return { ...state, error: `${arg} requires a value` };
      if (arg === '--group') state.group = next;
      else state.logDir = next;
      i += 1;
      continue;
    }
    return { ...state, error: `Unknown argument: ${arg}` };
  }
  if (!GUARD_GROUPS[state.group]) return { ...state, error: `Unknown guard group: ${state.group}` };
  return state;
}

/**
 * Resolves the deterministic log file path for one guard when logging is enabled.
 *
 * @param {string} logDir - Resolved log directory or empty string.
 * @param {number} index - Zero-based guard index.
 * @param {string} guardId - Guard identifier.
 * @returns {string} Absolute log file path, or empty string when disabled.
 */
function buildLogPath(logDir, index, guardId) {
  if (!logDir) return '';
  return path.join(logDir, `${String(index).padStart(2, '0')}-${guardId}.out.log`);
}

/**
 * Writes combined stdout and stderr for one guard into its deterministic log file.
 *
 * @param {string} logFile - Target log file path or empty string.
 * @param {string} stdoutText - Captured stdout text.
 * @param {string} stderrText - Captured stderr text.
 * @param {number} exitCode - Child process exit code.
 * @param {boolean} suppressStderrOnPass - Whether stderr is probe noise on clean runs.
 * @returns {void}
 */
function writeGuardLog(logFile, stdoutText, stderrText, exitCode, suppressStderrOnPass) {
  if (!logFile) return;
  const includeStderr = Boolean(stderrText) && (exitCode !== 0 || !suppressStderrOnPass);
  const body = includeStderr && stdoutText
    ? `${stdoutText.trimEnd()}\n${stderrText}`
    : (includeStderr ? stderrText : stdoutText);
  fs.writeFileSync(logFile, body || '', 'utf8');
}

/**
 * Executes a single guard script as an isolated Node child process.
 *
 * @param {object} guard - Guard descriptor.
 * @param {number} index - Zero-based index inside the group.
 * @param {string} logDir - Resolved log directory or empty string.
 * @returns {Promise<{ index: number, id: string, script: string, exitCode: number, logFile: string, durationMs: number, stdout: string, stderr: string }>}
 */
function executeOneGuard(guard, index, logDir) {
  const startedAt = Date.now();
  const logFile = buildLogPath(logDir, index, guard.id);
  const absScript = path.join(REPO_ROOT, guard.script);
  const buildRecord = (exitCode, stdout, stderr) => ({
    index, id: guard.id, script: guard.script, exitCode, logFile,
    durationMs: Date.now() - startedAt, stdout, stderr,
  });

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [absScript, ...guard.args], {
      cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    const outChunks = [];
    const errChunks = [];
    child.stdout.on('data', (chunk) => outChunks.push(chunk));
    child.stderr.on('data', (chunk) => errChunks.push(chunk));
    child.on('error', (err) => {
      const stderrText = err && err.message ? `${err.message}\n` : 'Failed to spawn child process\n';
      writeGuardLog(logFile, '', stderrText, 1, false);
      resolve(buildRecord(1, '', stderrText));
    });
    child.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : 1;
      const stdoutText = Buffer.concat(outChunks).toString('utf8');
      const stderrText = Buffer.concat(errChunks).toString('utf8');
      writeGuardLog(logFile, stdoutText, stderrText, exitCode, guard.suppressStderrOnPass);
      resolve(buildRecord(exitCode, stdoutText, stderrText));
    });
  });
}

/**
 * Runs a list of guards with bounded worker concurrency and preserves declaration order.
 *
 * @param {Array<object>} guards - Guard descriptors.
 * @param {number} concurrency - Maximum concurrent child processes.
 * @param {string} logDir - Resolved log directory or empty string.
 * @returns {Promise<Array<object>>} Ordered guard execution records.
 */
async function runGuardsInPool(guards, concurrency, logDir) {
  const results = new Array(guards.length);
  let cursor = 0;

  async function worker() {
    while (cursor < guards.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await executeOneGuard(guards[index], index, logDir);
    }
  }

  const workerCount = Math.min(concurrency, guards.length);
  const workers = [];
  for (let w = 0; w < workerCount; w += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Merges a raw guard execution record with its registered metadata.
 *
 * @param {object} item - Guard execution result.
 * @returns {object} Enriched result entry for JSON payloads.
 */
function formatGuardResultEntry(item) {
  const meta = GUARD_META_BY_ID.get(item.id) || {};
  const cmd = item.cmd || meta.cmd || (item.script ? `node ${item.script}` : '');
  return {
    id: item.id,
    name: item.name || meta.name || item.id,
    cmd,
    fix: item.fix || meta.fix || '',
    verifyCmd: item.verifyCmd || meta.verifyCmd || cmd,
    aasLayer: item.aasLayer || meta.aasLayer || 'L5_GOVERNANCE',
    exitCode: item.exitCode,
    logFile: item.logFile,
    durationMs: item.durationMs,
  };
}

/**
 * Formats ordered guard execution results into the JSON contract consumed by audit-all runners.
 *
 * @param {string} group - Group name.
 * @param {number} concurrency - Worker concurrency used.
 * @param {number} durationMs - Total wall-clock elapsed time in milliseconds.
 * @param {Array<object>} results - Ordered guard execution records.
 * @returns {object} JSON summary payload.
 */
function buildJsonPayload(group, concurrency, durationMs, results) {
  const codes = results.map((item) => item.exitCode);
  const logs = results.map((item) => item.logFile);
  const guards = {};
  const compactResults = [];
  let failedCount = 0;

  for (const item of results) {
    if (item.exitCode !== 0) failedCount += 1;
    const entry = formatGuardResultEntry(item);
    guards[item.id] = entry;
    compactResults.push({ ...entry, index: item.index, script: item.script });
  }

  return {
    group,
    passed: failedCount === 0,
    total: results.length,
    failedCount,
    concurrency,
    durationMs,
    codes,
    logs,
    guards,
    results: compactResults,
  };
}

/**
 * Emits human-readable ordered guard output and failure diagnostics.
 *
 * @param {string} group - Group name.
 * @param {number} concurrency - Worker concurrency used.
 * @param {number} durationMs - Total wall-clock elapsed time in milliseconds.
 * @param {Array<object>} results - Ordered guard execution records.
 * @returns {void}
 */
function emitHumanReport(group, concurrency, durationMs, results) {
  const failed = results.filter((item) => item.exitCode !== 0);
  for (const item of results) {
    if (item.stdout && item.stdout.trim()) process.stdout.write(`${item.stdout.trimEnd()}\n`);
    if (item.exitCode !== 0 && item.stderr && item.stderr.trim()) process.stderr.write(`${item.stderr.trimEnd()}\n`);
  }
  const passedCount = results.length - failed.length;
  if (failed.length === 0) {
    console.log(`✔ workspace-guards (${group}): ${passedCount}/${results.length} passed in ${durationMs}ms (workers=${concurrency})`);
    return;
  }
  console.error(`✖ BLOCK workspace-guards (${group}): ${failed.length}/${results.length} failed (${failed.map((item) => item.id).join(', ')}) in ${durationMs}ms`);
}

/**
 * Command-line entry point.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log('Usage: node scripts/common/run-workspace-guards.js [--group pillar2] [--log-dir <dir>] [--json] [--list-json]');
    process.exit(0);
  }
  if (cli.error) {
    console.error(`✖ BLOCK workspace-guards: ${cli.error}`);
    process.exit(2);
  }

  const guards = GUARD_GROUPS[cli.group];
  if (cli.listJson) {
    process.stdout.write(`${JSON.stringify(buildListPayload(guards), null, 2)}\n`);
    process.exit(0);
  }
  const resolvedLogDir = cli.logDir ? path.resolve(cli.logDir) : '';
  if (resolvedLogDir) fs.mkdirSync(resolvedLogDir, { recursive: true });

  const concurrency = resolveWorkerConcurrency();
  const startedAt = Date.now();
  const results = await runGuardsInPool(guards, concurrency, resolvedLogDir);
  const durationMs = Date.now() - startedAt;
  const payload = buildJsonPayload(cli.group, concurrency, durationMs, results);

  if (cli.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else emitHumanReport(cli.group, concurrency, durationMs, results);
  process.exit(payload.passed ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`✖ BLOCK workspace-guards: ${err && err.stack ? err.stack : String(err)}`);
    process.exit(1);
  });
}

module.exports = Object.freeze({
  PILLAR2_GUARDS,
  GUARD_GROUPS,
  resolveWorkerConcurrency,
  parseCliArgs,
  buildListPayload,
  buildJsonPayload,
  runGuardsInPool,
});
