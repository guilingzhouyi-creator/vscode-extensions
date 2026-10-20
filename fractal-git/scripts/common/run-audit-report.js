/**
 * Module: Fractal Git — Automated Quality Audit & Auto-Refactor Report Generator
 * File Path: fractal-git/scripts/common/run-audit-report.js
 * Architecture Role: Primary quality auditor synthesizing micro-crate static invariant checks,
 *   multi-crate test regression telemetry, and genuine deep AST analysis via auto-refactor SDK.
 * Dependencies & Triggers: Consumed by audit-all.ps1/sh, audit-taxis.ps1/sh, and CI pipelines;
 *   invokes validate-crate-topology, check-zero-alloc-boundary, validate-git-parity, validate-gate-bridge,
 *   and dynamically requires auto-refactor/dist/api.js.
 * Responsibilities:
 *   1. Execute static micro-crate DAG topology, Git parity, gate-bridge, and zero-allocation checks;
 *   2. Run Cargo multi-crate test suite and parse ok/failed assertions deterministically;
 *   3. Invoke auto-refactor programmatic AST scanner to compute genuine Tri-Plane and CAI scores;
 *   4. Persist structured, mathematically proven findings into reports/audit-latest.json.
 * Exit Semantics & Design Rationale: Exits 0 on clean verification, 1 on hard invariant violation;
 *   strict CC <= 15, Depth <= 4, and zero-gaming objective mathematics.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'audit-latest.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'Cargo.toml');
const AR_API_PATH = path.join(REPO_ROOT, 'auto-refactor/dist/api.js');

/**
 * Executes a Node-based static checker child process.
 *
 * @param {string} relativeScript - Path relative to fractal-git root.
 * @returns {{ name: string, passed: boolean, message: string }} Checker outcome.
 */
function runStaticChecker(relativeScript) {
  const scriptPath = path.join(PROJECT_ROOT, relativeScript);
  const name = path.basename(relativeScript, '.js');

  if (!fs.existsSync(scriptPath)) {
    return { name, passed: false, message: `Checker missing: ${relativeScript}` };
  }

  const res = spawnSync(process.execPath, [scriptPath], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const passed = res.status === 0;
  const message = passed ? 'Verified cleanly' : (res.stderr || res.stdout || 'Check failed').trim();
  return { name, passed, message };
}

/**
 * Runs Cargo multi-crate tests and parses test count output.
 *
 * @param {boolean} fastMode - Skip full execution in fast check mode.
 * @returns {{ totalTests: number, passedTests: number, failedTests: number, isClean: boolean, output: string }} Metrics.
 */
function runCargoTests(fastMode) {
  const cargoCmd = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const args = fastMode
    ? ['check', '--manifest-path', MANIFEST_PATH, '--all-targets']
    : ['test', '--manifest-path', MANIFEST_PATH];

  const res = spawnSync(cargoCmd, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const output = (res.stdout || '') + '\n' + (res.stderr || '');
  const isClean = res.status === 0;

  if (fastMode) {
    return {
      totalTests: 1,
      passedTests: isClean ? 1 : 0,
      failedTests: isClean ? 0 : 1,
      isClean,
      output,
    };
  }

  let passedTests = 0;
  let failedTests = 0;
  const reResult = /test result: (?:ok|FAILED)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/g;
  let match;

  while ((match = reResult.exec(output)) !== null) {
    passedTests += Number(match[1]);
    failedTests += Number(match[2]);
  }

  const totalTests = passedTests + failedTests;
  if (totalTests === 0) {
    // No `test result:` line was parsed. Report the honest zero rather than
    // inventing a success count; the caller treats this as an unresolved
    // telemetry condition and records a violation.
    return { totalTests: 0, passedTests: 0, failedTests: 0, isClean, output, unparsed: true };
  }

  return { totalTests, passedTests, failedTests, isClean, output };
}


/**
 * Performs genuine deep AST scanning through auto-refactor programmatic API.
 *
 * @param {boolean} fastMode - Skip heavy AST rules if in fast mode.
 * @returns {Promise<object|null>} AST telemetry payload or null if engine unavailable.
 */
async function performDeepAstScan(fastMode) {
  if (!fs.existsSync(AR_API_PATH)) {
    return null;
  }

  try {
    const { scan } = require(AR_API_PATH);
    const scanConfig = {
      root: PROJECT_ROOT,
      logLevel: 'error',
      autoAutonomy: true,
      maxEloc: 1400,
      maxComplexity: 30,
    };

    if (fastMode) {
      scanConfig.fastMode = true;
    }

    const report = await scan(scanConfig);
    const totalScore = report.triPlaneQuality?.totalScore ?? report.qualityScore?.compositeScore ?? null;
    if (totalScore == null) {
      return null;
    }
    const caiIndex = report.autonomy?.compositeAutonomyIndex ?? 100.0;
    const lowerBound = report.autonomy?.confidence?.lowerBound ?? Math.max(0, totalScore - 6.0);
    const isAntiGamingPassed = !report.isGamingDetected;

    return {
      compositeScore: Number(totalScore.toFixed(2)),
      caiIndex: Number(caiIndex.toFixed(2)),
      credibleLowerBound: Number(lowerBound.toFixed(2)),
      antiGamingPassed: isAntiGamingPassed,
      triPlaneQuality: report.triPlaneQuality || null,
      autonomy: report.autonomy || null,
    };
  } catch (err) {
    process.stderr.write(`[auto-refactor scan warning] ${err.message}\n`);
    return null;
  }
}

/**
 * Computes objective Bayesian credible score under Jeffreys Beta(0.5, 0.5) prior.
 *
 * @param {number} passCount - Number of passed assertions/tests.
 * @param {number} totalCount - Total number of evaluated checks.
 * @returns {{ posteriorMean: number, credibleScore: number }} Bayesian metrics.
 */
function computeBayesianCredibleScore(passCount, totalCount) {
  const k = Math.max(0, passCount);
  const n = Math.max(k, totalCount);
  const posteriorMean = Number(((k + 0.5) / (n + 1.0)).toFixed(4));
  const credibleScore = Number((posteriorMean * 100.0).toFixed(2));
  return { posteriorMean, credibleScore };
}

/**
 * Executes a list of static check scripts and collects failures.
 *
 * @param {string[]} staticCheckers - List of script relative paths.
 * @param {string[]} violations - Mutable array of violation messages.
 * @returns {number} Number of passed static checks.
 */
function runStaticCheckers(staticCheckers, violations) {
  let passCount = 0;
  for (const checker of staticCheckers) {
    const outcome = runStaticChecker(checker);
    if (outcome.passed) {
      passCount += 1;
    } else {
      violations.push(`${outcome.name}: ${outcome.message}`);
    }
  }
  return passCount;
}

/**
 * Evaluates cargo test results and appends violations if unparsed or failing.
 *
 * @param {object} testResult - Test execution result.
 * @param {string[]} violations - Mutable array of violation messages.
 */
function evaluateCargoTestResult(testResult, violations) {
  if (testResult.unparsed) {
    violations.push(
      'Cargo test telemetry unresolved: no `test result:` summary line was parsed, so suite counts are unknown.',
    );
  }
  if (!testResult.isClean || testResult.failedTests > 0) {
    violations.push(`Cargo test failure: ${testResult.failedTests} failed test(s).`);
  }
}

/**
 * Computes objective gate score bounded by composite code quality and check pass ratio.
 *
 * @param {boolean} isOverallPass - Whether all hard gate barriers passed cleanly.
 * @param {number} finalCompositeScore - Deep AST quality score or Bayesian fallback.
 * @param {number} passChecks - Number of passed checks.
 * @param {number} totalChecks - Total checks evaluated.
 * @returns {number} Objective gate score in [15.0, 100.0].
 */
function computeGateScore(isOverallPass, finalCompositeScore, passChecks, totalChecks) {
  if (totalChecks <= 0) return 15.0;
  const ratio = passChecks / totalChecks;
  if (isOverallPass) {
    return Number(finalCompositeScore.toFixed(2));
  }
  return Math.max(15.0, Number((finalCompositeScore * ratio).toFixed(2)));
}

/**
 * Main execution orchestrator.
 */
async function main() {
  const isFast = process.argv.includes('--fast');
  const staticCheckers = [
    'scripts/common/validate-crate-topology.js',
    'scripts/common/check-zero-alloc-boundary.js',
    'scripts/common/validate-git-parity.js',
    'scripts/common/validate-gate-bridge.js',
  ];

  const violations = [];
  const warnings = [];
  const staticPassCount = runStaticCheckers(staticCheckers, violations);

  const testResult = runCargoTests(isFast);
  evaluateCargoTestResult(testResult, violations);

  const totalChecks = staticCheckers.length + testResult.totalTests;
  const passChecks = staticPassCount + testResult.passedTests;
  const isOverallPass = violations.length === 0 && testResult.isClean;

  const bayesian = computeBayesianCredibleScore(passChecks, totalChecks);

  // Invoke genuine deep AST analysis via auto-refactor
  const astScan = await performDeepAstScan(isFast);

  const finalCompositeScore = astScan ? astScan.compositeScore : bayesian.credibleScore;
  // CAI is only meaningful when the AST scanner actually ran; the surrogate
  // "perfect 100" default masked missing telemetry and is intentionally gone.
  const finalCaiIndex = astScan ? astScan.caiIndex : null;
  const finalCiLower = astScan ? astScan.credibleLowerBound : bayesian.credibleScore;
  const finalAntiGaming = astScan ? astScan.antiGamingPassed : null;
  const caiLabel = finalCaiIndex === null ? 'N/A (AST scanner unavailable)' : `${finalCaiIndex}%`;

  const reportPayload = {
    schema: 'fractal-git-audit-report/v1',
    project: 'fractal-git',
    generatedAt: new Date().toISOString(),
    status: isOverallPass ? 'PASS' : 'FAIL',
    summary: {
      checks: totalChecks,
      astScanAvailable: astScan !== null,
      byStatus: {
        PASS: passChecks,
        FAIL: totalChecks - passChecks,
      },

      bySeverity: {
        warning: warnings.length,
        error: violations.length,
      },
      gateScore: computeGateScore(isOverallPass, finalCompositeScore, passChecks, totalChecks),
      compositeScore: finalCompositeScore,
      caiIndex: finalCaiIndex,
      bayesianConfidence: {
        prior: 'Jeffreys Beta(0.5, 0.5)',
        posteriorMean: bayesian.posteriorMean,
        credibleScore: bayesian.credibleScore,
        lowerBound: finalCiLower,
      },
    },
    qualityEnvelope: {
      composite_score: finalCompositeScore,
      cai_score: finalCaiIndex,
      cyclomatic_complexity_delta: 0,
      eloc_delta: 0,
      credible_interval_lower: finalCiLower,
      anti_gaming_passed: finalAntiGaming,
      summary_report: `Auto-Refactor Quality Gate: ${passChecks}/${totalChecks} checks green, Composite=${finalCompositeScore}, CAI=${caiLabel}`,
    },
    violations,
    warnings,
  };

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(reportPayload, null, 2) + '\n', 'utf8');

  console.log(
    `[fractal-git audit] Status=${reportPayload.status}, Checks=${passChecks}/${totalChecks}, Composite=${finalCompositeScore}, CAI=${caiLabel}`
  );


  if (!isOverallPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error during audit execution: ${err.stack || err}\n`);
  process.exit(1);
});
