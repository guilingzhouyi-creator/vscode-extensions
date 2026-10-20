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
 *   3. Rolling append to historical score trajectory ledger
 *      (.audit-logs/audit-history.jsonl, FIFO max 200);
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
const DEFAULT_GIT_REV = '00000000';
const PROGRESS_BAR_BLOCKS = 20;
const SCORE_MAX = 100;
const COMMIT_REV_LEN = 8;
const RECENT_HISTORY_LIMIT = 15;

const STATUS_PASS = 'PASS';
const STATUS_FAIL = 'FAIL';
const BADGE_PASS = '✅ PASS';
const BADGE_FAIL = '❌ FAIL';
const BADGE_GLOBAL_HEALTHY = '✅ 全域健康达标';
const BADGE_GLOBAL_ANOMALY = '❌ 存在违规异常';

const CHAR_FILLED = '█';
const CHAR_EMPTY = '░';

const GRADE_A_PLUS = 95.0;
const GRADE_A = 90.0;
const GRADE_B_PLUS = 85.0;
const GRADE_B = 80.0;
const GRADE_C_PLUS = 75.0;
const GRADE_C = 70.0;
const GRADE_D = 60.0;

const TAG_A_PLUS = '[A+]';
const TAG_A = '[A ]';
const TAG_B_PLUS = '[B+]';
const TAG_B = '[B ]';
const TAG_C_PLUS = '[C+]';
const TAG_C = '[C ]';
const TAG_D = '[D ]';
const TAG_F = '[F ]';

const STATUS_EXCELLENT = '✔ 优秀';
const STATUS_GOOD = '▲ 良好';
const STATUS_LAGGING = '✖ 滞后';

/** Suffix appended to the rule-catalog count cell in the subsystem table. */
const CATALOG_RULE_NOTE_SUFFIX = '规则/SSOT';
/** Placeholder rendered when an upstream count is absent, so the gap stays visible. */
const COUNT_UNAVAILABLE = 'N/A';

const RAW_DIMENSIONS = [
  ' 1.|architectureConsistency|架构一致|架构一致 (Architecture Consistency)|分层边界解耦',
  ' 2.|semanticPurity|语义纯度|语义纯度 (Semantic Purity)|纯函数数据流',
  ' 3.|codeSecurity|代码安全|代码安全 (Code Security)|输入安全防御',
  ' 4.|performanceEfficiency|性能预算|性能预算 (Performance Efficiency)|零循环堆分配',
  ' 5.|standardization|标准化|标准化 (Standardization)|命名契约标准',
  ' 6.|modernity|现代化|现代化 (Modernity)|现代语法API',
  ' 7.|maintainability|可维护性|可维护性 (Maintainability)|控制流复杂度',
  ' 8.|commentQuality|注释质量|注释质量 (Comment Quality)|JSDoc契约完备',
  ' 9.|duplication|重复率|重复率 (Duplication)|DRY原则去重',
  '10.|techDebtRisk|技术债风险|技术债风险 (Tech Debt Risk)|零高危债务防线',
].join('\n');

const DIMENSION_DEFINITIONS = Object.freeze(
  RAW_DIMENSIONS.split('\n').map((line) => {
    const [num, key, name, labelEn, desc] = line.split('|');
    return { num, key, name, labelEn, desc };
  })
);

const RAW_SUBSYSTEMS = [
  '1|工作区物理卫生|hygiene|全仓零空文件/同构契约',
  '2|单源规则目录|rulesCatalog|规则/SSOT一致性',
  '3|auto-refactor|autoRefactor|CLI静态引擎质量基线',
  '4|workspace-timing|workspaceTiming|VSCode扩展审查门禁',
  '5|WebGames配置架构|webGames|卡拉尔领域配置审查',
].join('\n');

const SUBSYSTEM_DEFINITIONS = Object.freeze(
  RAW_SUBSYSTEMS.split('\n').map((line) => {
    const [num, name, key, note] = line.split('|');
    return { num: Number(num), name, key, note };
  })
);

const MD_TITLE = '# 🌐 全工作区跨项目统一审查与十维质量全景看板';
const MD_SUBSYS_HEADER = '### 📊 全工作区五大核心子系统基石得分';
const MD_SUBSYS_TABLE_HDR_1 = '| 序号 | 核心子系统 | 判定结果 | 归一化得分 | 进度可视化 | 覆盖说明 |';
const MD_SUBSYS_TABLE_HDR_2 = '| :---: | :--- | :---: | :---: | :--- | :--- |';
const MD_POLY_HEADER = '### 🌐 多语言技术栈质量均衡与离散度分布';
const MD_POLY_TABLE_HDR_1 = '| 语言栈 | 源码文件 | 物理行数 (LOC) | 对数权重 | 质量得分 | 状态 |';
const MD_POLY_TABLE_HDR_2 = '| :--- | :---: | :---: | :---: | :---: | :--- |';
const MD_DIM_SECTION_HEADER = '### 🎯 auto-refactor 静态引擎十维工程质量全景指数';
const MD_DIM_DEGRADED_NOTICE = '> ⚠️ [离线基线快照未就绪 - 优雅降级模式]';
const MD_DIM_HEADER_1 = '| 序号 | 质量维度 | 得分 | 等级 | 进度可视化 | 维度说明 |';
const MD_DIM_HEADER_2 = '| :---: | :--- | :---: | :---: | :--- | :--- |';

const MSG_NO_SNAPSHOT = 'ℹ️ 未检测到历史全工作区审查快照 (.audit-logs/audit-latest.json)。';
const MSG_NO_HISTORY = 'ℹ️ 未检测到全工作区审查历史轨迹 (.audit-logs/audit-history.jsonl)。';
const MSG_USAGE = 'Usage: node scripts/common/record-workspace-audit.js [--latest|--history|--json|--record-json <json>|--record-file <file>|--record-stdin]';

const CLI_LEDGER_BORDER = '=================================================================';
const CLI_LEDGER_DIVIDER = '-----------------------------------------------------------------';
const CLI_LEDGER_COLUMNS = '时间 (UTC)             | Commit   | 模式 | 状态 | 综合健康分 | 评级 | 耗时';
const CLI_MODE_FAST = 'Fast';
const CLI_MODE_FULL = 'Full';

const FLAG_VIEW = '--view';
const FLAG_LATEST = '--latest';
const FLAG_HISTORY = '--history';
const FLAG_JSON = '--json';
const FLAG_RECORD_FILE = '--record-file';
const FLAG_RECORD_JSON = '--record-json';
const FLAG_RECORD_STDIN = '--record-stdin';

function getGitRevision(root) {
  try {
    const out = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) return out.slice(0, COMMIT_REV_LEN);
  } catch (gitErr) {
    // Best-effort git commit resolution: ignore error and fallback to default commit hash
    void gitErr;
  }
  return DEFAULT_GIT_REV;
}

function getProgressBar(score, blocks = PROGRESS_BAR_BLOCKS) {
  const safe = Math.max(0, Math.min(SCORE_MAX, Number(score) || 0));
  const filled = Math.round((safe / SCORE_MAX) * blocks);
  const empty = blocks - filled;
  return CHAR_FILLED.repeat(filled) + CHAR_EMPTY.repeat(empty);
}

function getGradeTag(score) {
  const num = Number(score) || 0;
  if (num >= GRADE_A_PLUS) return TAG_A_PLUS;
  if (num >= GRADE_A) return TAG_A;
  if (num >= GRADE_B_PLUS) return TAG_B_PLUS;
  if (num >= GRADE_B) return TAG_B;
  if (num >= GRADE_C_PLUS) return TAG_C_PLUS;
  if (num >= GRADE_C) return TAG_C;
  if (num >= GRADE_D) return TAG_D;
  return TAG_F;
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
/**
 * Formats the rule-catalog count cell for the subsystem table.
 *
 * The count must never fall back to a baked-in number: a stale literal renders an authoritative
 * looking figure that silently disagrees with `rule-catalog.json`. When the upstream snapshot
 * omits the count the cell says N/A, so the gap stays visible instead of being papered over.
 *
 * @param {object} data - Normalized audit snapshot payload.
 * @returns {string} Count cell text including its unit suffix.
 */
function formatCatalogRuleNote(data) {
  const raw = Number(data.catalogRuleCount);
  const rendered = Number.isFinite(raw) && raw > 0 ? String(raw) : COUNT_UNAVAILABLE;
  return `${rendered}${CATALOG_RULE_NOTE_SUFFIX}`;
}

/**
 * Build standardized Markdown subsystem rows from audit snapshot data.
 *
 * @param {object} data - Normalized audit snapshot payload.
 * @returns {string[]} Markdown table rows.
 */
function renderSubsystemsTableRows(data) {
  const passBadge = (status) => (status === STATUS_PASS ? BADGE_PASS : BADGE_FAIL);
  return SUBSYSTEM_DEFINITIONS.map((s) => {
    const status = data.projects?.[s.key] || (data.status === STATUS_PASS ? STATUS_PASS : STATUS_FAIL);
    const score = Number(data.projectScores?.[s.key] ?? SCORE_MAX);
    const scoreStr = score.toFixed(1);
    const bar = getProgressBar(score, PROGRESS_BAR_BLOCKS);
    const note = s.key === 'rulesCatalog' ? formatCatalogRuleNote(data) : s.note;
    return `| ${s.num} | ${s.name} | ${passBadge(status)} | ${scoreStr} | \`[${bar}]\` | ${note} |`;
  });
}

function renderDimensionTableRows(dimensions) {
  const rows = [MD_DIM_HEADER_1, MD_DIM_HEADER_2];
  for (const d of DIMENSION_DEFINITIONS) {
    const rawVal = dimensions[d.key];
    const parsed = Number(rawVal);
    const numStr = d.num.trim().replace('.', '');
    if (rawVal == null || isNaN(parsed) || parsed <= 0) {
      rows.push(`| ${numStr} | ${d.labelEn} | N/A | [N/A] | \`[${' '.repeat(PROGRESS_BAR_BLOCKS)}]\` | ${d.desc} |`);
    } else {
      const scoreStr = parsed.toFixed(1);
      const gradeTag = getGradeTag(parsed);
      const bar = getProgressBar(parsed, PROGRESS_BAR_BLOCKS);
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
  const globalBadge = data.status === STATUS_PASS ? BADGE_GLOBAL_HEALTHY : BADGE_GLOBAL_ANOMALY;

  const headerMeta = [
    `> **综合健康分**: **${wsHealthStr}** (Grade: **${wsGrade}**)`,
    data.autonomyRate != null ? `&nbsp;|&nbsp; **自研率**: **${Number(data.autonomyRate).toFixed(2)}%**` : '',
    data.polyglotIndex != null ? `&nbsp;|&nbsp; **语言均衡**: **${Number(data.polyglotIndex).toFixed(2)}**` : '',
    data.totalDebt != null ? `&nbsp;|&nbsp; **技术债总量**: **${data.totalDebt} 项**` : '',
  ].filter(Boolean).join(' ');

  const lines = [
    MD_TITLE,
    '',
    headerMeta,
    '',
    `> **记录时间**: ${data.recordedAt} &nbsp;|&nbsp; **Git Revision**: \`${data.gitRevision}\` &nbsp;|&nbsp; **模式**: ${data.fastMode ? CLI_MODE_FAST : CLI_MODE_FULL} &nbsp;|&nbsp; **耗时**: ${data.elapsedSeconds}s &nbsp;|&nbsp; **状态**: ${globalBadge}`,
    '',
    MD_SUBSYS_HEADER,
    '',
    MD_SUBSYS_TABLE_HDR_1,
    MD_SUBSYS_TABLE_HDR_2,
  ];

  lines.push(...renderSubsystemsTableRows(data));

  if (data.polyglotBreakdown && typeof data.polyglotBreakdown === 'object') {
    lines.push('');
    lines.push(MD_POLY_HEADER);
    lines.push('');
    lines.push(MD_POLY_TABLE_HDR_1);
    lines.push(MD_POLY_TABLE_HDR_2);
    for (const item of Object.values(data.polyglotBreakdown)) {
      const status = item.score >= GRADE_A ? STATUS_EXCELLENT : item.score >= GRADE_B ? STATUS_GOOD : STATUS_LAGGING;
      lines.push(`| ${item.label} | ${item.files} | ${item.loc} | ${item.weight} | ${item.score.toFixed(1)} | ${status} |`);
    }
  }

  lines.push('');
  lines.push(MD_DIM_SECTION_HEADER);
  lines.push('');

  if (data.tenDimensions && typeof data.tenDimensions === 'object') {
    lines.push(...renderDimensionTableRows(data.tenDimensions));
  } else {
    lines.push(MD_DIM_DEGRADED_NOTICE);
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
    console.error(`⚠️ [Record-Audit] Append history ledger error: ${err.message}`);
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
    status: inputPayload.status || (inputPayload.exitCode === 0 ? STATUS_PASS : STATUS_FAIL),
    exitCode: Number(inputPayload.exitCode ?? 0),
    elapsedSeconds: Number(inputPayload.elapsedSeconds ?? 0),
    workspaceHealthScore: Number(healthScore.toFixed(2)),
    grade,
    autonomyRate: inputPayload.autonomyRate != null ? Number(Number(inputPayload.autonomyRate).toFixed(2)) : null,
    polyglotIndex: inputPayload.polyglotIndex != null ? Number(Number(inputPayload.polyglotIndex).toFixed(2)) : null,
    polyglotBreakdown: inputPayload.polyglotBreakdown || null,
    totalDebt: inputPayload.totalDebt != null ? Number(inputPayload.totalDebt) : null,
    catalogRuleCount: inputPayload.catalogRuleCount ? Number(inputPayload.catalogRuleCount) : null,
    // 一致性判定必须一并落盘：只存目录条数会让「两侧不等」这一事实在快照中消失。
    catalogCountConsistent:
      inputPayload.catalogCountConsistent != null ? Boolean(inputPayload.catalogCountConsistent) : null,
    projects: inputPayload.projects || {},
    projectScores: inputPayload.projectScores || {},
    tenDimensions: inputPayload.tenDimensions || inputPayload.qualityVector || null,
  };

  // 1. Persist audit-latest.json snapshot
  fs.writeFileSync(LATEST_JSON_PATH, JSON.stringify(normalized, null, 2), 'utf8');

  // 2. Persist audit-latest.md dashboard
  const mdContent = renderMarkdownDashboard(normalized);
  fs.writeFileSync(LATEST_MD_PATH, mdContent, 'utf8');

  // 3. Append compact ledger entry to audit-history.jsonl
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
    console.log(MSG_NO_SNAPSHOT);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(LATEST_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    console.log(renderMarkdownDashboard(data));
    process.exit(0);
  } catch (err) {
    console.error(`❌ Parse snapshot error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Display recent historical runs trend from jsonl ledger.
 */
function displayHistoryLedger() {
  if (!fs.existsSync(HISTORY_JSONL_PATH)) {
    console.log(MSG_NO_HISTORY);
    process.exit(0);
  }
  try {
    const raw = fs.readFileSync(HISTORY_JSONL_PATH, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    console.log(`\n${CLI_LEDGER_BORDER}`);
    console.log(`📈 全工作区统一审查历史质量轨迹 (最近 ${lines.length} 次记录)`);
    console.log(CLI_LEDGER_BORDER);
    console.log(CLI_LEDGER_COLUMNS);
    console.log(CLI_LEDGER_DIVIDER);
    const recent = lines.slice(-RECENT_HISTORY_LIMIT);
    for (const l of recent) {
      const e = JSON.parse(l);
      const timeStr = (e.t || '').replace('T', ' ').slice(0, 19);
      const revStr = (e.rev || DEFAULT_GIT_REV).padEnd(8);
      const modeStr = e.fast ? CLI_MODE_FAST : CLI_MODE_FULL;
      const statusBadge = e.status === STATUS_PASS ? BADGE_PASS : BADGE_FAIL;
      const scoreStr = Number(e.score || 0).toFixed(2).padStart(6);
      const gradeStr = (e.grade || 'A+').padEnd(4);
      const elapsedStr = `${Number(e.elapsed || 0).toFixed(1)}s`.padStart(5);
      console.log(`${timeStr} | ${revStr} | ${modeStr.padEnd(4)} | ${statusBadge} |  ${scoreStr}  | ${gradeStr} | ${elapsedStr}`);
    }
    console.log(`${CLI_LEDGER_BORDER}\n`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Read history ledger error: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes(FLAG_VIEW) || args.includes(FLAG_LATEST)) {
    displayLatestAudit();
    return;
  }

  if (args.includes(FLAG_HISTORY)) {
    displayHistoryLedger();
    return;
  }

  if (args.includes(FLAG_JSON)) {
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
  const recordFileIdx = args.indexOf(FLAG_RECORD_FILE);
  if (recordFileIdx !== -1 && args[recordFileIdx + 1]) {
    const fPath = path.resolve(process.cwd(), args[recordFileIdx + 1]);
    if (fs.existsSync(fPath)) {
      payload = JSON.parse(fs.readFileSync(fPath, 'utf8'));
    }
  }

  const recordJsonIdx = args.indexOf(FLAG_RECORD_JSON);
  if (recordJsonIdx !== -1 && args[recordJsonIdx + 1]) {
    payload = JSON.parse(args[recordJsonIdx + 1]);
  }

  if (args.includes(FLAG_RECORD_STDIN)) {
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
  console.log(MSG_USAGE);
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
