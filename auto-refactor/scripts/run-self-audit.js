/**
 * Module: Static Quality Assurance — Self-Audit Baseline Runner (Reviewer -> Reviewer)
 * File Path: scripts/run-self-audit.js
 * Architecture Role: Production-grade self-examination runner that uses the immutable
 *   AuditSnapshot sandbox to audit the engine itself with the full 8-pillar quality model,
 *   extracting technical debt ledgers (Critical/High/Medium/Low) without code privilege.
 * Dependencies & Triggers: Consumes ../dist/api; writes reports/self-audit-baseline.json.
 * Responsibilities: Run full-repo scan, compute 8-pillar scores, classify technical debt,
 *   identify top refactoring hotspots, and export the official self-audit baseline report.
 * Exit Semantics & Design Rationale: Standalone executable CLI & programmatic function.
 */

'use strict';

const MODULE_PATH = 'path';
const MODULE_CHILD_PROCESS = 'child_process';
const MODULE_API = '../dist/api';
const DIR_REPORTS = 'reports';
const FILE_BASELINE = 'self-audit-baseline.json';
/** Token-frugal, topologically-grouped AAS v1.0 report. */
const FILE_BASELINE_AAS = 'self-audit-baseline.aas.json';
const STDIO_MODE_PIPE = 'pipe';
const KEY_COMPOSITE_SCORE = 'compositeScore';
const PILLAR_LABEL_WIDTH = 16;
const DIMENSION_LABEL_WIDTH = 24;

const fs = require('fs');
const os = require('os');
const path = require(MODULE_PATH);
const { execSync } = require(MODULE_CHILD_PROCESS);
const {
  scan,
  createAuditSnapshot,
  scoreFileQuality,
  aggregateProjectScore,
  extractDomainName,
  TrajectoryAccumulator,
  ALL_QUALITY_DIMENSIONS,
  toAasJson,
  evaluateElasticDebtBudget,
  classifyElasticDebtTier: classifyDebtTier,
  buildDebtLedger,
  serializeBaselineSignatures,
  calculateStructuralDebtDelta,
  estimateChangedElocFromNumstat,
} = require(MODULE_API);

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, DIR_REPORTS);
const BASELINE_OUTPUT = path.join(REPORTS_DIR, FILE_BASELINE);
/** Agent Audit Schema (AAS v1.0) report artifact. */
const BASELINE_AAS_OUTPUT = path.join(REPORTS_DIR, FILE_BASELINE_AAS);
const TRAJECTORY_DIR = path.join(ROOT, '.refactor-trajectory');
const BASELINE_SIGNATURES_FILE = path.join(TRAJECTORY_DIR, 'baseline-signatures.json');

const TIER_CRITICAL = 'critical';
const TIER_HIGH = 'high';
const MODULE_NAME_AUTO_ENGINE = 'auto-refactor-engine';
const AGENT_NAME_SELF_AUDIT = 'self-audit-engine';
const DEFAULT_MAX_SCORE = 100.0;
const DIGEST_REVISION_LENGTH = 8;
const PROGRESS_BAR_SEGMENTS = 20;
const PROGRESS_BAR_MAX = 100;
const HOTSPOTS_DISPLAY_LIMIT = 5;
const TOP_HOTSPOTS_LIMIT = 10;
const DEBT_SAMPLE_LIMIT = 50;
const MILLISECONDS_PER_SECOND = 1000;
const PERCENT_MULTIPLIER = 100;
const RUN_LOG_LEVEL_WARN = 'warn';

/**
 * Compute eight-pillar scores for each scanned file.
 *
 * @param fileIssuesMap - Map of file paths to their detected issues.
 * @returns Array of file quality score objects.
 */
function computeFileScores(fileIssuesMap) {
  const fileScores = [];
  for (const [filePath, fIssues] of fileIssuesMap.entries()) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    let content = '';
    try {
      if (fs.existsSync(absPath)) {
        content = fs.readFileSync(absPath, 'utf8');
      }
    } catch {
      content = '';
    }
    const domain = extractDomainName(filePath);
    const moduleName = path.basename(path.dirname(filePath));
    const score = scoreFileQuality(filePath, content, fIssues, domain, moduleName);
    fileScores.push(score);
  }
  return fileScores;
}

/**
 * Identify top 10 refactoring hotspots ranked by issue volume.
 *
 * @param fileScores - List of file scores.
 * @returns Top 10 hotspot summary records.
 */
function computeTopHotspots(fileScores) {
  return [...fileScores]
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, TOP_HOTSPOTS_LIMIT)
    .map((f) => {
      const cCount = f.issues.filter((i) => classifyDebtTier(i) === TIER_CRITICAL).length;
      const hCount = f.issues.filter((i) => classifyDebtTier(i) === TIER_HIGH).length;
      return {
        filePath: f.filePath,
        domain: f.domainName,
        totalIssues: f.issues.length,
        criticalCount: cCount,
        highCount: hCount,
        [KEY_COMPOSITE_SCORE]: f.compositeScore,
        effectiveDensity: f.effectiveDensity,
      };
    });
}

/**
 * Collects scanned file contents for AST block fingerprinting and ELOC evaluation.
 */
function collectScannedFiles(fileMetrics) {
  const scannedFilesList = [];
  if (!fileMetrics || !Array.isArray(fileMetrics)) {
    return scannedFilesList;
  }
  for (const fm of fileMetrics) {
    const filePath = fm.file || fm.filePath;
    if (!filePath) {
      continue;
    }
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
    try {
      if (fs.existsSync(absPath)) {
        scannedFilesList.push({
          filePath,
          content: fs.readFileSync(absPath, 'utf8'),
        });
      }
    } catch (e) {
      void e;
    }
  }
  return scannedFilesList;
}

/**
 * Reads existing baseline report if available on disk.
 *
 * @returns Parsed baseline report or null if not found.
 */
function readExistingBaseline() {
  try {
    if (fs.existsSync(BASELINE_OUTPUT)) {
      const raw = fs.readFileSync(BASELINE_OUTPUT, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    void err;
  }
  return null;
}

function readExistingAasBaseline() {
  try {
    if (fs.existsSync(BASELINE_AAS_OUTPUT)) {
      const raw = fs.readFileSync(BASELINE_AAS_OUTPUT, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    void err;
  }
  return null;
}

function readExistingBaselineSignatures() {
  try {
    if (fs.existsSync(BASELINE_SIGNATURES_FILE)) {
      const raw = fs.readFileSync(BASELINE_SIGNATURES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.files === 'object') {
        return parsed.files;
      }
    }
  } catch {
    // Best-effort
  }
  const prevAas = readExistingAasBaseline();
  return prevAas && prevAas.files ? prevAas.files : null;
}

function writeBaselineSignatures(filesMap, revision, trajectoryDir = TRAJECTORY_DIR) {
  try {
    if (!fs.existsSync(trajectoryDir)) {
      fs.mkdirSync(trajectoryDir, { recursive: true });
    }
    const payload = {
      timestamp: Date.now(),
      revision: revision || 'unknown',
      files: filesMap,
    };
    const signaturesPath = path.join(trajectoryDir, 'baseline-signatures.json');
    fs.writeFileSync(signaturesPath, JSON.stringify(payload) + '\n', 'utf8');
  } catch {
    // Best-effort
  }
}

const GIT_DIFF_NUMSTAT_CMD = 'git diff --numstat HEAD~1';

function fetchGitNumstatOutput() {
  try {
    const headDiff = execSync('git diff --numstat HEAD', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: STDIO_MODE_PIPE,
    });
    if (headDiff && headDiff.trim().length > 0) return headDiff;
  } catch {
    // Ignore and fallback
  }
  try {
    return execSync(GIT_DIFF_NUMSTAT_CMD, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: STDIO_MODE_PIPE,
    });
  } catch {
    return '';
  }
}

/**
 * Estimates physical and semantic changed ELOC from git diff if available.
 *
 * @returns Estimated diff counters or undefined.
 */
function estimateChangedEloc() {
  try {
    return estimateChangedElocFromNumstat(fetchGitNumstatOutput());
  } catch {
    return undefined;
  }
}

function getGitRevision(root) {
  try {
    const { execSync } = require('child_process');
    const out = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) return out.slice(0, 8);
  } catch {
    // Best-effort fallback to disk
  }
  try {
    const gitDir = path.join(root, '..', '.git');
    if (!fs.existsSync(gitDir)) return null;
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.length >= 7 ? head.slice(0, 8) : null;
    const refName = head.slice(5);
    const refPath = path.join(gitDir, refName);
    if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf8').trim().slice(0, 8);
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Records an audit run into the persistent trajectory accumulator ledger.
 */
async function recordRunToTrajectory(params) {
  const trajectoryDir = params.trajectoryDir || TRAJECTORY_DIR;
  const diffCounters = estimateChangedEloc();

  if (params.persist === false && !params.trajectoryDir) {
    const prevLt = params.prevBaseline?.trajectory?.lifetime || null;
    return {
      runEloc: {
        processed: diffCounters?.processed || 0,
        unique: diffCounters?.unique || 0,
        changed: diffCounters?.changed || 0,
        semantic: diffCounters?.semantic || 0,
      },
      lifetime: prevLt,
      gateVerdict: { pass: true },
    };
  }

  const trajectoryAccumulator = new TrajectoryAccumulator(trajectoryDir);
  const scoreVector = ALL_QUALITY_DIMENSIONS.map((dim) => {
    return params.projectScore.tenDimensions?.[dim] ?? DEFAULT_MAX_SCORE;
  });

  const prevFilesMap = readExistingBaselineSignatures();
  const { addedDebtPoints, resolvedDebtPoints, regressionFindingsCount } =
    calculateStructuralDebtDelta({
      prevFilesMap,
      currentIssues: params.issues || [],
      currentDebtByTier: params.debtByTier,
      prevBaseline: params.prevBaseline,
    });

  const beforeScore =
    params.prevBaseline?.metrics?.compositeScore ?? params.projectScore.compositeScore;
  const afterScore = params.projectScore.compositeScore;

  const gitRev = getGitRevision(ROOT);
  const ruleSig = params.snapshot.rulesDigest.slice(0, DIGEST_REVISION_LENGTH);
  const revision = gitRev || ruleSig;

  return trajectoryAccumulator.recordAuditRun({
    runId: `run-${params.snapshot.snapshotId}`,
    revision,
    sig: ruleSig,
    module: MODULE_NAME_AUTO_ENGINE,
    agent: AGENT_NAME_SELF_AUDIT,
    timestamp: params.startTime,
    scannedFiles: params.scannedFilesList,
    beforeScore,
    afterScore,
    scoreVector,
    addedDebtPoints,
    resolvedDebtPoints,
    regressionFindingsCount,
    diffCounters,
    sliceDeltaQ: params.sliceDeltaQ,
  });
}

function buildMetricsSummary(projectScore, scanReport, issues, debtByTier) {
  const suppressedCount = scanReport.summary.suppressedCount || 0;
  const technicalDebt = scanReport.qualityScore?.technicalDebt;
  const sqale = technicalDebt
    ? {
        tdr: technicalDebt.technicalDebtRatio,
        remediationMinutes: technicalDebt.totalRemediationMinutes,
        grade: technicalDebt.sqaleGrade,
      }
    : null;

  return {
    compositeScore: projectScore.compositeScore,
    grade: projectScore.grade,
    autonomyRate: scanReport.autonomy?.compositeAutonomyIndex ?? null,
    sqale,
    polyglotGeneralization:
      scanReport.qualityScore?.polyglotGeneralization ??
      projectScore.polyglotGeneralization ??
      null,
    effectiveCodeDensity: projectScore.effectiveCodeDensity,
    densityTensorSummary: projectScore.densityTensorSummary ?? null,
    totalIssues: issues.length,
    suppressedIssues: suppressedCount,
    unsuppressedIssues: issues.length - suppressedCount,
    bySeverity: scanReport.summary.bySeverity,
    byDebtTier: debtByTier,
  };
}

/**
 * Builds the final self-audit baseline report object.
 */
function buildBaselineReport(params) {
  return {
    snapshotId: params.snapshot.snapshotId,
    timestamp: new Date().toISOString(),
    cai: params.scanReport.autonomy?.compositeAutonomyIndex ?? null,
    autonomy: params.scanReport.autonomy ?? null,
    polyglotGeneralization:
      params.scanReport.qualityScore?.polyglotGeneralization ??
      params.projectScore.polyglotGeneralization ??
      null,
    versions: params.snapshot.versions,
    rulesDigest: params.snapshot.rulesDigest,
    configDigest: params.snapshot.configDigest,
    scope: { root: ROOT, filesScanned: params.filesScanned, durationMs: params.durationMs },
    metrics: buildMetricsSummary(
      params.projectScore,
      params.scanReport,
      params.issues,
      params.debtByTier,
    ),
    eightPillars: {
      pillars: params.projectScore.eightPillars.pillars,
      compositeScore: params.projectScore.compositeScore,
      weights: params.projectScore.eightPillars.weights,
      ceilingsApplied: params.projectScore.eightPillars.ceilingsApplied,
    },
    tenDimensions: params.projectScore.tenDimensions,
    topHotspots: params.topHotspots,
    technicalDebtLedger: {
      summary: params.debtByTier,
      criticalItems: params.criticalItems.slice(0, DEBT_SAMPLE_LIMIT),
      highItems: params.highItems.slice(0, DEBT_SAMPLE_LIMIT),
    },
    hierarchicalBreakdown: {
      domains: params.projectScore.domains.map((d) => ({
        domainName: d.domainName,
        compositeScore: d.compositeScore,
        pillars: d.pillars,
        moduleCount: d.modules.length,
      })),
    },
    trajectory: {
      runEloc: params.trajectoryRes.runEloc,
      lifetime: params.trajectoryRes.lifetimeSummary,
      isFirstBaseline: params.trajectoryRes.isFirstBaseline,
    },
  };
}

/**
 * Populates zero-defect files into the map to avoid survivorship bias in scoring.
 *
 * @param fileIssuesMap - Map of file paths to detected issues.
 * @param fileMetrics - Array of metrics returned by scanner.
 */
function populateZeroDefectFiles(fileIssuesMap, fileMetrics) {
  if (!Array.isArray(fileMetrics)) return;
  for (const m of fileMetrics) {
    const file = m.file ?? m.filePath;
    if (file && !fileIssuesMap.has(file)) {
      fileIssuesMap.set(file, []);
    }
  }
}

/**
 * Resolves scanner execution options.
 *
 * @param options - Audit runner options.
 * @returns Scanner options configuration.
 */
function resolveAuditScanConfig(options) {
  const cpus = os.cpus();
  const cpusLen = Array.isArray(cpus) ? cpus.length : 4;
  const workers = Math.max(1, Math.min(16, cpusLen));
  return {
    root: ROOT,
    include: ['src/**/*.ts', 'scripts/*.js'],
    parser: 'oxc',
    autoTune: false,
    workers,
    cache: true,
    cacheDir: path.join(ROOT, '.auto-refactor-cache', 'self-audit'),
    logLevel: RUN_LOG_LEVEL_WARN,
    ...options.scanOptions,
  };
}

/**
 * Persists baseline report, AAS stream, and defect signatures to disk.
 *
 * @param params - Persistence configuration and reports.
 */
function writeAuditOutputs(params) {
  const { baselineOutput, aasOutput, trajectoryDir, snapshot, scanReport, baselineReport, issues } = params;
  fs.writeFileSync(baselineOutput, JSON.stringify(baselineReport, null, 2) + '\n', 'utf8');

  const cai = baselineReport.metrics.autonomyRate;
  const healthOverride = {
    score: baselineReport.metrics.compositeScore,
    grade: baselineReport.metrics.grade,
    density: baselineReport.metrics.effectiveCodeDensity,
    tensorSummary: baselineReport.metrics.densityTensorSummary,
    sqale: baselineReport.metrics.sqale,
    polyglot: baselineReport.metrics.polyglotGeneralization,
  };
  if (typeof cai === 'number') {
    healthOverride.cai = cai;
  }

  const aasContent = toAasJson(scanReport, {
    baseDir: ROOT,
    healthOverride,
  });
  fs.writeFileSync(aasOutput, aasContent + '\n', 'utf8');

  const newSignaturesMap = serializeBaselineSignatures(issues);
  const rev = snapshot.rulesDigest.slice(0, DIGEST_REVISION_LENGTH);
  writeBaselineSignatures(newSignaturesMap, rev, trajectoryDir);
}

/**
 * Run comprehensive self-audit over auto-refactor repository.
 *
 * @param options - Optional overrides for audit run.
 * @returns Complete self-audit baseline report.
 */
async function runSelfAudit(options = {}) {
  const startTime = Date.now();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const prevBaseline = readExistingBaseline();
  const snapshot = createAuditSnapshot();
  const scanConfig = resolveAuditScanConfig(options);
  const scanReport = await scan(scanConfig);

  const durationMs = Date.now() - startTime;
  const issues = Array.isArray(scanReport.issues) ? scanReport.issues : [];
  const filesScanned = scanReport.summary?.filesScanned ?? 0;

  const { debtByTier, criticalItems, highItems, fileIssuesMap } = buildDebtLedger(issues);
  populateZeroDefectFiles(fileIssuesMap, scanReport.fileMetrics);

  const fileScores = computeFileScores(fileIssuesMap);
  const projectScore = aggregateProjectScore(fileScores);
  const topHotspots = computeTopHotspots(fileScores);

  const persist = options.persist !== false;
  const trajectoryDir = options.trajectoryDir ?? (persist ? TRAJECTORY_DIR : null);

  const scannedFilesList =
    persist || Boolean(trajectoryDir) ? collectScannedFiles(scanReport.fileMetrics) : [];
  const trajectoryRes = await recordRunToTrajectory({
    snapshot,
    projectScore,
    debtByTier,
    scannedFilesList,
    startTime,
    prevBaseline,
    issues,
    trajectoryDir,
    persist,
  });

  const baselineReport = buildBaselineReport({
    snapshot,
    projectScore,
    filesScanned,
    durationMs,
    issues,
    scanReport,
    debtByTier,
    criticalItems,
    highItems,
    topHotspots,
    trajectoryRes,
  });

  if (persist) {
    writeAuditOutputs({
      baselineOutput: options.baselineOutput ?? BASELINE_OUTPUT,
      aasOutput: options.aasOutput ?? BASELINE_AAS_OUTPUT,
      trajectoryDir: trajectoryDir ?? TRAJECTORY_DIR,
      snapshot,
      scanReport,
      baselineReport,
      issues,
    });
  }

  return baselineReport;
}

/**
 * Render ASCII progress bar.
 *
 * @param metricScore - Current score value.
 * @param maxScore - Maximum possible value.
 * @param barWidth - Number of characters in the bar.
 * @returns ASCII formatted progress bar string.
 */
function formatProgressBar(
  metricScore,
  maxScore = PROGRESS_BAR_MAX,
  barWidth = PROGRESS_BAR_SEGMENTS,
) {
  const safeScore = Math.min(Math.max(0, metricScore), maxScore);
  const barLen = Math.round((safeScore / maxScore) * barWidth);
  return '█'.repeat(barLen) + '░'.repeat(Math.max(0, barWidth - barLen));
}

/**
 * Print eight strategic pillars health radar.
 *
 * @param pillars - Health radar values by pillar.
 */
function printPillarsRadar(pillars) {
  if (!pillars) return;
  console.log('--- [Eight Strategic Pillars Health Radar] ---');
  for (const [pillarName, scoreValue] of Object.entries(pillars)) {
    const progressBar = formatProgressBar(scoreValue);
    const formattedPillarName = (pillarName.charAt(0).toUpperCase() + pillarName.slice(1)).padEnd(
      PILLAR_LABEL_WIDTH,
      ' ',
    );
    console.log(`  ${formattedPillarName} : [${progressBar}] ${scoreValue.toFixed(1)}`);
  }
}

/**
 * Print ten-dimensional micro-quality indices.
 *
 * @param dimensions - Quality indices map.
 */
function printMicroDimensions(dimensions) {
  if (!dimensions) return;
  console.log('\n--- [Ten-Dimensional Micro-Quality Indices] ---');
  for (const [dimensionKey, scoreValue] of Object.entries(dimensions)) {
    const numVal = typeof scoreValue === 'number' ? scoreValue : DEFAULT_MAX_SCORE;
    const progressBar = formatProgressBar(numVal);
    const formattedDimensionName = dimensionKey.padEnd(DIMENSION_LABEL_WIDTH, ' ');
    console.log(`  ${formattedDimensionName} : [${progressBar}] ${numVal.toFixed(1)}`);
  }
}

/**
 * Print technical debt ledger and top hotspots.
 *
 * @param metrics - Audit metrics with debt tiers.
 * @param topHotspots - Identified hotspots array.
 */
function printDebtHotspots(metrics, topHotspots) {
  console.log('\n--- [Technical Debt Ledger Breakdown] ---');
  console.log(`  Critical Debt : ${metrics.byDebtTier.critical}`);
  console.log(`  High Debt     : ${metrics.byDebtTier.high}`);
  console.log(`  Medium Debt   : ${metrics.byDebtTier.medium}`);
  console.log(`  Low Debt      : ${metrics.byDebtTier.low}`);

  console.log('\n--- [Top 5 Technical Debt Hotspots for Self-Refactoring Refactoring] ---');
  for (const [index, hotspot] of topHotspots.slice(0, HOTSPOTS_DISPLAY_LIMIT).entries()) {
    console.log(
      `  ${index + 1}. ${hotspot.filePath} (${hotspot.totalIssues} issues, ` +
        `critical=${hotspot.criticalCount}, high=${hotspot.highCount}, score=${hotspot.compositeScore})`,
    );
  }
}

/**
 * Print cumulative ELOC and trajectory summary.
 *
 * @param trajectory - Trajectory result object.
 */
function printTrajectoryLedger(trajectory) {
  if (!trajectory || !trajectory.lifetime) return;
  const lifetime = trajectory.lifetime;
  console.log('\n--- [Cumulative ELOC & Long-Term Trajectory Ledger] ---');
  console.log(`  Run Processed ELOC    : ${trajectory.runEloc.processed.toLocaleString()} lines`);
  console.log(`  Lifetime Total Runs   : ${lifetime.totalRuns}`);
  console.log(
    `  Lifetime Processed    : ${lifetime.eloc.processedTotal.toLocaleString()} lines (Additive Accumulation)`,
  );
  console.log(
    `  Lifetime Unique (AST) : ${lifetime.eloc.uniqueTotal.toLocaleString()} lines (Deduplicated Coverage)`,
  );
  console.log(`  Lifetime Gate Pass %  : ${lifetime.gatePassRate.toFixed(1)}%`);
}

/**
 * Print terminal formatted executive dashboard.
 *
 * @param report - Self-audit baseline report.
 * @param isCheckMode - Whether run is in check/dry-run mode.
 */
function printTerminalDashboard(report, isCheckMode = false) {
  console.log('================================================================');
  console.log('       AUTO-REFACTOR SYSTEM SELF-AUDIT BASELINE       ');
  console.log('================================================================\n');

  console.log(`Snapshot ID    : ${report.snapshotId}`);
  console.log(`Engine Version : ${report.versions.engineVersion}`);
  console.log(
    `Rule Version   : ${report.versions.ruleVersion} (${report.rulesDigest.slice(0, DIGEST_REVISION_LENGTH)})`,
  );
  console.log(
    `Files Scanned  : ${report.scope.filesScanned} files in ${(report.scope.durationMs / MILLISECONDS_PER_SECOND).toFixed(2)}s`,
  );
  console.log(`Total Issues   : ${report.metrics.totalIssues}`);
  console.log(
    `Composite Score: ${report.metrics.compositeScore} / 100.0 (Grade: ${report.metrics.grade})`,
  );
  console.log(
    `Code Density   : ${(report.metrics.effectiveCodeDensity * PERCENT_MULTIPLIER).toFixed(1)}%`,
  );
  if (report.metrics.sqale) {
    const sq = report.metrics.sqale;
    console.log(
      `SQALE TDR      : ${sq.tdr.toFixed(1)}% [Grade: ${sq.grade}] (Remediation: ${(sq.remediationMinutes / 60).toFixed(1)}h / ${sq.remediationMinutes}min)`,
    );
  }
  if (report.metrics.densityTensorSummary) {
    const ts = report.metrics.densityTensorSummary;
    const mDist = ts.averageMahalanobisDistance !== undefined ? ` | Mahalanobis: ${ts.averageMahalanobisDistance.toFixed(2)}` : '';
    console.log(
      `5D Tensor      : TSPR ${(ts.averageTspr * PERCENT_MULTIPLIER).toFixed(0)}% | POR ${(ts.averagePor * PERCENT_MULTIPLIER).toFixed(0)}% | ColDensity ${(ts.averageColumnDensity * PERCENT_MULTIPLIER).toFixed(0)}%${mDist}`,
    );
  }
  console.log('');

  printPillarsRadar(report.eightPillars && report.eightPillars.pillars);
  printMicroDimensions(report.tenDimensions);
  printDebtHotspots(report.metrics, report.topHotspots);
  printTrajectoryLedger(report.trajectory);

  console.log('\n================================================================');
  if (isCheckMode) {
    console.log('✔ Baseline Verified in Read-Only Mode (Zero Disk Mutation)');
  } else {
    console.log(`✔ Baseline Report Saved to: ${path.relative(ROOT, BASELINE_OUTPUT)}`);
  }
  console.log('================================================================\n');
}

function assertCompositeRegression(report, prev) {
  const prevScore = prev?.metrics?.compositeScore;
  if (typeof prevScore === 'number' && report.metrics.compositeScore < prevScore - 0.05) {
    console.error(`❌ Quality regression: ${report.metrics.compositeScore} < baseline ${prevScore}`);
    process.exit(1);
  }
}

function assertDimensionRegression(report, prev) {
  if (!prev?.tenDimensions || !report.tenDimensions) return;
  const MAX_TOLERANCE = 3.0;
  for (const [dim, prevVal] of Object.entries(prev.tenDimensions)) {
    const currVal = report.tenDimensions[dim];
    if (typeof prevVal === 'number' && typeof currVal === 'number' && currVal < prevVal - MAX_TOLERANCE) {
      console.error(`❌ Dimension regression in [${dim}]: ${currVal.toFixed(1)} < ${prevVal.toFixed(1)}`);
      process.exit(1);
    }
  }
}

function assertDebtBoundaries(report, prev) {
  const tiers = report.metrics.byDebtTier;
  const evaluation = evaluateElasticDebtBudget(tiers, {
    totalFiles: report.scope ? report.scope.filesScanned : undefined,
    compositeScore: report.metrics ? report.metrics.compositeScore : undefined,
    baselineDebt: prev?.metrics?.byDebtTier,
  });

  if (!evaluation.isWithinBudget) {
    const err = evaluation.violations.map((v) => v.message).join('; ');
    console.error(`❌ Technical debt breached elastic budget thresholds: ${err}`);
    process.exit(1);
  }

  if (tiers.critical > 0 || tiers.high > 0) {
    console.log(
      `ℹ️ [Debt Gate] Elastic allowance active: critical=${tiers.critical}/${evaluation.dynamicLimits.critical}, high=${tiers.high}/${evaluation.dynamicLimits.high} (verdict: ${evaluation.verdict})`,
    );
  }
}

function verifyCliCheckMode(report) {
  const prev = readExistingBaseline();
  assertCompositeRegression(report, prev);
  assertDimensionRegression(report, prev);
  assertDebtBoundaries(report, prev);
  console.log('✔ [Check] Self-audit baseline verification passed with zero disk mutation.');
}

// CLI execution entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isCheckMode =
    args.includes('--check') || args.includes('--dry-run') || args.includes('--verify');
  const isUpdateMode = args.includes('--update') || args.includes('--write');

  runSelfAudit({
    persist: isUpdateMode || !isCheckMode,
    check: isCheckMode,
  })
    .then((report) => {
      printTerminalDashboard(report, isCheckMode);
      if (isCheckMode) {
        verifyCliCheckMode(report);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Self-audit execution failed:', err);
      process.exit(1);
    });
}

module.exports = {
  runSelfAudit,
  classifyDebtTier,
  BASELINE_OUTPUT,
  BASELINE_AAS_OUTPUT,
};
