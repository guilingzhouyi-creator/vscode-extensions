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
} = require(MODULE_API);

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, DIR_REPORTS);
const BASELINE_OUTPUT = path.join(REPORTS_DIR, FILE_BASELINE);
const TRAJECTORY_DIR = path.join(ROOT, '.refactor-trajectory');

const TIER_CRITICAL = 'critical';
const TIER_HIGH = 'high';
const TIER_MEDIUM = 'medium';
const TIER_LOW = 'low';
const SEVERITY_ERROR = 'error';
const SEVERITY_WARNING = 'warning';
const MODULE_NAME_AUTO_ENGINE = 'auto-refactor-engine';
const AGENT_NAME_SELF_AUDIT = 'self-audit-engine';
const DEFAULT_MAX_SCORE = 100.0;
const DIGEST_REVISION_LENGTH = 8;
const PROGRESS_BAR_SEGMENTS = 20;
const PROGRESS_BAR_MAX = 100;
const HOTSPOTS_DISPLAY_LIMIT = 5;
const TOP_HOTSPOTS_LIMIT = 10;
const CRITICAL_WEIGHT = 10;
const HIGH_WEIGHT = 3;
const DEBT_SAMPLE_LIMIT = 50;
const MILLISECONDS_PER_SECOND = 1000;
const PERCENT_MULTIPLIER = 100;
const RUN_LOG_LEVEL_WARN = 'warn';

const CRITICAL_RULE_RE = /^(?:ARCH-|clean-layer-violation$|expensive-loop-operation$)/;
const HIGH_RULE_RE = /^(?:high-complexity$|CPX-|PRF-|DAT-|TST-TAU|GOV-GAM)/;
const MEDIUM_RULE_RE =
  /^(?:large-file$|BIG-|SIM-|magic-number$|hardcoded-string$|duplicate-literal$|GOV-LOG)/;

/**
 * Classify an issue into technical debt tiers (Critical, High, Medium, Low).
 *
 * @param issue - Issue finding to classify.
 * @returns Debt classification tier.
 */
function classifyDebtTier(issue) {
  const rule = issue.rule || '';
  const sev = issue.severity || SEVERITY_WARNING;

  if (sev === SEVERITY_ERROR || CRITICAL_RULE_RE.test(rule)) {
    return TIER_CRITICAL;
  }
  if (rule === 'CPX-TRV-001') {
    return TIER_MEDIUM;
  }
  if (HIGH_RULE_RE.test(rule)) {
    return TIER_HIGH;
  }
  return MEDIUM_RULE_RE.test(rule) ? TIER_MEDIUM : TIER_LOW;
}

/**
 * Classify issues into debt tiers and organize them by file and tier.
 *
 * @param issues - Flat list of detected issues.
 * @returns Partitioned debt ledger and file mapping.
 */
function buildDebtLedger(issues) {
  const debtByTier = {
    [TIER_CRITICAL]: 0,
    [TIER_HIGH]: 0,
    [TIER_MEDIUM]: 0,
    [TIER_LOW]: 0,
  };
  const criticalItems = [];
  const highItems = [];
  const fileIssuesMap = new Map();

  for (const issue of issues) {
    const tier = classifyDebtTier(issue);
    debtByTier[tier]++;

    const filePath = issue.location?.file || 'unknown';
    if (!fileIssuesMap.has(filePath)) {
      fileIssuesMap.set(filePath, []);
    }
    fileIssuesMap.get(filePath).push(issue);

    const ledgerEntry = {
      id: issue.id,
      rule: issue.rule,
      tier,
      severity: issue.severity,
      file: filePath,
      line: issue.location?.start?.line || 1,
      message: issue.message,
    };

    if (tier === TIER_CRITICAL) {
      criticalItems.push(ledgerEntry);
    } else if (tier === TIER_HIGH) {
      highItems.push(ledgerEntry);
    }
  }

  return { debtByTier, criticalItems, highItems, fileIssuesMap };
}

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

/**
 * Computes weighted debt points from debt tier counts.
 *
 * @param byDebtTier - Tier breakdown object.
 * @returns Total debt points.
 */
function computeTotalDebtPoints(byDebtTier) {
  if (!byDebtTier) return 0;
  const critical = byDebtTier[TIER_CRITICAL] || 0;
  const high = byDebtTier[TIER_HIGH] || 0;
  const medium = byDebtTier[TIER_MEDIUM] || 0;
  return critical * CRITICAL_WEIGHT + high * HIGH_WEIGHT + medium;
}

const GIT_DIFF_NUMSTAT_CMD = 'git diff --numstat HEAD~1';
const MIN_NUMSTAT_PARTS = 3;
const SEMANTIC_ELOC_RATIO = 0.8;
const ADDED_ELOC_RATIO = 0.5;

/**
 * Estimates physical and semantic changed ELOC from git diff if available.
 *
 * @returns Estimated diff counters or undefined.
 */
function estimateChangedEloc() {
  try {
    const out = execSync(GIT_DIFF_NUMSTAT_CMD, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: STDIO_MODE_PIPE,
    });
    let changed = 0;
    const lines = out.trim().split('\n');
    for (const l of lines) {
      if (!l) continue;
      const parts = l.split('\t');
      if (parts.length >= MIN_NUMSTAT_PARTS) {
        const add = parseInt(parts[0], 10) || 0;
        const del = parseInt(parts[1], 10) || 0;
        changed += add + del;
      }
    }
    if (changed > 0) {
      const semantic = Math.max(1, Math.round(changed * SEMANTIC_ELOC_RATIO));
      return { changed, semantic, added: Math.round(changed * ADDED_ELOC_RATIO) };
    }
  } catch (err) {
    void err;
  }
  return undefined;
}

/**
 * Records an audit run into the persistent trajectory accumulator ledger.
 */
async function recordRunToTrajectory(params) {
  const trajectoryAccumulator = new TrajectoryAccumulator(TRAJECTORY_DIR);
  const scoreVector = ALL_QUALITY_DIMENSIONS.map((dim) => {
    return params.projectScore.tenDimensions?.[dim] ?? DEFAULT_MAX_SCORE;
  });

  const currentDebtPoints = computeTotalDebtPoints(params.debtByTier);
  const prevDebtPoints = params.prevBaseline?.metrics?.byDebtTier
    ? computeTotalDebtPoints(params.prevBaseline.metrics.byDebtTier)
    : currentDebtPoints;

  const resolvedDebtPoints = Math.max(0, prevDebtPoints - currentDebtPoints);
  const addedDebtPoints = Math.max(0, currentDebtPoints - prevDebtPoints);

  const beforeScore =
    params.prevBaseline?.metrics?.compositeScore ?? params.projectScore.compositeScore;
  const afterScore = params.projectScore.compositeScore;
  const diffCounters = estimateChangedEloc();

  return trajectoryAccumulator.recordAuditRun({
    runId: `run-${params.snapshot.snapshotId}`,
    revision: params.snapshot.rulesDigest.slice(0, DIGEST_REVISION_LENGTH),
    module: MODULE_NAME_AUTO_ENGINE,
    agent: AGENT_NAME_SELF_AUDIT,
    timestamp: params.startTime,
    scannedFiles: params.scannedFilesList,
    beforeScore,
    afterScore,
    scoreVector,
    addedDebtPoints,
    resolvedDebtPoints,
    regressionFindingsCount: 0,
    diffCounters,
  });
}

function buildMetricsSummary(projectScore, scanReport, issues, debtByTier) {
  const suppressedCount = scanReport.summary.suppressedCount || 0;
  return {
    compositeScore: projectScore.compositeScore,
    grade: projectScore.grade,
    autonomyRate: scanReport.autonomy?.compositeAutonomyIndex ?? null,
    polyglotGeneralization:
      scanReport.qualityScore?.polyglotGeneralization ??
      projectScore.polyglotGeneralization ??
      null,
    effectiveCodeDensity: projectScore.effectiveCodeDensity,
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
 * Run comprehensive self-audit over auto-refactor repository.
 *
 * @param options - Optional overrides for audit run.
 * @returns Complete self-audit baseline report.
 */
async function runSelfAudit(options = {}) {
  const startTime = Date.now();
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  // 0. Read existing baseline before snapshot
  const prevBaseline = readExistingBaseline();

  // 1. Create Immutable Audit Snapshot (E, R, C, L, S)
  const snapshot = createAuditSnapshot();

  // 2. Execute Full Production Scan over Engine Sources
  const defaultWorkers = Math.max(1, Math.min(4, os.cpus().length || 4));
  const scanReport = await scan({
    root: ROOT,
    include: ['src/**/*.ts', 'scripts/*.js'],
    autoTune: false,
    workers: defaultWorkers,
    logLevel: RUN_LOG_LEVEL_WARN,
    ...options.scanOptions,
  });

  const durationMs = Date.now() - startTime;
  const issues = scanReport.issues || [];
  const filesScanned = scanReport.summary.filesScanned || 0;

  // 3. Classify Technical Debt Ledger
  const { debtByTier, criticalItems, highItems, fileIssuesMap } = buildDebtLedger(issues);

  // Supplement zero-defect files: populate fileIssuesMap from fileMetrics
  // to avoid survivorship bias in scores.
  if (Array.isArray(scanReport.fileMetrics)) {
    for (const m of scanReport.fileMetrics) {
      const file = m.file || m.filePath;
      if (file && !fileIssuesMap.has(file)) {
        fileIssuesMap.set(file, []);
      }
    }
  }

  // 4. File-Level and Hierarchical Eight-Pillar Scoring
  const fileScores = computeFileScores(fileIssuesMap);
  const projectScore = aggregateProjectScore(fileScores);

  // 5. Identify Top Refactoring Hotspots for Self-Refactoring
  const topHotspots = computeTopHotspots(fileScores);

  // 6. Automatically Record Run into Trajectory Accumulator
  const scannedFilesList = collectScannedFiles(scanReport.fileMetrics);
  const trajectoryRes = await recordRunToTrajectory({
    snapshot,
    projectScore,
    debtByTier,
    scannedFilesList,
    startTime,
    prevBaseline,
  });

  // 7. Build Baseline Report Object
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

  // 8. Write to reports/self-audit-baseline.json
  fs.writeFileSync(BASELINE_OUTPUT, JSON.stringify(baselineReport, null, 2) + '\n', 'utf8');

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
  for (const [pillar, val] of Object.entries(pillars)) {
    const progressBar = formatProgressBar(val);
    const pName = (pillar.charAt(0).toUpperCase() + pillar.slice(1)).padEnd(
      PILLAR_LABEL_WIDTH,
      ' ',
    );
    console.log(`  ${pName} : [${progressBar}] ${val.toFixed(1)}`);
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
  for (const [dim, val] of Object.entries(dimensions)) {
    const numVal = typeof val === 'number' ? val : DEFAULT_MAX_SCORE;
    const progressBar = formatProgressBar(numVal);
    const dName = dim.padEnd(DIMENSION_LABEL_WIDTH, ' ');
    console.log(`  ${dName} : [${progressBar}] ${numVal.toFixed(1)}`);
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
  for (const [idx, h] of topHotspots.slice(0, HOTSPOTS_DISPLAY_LIMIT).entries()) {
    console.log(
      `  ${idx + 1}. ${h.filePath} (${h.totalIssues} issues, ` +
        `critical=${h.criticalCount}, high=${h.highCount}, score=${h.compositeScore})`,
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
  const lt = trajectory.lifetime;
  console.log('\n--- [Cumulative ELOC & Long-Term Trajectory Ledger] ---');
  console.log(`  Run Processed ELOC    : ${trajectory.runEloc.processed.toLocaleString()} lines`);
  console.log(`  Lifetime Total Runs   : ${lt.totalRuns}`);
  console.log(
    `  Lifetime Processed    : ${lt.eloc.processedTotal.toLocaleString()} lines (Additive Accumulation)`,
  );
  console.log(
    `  Lifetime Unique (AST) : ${lt.eloc.uniqueTotal.toLocaleString()} lines (Deduplicated Coverage)`,
  );
  console.log(`  Lifetime Gate Pass %  : ${lt.gatePassRate.toFixed(1)}%`);
}

/**
 * Print terminal formatted executive dashboard.
 *
 * @param report - Self-audit baseline report.
 */
function printTerminalDashboard(report) {
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
    `Code Density   : ${(report.metrics.effectiveCodeDensity * PERCENT_MULTIPLIER).toFixed(1)}%\n`,
  );

  printPillarsRadar(report.eightPillars && report.eightPillars.pillars);
  printMicroDimensions(report.tenDimensions);
  printDebtHotspots(report.metrics, report.topHotspots);
  printTrajectoryLedger(report.trajectory);

  console.log('\n================================================================');
  console.log(`✔ Baseline Report Saved to: ${path.relative(ROOT, BASELINE_OUTPUT)}`);
  console.log('================================================================\n');
}

// CLI execution entrypoint
if (require.main === module) {
  runSelfAudit()
    .then((report) => {
      printTerminalDashboard(report);
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
};
