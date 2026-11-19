/**
 * Module: Gate Verification — Rust vs TS Parity Assertion Suite
 * File Path: scripts/common/lib/parity-assertions.js
 * Architecture Role: Houses quantitative 10-dimension, SQALE, ADR-Q, and critical-rule parity
 *   assertions executed by ../verify-rust-ts-parity.js.
 * Dependencies & Triggers: Pure Node.js standard runtime; called after both Taxis and Auto
 *   snapshot scans complete on golden clean and mixed fixtures.
 * Responsibilities:
 *   1. Maintain pass/fail assertion tally cleanly without ad-hoc global mutation;
 *   2. Verify 10D scores (`<= 0.05` delta), composite score, grade, and 10 quant metrics (`<= 1e-3`);
 *   3. Verify mixed-fixture rule ID detection parity, `codeSecurity` score, and SM3 receipt.
 * Exit Semantics & Design Rationale: Table-driven metric extraction keeps cyclomatic complexity low.
 */
'use strict';

const TEN_DIMENSIONS_CONTRACT = require('../ten-dimensions-contract.json');
const TEN_DIM_KEYS = Object.freeze(
  TEN_DIMENSIONS_CONTRACT.dimensions.map((dimension) => dimension.key),
);

const QUANT_METRIC_PATHS = Object.freeze([
  ['rcr', ['financial', 'rcr'], 0],
  ['erq', ['riskRatios', 'erq'], 0],
  ['ddr', ['riskRatios', 'ddr'], 0],
  ['edb95', ['riskRatios', 'edb95'], 0],
  ['ptd', ['riskRatios', 'ptd'], 0],
  ['dsi', ['inequality', 'dsi'], 0],
  ['rcd', ['inequality', 'rcd'], 0],
  ['ehl', ['stochastic', 'ehl'], 1],
]);

const REQUIRED_MIXED_PARITY_RULES = Object.freeze([
  'SEC-VUL-001',
  'TSM-ANY-001',
  'TSM-VAR-001',
  'CMT-DOC-001',
  'CPX-NEST-001',
  'RSM-UNWRAP-001',
  'RSM-PNC-001',
  'PYM-OPEN-001',
  'import-cycle',
]);

function readNested(root, pathParts, fallback) {
  let cursor = root;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object') return fallback;
    cursor = cursor[part];
  }
  return cursor === undefined || cursor === null ? fallback : cursor;
}

/** Create a scoped parity check recorder tracking passed vs total assertions. */
function createParityTracker() {
  let total = 0;
  let passed = 0;
  const assertCheck = (label, condition, detail = '') => {
    total++;
    if (condition) {
      passed++;
      console.log(`PASS  ${label}`);
    } else {
      console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`);
    }
  };
  return {
    assertCheck,
    summary: () => ({ passed, total }),
  };
}

/** Assert 10D, grade, SQALE, and ADR-Q numerical parity on the clean multi-language fixture. */
function verifyCleanParity(rustClean, tsClean, assertCheck) {
  assertCheck(
    'clean: zero findings in Rust and TS',
    rustClean.diagnostics.length === 0 && tsClean.report.issues.length === 0,
    `rust=${rustClean.diagnostics.length} ts=${tsClean.report.issues.length}`,
  );
  const rustDims = rustClean.ten_dimensions;
  const tsScore = tsClean.report.qualityScore || {};
  const tsDims = tsScore.indices || {};
  for (const key of TEN_DIM_KEYS) {
    const delta = Math.abs(Number(rustDims[key]) - Number(tsDims[key]));
    assertCheck(`clean 10D[${key}] delta <= 0.05`, delta <= 0.05, `delta=${delta.toFixed(4)}`);
  }
  const compDelta = Math.abs(Number(rustDims.compositeScore) - Number(tsScore.compositeScore));
  assertCheck('clean compositeScore delta <= 0.05', compDelta <= 0.05, `delta=${compDelta.toFixed(4)}`);
  assertCheck('clean grade matches TS', rustDims.grade === tsScore.grade, `${rustDims.grade} vs ${tsScore.grade}`);

  const rQuant = rustClean.quant_metrics;
  const tsQuant = tsScore.quant || {};
  const tsDebt = tsScore.technicalDebt || {};
  const pairs = [
    ...QUANT_METRIC_PATHS.map(([name, parts, fallback]) => [name, rQuant[name], readNested(tsQuant, parts, fallback)]),
    ['tdr', rQuant.tdr, tsDebt.technicalDebtRatio || 0],
    ['sqaleMinutes', rQuant.sqaleMinutes, tsDebt.totalRemediationMinutes || 0],
  ];
  for (const [metricName, rustVal, tsVal] of pairs) {
    const delta = Math.abs(Number(rustVal) - Number(tsVal));
    assertCheck(`clean quant[${metricName}] delta <= 1e-3`, delta <= 1e-3, `rust=${rustVal} ts=${tsVal}`);
  }
}

/** Assert critical defect rule parity, security dimension alignment, and SM3 receipt sealing. */
function verifyMixedParity(rustMixed, tsMixed, assertCheck) {
  const rustRules = new Set((rustMixed.diagnostics || []).map((item) => item.rule));
  const tsRules = new Set((tsMixed.report.issues || []).map((item) => item.ruleId || item.rule));
  for (const ruleId of REQUIRED_MIXED_PARITY_RULES) {
    assertCheck(
      `mixed rule parity: ${ruleId}`,
      rustRules.has(ruleId) && tsRules.has(ruleId),
      `rustHas=${rustRules.has(ruleId)} tsHas=${tsRules.has(ruleId)}`,
    );
  }
  const hasErrCatch =
    (rustRules.has('ERR-FLT-001') || rustRules.has('GOV-EXC-001')) &&
    (tsRules.has('ERR-FLT-001') || tsRules.has('GOV-EXC-001'));
  assertCheck('mixed error-swallow exception parity (ERR-FLT-001 / GOV-EXC-001)', hasErrCatch);

  const rustSec = Number(rustMixed.ten_dimensions?.codeSecurity);
  const tsSec = Number(tsMixed.report.qualityScore?.indices?.codeSecurity);
  assertCheck('mixed codeSecurity delta <= 0.05', Math.abs(rustSec - tsSec) <= 0.05, `rust=${rustSec} ts=${tsSec}`);
  assertCheck(
    'mixed receipt sealed with hmac-sm3 & blocked decision',
    rustMixed.decision === 'blocked' && rustMixed.receipt?.payload?.signatureAlgorithm === 'hmac-sm3',
    `decision=${rustMixed.decision}`,
  );
}

module.exports = {
  createParityTracker,
  verifyCleanParity,
  verifyMixedParity,
};
