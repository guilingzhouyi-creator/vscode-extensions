/**
 * Module: Workspace Async Governance — 10D, SQALE & ADR-Q Metric Extractor
 * File Path: scripts/common/lib/async-quant-metrics.js
 * Architecture Role: Normalizes ScanReport telemetry, workspace SQALE/ADR-Q quantitative models,
 *   and polyglot balance scores into the closed `quality-evidence.schema.json` structure.
 * Dependencies & Triggers: ../evaluate-workspace-quant and ../evaluate-polyglot-balance; invoked
 *   on every async snapshot review cycle by ../async-auto-audit-daemon.js.
 * Responsibilities:
 *   1. Extract normalized 10-dimension quality scores (`extractTenDimensions`);
 *   2. Safely sample optional workspace ADR-Q and polyglot balance estimators without throwing;
 *   3. Assemble complete 14-field `QuantMetrics` matching Taxis kernel output semantics.
 * Exit Semantics & Design Rationale: Pure deterministic projection with table-driven fallbacks,
 *   keeping cyclomatic complexity minimal while guaranteeing zero-padded finite numbers.
 */
'use strict';

const { evaluateWorkspaceQuant } = require('../evaluate-workspace-quant');
const { evaluateWorkspacePolyglotBalance } = require('../evaluate-polyglot-balance');

const TEN_DIM_KEYS = Object.freeze([
  'architectureConsistency',
  'semanticPurity',
  'codeSecurity',
  'performanceEfficiency',
  'standardization',
  'modernity',
  'maintainability',
  'commentQuality',
  'duplication',
  'techDebtRisk',
]);

const DEFAULT_DIMENSION_SCORE = 100;
const DEFAULT_CONFIDENCE = 0.8;
const MINUTES_PER_HOUR = 60;

/** Pick the first finite numeric candidate from a list or return zero. */
function firstFinite(candidates, fallback = 0) {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && Number.isFinite(Number(candidate))) {
      return Number(candidate);
    }
  }
  return fallback;
}

/**
 * Extract normalized TenDimensions block matching `quality-evidence.schema.json`.
 *
 * @param {object} report - ScanReport returned by auto-refactor snapshot scan.
 * @returns {object} Closed TenDimensions payload.
 */
function extractTenDimensions(report) {
  const qs = report && report.qualityScore ? report.qualityScore : {};
  const idx = qs.indices || {};
  const dims = {};
  for (const key of TEN_DIM_KEYS) {
    dims[key] = firstFinite([idx[key]], DEFAULT_DIMENSION_SCORE);
  }
  dims.compositeScore = firstFinite([qs.compositeScore], DEFAULT_DIMENSION_SCORE);
  dims.grade = String(qs.grade || 'A+');
  return dims;
}

function readOptionalQuantSources(repoRoot) {
  let wsQuant = null;
  let polyglot = null;
  try {
    wsQuant = evaluateWorkspaceQuant({ root: repoRoot });
  } catch (err) {
    wsQuant = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    polyglot = evaluateWorkspacePolyglotBalance({ root: repoRoot });
  } catch (err) {
    polyglot = { error: err instanceof Error ? err.message : String(err) };
  }
  return { wsQuant, polyglot };
}

function computeAutonomyRate(report) {
  const autonomyObj = report && report.autonomy ? report.autonomy : null;
  if (autonomyObj && Number.isFinite(Number(autonomyObj.cai))) {
    return Math.max(0, Math.min(1, Number(autonomyObj.cai)));
  }
  const summary = report?.summary || {};
  const totalIssues = Number(summary.issuesTotal || 0);
  if (totalIssues === 0) return 1.0;
  const issuesError = Number(summary.bySeverity?.error || 0);
  return Math.max(0, Math.min(1, 1 - issuesError / (totalIssues + 1)));
}

/**
 * Assemble normalized QuantMetrics combining snapshot scoring with workspace ADR-Q and polyglot balance.
 *
 * @param {string} repoRoot - Repository root directory.
 * @param {object} report - ScanReport from snapshot scan.
 * @param {object} tenDimensions - Extracted 10D breakdown.
 * @returns {object} Closed QuantMetrics payload matching `quality-evidence.schema.json`.
 */
function buildQuantMetrics(repoRoot, report, tenDimensions) {
  const qs = report && report.qualityScore ? report.qualityScore : {};
  const debt = qs.technicalDebt || {};
  const reportQuant = qs.quant || {};
  const { wsQuant, polyglot } = readOptionalQuantSources(repoRoot);

  const fin = wsQuant?.financial || reportQuant.financial || {};
  const risk = wsQuant?.riskRatios || reportQuant.riskRatios || {};
  const ineq = wsQuant?.inequality || reportQuant.inequality || {};
  const stoch = wsQuant?.stochastic || reportQuant.stochastic || {};

  const deficitMins = Number.isFinite(Number(fin.deficitStockHours))
    ? Number(fin.deficitStockHours) * MINUTES_PER_HOUR
    : 0;
  const sqaleMinutes = firstFinite([debt.totalRemediationMinutes, deficitMins], 0);
  const tdr = firstFinite([debt.technicalDebtRatio], 0);
  const polyglotIndex = firstFinite(
    [qs.polyglotGeneralization?.index, polyglot?.index, tenDimensions.compositeScore],
    tenDimensions.compositeScore,
  );
  const autonomyRate = computeAutonomyRate(report);

  return {
    rcr: firstFinite([fin.rcr, fin.interestCoverageRatio], 0.0),
    erq: firstFinite([risk.erq, risk.qsr], 0),
    ddr: firstFinite([risk.ddr, risk.sortino], 0),
    edb95: firstFinite([risk.edb95, risk.var95], 0),
    ptd: firstFinite([risk.ptd, risk.mdd], 0),
    dsi: firstFinite([ineq.dsi, ineq.debtGini], 0),
    rcd: firstFinite([ineq.rcd, ineq.defectEntropy], 0),
    ehl: firstFinite([stoch.ehl, stoch.halfLifeCommits], 0),
    workspaceHealthScore: Number(tenDimensions.compositeScore),
    autonomyRate: Number(autonomyRate.toFixed(4)),
    polyglotIndex: Number(polyglotIndex.toFixed(2)),
    sqaleMinutes: Number(sqaleMinutes.toFixed(2)),
    tdr: Number(tdr.toFixed(4)),
    confidence: firstFinite([qs.confidence], DEFAULT_CONFIDENCE),
  };
}

module.exports = {
  extractTenDimensions,
  buildQuantMetrics,
};
