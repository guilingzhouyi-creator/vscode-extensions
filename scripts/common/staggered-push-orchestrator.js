/**
 * Module: Staggered Push Orchestrator
 * File Path: scripts/common/staggered-push-orchestrator.js
 * Architecture Role: Core orchestration engine for staggered, rate-limited Git pushing from local
 *   backlog to remote default branch, advancing the remote pointer along historical commits.
 * Dependencies & Triggers: Consumed by scripts/ps1/run-daily-staggered-push.ps1 and scheduled
 *   automation runners; invokes git CLI (fetch, rev-list, log, push).
 * Responsibilities:
 *   1. Calculate the unpushed commit backlog between origin/<branch> and local <branch>;
 *   2. Enforce daily idempotence using .audit-logs/staggered-push-history.ndjson;
 *   3. Randomly sample N in [3, 6] commits (or clamp to remaining);
 *   4. Advance remote ref via fast-forward: git push origin <targetSha>:refs/heads/<branch>;
 *   5. Record structured audit receipts with commit summaries and residual counts.
 * Exit Semantics & Design Rationale: Pure Node.js engine with clear JSON output contracts;
 *   supports --dry-run, --count, --force, and --json for safe inspection and orchestration.
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
 * Returns the current local calendar date string in YYYY-MM-DD format.
 *
 * @param {Date} [d=new Date()] - Date object.
 * @returns {string} Formatted date string.
 */
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(DATE_PAD_LEN, '0');
  const day = String(d.getDate()).padStart(DATE_PAD_LEN, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Evaluates whether an individual NDJSON record line corresponds to a successful
 * push on the target calendar date.
 *
 * @param {string} line - Raw JSON line from audit log.
 * @param {string} dateStr - Target date string in YYYY-MM-DD.
 * @returns {boolean} True if matching push action.
 */
function isPushEntryForDate(line, dateStr) {
  try {
    const entry = JSON.parse(line);
    return entry.action === 'PUSH' && typeof entry.timestamp === 'string' && entry.timestamp.startsWith(dateStr);
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
 * Orchestrates a single staggered push calculation or execution.
 *
 * @param {object} options - Options object.
 * @param {boolean} [options.dryRun=false] - If true, simulate without pushing.
 * @param {number} [options.count=0] - Explicit count override, 0 for random 3-6.
 * @param {boolean} [options.force=false] - Ignore today's idempotency check.
 * @param {string} [options.remote=DEFAULT_REMOTE] - Git remote name.
 * @param {string} [options.branch=DEFAULT_BRANCH] - Target branch name.
 * @returns {object} Execution summary.
 */
function executeStaggeredPush(options = {}) {
  const {
    dryRun = false,
    count = 0,
    force = false,
    remote = DEFAULT_REMOTE,
    branch = DEFAULT_BRANCH,
  } = options;

  const todayStr = getLocalDateString();

  // 1. Check idempotency
  if (!force && hasPushedToday(todayStr)) {
    return {
      status: 'SKIP',
      date: todayStr,
      summary: `Idempotence guard: already pushed today (${todayStr}). Use --force to push another batch.`,
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
  let targetCount = count;
  if (!targetCount || targetCount <= 0) {
    targetCount = Math.floor(Math.random() * BATCH_RANDOM_SPAN) + MIN_BATCH_COMMITS;
  }
  const actualCount = Math.min(targetCount, totalBacklog);
  const targetSha = unpushedCommits[actualCount - 1];
  const startSha = unpushedCommits[0];

  // 5. Collect commit summaries
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
    action: dryRun ? 'DRY_RUN' : 'PUSH',
    pushedCount: actualCount,
    startSha,
    targetSha,
    remainingBefore: totalBacklog,
    remainingAfter,
    commits: commitSummaries,
  };

  if (dryRun) {
    return {
      status: 'DRY_RUN',
      summary: `[DryRun] Would advance ${remote}/${branch} by ${actualCount} commits (remaining: ${remainingAfter}).`,
      ...result,
    };
  }

  // 6. Execute push with GATE_ALLOW_BYPASS=1
  try {
    git([GIT_CMD_PUSH, remote, `${targetSha}:refs/heads/${branch}`], {
      GATE_ALLOW_BYPASS: '1',
    });
  } catch (err) {
    return {
      status: 'BLOCK',
      summary: `Git push failed: ${err.message}`,
      action: 'FAILED',
      ...result,
    };
  }

  // 7. Record to audit log
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
  const jsonOutput = args.includes('--json');

  let count = 0;
  const countIdx = args.findIndex((a) => a === '--count' || a === '-c');
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1], 10) || 0;
  }

  const outcome = executeStaggeredPush({ dryRun, count, force });

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
  getLocalDateString,
  AUDIT_LOG_FILE,
};
