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
 * Exit Semantics & Design Rationale: Library module. Every Git invocation uses an argument array
 *   (execFileSync) rather than an interpolated command string, so a path or revision containing
 *   shell metacharacters is passed through as data and can never be parsed as syntax.
 *   Resolution failures return an empty result by default; callers that gate on the outcome pass
 *   { strict: true } to receive a GitRangeError instead, because "git could not resolve the range"
 *   must never be indistinguishable from "the range contains no changes".
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..');

const GIT_BIN = 'git';

/**
 * Raised when Git cannot resolve an explicitly requested revision range.
 *
 * Distinct from an empty result on purpose: a gate that receives zero files because the range
 * does not resolve would otherwise report success without having examined anything.
 */
class GitRangeError extends Error {
  /**
   * @param {string} range - Revision range that failed to resolve.
   * @param {Error} cause - Underlying spawn or exit error.
   */
  constructor(range, cause) {
    super(`Unable to resolve Git revision range '${range}': ${cause.message.split('\n')[0]}`);
    this.name = 'GitRangeError';
    this.range = range;
    this.cause = cause;
  }
}

/**
 * Runs Git with an argument array and a sanitized environment.
 *
 * @param {string[]} args - Git subcommand and arguments, passed verbatim.
 * @param {Record<string, unknown>} options - Node spawn options merged over the safe defaults.
 * @returns {Buffer|string} Command output in the requested encoding.
 */
function runGit(args, options) {
  const opts = options || {};
  const root = opts.cwd || DEFAULT_REPO_ROOT;
  return execFileSync(GIT_BIN, args, {
    encoding: opts.encoding,
    input: opts.input,
    stdio: opts.stdio || ['ignore', 'pipe', 'ignore'],
    maxBuffer: opts.maxBuffer || 10 * 1024 * 1024,
    cwd: root,
    env: getSafeGitEnv(root),
  });
}

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
 * Raised when Git cannot enumerate the staging area.
 *
 * Distinct from an empty index on purpose: a gate that receives zero files because the repository
 * is unreadable would otherwise report "nothing to check" and pass, which is the failure mode this
 * type exists to prevent.
 */
class GitIndexError extends Error {
  /**
   * @param {Error} cause - Underlying spawn or exit error.
   */
  constructor(cause) {
    super(`Unable to enumerate the Git staging area: ${cause.message.split('\n')[0]}`);
    this.name = 'GitIndexError';
    this.cause = cause;
  }
}

/**
 * Retrieves the list of staged files from Git index, or returns explicit files from CLI arguments.
 *
 * @param {string} [repoRoot] - Repository root directory.
 * @param {string[]} [explicitArgs] - Optional command line argument list.
 * @param {{strict?: boolean}} [options] - strict: raise GitIndexError instead of returning [].
 * @returns {string[]} Array of normalized relative or absolute staged file paths.
 * @throws {GitIndexError} When strict is set and Git cannot read the index.
 */
function getStagedFiles(repoRoot, explicitArgs, options) {
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const strict = Boolean(options && options.strict);
  if (Array.isArray(explicitArgs)) {
    const explicitFiles = explicitArgs.filter((a) => a && !a.startsWith('-'));
    if (explicitFiles.length > 0) {
      return explicitFiles;
    }
  }

  try {
    const raw = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
      cwd: root,
      encoding: 'utf8',
    });
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    if (strict) throw new GitIndexError(err);
    return [];
  }
}

/**
 * Resolves file paths modified across a specified Git commit range.
 *
 * @param {string} range - Git revision range (e.g. '@{u}..HEAD' or 'origin/main..HEAD').
 * @param {string} [repoRoot] - Repository root directory.
 * @param {{strict?: boolean}} [options] - strict: raise GitRangeError instead of returning [].
 * @returns {string[]} Array of changed file paths.
 * @throws {GitRangeError} When strict is set and Git cannot resolve the range.
 */
function getRangeFiles(range, repoRoot, options) {
  if (!range) return [];
  const root = repoRoot || DEFAULT_REPO_ROOT;
  const strict = Boolean(options && options.strict);

  try {
    // The range is a single argv element: ';', '|', '$()' and backticks inside it stay literal.
    const raw = runGit(['diff', '--name-only', '--diff-filter=ACMR', range], {
      cwd: root,
      encoding: 'utf8',
    });
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    if (strict) throw new GitRangeError(range, err);
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
  if (typeof relPath !== 'string' || relPath.length === 0) return '';
  const gitPath = relPath.replace(/\\/g, '/');

  try {
    return runGit(['show', `:${gitPath}`], {
      cwd: root,
      encoding: 'utf8',
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
  if (typeof relPath !== 'string' || relPath.length === 0) return null;
  const gitPath = relPath.replace(/\\/g, '/');

  try {
    return runGit(['show', `:${gitPath}`], {
      cwd: root,
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
    raw = runGit(['cat-file', '--batch', '--buffer'], {
      cwd: root,
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
  GitRangeError,
  GitIndexError,
  getSafeGitEnv,
  getStagedFiles,
  getRangeFiles,
  readStagedContentSafe,
  readStagedBufferSafe,
  readStagedBuffersBatch,
});
