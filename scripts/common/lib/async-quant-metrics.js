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
  const idx = report?.governance?.tenDimensions || qs.indices || {};
  const dims = {};
  let evaluatedCount = 0;
  for (const key of TEN_DIM_KEYS) {
    if (idx[key] !== undefined && idx[key] !== null && Number.isFinite(Number(idx[key]))) {
      evaluatedCount += 1;
    }
    dims[key] = firstFinite([idx[key]], DEFAULT_DIMENSION_SCORE);
  }
  dims.compositeScore = firstFinite(
    [report?.governance?.hierarchicalCompositeScore, qs.compositeScore],
    DEFAULT_DIMENSION_SCORE,
  );
  dims.grade = String(report?.governance?.grade || qs.grade || 'A+');
  dims.evaluatedDimensions = evaluatedCount;
  return dims;
}

async function readOptionalQuantSources(repoRoot) {
  let wsQuant = null;
  let polyglot = null;
  try {
    wsQuant = evaluateWorkspaceQuant(repoRoot);
  } catch (err) {
    wsQuant = { error: err instanceof Error ? err.message : String(err) };
  }
  try {
    polyglot = await evaluateWorkspacePolyglotBalance({ fast: true });
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
 * @returns {Promise<object>} Closed QuantMetrics payload matching `quality-evidence.schema.json`.
 */
async function buildQuantMetrics(repoRoot, report, tenDimensions) {
  const qs = report && report.qualityScore ? report.qualityScore : {};
  const debt = qs.technicalDebt || {};
  const reportQuant = qs.quant || {};
  const { wsQuant, polyglot } = await readOptionalQuantSources(repoRoot);

  const fin = reportQuant.financial || {};
  const risk = reportQuant.riskRatios || {};
  const ineq = reportQuant.inequality || {};
  const stoch = reportQuant.stochastic || {};

  const deficitMins = Number.isFinite(Number(fin.deficitStockHours))
    ? Number(fin.deficitStockHours) * MINUTES_PER_HOUR
    : 0;
  const sqaleMinutes = firstFinite([debt.totalRemediationMinutes, deficitMins], 0);
  const tdr = firstFinite([debt.technicalDebtRatio], 0);
  const polyglotIndex = firstFinite(
    [qs.polyglotGeneralization?.index, polyglot?.polyglotIndex, polyglot?.index, tenDimensions.compositeScore],
    tenDimensions.compositeScore,
  );
  const autonomyRate = computeAutonomyRate(report);

  return {
    rcr: firstFinite([wsQuant?.rcr, fin.rcr, fin.interestCoverageRatio], 0.0),
    erq: firstFinite([wsQuant?.erq, risk.erq, risk.qsr], 0),
    ddr: firstFinite([wsQuant?.ddr, risk.ddr, risk.sortino], 0),
    edb95: firstFinite([wsQuant?.edb95, risk.edb95, risk.var95], 0),
    ptd: firstFinite([wsQuant?.ptd, risk.ptd, risk.mdd], 0),
    dsi: firstFinite([wsQuant?.dsi, ineq.dsi, ineq.debtGini], 0),
    rcd: firstFinite([wsQuant?.rcd, ineq.rcd, ineq.defectEntropy], 0),
    ehl: firstFinite([wsQuant?.ehl, stoch.ehl, stoch.halfLifeCommits], 0),
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
