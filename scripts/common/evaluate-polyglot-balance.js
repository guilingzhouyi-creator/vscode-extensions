/**
 * Module: Workspace Governance — Polyglot Balance Evaluator
 * File Path: scripts/common/evaluate-polyglot-balance.js
 * Architecture Role: Central quality assessment engine that audits multi-language stack
 *   equilibrium (TypeScript/JS, GDScript, Python, Shell, Rust) across the monorepo,
 *   applying logarithmic scale weighting and Gaussian dispersion penalty formulas.
 * Dependencies & Triggers: Consumes fs, path, auto-refactor API; invoked by audit-all.ps1,
 *   audit-all.sh, pre-commit gates, or standalone CLI.
 * Responsibilities:
 *   1. Survey real active multi-language source file and physical LOC distributions.
 *   2. Sample authentic, zero-injection quality scores for each stack language, prioritizing
 *      fresh subproject audit reports before historical workspace snapshots.
 *   3. Calculate smooth logarithmic weights w_i = ln(LOC_i + 10) over measured languages.
 *   4. Derive weighted mean, weighted standard deviation (dispersion), and damping penalty.
 *   5. Output mathematically rigorous, auditable polyglot balance metrics with null for unmeasured.
 * Exit Semantics & Design Rationale: Standalone CLI and programmatic module; zero fake scores.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const AUTO_REFACTOR_ROOT = path.join(REPO_ROOT, 'auto-refactor');
const AR_API_PATH = path.join(AUTO_REFACTOR_ROOT, 'dist/api.js');
const BASELINE_PATH = path.join(AUTO_REFACTOR_ROOT, 'reports/self-audit-baseline.json');
const AAS_BASELINE_PATH = path.join(AUTO_REFACTOR_ROOT, 'reports/self-audit-baseline.aas.json');
const SHELL_ISOMORPHISM_FLOOR = 15.0;
const SHELL_ISOMORPHISM_PENALTY = 30.0;

/**
 * Popoviciu's Inequality on Variances (Popoviciu, 1935):
 * For scores bounded in [0, 100], theoretical maximum standard deviation sigma_max = 50.0.
 */
const POPOVICIU_MAX_SIGMA = 50.0;

/**
 * Default maximum dispersion penalty ratio gamma in [0, 1].
 * Setting gamma = 0.5 limits maximum penalty under extreme bimodal divergence to 50%.
 */
const DEFAULT_DISPERSION_PENALTY_RATIO = 0.5;

const LANG_CONFIG = Object.freeze({
  typescript: Object.freeze({
    label: 'TypeScript / JS',
    extensions: Object.freeze(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
  }),
  gdscript: Object.freeze({
    label: 'GDScript',
    extensions: Object.freeze(['.gd']),
  }),
  python: Object.freeze({
    label: 'Python',
    extensions: Object.freeze(['.py']),
  }),
  shell: Object.freeze({
    label: 'Shell (PS1 / Bash)',
    extensions: Object.freeze(['.ps1', '.psm1', '.psd1', '.sh', '.bash', '.zsh']),
  }),
  rust: Object.freeze({
    label: 'Rust',
    extensions: Object.freeze(['.rs']),
  }),
});

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'archive',
  '.agents',
  '.godot',
  '.refactor-trajectory',
  '.audit-logs',
  'coverage',
]);

/**
 * Safely parses a JSON file when present on disk.
 *
 * @param {string} filePath - Absolute file path.
 * @returns {object|null} Parsed JSON object or null.
 */
function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Normalizes a numeric score into [0, 100] with two decimal places, or null when unmeasured.
 *
 * @param {unknown} value - Candidate numeric score.
 * @returns {number|null} Normalized score or null.
 */
function clampMeasuredScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

/**
 * Counts source files and physical lines per active language across repository.
 *
 * @param {string} rootDir - Root directory to traverse.
 * @returns {Record<string, { files: number, loc: number }>} Counts per language.
 */
function surveyWorkspaceLanguageVolume(rootDir) {
  const result = {};
  for (const lang of Object.keys(LANG_CONFIG)) {
    result[lang] = { files: 0, loc: 0 };
  }

  const extToLang = new Map();
  for (const [lang, cfg] of Object.entries(LANG_CONFIG)) {
    for (const ext of cfg.extensions) {
      extToLang.set(ext.toLowerCase(), lang);
    }
  }

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (EXCLUDED_DIRS.has(name)) continue;

      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        const lang = extToLang.get(ext);
        if (!lang) continue;

        result[lang].files += 1;
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          result[lang].loc += content.split('\n').length;
        } catch {
          result[lang].loc += 1;
        }
      }
    }
  }

  walk(rootDir);
  return result;
}

/**
 * Reads historical workspace polyglot score as a last-resort cached measurement only when
 * fresh subproject reports are unavailable in fast mode.
 *
 * @param {string} langKey - Language identifier.
 * @returns {number|null} Cached score or null.
 */
function readLegacyAuditPolyglotScore(langKey) {
  const latestAuditPath = path.join(REPO_ROOT, '.audit-logs/audit-latest.json');
  const data = readJsonIfExists(latestAuditPath);
  return clampMeasuredScore(data?.polyglotBreakdown?.[langKey]?.score);
}

/**
 * Reads TypeScript/JS quality score from fresh subproject reports first, without fake fallbacks.
 *
 * @param {boolean} [fastMode=false] - Allow historical workspace snapshot fallback if needed.
 * @returns {number|null} Score in [0, 100] or null when unmeasured.
 */
function sampleTypescriptScore(fastMode = false) {
  const baselineData = readJsonIfExists(BASELINE_PATH);
  let arScore = clampMeasuredScore(
    baselineData?.metrics?.compositeScore ?? baselineData?.compositeScore,
  );
  if (arScore === null) {
    const aasData = readJsonIfExists(AAS_BASELINE_PATH);
    arScore = clampMeasuredScore(aasData?.health?.score);
  }

  const wtLatestPath = path.join(REPO_ROOT, 'workspace-timing/reports/auto-refactor-latest.json');
  const wtLatestData = readJsonIfExists(wtLatestPath);
  let wtScore = clampMeasuredScore(wtLatestData?.qualityScore?.compositeScore);
  if (wtScore === null) {
    const wtCachePath = path.join(
      REPO_ROOT,
      'workspace-timing/reports/.refactor-cache/report.json',
    );
    const wtCacheData = readJsonIfExists(wtCachePath);
    wtScore = clampMeasuredScore(wtCacheData?.qualityScore?.compositeScore);
  }

  if (arScore !== null && wtScore !== null) {
    return Math.round((arScore * 0.75 + wtScore * 0.25) * 100) / 100;
  }
  if (arScore !== null) return arScore;
  if (wtScore !== null) return wtScore;
  return fastMode ? readLegacyAuditPolyglotScore('typescript') : null;
}

/**
 * Samples Rust quality score from fractal-git's fresh audit report first, without fake fallbacks.
 *
 * @param {boolean} [fastMode=false] - Allow historical workspace snapshot fallback if needed.
 * @returns {number|null} Score in [0, 100] or null when unmeasured.
 */
function sampleRustScore(fastMode = false) {
  const fgReportPath = path.join(REPO_ROOT, 'fractal-git/reports/audit-latest.json');
  const data = readJsonIfExists(fgReportPath);
  if (data) {
    const composite = clampMeasuredScore(data.summary?.compositeScore);
    if (composite !== null) return composite;
    const envelopeScore = clampMeasuredScore(data.qualityEnvelope?.composite_score);
    if (envelopeScore !== null) return envelopeScore;
    const credible = clampMeasuredScore(data.summary?.bayesianConfidence?.credibleScore);
    if (credible !== null) return credible;
  }
  return fastMode ? readLegacyAuditPolyglotScore('rust') : null;
}

/**
 * Reads cached language quality score, strictly prioritizing fresh subproject reports emitted in
 * the current audit cycle before consulting `.audit-logs/audit-latest.json`.
 *
 * @param {string} langKey - Language key.
 * @returns {number|null} Measured score or null.
 */
function readCachedPolyglotScore(langKey) {
  if (langKey === 'typescript') {
    return sampleTypescriptScore(true);
  }
  if (langKey === 'rust') {
    return sampleRustScore(true);
  }
  if (langKey === 'gdscript' || langKey === 'python') {
    const wgRefactorLatest = path.join(REPO_ROOT, 'WebGames/reports/auto-refactor-latest.json');
    const wgRefactorData = readJsonIfExists(wgRefactorLatest);
    const wgRefactorScore = clampMeasuredScore(wgRefactorData?.qualityScore?.compositeScore);
    if (wgRefactorScore !== null) return wgRefactorScore;

    const wgAuditLatest = path.join(REPO_ROOT, 'WebGames/reports/audit-latest.json');
    const wgAuditData = readJsonIfExists(wgAuditLatest);
    const wgAuditScore = clampMeasuredScore(wgAuditData?.summary?.compositeScore);
    if (wgAuditScore !== null) return wgAuditScore;
  }
  return readLegacyAuditPolyglotScore(langKey);
}

/**
 * Executes a fast read-only auto-refactor slice scan for the given glob patterns.
 *
 * @param {string[]} includePatterns - Glob patterns relative to repository root.
 * @returns {Promise<number|null>} Measured composite score or null.
 */
async function runLanguageSliceScan(includePatterns) {
  if (!fs.existsSync(AR_API_PATH)) {
    return null;
  }
  try {
    const { scan } = require(AR_API_PATH);
    const scanResult = await scan({
      root: REPO_ROOT,
      include: includePatterns,
      fastMode: true,
      logLevel: 'error',
    });
    return clampMeasuredScore(scanResult?.qualityScore?.compositeScore);
  } catch {
    return null;
  }
}

/**
 * Samples Python quality score from fresh WebGames report or live AST slice scan.
 *
 * @param {boolean} [fastMode=false] - Prefer fresh cached subproject report when available.
 * @returns {Promise<number|null>} Score in [0, 100] or null when unmeasured.
 */
async function samplePythonScore(fastMode = false) {
  if (fastMode) {
    const cached = readCachedPolyglotScore('python');
    if (cached !== null) return cached;
  }
  return runLanguageSliceScan(['WebGames/scripts/py/**/*.py']);
}

/**
 * Samples GDScript quality score from fresh WebGames report or live AST slice scan.
 *
 * @param {boolean} [fastMode=false] - Prefer fresh cached subproject report when available.
 * @returns {Promise<number|null>} Score in [0, 100] or null when unmeasured.
 */
async function sampleGdscriptScore(fastMode = false) {
  if (fastMode) {
    const cached = readCachedPolyglotScore('gdscript');
    if (cached !== null) return cached;
  }
  return runLanguageSliceScan(['WebGames/**/*.gd']);
}

/**
 * Samples Shell quality score by executing auto-refactor scan on active ps1/sh scripts
 * combined with cross-platform isomorphism gate verification.
 *
 * @param {boolean} [fastMode=false] - Prefer cached score when available.
 * @returns {Promise<number|null>} Score in [0, 100] or null when unmeasured.
 */
async function sampleShellScore(fastMode = false) {
  if (fastMode) {
    const cached = readCachedPolyglotScore('shell');
    if (cached !== null) return cached;
  }

  let baseScore = await runLanguageSliceScan([
    'scripts/**/*.ps1',
    'scripts/**/*.sh',
    'WebGames/scripts/**/*.ps1',
    'WebGames/scripts/**/*.sh',
    'fractal-git/scripts/**/*.ps1',
    'fractal-git/scripts/**/*.sh',
  ]);
  if (baseScore === null) {
    return null;
  }

  const isoScript = path.join(REPO_ROOT, 'scripts/common/validate-script-isomorphism.js');
  if (fs.existsSync(isoScript)) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync(process.execPath, [isoScript], { stdio: 'pipe', encoding: 'utf8' });
    } catch {
      baseScore = Math.max(
        SHELL_ISOMORPHISM_FLOOR,
        Math.round((baseScore - SHELL_ISOMORPHISM_PENALTY) * 100) / 100,
      );
    }
  }

  return baseScore;
}

/**
 * Computes weighted mean across measured languages.
 *
 * @param {string[]} languages - Measured language keys.
 * @param {Record<string, number>} scores - Scores per language.
 * @param {Record<string, number>} weights - Weights per language.
 * @param {number} totalWeight - Sum of measured weights.
 * @returns {number} Weighted mean.
 */
function computeWeightedMean(languages, scores, weights, totalWeight) {
  let sum = 0;
  for (const lang of languages) {
    sum += scores[lang] * weights[lang];
  }
  return sum / totalWeight;
}

/**
 * Computes weighted variance across measured languages.
 *
 * @param {string[]} languages - Measured language keys.
 * @param {Record<string, number>} scores - Scores per language.
 * @param {Record<string, number>} weights - Weights per language.
 * @param {number} mean - Weighted mean.
 * @param {number} totalWeight - Sum of measured weights.
 * @returns {number} Weighted variance.
 */
function computeWeightedVariance(languages, scores, weights, mean, totalWeight) {
  let sum = 0;
  for (const lang of languages) {
    const diff = scores[lang] - mean;
    sum += weights[lang] * diff * diff;
  }
  return sum / totalWeight;
}

/**
 * Evaluates comprehensive multi-language balance across workspace without fabricated fallbacks.
 *
 * @param {object} [options] - Evaluation options.
 * @param {boolean} [options.fast=false] - Run fast mode prioritizing fresh subproject reports.
 * @param {Record<string, number|null>} [options.explicitScores] - Explicit score overrides.
 * @returns {Promise<object>} Polyglot balance assessment result.
 */
async function evaluateWorkspacePolyglotBalance(options = {}) {
  const fast = Boolean(options.fast);
  const explicit = options.explicitScores || {};

  const volume = surveyWorkspaceLanguageVolume(REPO_ROOT);

  const scores = {
    typescript:
      explicit.typescript !== undefined ? explicit.typescript : sampleTypescriptScore(fast),
    gdscript:
      explicit.gdscript !== undefined ? explicit.gdscript : await sampleGdscriptScore(fast),
    python: explicit.python !== undefined ? explicit.python : await samplePythonScore(fast),
    shell: explicit.shell !== undefined ? explicit.shell : await sampleShellScore(fast),
    rust: explicit.rust !== undefined ? explicit.rust : sampleRustScore(fast),
  };

  const activeLanguages = Object.keys(LANG_CONFIG).filter(
    (lang) => volume[lang] && volume[lang].files > 0,
  );

  if (activeLanguages.length === 0) {
    return {
      polyglotIndex: null,
      weightedMean: null,
      standardDeviation: null,
      normalizedDispersion: null,
      dispersionPenalty: null,
      activeLanguageCount: 0,
      measuredLanguageCount: 0,
      unmeasuredLanguages: [],
      breakdown: {},
    };
  }

  const weights = {};
  for (const lang of activeLanguages) {
    const loc = Math.max(0, volume[lang].loc);
    weights[lang] = Math.round(Math.log(loc + 10) * 100) / 100;
  }

  const measuredLanguages = activeLanguages.filter(
    (lang) => typeof scores[lang] === 'number' && Number.isFinite(scores[lang]),
  );
  const unmeasuredLanguages = activeLanguages.filter((lang) => !measuredLanguages.includes(lang));

  const breakdown = {};
  for (const lang of activeLanguages) {
    const measured = measuredLanguages.includes(lang);
    breakdown[lang] = {
      label: LANG_CONFIG[lang].label,
      files: volume[lang].files,
      loc: volume[lang].loc,
      weight: weights[lang],
      measured,
      score: measured ? scores[lang] : null,
    };
  }

  let measuredWeightSum = 0;
  for (const lang of measuredLanguages) {
    measuredWeightSum += weights[lang];
  }

  if (measuredLanguages.length === 0 || measuredWeightSum <= 0) {
    return {
      polyglotIndex: null,
      weightedMean: null,
      standardDeviation: null,
      normalizedDispersion: null,
      dispersionPenalty: null,
      activeLanguageCount: activeLanguages.length,
      measuredLanguageCount: 0,
      unmeasuredLanguages,
      breakdown,
    };
  }

  const sMean = computeWeightedMean(measuredLanguages, scores, weights, measuredWeightSum);
  const variance = computeWeightedVariance(
    measuredLanguages,
    scores,
    weights,
    sMean,
    measuredWeightSum,
  );
  const sigmaS = Math.sqrt(Math.max(0, variance));

  const normalizedDispersion = sigmaS / POPOVICIU_MAX_SIGMA;
  const dispersionPenalty = Math.max(
    0,
    1.0 - normalizedDispersion * DEFAULT_DISPERSION_PENALTY_RATIO,
  );
  const polyglotScore = Math.round(sMean * dispersionPenalty * 100) / 100;

  return {
    polyglotIndex: polyglotScore,
    weightedMean: Math.round(sMean * 100) / 100,
    standardDeviation: Math.round(sigmaS * 100) / 100,
    normalizedDispersion: Math.round(normalizedDispersion * 1000) / 1000,
    dispersionPenalty: Math.round(dispersionPenalty * 1000) / 1000,
    activeLanguageCount: activeLanguages.length,
    measuredLanguageCount: measuredLanguages.length,
    unmeasuredLanguages,
    breakdown,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const isFast = args.includes('--fast');
  const isRequireMeasured = args.includes('--require-measured');

  evaluateWorkspacePolyglotBalance({ fast: isFast })
    .then((result) => {
      const hasUnmeasured = result.unmeasuredLanguages.length > 0;
      if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        process.exit(isRequireMeasured && hasUnmeasured ? 1 : 0);
      }

      const fmtMetric = (val, digits = 2) => (typeof val === 'number' ? val.toFixed(digits) : 'N/A');
      const fmtPct = (val) => (typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : 'N/A');

      console.log('=================================================================');
      console.log('🌐 全工作区语言均衡与多语言质量全景评估 (Polyglot Balance)');
      console.log('=================================================================');
      console.log(`语言均衡指数 (Polyglot Index): ${fmtMetric(result.polyglotIndex)}`);
      console.log(`加权均值分 (Weighted Mean)   : ${fmtMetric(result.weightedMean)}`);
      console.log(`离散度标准差 (Std Deviation) : ${fmtMetric(result.standardDeviation)}`);
      console.log(`离散度折扣率 (Dispersion D)  : ${fmtPct(result.dispersionPenalty)}`);
      console.log('-----------------------------------------------------------------');
      console.log('| 语言栈 (Language)       | 代码行数 | 对数权重 | 质量得分 | 状态 |');
      console.log('| :---------------------- | :------- | :------- | :------- | :--- |');
      for (const item of Object.values(result.breakdown)) {
        const scoreStr =
          typeof item.score === 'number' ? item.score.toFixed(1).padStart(5, ' ') : '  N/A';
        const locStr = String(item.loc).padStart(7, ' ');
        const weightStr = item.weight.toFixed(2).padStart(5, ' ');
        const status =
          typeof item.score !== 'number'
            ? '⚠ 未测量'
            : item.score >= 90
              ? '✔ 优秀'
              : item.score >= 80
                ? '▲ 良好'
                : '✖ 滞后';
        console.log(
          `| ${item.label.padEnd(23, ' ')} | ${locStr}  |  ${weightStr}   |  ${scoreStr}   | ${status} |`,
        );
      }
      if (hasUnmeasured) {
        console.warn(`⚠ 未测量语言栈 (${result.unmeasuredLanguages.join(', ')}) — 拒绝注入假保底分`);
      }
      console.log('=================================================================');
      process.exit((isRequireMeasured || !isFast) && hasUnmeasured ? 1 : 0);
    })
    .catch((err) => {
      console.error('Error evaluating polyglot balance:', err);
      process.exit(1);
    });
}

module.exports = {
  LANG_CONFIG,
  readCachedPolyglotScore,
  surveyWorkspaceLanguageVolume,
  evaluateWorkspacePolyglotBalance,
};
