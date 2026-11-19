/**
 * Module: Infrastructure — Workspace Directory Traversal & Physical Filter
 * File Path: scripts/common/workspace-walker.js
 * Architecture Role: Single source of truth for repository tree traversal, directory pruning,
 *   and file collection across governance gates, audit engines, and maintenance scripts.
 * Dependencies & Triggers: Node.js standard libraries (fs, path); consumed across scripts/.
 * Responsibilities:
 *   1. Define SSOT blacklisted directories (node_modules, .git, dist, target, .godot, tmp, etc.).
 *   2. Provide safe, memory-bounded, iterative directory tree traversal.
 *   3. Support extension matching, custom exclusion predicates, and relative path conversion.
 * Exit Semantics & Design Rationale: Pure library module with zero side effects; does not exit
 *   or throw on inaccessible non-fatal entries.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Standard directories excluded from workspace analysis and governance sweeps.
 */
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'target',
  '.godot',
  '.cargo-lock',
  '.mypy_cache',
  '.dsh-plugin-download',
  '.workbuddy',
  '.commandcode',
  '.auto-refactor',
  '.auto-refactor-cache',
  '.gemini',
  '.audit-logs',
  'archive',
  '.corpus',
  '.diff-corpus',
  '.rust-corpus',
  '.equivalence-corpus',
  '.equivalence-rust-corpus',
  '.bench-corpus',
  'tmp',
  'temp',
  '.praxis',
  '.taxis',
  '.vitest',
  '.venv',
  'venv',
]);

/**
 * Derives a new ignored directory Set from `DEFAULT_IGNORED_DIRS` with optional additions and omissions.
 *
 * @param {Iterable<string>} [extraDirs=[]] - Additional directory names to ignore.
 * @param {Iterable<string>} [omitDirs=[]] - Directory names to remove from the default ignore set.
 * @returns {Set<string>} Derived ignore directory set.
 */
function createIgnoredDirSet(extraDirs = [], omitDirs = []) {
  const result = new Set(DEFAULT_IGNORED_DIRS);
  if (extraDirs) {
    for (const dir of extraDirs) {
      if (typeof dir === 'string' && dir.length > 0) {
        result.add(dir);
      }
    }
  }
  if (omitDirs) {
    for (const dir of omitDirs) {
      result.delete(dir);
    }
  }
  return result;
}

/**
 * Standard text extensions subject to physical hygiene and static code analysis.
 */
const DEFAULT_TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.gd', '.py',
  '.rs', '.ps1', '.sh', '.bash', '.yaml', '.yml', '.toml', '.txt',
  '.html', '.css', '.svg', '.xml', '.ini', '.cfg', '.env', '.example',
]);

/**
 * Checks whether a given directory name matches the ignore criteria.
 *
 * @param dirName - Simple directory name (not path).
 * @param customIgnores - Optional custom set of ignored directory names.
 * @returns True if directory should be skipped.
 */
function isIgnoredDirectory(dirName, customIgnores) {
  if (customIgnores && customIgnores.has(dirName)) {
    return true;
  }
  return DEFAULT_IGNORED_DIRS.has(dirName);
}

/**
 * Decides what a single directory entry contributes to the traversal.
 *
 * @param entry - Dirent from `readdirSync(..., { withFileTypes: true })`.
 * @param currentDir - Absolute directory the entry was read from.
 * @param rules - Resolved traversal rules (extension set, ignore set, filter).
 * @returns The child directory to descend into, the file path to record, or null.
 */
function classifyEntry(entry, currentDir, rules) {
  if (entry.isDirectory()) {
    return rules.ignored.has(entry.name)
      ? null
      : { descend: path.join(currentDir, entry.name) };
  }
  if (!entry.isFile()) {
    return null;
  }
  if (rules.extSet && !rules.extSet.has(path.extname(entry.name))) {
    return null;
  }
  const filePath = path.join(currentDir, entry.name);
  if (rules.filterFn && !rules.filterFn(filePath, entry)) {
    return null;
  }
  return { file: filePath };
}

/**
 * Iteratively collects all files matching criteria under a root directory.
 *
 * @param rootDir - Absolute or relative path to scan root.
 * @param options - Traversal options.
 * @param options.extensions - Set or Array of allowed file extensions (e.g. ['.js', '.ts']).
 * @param options.ignoredDirs - Custom set of directory names to skip.
 * @param options.relative - If true, returns paths relative to rootDir.
 * @param options.filter - Custom predicate (absolutePath, dirent) => boolean.
 * @returns Array of matching file paths sorted lexicographically.
 */
function collectWorkspaceFiles(rootDir, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  const rules = {
    extSet: options.extensions ? new Set(options.extensions) : null,
    ignored: options.ignoredDirs || DEFAULT_IGNORED_DIRS,
    filterFn: typeof options.filter === 'function' ? options.filter : null,
  };
  const isRelative = Boolean(options.relative);

  const results = [];
  const dirStack = [resolvedRoot];

  while (dirStack.length > 0) {
    const currentDir = dirStack.pop();
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (let i = 0; i < entries.length; i++) {
      const decision = classifyEntry(entries[i], currentDir, rules);
      if (!decision) continue;
      if (decision.descend) {
        dirStack.push(decision.descend);
        continue;
      }
      results.push(isRelative ? path.relative(resolvedRoot, decision.file) : decision.file);
    }
  }

  return results.sort();
}

/**
 * Walks directory tree calling a visitor function on each file.
 *
 * @param rootDir - Scan root directory path.
 * @param visitor - Callback invoked with (filePath, dirent). Return false to abort tree.
 * @param options - Traversal configuration.
 */
function walkWorkspace(rootDir, visitor, options = {}) {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot) || typeof visitor !== 'function') {
    return;
  }

  const ignored = options.ignoredDirs || DEFAULT_IGNORED_DIRS;
  const dirStack = [resolvedRoot];

  while (dirStack.length > 0) {
    const currentDir = dirStack.pop();
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          dirStack.push(path.join(currentDir, entry.name));
        }
        continue;
      }

      if (entry.isFile()) {
        const filePath = path.join(currentDir, entry.name);
        const shouldContinue = visitor(filePath, entry);
        if (shouldContinue === false) {
          return;
        }
      }
    }
  }
}

module.exports = {
  DEFAULT_IGNORED_DIRS,
  DEFAULT_TEXT_EXTENSIONS,
  createIgnoredDirSet,
  isIgnoredDirectory,
  collectWorkspaceFiles,
  walkWorkspace,
};
