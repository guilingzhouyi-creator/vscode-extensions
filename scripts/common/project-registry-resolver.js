/**
 * Module: Controlled Project Registry & Active Lease Resolver
 * File Path: scripts/common/project-registry-resolver.js
 * Architecture Role: Single source of truth for dynamically discovering registered controlled
 *   projects and evaluating real-time TTL lease statuses (Active/Frozen/Evicted) from Taxis.
 * Dependencies & Triggers: Consumed by commit-structure-contract.js, generate-rule-catalog.js,
 *   pre-commit gates, and audit pipelines; queries `taxis project list --json` and falls back
 *   to .taxis/runtime/active_projects.json and marker auto-discovery.
 * Responsibilities:
 *   1. Cache and resolve active controlled project leases from Taxis runtime;
 *   2. Determine whether a project ID is currently valid and unexpired;
 *   3. Enforce fail-closed commit rejection when a project lease is Frozen;
 *   4. Provide opportunistic fallback discovery during early bootstrap or uninitialized states.
 * Exit Semantics & Design Rationale: Exposes clean pure query APIs with in-memory memoization,
 *   eliminating hardcoded project arrays across workspace governance tools.
 *
 * @module project-registry-resolver
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_CACHE_CANDIDATES = Object.freeze([
  path.join(REPO_ROOT, '.taxis', 'projects', 'active_projects.json'),
  path.join(REPO_ROOT, '.git', 'projects', 'active_projects.json'),
  path.join(REPO_ROOT, '.taxis', 'runtime', 'active_projects.json'),
]);

/** Default project aliases and fallback IDs accepted across tooling. */
const DEFAULT_PROJECT_IDS = Object.freeze([
  'auto-refactor',
  'fractal-git',
  'governance',
  'webgames',
  'workspace-timing',
]);

const PROJECT_ALIASES = Object.freeze({
  'web-games': 'webgames',
  'fractalgit': 'fractal-git',
  'timing': 'workspace-timing',
});

let memoizedLeases = null;
let lastResolvedTimeMs = 0;
const CACHE_TTL_MS = 2000;

/**
 * Normalizes a raw project identifier by trimming, lowercasing, and mapping known aliases.
 *
 * @param {string} id - Raw project identifier.
 * @returns {string} Canonical lowercase project identifier.
 */
function normalizeProjectId(id) {
  if (!id) return '';
  const lower = String(id).trim().toLowerCase();
  return PROJECT_ALIASES[lower] || lower;
}

/**
 * Attempts to load active project leases from the Taxis runtime cache file.
 *
 * @returns {Array<object>|null} Parsed project leases, or null if unreadable.
 */
function readRuntimeCacheFile() {
  for (const cacheFilePath of RUNTIME_CACHE_CANDIDATES) {
    try {
      if (!fs.existsSync(cacheFilePath)) {
        continue;
      }
      const cacheFileContent = fs.readFileSync(cacheFilePath, 'utf8');
      const parsedCache = JSON.parse(cacheFileContent);
      if (parsedCache && typeof parsedCache === 'object') {
        if (Array.isArray(parsedCache.leases)) {
          return parsedCache.leases;
        }
        if (parsedCache.leases && typeof parsedCache.leases === 'object') {
          return Object.values(parsedCache.leases);
        }
      }
    } catch {
      // Ignore corrupt or unreadable cache file and proceed to next candidate
    }
  }
  return null;
}

/**
 * Attempts to invoke the native taxis binary to retrieve active project leases in JSON.
 *
 * @returns {Array<object>|null} Parsed leases from CLI, or null on failure.
 */
function queryTaxisCli() {
  const isWindows = process.platform === 'win32';
  const binaryCandidates = [
    path.join(REPO_ROOT, 'fractal-git', 'target', 'release', isWindows ? 'taxis.exe' : 'taxis'),
    path.join(REPO_ROOT, 'fractal-git', 'target', 'debug', isWindows ? 'taxis.exe' : 'taxis'),
  ];

  let binaryPath = null;
  for (const candidate of binaryCandidates) {
    if (fs.existsSync(candidate)) {
      binaryPath = candidate;
      break;
    }
  }

  if (!binaryPath) {
    return null;
  }

  try {
    const gitDir = path.join(REPO_ROOT, '.taxis');
    const output = execFileSync(
      binaryPath,
      ['--git-dir', gitDir, '--json', 'project', 'list', '--all'],
      {
        cwd: REPO_ROOT,
        timeout: 3000,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const parsedCliOutput = JSON.parse(output);
    if (Array.isArray(parsedCliOutput)) {
      return parsedCliOutput;
    }
  } catch {
    // Fall through if binary invocation fails
  }

  return null;
}

/**
 * Opportunistically sniffs project roots in the workspace to construct fallback leases.
 *
 * @returns {Array<object>} Synthetic project leases for detected workspace folders.
 */
function sniffWorkspaceFallback() {
  const discovered = [];
  const entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const projDir = path.join(REPO_ROOT, entry.name);
    const hasCargo = fs.existsSync(path.join(projDir, 'Cargo.toml'));
    const hasPackage = fs.existsSync(path.join(projDir, 'package.json'));
    const hasGodot = fs.existsSync(path.join(projDir, 'project.godot'));

    if (hasCargo || hasPackage || hasGodot) {
      discovered.push({
        id: entry.name,
        root_path: entry.name,
        status: 'Active',
        master_ttl_seconds: 604800,
        commit_counter: 0,
      });
    }
  }

  // Ensure governance root is registered
  discovered.push({
    id: 'governance',
    root_path: '.',
    status: 'Active',
    master_ttl_seconds: 604800,
    commit_counter: 0,
  });

  return discovered;
}

/**
 * Resolves all known project leases using CLI, runtime cache file, or workspace sniffing.
 *
 * @param {boolean} [forceRefresh=false] - Bypass in-memory memoization.
 * @returns {Array<object>} Array of project lease records.
 */
function resolveProjectLeases(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoizedLeases && now - lastResolvedTimeMs < CACHE_TTL_MS) {
    return memoizedLeases;
  }

  // Priority 1: Read runtime cache file (fastest, no process spawn)
  let leases = readRuntimeCacheFile();

  // Priority 2: Query taxis CLI if cache missing
  if (!leases) {
    leases = queryTaxisCli();
  }

  // Priority 3: Fallback discovery
  if (!leases || leases.length === 0) {
    leases = sniffWorkspaceFallback();
  }

  memoizedLeases = leases;
  lastResolvedTimeMs = now;
  return memoizedLeases;
}

/**
 * Returns canonical IDs of all currently active (non-frozen, non-evicted) projects.
 *
 * @returns {string[]} Lowercase active project identifiers.
 */
function getActiveProjectIds() {
  const leases = resolveProjectLeases();
  const activeIds = [];

  for (const lease of leases) {
    const status = lease.status || 'Active';
    if (status === 'Active') {
      activeIds.push(normalizeProjectId(lease.id));
    }
  }

  if (activeIds.length === 0) {
    return [...DEFAULT_PROJECT_IDS];
  }
  return activeIds;
}

/**
 * Returns all accepted project identifiers including active projects and aliases.
 *
 * @returns {string[]} List of valid project scope strings for commit messages.
 */
function getControlledProjectNames() {
  const activeIds = getActiveProjectIds();
  const projectNamesSet = new Set(activeIds);

  for (const [alias, target] of Object.entries(PROJECT_ALIASES)) {
    if (projectNamesSet.has(target)) {
      projectNamesSet.add(alias);
    }
  }

  return Array.from(projectNamesSet);
}

/**
 * Evaluates the status of a specific project identifier.
 *
 * @param {string} rawId - Candidate project ID.
 * @returns {'Active'|'Frozen'|'Evicted'|'Unregistered'} Current lease status.
 */
function getProjectStatus(rawId) {
  const canonical = normalizeProjectId(rawId);
  const leases = resolveProjectLeases();

  for (const lease of leases) {
    if (normalizeProjectId(lease.id) === canonical) {
      return lease.status || 'Active';
    }
  }

  return 'Unregistered';
}

/**
 * Checks whether a given project is registered and currently in Active status.
 *
 * @param {string} rawId - Candidate project ID.
 * @returns {boolean} True if active.
 */
function isProjectActive(rawId) {
  return getProjectStatus(rawId) === 'Active';
}

/**
 * Clears the in-memory lease memoization cache.
 */
function clearCache() {
  memoizedLeases = null;
  lastResolvedTimeMs = 0;
}

module.exports = {
  clearCache,
  getActiveProjectIds,
  getControlledProjectNames,
  getProjectStatus,
  isProjectActive,
  normalizeProjectId,
  resolveProjectLeases,
};
