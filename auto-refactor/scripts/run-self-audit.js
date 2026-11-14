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

const fs = require('fs');
const os = require('os');
const path = require('node:path');
const { execSync } = require('child_process');

const DIST_API_MODULE = '../dist/api';
const {
  scan,
  createAuditSnapshot,
  TrajectoryAccumulator,
  ALL_QUALITY_DIMENSIONS,
  toAasJson,
  evaluateElasticDebtBudget,
  classifyElasticDebtTier: classifyDebtTier,
  buildDebtLedger,
  serializeBaselineSignatures,
  calculateStructuralDebtDelta,
  estimateChangedElocFromNumstat,
} = require(DIST_API_MODULE);

const DIR_REPORTS = 'reports';
const FILE_BASELINE = 'self-audit-baseline.json';
/** Token-frugal, topologically-grouped AAS v1.0 report. */
const FILE_BASELINE_AAS = 'self-audit-baseline.aas.json';
const FILE_BASELINE_SIGNATURES = 'baseline-signatures.json';
const DIR_SELF_AUDIT_CACHE = 'self-audit';

const STDIO_MODE_PIPE = 'pipe';
const PILLAR_LABEL_WIDTH = 16;
const DIMENSION_LABEL_WIDTH = 24;

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, DIR_REPORTS);
const BASELINE_OUTPUT = path.join(REPORTS_DIR, FILE_BASELINE);
/** Agent Audit Schema (AAS v1.0) report artifact. */
const BASELINE_AAS_OUTPUT = path.join(REPORTS_DIR, FILE_BASELINE_AAS);
const TRAJECTORY_DIR = path.join(ROOT, '.refactor-trajectory');
const BASELINE_SIGNATURES_FILE = path.join(TRAJECTORY_DIR, FILE_BASELINE_SIGNATURES);

const MODULE_NAME_AUTO_ENGINE = 'auto-refactor-engine';
const AGENT_NAME_SELF_AUDIT = 'self-audit-engine';
const DEFAULT_MAX_SCORE = 100.0;
const DIGEST_REVISION_LENGTH = 8;
const MIN_GIT_SHA_LENGTH = 7;
const GIT_REF_PREFIX = 'ref: ';
const GIT_REF_PREFIX_LENGTH = GIT_REF_PREFIX.length;
const DEFAULT_FALLBACK_CPUS = 4;
const MAX_PARALLEL_WORKERS = 16;
const MINUTES_PER_HOUR = 60;
const PROGRESS_BAR_SEGMENTS = 20;
const PROGRESS_BAR_MAX = 100;
const HOTSPOTS_DISPLAY_LIMIT = 5;
const DEBT_SAMPLE_LIMIT = 50;
const MILLISECONDS_PER_SECOND = 1000;
const PERCENT_MULTIPLIER = 100;
const RUN_LOG_LEVEL_WARN = 'warn';

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
    const signaturesPath = path.join(trajectoryDir, FILE_BASELINE_SIGNATURES);
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
    const out = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) return out.slice(0, DIGEST_REVISION_LENGTH);
  } catch {
    // Best-effort fallback to disk
  }
  try {
    const gitDir = path.join(root, '..', '.git');
    if (!fs.existsSync(gitDir)) return null;
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) return null;
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith(GIT_REF_PREFIX)) {
      return head.length >= MIN_GIT_SHA_LENGTH ? head.slice(0, DIGEST_REVISION_LENGTH) : null;
    }
    const refName = head.slice(GIT_REF_PREFIX_LENGTH);
    const refPath = path.join(gitDir, refName);
    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, 'utf8').trim().slice(0, DIGEST_REVISION_LENGTH);
    }
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
      lifetimeSummary: prevLt,
      isFirstBaseline: Boolean(params.prevBaseline?.trajectory?.isFirstBaseline),
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
        moduleCount: typeof d.moduleCount === 'number' ? d.moduleCount : (d.modules?.length ?? 0),
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
 * Resolves scanner execution options.
 *
 * @param options - Audit runner options.
 * @returns Scanner options configuration.
 */
function resolveAuditScanConfig(options) {
  const cpus = os.cpus();
  const cpusLen = Array.isArray(cpus) ? cpus.length : DEFAULT_FALLBACK_CPUS;
  const workers = Math.max(1, Math.min(MAX_PARALLEL_WORKERS, cpusLen));
  return {
    root: ROOT,
    include: ['src/**/*.ts', 'scripts/*.js'],
    parser: 'oxc',
    autoTune: false,
    workers,
    cache: true,
    cacheDir: path.join(ROOT, '.auto-refactor-cache', DIR_SELF_AUDIT_CACHE),
    logLevel: RUN_LOG_LEVEL_WARN,
    persistGovernanceSnapshot:
      options.persist !== false && !options.skipTrajectoryWrite && !options.trajectoryDir,
    ...options.scanOptions,
  };
}

function buildFileContentLookup(scannedFilesList) {
  const fileContentMap = new Map();
  if (!Array.isArray(scannedFilesList)) return fileContentMap;
  for (const entry of scannedFilesList) {
    if (!entry || !entry.filePath || typeof entry.content !== 'string') continue;
    const rawNormalized = entry.filePath.replace(/\\/g, '/');
    fileContentMap.set(rawNormalized, entry.content);
    const relPath = path.isAbsolute(entry.filePath)
      ? path.relative(ROOT, entry.filePath).replace(/\\/g, '/')
      : rawNormalized;
    fileContentMap.set(relPath, entry.content);
  }
  return fileContentMap;
}

/**
 * Persists baseline report, AAS stream, and defect signatures to disk.
 *
 * @param auditContext - Audit execution context holding scan findings and configurations.
 * @param baselineReport - Generated baseline report.
 * @param options - Audit runner options.
 */
function writeAuditOutputs(auditContext, baselineReport, options = {}) {
  const baselineOutput = options.baselineOutput ?? BASELINE_OUTPUT;
  const aasOutput = options.aasOutput ?? BASELINE_AAS_OUTPUT;
  const trajectoryDir = auditContext.trajectoryDir ?? TRAJECTORY_DIR;

  fs.writeFileSync(baselineOutput, JSON.stringify(baselineReport, null, 2) + '\n', 'utf8');

  const fileContentMap = buildFileContentLookup(auditContext.scannedFilesList);
  const aasContent = toAasJson(auditContext.scanReport, {
    baseDir: ROOT,
    includeDimensionDetails: true,
    fileReader: (relativeFilePath) =>
      fileContentMap.get(String(relativeFilePath).replace(/\\/g, '/')),
  });
  fs.writeFileSync(aasOutput, aasContent + '\n', 'utf8');

  if (!auditContext.skipTrajectoryWrite) {
    const newSignaturesMap = serializeBaselineSignatures(auditContext.issues);
    const rev = auditContext.snapshot.rulesDigest.slice(0, DIGEST_REVISION_LENGTH);
    writeBaselineSignatures(newSignaturesMap, rev, trajectoryDir);
  }
}

/**
 * Extracts and maps project score structure from scanner governance report.
 */
function extractGovernanceProjectScore(governance) {
  if (!governance) {
    throw new Error('ScanReport is missing native governance breakdown.');
  }
  return {
    compositeScore: governance.hierarchicalCompositeScore,
    grade: governance.grade,
    eightPillars: governance.eightPillars,
    tenDimensions: governance.tenDimensions,
    effectiveCodeDensity: governance.effectiveCodeDensity,
    densityTensorSummary: governance.densityTensorSummary,
    domains: governance.domains,
  };
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
  const rawIssues = Array.isArray(scanReport.issues) ? scanReport.issues : [];
  const issues = rawIssues.filter((issue) => !issue.clusteredInto);
  const filesScanned = scanReport.summary?.filesScanned ?? 0;

  const { debtByTier, criticalItems, highItems } = buildDebtLedger(issues);
  const projectScore = extractGovernanceProjectScore(scanReport.governance);
  const topHotspots = scanReport.governance.topHotspots;

  const persist = options.persist !== false;
  const skipTrajectoryWrite = Boolean(options.skipTrajectoryWrite);
  const trajectoryDir =
    options.trajectoryDir ?? (persist && !skipTrajectoryWrite ? TRAJECTORY_DIR : null);

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
    persist: persist && !skipTrajectoryWrite,
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
    const auditContext = {
      snapshot,
      scanReport,
      issues,
      scannedFilesList,
      trajectoryDir,
      skipTrajectoryWrite,
    };
    writeAuditOutputs(auditContext, baselineReport, options);
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
    const sqaleSummary = report.metrics.sqale;
    console.log(
      `SQALE TDR      : ${sqaleSummary.tdr.toFixed(1)}% [Grade: ${sqaleSummary.grade}] (Remediation: ${(sqaleSummary.remediationMinutes / MINUTES_PER_HOUR).toFixed(1)}h / ${sqaleSummary.remediationMinutes}min)`,
    );
  }
  if (report.metrics.densityTensorSummary) {
    const tensorSummary = report.metrics.densityTensorSummary;
    const mDist =
      tensorSummary.averageMahalanobisDistance !== undefined
        ? ` | Mahalanobis: ${tensorSummary.averageMahalanobisDistance.toFixed(2)}`
        : '';
    console.log(
      `5D Tensor      : TSPR ${(tensorSummary.averageTspr * PERCENT_MULTIPLIER).toFixed(0)}% | POR ${(tensorSummary.averagePor * PERCENT_MULTIPLIER).toFixed(0)}% | ColDensity ${(tensorSummary.averageColumnDensity * PERCENT_MULTIPLIER).toFixed(0)}%${mDist}`,
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
    console.error(
      `❌ Quality regression: ${report.metrics.compositeScore} < baseline ${prevScore}`,
    );
    process.exit(1);
  }
}

function assertDimensionRegression(report, prev) {
  if (!prev?.tenDimensions || !report.tenDimensions) return;
  const MAX_TOLERANCE = 3.0;
  for (const [dim, prevVal] of Object.entries(prev.tenDimensions)) {
    const currVal = report.tenDimensions[dim];
    if (
      typeof prevVal === 'number' &&
      typeof currVal === 'number' &&
      currVal < prevVal - MAX_TOLERANCE
    ) {
      console.error(
        `❌ Dimension regression in [${dim}]: ${currVal.toFixed(1)} < ${prevVal.toFixed(1)}`,
      );
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
  const isReportsOnly = args.includes('--reports-only');

  runSelfAudit({
    persist: isUpdateMode || isReportsOnly || !isCheckMode,
    skipTrajectoryWrite: isReportsOnly,
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
