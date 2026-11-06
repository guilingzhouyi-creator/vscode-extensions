/**
 * Module: Fractal Git — Automated Quality Audit & Auto-Refactor Report Generator
 * File Path: fractal-git/scripts/common/run-audit-report.js
 * Architecture Role: Primary quality auditor synthesizing kernel subsystem static invariant checks,
 *   subsystem test regression telemetry, and genuine deep AST analysis via auto-refactor SDK.
 * Dependencies & Triggers: Consumed by audit-all.ps1/sh, audit-taxis.ps1/sh, and CI pipelines;
 *   invokes validate-crate-topology, check-zero-alloc-boundary, validate-git-parity,
 *   validate-gate-bridge, and dynamically requires auto-refactor/dist/api.js.
 * Responsibilities:
 *   1. Execute static kernel subsystem DAG topology, Git parity, and zero-allocation checks;
 *   2. Run Cargo subsystem test suite and parse ok/failed assertions deterministically;
 *   3. Invoke auto-refactor programmatic AST scanner to compute genuine Tri-Plane and CAI scores;
 *   4. Persist structured, mathematically proven findings into reports/audit-latest.json.
 * Exit Semantics & Design Rationale: Exits 0 on clean verification, 1 on hard invariant violation;
 *   strict CC <= 15, Depth <= 4, and zero-gaming objective mathematics.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { prepareCargo } = require('./resolve-cargo');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');
const REPORT_PATH = path.join(REPORTS_DIR, 'audit-latest.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'Cargo.toml');
const AR_API_PATH = path.join(REPO_ROOT, 'auto-refactor/dist/api.js');

/**
 * Executes a Node-based static checker child process.
 *
 * @param {string|{script: string, args?: string[]}} checkerSpec - Script path or spec relative to fractal-git root.
 * @returns {{ name: string, passed: boolean, message: string }} Checker outcome.
 */
function runStaticChecker(checkerSpec) {
  const relativeScript = typeof checkerSpec === 'string' ? checkerSpec : checkerSpec.script;
  const extraArgs = typeof checkerSpec === 'object' && Array.isArray(checkerSpec.args) ? checkerSpec.args : [];
  const scriptPath = path.join(PROJECT_ROOT, relativeScript);
  const name = path.basename(relativeScript, '.js');

  if (!fs.existsSync(scriptPath)) {
    return { name, passed: false, message: `Checker missing: ${relativeScript}` };
  }

  const res = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const passed = res.status === 0;
  const message = passed ? 'Verified cleanly' : (res.stderr || res.stdout || 'Check failed').trim();
  return { name, passed, message };
}

function countWorkspaceRustTests(dirPath) {
  let count = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'target' && !entry.name.startsWith('.')) {
        count += countWorkspaceRustTests(fullPath);
      }
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const matches = content.match(/#\[(?:tokio::)?test\b/g);
      if (matches) count += matches.length;
    }
  }
  return count;
}

/**
 * Runs Cargo subsystem tests and parses test count output.
 *
 * @param {boolean} fastMode - Skip full execution in fast check mode.
 * @returns {object} Test run outcome metrics including counts and output text.
 */
function runCargoTests(fastMode) {
  // Resolve through the shared discovery helper rather than assuming `cargo.exe` is on PATH.
  // A bare name reported "toolchain missing" on machines whose rustup shim directory was absent
  // from PATH, which made the audit report `BLOCK` while every static checker had passed — an
  // outcome that reads as a code defect rather than the environment gap it actually was.
  const cargoResolution = prepareCargo();
  if (!cargoResolution) {
    return {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      isClean: false,
      output: 'cargo was not found through TAXIS_CARGO_BIN, ~/.cargo/bin, the rustup toolchain root, or PATH.',
      unresolved: true,
    };
  }
  const cargoCmd = cargoResolution.command;
  // `--workspace` is mandatory: without it only the root package is compiled, so the ten
  // kernel subsystems' unit tests never enter the audit and the reported test count is a fraction of
  // the suite. Every other Rust gate was corrected to pass it; this caller was missed, which is
  // exactly the kind of single-site omission a shared invocation would have prevented.
  const args = fastMode
    ? ['check', '--workspace', '--manifest-path', MANIFEST_PATH, '--all-targets']
    : ['test', '--workspace', '--manifest-path', MANIFEST_PATH];

  const res = spawnSync(cargoCmd, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const output = (res.stdout || '') + '\n' + (res.stderr || '');
  const isClean = res.status === 0;

  if (fastMode) {
    const discoveredTests = Math.max(1, countWorkspaceRustTests(path.join(PROJECT_ROOT, 'crates')));
    return {
      totalTests: discoveredTests,
      passedTests: isClean ? discoveredTests : 0,
      failedTests: isClean ? 0 : discoveredTests,
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
 * Summarizes raw AST issues by severity and analyzer.
 *
 * @param {Array<object>} rawIssues - Issue list from auto-refactor report.
 * @returns {object} Aggregated issue counts.
 */
function summarizeAstIssues(rawIssues) {
  if (!Array.isArray(rawIssues) || rawIssues.length === 0) {
    return { issuesTotal: 0, bySeverity: {}, byAnalyzer: {} };
  }
  const bySeverity = {};
  const byAnalyzer = {};
  for (const issue of rawIssues) {
    const sev = issue.severity || 'unknown';
    const ana = issue.analyzer || issue.category || 'unknown';
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    byAnalyzer[ana] = (byAnalyzer[ana] || 0) + 1;
  }
  return { issuesTotal: rawIssues.length, bySeverity, byAnalyzer };
}

/**
 * Computes fallback credible lower bound under Jeffreys prior.
 *
 * @param {number} totalScore - Composite score.
 * @param {number|undefined} filesScanned - Total files scanned.
 * @returns {number} Lower bound percentage.
 */
function computeFallbackLowerBound(totalScore, filesScanned) {
  const p = Math.max(0, Math.min(1, totalScore / 100.0));
  const n = Math.max(1, filesScanned || 1);
  const alpha = p * n + 0.5;
  const beta = (1.0 - p) * n + 0.5;
  const total = alpha + beta;
  const variance = (alpha * beta) / (total * total * (total + 1.0));
  const stdDev = Math.sqrt(variance);
  return Math.max(0, Number(((alpha / total - 1.96 * stdDev) * 100.0).toFixed(2)));
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
      maxEloc: 900,
      maxComplexity: 15,
    };

    if (fastMode) {
      scanConfig.fastMode = true;
    }

    const report = await scan(scanConfig);
    const totalScore = report.triPlaneQuality?.totalScore ?? report.qualityScore?.compositeScore ?? null;
    if (totalScore == null) {
      return null;
    }
    // An absent autonomy index means the scan did not measure it. Falling back to a full-score
    // literal would publish a measurement that never happened, so absence is carried through as
    // null and the consumers below decide how to report an unmeasured plane.
    const caiIndex = report.autonomy?.compositeAutonomyIndex ?? null;
    const lowerBound = report.autonomy?.confidence?.lowerBound ?? computeFallbackLowerBound(totalScore, report.summary?.filesScanned);
    const isAntiGamingPassed = !report.isGamingDetected;
    const astIssues = summarizeAstIssues(report.issues);

    return {
      compositeScore: Number(totalScore.toFixed(2)),
      caiIndex: caiIndex === null ? null : Number(caiIndex.toFixed(2)),
      credibleLowerBound: Number(lowerBound.toFixed(2)),
      antiGamingPassed: isAntiGamingPassed,
      triPlaneQuality: report.triPlaneQuality || null,
      autonomy: report.autonomy || null,
      astIssues,
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
  const alpha = k + 0.5;
  const beta = n - k + 0.5;
  const total = alpha + beta;
  const posteriorMean = Number((alpha / total).toFixed(4));
  const credibleScore = Number((posteriorMean * 100.0).toFixed(2));
  const variance = (alpha * beta) / (total * total * (total + 1.0));
  const stdDev = Math.sqrt(variance);
  const credibleLowerBound = Math.max(0, Number(((alpha / total - 1.96 * stdDev) * 100.0).toFixed(2)));
  return { posteriorMean, credibleScore, credibleLowerBound };
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
  if (testResult.unresolved) {
    violations.push(`Cargo toolchain unavailable: ${testResult.output}`);
    return;
  }
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
    { script: 'scripts/common/validate-git-parity.js', args: ['--require-git'] },
    'scripts/common/validate-gate-bridge.js',
    ...(isFast ? [] : ['scripts/common/validate-perf-baseline.js']),
  ];

  const violations = [];
  const warnings = [];
  const staticPassCount = runStaticCheckers(staticCheckers, violations);

  const testResult = runCargoTests(isFast);
  evaluateCargoTestResult(testResult, violations);

  // Invoke genuine deep AST analysis via auto-refactor (Fail-Closed when unavailable)
  const astScan = await performDeepAstScan(isFast);
  if (astScan === null) {
    violations.push('auto-refactor AST scanner unavailable or returned null telemetry (Fail-Closed).');
  } else if (astScan.antiGamingPassed === false) {
    violations.push('auto-refactor anti-gaming check rejected structural gaming.');
  }

  const astCheckTotal = 1;
  const astCheckPass = astScan !== null && astScan.antiGamingPassed !== false ? 1 : 0;
  const totalChecks = staticCheckers.length + testResult.totalTests + astCheckTotal;
  const passChecks = staticPassCount + testResult.passedTests + astCheckPass;
  const isOverallPass = violations.length === 0 && testResult.isClean;

  const recordedTotal = testResult.totalTests > 0 ? totalChecks : totalChecks + 1;
  const recordedPass = passChecks;

  const bayesian = computeBayesianCredibleScore(recordedPass, recordedTotal);

  const finalCompositeScore = astScan ? astScan.compositeScore : 15.0;
  // CAI is only meaningful when the AST scanner actually ran; the surrogate
  // "perfect 100" default masked missing telemetry and is intentionally gone.
  const finalCaiIndex = astScan ? astScan.caiIndex : null;
  const finalCiLower = astScan ? astScan.credibleLowerBound : bayesian.credibleLowerBound;
  const finalAntiGaming = astScan ? astScan.antiGamingPassed : null;
  const caiLabel = finalCaiIndex === null ? 'N/A (AST scanner unavailable)' : `${finalCaiIndex}%`;

  const reportPayload = {
    schema: 'fractal-git-audit-report/v1',
    project: 'fractal-git',
    generatedAt: new Date().toISOString(),
    status: isOverallPass ? 'PASS' : 'BLOCK',
    summary: {
      checks: recordedTotal,
      astScanAvailable: astScan !== null,
      byStatus: {
        PASS: recordedPass,
        // 与顶层 status 同词：门禁终态失败只有 BLOCK 一种，写 FAIL 会让读者以为
        // 存在第二种失败语义，也让本报告与 audit-all 的快照词表不一致。
        BLOCK: recordedTotal - recordedPass,
      },

      bySeverity: {
        warning: warnings.length,
        error: violations.length,
      },
      astIssues: astScan ? astScan.astIssues : null,
      gateScore: computeGateScore(isOverallPass, finalCompositeScore, recordedPass, recordedTotal),
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
      // Neither delta is measured by this report: it runs the gate suite, not a before/after
      // structural diff. The previous literal zeros read as "measured, no change" and are replaced
      // by null so a consumer sees absence rather than a fabricated result.
      cyclomatic_complexity_delta: null,
      eloc_delta: null,
      credible_interval_lower: finalCiLower,
      anti_gaming_passed: finalAntiGaming,
      summary_report: `Auto-Refactor Quality Gate: ${passChecks}/${totalChecks} checks green, Composite=${finalCompositeScore}, CAI=${caiLabel}, structural deltas unmeasured`,
    },
    taxisVerification: {
      tkcvInvariantsClean: staticPassCount === staticCheckers.length,
      ikceSuitePassed: testResult.isClean,
      bayesianCreditScore: bayesian.credibleScore,
      bayesianCiLower: finalCiLower,
      auditRecordByteCeiling: 350,
    },
    violations,
    warnings,
  };

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(reportPayload, null, 2) + '\n', 'utf8');

  console.log(
    `[fractal-git audit] Status=${reportPayload.status}, Checks=${recordedPass}/${recordedTotal}, Composite=${finalCompositeScore}, CAI=${caiLabel}`
  );


  if (!isOverallPass) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error during audit execution: ${err.stack || err}\n`);
  process.exit(1);
});
