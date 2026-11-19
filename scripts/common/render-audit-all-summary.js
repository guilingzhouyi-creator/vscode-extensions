/**
 * Module: Unified Workspace Audit Summary & Dashboard Renderer
 * File Path: scripts/common/render-audit-all-summary.js
 * Architecture Role: Aggregates 6-pillar gate verdicts, live subproject audit telemetry,
 *   10-dimensional quality vectors, and polyglot balance indices for audit-all.sh and audit-all.ps1.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process) and
 *   scripts/common/{evaluate-polyglot-balance,evaluate-workspace-quant,record-workspace-audit,record-workspace-trajectory}.js;
 *   invoked at the conclusion of scripts/sh/audit-all.sh and scripts/ps1/audit-all.ps1.
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
const { buildEloc5dSummary } = require('./lib/workspace-eloc-rollup');
const { PILLAR2_GUARDS } = require('./run-workspace-guards');
const {
  getGradeTag, strWidth, makeBar, renderConsoleDashboard, appendGithubStepSummary, buildAgentEnvelope,
} = require('./lib/audit-summary-renderers');

const SCORE_FLOOR = 15.0;
const THEORETICAL_SCORE_CEILING = 99.75;

const TEN_DIM_SPECS = Object.freeze([
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
 * Formats a dimension ordinal string into fixed 3-character box prefix (e.g. ' 1.' or '10.').
 *
 * @param {string|number} rawNum - Ordinal number or label.
 * @param {number} idx - Zero-based dimension index.
 * @returns {string} Padded ordinal string.
 */
function normalizeDimNum(rawNum, idx) {
  const base = String(rawNum != null ? rawNum : `${idx + 1}.`).trim();
  const withDot = base.endsWith('.') ? base : `${base}.`;
  return withDot.length < 3 ? ` ${withDot}` : withDot;
}

/**
 * Loads the 10-dimension specification from `ten-dimensions-contract.json` with safe fallback.
 *
 * @returns {ReadonlyArray<object>} Frozen 10-dimension descriptor list.
 */
function loadDimDefinitions() {
  let contract = null;
  try {
    contract = require('./ten-dimensions-contract.json');
  } catch (_) {
    contract = null;
  }
  if (!contract || !Array.isArray(contract.dimensions) || contract.dimensions.length !== 10) {
    return TEN_DIM_SPECS;
  }
  return Object.freeze(
    contract.dimensions.map((d, idx) => {
      const zhName = d.name || d.zhName || TEN_DIM_SPECS[idx].name;
      const enName = d.enName || '';
      return {
        num: normalizeDimNum(d.num, idx),
        name: zhName,
        key: d.key || TEN_DIM_SPECS[idx].key,
        desc: d.desc || d.shortDesc || TEN_DIM_SPECS[idx].desc,
        labelEn: d.labelEn || (enName ? `${zhName} (${enName})` : TEN_DIM_SPECS[idx].labelEn),
      };
    }),
  );
}

const DIM_DEFINITIONS = loadDimDefinitions();

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

const STATUS_FIELD_MAP = Object.freeze([
  ['statusHygiene', 'hygiene'],
  ['statusRules', 'rules'],
  ['statusAr', 'ar'],
  ['statusWt', 'wt'],
  ['statusWg', 'wg'],
  ['statusFg', 'fg'],
]);

const CODE_FIELD_MAP = Object.freeze([
  ['codeHygiene', 'hygiene'],
  ['codeIso', 'iso'],
  ['codeGi', 'gi'],
  ['codeDensity', 'density'],
  ['codeEloc', 'eloc'],
]);

/**
 * Resolves ordered Pillar-2 exit codes from structured `--input` JSON payload.
 *
 * @param {object} payload - Parsed JSON payload from `--input`.
 * @returns {number[]} Ordered guard exit codes.
 */
function resolveRuleCodesFromPayload(payload) {
  if (Array.isArray(payload.ruleCodes) && payload.ruleCodes.length > 0) {
    return payload.ruleCodes.map((c) => Number(c) || 0);
  }
  if (payload.guardResults && typeof payload.guardResults === 'object') {
    return PILLAR2_GUARDS.map((guard) => {
      const entry = payload.guardResults[guard.id];
      const raw = entry && typeof entry === 'object' ? entry.exitCode : entry;
      return Number(raw) || 0;
    });
  }
  const codes = payload.codes || {};
  return ['catalog', 'skills']
    .filter((key) => codes[key] !== undefined && codes[key] !== null)
    .map((key) => Number(codes[key]) || 0);
}

/**
 * Normalizes pillar status verdicts from `--input` JSON payload.
 *
 * @param {object} payload - Parsed JSON payload.
 * @returns {object} Legacy status fields.
 */
function resolveStatusesFromPayload(payload) {
  const src = payload.statuses || {};
  const out = {};
  for (const [legacyKey, key] of STATUS_FIELD_MAP) {
    out[legacyKey] = src[key] || payload[legacyKey] || 'PASS';
  }
  return out;
}

/**
 * Normalizes Pillar-1 and catalog exit codes from `--input` JSON payload.
 *
 * @param {object} payload - Parsed JSON payload.
 * @param {number[]} ruleCodes - Resolved Pillar-2 exit codes.
 * @returns {object} Normalized numeric exit codes.
 */
function resolveCodesFromPayload(payload, ruleCodes) {
  const src = payload.codes || {};
  const out = {};
  for (const [legacyKey, key] of CODE_FIELD_MAP) {
    const raw = src[key] !== undefined ? src[key] : payload[legacyKey];
    out[legacyKey] = Number(raw) || 0;
  }
  const catalogRaw = src.catalog !== undefined ? src.catalog : (payload.codeCatalog !== undefined ? payload.codeCatalog : ruleCodes[0]);
  out.codeCatalog = Number(catalogRaw) || 0;
  return out;
}

/**
 * Parses structured `--input` JSON payload into internal runner state.
 *
 * @param {object} payload - Parsed JSON payload from audit-all runner.
 * @returns {object} Structured audit runner state and step exit codes.
 */
function parseInputJsonPayload(payload) {
  const ruleCodes = resolveRuleCodesFromPayload(payload);
  return {
    startTime: Number(payload.startTime) || Date.now(),
    failed: Boolean(payload.failed),
    jsonMode: Boolean(payload.jsonMode),
    fastMode: Boolean(payload.fastMode),
    agentMode: Boolean(payload.agentMode),
    commitLedger: Boolean(payload.commitLedger),
    runner: payload.runner === 'ps1' ? 'ps1' : 'sh',
    rootDir: payload.rootDir || process.cwd(),
    hygieneReportFile: payload.hygieneReportFile || '',
    ...resolveStatusesFromPayload(payload),
    ...resolveCodesFromPayload(payload, ruleCodes),
    ruleCodes,
  };
}

/**
 * Loads runner state from `--input <jsonFile>` or falls back to legacy positional arguments.
 *
 * @param {string[]} cliArgs - Raw CLI arguments excluding node executable and script path.
 * @returns {object} Structured audit runner state and step exit codes.
 */
function loadRunnerState(cliArgs) {
  const inputIdx = cliArgs.indexOf('--input');
  if (inputIdx === -1) {
    return parseCliInputs([process.argv[0], ...cliArgs]);
  }
  const inputPath = cliArgs[inputIdx + 1];
  if (!inputPath || inputPath.startsWith('--')) {
    throw new Error('--input requires a JSON file path');
  }
  const absPath = path.resolve(inputPath);
  const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object in --input file: ${inputPath}`);
  }
  return parseInputJsonPayload(parsed);
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
    runner: argv[43] === 'ps1' ? 'ps1' : 'sh',
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
    const wtReport = readJsonSafe(path.join(state.rootDir, 'workspace-timing', 'reports', 'review', 'report-latest.json'));
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
      configScore = Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, Number(rawWg.toFixed(1))));
    } else if (typeof summary.compositeScore === 'number' && summary.compositeScore > 0) {
      configScore = Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, Number(summary.compositeScore.toFixed(1))));
    }
  }

  let baseWg = SCORE_FLOOR;
  if (gdScore === null || configScore === null) {
    state.statusWg = 'BLOCK';
    state.failed = true;
  } else {
    baseWg = Math.min(THEORETICAL_SCORE_CEILING, Number((0.8 * gdScore + 0.2 * configScore).toFixed(1)));
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
 * Computes damped Pillar-2 rules and catalog consistency score.
 *
 * @param {object} state - Normalized runner state.
 * @param {number} catalogRuleCount - Observed rule catalog count.
 * @param {boolean} catalogCountConsistent - Whether catalog matches rule-sources.
 * @returns {number} Bounded rules score.
 */
function computeRulesCatalogScore(state, catalogRuleCount, catalogCountConsistent) {
  const rulesPassedCount = state.ruleCodes.filter((c) => c === 0).length;
  const ruleStepTotal = Math.max(1, state.ruleCodes.length);
  const stepPosterior = (rulesPassedCount + 0.5) / (ruleStepTotal + 1.0);
  const catalogPosterior = catalogCountConsistent && catalogRuleCount > 0
    ? (catalogRuleCount + 0.5) / (catalogRuleCount + 1.0) : 0.5;
  const rawRulesScore = THEORETICAL_SCORE_CEILING * (0.7 * stepPosterior + 0.3 * catalogPosterior);
  return state.statusRules === 'PASS' && catalogCountConsistent
    ? Math.max(SCORE_FLOOR, Math.min(THEORETICAL_SCORE_CEILING, Number(rawRulesScore.toFixed(1))))
    : Math.max(SCORE_FLOOR, Number((rawRulesScore - 60.0).toFixed(1)));
}

/**
 * Resolves the short HEAD revision hash with a zeroed fallback.
 *
 * @param {string} rootDir - Repository root directory.
 * @returns {string} 8-char short commit hash.
 */
function resolveGitRevision(rootDir) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim().slice(0, 8);
  } catch (_) {
    return '00000000';
  }
}

/**
 * Emits final JSON, AAS agent envelope, or terminal dashboard output and exits.
 *
 * @param {object} state - Normalized runner state.
 * @param {object} summary - Aggregated audit summary object.
 * @param {string} elapsedSec - Elapsed wall-clock seconds string.
 */
function emitAuditOutput(state, summary, elapsedSec) {
  const exitCode = state.failed ? 1 : 0;
  if (state.jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(exitCode);
  }
  if (state.agentMode) {
    console.log(JSON.stringify(buildAgentEnvelope(summary, state.runner), null, 2));
    process.exit(exitCode);
  }
  renderConsoleDashboard(summary, elapsedSec, DIM_DEFINITIONS);
  appendGithubStepSummary(process.env.GITHUB_STEP_SUMMARY, summary, elapsedSec, DIM_DEFINITIONS);
  process.exit(exitCode);
}

/**
 * Entry point orchestrating 6-pillar scoring, persistence, and dashboard rendering.
 *
 * @returns {void}
 */
function main() {
  let state;
  try {
    state = loadRunnerState(process.argv.slice(2));
  } catch (err) {
    console.error(`✖ BLOCK render-audit-all-summary: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
  }
  const elapsedSec = ((Date.now() - state.startTime) / 1000).toFixed(2);

  const arBase = loadAutoRefactorBaseline(state.rootDir);
  const scoreHygiene = evaluateHygieneScore(state);

  const catalogObj = readJsonSafe(path.join(state.rootDir, 'scripts', 'common', 'rule-catalog.json'));
  const catalogRuleCount = Number(catalogObj?.totalRules || 0);
  const { polyglotIndex, polyglotBreakdown } = samplePolyglotMetrics(state.rootDir, state.fastMode);

  const catalogCountConsistent = state.codeCatalog === 0;
  const scoreRules = computeRulesCatalogScore(state, catalogRuleCount, catalogCountConsistent);

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
  const workspaceHealthScore = Math.min(THEORETICAL_SCORE_CEILING, Number((rawGeometric * damping).toFixed(2)));
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

  const gitRevision = resolveGitRevision(state.rootDir);

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
    rawTenDimensions: arBase.tenDimensions || null,
    tenDimensions,
    qualityVector: tenDimensions,
    eloc5dSummary: buildEloc5dSummary(state.rootDir),
    quant: null,
  };

  enrichAndPersistAuditSummary(state.rootDir, summary, state.commitLedger);
  emitAuditOutput(state, summary, elapsedSec);
}

if (require.main === module) {
  main();
}

module.exports = {
  DIM_DEFINITIONS,
  loadDimDefinitions,
  parseInputJsonPayload,
  loadRunnerState,
  computeDynamicDimensions,
  getGradeTag,
  strWidth,
  makeBar,
};
