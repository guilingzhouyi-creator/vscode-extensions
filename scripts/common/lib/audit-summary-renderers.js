/**
 * Module: Workspace Tooling — Audit Summary Dashboard, Markdown & Agent Envelope Renderers
 * File Path: scripts/common/lib/audit-summary-renderers.js
 * Architecture Role: Pure presentation and formatting module for unified workspace audit summaries,
 *   separating terminal box rendering, GitHub Step Summary Markdown generation, and AAS v1.0 JSON
 *   envelope serialization from telemetry ingestion and scoring orchestration.
 * Dependencies & Triggers: Consumes Node.js `fs` and `./workspace-eloc-rollup` (`renderEloc5dMarkdown`);
 *   invoked by `scripts/common/render-audit-all-summary.js`.
 * Responsibilities:
 *   1. Provide Unicode terminal display width, CJK alignment, progress bar, and grade-tag helpers;
 *   2. Render the 6-pillar + 10-dimension console box dashboard (`renderConsoleDashboard`);
 *   3. Format and append GitHub Actions Step Summary Markdown tables (`appendGithubStepSummary`);
 *   4. Build the canonical AAS v1.0 JSON envelope for `--agent` CLI consumers (`buildAgentEnvelope`).
 * Exit Semantics & Design Rationale: Pure presentation helpers with zero `process.exit` calls and
 *   zero circular dependency back to `render-audit-all-summary.js`; step-summary write failures
 *   outside CI runners degrade silently so rendering never masks gate verdicts.
 */
'use strict';

const fs = require('fs');
const { renderEloc5dMarkdown } = require('./workspace-eloc-rollup');

const TARGET_WIDTH = 71;

/**
 * Formats a numeric score into a bracketed letter grade tag.
 *
 * @param {number} score - Score on [0, 100].
 * @returns {string} Bracketed grade tag (e.g. '[A+]').
 */
function getGradeTag(score) {
  const thresholds = [
    [95.0, '[A+]'], [90.0, '[A ]'], [85.0, '[B+]'],
    [80.0, '[B ]'], [75.0, '[C+]'], [70.0, '[C ]'], [60.0, '[D ]'],
  ];
  for (const [minScore, tag] of thresholds) {
    if (score >= minScore) return tag;
  }
  return '[F ]';
}

/**
 * Determines whether a Unicode code point occupies two terminal columns.
 *
 * @param {number} code - Unicode code point.
 * @returns {boolean} True when double-width.
 */
function isWideCodePoint(code) {
  if (code >= 0x2500 && code <= 0x259f) return false;
  if (code === 0x2705 || code === 0x274c) return true;
  const wideRanges = [
    [0x2e80, 0x2fff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff],
    [0xff01, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f9ff], [0x20000, 0x2a6df],
  ];
  return wideRanges.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * Computes terminal display width of a string accounting for CJK and emoji glyphs.
 *
 * @param {string} str - Input string.
 * @returns {number} Display column width.
 */
function strWidth(str) {
  let width = 0;
  for (const ch of str) {
    width += isWideCodePoint(ch.codePointAt(0)) ? 2 : 1;
  }
  return width;
}

/**
 * Pads a cell string to a target display column width.
 *
 * @param {string} text - Cell text.
 * @param {number} width - Target column width.
 * @returns {string} Right-padded cell text.
 */
function alignCellLeft(text, width) {
  const pad = Math.max(0, width - strWidth(text));
  return text + ' '.repeat(pad);
}

/**
 * Wraps row text inside Unicode box borders at `TARGET_WIDTH`.
 *
 * @param {string} content - Row text content.
 * @returns {string} Boxed line.
 */
function formatDashboardRow(content) {
  const pad = Math.max(0, TARGET_WIDTH - strWidth(content));
  return '│' + content + ' '.repeat(pad) + '│';
}

/**
 * Builds a 20-block Unicode progress bar for a [0, 100] score.
 *
 * @param {number} score - Score value.
 * @param {number} blocks - Total bar width in blocks.
 * @returns {string} Rendered bar string.
 */
function makeBar(score, blocks = 20) {
  const filled = Math.max(0, Math.min(blocks, Math.round((score / 100) * blocks)));
  return '█'.repeat(filled) + '░'.repeat(blocks - filled);
}

/**
 * Prints the 10-dimensional quality rows inside the console dashboard.
 *
 * @param {object|null} tenDimensions - Ten-dimension score map.
 * @param {number|null} arCompositeScore - Raw auto-refactor composite score.
 * @param {ReadonlyArray<object>} dimDefinitions - 10-dimension descriptor list.
 * @returns {void}
 */
function renderTenDimensionsRows(tenDimensions, arCompositeScore, dimDefinitions) {
  if (!tenDimensions || arCompositeScore === null) {
    console.log(formatDashboardRow(' [离线基线快照未就绪 - 优雅降级模式]'));
    return;
  }
  const dims = Array.isArray(dimDefinitions) ? dimDefinitions : [];
  for (const d of dims) {
    const rawScore = tenDimensions[d.key];
    const parsedScore = Number(rawScore ?? 0);
    const valid = rawScore != null && !Number.isNaN(parsedScore) && parsedScore > 0;
    const bar = valid ? makeBar(parsedScore, 20) : ' '.repeat(20);
    const scoreStr = valid
      ? (Number.isInteger(parsedScore) ? parsedScore.toFixed(1) : String(Math.round(parsedScore * 100) / 100)).padStart(6)
      : '   N/A';
    const gradeTag = valid ? getGradeTag(parsedScore) : '';
    const row = d.num.padEnd(4) + alignCellLeft(d.name, 17) + bar + ' ' + scoreStr + ' ' + gradeTag + ' ' + d.desc;
    console.log(formatDashboardRow(row));
  }
}

/**
 * Renders the terminal Unicode box dashboard for interactive/CI logs.
 *
 * @param {object} summary - Computed workspace summary payload.
 * @param {string} elapsedSec - Formatted elapsed seconds string.
 * @param {ReadonlyArray<object>} dimDefinitions - 10-dimension descriptor list.
 * @returns {void}
 */
function renderConsoleDashboard(summary, elapsedSec, dimDefinitions) {
  const borderTop = '┌' + '─'.repeat(TARGET_WIDTH) + '┐';
  const borderMid = '├' + '─'.repeat(TARGET_WIDTH) + '┤';
  const borderBot = '└' + '─'.repeat(TARGET_WIDTH) + '┘';
  const sepTitle1 = '─ [全工作区六大核心子系统基石得分] ';
  const sep1 = '├' + sepTitle1 + '─'.repeat(TARGET_WIDTH - strWidth(sepTitle1)) + '┤';
  const sepTitle2 = '─ [auto-refactor 静态引擎十维工程质量全景指数] ';
  const sep2 = '├' + sepTitle2 + '─'.repeat(TARGET_WIDTH - strWidth(sepTitle2)) + '┤';

  const wsHealth = summary.workspaceHealthScore;
  const wsHealthStr = wsHealth % 1 === 0 ? wsHealth.toFixed(1) : String(wsHealth);

  console.log('');
  console.log(borderTop);
  const titleText = '全工作区统一工程审查与质量全景看板';
  const titlePad = Math.floor((TARGET_WIDTH - strWidth(titleText)) / 2);
  console.log(formatDashboardRow(' '.repeat(titlePad) + titleText));
  console.log(borderMid);

  let summaryText = `综合健康分: ${wsHealthStr} (${summary.grade})`;
  if (summary.autonomyRate != null) summaryText += ` | 自研率: ${Number(summary.autonomyRate).toFixed(2)}%`;
  if (summary.polyglotIndex != null) summaryText += ` | 语言均衡: ${Number(summary.polyglotIndex).toFixed(2)}`;
  console.log(formatDashboardRow(' ' + summaryText));
  console.log(sep1);

  const ps = summary.projectScores;
  const sysDefinitions = [
    { num: ' 1.', name: '工作区物理卫生', score: ps.hygiene, note: '(零空文件/同构)' },
    { num: ' 2.', name: '单源规则目录', score: ps.rulesCatalog, note: `(${summary.catalogRuleCount || 0}规则/SSOT)` },
    { num: ' 3.', name: 'auto-refactor', score: ps.autoRefactor, note: '(CLI静态引擎基线)' },
    { num: ' 4.', name: 'workspace-timing', score: ps.workspaceTiming, note: '(VSCode扩展门禁)' },
    { num: ' 5.', name: 'WebGames配置架构', score: ps.webGames, note: '(卡拉尔领域配置)' },
    { num: ' 6.', name: 'fractal-git', score: ps.fractalGit, note: '(10子系统/Rust)' },
  ];

  for (const sys of sysDefinitions) {
    const scoreStr = (Number.isInteger(sys.score) ? sys.score.toFixed(1) : String(Math.round(sys.score * 100) / 100)).padStart(6);
    const row = sys.num.padEnd(4) + alignCellLeft(sys.name, 17) + makeBar(sys.score, 20) + ' ' + scoreStr + ' ' + sys.note;
    console.log(formatDashboardRow(row));
  }

  console.log(sep2);
  renderTenDimensionsRows(summary.tenDimensions, summary.arCompositeScore, dimDefinitions);
  console.log(borderMid);

  const globalStatus = summary.status === 'BLOCK' ? '🔴 存在违规异常' : '🟢 全域质量达标';
  const debtPart = summary.totalDebt !== null ? `  |  技术债: ${summary.totalDebt}项` : '';
  console.log(formatDashboardRow(` 耗时: ${elapsedSec}s${debtPart}  |  全局状态: ${globalStatus}`));
  console.log(borderBot);
  console.log('💡 统一审查快照已落盘至: .audit-logs/audit-latest.json | audit-latest.aas.json | audit-latest.md');
  console.log('💡 质量历史轨迹已追加至: .audit-logs/audit-history.jsonl');
}

/**
 * Formats the 10-dimensional Markdown section for GITHUB_STEP_SUMMARY.
 *
 * @param {object|null} tenDimensions - Ten-dimension score map.
 * @param {number|null} arCompositeScore - Raw auto-refactor composite score.
 * @param {ReadonlyArray<object>} dimDefinitions - 10-dimension descriptor list.
 * @returns {string} Markdown table or fallback note.
 */
function formatStepSummaryTenDimensions(tenDimensions, arCompositeScore, dimDefinitions) {
  if (!tenDimensions || arCompositeScore === null) {
    return '> ⚠️ [离线基线快照未就绪 - 优雅降级模式]\n\n';
  }
  const dims = Array.isArray(dimDefinitions) ? dimDefinitions : [];
  let md = '| 序号 | 质量维度 | 得分 | 进度可视化 |\n| :---: | :--- | :---: | :--- |\n';
  for (const d of dims) {
    const rawVal = tenDimensions[d.key];
    const parsed = Number(rawVal ?? 0);
    const valid = rawVal != null && !Number.isNaN(parsed) && parsed > 0;
    const bar = valid ? makeBar(parsed, 20) : ' '.repeat(20);
    const scoreStr = valid ? (parsed % 1 === 0 ? parsed.toFixed(1) : String(Math.round(parsed * 100) / 100)) : 'N/A';
    md += `| ${d.num.trim().replace('.', '')} | ${d.labelEn} | ${scoreStr} | \`[${bar}]\` |\n`;
  }
  return md + '\n';
}

/**
 * Appends a Markdown quality table to GITHUB_STEP_SUMMARY when running in GitHub Actions.
 *
 * @param {string|undefined} summaryFile - Path from GITHUB_STEP_SUMMARY env var.
 * @param {object} summary - Computed workspace summary payload.
 * @param {string} elapsedSec - Formatted elapsed seconds string.
 * @param {ReadonlyArray<object>} dimDefinitions - 10-dimension descriptor list.
 * @returns {void}
 */
function appendGithubStepSummary(summaryFile, summary, elapsedSec, dimDefinitions) {
  if (!summaryFile) return;
  const passBadge = (s) => (s === 'PASS' ? '🟢 达标' : '🔴 阻断');
  const wsHealth = summary.workspaceHealthScore;
  const wsHealthStr = wsHealth % 1 === 0 ? wsHealth.toFixed(1) : String(wsHealth);
  const globalStatus = summary.status === 'BLOCK' ? '🔴 存在违规异常' : '🟢 全域质量达标';
  const ps = summary.projectScores;
  const pj = summary.projects;

  const headerParts = [`> **综合健康分**: **${wsHealthStr}** (Grade: **${summary.grade}**)`];
  if (summary.autonomyRate) headerParts.push(`**自研率**: **${summary.autonomyRate}%**`);
  if (summary.polyglotIndex !== null) headerParts.push(`**语言均衡**: **${summary.polyglotIndex}**`);
  if (summary.totalDebt !== null) headerParts.push(`**技术债总量**: **${summary.totalDebt} 项**`);

  let md = '## 🌐 全工作区跨项目统一审查与十维质量全景看板\n\n';
  md += headerParts.join(' &nbsp;|&nbsp; ') + '\n\n';
  md += '### 📊 全工作区六大核心子系统基石得分\n\n';
  md += '| 序号 | 核心子系统 | 判定结果 | 归一化得分 | 进度可视化 | 覆盖说明 |\n';
  md += '| :---: | :--- | :---: | :---: | :--- | :--- |\n';
  md += `| 1 | 工作区物理卫生 | ${passBadge(pj.hygiene)} | ${ps.hygiene.toFixed(1)} | \`[${makeBar(ps.hygiene, 20)}]\` | 全仓零空文件/同构契约 |\n`;
  md += `| 2 | 单源规则目录 | ${passBadge(pj.rulesCatalog)} | ${ps.rulesCatalog.toFixed(1)} | \`[${makeBar(ps.rulesCatalog, 20)}]\` | ${summary.catalogRuleCount || 0}规则/SSOT一致性 |\n`;
  md += `| 3 | auto-refactor | ${passBadge(pj.autoRefactor)} | ${ps.autoRefactor.toFixed(1)} | \`[${makeBar(ps.autoRefactor, 20)}]\` | CLI静态引擎质量基线 |\n`;
  md += `| 4 | workspace-timing | ${passBadge(pj.workspaceTiming)} | ${ps.workspaceTiming.toFixed(1)} | \`[${makeBar(ps.workspaceTiming, 20)}]\` | VSCode扩展审查门禁 |\n`;
  md += `| 5 | WebGames配置架构 | ${passBadge(pj.webGames)} | ${ps.webGames.toFixed(1)} | \`[${makeBar(ps.webGames, 20)}]\` | 卡拉尔领域配置审查 |\n`;
  md += `| 6 | fractal-git | ${passBadge(pj.fractalGit)} | ${ps.fractalGit.toFixed(1)} | \`[${makeBar(ps.fractalGit, 20)}]\` | 10子系统/Rust回归套件 |\n\n`;
  md += `> **耗时**: ${elapsedSec}s &nbsp;|&nbsp; **全局状态**: ${globalStatus}\n\n`;
  md += '### 🎯 auto-refactor 静态引擎十维工程质量全景指数\n\n';
  md += formatStepSummaryTenDimensions(summary.tenDimensions, summary.arCompositeScore, dimDefinitions);
  if (summary.rawTenDimensions) {
    md += '#### 🔍 auto-refactor 静态引擎未折算原始十维得分 (Raw Engine 10D)\n\n';
    md += formatStepSummaryTenDimensions(summary.rawTenDimensions, summary.arCompositeScore, dimDefinitions);
  }
  const elocMdLines = renderEloc5dMarkdown(summary.eloc5dSummary);
  if (elocMdLines.length > 0) {
    md += elocMdLines.join('\n') + '\n';
  }
  try {
    fs.appendFileSync(summaryFile, md, 'utf8');
  } catch (_) {
    // Ignore step summary write error outside CI runners.
  }
}

/**
 * Builds the AAS v1.0 envelope for `--agent` CLI consumers.
 *
 * @param {object} summary - Workspace audit summary.
 * @param {string} [runner='sh'] - Invoking runner platform ('sh' or 'ps1').
 * @returns {object} AAS v1.0 JSON envelope.
 */
function buildAgentEnvelope(summary, runner = 'sh') {
  const pj = summary.projects;
  const failedSubsystems = [];
  if (pj.hygiene !== 'PASS') failedSubsystems.push('hygiene');
  if (pj.rulesCatalog !== 'PASS') failedSubsystems.push('rules');
  if (pj.autoRefactor !== 'PASS') failedSubsystems.push('auto-refactor');
  if (pj.workspaceTiming !== 'PASS') failedSubsystems.push('workspace-timing');
  if (pj.webGames !== 'PASS') failedSubsystems.push('WebGames');
  if (pj.fractalGit !== 'PASS') failedSubsystems.push('fractal-git');
  const verifyCmd = runner === 'ps1'
    ? 'pwsh -File scripts/ps1/audit-all.ps1 -Fast'
    : 'bash scripts/sh/audit-all.sh --fast';

  return {
    schema: 'aas-v1',
    protocolVersion: '1.0.0',
    recordedAt: new Date().toISOString(),
    status: summary.status,
    gate: 'audit-all',
    exitCode: summary.exitCode,
    summary:
      summary.status === 'BLOCK'
        ? `Unified workspace review failed with violations in: ${failedSubsystems.join(', ')}.`
        : 'All workspace quality checks passed across 6 core subsystems.',
    compositeHealth: summary.workspaceHealthScore,
    grade: summary.grade,
    subsystems: {
      hygiene: pj.hygiene,
      rules: pj.rulesCatalog,
      autoRefactor: pj.autoRefactor,
      workspaceTiming: pj.workspaceTiming,
      webGames: pj.webGames,
      fractalGit: pj.fractalGit,
    },
    quant: summary.quant,
    agentDirectives: {
      targetFiles: [],
      remediationPriority: failedSubsystems,
      verificationCommand: verifyCmd,
      fastRecheckCommand: verifyCmd,
    },
  };
}

module.exports = Object.freeze({
  TARGET_WIDTH, getGradeTag, isWideCodePoint, strWidth, alignCellLeft,
  formatDashboardRow, makeBar, renderTenDimensionsRows, renderConsoleDashboard,
  formatStepSummaryTenDimensions, appendGithubStepSummary, buildAgentEnvelope,
});
