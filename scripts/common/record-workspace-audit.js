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
const { evaluateWorkspaceQuant } = require('./evaluate-workspace-quant');
const { ensureLf, stripAnsi } = require('./gate-failure-contract');
const { buildEloc5dSummary, renderEloc5dMarkdown } = require('./lib/workspace-eloc-rollup');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT_LOG_DIR = path.join(REPO_ROOT, '.audit-logs');
const LATEST_JSON_PATH = path.join(AUDIT_LOG_DIR, 'audit-latest.json');
const LATEST_AAS_PATH = path.join(AUDIT_LOG_DIR, 'audit-latest.aas.json');
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
// 四态闭包只有 PASS/BLOCK/SKIP/WARN：门禁的终态失败一律称 BLOCK，
// 落盘快照若写入 FAIL 会让下游读者以为存在第二种失败语义。
const STATUS_BLOCK = 'BLOCK';
const BADGE_PASS = '🟢 达标';
const BADGE_BLOCK = '🔴 阻断';
const BADGE_GLOBAL_HEALTHY = '🟢 全域质量达标';
const BADGE_GLOBAL_ANOMALY = '🔴 存在违规异常';

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
  '6|fractal-git|fractalGit|10子系统/Rust回归套件',
].join('\n');

const SUBSYSTEM_DEFINITIONS = Object.freeze(
  RAW_SUBSYSTEMS.split('\n').map((line) => {
    const [num, name, key, note] = line.split('|');
    return { num: Number(num), name, key, note };
  })
);

const MD_TITLE = '# 🌐 全工作区跨项目统一审查与十维质量全景看板';
const MD_SUBSYS_HEADER = '### 📊 全工作区六大核心子系统基石得分';
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
  const passBadge = (status) => (status === STATUS_PASS ? BADGE_PASS : BADGE_BLOCK);
  return SUBSYSTEM_DEFINITIONS.map((s) => {
    const status = data.projects?.[s.key] || (data.status === STATUS_PASS ? STATUS_PASS : STATUS_BLOCK);
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
      rows.push(`| ${numStr} | ${d.labelEn} | N/A | N/A | \`[${' '.repeat(PROGRESS_BAR_BLOCKS)}]\` | ${d.desc} |`);
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
/**
 * Build standardized Markdown quantitative risk table rows.
 *
 * @param {object} quant - Quantitative metrics envelope.
 * @returns {string[]} Markdown table lines.
 */
/**
 * Build standardized Markdown polyglot table rows.
 *
 * @param {object} breakdown - Polyglot breakdown data.
 * @returns {string[]} Markdown table lines.
 */
function renderPolyglotTableRows(breakdown) {
  if (!breakdown || typeof breakdown !== "object") return [];
  const rows = ["", MD_POLY_HEADER, "", MD_POLY_TABLE_HDR_1, MD_POLY_TABLE_HDR_2];
  for (const item of Object.values(breakdown)) {
    const validScore = typeof item.score === "number" && Number.isFinite(item.score);
    const status = !validScore ? STATUS_LAGGING : item.score >= GRADE_A ? STATUS_EXCELLENT : item.score >= GRADE_B ? STATUS_GOOD : STATUS_LAGGING;
    const scoreText = validScore ? item.score.toFixed(1) : "N/A";
    rows.push(`| ${item.label} | ${item.files} | ${item.loc} | ${item.weight} | ${scoreText} | ${status} |`);
  }
  return rows;
}

function getDsiBadge(val) {
  if (val < 0.5) return '🟢 弥散均布';
  if (val <= 0.7) return '🟡 局部偏聚';
  return '🔴 极化寡头';
}

function getRcdBadge(val) {
  if (val <= 0.4) return '🟢 靶向聚焦';
  if (val <= 0.75) return '🟡 多维分布';
  return '🔴 全域混沌';
}

function getEhlBadge(val) {
  if (val <= 2.0) return '🟢 快速自愈';
  if (val <= 5.0) return '🟡 常规迭代';
  return '🔴 惯性滞后';
}

function getErqBadge(val) {
  if (val >= 1.0) return '🟢 稳健超额';
  if (val >= 0.5) return '🟡 平稳受控';
  return '🔴 波动剧烈';
}

function getEdbBadge(val) {
  if (val <= 10.0) return '🟢 边界收敛';
  if (val <= 25.0) return '🟡 边界受控';
  return '🔴 边界警戒';
}

function getPtdBadge(val) {
  if (val <= 15.0) return '🟢 平稳演进';
  if (val <= 60.0) return '🟡 周期演进';
  return '🔴 历史剧震';
}

function getQuantStatusBadge(status) {
  if (status === 'de-leveraging') return '🟢 持续偿减';
  if (status === 'balanced') return '🟡 动态均势';
  if (status === 'insufficient_samples') return '⚪ 样本匮乏';
  return '🔴 赤字膨胀';
}

function getDdrBadge(val) {
  if (val >= 10.0) return '🟢 充分防御';
  if (val >= 3.0) return '🟡 稳定防御';
  return '🔴 底线承压';
}

function getRcrNote(status) {
  if (status === 'de-leveraging') return '重构清偿产能跑赢新增阻滞，架构处于主动偿减周期';
  if (status === 'balanced') return '重构产能与债务增量动态对冲，系统维持演进均势';
  if (status === 'insufficient_samples') return '样本与观测时序匮乏，暂未采集到有效偿债流量';
  return '新增债务阻滞超出重构清偿速度，需警惕赤字累积';
}

function getErqNote(val) {
  if (val >= 1.0) return '质量基线长期处于高位，超额质量收益稳定受控';
  if (val >= 0.5) return '质量表现高于基线，扰动波动处于可接受包络';
  return '质量受压接近及格线，工程超额收益偏低';
}

function getDdrNote(val) {
  if (val >= 10.0) return '下行防御垫层充沛，破位回撤风险受控';
  if (val >= 3.0) return '具备稳定防御基底，下行波动处于可控区间';
  return '存在跌破质量底线风险，下行防御亟待加固';
}

function getEdbNote(val) {
  if (val <= 10.0) return '95%置信度下单次扰动最大质量衰减预测极低';
  if (val <= 25.0) return '单次极端扰动下的质量衰减处于受控预测上限';
  return '极端扰动下质量回撤预测偏大，防御边界需收紧';
}

function getPtdNote(val) {
  if (val <= 15.0) return '历史质量轨迹平稳，未见大幅度周期落差';
  if (val <= 60.0) return '记录从初期至当前演化周期内的正常峰谷差';
  return '历史峰谷落差过大，工程质量曾出现剧烈震荡';
}

function getEhlNote(val) {
  if (val <= 2.0) return '突发扰动或单点缺陷可在1~2步迭代内迅速收复稳态';
  if (val <= 5.0) return '系统具备自愈趋势，需数步迭代回到稳态基线';
  return '自愈半衰周期偏长，存在缺陷惯性滞后风险';
}

function getDsiNote(val) {
  if (val < 0.5) return '技术债务在全仓代码中弥散平铺，无单体巨石垄断';
  if (val <= 0.7) return '部分核心模块显现技术债务局部偏聚，需重点关照';
  return '少数模块垄断全仓绝大部分债务，存在单体极化风险';
}

function getRcdNote(val) {
  if (val <= 0.4) return '缺陷高度集中在少数规则家族，可执行靶向消除';
  if (val <= 0.75) return '缺陷跨多家族规则分布，宜展开多维常态巡检';
  return '缺陷在各规则家族全域混沌发散，需系统性治理';
}

/**
 * Resolves a quantitative metric with primary and fallback keys.
 *
 * @param {number|null|undefined} primary - Preferred metric value.
 * @param {number|null|undefined} fallback - Secondary fallback value.
 * @param {number} [defaultVal=0] - Default value when both are omitted.
 * @returns {number} Resolved metric as a number.
 */
function resolveQuantMetric(primary, fallback, defaultVal = 0) {
  if (primary != null) return Number(primary);
  if (fallback != null) return Number(fallback);
  return defaultVal;
}

function renderQuantTableRows(quant) {
  const rcrVal = resolveQuantMetric(quant.rcr, quant.icr);
  const erqVal = resolveQuantMetric(quant.erq, quant.qsr);
  const ddrVal = resolveQuantMetric(quant.ddr, quant.sortino);
  const dsiVal = resolveQuantMetric(quant.dsi, quant.debtGini);
  const rcdVal = resolveQuantMetric(quant.rcd, quant.defectEntropy);
  const edbVal = resolveQuantMetric(quant.edb95, quant.var95);
  const ptdVal = resolveQuantMetric(quant.ptd, quant.mdd);
  const ehlVal = resolveQuantMetric(quant.ehl, quant.halfLifeCommits, 0.0);

  const statusBadge = getQuantStatusBadge(quant.status);
  const ddrBadge = getDdrBadge(ddrVal);
  const erqBadge = getErqBadge(erqVal);
  const edbBadge = getEdbBadge(edbVal);
  const ptdBadge = getPtdBadge(ptdVal);
  const dsiBadge = getDsiBadge(dsiVal);
  const rcdBadge = getRcdBadge(rcdVal);
  const ehlBadge = getEhlBadge(ehlVal);

  const rcrBar = getProgressBar(Math.min(100, (rcrVal / 3.0) * 100), 10);
  const erqBar = getProgressBar(Math.min(100, (erqVal / 1.0) * 100), 10);
  const ddrBar = getProgressBar(Math.min(100, (Math.min(ddrVal, 10.0) / 10.0) * 100), 10);
  const dsiBar = getProgressBar(dsiVal * 100, 10);
  const rcdBar = getProgressBar(rcdVal * 100, 10);
  const edbBar = getProgressBar(Math.min(100, edbVal), 10);
  const ptdBar = getProgressBar(Math.min(100, ptdVal), 10);
  const ehlBar = getProgressBar(Math.max(0, 100 - (ehlVal / 5.0) * 100), 10);

  const rcrNote = getRcrNote(quant.status);
  const erqNote = getErqNote(erqVal);
  const ddrNote = getDdrNote(ddrVal);
  const edbNote = getEdbNote(edbVal);
  const ptdNote = getPtdNote(ptdVal);
  const ehlNote = getEhlNote(ehlVal);
  const dsiNote = getDsiNote(dsiVal);
  const rcdNote = getRcdNote(rcdVal);

  return [
    '',
    '### 📈 架构动力学与韧性量化看板 (Architecture Dynamics & Resilience, ADR-Q)',
    '',
    '| 观测子域 | 指标名称 (规范代号) | 实时标量 | 动态量规 | 状态等级 | 架构治理与战术研判 |',
    '| :--- | :--- | :---: | :---: | :---: | :--- |',
    `| **偿债动力学** | 清偿代偿比 (RCR) | **${rcrVal.toFixed(2)}x** | \`[${rcrBar}]\` | ${statusBadge} | ${rcrNote} |`,
    `| **时序韧性** | 质量坚韧商 (ERQ) | **${erqVal.toFixed(2)}** | \`[${erqBar}]\` | ${erqBadge} | ${erqNote} |`,
    `| | 破位防御度 (DDR) | **${ddrVal >= 100 ? ddrVal.toFixed(1) : ddrVal.toFixed(2)}** | \`[${ddrBar}]\` | ${ddrBadge} | ${ddrNote} |`,
    `| | 极端退化包络 (EDB-95) | **${edbVal.toFixed(2)}%** | \`[${edbBar}]\` | ${edbBadge} | ${edbNote} |`,
    `| | 历史峰谷落差 (PTD) | **${ptdVal.toFixed(2)}%** | \`[${ptdBar}]\` | ${ptdBadge} | ${ptdNote} |`,
    `| | 扰动自愈步长 (EHL) | **${ehlVal.toFixed(1)} 步** | \`[${ehlBar}]\` | ${ehlBadge} | ${ehlNote} |`,
    `| **空间拓扑** | 债务偏聚指数 (DSI) | **${dsiVal.toFixed(2)}** | \`[${dsiBar}]\` | ${dsiBadge} | ${dsiNote} |`,
    `| | 根因发散熵 (RCD) | **${rcdVal.toFixed(2)}** | \`[${rcdBar}]\` | ${rcdBadge} | ${rcdNote} |`,
  ];
}

/**
 * Renders the markdown header metadata string.
 *
 * @param {object} data - Normalized audit data.
 * @returns {string} Header metadata markdown.
 */
function renderHeaderMeta(data) {
  const wsHealthStr = Number(data.workspaceHealthScore).toFixed(2);
  const wsGrade = data.grade || getGradeFromScore(data.workspaceHealthScore);
  return [
    `> **综合健康分**: **${wsHealthStr}** (Grade: **${wsGrade}**)`,
    data.autonomyRate != null ? `&nbsp;|&nbsp; **自研率**: **${Number(data.autonomyRate).toFixed(2)}%**` : '',
    data.polyglotIndex != null ? `&nbsp;|&nbsp; **语言均衡**: **${Number(data.polyglotIndex).toFixed(2)}**` : '',
    data.totalDebt != null ? `&nbsp;|&nbsp; **技术债总量**: **${data.totalDebt} 项**` : '',
  ].filter(Boolean).join(' ');
}

/**
 * Renders the failure diagnostics table and crash stacks if gate was blocked.
 *
 * @param {object} data - Normalized audit data.
 * @returns {string[]} Failure diagnostics markdown lines.
 */
function renderFailureDiagnostics(data) {
  if (data.status !== STATUS_BLOCK || !Array.isArray(data.failures) || data.failures.length === 0) {
    return [];
  }
  const lines = [
    '### 🚨 门禁阻断与失败诊断分析 (Failure Diagnostics & Actionable Guidance)',
    '',
    `> ⚠️ 当前工作区审查已被阻断，共检出 **${data.failures.length}** 处失败步骤。请按下方指引单点排查修复：`,
    '',
    '| 序号 | 失败支柱/步骤 | 退出码 | 关键错误摘要 | 推荐修复动作 | 一键复现与验证命令 |',
    '| :---: | :--- | :---: | :--- | :--- | :--- |',
  ];
  data.failures.forEach((f, idx) => {
    const stepLabel = `\`${f.pillarId || 'UNKNOWN'}\` (${f.stepName || f.stepId || '步骤'})`;
    const summary = stripAnsi(f.errorSummary || '返回非零退出码').replace(/\|/g, '\\|');
    const fix = stripAnsi(f.actionableFix || '查看输出排查').replace(/\|/g, '\\|');
    const cmd = f.verificationCommand ? `\`${stripAnsi(f.verificationCommand).replace(/\|/g, '\\|')}\`` : 'N/A';
    lines.push(`| ${idx + 1} | ${stepLabel} | \`${f.exitCode ?? 1}\` | ${summary} | ${fix} | ${cmd} |`);
  });
  lines.push('', '<details>', '<summary>🔍 点击展开失败步骤详细堆栈快照 (Crash Stacks)</summary>', '');
  for (const f of data.failures) {
    lines.push(`#### 📌 [${f.pillarId || 'PILLAR'}] ${f.stepName || f.stepId || '步骤'}`);
    if (f.command) lines.push(`- **执行命令**: \`${f.command}\``);
    if (f.logFilePath) lines.push(`- **原始日志**: \`${f.logFilePath}\``);
    lines.push('```text', stripAnsi(f.errorStackSnippet || f.errorSummary || 'No stack snippet available.'), '```', '');
  }
  lines.push('</details>', '');
  return lines;
}

function renderMarkdownDashboard(data) {
  const globalBadge = data.status === STATUS_PASS ? BADGE_GLOBAL_HEALTHY : BADGE_GLOBAL_ANOMALY;
  const headerMeta = renderHeaderMeta(data);

  const lines = [
    MD_TITLE,
    '',
    headerMeta,
    '',
    `> **记录时间**: ${data.recordedAt} &nbsp;|&nbsp; **Git Revision**: \`${data.gitRevision}\` &nbsp;|&nbsp; **模式**: ${data.fastMode ? CLI_MODE_FAST : CLI_MODE_FULL} &nbsp;|&nbsp; **耗时**: ${data.elapsedSeconds}s &nbsp;|&nbsp; **状态**: ${globalBadge}`,
    '',
    ...renderFailureDiagnostics(data),
    MD_SUBSYS_HEADER,
    '',
    MD_SUBSYS_TABLE_HDR_1,
    MD_SUBSYS_TABLE_HDR_2,
    ...renderSubsystemsTableRows(data),
    ...renderPolyglotTableRows(data.polyglotBreakdown),
    '',
    MD_DIM_SECTION_HEADER,
    '',
    ...(data.tenDimensions && typeof data.tenDimensions === 'object'
      ? renderDimensionTableRows(data.tenDimensions)
      : [MD_DIM_DEGRADED_NOTICE]),
    ...(data.rawTenDimensions && typeof data.rawTenDimensions === 'object'
      ? [
          '',
          '#### 🔍 auto-refactor 静态引擎未折算原始十维得分 (Raw Engine 10D)',
          '',
          ...renderDimensionTableRows(data.rawTenDimensions),
        ]
      : []),
    ...(data.quant && typeof data.quant === 'object' ? renderQuantTableRows(data.quant) : []),
    ...renderEloc5dMarkdown(data.eloc5dSummary),
    '',
  ];

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
 * Resolves failures array from inputPayload or audit-failure-latest.json.
 *
 * @param {object} inputPayload - Input payload.
 * @param {string} status - Audit status.
 * @returns {object[]} Failures list.
 */
function resolveAuditFailures(inputPayload, status) {
  if (Array.isArray(inputPayload.failures)) {
    return inputPayload.failures;
  }
  if (inputPayload.failures && typeof inputPayload.failures === 'object' && Object.keys(inputPayload.failures).length > 0) {
    return [inputPayload.failures];
  }
  if (status !== STATUS_BLOCK) {
    return [];
  }
  const failureLatestPath = path.join(AUDIT_LOG_DIR, 'audit-failure-latest.json');
  if (!fs.existsSync(failureLatestPath)) {
    return [];
  }
  try {
    const failureDoc = JSON.parse(fs.readFileSync(failureLatestPath, 'utf8'));
    if (Array.isArray(failureDoc.failures)) {
      return failureDoc.failures;
    }
  } catch {
    // Safe fallback ignore
  }
  return [];
}

/**
 * Formats an optional numerical value to a fixed number of decimals, returning null if missing.
 *
 * @param {number|string|null|undefined} val - Input raw value.
 * @param {number|null} [decimals=null] - Decimal places to round to.
 * @returns {number|null} Formatted number or null.
 */
function formatOptionalNumber(val, decimals = null) {
  if (val == null) return null;
  const num = Number(val);
  return decimals != null ? Number(num.toFixed(decimals)) : num;
}

/**
 * Normalizes input payload into standard audit schema.
 *
 * @param {object} inputPayload - Raw input payload.
 * @returns {object} Normalized payload.
 */
function buildNormalizedPayload(inputPayload) {
  const gitRev = inputPayload.gitRevision || getGitRevision(REPO_ROOT);
  const nowIso = inputPayload.timestamp || new Date().toISOString();
  const healthScore = resolveQuantMetric(inputPayload.workspaceHealthScore, inputPayload.compositeScore);
  const grade = inputPayload.grade || getGradeFromScore(healthScore);
  const quant = inputPayload.quant || evaluateWorkspaceQuant(REPO_ROOT);
  const status = inputPayload.status || (inputPayload.exitCode === 0 ? STATUS_PASS : STATUS_BLOCK);
  const failures = resolveAuditFailures(inputPayload, status);

  return {
    protocolVersion: PROTOCOL_VERSION,
    recordedAt: nowIso,
    gitRevision: gitRev,
    fastMode: Boolean(inputPayload.fastMode),
    status,
    exitCode: Number(inputPayload.exitCode || 0),
    elapsedSeconds: Number(inputPayload.elapsedSeconds || 0),
    workspaceHealthScore: Number(healthScore.toFixed(2)),
    grade,
    autonomyRate: formatOptionalNumber(inputPayload.autonomyRate, 2),
    polyglotIndex: formatOptionalNumber(inputPayload.polyglotIndex, 2),
    polyglotBreakdown: inputPayload.polyglotBreakdown || null,
    totalDebt: formatOptionalNumber(inputPayload.totalDebt),
    catalogRuleCount: formatOptionalNumber(inputPayload.catalogRuleCount),
    catalogCountConsistent:
      inputPayload.catalogCountConsistent != null ? Boolean(inputPayload.catalogCountConsistent) : null,
    projects: inputPayload.projects || {},
    projectScores: inputPayload.projectScores || {},
    rawTenDimensions: inputPayload.rawTenDimensions || null,
    tenDimensions: inputPayload.tenDimensions || inputPayload.qualityVector || null,
    eloc5dSummary: inputPayload.eloc5dSummary || buildEloc5dSummary(REPO_ROOT),
    quant,
    failures,
  };
}

/**
 * Builds AAS snapshot object from normalized payload.
 *
 * @param {object} normalized - Normalized payload.
 * @returns {object} AAS snapshot.
 */
function buildAasSnapshot(normalized) {
  const quant = normalized.quant;
  return {
    schema: 'aas-v1',
    tool: 'workspace-audit',
    version: '1.0.0',
    timestamp: normalized.recordedAt,
    root: REPO_ROOT,
    verdict: normalized.status,
    health: {
      score: normalized.workspaceHealthScore,
      grade: normalized.grade,
      cai: normalized.autonomyRate,
      ...(quant ? {
        quant: {
          icr: quant.icr,
          qsr: quant.qsr,
          sortino: quant.sortino,
          debtGini: quant.debtGini,
          defectEntropy: quant.defectEntropy,
          var95: quant.var95,
          mdd: quant.mdd,
          halfLifeCommits: quant.halfLifeCommits,
          status: quant.status,
        },
      } : {}),
      counts: {
        total: normalized.totalDebt ?? 0,
        subsystems: Object.keys(normalized.projects || {}).length,
      },
    },
    subsystems: normalized.projects,
    projectScores: normalized.projectScores,
    dimensions: normalized.tenDimensions,
    ...(normalized.rawTenDimensions ? { rawDimensions: normalized.rawTenDimensions } : {}),
    ...(normalized.eloc5dSummary ? { eloc5d: normalized.eloc5dSummary } : {}),
    failures: normalized.failures,
    defaultVerify: 'pwsh -File scripts/ps1/audit-all.ps1',
  };
}

/**
 * Builds compact history entry from normalized payload.
 *
 * @param {object} normalized - Normalized payload.
 * @returns {object} History entry.
 */
function buildHistoryEntry(normalized) {
  return {
    t: normalized.recordedAt,
    rev: normalized.gitRevision,
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
    failedSteps: normalized.failures ? normalized.failures.map((f) => f.pillarId || f.stepId).filter(Boolean) : [],
  };
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

  const normalized = buildNormalizedPayload(inputPayload);

  // 1. Persist audit-latest.json snapshot
  fs.writeFileSync(LATEST_JSON_PATH, ensureLf(JSON.stringify(normalized, null, 2)), 'utf8');

  // 1.1 Persist audit-latest.aas.json compact agent-native snapshot
  const aasSnapshot = buildAasSnapshot(normalized);
  fs.writeFileSync(LATEST_AAS_PATH, ensureLf(JSON.stringify(aasSnapshot, null, 2)), 'utf8');

  // 2. Persist audit-latest.md dashboard
  const mdContent = ensureLf(renderMarkdownDashboard(normalized));
  fs.writeFileSync(LATEST_MD_PATH, mdContent, 'utf8');

  // 3. Append compact ledger entry to audit-history.jsonl
  const historyEntry = buildHistoryEntry(normalized);
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
    console.error(`✖ Parse snapshot error: ${err.message}`);
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
      const statusBadge = e.status === STATUS_PASS ? BADGE_PASS : BADGE_BLOCK;
      const scoreStr = Number(e.score || 0).toFixed(2).padStart(6);
      const gradeStr = (e.grade || 'A+').padEnd(4);
      const elapsedStr = `${Number(e.elapsed || 0).toFixed(1)}s`.padStart(5);
      console.log(`${timeStr} | ${revStr} | ${modeStr.padEnd(4)} | ${statusBadge} |  ${scoreStr}  | ${gradeStr} | ${elapsedStr}`);
    }
    console.log(`${CLI_LEDGER_BORDER}\n`);
    process.exit(0);
  } catch (err) {
    console.error(`✖ Read history ledger error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Handles --aas and --json inspection flags.
 *
 * @param {string[]} args - Process arguments.
 */
function handleInspectFlags(args) {
  if (args.includes('--aas')) {
    if (fs.existsSync(LATEST_AAS_PATH)) {
      console.log(fs.readFileSync(LATEST_AAS_PATH, 'utf8'));
    } else {
      console.log(JSON.stringify({ schema: 'aas-v1', status: 'NONE', message: 'No AAS snapshot recorded yet.' }, null, 2));
    }
    process.exit(0);
  }

  if (args.includes(FLAG_JSON)) {
    if (fs.existsSync(LATEST_JSON_PATH)) {
      console.log(fs.readFileSync(LATEST_JSON_PATH, 'utf8'));
    } else {
      console.log(JSON.stringify({ status: 'NONE', message: 'No audit snapshot recorded yet.' }, null, 2));
    }
    process.exit(0);
  }
}

/**
 * Resolves CLI record payload from file, argument string, or stdin.
 *
 * @param {string[]} args - Process arguments.
 * @returns {object|null} Parsed record payload or null.
 */
function resolveRecordPayload(args) {
  const recordFileIdx = args.indexOf(FLAG_RECORD_FILE);
  if (recordFileIdx !== -1 && args[recordFileIdx + 1]) {
    const fPath = path.resolve(process.cwd(), args[recordFileIdx + 1]);
    if (fs.existsSync(fPath)) {
      return JSON.parse(fs.readFileSync(fPath, 'utf8'));
    }
  }

  const recordJsonIdx = args.indexOf(FLAG_RECORD_JSON);
  if (recordJsonIdx !== -1 && args[recordJsonIdx + 1]) {
    return JSON.parse(args[recordJsonIdx + 1]);
  }

  if (args.includes(FLAG_RECORD_STDIN)) {
    const inputBuf = fs.readFileSync(0, 'utf8');
    if (inputBuf.trim()) {
      return JSON.parse(inputBuf);
    }
  }

  return null;
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

  handleInspectFlags(args);

  const payload = resolveRecordPayload(args);
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
