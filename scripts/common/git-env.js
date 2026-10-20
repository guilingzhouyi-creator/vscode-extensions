/**
 * Module: Workspace Governance — Git Isolation Environment & Staged Stream Provider
 * File Path: scripts/common/git-env.js
 * Architecture Role: Centralized single-source-of-truth utility providing safe, isolated Git
 *   process environments, staged file enumerations, revision-range file resolutions, and
 *   in-memory staged content retrieval across all gate checks and volume budget evaluators.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process);
 *   invoked by gate-fast-staged, validate-staged-slice, validate-code-density, evaluate-eloc-budget,
 *   and validate-commit-msg.
 * Responsibilities:
 *   1. Generate sanitized, isolated Git process environments preventing global config lockouts;
 *   2. Retrieve staged file paths with optional CLI argument override support;
 *   3. Resolve file paths modified across arbitrary revision ranges (e.g. '@{u}..HEAD');
 *   4. Safely extract staged buffer contents via git-show with fallback to working tree disk read;
 *   5. Enforce substantive utility discipline with immutable object exports.
 * Exit Semantics & Design Rationale: Library module exporting deterministic pure functions;
 *   throws no unhandled exceptions and safely falls back on Git execution failures.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Constructs an isolated, sanitized Git environment object preventing global config permission
 * lockouts on Windows while preserving essential system PATH variables.
 *
 * @param {string} [repoRoot] - Optional custom repository root directory.
 * @returns {Record<string, string>} Sanitized process environment dictionary.
 */
function getSafeGitEnv(repoRoot) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || 'NUL',
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM || 'NUL',
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM || '1',
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || root,
  };
}

/**
 * Retrieves the list of staged files from Git index, or returns explicit files from CLI arguments.
 *
 * @param {string} [repoRoot] - Repository root directory.
 * @param {string[]} [explicitArgs] - Optional command line argument list.
 * @returns {string[]} Array of normalized relative or absolute staged file paths.
 */
function getStagedFiles(repoRoot, explicitArgs) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  if (Array.isArray(explicitArgs)) {
    const explicitFiles = explicitArgs.filter((a) => a && !a.startsWith('-'));
    if (explicitFiles.length > 0) {
      return explicitFiles;
    }
  }

  try {
    const raw = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: root,
      env: getSafeGitEnv(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolves file paths modified across a specified Git commit range.
 *
 * @param {string} range - Git revision range (e.g. '@{u}..HEAD' or 'origin/main..HEAD').
 * @param {string} [repoRoot] - Repository root directory.
 * @returns {string[]} Array of changed file paths.
 */
function getRangeFiles(range, repoRoot) {
  if (!range) return [];
  const root = repoRoot || DEFAULT_REPO_ROOT;

  try {
    const raw = execSync(`git diff --name-only --diff-filter=ACMR ${range}`, {
      cwd: root,
      env: getSafeGitEnv(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Safely reads the staged version of a file from Git index using git-show,
 * falling back to the working tree on disk if the file is not yet indexed or Git fails.
 *
 * @param {string} repoRoot - Repository root directory.
 * @param {string} relPath - Relative path of the file from repoRoot.
 * @returns {string} Text content of the staged file, or empty string on total failure.
 */
function readStagedContentSafe(repoRoot, relPath) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const gitPath = relPath.replace(/\\/g, '/');

  try {
    return execSync(`git show ":${gitPath}"`, {
      cwd: root,
      env: getSafeGitEnv(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    const fullPath = path.join(root, relPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, 'utf8');
    }
    return '';
  }
}

/**
 * Reads the staged (index) version of a file as a raw buffer, falling back to the
 * working tree only when the path is not present in the index.
 *
 * @param {string} repoRoot - Repository root directory.
 * @param {string} relPath - Relative path of the file from repoRoot.
 * @returns {Buffer|null} Raw staged bytes, or null when neither index nor disk has the path.
 */
function readStagedBufferSafe(repoRoot, relPath) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const gitPath = relPath.replace(/\\/g, '/');

  try {
    return execSync(`git show ":${gitPath}"`, {
      cwd: root,
      env: getSafeGitEnv(root),
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    const fullPath = path.join(root, relPath);
    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath);
    }
    return null;
  }
}

/**
 * Reads many staged blobs in a single Git process.
 *
 * The per-file `git show ":path"` helper spawns one process per file, which
 * dominates runtime once a commit touches dozens of files. `git cat-file
 * --batch` accepts `<rev>:<path>` lines on stdin and streams
 * `<oid> <type> <size>\n<content>\n` for each, so N files cost one spawn.
 *
 * Paths absent from the index are reported as failures and left out of the
 * result map; callers fall back to the working tree for those, exactly as the
 * single-file helper does.
 *
 * @param {string} repoRoot - Repository root directory.
 * @param {string[]} relPaths - Repository-relative paths.
 * @returns {Map<string, Buffer>} relPath -> staged bytes, only for hits.
 */
function readStagedBuffersBatch(repoRoot, relPaths) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const results = new Map();
  const targets = Array.isArray(relPaths) ? relPaths.filter(Boolean) : [];
  if (targets.length === 0) return results;

  const request = targets.map((p) => `:${p.replace(/\\/g, '/')}`).join('\n') + '\n';

  let raw;
  try {
    raw = execSync('git cat-file --batch --buffer', {
      cwd: root,
      env: getSafeGitEnv(root),
      input: request,
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return results;
  }

  let offset = 0;
  for (const relPath of targets) {
    const headerEnd = raw.indexOf(0x0a, offset);
    if (headerEnd === -1) break;
    const header = raw.subarray(offset, headerEnd).toString('utf8');
    offset = headerEnd + 1;

    // Missing objects answer with "<spec> missing" and carry no payload.
    const parts = header.trim().split(' ');
    if (parts.length < 3) continue;
    const size = Number(parts[2]);
    if (!Number.isFinite(size) || size < 0) continue;

    results.set(relPath, raw.subarray(offset, offset + size));
    offset += size + 1; // trailing newline after each object body
  }

  return results;
}

module.exports = Object.freeze({
  DEFAULT_REPO_ROOT,
  getSafeGitEnv,
  getStagedFiles,
  getRangeFiles,
  readStagedContentSafe,
  readStagedBufferSafe,
  readStagedBuffersBatch,
});
