/**
 * Module: Workspace Tooling — Live Git Diff 5D ELOC Telemetry Parser
 * File Path: scripts/common/lib/eloc-diff-trajectory.js
 * Architecture Role: Evaluates live working-tree, staged, and untracked Git deltas across
 *   all 5 ELOC dimensions (Processed, Unique, Changed, Semantic, Relocated/Cosmetic).
 * Dependencies & Triggers: Consumes ../git-env, ../evaluate-eloc-budget, and
 *   ./eloc-codebase-scanner; imported by ./workspace-eloc-rollup.
 * Responsibilities:
 *   1. Execute safe read-only Git unified=0 diff and porcelain queries;
 *   2. Parse added, removed, semantic, relocated, and cosmetic ELOC per hunk;
 *   3. Combine codebase totals with live differential counters for 5D reporting.
 * Exit Semantics & Design Rationale: Read-only git inspection bounded by MAX_DIFF_BUFFER_BYTES;
 *   never mutates index or working tree.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getSafeGitEnv } = require('../git-env');
const {
  evaluateCodeMetrics,
  isPlumbingLine,
  stripInlineComment,
} = require('../evaluate-eloc-budget');
const {
  roundTwo,
  isSupportedElocFile,
  collectLiveCodebaseEloc,
} = require('./eloc-codebase-scanner');

const MAX_DIFF_BUFFER_BYTES = 32 * 1024 * 1024;
const UNTRACKED_SIZE_LIMIT_BYTES = 1024 * 1024;

function runGitReadOnly(repoRoot, args) {
  try {
    const res = spawnSync('git', args, {
      cwd: repoRoot,
      env: getSafeGitEnv(repoRoot),
      encoding: 'utf8',
      maxBuffer: MAX_DIFF_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return res.status === 0 ? String(res.stdout || '') : '';
  } catch {
    return '';
  }
}

function hasGitHead(repoRoot) {
  const out = runGitReadOnly(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  return Boolean(out.trim());
}

function classifySingleDiffLine(text, ext) {
  const metrics = evaluateCodeMetrics(text, ext, '');
  if (metrics.eloc === 0) {
    return { isCode: false, isSemantic: false, key: '' };
  }
  const cleaned = stripInlineComment(text, ext).trim();
  const isPlumb = cleaned.length === 0 || isPlumbingLine(cleaned, ext);
  return { isCode: true, isSemantic: !isPlumb, key: cleaned };
}

function bumpKeyCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function countRelocatedOverlap(addedKeys, removedKeys) {
  let relocated = 0;
  for (const [key, addCnt] of addedKeys.entries()) {
    const remCnt = removedKeys.get(key) || 0;
    if (remCnt > 0) relocated += Math.min(addCnt, remCnt);
  }
  return relocated;
}

function handleDiffHeader(rawLine, state) {
  const bMatch = /\sb\/(.+)$/.exec(rawLine);
  const rel = bMatch ? bMatch[1].trim() : '';
  state.activeExt = path.extname(rel).toLowerCase();
  state.activeTrackable = isSupportedElocFile(rel);
  if (state.activeTrackable) state.touchedFiles.add(rel);
}

function recordDiffLineDelta(prefix, bodyText, state) {
  const classified = classifySingleDiffLine(bodyText, state.activeExt);
  if (!classified.isCode) {
    state.cosmeticEloc += 1;
    return;
  }
  if (prefix === '+') {
    state.addedEloc += 1;
    if (classified.isSemantic) state.semanticAdded += 1;
    bumpKeyCount(state.addedKeys, classified.key);
    return;
  }
  state.removedEloc += 1;
  if (classified.isSemantic) state.semanticRemoved += 1;
  bumpKeyCount(state.removedKeys, classified.key);
}

/**
 * Parse unified diff text into per-dimension ELOC turnover counters.
 *
 * @param {string} diffText - Unified diff string (`--unified=0`).
 * @returns {object} Parsed modified file count and added/removed/semantic/relocated/cosmetic ELOC.
 */
function parseUnifiedDiffStats(diffText) {
  const lines = String(diffText || '').split(/\r?\n/);
  const state = {
    activeExt: '.js',
    activeTrackable: false,
    addedEloc: 0,
    removedEloc: 0,
    semanticAdded: 0,
    semanticRemoved: 0,
    cosmeticEloc: 0,
    touchedFiles: new Set(),
    addedKeys: new Map(),
    removedKeys: new Map(),
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git ')) {
      handleDiffHeader(rawLine, state);
      continue;
    }
    if (!state.activeTrackable || rawLine.startsWith('@@')) continue;
    if (rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
    const prefix = rawLine[0];
    if (prefix === '+' || prefix === '-') {
      recordDiffLineDelta(prefix, rawLine.slice(1), state);
    }
  }

  return {
    modifiedFilesCount: state.touchedFiles.size,
    addedEloc: state.addedEloc,
    removedEloc: state.removedEloc,
    semanticEloc: state.semanticAdded + state.semanticRemoved,
    relocatedEloc: countRelocatedOverlap(state.addedKeys, state.removedKeys),
    cosmeticEloc: state.cosmeticEloc,
  };
}

function collectUntrackedEloc(repoRoot, diffStats) {
  const rawPorcelain = runGitReadOnly(repoRoot, ['status', '--porcelain', '-z']);
  if (!rawPorcelain) return;
  const tokens = rawPorcelain.split('\0').filter(Boolean);
  let untrackedCount = 0;
  for (const token of tokens) {
    if (!token.startsWith('?? ')) continue;
    const rel = token.slice(3).replace(/\\/g, '/');
    if (!isSupportedElocFile(rel)) continue;
    const fullPath = path.join(repoRoot, rel);
    try {
      const stat = fs.lstatSync(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > UNTRACKED_SIZE_LIMIT_BYTES) {
        continue;
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      const m = evaluateCodeMetrics(content, path.extname(rel).toLowerCase(), rel);
      diffStats.addedEloc += m.eloc;
      diffStats.semanticEloc += m.eloc;
      diffStats.cosmeticEloc += m.commentLines;
      untrackedCount += 1;
    } catch {
      // Ignore transient untracked files vanishing concurrently.
    }
  }
  diffStats.modifiedFilesCount += untrackedCount;
}

/**
 * Compute live working-tree + staged + untracked 5D ELOC counters.
 *
 * @param {string} repoRoot - Repository root path.
 * @param {object} [precomputedCodebase] - Optional precomputed codebase ELOC object.
 * @returns {object} Real-time 5D ELOC differential metrics.
 */
function collectLiveDiff5DEloc(repoRoot, precomputedCodebase = null) {
  const codebase = precomputedCodebase || collectLiveCodebaseEloc(repoRoot);
  const diffArgs = hasGitHead(repoRoot)
    ? ['diff', 'HEAD', '--unified=0', '--no-color']
    : ['diff', '--cached', '--unified=0', '--no-color'];
  const diffText = runGitReadOnly(repoRoot, diffArgs);
  const diffStats = parseUnifiedDiffStats(diffText);
  collectUntrackedEloc(repoRoot, diffStats);

  const changedEloc = diffStats.addedEloc + diffStats.removedEloc;
  const uniqueEloc = codebase.eloc;
  const processedEloc = uniqueEloc + changedEloc;
  const semanticRatio =
    changedEloc > 0 ? roundTwo((diffStats.semanticEloc / changedEloc) * 100) : 0;

  return {
    processedEloc,
    uniqueEloc,
    changedEloc,
    semanticEloc: diffStats.semanticEloc,
    relocatedEloc: diffStats.relocatedEloc,
    cosmeticEloc: diffStats.cosmeticEloc,
    addedEloc: diffStats.addedEloc,
    removedEloc: diffStats.removedEloc,
    netElocDelta: diffStats.addedEloc - diffStats.removedEloc,
    semanticRatio,
    modifiedFilesCount: diffStats.modifiedFilesCount,
    available: uniqueEloc > 0 || changedEloc > 0,
  };
}

module.exports = {
  parseUnifiedDiffStats,
  collectLiveDiff5DEloc,
};
