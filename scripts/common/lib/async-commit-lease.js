/**
 * Module: Workspace Async Governance — Blackboard Lease Filter & Diff Budget Selector
 * File Path: scripts/common/lib/async-commit-lease.js
 * Architecture Role: Provides Git lock/operation detection, Taxis blackboard lease exclusion,
 *   and 5D diff-volume bounded batch selection for async-auto-commit.js.
 * Dependencies & Triggers: Node built-ins (fs, path), ./diff-bounds-policy,
 *   ./async-audit-snapshot, and ./async-audit-envelope.
 * Responsibilities:
 *   1. Resolve `.git` paths (including gitdir pointer worktrees) and detect active Git locks;
 *   2. Collect active Taxis blackboard lease prefixes and exclude volatile/leased paths;
 *   3. Select bounded single-project batches (`selectIdleWorktreeBatch`) safely under hot guards.
 * Exit Semantics & Design Rationale: Keeps cyclomatic complexity and nesting shallow while never
 *   overriding active `.git/index.lock` or external parallel agent leases.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { BATCH_BANDS } = require('./diff-bounds-policy');
const {
  classifyPathProject,
  execGit,
  isIgnoredPath,
  listGitStatusRecords,
} = require('./async-audit-snapshot');
const { readJsonSafe } = require('./async-audit-envelope');

const MAX_LINE_BUDGET_FALLBACK = BATCH_BANDS.add.ceiling || 360;
const DELETION_VOLUME_WEIGHT = 0.5;
const VOLATILE_BASENAMES = new Set([
  'governance-supervisor.json',
  'last-failure.json',
  'last-commit-msg.log',
]);

function resolveGitInternalPath(repoRoot, childName) {
  const dotGit = path.join(path.resolve(repoRoot), '.git');
  try {
    if (fs.statSync(dotGit).isFile()) {
      const match = /^gitdir:\s*(.+)$/im.exec(fs.readFileSync(dotGit, 'utf8'));
      if (match) return path.resolve(repoRoot, match[1].trim(), childName);
    }
  } catch (err) {
    void err;
  }
  return path.join(dotGit, childName);
}

/** Check whether Git is mid-transaction (`.git/index.lock`, merge, rebase, cherry-pick). */
function detectActiveGitOperation(repoRoot) {
  const guards = ['index.lock', 'MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'];
  for (const marker of guards) {
    if (fs.existsSync(resolveGitInternalPath(repoRoot, marker))) return marker;
  }
  return null;
}

function addLeasePaths(locked, lease) {
  if (!lease || lease.status === 'released' || lease.status === 'expired') return;
  const rawPaths = [lease.ownedPaths, lease.paths, lease.path_globs].flat().filter(Boolean);
  for (const raw of rawPaths) {
    if (typeof raw === 'string' && raw.trim()) {
      locked.add(raw.trim().replace(/\\/g, '/').replace(/\*.*$/, ''));
    }
  }
}

/** Collect repository-relative path prefixes/files currently claimed by Taxis blackboard leases. */
function collectLeasedPaths(repoRoot) {
  const locked = new Set();
  const candidates = [
    path.join(repoRoot, '.taxis', 'blackboard.json'),
    resolveGitInternalPath(repoRoot, 'blackboard.json'),
  ];
  for (const candidate of candidates) {
    const data = readJsonSafe(candidate, null);
    if (!data || typeof data !== 'object') continue;
    const entries = Array.isArray(data.leases) ? data.leases : Object.values(data.leases || {});
    for (const lease of entries) addLeasePaths(locked, lease);
  }
  return locked;
}

/** Determine whether a repository-relative path is volatile metadata or excluded from auto-staging. */
function isExcludedAutoStagePath(relPath, leasedPrefixes) {
  if (isIgnoredPath(relPath)) return true;
  if (relPath.includes('/baselines/') || relPath.startsWith('baselines/')) return true;
  if (VOLATILE_BASENAMES.has(path.posix.basename(relPath))) return true;
  for (const prefix of leasedPrefixes) {
    if (prefix && (relPath === prefix || (prefix.endsWith('/') && relPath.startsWith(prefix)))) {
      return true;
    }
  }
  return false;
}

/** List currently staged file paths in `.git/index`. */
function listStagedFiles(repoRoot) {
  try {
    const out = execGit(repoRoot, ['diff', '--cached', '--name-only', '-z']);
    return String(out || '').split('\0').map((p) => p.replace(/\\/g, '/')).filter(Boolean);
  } catch (err) {
    void err;
    return [];
  }
}

function estimateChangedLineVolume(repoRoot, files, cached) {
  if (files.length === 0) return 0;
  try {
    const modeFlag = cached ? ['diff', '--cached', '--numstat'] : ['diff', '--numstat'];
    const out = execGit(repoRoot, [...modeFlag, '--', ...files]);
    let total = 0;
    for (const line of String(out || '').split(/\r?\n/)) {
      const match = /^(\d+)\s+(\d+)\s+/.exec(line);
      if (match) total += Number(match[1]) + Math.round(Number(match[2]) * DELETION_VOLUME_WEIGHT);
    }
    return total;
  } catch (err) {
    void err;
    return 0;
  }
}

function isIdleEligibleFile(repoRoot, rec, leased, nowMs, hotGuardMs) {
  if (rec.worktreeCode === ' ' && rec.indexCode !== '?') return false;
  if (isExcludedAutoStagePath(rec.path, leased)) return false;
  try {
    const stat = fs.lstatSync(path.join(repoRoot, rec.path));
    return !stat.isDirectory() && !stat.isSymbolicLink() && nowMs - stat.mtimeMs >= hotGuardMs;
  } catch (err) {
    void err;
    return false;
  }
}

/** Select eligible unstaged/untracked paths for a single `[Project]` under diff bounds and hot guard. */
function selectIdleWorktreeBatch(repoRoot, nowMs, hotGuardMs) {
  const leased = collectLeasedPaths(repoRoot);
  const byProject = new Map();
  for (const rec of listGitStatusRecords(repoRoot)) {
    if (!isIdleEligibleFile(repoRoot, rec, leased, nowMs, hotGuardMs)) continue;
    const proj = classifyPathProject(rec.path);
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj).push(rec.path);
  }
  if (byProject.size === 0) return { project: null, files: [] };

  const [project, candidates] = [...byProject.entries()].sort((a, b) => a[1].length - b[1].length)[0];
  const selected = [];
  let runningVolume = 0;
  for (const relPath of candidates.sort()) {
    const delta = estimateChangedLineVolume(repoRoot, [relPath], false);
    if (selected.length > 0 && runningVolume + delta > MAX_LINE_BUDGET_FALLBACK) break;
    selected.push(relPath);
    runningVolume += delta;
  }
  return { project, files: selected };
}

module.exports = {
  MAX_LINE_BUDGET_FALLBACK,
  detectActiveGitOperation,
  collectLeasedPaths,
  isExcludedAutoStagePath,
  listStagedFiles,
  estimateChangedLineVolume,
  selectIdleWorktreeBatch,
};
