/**
 * Module: Staggered Push Orchestrator
 * File Path: scripts/common/staggered-push-orchestrator.js
 * Architecture Role: Core orchestration engine for staggered, rate-limited Git pushing from local
 *   backlog to remote default branch, advancing the remote pointer along verified historical checkpoints.
 * Dependencies & Triggers: Consumed by scripts/ps1/run-daily-staggered-push.ps1 and scheduled
 *   automation runners; invokes git CLI (fetch, rev-list, log, push) and gate validators.
 * Responsibilities:
 *   1. Calculate the unpushed commit backlog between origin/<branch> and local <branch>;
 *   2. Enforce daily idempotence using .audit-logs/staggered-push-history.ndjson;
 *   3. Randomly sample N in [3, 6] commits (or clamp to remaining);
 *   4. Preflight-audit candidate checkpoints to ensure pushed commits satisfy commit governance;
 *   5. Advance remote ref via fast-forward: git push origin <targetSha>:refs/heads/<branch>;
 *   6. Record structured audit receipts with commit summaries and residual counts.
 * Exit Semantics & Design Rationale: Pure Node.js engine with clear JSON output contracts;
 *   supports --dry-run, --count, --force, --preflight, --allow-bypass, and --json for safe inspection.
 *
 * @module staggered-push-orchestrator
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Architectural constants
const REPO_ROOT = path.resolve(__dirname, '../..');
const AUDIT_DIR_NAME = '.audit-logs';
const AUDIT_FILE_NAME = 'staggered-push-history.ndjson';
const AUDIT_LOG_DIR = path.join(REPO_ROOT, AUDIT_DIR_NAME);
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, AUDIT_FILE_NAME);

// Git protocol and commit constants
const DEFAULT_REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';
const GIT_CMD_FETCH = 'fetch';
const GIT_CMD_REV_LIST = 'rev-list';
const GIT_CMD_PUSH = 'push';
const GIT_CMD_LOG = 'log';

// Numeric bounds and formats
const MIN_BATCH_COMMITS = 3;
const BATCH_RANDOM_SPAN = 4; // Yields [3, 6] inclusive: Math.floor(random * 4) + 3
const SHA_SHORT_LEN = 8;
const DATE_PAD_LEN = 2;

/**
 * Executes a Git command safely with string output.
 *
 * @param {string[]} args - Command arguments.
 * @param {Record<string, string>} [extraEnv={}] - Additional environment variables.
 * @returns {string} Trimmed command stdout.
 */
function git(args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Returns the calendar date string in YYYY-MM-DD format under objective UTC standard.
 *
 * @param {Date} [d=new Date()] - Date object.
 * @returns {string} Formatted UTC date string (YYYY-MM-DD).
 */
function getUtcDateString(d = new Date()) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(DATE_PAD_LEN, '0');
  const day = String(d.getUTCDate()).padStart(DATE_PAD_LEN, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Backward compatibility alias for getUtcDateString.
 *
 * @param {Date} [d=new Date()] - Date object.
 * @returns {string} Formatted UTC date string (YYYY-MM-DD).
 */
function getLocalDateString(d = new Date()) {
  return getUtcDateString(d);
}

/**
 * Evaluates whether an individual NDJSON record line corresponds to a successful
 * push on the target calendar date (in UTC).
 *
 * @param {string} line - Raw JSON line from audit log.
 * @param {string} dateStr - Target date string in YYYY-MM-DD (UTC).
 * @returns {boolean} True if matching push action.
 */
function isPushEntryForDate(line, dateStr) {
  try {
    const entry = JSON.parse(line);
    if (entry.action !== 'PUSH') {
      return false;
    }
    if (entry.date === dateStr) {
      return true;
    }
    return typeof entry.timestamp === 'string' && entry.timestamp.startsWith(dateStr);
  } catch (err) {
    // Expected: ignore malformed or partial NDJSON lines during streaming parse
    return false;
  }
}

/**
 * Checks if today already has a recorded push action in the audit history.
 *
 * @param {string} dateStr - Target date string in YYYY-MM-DD.
 * @returns {boolean} True if already pushed today.
 */
function hasPushedToday(dateStr) {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return false;
  }
  try {
    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
    const lines = content.split('\n');
    return lines.some((line) => line.trim().length > 0 && isPushEntryForDate(line, dateStr));
  } catch (err) {
    // Best-effort: return false if log read encounters an unexpected filesystem error
    return false;
  }
}

/**
 * Reads the latest recorded push receipt from the audit log.
 *
 * @returns {object|null} Parsed latest audit record or null.
 */
function getLastPushEntry() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return null;
  }
  try {
    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim();
    if (!content) {
      return null;
    }
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed.action === 'PUSH') {
          return parsed;
        }
      } catch {
        // Continue seeking previous lines
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a structured snapshot of the current staggered push scheduling status.
 *
 * @param {object} [options={}] - Options object.
 * @param {string} [options.remote=DEFAULT_REMOTE] - Git remote.
 * @param {string} [options.branch=DEFAULT_BRANCH] - Target branch.
 * @returns {object} Status snapshot.
 */
function getStaggeredPushStatus(options = {}) {
  const remote = options.remote || DEFAULT_REMOTE;
  const branch = options.branch || DEFAULT_BRANCH;
  const now = new Date();
  const todayStr = getUtcDateString(now);
  const pushed = hasPushedToday(todayStr);

  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const isWindowActive = utcHour > 13 || (utcHour === 13 && utcMinute >= 30);

  let backlogCount = -1;
  try {
    backlogCount = getUnpushedCommits(remote, branch).length;
  } catch {
    // Deliberate: non-fatal if repo/remote offline
  }

  return {
    currentTimeUtc: now.toISOString(),
    todayUtcDate: todayStr,
    targetUtcWindow: '13:30 UTC (21:30 CST / 05:30 PST)',
    isWindowActive,
    hasPushedToday: pushed,
    backlogCount,
    lastPushEntry: getLastPushEntry(),
  };
}

/**
 * Appends an entry to the audit NDJSON log.
 *
 * @param {object} record - Structured log record.
 */
function appendAuditLog(record) {
  if (!fs.existsSync(AUDIT_LOG_DIR)) {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
  }
  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf8');
}

/**
 * Resolves the commit range string and fetches unpushed commit list.
 *
 * @param {string} remote - Git remote name.
 * @param {string} branch - Target branch name.
 * @returns {string[]} Ordered list of commit SHAs from oldest to newest.
 */
function getUnpushedCommits(remote, branch) {
  const range = `${remote}/${branch}..${branch}`;
  const unpushedRaw = git([GIT_CMD_REV_LIST, '--reverse', range]);
  return unpushedRaw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Validates commit messages across the candidate push range.
 *
 * @param {string} range - Commit range string (e.g. 'origin/main..HEAD').
 * @returns {{ passed: boolean, message: string }} Verification verdict.
 */
function auditCommitRange(range) {
  const validatorJs = path.join(__dirname, 'validate-commit-msg.js');
  if (!fs.existsSync(validatorJs)) {
    return { passed: true, message: 'Commit validator script omitted' };
  }
  try {
    execFileSync(process.execPath, [validatorJs, '--range', range], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, message: 'Commit message governance checks passed' };
  } catch (err) {
    const detail = (err.stdout || err.stderr || err.message || '').trim();
    return { passed: false, message: `Commit message governance failure: ${detail}` };
  }
}

/**
 * Audits documentation consistency and scale figures across the workspace.
 *
 * @returns {{ passed: boolean, message: string }} Verification verdict.
 */
function auditDocumentationConsistency() {
  const docValidatorJs = path.join(__dirname, 'validate-docs-consistency.js');
  if (!fs.existsSync(docValidatorJs)) {
    return { passed: true, message: 'Doc consistency validator script omitted' };
  }
  try {
    execFileSync(process.execPath, [docValidatorJs], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, message: 'Documentation consistency checks passed' };
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    return { passed: false, message: `Documentation consistency failure: ${detail}` };
  }
}

/**
 * Executes a targeted slice verification on the Tier 1.5 remote sandbox machine.
 *
 * @param {string} sliceName - Targeted slice name.
 * @returns {{ passed: boolean, message: string }} Verification verdict.
 */
function auditRemoteSandboxSlice(sliceName) {
  const sandboxGateJs = path.join(__dirname, 'remote-sandbox-gate.js');
  if (!fs.existsSync(sandboxGateJs)) {
    return { passed: true, message: 'Remote sandbox validator script omitted' };
  }
  try {
    execFileSync(process.execPath, [sandboxGateJs, '--slice', sliceName, '--remote'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, message: `Tier 1.5 remote sandbox slice '${sliceName}' passed` };
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    return { passed: false, message: `Tier 1.5 remote sandbox slice '${sliceName}' failure: ${detail}` };
  }
}

/**
 * Evaluates whether the repository working tree is clean of uncommitted changes.
 *
 * @returns {boolean} True if working tree and index are clean.
 */
function isWorkingTreeClean() {
  try {
    const status = git(['status', '--porcelain']);
    return status.trim().length === 0;
  } catch {
    return false;
  }
}

/**
 * Performs preflight verification on the candidate target commit.
 *
 * @param {string} remote - Git remote name.
 * @param {string} branch - Target branch name.
 * @param {string} targetSha - Target commit SHA.
 * @param {string|null} [verifyRemoteSlice=null] - Optional remote sandbox slice to audit.
 * @returns {{ passed: boolean, reason?: string }} Verification verdict.
 */
function preflightCheckpointAudit(remote, branch, targetSha, verifyRemoteSlice = null) {
  const range = `${remote}/${branch}..${targetSha}`;
  const commitVerdict = auditCommitRange(range);
  if (!commitVerdict.passed) {
    return { passed: false, reason: commitVerdict.message };
  }

  // Disk-level documentation consistency only applies if the working tree is clean.
  // When parallel sessions or local WIP leave unstaged changes, the working tree
  // does not reflect targetSha, so disk validation would yield false positives.
  if (isWorkingTreeClean()) {
    const docVerdict = auditDocumentationConsistency();
    if (!docVerdict.passed) {
      return { passed: false, reason: docVerdict.message };
    }
  }

  if (verifyRemoteSlice) {
    const remoteVerdict = auditRemoteSandboxSlice(verifyRemoteSlice);
    if (!remoteVerdict.passed) {
      return { passed: false, reason: remoteVerdict.message };
    }
  }

  return { passed: true };
}

/**
 * Resolves the batch count N within bounds, defaulting to random [3, 6].
 *
 * @param {number} explicitCount - User-specified commit count.
 * @param {number} totalBacklog - Total available backlog count.
 * @returns {number} Clamped batch count.
 */
function resolveBatchCount(explicitCount, totalBacklog) {
  let target = explicitCount;
  if (!target || target <= 0) {
    target = Math.floor(Math.random() * BATCH_RANDOM_SPAN) + MIN_BATCH_COMMITS;
  }
  return Math.min(target, totalBacklog);
}

/**
 * Orchestrates a single staggered push calculation or execution.
 *
 * @param {object} options - Options object.
 * @param {boolean} [options.dryRun=false] - If true, simulate without pushing.
 * @param {number} [options.count=0] - Explicit count override, 0 for random 3-6.
 * @param {boolean} [options.force=false] - Ignore today's idempotency check.
 * @param {boolean} [options.preflight=false] - If true, execute preflight check without pushing.
 * @param {boolean} [options.allowBypass=false] - If true, forward allow-bypass flag to git pre-push.
 * @param {string} [options.remote=DEFAULT_REMOTE] - Git remote name.
 * @param {string} [options.branch=DEFAULT_BRANCH] - Target branch name.
 * @param {string|null} [options.verifyRemoteSlice=null] - Optional Tier 1.5 remote sandbox slice to audit.
 * @returns {object} Execution summary.
 */
function executeStaggeredPush(options = {}) {
  const {
    dryRun = false,
    count = 0,
    force = false,
    preflight = false,
    allowBypass = false,
    remote = DEFAULT_REMOTE,
    branch = DEFAULT_BRANCH,
    verifyRemoteSlice = null,
  } = options;

  const todayStr = getUtcDateString();

  // 1. Check idempotency
  if (!force && !preflight && !dryRun && hasPushedToday(todayStr)) {
    return {
      status: 'SKIP',
      date: todayStr,
      summary: `Idempotence guard: already pushed today (${todayStr} UTC). Use --force to push another batch.`,
      action: 'NONE',
    };
  }

  // 2. Fetch latest remote ref
  try {
    git([GIT_CMD_FETCH, remote, branch, '--quiet']);
  } catch (err) {
    // Deliberate: non-fatal if offline, proceed with known remote tracking ref
  }

  // 3. Inspect unpushed commit list
  let unpushedCommits = [];
  try {
    unpushedCommits = getUnpushedCommits(remote, branch);
  } catch (err) {
    return {
      status: 'BLOCK',
      summary: `Failed to resolve commit range ${remote}/${branch}..${branch}: ${err.message}`,
      action: 'ERROR',
    };
  }

  const totalBacklog = unpushedCommits.length;
  if (totalBacklog === 0) {
    return {
      status: 'IDLE',
      date: todayStr,
      summary: `Remote ${remote}/${branch} is already fully up to date with local ${branch}.`,
      remaining: 0,
      action: 'NONE',
    };
  }

  // 4. Determine batch count N
  const actualCount = resolveBatchCount(count, totalBacklog);
  const targetSha = unpushedCommits[actualCount - 1];
  const startSha = unpushedCommits[0];

  // 5. Preflight check on candidate target commit
  const preflightVerdict = preflightCheckpointAudit(remote, branch, targetSha, verifyRemoteSlice);
  if (!preflightVerdict.passed) {
    return {
      status: 'BLOCK',
      summary: `Preflight checkpoint validation failed for candidate ${targetSha.substring(0, SHA_SHORT_LEN)}: ${preflightVerdict.reason}`,
      action: 'BLOCKED',
      targetSha,
      pushedCount: actualCount,
    };
  }

  // 6. Collect commit summaries
  const selectedShas = unpushedCommits.slice(0, actualCount);
  const commitSummaries = selectedShas.map((sha) => {
    try {
      return git([GIT_CMD_LOG, '-1', '--format=%h %s', sha]);
    } catch (err) {
      // Expected fallback to abbreviated SHA if log formatting fails
      return sha.substring(0, SHA_SHORT_LEN);
    }
  });

  const remainingAfter = totalBacklog - actualCount;

  const result = {
    date: todayStr,
    action: preflight ? 'PREFLIGHT' : dryRun ? 'DRY_RUN' : 'PUSH',
    pushedCount: actualCount,
    startSha,
    targetSha,
    remainingBefore: totalBacklog,
    remainingAfter,
    commits: commitSummaries,
  };

  if (preflight) {
    return {
      status: 'PASS',
      summary: `[Preflight] Candidate checkpoint ${targetSha.substring(0, SHA_SHORT_LEN)} passed pre-push validation (${actualCount} commits).`,
      ...result,
    };
  }

  if (dryRun) {
    return {
      status: 'DRY_RUN',
      summary: `[DryRun] Would advance ${remote}/${branch} by ${actualCount} commits (remaining: ${remainingAfter}).`,
      ...result,
    };
  }

  // 7. Execute push safely (Allow bypass only if explicitly requested)
  const pushEnv = {
    GATE_STAGGERED_PUSH: '1',
  };
  if (allowBypass) {
    pushEnv.GATE_ALLOW_BYPASS = '1';
  }

  try {
    git([GIT_CMD_PUSH, remote, `${targetSha}:refs/heads/${branch}`], pushEnv);
  } catch (err) {
    return {
      status: 'BLOCK',
      summary: `Git push failed: ${err.message}`,
      action: 'FAILED',
      ...result,
    };
  }

  // 8. Record to audit log
  const auditRecord = {
    timestamp: new Date().toISOString(),
    ...result,
  };
  appendAuditLog(auditRecord);

  return {
    status: 'PASS',
    summary: `Successfully pushed ${actualCount} commits to ${remote}/${branch}. Pointer at ${targetSha.substring(0, SHA_SHORT_LEN)}. Remaining: ${remainingAfter}.`,
    ...result,
  };
}

/** CLI entry point */
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const force = args.includes('--force') || args.includes('-f');
  const preflight = args.includes('--preflight') || args.includes('-p');
  const allowBypass = args.includes('--allow-bypass');
  const jsonOutput = args.includes('--json');

  let count = 0;
  const countIdx = args.findIndex((a) => a === '--count' || a === '-c');
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1], 10) || 0;
  }

  let branch = DEFAULT_BRANCH;
  const branchIdx = args.findIndex((a) => a === '--branch' || a === '-b');
  if (branchIdx !== -1 && args[branchIdx + 1]) {
    branch = args[branchIdx + 1];
  }

  let remote = DEFAULT_REMOTE;
  const remoteIdx = args.findIndex((a) => a === '--remote' || a === '-r');
  if (remoteIdx !== -1 && args[remoteIdx + 1]) {
    remote = args[remoteIdx + 1];
  }

  let verifyRemoteSlice = null;
  const vrsIdx = args.findIndex((a) => a === '--verify-remote' || a === '--remote-slice');
  if (vrsIdx !== -1) {
    const nextArg = args[vrsIdx + 1];
    if (nextArg && !nextArg.startsWith('-')) {
      verifyRemoteSlice = nextArg;
    } else {
      verifyRemoteSlice = 'hygiene';
    }
  }

  const statusFlag = args.includes('--status') || args.includes('-s');
  if (statusFlag) {
    const statusObj = getStaggeredPushStatus({ remote, branch });
    if (jsonOutput) {
      process.stdout.write(JSON.stringify(statusObj, null, 2) + '\n');
    } else {
      console.log('=== Staggered Push Objective Status ===');
      console.log(`Current Time (UTC): ${statusObj.currentTimeUtc}`);
      console.log(`Target Window:     ${statusObj.targetUtcWindow}`);
      console.log(`Window Active:     ${statusObj.isWindowActive ? 'YES (Window Open)' : 'NO (Waiting)'}`);
      console.log(`Pushed Today (UTC):${statusObj.hasPushedToday ? 'YES (Completed)' : 'NO (Pending)'}`);
      console.log(`Backlog Commits:   ${statusObj.backlogCount >= 0 ? statusObj.backlogCount : 'Unknown'}`);
      if (statusObj.lastPushEntry) {
        const lastEntrySha = statusObj.lastPushEntry.targetSha ? statusObj.lastPushEntry.targetSha.slice(0, 8) : 'N/A';
        console.log(`Last Push Action:  ${statusObj.lastPushEntry.timestamp} (${statusObj.lastPushEntry.pushedCount} commits, target: ${lastEntrySha})`);
      }
    }
    process.exit(0);
  }

  const outcome = executeStaggeredPush({
    dryRun,
    count,
    force,
    preflight,
    allowBypass,
    branch,
    remote,
    verifyRemoteSlice,
  });

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
  } else {
    if (outcome.status === 'PASS') {
      console.log(`\x1b[32m✔ [STAGGERED-PUSH] ${outcome.summary}\x1b[0m`);
      if (outcome.commits && outcome.commits.length > 0) {
        outcome.commits.forEach((c) => console.log(`   - ${c}`));
      }
    } else if (outcome.status === 'DRY_RUN') {
      console.log(`\x1b[36mℹ [DRY-RUN] ${outcome.summary}\x1b[0m`);
      if (outcome.commits && outcome.commits.length > 0) {
        outcome.commits.forEach((c) => console.log(`   - ${c}`));
      }
    } else if (outcome.status === 'SKIP') {
      console.log(`\x1b[33m⚡ [SKIP] ${outcome.summary}\x1b[0m`);
    } else if (outcome.status === 'IDLE') {
      console.log(`\x1b[32m✔ [IDLE] ${outcome.summary}\x1b[0m`);
    } else {
      console.error(`\x1b[31m✖ [BLOCK] ${outcome.summary}\x1b[0m`);
    }
  }

  process.exit(outcome.status === 'BLOCK' ? 1 : 0);
}

module.exports = {
  executeStaggeredPush,
  hasPushedToday,
  getUtcDateString,
  getLocalDateString,
  preflightCheckpointAudit,
  getLastPushEntry,
  getStaggeredPushStatus,
  AUDIT_LOG_FILE,
};
