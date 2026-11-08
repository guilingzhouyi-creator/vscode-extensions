/**
 * Module: Unified Workspace Audit Summary & Dashboard Renderer
 * File Path: scripts/common/render-audit-all-summary.js
 * Architecture Role: Aggregates 6-pillar gate verdicts, live subproject audit telemetry,
 *   10-dimensional quality vectors, and polyglot balance indices for scripts/sh/audit-all.sh.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process) and
 *   scripts/common/{evaluate-polyglot-balance,evaluate-workspace-quant,record-workspace-audit,record-workspace-trajectory}.js;
 *   invoked at the conclusion of scripts/sh/audit-all.sh.
 * Responsibilities:
 *   1. Ingest live subproject reports (auto-refactor, workspace-timing, WebGames, fractal-git) with zero fabricated fallback scores.
 *   2. Fuse cross-project CAI autonomy rates and compute damped 6-pillar workspace health scores.
 *   3. Project 10-dimensional quality vectors and persist audit history + trajectory records.
 *   4. Render JSON, AAS v1.0 agent envelope, or terminal Unicode box dashboard + GitHub Step Summary.
 * Exit Semantics & Design Rationale: Exits 0 when all 6 pillars pass and all required telemetry reports
 *   are present; exits 1 (Fail-Closed) on any pillar failure or missing subproject report.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const SCORE_FLOOR = 15.0;
const THEORETICAL_SCORE_CEILING = 99.75;
const TARGET_WIDTH = 71;

const DIM_DEFINITIONS = Object.freeze([
  { num: ' 1.', name: '架构一致', key: 'architectureConsistency', desc: '分层边界解耦', labelEn: '架构一致 (Architecture Consistency)' },
  { num: ' 2.', name: '语义纯度', key: 'semanticPurity', desc: '纯函数数据流', labelEn: '语义纯度 (Semantic Purity)' },
  { num: ' 3.', name: '代码安全', key: 'codeSecurity', desc: '输入安全防御', labelEn: '代码安全 (Code Security)' },
  { num: ' 4.', name: '性能预算', key: 'performanceEfficiency', desc: '零循环堆分配', labelEn: '性能预算 (Performance Efficiency)' },
  { num: ' 5.', name: '标准化', key: 'standardization', desc: '命名契约标准', labelEn: '标准化 (Standardization)' },
  { num: ' 6.', name: '现代化', key: 'modernity', desc: '现代语法API', labelEn: '现代化 (Modernity)' },
  { num: ' 7.', name: '可维护性', key: 'maintainability', desc: '控制流复杂度', labelEn: '可维护性 (Maintainability)' },
  { num: ' 8.', name: '注释质量', key: 'commentQuality', desc: 'JSDoc契约完备', labelEn: '注释质量 (Comment Quality)' },
  { num: ' 9.', name: '重复率', key: 'duplication', desc: 'DRY原则去重', labelEn: '重复率 (Duplication)' },
  { num: '10.', name: '技术债风险', key: 'techDebtRisk', desc: '零高危债务防线', labelEn: '技术债风险 (Tech Debt Risk)' },
]);

/**
 * Safely reads and parses a UTF-8 JSON file on disk.
 *
 * @param {string} filePath - Absolute path to JSON file.
 * @returns {object|null} Parsed JSON object or null when missing/corrupt.
 */
function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

const RULE_CODE_INDICES = Object.freeze([
  12, 19, 26, 13, 20, 40, 21, 27, 22, 23, 28, 41, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
]);

/**
 * Parses an integer argument at a given index with a zero default.
 *
 * @param {string[]} argv - Argument vector.
 * @param {number} idx - Positional index.
 * @returns {number} Parsed integer.
 */
function argInt(argv, idx) {
  return Number(argv[idx]) || 0;
}

/**
 * Parses positional CLI arguments forwarded from scripts/sh/audit-all.sh.
 *
 * @param {string[]} argv - Normalized 1-indexed argument array matching `node -e` layout.
 * @returns {object} Structured audit runner state and step exit codes.
 */
function parseCliInputs(argv) {
  return {
    startTime: Number(argv[1]) || Date.now(),
    failed: argv[2] === '1',
    jsonMode: argv[3] === '1',
    statusHygiene: argv[4] || 'PASS',
    statusRules: argv[5] || 'PASS',
    statusAr: argv[6] || 'PASS',
    statusWt: argv[7] || 'PASS',
    statusWg: argv[8] || 'PASS',
    rootDir: argv[9] || process.cwd(),
    codeHygiene: argInt(argv, 10),
    codeIso: argInt(argv, 11),
    codeCatalog: argInt(argv, 12),
    fastMode: argv[14] === '1',
    agentMode: argv[15] === '1',
    hygieneReportFile: argv[16] || '',
    codeGi: argInt(argv, 17),
    statusFg: argv[18] || 'PASS',
    codeDensity: argInt(argv, 24),
    codeEloc: argInt(argv, 25),
    commitLedger: argv[42] === '1',
    ruleCodes: RULE_CODE_INDICES.map((idx) => argInt(argv, idx)),
  };
}

/**
 * Applies AAS baseline health fields into the mutable baseline accumulator.
 *
 * @param {object|null} aas - Parsed self-audit-baseline.aas.json object.
 * @param {object} acc - Mutable baseline accumulator.
 * @returns {void}
 */
function applyAasBaseline(aas, acc) {
  if (!aas || aas.schema !== 'aas-v1' || !aas.health) return;
  const h = aas.health;
  if (h.score != null) acc.compositeScore = h.score;
  if (h.grade != null) acc.grade = h.grade;
  if (h.counts && h.counts.total != null) acc.totalDebt = h.counts.total;
  if (h.cai != null) acc.autonomyRate = h.cai;
  if (aas.dimensions) acc.tenDimensions = aas.dimensions;
}

/**
 * Applies legacy self-audit-baseline.json fallback fields into the accumulator.
 *
 * @param {object|null} base - Parsed self-audit-baseline.json object.
 * @param {object} acc - Mutable baseline accumulator.
 * @returns {void}
 */
function applyJsonBaseline(base, acc) {
  if (!base) return;
  const m = base.metrics || {};
  if (acc.compositeScore === null) acc.compositeScore = m.compositeScore ?? base.compositeScore ?? null;
  if (acc.grade === null) acc.grade = m.grade || null;
  if (acc.totalDebt === null) acc.totalDebt = m.totalIssues ?? m.unsuppressedIssues ?? null;
  if (acc.autonomyRate === null) acc.autonomyRate = base.autonomyRate ?? m.autonomyRate ?? base.cai ?? null;
  if (!acc.tenDimensions && base.tenDimensions) acc.tenDimensions = base.tenDimensions;
}

/**
 * Applies lightweight audit-receipt.json fallback fields into the accumulator.
 *
 * @param {object|null} rc - Parsed audit-receipt.json object.
 * @param {object} acc - Mutable baseline accumulator.
 * @returns {void}
 */
function applyReceiptBaseline(rc, acc) {
  if (!rc || rc.schemaVersion !== '1.0') return;
  acc.compositeScore = rc.healthScore ?? null;
  acc.grade = rc.grade ?? null;
  acc.totalDebt = rc.issuesTotal ?? null;
  acc.autonomyRate = rc.confidence != null ? Number(rc.confidence) * 100 : null;
  if (rc.dimensions) acc.tenDimensions = rc.dimensions;
}

/**
 * Loads auto-refactor baseline telemetry and fuses cross-project CAI autonomy rate.
 *
 * @param {string} rootDir - Workspace repository root.
 * @returns {object} Baseline composite score, grade, debt count, autonomyRate, and 10D vector.
 */
function loadAutoRefactorBaseline(rootDir) {
  const reportsDir = path.join(rootDir, 'auto-refactor', 'reports');
  const acc = {
    compositeScore: null,
    grade: null,
    totalDebt: null,
    autonomyRate: null,
    tenDimensions: null,
  };

  applyAasBaseline(readJsonSafe(path.join(reportsDir, 'self-audit-baseline.aas.json')), acc);
  applyJsonBaseline(readJsonSafe(path.join(reportsDir, 'self-audit-baseline.json')), acc);
  if (acc.compositeScore === null) {
    applyReceiptBaseline(readJsonSafe(path.join(reportsDir, 'audit-receipt.json')), acc);
  }

  const fgData = readJsonSafe(path.join(rootDir, 'fractal-git', 'reports', 'audit-latest.json'));
  const fgCai = fgData?.summary?.caiIndex != null ? Number(fgData.summary.caiIndex) : null;
  if (acc.autonomyRate != null && fgCai != null) {
    acc.autonomyRate = Number((Number(acc.autonomyRate) * 0.67 + fgCai * 0.33).toFixed(2));
  }

  return acc;
}

/**
 * Evaluates Pillar 1 (Physical Hygiene) score without fabricated fallbacks.
 *
 * @param {object} state - Mutable runner state.
 * @returns {number} Clamped hygiene pillar score.
 */
function evaluateHygieneScore(state) {
  const hygData = readJsonSafe(state.hygieneReportFile);
  let baseHygiene = hygData && typeof hygData.score === 'number' ? hygData.score : null;
  if (baseHygiene === null) {
    state.statusHygiene = 'BLOCK';
    state.failed = true;
    baseHygiene = SCORE_FLOOR;
  }
  if (state.codeIso !== 0) baseHygiene = Math.max(SCORE_FLOOR, baseHygiene - 20.0);
  if (state.codeGi !== 0) baseHygiene = Math.max(SCORE_FLOOR, baseHygiene - 10.0);
  if (state.codeDensity !== 0) baseHygiene = Math.max(SCORE_FLOOR, baseHygiene - 15.0);
  if (state.codeEloc !== 0) baseHygiene = Math.max(SCORE_FLOOR, baseHygiene - 15.0);
  return Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, Number(baseHygiene.toFixed(1))));
}

/**
 * Samples polyglot balance index and language-stack score breakdown.
 *
 * @param {string} rootDir - Workspace repository root.
 * @param {boolean} fastMode - Whether fast mode is active.
 * @returns {{ polyglotIndex: number|null, polyglotBreakdown: object|null }} Polyglot telemetry.
 */
function samplePolyglotMetrics(rootDir, fastMode) {
  const polyScript = path.join(rootDir, 'scripts', 'common', 'evaluate-polyglot-balance.js');
  if (!fs.existsSync(polyScript)) {
    return { polyglotIndex: null, polyglotBreakdown: null };
  }
  try {
    const pArgs = [polyScript, '--json'];
    if (fastMode) pArgs.push('--fast');
    const pOut = execFileSync(process.execPath, pArgs, { cwd: rootDir, encoding: 'utf8' });
    const pJson = JSON.parse(pOut);
    if (pJson && pJson.polyglotIndex != null) {
      return {
        polyglotIndex: Number(pJson.polyglotIndex),
        polyglotBreakdown: pJson.breakdown || null,
      };
    }
  } catch (_) {
    // Non-fatal: missing language stack score will trigger Fail-Closed downstream if required.
  }
  return { polyglotIndex: null, polyglotBreakdown: null };
}

/**
 * Evaluates Pillar 4 (workspace-timing) score from live reports.
 *
 * @param {object} state - Mutable runner state.
 * @returns {number} Clamped workspace-timing pillar score.
 */
function evaluateWorkspaceTimingScore(state) {
  let baseWt = null;
  const candidates = [
    path.join(state.rootDir, 'workspace-timing', 'reports', 'auto-refactor-latest.json'),
    path.join(state.rootDir, 'workspace-timing', 'reports', '.refactor-cache', 'report.json'),
  ];
  for (const cand of candidates) {
    const data = readJsonSafe(cand);
    if (data?.qualityScore && typeof data.qualityScore.compositeScore === 'number') {
      baseWt = Number(data.qualityScore.compositeScore.toFixed(2));
      break;
    }
  }

  if (baseWt === null) {
    const wtReport = readJsonSafe(
      path.join(state.rootDir, 'workspace-timing', 'reports', 'review', 'report-latest.json'),
    );
    const totalChecks = Number(wtReport?.summary?.checks || 0);
    if (totalChecks > 0) {
      const passChecks = Number(wtReport.summary.byStatus?.PASS || 0);
      const warnCount = Number(wtReport.summary.bySeverity?.warning || 0);
      const errCount = Number(wtReport.summary.bySeverity?.error || 0);
      const rawWt = 99.0 * (passChecks / totalChecks) - warnCount * 0.5 - errCount * 5.0;
      baseWt = Math.max(SCORE_FLOOR, Number(rawWt.toFixed(1)));
    }
  }

  if (baseWt === null) {
    state.statusWt = 'BLOCK';
    state.failed = true;
    baseWt = SCORE_FLOOR;
  }
  return state.statusWt === 'PASS' ? baseWt : Math.max(SCORE_FLOOR, Number((baseWt - 60.0).toFixed(1)));
}

/**
 * Evaluates Pillar 5 (WebGames) score from live GDScript + config audit telemetry.
 *
 * @param {object} state - Mutable runner state.
 * @param {object|null} polyglotBreakdown - Polyglot language breakdown.
 * @returns {number} Clamped WebGames pillar score.
 */
function evaluateWebGamesScore(state, polyglotBreakdown) {
  let gdScore =
    typeof polyglotBreakdown?.gdscript?.score === 'number' ? polyglotBreakdown.gdscript.score : null;
  if (gdScore === null) {
    const wgRef = readJsonSafe(path.join(state.rootDir, 'WebGames', 'reports', 'auto-refactor-latest.json'));
    if (typeof wgRef?.qualityScore?.compositeScore === 'number') {
      gdScore = Number(wgRef.qualityScore.compositeScore);
    }
  }

  let configScore = null;
  const wgData = readJsonSafe(path.join(state.rootDir, 'WebGames', 'reports', 'audit-latest.json'));
  const summary = wgData?.summary;
  if (summary) {
    if (Number(summary.checks) > 0) {
      const passChecksWg = Number(summary.byStatus?.PASS || 0);
      const totalChecksWg = Number(summary.checks);
      const jeffreysMeanWg = (passChecksWg + 0.5) / (totalChecksWg + 1.0);
      const warnWg = Number(summary.bySeverity?.warning || 0);
      const errWg = Number(summary.bySeverity?.error || 0);
      const rawWg = THEORETICAL_SCORE_CEILING * jeffreysMeanWg - warnWg * 0.035 - errWg * 5.0;
      configScore = Math.max(
        SCORE_FLOOR,
        Math.min(THEORETICAL_SCORE_CEILING, Number(rawWg.toFixed(1))),
      );
    } else if (typeof summary.compositeScore === 'number' && summary.compositeScore > 0) {
      configScore = Math.max(
        SCORE_FLOOR,
        Math.min(THEORETICAL_SCORE_CEILING, Number(summary.compositeScore.toFixed(1))),
      );
    }
  }

  let baseWg = SCORE_FLOOR;
  if (gdScore === null || configScore === null) {
    state.statusWg = 'BLOCK';
    state.failed = true;
  } else {
    baseWg = Math.min(
      THEORETICAL_SCORE_CEILING,
      Number((0.8 * gdScore + 0.2 * configScore).toFixed(1)),
    );
  }
  return state.statusWg === 'PASS' ? baseWg : Math.max(SCORE_FLOOR, Number((baseWg - 60.0).toFixed(1)));
}

/**
 * Evaluates Pillar 6 (fractal-git) score from live audit-latest.json telemetry.
 *
 * @param {object} state - Mutable runner state.
 * @returns {number} Clamped fractal-git pillar score.
 */
function evaluateFractalGitScore(state) {
  let baseFg = null;
  const fgData = readJsonSafe(path.join(state.rootDir, 'fractal-git', 'reports', 'audit-latest.json'));
  const summary = fgData?.summary;
  if (summary) {
    if (typeof summary.compositeScore === 'number' && summary.compositeScore > 0) {
      baseFg = Number(summary.compositeScore.toFixed(2));
    } else if (typeof fgData.qualityEnvelope?.composite_score === 'number') {
      baseFg = Number(fgData.qualityEnvelope.composite_score.toFixed(2));
    } else if (Number(summary.checks) > 0) {
      const ratioFg = Number(summary.byStatus?.PASS || 0) / Number(summary.checks);
      const warnFg = Number(summary.bySeverity?.warning || 0);
      const errFg = Number(summary.bySeverity?.error || 0);
      const credibleFg = summary.bayesianConfidence?.credibleScore;
      const baseline = typeof credibleFg === 'number' ? credibleFg : 100.0 * ratioFg;
      baseFg = Math.max(SCORE_FLOOR, Number((baseline - warnFg * 0.035 - errFg * 5.0).toFixed(1)));
    }
  }

  if (baseFg === null) {
    state.statusFg = 'BLOCK';
    state.failed = true;
    baseFg = SCORE_FLOOR;
  }
  return state.statusFg === 'PASS' ? baseFg : Math.max(SCORE_FLOOR, Number((baseFg - 60.0).toFixed(1)));
}

/**
 * Computes a single blended 10-dimensional fallback score for a dimension key.
 *
 * @param {string} dimKey - Canonical dimension identifier.
 * @param {object} scores - Pillar and polyglot scores.
 * @returns {number} Blended dimension score.
 */
function computeBlendedDimScore(dimKey, scores) {
  const { scoreHygiene, scoreRules, scoreAr, scoreWt, scoreWg, scoreFg, polyglotIndex } = scores;
  const weights = {
    codeSecurity: scoreAr * 0.65 + scoreFg * 0.35,
    architectureConsistency: scoreAr * 0.35 + scoreRules * 0.25 + scoreWg * 0.2 + scoreFg * 0.2,
    performanceEfficiency: scoreAr * 0.4 + scoreWg * 0.35 + scoreFg * 0.25,
    maintainability: scoreAr * 0.45 + scoreWt * 0.3 + scoreHygiene * 0.25,
    standardization: scoreHygiene * 0.45 + scoreRules * 0.3 + scoreAr * 0.25,
    modernity: scoreAr * 0.5 + (polyglotIndex != null ? polyglotIndex : scoreAr) * 0.5,
    semanticPurity: scoreAr * 0.6 + scoreWt * 0.4,
    duplication: scoreAr * 0.65 + scoreHygiene * 0.35,
    commentQuality: scoreAr * 0.6 + scoreWt * 0.4,
    techDebtRisk: scoreAr * 0.4 + scoreWg * 0.3 + scoreFg * 0.3,
  };
  const raw = weights[dimKey] !== undefined ? weights[dimKey] : scoreAr;
  return Math.round(raw * 10) / 10;
}

/**
 * Projects the 10-dimensional quality vector across all workspace pillars.
 *
 * @param {object|null} baseDims - Raw tenDimensions from auto-refactor baseline.
 * @param {object} scores - Pillar scores and failure state.
 * @returns {object} Normalized 10-dimension score map.
 */
function computeDynamicDimensions(baseDims, scores) {
  const dynamicDimensions = {};
  for (const d of DIM_DEFINITIONS) {
    const rawVal = baseDims ? baseDims[d.key] : null;
    const baseVal = typeof rawVal === 'number' && !Number.isNaN(rawVal) && rawVal > 0 ? Number(rawVal) : null;
    let dimScore = computeBlendedDimScore(d.key, scores);
    if (baseVal !== null) {
      dimScore = scores.failed ? Math.min(baseVal, dimScore) : baseVal;
    }
    dynamicDimensions[d.key] = Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, dimScore));
  }
  return dynamicDimensions;
}

/**
 * Formats a numeric score into a bracketed letter grade tag.
 *
 * @param {number} score - Score on [0, 100].
 * @returns {string} Bracketed grade tag (e.g. '[A+]').
 */
function getGradeTag(score) {
  const thresholds = [
    [95.0, '[A+]'],
    [90.0, '[A ]'],
    [85.0, '[B+]'],
    [80.0, '[B ]'],
    [75.0, '[C+]'],
    [70.0, '[C ]'],
    [60.0, '[D ]'],
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
    [0x2e80, 0x2fff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
    [0xff01, 0xff60],
    [0xffe0, 0xffe6],
    [0x1f300, 0x1f9ff],
    [0x20000, 0x2a6df],
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
 * Renders the terminal Unicode box dashboard for interactive/CI logs.
 *
 * @param {object} summary - Computed workspace summary payload.
 * @param {string} elapsedSec - Formatted elapsed seconds string.
 * @returns {void}
 */
function renderConsoleDashboard(summary, elapsedSec) {
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
  renderTenDimensionsRows(summary.tenDimensions, summary.arCompositeScore);
  console.log(borderMid);

  const globalStatus = summary.status === 'BLOCK' ? '🔴 存在违规异常' : '🟢 全域质量达标';
  const debtPart = summary.totalDebt !== null ? `  |  技术债: ${summary.totalDebt}项` : '';
  console.log(formatDashboardRow(` 耗时: ${elapsedSec}s${debtPart}  |  全局状态: ${globalStatus}`));
  console.log(borderBot);
  console.log('💡 统一审查快照已落盘至: .audit-logs/audit-latest.json | audit-latest.aas.json | audit-latest.md');
  console.log('💡 质量历史轨迹已追加至: .audit-logs/audit-history.jsonl');
}

/**
 * Prints the 10-dimensional quality rows inside the console dashboard.
 *
 * @param {object|null} tenDimensions - Ten-dimension score map.
 * @param {number|null} arCompositeScore - Raw auto-refactor composite score.
 * @returns {void}
 */
function renderTenDimensionsRows(tenDimensions, arCompositeScore) {
  if (!tenDimensions || arCompositeScore === null) {
    console.log(formatDashboardRow(' [离线基线快照未就绪 - 优雅降级模式]'));
    return;
  }
  for (const d of DIM_DEFINITIONS) {
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
 * Formats the 10-dimensional Markdown section for GITHUB_STEP_SUMMARY.
 *
 * @param {object|null} tenDimensions - Ten-dimension score map.
 * @param {number|null} arCompositeScore - Raw auto-refactor composite score.
 * @returns {string} Markdown table or fallback note.
 */
function formatStepSummaryTenDimensions(tenDimensions, arCompositeScore) {
  if (!tenDimensions || arCompositeScore === null) {
    return '> ⚠️ [离线基线快照未就绪 - 优雅降级模式]\n\n';
  }
  let md = '| 序号 | 质量维度 | 得分 | 进度可视化 |\n| :---: | :--- | :---: | :--- |\n';
  for (const d of DIM_DEFINITIONS) {
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
 * @returns {void}
 */
function appendGithubStepSummary(summaryFile, summary, elapsedSec) {
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
  md += formatStepSummaryTenDimensions(summary.tenDimensions, summary.arCompositeScore);
  try {
    fs.appendFileSync(summaryFile, md, 'utf8');
  } catch (_) {
    // Ignore step summary write error outside CI runners.
  }
}

/**
 * Samples quantitative telemetry metrics and records audit + trajectory runs.
 *
 * @param {string} rootDir - Workspace repository root.
 * @param {object} summary - Mutable workspace summary object.
 * @param {boolean} commitLedger - Whether to commit trajectory ledger.
 * @returns {void}
 */
function enrichAndPersistAuditSummary(rootDir, summary, commitLedger) {
  const failed = summary.status === 'BLOCK';
  const quantScript = path.join(rootDir, 'scripts', 'common', 'evaluate-workspace-quant.js');
  if (fs.existsSync(quantScript)) {
    try {
      const quantArgs = [quantScript, '--json'];
      if (failed) quantArgs.push('--blocked');
      const quantOut = execFileSync(process.execPath, quantArgs, { cwd: rootDir, encoding: 'utf8' });
      if (quantOut && quantOut.trim()) {
        summary.quant = JSON.parse(quantOut);
      }
    } catch (_) {
      summary.quant = null;
    }
  }

  try {
    const { recordAuditRun } = require(path.join(rootDir, 'scripts', 'common', 'record-workspace-audit.js'));
    recordAuditRun(summary);
  } catch (_) {
    // Audit log persistence failure does not mask gate verdict.
  }

  const trajScript = path.join(rootDir, 'scripts', 'common', 'record-workspace-trajectory.js');
  if (fs.existsSync(trajScript)) {
    try {
      const trajArgs = [trajScript];
      if (failed) trajArgs.push('--failed');
      if (commitLedger) trajArgs.push('--commit-ledger');
      execFileSync(process.execPath, trajArgs, { cwd: rootDir, stdio: 'ignore' });
    } catch (_) {
      // Trajectory persistence failure does not mask gate verdict.
    }
  }
}

/**
 * Builds the AAS v1.0 envelope for `--agent` CLI consumers.
 *
 * @param {object} summary - Workspace audit summary.
 * @returns {object} AAS v1.0 JSON envelope.
 */
function buildAgentEnvelope(summary) {
  const pj = summary.projects;
  const failedSubsystems = [];
  if (pj.hygiene !== 'PASS') failedSubsystems.push('hygiene');
  if (pj.rulesCatalog !== 'PASS') failedSubsystems.push('rules');
  if (pj.autoRefactor !== 'PASS') failedSubsystems.push('auto-refactor');
  if (pj.workspaceTiming !== 'PASS') failedSubsystems.push('workspace-timing');
  if (pj.webGames !== 'PASS') failedSubsystems.push('WebGames');
  if (pj.fractalGit !== 'PASS') failedSubsystems.push('fractal-git');

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
      verificationCommand: 'bash scripts/sh/audit-all.sh --fast',
      fastRecheckCommand: 'bash scripts/sh/audit-all.sh --fast',
    },
  };
}

/**
 * Entry point orchestrating 6-pillar scoring, persistence, and dashboard rendering.
 *
 * @returns {void}
 */
function main() {
  const argv = [process.argv[0], ...process.argv.slice(2)];
  const state = parseCliInputs(argv);
  const elapsedSec = ((Date.now() - state.startTime) / 1000).toFixed(2);

  const arBase = loadAutoRefactorBaseline(state.rootDir);
  const scoreHygiene = evaluateHygieneScore(state);

  const catalogObj = readJsonSafe(path.join(state.rootDir, 'scripts', 'common', 'rule-catalog.json'));
  const catalogRuleCount = Number(catalogObj?.totalRules || 0);
  const { polyglotIndex, polyglotBreakdown } = samplePolyglotMetrics(state.rootDir, state.fastMode);

  const catalogCountConsistent = state.codeCatalog === 0;
  const rulesPassedCount = state.ruleCodes.filter((c) => c === 0).length;
  const ruleStepTotal = Math.max(1, state.ruleCodes.length);
  const stepPosterior = (rulesPassedCount + 0.5) / (ruleStepTotal + 1.0);
  const catalogPosterior =
    catalogCountConsistent && catalogRuleCount > 0
      ? (catalogRuleCount + 0.5) / (catalogRuleCount + 1.0)
      : 0.5;
  const rawRulesScore = THEORETICAL_SCORE_CEILING * (0.7 * stepPosterior + 0.3 * catalogPosterior);
  const scoreRules =
    state.statusRules === 'PASS' && catalogCountConsistent
      ? Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, Number(rawRulesScore.toFixed(1))))
      : Math.max(SCORE_FLOOR, Number((rawRulesScore - 60.0).toFixed(1)));

  let baseAr = arBase.compositeScore !== null ? Number(arBase.compositeScore) : null;
  if (baseAr === null) {
    state.statusAr = 'BLOCK';
    state.failed = true;
    baseAr = SCORE_FLOOR;
  }
  const scoreAr =
    state.statusAr === 'PASS'
      ? Math.min(THEORETICAL_SCORE_CEILING, baseAr)
      : Math.max(SCORE_FLOOR, Number((baseAr - 60.0).toFixed(1)));
  const scoreWt = Math.min(THEORETICAL_SCORE_CEILING, evaluateWorkspaceTimingScore(state));
  const scoreWg = Math.min(THEORETICAL_SCORE_CEILING, evaluateWebGamesScore(state, polyglotBreakdown));
  const scoreFg = Math.min(THEORETICAL_SCORE_CEILING, evaluateFractalGitScore(state));

  const weightedLogSum =
    0.1 * Math.log(Math.max(SCORE_FLOOR, scoreHygiene)) +
    0.1 * Math.log(Math.max(SCORE_FLOOR, scoreRules)) +
    0.25 * Math.log(Math.max(SCORE_FLOOR, scoreAr)) +
    0.2 * Math.log(Math.max(SCORE_FLOOR, scoreWt)) +
    0.2 * Math.log(Math.max(SCORE_FLOOR, scoreWg)) +
    0.15 * Math.log(Math.max(SCORE_FLOOR, scoreFg));
  const rawGeometric = Math.exp(weightedLogSum);
  const minCorner = Math.min(scoreHygiene, scoreRules, scoreAr, scoreWt, scoreWg, scoreFg);
  const damping = minCorner < 70.0 ? Math.max(0.5, minCorner / 70.0) : 1.0;
  const workspaceHealthScore = Math.min(
    THEORETICAL_SCORE_CEILING,
    Number((rawGeometric * damping).toFixed(2)),
  );
  const wsGrade = getGradeTag(workspaceHealthScore).replace('[', '').replace(']', '').trim();

  const tenDimensions = computeDynamicDimensions(arBase.tenDimensions, {
    scoreHygiene,
    scoreRules,
    scoreAr,
    scoreWt,
    scoreWg,
    scoreFg,
    polyglotIndex,
    failed: state.failed,
  });

  let gitRevision = '00000000';
  try {
    gitRevision = execSync('git rev-parse --short HEAD', { cwd: state.rootDir, encoding: 'utf8' }).trim().slice(0, 8);
  } catch (_) {
    gitRevision = '00000000';
  }

  const summary = {
    protocolVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    gitRevision,
    fastMode: state.fastMode,
    status: state.failed ? 'BLOCK' : 'PASS',
    exitCode: state.failed ? 1 : 0,
    elapsedSeconds: Number(elapsedSec),
    workspaceHealthScore,
    compositeScore: workspaceHealthScore,
    grade: wsGrade,
    autonomyRate: arBase.autonomyRate != null ? Number(arBase.autonomyRate) : null,
    polyglotIndex: polyglotIndex != null ? Number(polyglotIndex) : null,
    polyglotBreakdown,
    totalDebt: arBase.totalDebt != null ? Number(arBase.totalDebt) : null,
    catalogRuleCount: catalogRuleCount || null,
    catalogCountConsistent,
    projects: {
      hygiene: state.statusHygiene,
      rulesCatalog: state.statusRules,
      autoRefactor: state.statusAr,
      workspaceTiming: state.statusWt,
      webGames: state.statusWg,
      fractalGit: state.statusFg,
    },
    projectScores: {
      hygiene: scoreHygiene,
      rulesCatalog: scoreRules,
      autoRefactor: scoreAr,
      workspaceTiming: scoreWt,
      webGames: scoreWg,
      fractalGit: scoreFg,
    },
    arCompositeScore: arBase.compositeScore,
    tenDimensions,
    qualityVector: tenDimensions,
    quant: null,
  };

  enrichAndPersistAuditSummary(state.rootDir, summary, state.commitLedger);

  if (state.jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(state.failed ? 1 : 0);
  }
  if (state.agentMode) {
    console.log(JSON.stringify(buildAgentEnvelope(summary), null, 2));
    process.exit(state.failed ? 1 : 0);
  }

  renderConsoleDashboard(summary, elapsedSec);
  appendGithubStepSummary(process.env.GITHUB_STEP_SUMMARY, summary, elapsedSec);
  process.exit(state.failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  DIM_DEFINITIONS,
  computeDynamicDimensions,
  getGradeTag,
  strWidth,
  makeBar,
};
