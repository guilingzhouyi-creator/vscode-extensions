/**
 * Module: Workspace Tooling — 5D ELOC Cumulative Report & Live Diff Aggregator
 * File Path: scripts/common/lib/workspace-eloc-rollup.js
 * Architecture Role: Aggregates trajectory cumulative ledgers with live codebase and Git diff
 *   5D ELOC telemetry into unified reports and Markdown tables.
 * Dependencies & Triggers: Orchestrates ./eloc-codebase-scanner and ./eloc-diff-trajectory;
 *   invoked by async-auto-audit-daemon, render-audit-all-summary, record-workspace-audit,
 *   and record-workspace-trajectory.
 * Responsibilities:
 *   1. Aggregate `lifetime.summary.json` and `active-runs.ndjson` cumulative ELOC & debt stats;
 *   2. Assemble the unified `eloc5dSummary` envelope (`buildEloc5dSummary`);
 *   3. Render Markdown tables shared across audit-latest.md and async-auto-audit-latest.md.
 * Exit Semantics & Design Rationale: Read-only aggregator exposing backwards-compatible API
 *   while keeping individual modules bounded well below the 5D ELOC per-file ceiling.
 */
'use strict';

const path = require('path');
const {
  safeReadJson,
  readNdjsonRecords,
  collectLiveCodebaseEloc,
} = require('./eloc-codebase-scanner');
const {
  parseUnifiedDiffStats,
  collectLiveDiff5DEloc,
} = require('./eloc-diff-trajectory');

function accumulateActiveRunLedger(records) {
  const sums = { proc: 0, uniq: 0, chg: 0, sem: 0, reloc: 0, cosm: 0, add: 0, res: 0, reg: 0 };
  for (const row of records) {
    const e = row?.eloc || {};
    sums.proc += Number(e.proc || 0);
    sums.uniq += Number(e.uniq || 0);
    sums.chg += Number(e.chg || 0);
    sums.sem += Number(e.sem || 0);
    sums.reloc += Number(e.reloc || 0);
    sums.cosm += Number(e.cosm || 0);
    const d = row?.debt || {};
    sums.add += Number(d.add || 0);
    sums.res += Number(d.res || 0);
    sums.reg += Number(d.reg || 0);
  }
  return sums;
}

/**
 * Aggregate historical cumulative 5D ELOC telemetry from lifetime and active-run ledgers.
 *
 * @param {string} repoRoot - Repository root path.
 * @returns {object} Historical trajectory and workspace active-run cumulative ELOC counters.
 */
function collectCumulativeLifetimeEloc(repoRoot) {
  const lifetimePath = path.join(
    repoRoot,
    'auto-refactor',
    '.refactor-trajectory',
    'lifetime.summary.json',
  );
  const activeRunsPath = path.join(repoRoot, '.audit-logs', 'trajectory', 'active-runs.ndjson');
  const lifetime = safeReadJson(lifetimePath) || {};
  const activeRuns = readNdjsonRecords(activeRunsPath);
  const wsSums = accumulateActiveRunLedger(activeRuns);
  const lifeEloc = lifetime.eloc || {};
  const lifeDebt = lifetime.debt || {};

  return {
    lifetimeRuns: Number(lifetime.totalRuns || 0),
    lifetimeEloc: {
      processedTotal: Number(lifeEloc.processedTotal || 0),
      uniqueTotal: Number(lifeEloc.uniqueTotal || 0),
      changedTotal: Number(lifeEloc.changedTotal || 0),
      semanticTotal: Number(lifeEloc.semanticTotal || 0),
    },
    lifetimeDebt: {
      totalAdded: Number(lifeDebt.totalAdded || 0),
      totalResolved: Number(lifeDebt.totalResolved || 0),
      totalRegressions: Number(lifeDebt.totalRegressions || 0),
      netYield: Number(lifeDebt.netYield || 0),
      densityYield: Number(lifeDebt.densityYield || 0),
    },
    meanQed: Number(lifetime.qed?.mean || 0),
    workspaceRuns: activeRuns.length,
    workspaceEloc: {
      processedTotal: wsSums.proc,
      uniqueTotal: wsSums.uniq,
      changedTotal: wsSums.chg,
      semanticTotal: wsSums.sem,
      relocatedTotal: wsSums.reloc,
      cosmeticTotal: wsSums.cosm,
    },
    workspaceDebt: {
      totalAdded: wsSums.add,
      totalResolved: wsSums.res,
      totalRegressions: wsSums.reg,
    },
  };
}

/**
 * Assemble complete workspace 5D ELOC report from live codebase, Git diff, and lifetime history.
 *
 * @param {string} repoRoot - Repository root path.
 * @returns {object} Unified `eloc5dSummary` structure.
 */
function buildEloc5dSummary(repoRoot) {
  const liveCodebase = collectLiveCodebaseEloc(repoRoot);
  const currentDiff = collectLiveDiff5DEloc(repoRoot, liveCodebase);
  const cumulativeTrajectory = collectCumulativeLifetimeEloc(repoRoot);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    available: liveCodebase.eloc > 0 || currentDiff.changedEloc > 0,
    currentDiff,
    liveCodebase,
    cumulativeTrajectory,
  };
}

function numOr(val, fallback = 0) {
  return val ?? fallback;
}

function buildElocAxisRows(diff, cb, wsEloc, lifeEloc, lifeDebt) {
  const procLive = numOr(diff.processedEloc, numOr(cb.eloc));
  const semRatio = numOr(diff.semanticRatio);
  const netClear = `${numOr(lifeDebt.totalResolved)} - ${numOr(lifeDebt.totalAdded)}`;
  return [
    `| **D1 · 处理量 (Processed ELOC)** | ${procLive} | ${numOr(wsEloc.processedTotal)} | ${numOr(lifeEloc.processedTotal)} |`,
    `| **D2 · 净存量 (Unique ELOC)** | ${numOr(cb.eloc)} (${numOr(cb.files)} 文件) | ${numOr(wsEloc.uniqueTotal)} | ${numOr(lifeEloc.uniqueTotal)} |`,
    `| **D3 · 变更周转 (Changed ELOC)** | ${numOr(diff.changedEloc)} (+${numOr(diff.addedEloc)} / -${numOr(diff.removedEloc)}) | ${numOr(wsEloc.changedTotal)} | ${numOr(lifeEloc.changedTotal)} |`,
    `| **D4 · 纯净语义 (Semantic ELOC)** | ${numOr(diff.semanticEloc)} (${semRatio}%) | ${numOr(wsEloc.semanticTotal)} | ${numOr(lifeEloc.semanticTotal)} |`,
    `| **D5 · 重排与修饰 (Reloc / Cosm)** | reloc ${numOr(diff.relocatedEloc)} · cosm ${numOr(diff.cosmeticEloc)} | reloc ${numOr(wsEloc.relocatedTotal)} · cosm ${numOr(wsEloc.cosmeticTotal)} | 净清偿 ${netClear} |`,
  ];
}

function appendProjectElocRows(lines, byProject) {
  if (!byProject) return;
  for (const [name, stats] of Object.entries(byProject)) {
    lines.push(
      `| \`${name}\` | ${stats.files} | ${stats.loc} | ${stats.eloc} | ${stats.effectiveDensity}% | ${stats.weightedTspr} |`,
    );
  }
}

/**
 * Render clean GitHub Markdown sections for the 5D ELOC cumulative report.
 *
 * @param {object|null} summary - Output produced by `buildEloc5dSummary`.
 * @returns {string[]} Markdown lines for inclusion in audit reports.
 */
function renderEloc5dMarkdown(summary) {
  if (!summary || !summary.liveCodebase) return [];
  const diff = summary.currentDiff || {};
  const cb = summary.liveCodebase || {};
  const cum = summary.cumulativeTrajectory || {};
  const lifeEloc = cum.lifetimeEloc || {};
  const lifeDebt = cum.lifetimeDebt || {};
  const wsEloc = cum.workspaceEloc || {};
  const netDelta = diff.netElocDelta >= 0 ? `+${diff.netElocDelta}` : diff.netElocDelta;
  const lines = [
    '',
    '### 📐 Auto-Refactor 五维有效逻辑行 (5D ELOC) 累计报告',
    '',
    '| 维度 (5D Axis) | 当前快照 / 差分 (Live Snapshot & Diff) | 全区轨迹累计 (Workspace Runs) | Auto-Refactor 终身累计 (Lifetime) |',
    '| :--- | :---: | :---: | :---: |',
    ...buildElocAxisRows(diff, cb, wsEloc, lifeEloc, lifeDebt),
    '',
    `- **实时代码密度**: ${numOr(cb.loc)} LOC → **${numOr(cb.eloc)} ELOC** (有效率 **${numOr(cb.effectiveDensity)}%**, 平均 TSPR **${numOr(cb.weightedTspr)}**, Tokens/ELOC **${numOr(cb.tokensPerEloc)}**) · **净变动 ELOC**: ${netDelta} (${numOr(diff.modifiedFilesCount)} 变更文件)`,
    `- **历史轨迹统计**: Lifetime **${numOr(cum.lifetimeRuns)}** 次审计 (均 QED ${numOr(cum.meanQed)}, 密度收益 ${numOr(lifeDebt.densityYield)}) · Workspace Active **${numOr(cum.workspaceRuns)}** 次记录`,
    '',
    '| 子系统 / 目录 | 源码文件 | 物理行数 (LOC) | 有效逻辑行 (ELOC) | 有效代码率 | 平均 TSPR |',
    '| :--- | :---: | :---: | :---: | :---: | :---: |',
  ];

  appendProjectElocRows(lines, cb.byProject);
  lines.push('');
  return lines;
}

module.exports = {
  buildEloc5dSummary,
  collectLiveCodebaseEloc,
  collectLiveDiff5DEloc,
  collectCumulativeLifetimeEloc,
  renderEloc5dMarkdown,
  parseUnifiedDiffStats,
};
