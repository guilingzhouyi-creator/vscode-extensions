/**
 * Module: Tooling — Workspace Gate Run Telemetry & Diagnostic Logger
 * File Path: scripts/common/gate-telemetry-logger.js
 * Architecture Role: Centralized telemetry and persistent snapshot authority for gate
 *   executions (pre-commit, pre-push) across PowerShell and Bash isomorphic runners.
 * Dependencies & Triggers: Pure Node.js built-ins (fs, path, os, child_process) plus
 *   gate-failure-contract.js; invoked at the completion of pre-commit and pre-push gates.
 * Responsibilities:
 *   1. Atomic persistence of singleton gate snapshot (.audit-logs/<gate>-latest.json);
 *   2. Append-only chronological telemetry ledger (.audit-logs/<gate>-history.jsonl) with FIFO rotation;
 *   3. Enforce standardized failure diagnostic log output (last-<gate>.log) and failure envelope (last-failure.json);
 *   4. Provide fast CLI inspection interface (--latest, --history, --view, --record).
 * Exit Semantics & Design Rationale: Exits 0 on clean execution, 1 on CLI error; fails soft
 *   programmatically so logging I/O exceptions never block Git commit or push workflows.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  stripAnsi,
  sanitizePath,
  ensureLf,
  buildFailureLogHeader,
} = require('./gate-failure-contract');

const UTF8 = 'utf8';
const PROTOCOL_VERSION = '1.0.0';
const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '..', '.audit-logs');
const FAILURE_SNAPSHOT_NAME = 'last-failure.json';

const STATUS_PASS = 'PASS';
const STATUS_BLOCK = 'BLOCK';
const STATUS_SKIP = 'SKIP';
const VALID_GATES = Object.freeze(['pre-commit', 'pre-push']);

const MAX_HISTORY_LINES = 2000;
const RETAIN_HISTORY_LINES = 1500;
const MAX_HISTORY_BYTES = 1024 * 1024; // 1 MB
const RECENT_HISTORY_LIMIT = 15;
const DEFAULT_GIT_REV = '00000000';

/**
 * Ensures the target audit log directory exists.
 *
 * @param {string} logDir - Target directory path
 */
function ensureLogDirectory(logDir = DEFAULT_LOG_DIR) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Resolves current Git short revision with safe fallback.
 *
 * @param {string} rootDir - Workspace root directory
 * @returns {string} 8-character commit hash or default
 */
function getGitRevision(rootDir = path.resolve(__dirname, '..', '..')) {
  try {
    const out = execSync('git rev-parse --short HEAD', {
      cwd: rootDir,
      encoding: UTF8,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) return out.slice(0, 8);
  } catch {
    // Best-effort git resolution fallback
  }
  return DEFAULT_GIT_REV;
}

/**
 * Atomically writes file content using staged temporary swap.
 *
 * @param {string} filePath - Target file path
 * @param {string} content - Text content to write
 */
function writeAtomicFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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
 * Rotates history ledger file when line count or byte budget is exceeded.
 *
 * @param {string} ledgerPath - Absolute path to jsonl file
 */
function rotateHistoryLedgerIfNeeded(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return;
  try {
    const stat = fs.statSync(ledgerPath);
    const isOverBytes = stat.size >= MAX_HISTORY_BYTES;

    const raw = fs.readFileSync(ledgerPath, UTF8);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const isOverLines = lines.length > MAX_HISTORY_LINES;

    if (!isOverBytes && !isOverLines) {
      return;
    }

    const retained = lines.slice(-RETAIN_HISTORY_LINES);
    writeAtomicFileSync(ledgerPath, retained.join('\n') + '\n');
  } catch {
    // Fail soft without throwing
  }
}

/**
 * Formats diagnostic report lines for last-<gate>.log.
 *
 * @param {object} payload - Normalized telemetry payload
 * @returns {string} Clean diagnostic log body
 */
function buildGateDiagnosticLog(payload) {
  const gate = payload.gate;
  const isBlock = payload.status === STATUS_BLOCK;
  const timestamp = payload.timestamp || new Date().toISOString();
  const rev = payload.gitRevision || DEFAULT_GIT_REV;
  const elapsed = Number(payload.durationMs || 0);

  const header = buildFailureLogHeader({
    pillarId: gate === 'pre-commit' ? 'hygiene-01' : 'governance',
    stepId: payload.failures?.[0]?.stepId || `${gate}-runner`,
    ruleId: payload.failures?.[0]?.ruleId || (isBlock ? 'GUARD-SYS-001' : 'RULE-PASS'),
    command: payload.failures?.[0]?.command || `pwsh -File scripts/ps1/${gate}-gate.ps1`,
    workingDir: payload.failures?.[0]?.targetFiles?.[0] || '.',
    exitCode: isBlock ? 1 : 0,
    elapsedMs: elapsed,
    recordedAt: timestamp,
    gitRevision: rev,
    stream: 'err',
  });

  const lines = [header];
  lines.push(`Gate:       ${gate}`);
  lines.push(`Status:     ${payload.status}`);
  lines.push(`Files:      ${payload.filesCount ?? 0}`);
  lines.push(`Duration:   ${elapsed} ms`);

  if (payload.stepsSummary) {
    const s = payload.stepsSummary;
    lines.push(`Steps:      Total=${s.total ?? 0}, Passed=${s.passed?.length ?? 0}, Failed=${s.failed?.length ?? 0}, Skipped=${s.skipped?.length ?? 0}`);
  }

  if (Array.isArray(payload.failures) && payload.failures.length > 0) {
    lines.push('\n[FAILED STEPS]');
    payload.failures.forEach((f, idx) => {
      lines.push(`  ${idx + 1}. [${f.stepId || 'STEP'}] ${f.ruleId ? '(' + f.ruleId + ') ' : ''}${f.summary || 'Step failed'}`);
      if (f.command) lines.push(`     Command: ${f.command}`);
      if (f.actionableFix) lines.push(`     Fix:     ${f.actionableFix}`);
      if (f.verificationCommand) lines.push(`     Verify:  ${f.verificationCommand}`);
    });
  }

  if (payload.rawLogOutput) {
    lines.push('\n[RAW DIAGNOSTIC OUTPUT]');
    lines.push(sanitizePath(stripAnsi(payload.rawLogOutput)));
  }

  return ensureLf(lines.join('\n'));
}

/**
 * Builds structured Agent failure envelope object matching the workspace contract.
 *
 * @param {object} payload - Normalized telemetry payload
 * @returns {object} Validated failure envelope
 */
function buildAgentFailureEnvelope(payload) {
  const gate = payload.gate;
  const primaryFailure = (payload.failures && payload.failures[0]) || {};
  const stepId = primaryFailure.stepId || `${gate}-unknown-step`;
  const ruleId = primaryFailure.ruleId || 'GUARD-SYS-001';
  const failedCommand = primaryFailure.command || primaryFailure.verificationCommand || '';
  const summary = primaryFailure.summary || `${gate} gate check encountered violations.`;
  const exitCode = Number.isInteger(primaryFailure.exitCode) ? primaryFailure.exitCode : 1;
  const targetFiles = Array.isArray(primaryFailure.targetFiles) ? primaryFailure.targetFiles : [];

  const violations = (payload.failures || []).map((f) => ({
    ruleId: f.ruleId || ruleId,
    severity: STATUS_BLOCK,
    file: (f.targetFiles && f.targetFiles[0]) || '.',
    message: f.summary || `Step ${f.stepId} failed with exit code ${f.exitCode ?? 1}`,
    actionableFix: f.actionableFix || 'Resolve reported errors.',
    verificationCommand: f.verificationCommand || f.command || '',
  }));

  const verificationCommand = primaryFailure.verificationCommand || failedCommand || `pwsh -File scripts/ps1/${gate}-gate.ps1`;
  const fastRecheckCommand = gate === 'pre-commit'
    ? 'pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent'
    : 'pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent';

  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: payload.timestamp || new Date().toISOString(),
    status: STATUS_BLOCK,
    gate,
    step: primaryFailure.stepName || stepId,
    stepTitle: primaryFailure.stepName || stepId,
    stepId,
    failedCommand,
    exitCode,
    summary,
    logFile: `.audit-logs/last-${gate}.log`,
    violations,
    agentDirectives: {
      targetFiles,
      remediationPriority: [ruleId],
      verificationCommand,
      fastRecheckCommand,
    },
  };
}

/**
 * Normalizes input telemetry payload.
 *
 * @param {object} raw - Raw telemetry input
 * @returns {object} Normalized payload
 */
function normalizeGatePayload(raw) {
  const gate = VALID_GATES.includes(raw.gate) ? raw.gate : 'pre-commit';
  const status = raw.status === STATUS_BLOCK ? STATUS_BLOCK : raw.status === STATUS_SKIP ? STATUS_SKIP : STATUS_PASS;
  const timestamp = raw.timestamp || new Date().toISOString();
  const gitRevision = raw.gitRevision || getGitRevision();
  const durationMs = Math.max(0, Math.round(Number(raw.durationMs || 0)));
  const filesCount = Math.max(0, Math.round(Number(raw.filesCount || 0)));

  const rawSummary = raw.stepsSummary || {};
  const stepsSummary = {
    total: Number(rawSummary.total || 0),
    passed: Array.isArray(rawSummary.passed) ? rawSummary.passed : [],
    failed: Array.isArray(rawSummary.failed) ? rawSummary.failed : [],
    skipped: Array.isArray(rawSummary.skipped) ? rawSummary.skipped : [],
  };

  const failures = Array.isArray(raw.failures)
    ? raw.failures.map((f) => ({
      stepId: String(f.stepId || 'unknown-step'),
      stepName: f.stepName ? String(f.stepName) : undefined,
      ruleId: f.ruleId ? String(f.ruleId) : undefined,
      exitCode: Number.isInteger(f.exitCode) ? f.exitCode : 1,
      command: f.command ? sanitizePath(String(f.command)) : undefined,
      summary: f.summary ? stripAnsi(String(f.summary)) : undefined,
      details: f.details ? stripAnsi(String(f.details)) : undefined,
      actionableFix: f.actionableFix ? stripAnsi(String(f.actionableFix)) : undefined,
      verificationCommand: f.verificationCommand ? sanitizePath(String(f.verificationCommand)) : undefined,
      targetFiles: Array.isArray(f.targetFiles) ? f.targetFiles.map((p) => sanitizePath(String(p))) : [],
    }))
    : [];

  return {
    protocolVersion: PROTOCOL_VERSION,
    gate,
    timestamp,
    gitRevision,
    status,
    durationMs,
    filesCount,
    stepsCount: stepsSummary.total,
    passedSteps: stepsSummary.passed,
    failedSteps: stepsSummary.failed,
    skippedSteps: stepsSummary.skipped,
    failures,
    rawLogOutput: raw.rawLogOutput ? ensureLf(stripAnsi(raw.rawLogOutput)) : undefined,
    agentDirectives: {
      fastRecheckCommand: gate === 'pre-commit'
        ? 'pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent'
        : 'pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent',
    },
  };
}

/**
 * Records gate run telemetry, writes singleton snapshot, appends to ledger,
 * and updates failure diagnostics when blocked.
 *
 * @param {object} rawPayload - Raw telemetry data
 * @param {string} [logDir] - Custom audit log directory
 * @returns {boolean} True on success, false on error
 */
function recordGateTelemetry(rawPayload, logDir = DEFAULT_LOG_DIR) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return false;
  }

  try {
    ensureLogDirectory(logDir);
    const normalized = normalizeGatePayload(rawPayload);
    const gate = normalized.gate;

    // 1. Persist singleton snapshot: <gate>-latest.json
    const snapshotPath = path.join(logDir, `${gate}-latest.json`);
    const snapshotContent = ensureLf(JSON.stringify(normalized, null, 2));
    writeAtomicFileSync(snapshotPath, snapshotContent);

    // 2. Append compact chronological ledger entry: <gate>-history.jsonl
    const historyPath = path.join(logDir, `${gate}-history.jsonl`);
    const compactEntry = JSON.stringify({
      ts: normalized.timestamp,
      rev: normalized.gitRevision,
      gate,
      status: normalized.status,
      ms: normalized.durationMs,
      files: normalized.filesCount,
      passed: normalized.passedSteps.length,
      failed: normalized.failedSteps.length,
      skipped: normalized.skippedSteps.length,
    });
    fs.appendFileSync(historyPath, compactEntry + '\n', UTF8);
    rotateHistoryLedgerIfNeeded(historyPath);

    // 3. Persist diagnostic log: last-<gate>.log
    const logPath = path.join(logDir, `last-${gate}.log`);
    const diagnosticContent = buildGateDiagnosticLog(normalized);
    writeAtomicFileSync(logPath, diagnosticContent);

    // 4. If status is BLOCK, update last-failure.json
    if (normalized.status === STATUS_BLOCK) {
      const failureEnvelope = buildAgentFailureEnvelope(normalized);
      const failurePath = path.join(logDir, FAILURE_SNAPSHOT_NAME);
      writeAtomicFileSync(failurePath, ensureLf(JSON.stringify(failureEnvelope, null, 2)));
    }

    return true;
  } catch (err) {
    process.stderr.write(`WARN [Gate-Telemetry] 写入门禁遥测日志失败: ${err.message}\n`);
    return false;
  }
}

/**
 * Reads the latest recorded gate snapshot from disk.
 *
 * @param {string} gate - 'pre-commit' or 'pre-push'
 * @param {string} [logDir] - Custom audit log directory
 * @returns {object|null} Parsed snapshot or null
 */
function readLatestGateSnapshot(gate, logDir = DEFAULT_LOG_DIR) {
  const snapshotPath = path.join(logDir, `${gate}-latest.json`);
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(snapshotPath, UTF8));
  } catch {
    return null;
  }
}

/**
 * Reads recent history ledger entries for a gate.
 *
 * @param {string} gate - 'pre-commit' or 'pre-push'
 * @param {string} [logDir] - Custom audit log directory
 * @param {number} [limit=15] - Maximum entries to return
 * @returns {Array<object>} Parsed history records (latest last)
 */
function readGateHistoryLedger(gate, logDir = DEFAULT_LOG_DIR, limit = RECENT_HISTORY_LIMIT) {
  const historyPath = path.join(logDir, `${gate}-history.jsonl`);
  if (!fs.existsSync(historyPath)) return [];
  try {
    const raw = fs.readFileSync(historyPath, UTF8);
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const sliced = lines.slice(-limit);
    return sliced.map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/**
 * Prints formatted CLI history view.
 *
 * @param {string} gate - 'pre-commit' or 'pre-push'
 * @param {string} [logDir] - Custom audit log directory
 */
function displayGateHistory(gate, logDir = DEFAULT_LOG_DIR) {
  const entries = readGateHistoryLedger(gate, logDir, RECENT_HISTORY_LIMIT);
  if (entries.length === 0) {
    console.log(`ℹ️ 未检测到 ${gate} 历史运行记录。`);
    return;
  }

  console.log(`\n=================================================================`);
  console.log(`📈 【${gate.toUpperCase()} 门禁历史轨迹】 (最近 ${entries.length} 次记录)`);
  console.log(`=================================================================`);
  console.log(`时间 (UTC)             | Commit   | 状态  | 耗时(ms) | 文件数 | 通过/失败`);
  console.log(`-----------------------------------------------------------------`);
  for (const e of entries) {
    const timeStr = (e.ts || '').replace('T', ' ').slice(0, 19);
    const revStr = (e.rev || DEFAULT_GIT_REV).padEnd(8);
    const statusStr = e.status === STATUS_PASS ? '✔ PASS ' : '✖ BLOCK';
    const msStr = String(e.ms ?? 0).padStart(8);
    const filesStr = String(e.files ?? 0).padStart(6);
    const stepStr = `${e.passed ?? 0}/${e.failed ?? 0}`.padStart(9);
    console.log(`${timeStr} | ${revStr} | ${statusStr} | ${msStr} | ${filesStr} | ${stepStr}`);
  }
  console.log(`=================================================================\n`);
}

/**
 * Prints formatted CLI latest run summary.
 *
 * @param {string} gate - 'pre-commit' or 'pre-push'
 * @param {string} [logDir] - Custom audit log directory
 */
function displayGateLatest(gate, logDir = DEFAULT_LOG_DIR) {
  const snapshot = readLatestGateSnapshot(gate, logDir);
  if (!snapshot) {
    console.log(`ℹ️ 未检测到 ${gate} 最近一次运行快照。`);
    return;
  }

  console.log(`\n=================================================================`);
  console.log(`🔍 【${gate.toUpperCase()} 最近一次门禁运行快照】`);
  console.log(`=================================================================`);
  console.log(`记录时间: ${snapshot.timestamp}`);
  console.log(`Git 提交: ${snapshot.gitRevision}`);
  console.log(`判定状态: ${snapshot.status === STATUS_PASS ? '✔ PASS (通过)' : '✖ BLOCK (阻断)'}`);
  console.log(`执行耗时: ${snapshot.durationMs} ms`);
  console.log(`影响文件: ${snapshot.filesCount} 个`);
  console.log(`步骤统计: 通过 ${snapshot.passedSteps?.length ?? 0} 项，失败 ${snapshot.failedSteps?.length ?? 0} 项，跳过 ${snapshot.skippedSteps?.length ?? 0} 项`);

  if (snapshot.failures && snapshot.failures.length > 0) {
    console.log(`-----------------------------------------------------------------`);
    console.log(`【失败步骤详情】:`);
    snapshot.failures.forEach((f, idx) => {
      console.log(`  ${idx + 1}. [${f.stepId}] ${f.summary || '未通过'}`);
      if (f.ruleId) console.log(`     规则: ${f.ruleId}`);
      if (f.actionableFix) console.log(`     建议: ${f.actionableFix}`);
      if (f.verificationCommand) console.log(`     验证: ${f.verificationCommand}`);
    });
  }
  console.log(`=================================================================\n`);
}

/**
 * Handles the --record-file CLI argument.
 *
 * @param {string[]} args - Process arguments
 * @returns {boolean} True if argument handled
 */
function handleRecordFileCli(args) {
  if (!args.includes('--record-file')) return false;
  const fileIdx = args.indexOf('--record-file');
  const filePath = args[fileIdx + 1];
  if (filePath && fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, UTF8);
      const payload = JSON.parse(raw);
      const ok = recordGateTelemetry(payload);
      try { fs.unlinkSync(filePath); } catch {}
      process.exit(ok ? 0 : 1);
    } catch (err) {
      process.stderr.write(`✖ [Gate-Telemetry] 读取或写入失败: ${err.message}\n`);
      process.exit(1);
    }
  }
  process.exit(1);
}

/**
 * Handles the --record CLI argument (via inline arg or stdin).
 *
 * @param {string[]} args - Process arguments
 * @returns {boolean} True if argument handled
 */
function handleRecordCli(args) {
  if (!args.includes('--record')) return false;
  let raw = '';
  const idx = args.indexOf('--record');
  if (args[idx + 1] && !args[idx + 1].startsWith('--')) {
    raw = args[idx + 1];
  } else {
    try {
      raw = fs.readFileSync(0, UTF8);
    } catch {
      raw = '';
    }
  }
  if (!raw || raw.trim().length === 0) {
    process.exit(0);
  }
  try {
    const payload = JSON.parse(raw);
    const ok = recordGateTelemetry(payload);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    process.stderr.write(`✖ [Gate-Telemetry] 解析或写入失败: ${err.message}\n`);
    process.exit(1);
  }
}

/**
 * Handles display inspection flags (--latest, --history, --view).
 *
 * @param {string[]} args - Process arguments
 * @param {string} gateArg - Target gate identifier
 */
function handleDisplayCli(args, gateArg) {
  if (args.includes('--history')) {
    displayGateHistory(gateArg);
    process.exit(0);
  }
  displayGateLatest(gateArg);
  process.exit(0);
}

/**
 * CLI Entry point dispatcher.
 */
function main() {
  const args = process.argv.slice(2);
  const gateArg = args.find((a) => a === 'pre-commit' || a === 'pre-push') || 'pre-commit';

  if (handleRecordFileCli(args)) return;
  if (handleRecordCli(args)) return;
  handleDisplayCli(args, gateArg);
}

if (require.main === module) {
  main();
}

module.exports = {
  PROTOCOL_VERSION,
  STATUS_PASS,
  STATUS_BLOCK,
  STATUS_SKIP,
  VALID_GATES,
  recordGateTelemetry,
  readLatestGateSnapshot,
  readGateHistoryLedger,
  normalizeGatePayload,
  buildGateDiagnosticLog,
  buildAgentFailureEnvelope,
  rotateHistoryLedgerIfNeeded,
};
