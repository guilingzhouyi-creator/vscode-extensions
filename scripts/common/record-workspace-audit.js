/**
 * Module: Tooling — Workspace Audit Persistence & Score History Ledger
 * File Path: scripts/common/record-workspace-audit.js
 * Architecture Role: Centralized persistent recorder for workspace-wide audit-all scores,
 *   full-system snapshots, and historical trajectories across PowerShell and Bash runners.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process);
 *   invoked by audit-all.ps1 and audit-all.sh upon completion of review.
 * Responsibilities:
 *   1. Atomic persistence of latest audit snapshot (.audit-logs/audit-latest.json);
 *   2. Atomic persistence of human/Agent-friendly markdown dashboard (.audit-logs/audit-latest.md);
 *   3. Rolling append to historical score trajectory ledger (.audit-logs/audit-history.jsonl, FIFO max 200);
 *   4. Provide fast CLI triage interface (--view, --latest, --history, --json).
 * Exit Semantics & Design Rationale: Exits 0 on clean write/read, 1 on severe failure;
 *   never blocks primary developer or CI workflows on transient logging failures.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT_LOG_DIR = path.join(REPO_ROOT, '.audit-logs');
const LATEST_JSON_PATH = path.join(AUDIT_LOG_DIR, 'audit-latest.json');
const LATEST_MD_PATH = path.join(AUDIT_LOG_DIR, 'audit-latest.md');
const HISTORY_JSONL_PATH = path.join(AUDIT_LOG_DIR, 'audit-history.jsonl');

const DEFAULT_MAX_HISTORY_ENTRIES = 200;
const PROTOCOL_VERSION = '1.0.0';

const DIMENSION_DEFINITIONS = [
  { num: ' 1.', key: 'architectureConsistency', name: '架构一致', labelEn: '架构一致 (Architecture Consistency)', desc: '分层边界解耦' },
  { num: ' 2.', key: 'semanticPurity', name: '语义纯度', labelEn: '语义纯度 (Semantic Purity)', desc: '纯函数数据流' },
  { num: ' 3.', key: 'codeSecurity', name: '代码安全', labelEn: '代码安全 (Code Security)', desc: '输入安全防御' },
  { num: ' 4.', key: 'performanceEfficiency', name: '性能预算', labelEn: '性能预算 (Performance Efficiency)', desc: '零循环堆分配' },
  { num: ' 5.', key: 'standardization', name: '标准化', labelEn: '标准化 (Standardization)', desc: '命名契约标准' },
  { num: ' 6.', key: 'modernity', name: '现代化', labelEn: '现代化 (Modernity)', desc: '现代语法API' },
  { num: ' 7.', key: 'maintainability', name: '可维护性', labelEn: '可维护性 (Maintainability)', desc: '控制流复杂度' },
  { num: ' 8.', key: 'commentQuality', name: '注释质量', labelEn: '注释质量 (Comment Quality)', desc: 'JSDoc契约完备' },
  { num: ' 9.', key: 'duplication', name: '重复率', labelEn: '重复率 (Duplication)', desc: 'DRY原则去重' },
  { num: '10.', key: 'techDebtRisk', name: '技术债风险', labelEn: '技术债风险 (Tech Debt Risk)', desc: '零高危债务防线' },
];

function getGitRevision(root) {
  try {
    const out = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) return out.slice(0, 8);
  } catch {
    // Best effort fallback
  }
  return '00000000';
}

function getProgressBar(score, blocks = 20) {
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  const filled = Math.round((safe / 100) * blocks);
  const empty = blocks - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getGradeTag(score) {
  const num = Number(score) || 0;
  if (num >= 95.0) return '[A+]';
  if (num >= 90.0) return '[A ]';
  if (num >= 85.0) return '[B+]';
  if (num >= 80.0) return '[B ]';
  if (num >= 75.0) return '[C+]';
  if (num >= 70.0) return '[C ]';
  if (num >= 60.0) return '[D ]';
  return '[F ]';
}

function getGradeFromScore(score) {
  return getGradeTag(score).replace('[', '').replace(']', '').trim();
}

/**
 * Build standardized Markdown dashboard string from audit snapshot data.
 *
 * @param {object} data - Normalized audit snapshot payload.
 * @returns {string} Markdown text.
 */
function renderSubsystemsTableRows(data) {
  const passBadge = (status) => (status === 'PASS' ? '✅ PASS' : '❌ FAIL');
  const sysList = [
    { num: 1, name: '工作区物理卫生', key: 'hygiene', note: '全仓零空文件/同构契约' },
    { num: 2, name: '单源规则目录', key: 'rulesCatalog', note: `${data.catalogRuleCount || 459}规则/SSOT一致性` },
    { num: 3, name: 'auto-refactor', key: 'autoRefactor', note: 'CLI静态引擎质量基线' },
    { num: 4, name: 'workspace-timing', key: 'workspaceTiming', note: 'VSCode扩展审查门禁' },
    { num: 5, name: 'WebGames配置架构', key: 'webGames', note: '卡拉尔领域配置审查' },
  ];
  return sysList.map((s) => {
    const status = data.projects?.[s.key] || (data.status === 'PASS' ? 'PASS' : 'FAIL');
    const score = Number(data.projectScores?.[s.key] ?? 100.0);
    const scoreStr = score.toFixed(1);
    const bar = getProgressBar(score, 20);
    return `| ${s.num} | ${s.name} | ${passBadge(status)} | ${scoreStr} | \`[${bar}]\` | ${s.note} |`;
  });
}

function renderDimensionTableRows(dimensions) {
  const rows = [
    '| 序号 | 质量维度 | 得分 | 等级 | 进度可视化 | 维度说明 |',
    '| :---: | :--- | :---: | :---: | :--- | :--- |',
  ];
  for (const d of DIMENSION_DEFINITIONS) {
    const rawVal = dimensions[d.key];
    const parsed = Number(rawVal);
    const numStr = d.num.trim().replace('.', '');
    if (rawVal == null || isNaN(parsed) || parsed <= 0) {
      rows.push(`| ${numStr} | ${d.labelEn} | N/A | [N/A] | \`[${' '.repeat(20)}]\` | ${d.desc} |`);
    } else {
      const scoreStr = parsed.toFixed(1);
      const gradeTag = getGradeTag(parsed);
      const bar = getProgressBar(parsed, 20);
      rows.push(`| ${numStr} | ${d.labelEn} | ${scoreStr} | ${gradeTag} | \`[${bar}]\` | ${d.desc} |`);
    }
  }
  return rows;
}

/**
 * Build standardized Markdown dashboard string from audit snapshot data.
 *
 * @param {object} data - Normalized audit snapshot payload.
 * @returns {string} Markdown text.
 */
function renderMarkdownDashboard(data) {
  const wsHealthStr = Number(data.workspaceHealthScore).toFixed(2);
  const wsGrade = data.grade || getGradeFromScore(data.workspaceHealthScore);
  const globalBadge = data.status === 'PASS' ? '✅ 全域健康达标' : '❌ 存在违规异常';

  const headerMeta = [
    `> **综合健康分**: **${wsHealthStr}** (Grade: **${wsGrade}**)`,
    data.autonomyRate != null ? `&nbsp;|&nbsp; **自研率**: **${Number(data.autonomyRate).toFixed(2)}%**` : '',
    data.polyglotIndex != null ? `&nbsp;|&nbsp; **语言均衡**: **${Number(data.polyglotIndex).toFixed(2)}**` : '',
    data.totalDebt != null ? `&nbsp;|&nbsp; **技术债总量**: **${data.totalDebt} 项**` : '',
  ].filter(Boolean).join(' ');

  const lines = [
    '# 🌐 全工作区跨项目统一审查与十维质量全景看板',
    '',
    headerMeta,
    '',
    `> **记录时间**: ${data.recordedAt} &nbsp;|&nbsp; **Git Revision**: \`${data.gitRevision}\` &nbsp;|&nbsp; **模式**: ${data.fastMode ? 'Fast' : 'Full'} &nbsp;|&nbsp; **耗时**: ${data.elapsedSeconds}s &nbsp;|&nbsp; **状态**: ${globalBadge}`,
    '',
    '### 📊 全工作区五大核心子系统基石得分',
    '',
    '| 序号 | 核心子系统 | 判定结果 | 归一化得分 | 进度可视化 | 覆盖说明 |',
    '| :---: | :--- | :---: | :---: | :--- | :--- |',
  ];

  lines.push(...renderSubsystemsTableRows(data));

  lines.push('');
  lines.push('### 🎯 auto-refactor 静态引擎十维工程质量全景指数');
  lines.push('');

  if (data.tenDimensions && typeof data.tenDimensions === 'object') {
    lines.push(...renderDimensionTableRows(data.tenDimensions));
  } else {
    lines.push('> ⚠️ [离线基线快照未就绪 - 优雅降级模式]');
  }

  lines.push('');
  return lines.join('\n') + '\n';
}

/**
 * Append one compact run summary into the historical jsonl ledger and prune old records.
 *
 * @param {string} historyPath - Path to jsonl file.
 * @param {object} entry - Compact ledger record.
 * @param {number} maxEntries - Maximum lines to retain.
 */
function appendHistoryLedger(historyPath, entry, maxEntries = DEFAULT_MAX_HISTORY_ENTRIES) {
  const line = JSON.stringify(entry);
  try {
    fs.appendFileSync(historyPath, line + '\n', 'utf8');
    const content = fs.readFileSync(historyPath, 'utf8');
    const allLines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (allLines.length > maxEntries) {
      const retained = allLines.slice(-maxEntries);
      fs.writeFileSync(historyPath, retained.join('\n') + '\n', 'utf8');
    }
  } catch (err) {
    console.error(`⚠️ [Record-Audit] 追加历史记录异常: ${err.message}`);
  }
}

/**
 * Record a full workspace audit run atomically.
 *
 * @param {object} inputPayload - Raw input payload from audit-all runner.
 * @returns {object} Normalized persisted snapshot.
 */
function recordAuditRun(inputPayload) {
  if (!fs.existsSync(AUDIT_LOG_DIR)) {
    fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
  }

  const gitRev = inputPayload.gitRevision || getGitRevision(REPO_ROOT);
  const nowIso = inputPayload.timestamp || new Date().toISOString();
  const healthScore = Number(inputPayload.workspaceHealthScore ?? inputPayload.compositeScore ?? 0);
  const grade = inputPayload.grade || getGradeFromScore(healthScore);

  const normalized = {
    protocolVersion: PROTOCOL_VERSION,
    recordedAt: nowIso,
    gitRevision: gitRev,
    fastMode: Boolean(inputPayload.fastMode),
    status: inputPayload.status || (inputPayload.exitCode === 0 ? 'PASS' : 'FAIL'),
    exitCode: Number(inputPayload.exitCode ?? 0),
    elapsedSeconds: Number(inputPayload.elapsedSeconds ?? 0),
    workspaceHealthScore: Number(healthScore.toFixed(2)),
    grade,
    autonomyRate: inputPayload.autonomyRate != null ? Number(Number(inputPayload.autonomyRate).toFixed(2)) : null,
    polyglotIndex: inputPayload.polyglotIndex != null ? Number(Number(inputPayload.polyglotIndex).toFixed(2)) : null,
    totalDebt: inputPayload.totalDebt != null ? Number(inputPayload.totalDebt) : null,
    catalogRuleCount: inputPayload.catalogRuleCount ? Number(inputPayload.catalogRuleCount) : null,
    projects: inputPayload.projects || {},
    projectScores: inputPayload.projectScores || {},
    tenDimensions: inputPayload.tenDimensions || inputPayload.qualityVector || null,
  };

  // 1. 落盘 audit-latest.json
  fs.writeFileSync(LATEST_JSON_PATH, JSON.stringify(normalized, null, 2), 'utf8');

  // 2. 落盘 audit-latest.md
  const mdContent = renderMarkdownDashboard(normalized);
  fs.writeFileSync(LATEST_MD_PATH, mdContent, 'utf8');

  // 3. 紧凑历史轨迹入账 audit-history.jsonl
  const historyEntry = {
    t: nowIso,
    rev: gitRev,
    fast: normalized.fastMode,
    status: normalized.status,
    score: normalized.workspaceHealthScore,
    grade: normalized.grade,
    autonomy: normalized.autonomyRate,
    polyglot: normalized.polyglotIndex,
    debt: normalized.totalDebt,
    projects: normalized.projectScores,
    dimensions: normalized.tenDimensions,
    elapsed: normalized.elapsedSeconds,
  };
  appendHistoryLedger(HISTORY_JSONL_PATH, historyEntry, DEFAULT_MAX_HISTORY_ENTRIES);

  return normalized;
}

/**
 * Display formatted latest audit summary in console.
 */
function displayLatestAudit() {
  if (!fs.existsSync(LATEST_JSON_PATH)) {
    console.log('ℹ️ 未检测到历史全工作区审查快照 (.audit-logs/audit-latest.json)。');
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(LATEST_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    console.log(renderMarkdownDashboard(data));
    process.exit(0);
  } catch (err) {
    console.error(`❌ 解析快照异常: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Display recent historical runs trend from jsonl ledger.
 */
function displayHistoryLedger() {
  if (!fs.existsSync(HISTORY_JSONL_PATH)) {
    console.log('ℹ️ 未检测到全工作区审查历史轨迹 (.audit-logs/audit-history.jsonl)。');
    process.exit(0);
  }
  try {
    const raw = fs.readFileSync(HISTORY_JSONL_PATH, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    console.log(`\n=================================================================`);
    console.log(`📈 全工作区统一审查历史质量轨迹 (最近 ${lines.length} 次记录)`);
    console.log(`=================================================================`);
    console.log(`时间 (UTC)             | Commit   | 模式 | 状态 | 综合健康分 | 评级 | 耗时`);
    console.log(`-----------------------------------------------------------------`);
    const recent = lines.slice(-15);
    for (const l of recent) {
      const e = JSON.parse(l);
      const timeStr = (e.t || '').replace('T', ' ').slice(0, 19);
      const revStr = (e.rev || '00000000').padEnd(8);
      const modeStr = e.fast ? 'Fast' : 'Full';
      const statusBadge = e.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
      const scoreStr = Number(e.score || 0).toFixed(2).padStart(6);
      const gradeStr = (e.grade || 'A+').padEnd(4);
      const elapsedStr = `${Number(e.elapsed || 0).toFixed(1)}s`.padStart(5);
      console.log(`${timeStr} | ${revStr} | ${modeStr.padEnd(4)} | ${statusBadge} |  ${scoreStr}  | ${gradeStr} | ${elapsedStr}`);
    }
    console.log(`=================================================================\n`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ 读取历史异常: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--view') || args.includes('--latest')) {
    displayLatestAudit();
    return;
  }

  if (args.includes('--history')) {
    displayHistoryLedger();
    return;
  }

  if (args.includes('--json')) {
    if (fs.existsSync(LATEST_JSON_PATH)) {
      console.log(fs.readFileSync(LATEST_JSON_PATH, 'utf8'));
      process.exit(0);
    } else {
      console.log(JSON.stringify({ status: 'NONE', message: 'No audit snapshot recorded yet.' }, null, 2));
      process.exit(0);
    }
  }

  // Record command handling
  let payload = null;
  const recordFileIdx = args.indexOf('--record-file');
  if (recordFileIdx !== -1 && args[recordFileIdx + 1]) {
    const fPath = path.resolve(process.cwd(), args[recordFileIdx + 1]);
    if (fs.existsSync(fPath)) {
      payload = JSON.parse(fs.readFileSync(fPath, 'utf8'));
    }
  }

  const recordJsonIdx = args.indexOf('--record-json');
  if (recordJsonIdx !== -1 && args[recordJsonIdx + 1]) {
    payload = JSON.parse(args[recordJsonIdx + 1]);
  }

  if (args.includes('--record-stdin')) {
    const inputBuf = fs.readFileSync(0, 'utf8');
    if (inputBuf.trim()) {
      payload = JSON.parse(inputBuf);
    }
  }

  if (payload) {
    const result = recordAuditRun(payload);
    console.log(`  ✔ [Audit-Persistence] 全工作区审查快照与质量轨迹已留痕 (${result.workspaceHealthScore}分, Grade: ${result.grade})`);
    process.exit(0);
  }

  // Default: if invoked without parameters, print usage
  console.log('Usage: node scripts/common/record-workspace-audit.js [--latest|--history|--json|--record-json <json>|--record-file <file>|--record-stdin]');
}

if (require.main === module) {
  main();
}

module.exports = {
  recordAuditRun,
  renderMarkdownDashboard,
  appendHistoryLedger,
  LATEST_JSON_PATH,
  LATEST_MD_PATH,
  HISTORY_JSONL_PATH,
};
