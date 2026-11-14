/**
 * Module: Workspace Tooling — Codebase ELOC & Bucket Scanner
 * File Path: scripts/common/lib/eloc-codebase-scanner.js
 * Architecture Role: Walks auditable source files across all workspace projects and computes
 *   physical LOC, ELOC, comment ratios, and token density per subsystem.
 * Dependencies & Triggers: Consumes ../evaluate-eloc-budget metrics classifier; required by
 *   ./eloc-diff-trajectory and ./workspace-eloc-rollup.
 * Responsibilities:
 *   1. Provide fail-soft JSON / NDJSON readers and shared rounding helpers;
 *   2. Classify source paths into canonical project buckets;
 *   3. Aggregate per-project and repository-wide live ELOC and weighted TSPR.
 * Exit Semantics & Design Rationale: Read-only filesystem scanner with shallow nesting and
 *   symbolic-link exclusion (`GUARD-SYMLINK-001`).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { evaluateCodeMetrics, isAuditableCodeFile } = require('../evaluate-eloc-budget');

const RUST_EXT = '.rs';
const DEFAULT_IGNORE_DIRS = new Set([
  '.git', '.agents', 'node_modules', 'dist', 'out', 'target', 'fixtures', 'baseline',
  'reports', 'archive', 'build', '.godot', '.refactor-trajectory', 'coverage',
  'tmp', 'temp', '.vitest', '.audit-logs',
]);

function roundTwo(val) {
  return Math.round(Number(val || 0) * 100) / 100;
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNdjsonRecords(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Skip corrupt lines without discarding intact ledger records.
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

function resolveProjectBucket(relPosixPath) {
  if (relPosixPath.startsWith('auto-refactor/')) return 'auto-refactor';
  if (relPosixPath.startsWith('workspace-timing/')) return 'workspace-timing';
  if (relPosixPath.startsWith('WebGames/')) return 'WebGames';
  if (relPosixPath.startsWith('fractal-git/')) return 'fractal-git';
  if (relPosixPath.startsWith('scripts/')) return 'scripts';
  return 'workspace';
}

function isSupportedElocFile(relPosixPath) {
  const normalized = relPosixPath.startsWith('/') ? relPosixPath : `/${relPosixPath}`;
  if (isAuditableCodeFile(normalized)) return true;
  if (path.extname(relPosixPath).toLowerCase() !== RUST_EXT) return false;
  return !/\/(?:dist|out|target|node_modules|fixtures|baseline|reports|archive|tmp|temp)\//.test(
    normalized,
  );
}

function walkWorkspaceCodeFiles(repoRoot, dirPath, outFiles) {
  if (!fs.existsSync(dirPath)) return;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
      walkWorkspaceCodeFiles(repoRoot, fullPath, outFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    if (isSupportedElocFile(rel)) outFiles.push({ fullPath, rel });
  }
}

function createBucketAccumulator() {
  return {
    files: 0,
    loc: 0,
    eloc: 0,
    blankLines: 0,
    commentLines: 0,
    tokens: 0,
    tsprWeightedSum: 0,
  };
}

function addMetricsToAccumulator(acc, metrics) {
  acc.files += 1;
  acc.loc += metrics.totalLoc;
  acc.eloc += metrics.eloc;
  acc.blankLines += metrics.blankLines;
  acc.commentLines += metrics.commentLines;
  acc.tokens += metrics.tokenCount;
  acc.tsprWeightedSum += Number(metrics.tspr || 0) * Math.max(1, metrics.eloc);
}

function finalizeBucket(acc) {
  const { eloc, loc } = acc;
  return {
    files: acc.files,
    loc,
    eloc,
    blankLines: acc.blankLines,
    commentLines: acc.commentLines,
    tokens: acc.tokens,
    effectiveDensity: loc > 0 ? roundTwo((eloc / loc) * 100) : 0,
    weightedTspr: eloc > 0 ? roundTwo(acc.tsprWeightedSum / eloc) : 0,
    tokensPerEloc: eloc > 0 ? roundTwo(acc.tokens / eloc) : 0,
  };
}

/**
 * Scan live codebase files across all workspace projects and compute physical/ELOC totals.
 *
 * @param {string} repoRoot - Repository root path.
 * @returns {object} Live codebase totals and per-project ELOC breakdown.
 */
function collectLiveCodebaseEloc(repoRoot) {
  const files = [];
  walkWorkspaceCodeFiles(repoRoot, repoRoot, files);
  const totalAcc = createBucketAccumulator();
  const buckets = new Map();

  for (const item of files) {
    let content;
    try {
      content = fs.readFileSync(item.fullPath, 'utf8');
    } catch {
      continue;
    }
    const ext = path.extname(item.rel).toLowerCase();
    const metrics = evaluateCodeMetrics(content, ext, item.rel);
    addMetricsToAccumulator(totalAcc, metrics);

    const bucketName = resolveProjectBucket(item.rel);
    if (!buckets.has(bucketName)) buckets.set(bucketName, createBucketAccumulator());
    addMetricsToAccumulator(buckets.get(bucketName), metrics);
  }

  const byProject = {};
  for (const [name, acc] of Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    byProject[name] = finalizeBucket(acc);
  }
  return {
    ...finalizeBucket(totalAcc),
    byProject,
  };
}

module.exports = {
  roundTwo,
  safeReadJson,
  readNdjsonRecords,
  isSupportedElocFile,
  collectLiveCodebaseEloc,
};
