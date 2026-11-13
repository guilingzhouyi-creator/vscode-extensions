/**
 * Module: Workspace Async Governance — Immutable Snapshot Capture & Taxis Ownership Probe
 * File Path: scripts/common/lib/async-audit-snapshot.js
 * Architecture Role: Computes cheap change fingerprints via Git status + targeted file stats,
 *   captures immutable snapshot entries for daemon scan_snapshot without dirtying disk, and
 *   detects live Taxis official-mode handoff ownership in `.taxis/daemon.json`.
 * Dependencies & Triggers: Pure Node built-ins (crypto, fs, path), ../git-env, and
 *   ./async-audit-io; called by async-auto-audit-daemon.js and async-auto-commit.js.
 * Responsibilities:
 *   1. Probe `.taxis/daemon.json` PID liveness + `manages_async_audit` handoff authority;
 *   2. Compute SHA-256 fingerprint over HEAD + porcelain paths + mtime/size cleanly;
 *   3. Build bounded immutable `SnapshotCaptureEntry` inputs without disk mutation;
 *   4. Map repository-relative POSIX paths to controlled `[Project]` identifiers.
 * Exit Semantics & Design Rationale: Keeps polling lightweight by inspecting changed/staged/
 *   untracked paths first while snapshot capture enforces strict entry and byte bounds.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const { getSafeGitEnv } = require('../git-env');
const { isPidAlive, readJsonSafe } = require('./async-audit-io');

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_ENTRIES = 2000;
const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 16 * 1024 * 1024;
const MIN_STATUS_EXPANSION = 32;
const SNAPSHOT_EXT_RE = /\.(ts|tsx|js|mjs|cjs|rs|py|gd|ps1|sh|json|md)$/i;

const IGNORED_PATH_PREFIXES = Object.freeze([
  '.git/',
  '.taxis/',
  '.audit-logs/',
  '.auto-refactor-cache/',
  'node_modules/',
  'target/',
  'dist/',
  'out/',
]);

const PROJECT_PREFIX_MAP = Object.freeze([
  ['auto-refactor/', 'auto-refactor'],
  ['fractal-git/', 'fractal-git'],
  ['workspace-timing/', 'workspace-timing'],
  ['WebGames/', 'webgames'],
]);

function execGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    env: getSafeGitEnv(repoRoot),
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function toPosixPath(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function classifyPathProject(relPath) {
  const normalized = toPosixPath(relPath);
  for (const [prefix, project] of PROJECT_PREFIX_MAP) {
    if (normalized.startsWith(prefix)) return project;
  }
  return 'governance';
}

function inspectTaxisKernelOwnership(repoRoot) {
  const daemonMetaPath = path.join(path.resolve(repoRoot), '.taxis', 'daemon.json');
  const data = readJsonSafe(daemonMetaPath, null);
  if (!data || typeof data !== 'object') {
    return { active: false, pid: null, managesAsyncAudit: false };
  }
  const managesAsyncAudit = data.manages_async_audit === true || data.managesAsyncAudit === true;
  const pid = Number.isInteger(data.pid) ? data.pid : null;
  return {
    active: Boolean(managesAsyncAudit && pid !== null && isPidAlive(pid)),
    pid,
    managesAsyncAudit,
  };
}

function resolveHeadOid(repoRoot) {
  try {
    const trimmed = String(execGit(repoRoot, ['rev-parse', '--verify', 'HEAD']) || '').trim();
    return /^[0-9a-f]{40}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  } catch (err) {
    void err;
    return null;
  }
}

function listGitStatusRecords(repoRoot) {
  try {
    const raw = execGit(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const tokens = String(raw || '').split('\0').filter(Boolean);
    const records = [];
    for (let i = 0; i < tokens.length; i++) {
      const entry = tokens[i];
      if (entry.length < 4) continue;
      const indexCode = entry[0];
      const worktreeCode = entry[1];
      records.push({ status: `${indexCode}${worktreeCode}`, indexCode, worktreeCode, path: toPosixPath(entry.slice(3)) });
      if ((indexCode === 'R' || indexCode === 'C') && i + 1 < tokens.length) i++;
    }
    return records;
  } catch (err) {
    void err;
    return [];
  }
}

function isIgnoredPath(posixPath) {
  return IGNORED_PATH_PREFIXES.some((prefix) => posixPath.startsWith(prefix));
}

function readStatSignature(fullPath) {
  try {
    const stat = fs.lstatSync(fullPath);
    return stat.isSymbolicLink() ? `symlink:${stat.size}` : `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch (err) {
    void err;
    return 'missing';
  }
}

function computeWorkspaceFingerprint(repoRoot) {
  const headOid = resolveHeadOid(repoRoot);
  const records = listGitStatusRecords(repoRoot)
    .filter((rec) => !isIgnoredPath(rec.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const hash = createHash('sha256');
  hash.update(`head:${headOid || 'unborn'}\n`);
  for (const rec of records) {
    hash.update(`${rec.status}:${rec.path}:${readStatSignature(path.join(repoRoot, rec.path))}\n`);
  }
  return { fingerprint: hash.digest('hex'), headOid, records, clean: records.length === 0 };
}

function listTrackedSnapshotCandidates(repoRoot, statusCount) {
  if (statusCount >= MIN_STATUS_EXPANSION) return [];
  try {
    return String(execGit(repoRoot, ['ls-files', '-z']) || '')
      .split('\0')
      .map(toPosixPath)
      .filter((rel) => rel && !isIgnoredPath(rel));
  } catch (err) {
    void err;
    return [];
  }
}

function readSnapshotTextEntry(repoRoot, relPath, remainingBytes) {
  try {
    const stat = fs.lstatSync(path.join(repoRoot, relPath));
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES || stat.size > remainingBytes) return null;
    const buf = fs.readFileSync(path.join(repoRoot, relPath));
    if (buf.includes(0)) return null;
    return { entry: { path: relPath, mode: '100644', content: buf.toString('utf8') }, byteLength: buf.byteLength };
  } catch (err) {
    void err;
    return null;
  }
}

function collectSnapshotEntries(repoRoot, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_SNAPSHOT_ENTRIES;
  const maxTotalBytes = Number.isInteger(options.maxTotalBytes)
    ? options.maxTotalBytes
    : MAX_SNAPSHOT_TOTAL_BYTES;
  const statusRecords = listGitStatusRecords(repoRoot)
    .filter((rec) => !isIgnoredPath(rec.path) && rec.worktreeCode !== 'D' && rec.indexCode !== 'D')
    .map((rec) => rec.path);
  const orderedPaths = [...new Set([...statusRecords, ...listTrackedSnapshotCandidates(repoRoot, statusRecords.length)])].slice(0, maxEntries);
  const entries = [];
  let totalBytes = 0;

  for (const relPath of orderedPaths) {
    if (!SNAPSHOT_EXT_RE.test(relPath)) continue;
    const readResult = readSnapshotTextEntry(repoRoot, relPath, maxTotalBytes - totalBytes);
    if (!readResult) continue;
    entries.push(readResult.entry);
    totalBytes += readResult.byteLength;
    if (totalBytes >= maxTotalBytes) break;
  }
  return entries;
}

module.exports = {
  MAX_SNAPSHOT_ENTRIES,
  MAX_SNAPSHOT_TOTAL_BYTES,
  execGit,
  toPosixPath,
  classifyPathProject,
  inspectTaxisKernelOwnership,
  resolveHeadOid,
  listGitStatusRecords,
  isIgnoredPath,
  computeWorkspaceFingerprint,
  collectSnapshotEntries,
};
