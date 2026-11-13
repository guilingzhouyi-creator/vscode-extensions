/**
 * Module: Workspace Async Governance — Hybrid Staging Auto-Commit Coordinator
 * File Path: scripts/common/lib/async-auto-commit.js
 * Architecture Role: Periodically commits healthy, verified workspace changes onto standard Git
 *   main-tree history during engineering dev/test mode, adhering to atomic `[Project]` batching,
 *   STAGED-DIFF-14 bounds, and offline commit-msg validation.
 * Dependencies & Triggers: ./async-audit-snapshot, ./async-audit-envelope, and ./async-commit-lease.
 * Responsibilities:
 *   1. Commit single-project pre-staged work after a 60s quiet window;
 *   2. When index is empty and worktree is idle >= 30m with healthy async audit, explicitly stage
 *      safe single-project files excluding volatile/leased/hot files and run `git commit`;
 *   3. Unstage daemon-staged files cleanly if hooks reject and track HEAD against self-loops.
 * Exit Semantics & Design Rationale: Never bypasses `.githooks/*` or runs `git add .`; yields
 *   immediately on `.git/index.lock`, mixed-project indices, paused flags, or hook rejection.
 */
'use strict';

const {
  classifyPathProject,
  execGit,
  resolveHeadOid,
} = require('./async-audit-snapshot');
const {
  loadSchedulerState,
  saveSchedulerState,
} = require('./async-audit-envelope');
const leaseLib = require('./async-commit-lease');
const msgLib = require('./async-commit-message');

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_STAGED_QUIET_MS = 60 * MS_PER_SECOND;
const DEFAULT_IDLE_COMMIT_MS = 30 * SECONDS_PER_MINUTE * MS_PER_SECOND;
const DEFAULT_HOT_FILE_GUARD_MS = 10 * SECONDS_PER_MINUTE * MS_PER_SECOND;

function validatePreStagedBatch(repoRoot, stagedFiles, latestAudit) {
  const projects = [...new Set(stagedFiles.map(classifyPathProject))];
  if (projects.length !== 1) {
    return { blocked: { action: 'skipped', reason: `mixed-project-staged-index:${projects.join(',')}` } };
  }
  const stagedVol = leaseLib.estimateChangedLineVolume(repoRoot, stagedFiles, true);
  if (stagedVol > leaseLib.MAX_LINE_BUDGET_FALLBACK) {
    return { blocked: { action: 'skipped', reason: `staged-volume-exceeds-budget:${stagedVol}` } };
  }
  const diffText = String(execGit(repoRoot, ['diff', '--cached', '--no-color', '--']) || '');
  const synth = msgLib.synthesizeAndVerifyCommitMessage(projects[0], stagedFiles, latestAudit, diffText);
  if (!synth.valid) {
    return { blocked: { action: 'blocked', reason: 'commit-msg-synthesis-rejected', findings: synth.findings } };
  }
  return { project: projects[0], message: synth.message };
}

function handlePreStagedCommit(repoRoot, ctx) {
  const { nowMs, stagedQuietMs, latestAudit, state, currentFingerprint, stagedFiles, dryRun } = ctx;
  const stagedSig = stagedFiles.join('|');
  const quietSince = state.stagedSignature === stagedSig && state.stagedQuietSinceMs
    ? state.stagedQuietSinceMs
    : nowMs;
  if (nowMs - quietSince < stagedQuietMs) {
    saveSchedulerState(repoRoot, { ...state, stagedSignature: stagedSig, stagedQuietSinceMs: quietSince });
    return { action: 'waiting', reason: 'staged-quiet-window-pending', files: stagedFiles };
  }
  const validated = validatePreStagedBatch(repoRoot, stagedFiles, latestAudit);
  if (validated.blocked) return validated.blocked;
  if (dryRun) {
    return { action: 'dry-run-ready', mode: 'pre-staged', project: validated.project, files: stagedFiles };
  }
  const committed = msgLib.executeGitCommit(repoRoot, validated.message);
  if (!committed.ok) {
    saveSchedulerState(repoRoot, { ...state, lastFailedFingerprint: currentFingerprint });
    return { action: 'failed', mode: 'pre-staged', reason: committed.error };
  }
  saveSchedulerState(repoRoot, {
    ...state,
    lastAutoCommitHeadOid: committed.headOid,
    lastCommittedFingerprint: currentFingerprint,
    lastFailedFingerprint: null,
    stagedSignature: null,
    stagedQuietSinceMs: null,
  });
  return { action: 'committed', mode: 'pre-staged', project: validated.project, headOid: committed.headOid, files: stagedFiles };
}

function unstageAfterHookFailure(repoRoot, files) {
  try {
    execGit(repoRoot, ['reset', 'HEAD', '--', ...files]);
  } catch (err) {
    process.stderr.write(`[async-auto-commit] unstage rollback warning: ${err.message}\n`);
  }
}

function stageAndCommitIdleBatch(repoRoot, batch, message, state, currentFingerprint) {
  try {
    execGit(repoRoot, ['add', '--', ...batch.files]);
  } catch (stageErr) {
    const errText = stageErr instanceof Error ? stageErr.message : String(stageErr);
    return { action: 'failed', mode: 'idle-auto-stage', reason: errText };
  }
  const committed = msgLib.executeGitCommit(repoRoot, message);
  if (!committed.ok) {
    unstageAfterHookFailure(repoRoot, batch.files);
    saveSchedulerState(repoRoot, { ...state, lastFailedFingerprint: currentFingerprint });
    return { action: 'rolled-back', mode: 'idle-auto-stage', reason: committed.error, files: batch.files };
  }
  saveSchedulerState(repoRoot, {
    ...state,
    lastAutoCommitHeadOid: committed.headOid,
    lastCommittedFingerprint: currentFingerprint,
    lastFailedFingerprint: null,
    worktreeFingerprint: null,
    worktreeQuietSinceMs: null,
  });
  return { action: 'committed', mode: 'idle-auto-stage', project: batch.project, headOid: committed.headOid, files: batch.files };
}

function handleIdleWorktreeCommit(repoRoot, ctx) {
  const { nowMs, idleCommitMs, hotFileGuardMs, latestAudit, state, currentFingerprint, dryRun } = ctx;
  const idleSince = state.worktreeFingerprint === currentFingerprint && state.worktreeQuietSinceMs
    ? state.worktreeQuietSinceMs
    : nowMs;
  if (nowMs - idleSince < idleCommitMs) {
    saveSchedulerState(repoRoot, { ...state, worktreeFingerprint: currentFingerprint, worktreeQuietSinceMs: idleSince });
    return { action: 'waiting', reason: 'worktree-idle-window-pending' };
  }
  const batch = leaseLib.selectIdleWorktreeBatch(repoRoot, nowMs, hotFileGuardMs);
  if (!batch.project || batch.files.length === 0) {
    return { action: 'skipped', reason: 'no-eligible-idle-files' };
  }
  const synth = msgLib.synthesizeAndVerifyCommitMessage(batch.project, batch.files, latestAudit, '');
  if (!synth.valid) {
    return { action: 'blocked', reason: 'commit-msg-synthesis-rejected', findings: synth.findings };
  }
  if (dryRun) {
    return { action: 'dry-run-ready', mode: 'idle-auto-stage', project: batch.project, files: batch.files };
  }
  return stageAndCommitIdleBatch(repoRoot, batch, synth.message, state, currentFingerprint);
}

function checkPreCommitEligibility(repoRoot, options) {
  if (options.disabled || options.commitPaused) {
    return { action: 'skipped', reason: 'auto-commit-paused-or-disabled' };
  }
  const activeGit = leaseLib.detectActiveGitOperation(repoRoot);
  if (activeGit) return { action: 'yielded', reason: `git-lock-active:${activeGit}` };
  if (!options.latestAudit || !options.latestAudit.healthy) {
    return { action: 'skipped', reason: 'audit-not-healthy-or-missing' };
  }
  return null;
}

/**
 * Perform one hybrid staging auto-commit evaluation and execution tick.
 *
 * @param {string} repoRoot - Repository root directory.
 * @param {object} [options] - Policy thresholds, fingerprint, latest audit, and dry-run flags.
 * @returns {object} Structured decision status (`action`, `reason`, `headOid`, `files`).
 */
function evaluateAndRunAutoCommit(repoRoot, options = {}) {
  const blocked = checkPreCommitEligibility(repoRoot, options);
  if (blocked) return blocked;

  const state = loadSchedulerState(repoRoot);
  const currentHead = resolveHeadOid(repoRoot);
  const currentFingerprint = options.fingerprint || '';
  if (state.lastFailedFingerprint && state.lastFailedFingerprint === currentFingerprint) {
    return { action: 'skipped', reason: 'awaiting-change-after-hook-rejection' };
  }
  if (
    state.lastAutoCommitHeadOid &&
    state.lastAutoCommitHeadOid === currentHead &&
    state.lastCommittedFingerprint === currentFingerprint
  ) {
    return { action: 'skipped', reason: 'self-commit-anti-loop-guard' };
  }

  const stagedFiles = leaseLib.listStagedFiles(repoRoot);
  const ctx = {
    nowMs: typeof options.nowMs === 'number' ? options.nowMs : Date.now(),
    stagedQuietMs: options.stagedQuietMs ?? DEFAULT_STAGED_QUIET_MS,
    idleCommitMs: options.idleCommitMs ?? DEFAULT_IDLE_COMMIT_MS,
    hotFileGuardMs: options.hotFileGuardMs ?? DEFAULT_HOT_FILE_GUARD_MS,
    latestAudit: options.latestAudit,
    state,
    currentFingerprint,
    stagedFiles,
    dryRun: Boolean(options.dryRun),
  };
  return stagedFiles.length > 0
    ? handlePreStagedCommit(repoRoot, ctx)
    : handleIdleWorktreeCommit(repoRoot, ctx);
}

module.exports = {
  DEFAULT_STAGED_QUIET_MS,
  DEFAULT_IDLE_COMMIT_MS,
  DEFAULT_HOT_FILE_GUARD_MS,
  ...leaseLib,
  ...msgLib,
  evaluateAndRunAutoCommit,
};
