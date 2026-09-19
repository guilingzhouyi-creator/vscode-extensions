/**
 * Module: Static Quality Assurance — Self-Audit Baseline Runner (Reviewer -> Reviewer)
 * File Path: scripts/run-self-audit.js
 * Architecture Role: Production-grade self-examination runner that uses the immutable
 *   AuditSnapshot sandbox to audit the engine itself with the full 8-pillar quality model,
 *   extracting technical debt ledgers (Critical/High/Medium/Low) without code privilege.
 * Dependencies & Triggers: Consumes ../dist/api; writes reports/self-audit-baseline.json.
 * Responsibilities: Run full-repo scan, compute 8-pillar scores, classify technical debt,
 *   identify top refactoring hotspots, and export the official Phase 9 baseline report.
 * Exit Semantics & Design Rationale: Standalone executable CLI & programmatic function.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  scan,
  createAuditSnapshot,
  scoreFileQuality,
  aggregateProjectScore,
  extractDomainName,
} = require('../dist/api');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const BASELINE_OUTPUT = path.join(REPORTS_DIR, 'self-audit-baseline.json');

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
  const sev = issue.severity || 'warning';

  if (sev === 'error' || CRITICAL_RULE_RE.test(rule)) {
    return 'critical';
  }
  if (HIGH_RULE_RE.test(rule)) {
    return 'high';
  }
  if (MEDIUM_RULE_RE.test(rule)) {
    return 'medium';
  }
  return 'low';
}

/**
 * Classify issues into debt tiers and organize them by file and tier.
 *
 * @param issues - Flat list of detected issues.
 * @returns Partitioned debt ledger and file mapping.
 */
function buildDebtLedger(issues) {
  const debtByTier = { critical: 0, high: 0, medium: 0, low: 0 };
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

    if (tier === 'critical') {
      criticalItems.push(ledgerEntry);
    } else if (tier === 'high') {
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
    .slice(0, 10)
    .map((f) => {
      const cCount = f.issues.filter((i) => classifyDebtTier(i) === 'critical').length;
      const hCount = f.issues.filter((i) => classifyDebtTier(i) === 'high').length;
      return {
        filePath: f.filePath,
        domain: f.domainName,
        totalIssues: f.issues.length,
        criticalCount: cCount,
        highCount: hCount,
        compositeScore: f.compositeScore,
        effectiveDensity: f.effectiveDensity,
      };
    });
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

  // 1. Create Immutable Audit Snapshot (E, R, C, L, S)
  const snapshot = createAuditSnapshot();

  // 2. Execute Full Production Scan over Engine Sources
  const scanReport = await scan({
    root: ROOT,
    include: ['src/**/*.ts', 'scripts/*.js'],
    autoTune: false,
    logLevel: 'warn',
    ...options.scanOptions,
  });

  const durationMs = Date.now() - startTime;
  const issues = scanReport.issues || [];
  const filesScanned = scanReport.summary.filesScanned || 0;

  // 3. Classify Technical Debt Ledger
  const { debtByTier, criticalItems, highItems, fileIssuesMap } = buildDebtLedger(issues);

  // 4. File-Level and Hierarchical Eight-Pillar Scoring
  const fileScores = computeFileScores(fileIssuesMap);
  const projectScore = aggregateProjectScore(fileScores);

  // 5. Identify Top Refactoring Hotspots for Phase 10
  const topHotspots = computeTopHotspots(fileScores);

  // 6. Build Baseline Report Object
  const baselineReport = {
    snapshotId: snapshot.snapshotId,
    timestamp: new Date().toISOString(),
    versions: snapshot.versions,
    rulesDigest: snapshot.rulesDigest,
    configDigest: snapshot.configDigest,
    scope: {
      root: ROOT,
      filesScanned,
      durationMs,
    },
    metrics: {
      compositeScore: projectScore.compositeScore,
      grade: projectScore.grade,
      effectiveCodeDensity: projectScore.effectiveCodeDensity,
      totalIssues: issues.length,
      suppressedIssues: scanReport.summary.suppressedCount || 0,
      unsuppressedIssues: issues.length - (scanReport.summary.suppressedCount || 0),
      bySeverity: scanReport.summary.bySeverity,
      byDebtTier: debtByTier,
    },
    eightPillars: {
      pillars: projectScore.eightPillars.pillars,
      compositeScore: projectScore.compositeScore,
      weights: projectScore.eightPillars.weights,
      ceilingsApplied: projectScore.eightPillars.ceilingsApplied,
    },
    topHotspots,
    technicalDebtLedger: {
      summary: debtByTier,
      criticalItems: criticalItems.slice(0, 50),
      highItems: highItems.slice(0, 50),
    },
    hierarchicalBreakdown: {
      domains: projectScore.domains.map((d) => ({
        domainName: d.domainName,
        compositeScore: d.compositeScore,
        pillars: d.pillars,
        moduleCount: d.modules.length,
      })),
    },
  };

  // 7. Write to reports/self-audit-baseline.json
  fs.writeFileSync(BASELINE_OUTPUT, JSON.stringify(baselineReport, null, 2), 'utf8');

  return baselineReport;
}

/**
 * Print terminal formatted executive dashboard.
 *
 * @param report - Self-audit baseline report.
 */
function printTerminalDashboard(report) {
  console.log('================================================================');
  console.log('       AUTO-REFACTOR SYSTEM SELF-AUDIT BASELINE (PHASE 9)       ');
  console.log('================================================================\n');

  console.log(`Snapshot ID    : ${report.snapshotId}`);
  console.log(`Engine Version : ${report.versions.engineVersion}`);
  console.log(
    `Rule Version   : ${report.versions.ruleVersion} (${report.rulesDigest.slice(0, 8)})`,
  );
  console.log(
    `Files Scanned  : ${report.scope.filesScanned} files in ${(report.scope.durationMs / 1000).toFixed(2)}s`,
  );
  console.log(`Total Issues   : ${report.metrics.totalIssues}`);
  console.log(
    `Composite Score: ${report.metrics.compositeScore} / 100.0 (Grade: ${report.metrics.grade})`,
  );
  console.log(`Code Density   : ${(report.metrics.effectiveCodeDensity * 100).toFixed(1)}%\n`);

  console.log('--- [Eight Strategic Pillars Health Radar] ---');
  const pillars = report.eightPillars.pillars;
  for (const [pillar, val] of Object.entries(pillars)) {
    const barLen = Math.round(val / 5);
    const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
    const pName = (pillar.charAt(0).toUpperCase() + pillar.slice(1)).padEnd(16, ' ');
    console.log(`  ${pName} : [${bar}] ${val.toFixed(1)}`);
  }

  console.log('\n--- [Technical Debt Ledger Breakdown] ---');
  console.log(`  Critical Debt : ${report.metrics.byDebtTier.critical}`);
  console.log(`  High Debt     : ${report.metrics.byDebtTier.high}`);
  console.log(`  Medium Debt   : ${report.metrics.byDebtTier.medium}`);
  console.log(`  Low Debt      : ${report.metrics.byDebtTier.low}`);

  console.log('\n--- [Top 5 Technical Debt Hotspots for Phase 10 Refactoring] ---');
  for (const [idx, h] of report.topHotspots.slice(0, 5).entries()) {
    console.log(
      `  ${idx + 1}. ${h.filePath} (${h.totalIssues} issues, ` +
        `critical=${h.criticalCount}, high=${h.highCount}, score=${h.compositeScore})`,
    );
  }

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
