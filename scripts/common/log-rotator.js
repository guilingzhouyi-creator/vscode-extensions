/**
 * Module: Tooling — Workspace Audit Log & Diagnostic Rotator
 * File Path: scripts/common/log-rotator.js
 * Architecture Role: Centralized zero-dependency log rotation and snapshot isolation guard
 * Dependencies & Triggers: Node.js standard libraries (fs, path); invoked by pre-commit-gate,
 *   audit-all, and pre-push-gate workflows to prevent unbounded storage leaks.
 * Responsibilities:
 *   1. Truncate oversized diagnostic logs while preserving head and tail crash stacks (<= 100KB);
 *   2. Enforce FIFO rolling cleanup for log directories (default .audit-logs/, <= 2MB quota, max 3 files per group);
 *   3. Record and retrieve structured failure snapshot envelopes (last-failure.json) for rapid CLI triage;
 *   4. Expose CLI commands (--prune, --view, --truncate) for automation and manual developer inspection.
 * Exit Semantics & Design Rationale: Exits 0 on clean operations, 1 on CLI errors; fails soft when called
 *   programmatically so logging maintenance never impedes primary developer workflows.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const UTF8 = 'utf8';
const FAILURE_SNAPSHOT_NAME = 'last-failure.json';
const BYTES_PER_KB = 1024;

const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '..', '.audit-logs');
const DEFAULT_MAX_FILE_BYTES = 100 * BYTES_PER_KB; // 100 KB
const DEFAULT_HEAD_BYTES = 10 * BYTES_PER_KB; // 10 KB head reserve
const DEFAULT_MAX_TOTAL_BYTES = 2 * BYTES_PER_KB * BYTES_PER_KB; // 2 MB total directory quota
const DEFAULT_MAX_FILES_PER_GROUP = 3;
const DEFAULT_MAX_TOTAL_FILES = 20;

const TRUNCATION_MARKER = '\n--- [TRUNCATED: LOG EXCEEDED 100KB QUOTA] ---\n';

const PROTOCOL_VERSION = '1.0.0';
const PROTECTED_SNAPSHOT_FILES = new Set([
  FAILURE_SNAPSHOT_NAME,
  'audit-latest.json',
  'audit-latest.md',
  'audit-history.jsonl',
]);

/**
 * Identify log grouping key to prevent any single recurring failure from monopolizing storage.
 *
 * @param {string} fileName - Base name of the log file.
 * @returns {string} Normalized group prefix.
 */
function resolveLogGroupKey(fileName) {
  if (fileName.startsWith('fail-workspace-timing')) return 'fail-workspace-timing';
  if (fileName.startsWith('fail-auto-refactor')) return 'fail-auto-refactor';
  if (fileName.startsWith('fail-webgames')) return 'fail-webgames';
  if (fileName.startsWith('timeout-prepush')) return 'timeout-prepush';
  if (fileName.startsWith('timeout-')) return 'timeout-watchdog';
  if (fileName.startsWith('last-pre-commit')) return 'last-pre-commit';
  if (fileName.startsWith('last-commit-msg')) return 'last-commit-msg';
  if (fileName.startsWith('last-pre-push')) return 'last-pre-push';
  return 'general';
}

/**
 * Safely truncate a large log file while retaining critical initialization headers
 * and trailing crash stack traces.
 *
 * @param {string} filePath - Absolute or relative path to target file.
 * @param {number} maxBytes - Maximum byte capacity (default 100KB).
 * @param {number} headBytes - Head reserve byte capacity (default 10KB).
 * @returns {boolean} True if truncation was performed, false otherwise.
 */
function truncateLogFile(filePath, maxBytes = DEFAULT_MAX_FILE_BYTES, headBytes = DEFAULT_HEAD_BYTES) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size <= maxBytes) return false;

    const fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(headBytes);
    fs.readSync(fd, headBuf, 0, headBytes, 0);

    const tailLen = Math.max(0, maxBytes - headBytes - Buffer.byteLength(TRUNCATION_MARKER, UTF8));
    const tailBuf = Buffer.alloc(tailLen);
    const tailOffset = Math.max(0, stat.size - tailLen);
    fs.readSync(fd, tailBuf, 0, tailLen, tailOffset);
    fs.closeSync(fd);

    const merged = Buffer.concat([headBuf, Buffer.from(TRUNCATION_MARKER, UTF8), tailBuf]);
    fs.writeFileSync(filePath, merged);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect valid log file entries from the target audit directory.
 * Excludes protected long-term audit snapshots and history ledgers.
 *
 * @param {string} targetDir - Directory to inspect.
 * @returns {Array<object>} Collected log entry descriptors.
 */
function collectAuditLogEntries(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }
  const entries = [];
  try {
    const fileNames = fs.readdirSync(targetDir);
    for (const name of fileNames) {
      if (PROTECTED_SNAPSHOT_FILES.has(name)) {
        continue;
      }
      const fullPath = path.join(targetDir, name);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        entries.push({
          name,
          fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          group: resolveLogGroupKey(name),
        });
      }
    }
  } catch {
    return [];
  }
  return entries;
}

/**
 * Prune excess log files per prefix group using FIFO ordering.
 *
 * @param {Array<object>} entries - Collected file entries.
 * @param {number} maxPerGroup - Maximum files allowed per group bucket.
 * @returns {{ filesToDelete: Set<string>, freedBytes: number, removedCount: number }} Pruning outcome.
 */
function prunePerGroupQuota(entries, maxPerGroup) {
  const filesToDelete = new Set();
  let freedBytes = 0;
  let removedCount = 0;

  const groupBuckets = new Map();
  for (const entry of entries) {
    if (!groupBuckets.has(entry.group)) {
      groupBuckets.set(entry.group, []);
    }
    groupBuckets.get(entry.group).push(entry);
  }

  for (const [, bucket] of groupBuckets) {
    bucket.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (bucket.length <= maxPerGroup) {
      continue;
    }
    for (let i = maxPerGroup; i < bucket.length; i++) {
      filesToDelete.add(bucket[i].fullPath);
      freedBytes += bucket[i].size;
      removedCount++;
    }
  }

  return { filesToDelete, freedBytes, removedCount };
}

/**
 * Prune remaining logs against aggregate storage bytes and total file count limits.
 *
 * @param {Array<object>} entries - Collected file entries.
 * @param {Set<string>} filesToDelete - Target deletion set to append to.
 * @param {number} maxTotalBytes - Global byte limit.
 * @param {number} maxTotalFiles - Global file count limit.
 * @returns {{ aggregateFreedBytes: number, aggregateRemovedCount: number }} Aggregate pruning outcome.
 */
function pruneAggregateQuota(entries, filesToDelete, maxTotalBytes, maxTotalFiles) {
  const surviving = entries.filter((e) => !filesToDelete.has(e.fullPath));
  surviving.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first for aggregate pruning

  let currentTotalBytes = surviving.reduce((acc, curr) => acc + curr.size, 0);
  let aggregateFreedBytes = 0;
  let aggregateRemovedCount = 0;

  while ((currentTotalBytes > maxTotalBytes || surviving.length > maxTotalFiles) && surviving.length > 0) {
    const oldest = surviving.shift();
    if (!oldest) {
      break;
    }
    filesToDelete.add(oldest.fullPath);
    aggregateFreedBytes += oldest.size;
    currentTotalBytes -= oldest.size;
    aggregateRemovedCount++;
  }

  return { aggregateFreedBytes, aggregateRemovedCount };
}

/**
 * Execute best-effort file deletions for collected paths.
 *
 * @param {Set<string>} filesToDelete - Set of paths to unlink.
 */
function executeUnlinks(filesToDelete) {
  for (const fileToDelete of filesToDelete) {
    try {
      fs.unlinkSync(fileToDelete);
    } catch {
      // Best-effort deletion
    }
  }
}

/**
 * Enforce directory quota limits via per-group FIFO retention and aggregate volume ceiling.
 *
 * @param {object} [options] - Retention control parameters.
 * @returns {{ removedCount: number, freedBytes: number }} Cleanup outcome metrics.
 */
function pruneAuditLogs(options = {}) {
  const targetDir = options.targetDir || DEFAULT_LOG_DIR;
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
  const maxPerGroup = options.maxFilesPerGroup || DEFAULT_MAX_FILES_PER_GROUP;
  const maxTotalFiles = options.maxTotalFiles || DEFAULT_MAX_TOTAL_FILES;

  const entries = collectAuditLogEntries(targetDir);
  if (entries.length === 0) {
    return { removedCount: 0, freedBytes: 0 };
  }

  const groupOutcome = prunePerGroupQuota(entries, maxPerGroup);
  const aggOutcome = pruneAggregateQuota(
    entries,
    groupOutcome.filesToDelete,
    maxTotalBytes,
    maxTotalFiles,
  );

  executeUnlinks(groupOutcome.filesToDelete);

  return {
    removedCount: groupOutcome.removedCount + aggOutcome.aggregateRemovedCount,
    freedBytes: groupOutcome.freedBytes + aggOutcome.aggregateFreedBytes,
  };
}

/**
 * Resolve target files list from snapshot or violations array.
 *
 * @param {object} snapshotData - Failure snapshot object.
 * @param {Array<object>} violations - Violations array.
 * @returns {Array<string>} Unique list of target files.
 */
function resolveSnapshotFiles(snapshotData, violations) {
  if (Array.isArray(snapshotData.targetFiles)) {
    return snapshotData.targetFiles;
  }
  return Array.from(new Set(violations.map((v) => v.file).filter(Boolean)));
}

/**
 * Resolve prioritized remediation rule IDs from snapshot or violations.
 *
 * @param {object} snapshotData - Failure snapshot object.
 * @param {Array<object>} violations - Violations array.
 * @returns {Array<string>} Unique list of rule IDs.
 */
function resolveRemediationPriority(snapshotData, violations) {
  if (Array.isArray(snapshotData.remediationPriority)) {
    return snapshotData.remediationPriority;
  }
  return Array.from(new Set(violations.map((v) => v.ruleId).filter(Boolean)));
}

/**
 * Resolve normalized relative log file path against repository root.
 *
 * @param {string|null} logFile - Path to log file.
 * @param {string} targetDir - Directory of audit logs.
 * @returns {string|null} Normalized relative path or null.
 */
function resolveRelativeLogPath(logFile, targetDir) {
  if (!logFile) {
    return null;
  }
  const rootDir = path.resolve(targetDir, '..');
  return path.relative(rootDir, logFile).replace(/\\/g, '/');
}

/**
 * Format an Agent-Native failure envelope payload adhering to the workspace contract.
 *
 * @param {object} snapshotData - Failure attributes and violation details.
 * @param {string} [targetDir] - Root audit log directory.
 * @returns {object} Normalized Agent failure envelope.
 */
function formatAgentEnvelope(snapshotData, targetDir = DEFAULT_LOG_DIR) {
  const violations = Array.isArray(snapshotData.violations) ? snapshotData.violations : [];
  const targetFiles = resolveSnapshotFiles(snapshotData, violations);
  const remediationPriority = resolveRemediationPriority(snapshotData, violations);
  const relLogFile = resolveRelativeLogPath(snapshotData.logFile, targetDir);

  const verificationCommand = snapshotData.verificationCommand || snapshotData.failedCommand || '';
  const fastRecheckCommand = snapshotData.fastRecheckCommand || 'node scripts/common/gate-fast-staged.js';

  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: snapshotData.runId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: snapshotData.recordedAt || new Date().toISOString(),
    status: snapshotData.status || 'BLOCK',
    gate: snapshotData.gate || 'unknown-gate',
    step: snapshotData.step || 'unknown-step',
    stepId: snapshotData.stepId || undefined,
    failedCommand: snapshotData.failedCommand || '',
    exitCode: snapshotData.exitCode ?? 1,
    summary: snapshotData.summary || 'Gate check failed.',
    logFile: relLogFile,
    violations,
    agentDirectives: {
      targetFiles,
      remediationPriority,
      verificationCommand,
      fastRecheckCommand,
    },
  };
}

/**
 * Record a structured failure snapshot envelope for developer triage and Agent self-healing.
 *
 * @param {object} snapshotData - Failure attributes including gate name and error summary.
 * @param {string} [targetDir] - Directory where failure snapshot is persisted.
 * @returns {string|null} Path to recorded snapshot file or null on error.
 */
function writeFailureSnapshot(snapshotData, targetDir = DEFAULT_LOG_DIR) {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const snapshotPath = path.join(targetDir, FAILURE_SNAPSHOT_NAME);
    const payload = formatAgentEnvelope(snapshotData, targetDir);
    fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2), UTF8);
    return snapshotPath;
  } catch {
    return null;
  }
}

/**
 * Render structured violations list in terminal triage view.
 *
 * @param {Array<object>} violations - Violation records.
 */
function renderSnapshotViolations(violations) {
  if (!Array.isArray(violations) || violations.length === 0) {
    return;
  }
  console.log('-----------------------------------------------------------------');
  console.log(`【结构化违规项列表 (${violations.length} 项)】:`);
  for (const v of violations.slice(0, 10)) {
    const fileLoc = v.file ? `${v.file}${v.line ? ':' + v.line : ''}` : '';
    console.log(`  • [${v.ruleId || 'RULE'}] ${fileLoc ? fileLoc + ' - ' : ''}${v.message}`);
    if (v.actionableFix) {
      console.log(`    ↳ 修复建议: ${v.actionableFix}`);
    }
  }
  if (violations.length > 10) {
    console.log(`  ... 其余 ${violations.length - 10} 项省略`);
  }
}

/**
 * Render tail excerpt from associated error log file.
 *
 * @param {string} targetDir - Snapshot root directory.
 * @param {string|null} logFile - Relative log file path.
 */
function renderSnapshotLogTail(targetDir, logFile) {
  if (!logFile) {
    return;
  }
  const fullLogPath = path.resolve(path.dirname(targetDir), logFile);
  if (!fs.existsSync(fullLogPath)) {
    return;
  }
  console.log('-----------------------------------------------------------------');
  console.log(`日志路径: ${logFile}`);
  console.log('【最后 20 行错误日志摘要】:');
  const rawLines = fs.readFileSync(fullLogPath, 'utf8').trim().split('\n');
  const tailLines = rawLines.slice(-20);
  for (const line of tailLines) {
    console.log(`  ${line}`);
  }
}

function displayLatestAuditFallback(targetDir) {
  const latestAuditPath = path.join(targetDir, 'audit-latest.json');
  if (!fs.existsSync(latestAuditPath)) {
    return;
  }
  try {
    const audit = JSON.parse(fs.readFileSync(latestAuditPath, UTF8));
    console.log(`💡 最近一次全工作区审查综合健康分为: ${audit.workspaceHealthScore} (${audit.grade || 'A+'}) | 状态: ${audit.status}`);
    console.log('   查看全景看板: node scripts/common/record-workspace-audit.js --latest');
  } catch (readErr) {
    // Best-effort audit inspection: ignore read failure to preserve view output
    void readErr;
  }
}

/**
 * Print formatted triage details of the most recent recorded failure.
 *
 * @param {string} [targetDir] - Directory holding the failure snapshot.
 * @returns {boolean} True if failure record was found and printed, false otherwise.
 */
function viewLastFailure(targetDir = DEFAULT_LOG_DIR) {
  const snapshotPath = path.join(targetDir, FAILURE_SNAPSHOT_NAME);
  if (!fs.existsSync(snapshotPath)) {
    console.log('\nℹ️ 未发现最近一次门禁失败快照记录 (last-failure.json)。');
    displayLatestAuditFallback(targetDir);
    return false;
  }

  try {
    const content = fs.readFileSync(snapshotPath, UTF8);
    const snapshot = JSON.parse(content);

    console.log('\n=================================================================');
    console.log('🔍 【最近一次门禁失败快照详情】');
    console.log('=================================================================');
    console.log(`触发时间: ${snapshot.recordedAt}`);
    console.log(`门禁标识: ${snapshot.gate}`);
    console.log(`阻断步骤: ${snapshot.step}`);
    if (snapshot.failedCommand) {
      console.log(`失败命令: ${snapshot.failedCommand}`);
    }
    console.log(`退出代码: ${snapshot.exitCode}`);
    console.log(`诊断摘要: ${snapshot.summary}`);

    if (snapshot.agentDirectives && snapshot.agentDirectives.verificationCommand) {
      console.log(`自验指令: ${snapshot.agentDirectives.verificationCommand}`);
    }

    renderSnapshotViolations(snapshot.violations);
    renderSnapshotLogTail(targetDir, snapshot.logFile);

    console.log('=================================================================\n');
    return true;
  } catch (err) {
    console.error(`❌ 解析失败快照异常: ${err.message}`);
    return false;
  }
}

/**
 * Output structured JSON envelope for autonomous Agent consumption.
 */
function handleAgentModeCli() {
  const snapshotPath = path.join(DEFAULT_LOG_DIR, FAILURE_SNAPSHOT_NAME);
  if (!fs.existsSync(snapshotPath)) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: 'PASS',
          summary: 'No recorded gate failures.',
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  try {
    const raw = fs.readFileSync(snapshotPath, UTF8);
    console.log(raw.trim());
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

/**
 * CLI Entry point dispatcher.
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--agent') || args.includes('-a') || args.includes('--json')) {
    handleAgentModeCli();
  }

  if (args.includes('--view') || args.includes('-v')) {
    const found = viewLastFailure();
    process.exit(found ? 0 : 1);
  }

  if (args.includes('--prune') || args.includes('-p')) {
    const result = pruneAuditLogs();
    console.log(`✔ [Log-Rotator] 已清理 ${result.removedCount} 份超额日志，释放 ${(result.freedBytes / 1024).toFixed(1)} KB 空间`);
    process.exit(0);
  }

  const truncateIdx = args.indexOf('--truncate');
  if (truncateIdx !== -1 && args[truncateIdx + 1]) {
    const targetFile = path.resolve(process.cwd(), args[truncateIdx + 1]);
    const truncated = truncateLogFile(targetFile);
    if (truncated) {
      console.log(`✔ [Log-Rotator] 已截断超限日志文件: ${targetFile}`);
    }
    process.exit(0);
  }

  // Default behavior when invoked without flags: perform standard directory quota maintenance
  pruneAuditLogs();
}

if (require.main === module) {
  main();
}

module.exports = {
  PROTOCOL_VERSION,
  truncateLogFile,
  pruneAuditLogs,
  formatAgentEnvelope,
  writeFailureSnapshot,
  viewLastFailure,
  DEFAULT_LOG_DIR,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
};
