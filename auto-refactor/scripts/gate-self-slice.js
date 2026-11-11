#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Incremental MoE AST Slice Self-Audit Runner
 * File Path: scripts/gate-self-slice.js
 * Architecture Role: Incremental self-hosted dogfooding gate; extracts changed AST slices from
 *   git diff/staged files, routes them through the SparseMoEGateRouter to select a minimal
 *   sufficient analyzer subset (10%~25% activation ratio), and scans only the affected slices.
 * Dependencies & Triggers: `npm run gate:self:slice`; requires prior `npm run build`.
 * Responsibilities:
 *   1. Discover modified files via git status/diff or explicit CLI arguments.
 *   2. Extract AST slices and compute mutation feature vectors using ASTSliceExtractor.
 *   3. Route slices to active analyzers using SparseMoEGateRouter.
 *   4. Execute targeted scan on changed files with active analyzer subset and ratchet baseline.
 * Exit Semantics & Design Rationale:
 *   0 = PASS (no new blocking findings, or verified safe bypass on non-code/clean tree).
 *   1 = FAIL (new blocking finding detected in changed slice).
 *   2 = usage/precondition error (e.g. missing dist/index.js or invalid arguments).
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR_DIST = 'dist';
const DIR_BASELINES = 'baselines';
const CONFIG_FILENAME = 'auto-refactor.config.json';
const BASELINE_FILENAME = 'self-scan.baseline.json';

const MODULE_SLICE_EXTRACTOR = '../dist/core/router/sliceExtractor';
const MODULE_SPARSE_MOE_GATE = '../dist/core/router/sparseMoEGate';
const MODULE_DIFF_BOUNDS_GOVERNOR = '../dist/core/scoring/diff-bounds-governor';
const MODULE_SEMANTIC_CLASSIFIER = '../dist/core/diff/semantic-delta-classifier';
const MODULE_EDIT_DIFF = '../dist/core/diff/edit-diff';
const MODULE_MYERS_ALGO = '../dist/core/diff/myers-algorithm';

const CLI = path.join(ROOT, DIR_DIST, 'index.js');
const CONFIG = path.join(ROOT, CONFIG_FILENAME);
const BASELINE = path.join(ROOT, DIR_BASELINES, BASELINE_FILENAME);
const REPORT = path.join(os.tmpdir(), `auto-refactor-slice-scan-${process.pid}.json`);

const CMD_REV_PARSE = 'rev-parse';
const CMD_DIFF = 'diff';
const CMD_STATUS = 'status';
const CMD_SHOW = 'show';
const CMD_SCAN = 'scan';
const LOG_LEVEL_WARN = 'warn';
const BASELINE_GROUPED = 'grouped';
const STATUS_PASS_LABEL = '✔ PASS';
const STATUS_BLOCK_LABEL = '✖ BLOCK';

const EXIT_PASS = 0;
const EXIT_USAGE_ERROR = 2;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RADIX_DECIMAL = 10;
const GIT_STATUS_PREFIX_LENGTH = 3;
const MAX_PREVIEW_ISSUES = 5;
const PERCENT_MULTIPLIER = 100;
const DEFAULT_PREVIEW_PRECISION = 1;
const DEFAULT_SLICE_COMPLEXITY_ESTIMATE = 10;

const SEVERITY_INFO = 'info';
const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';

const SEVERITY_WEIGHT_MAP = Object.freeze({
  [SEVERITY_INFO]: 0,
  [SEVERITY_WARNING]: 1,
  [SEVERITY_ERROR]: 2,
});
const DEFAULT_SEVERITY_WEIGHT = 2;

const SMOKE_TARGET_SLICE = 'src/core/router/sparseMoEGate.ts';
const SMOKE_MODE_MESSAGE = '--smoke mode: targeting default slice';
const CLEAN_TREE_MESSAGE = 'clean working tree: 0 changed files, 100% bypass → PASS';
const NO_SLICES_MESSAGE = 'no AST slices extracted from changes; 100% bypass → PASS';
const ZERO_ANALYZERS_MESSAGE = '0 active analyzers required: 100% bypass → PASS';

/**
 * Formats and writes standard output messages prefixed by gate name.
 *
 * @param message - Message text.
 */
function logGate(message) {
  process.stdout.write(`[gate:self:slice] ${message}\n`);
}

/**
 * Formats and writes error messages prefixed by gate name.
 *
 * @param message - Error message text.
 */
function logGateError(message) {
  process.stderr.write(`[gate:self:slice] ${message}\n`);
}

/**
 * Get current working directory prefix relative to git repository root.
 *
 * @returns Git subdirectory prefix (e.g. 'auto-refactor/' or '').
 */
function getGitPrefix() {
  try {
    const prefixResult = spawnSync('git', [CMD_REV_PARSE, '--show-prefix'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return (prefixResult.stdout || '').trim().replace(/\\/g, '/');
  } catch {
    // best-effort: fallback to empty prefix when git rev-parse fails
    return '';
  }
}

const GIT_PREFIX = getGitPrefix();

/**
 * Read text content from a file safely.
 *
 * @param absPath - Absolute file path.
 * @returns File content.
 */
function readTextFile(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

/**
 * Normalize git path by stripping any leading subdirectory prefix.
 *
 * @param gitFilePath - Git output path.
 * @returns Local project-relative path.
 */
function stripGitPrefix(gitFilePath) {
  const normalizedPath = gitFilePath.replace(/\\/g, '/');
  if (GIT_PREFIX.length > 0 && normalizedPath.startsWith(GIT_PREFIX)) {
    return normalizedPath.slice(GIT_PREFIX.length);
  }
  return normalizedPath;
}

/**
 * Discover modified or untracked repository-relative files from git.
 *
 * @returns Array of relative file paths.
 */
function getGitChangedFiles() {
  try {
    const diffOut = spawnSync('git', [CMD_DIFF, '--name-only', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const statusOut = spawnSync('git', [CMD_STATUS, '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    const changed = new Set();
    const addPath = (raw) => changed.add(stripGitPrefix(raw.trim()));

    if (diffOut.stdout) {
      diffOut.stdout.split(/\r?\n/).filter(Boolean).forEach(addPath);
    }
    if (statusOut.stdout) {
      statusOut.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => addPath(line.slice(GIT_STATUS_PREFIX_LENGTH)));
    }
    return Array.from(changed).filter(
      (filePath) =>
        (filePath.startsWith('src/') || filePath.startsWith('scripts/')) &&
        (filePath.endsWith('.ts') || filePath.endsWith('.js')),
    );
  } catch {
    // best-effort: fallback to empty list when git status fails
    return [];
  }
}

/**
 * Parse line ranges from a single hunk header row.
 *
 * @param row - Unified diff line.
 * @param lines - Accumulator for line numbers.
 */
function appendHunkLines(row, lines) {
  const match = HUNK_HEADER_RE.exec(row);
  if (!match) return;
  const start = parseInt(match[3], RADIX_DECIMAL);
  const count = match[4] !== undefined ? parseInt(match[4], RADIX_DECIMAL) : 1;
  for (let index = 0; index < count; index++) {
    lines.push(start + index);
  }
}

/**
 * Extract changed line numbers for a single file using git diff against HEAD.
 *
 * @param relPath - Relative file path.
 * @param currentContent - Current file content.
 * @returns Array of changed 1-indexed line numbers.
 */
function getChangedLineNumbers(relPath, currentContent) {
  const lineCount = currentContent.split(/\r?\n/).length;
  try {
    const gitTarget = `${GIT_PREFIX}${relPath}`;
    const diff = spawnSync('git', [CMD_DIFF, '-U0', 'HEAD', '--', gitTarget], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (!diff.stdout || diff.stdout.trim().length === 0) {
      return Array.from({ length: lineCount }, (_, lineIndex) => lineIndex + 1);
    }
    const lines = [];
    for (const row of diff.stdout.split(/\r?\n/)) {
      appendHunkLines(row, lines);
    }
    return lines.length > 0 ? lines : [1];
  } catch {
    // best-effort: fallback to full line list when git diff fails
    return Array.from({ length: lineCount }, (_, lineIndex) => lineIndex + 1);
  }
}

/**
 * Get old content for file from git HEAD, or empty string if untracked.
 *
 * @param relPath - Relative file path.
 * @returns File content at HEAD.
 */
function getHeadContent(relPath) {
  try {
    const gitTarget = `${GIT_PREFIX}${relPath}`;
    const showResult = spawnSync('git', [CMD_SHOW, `HEAD:${gitTarget}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return showResult.status === 0 ? showResult.stdout : '';
  } catch {
    // best-effort: fallback to empty content when git show fails
    return '';
  }
}

/**
 * Extract all slices across targeted file paths.
 *
 * @param targetFiles - Target file paths.
 * @param extractor - ASTSliceExtractor instance.
 * @returns Extracted AST slices.
 */
function extractAllSlices(targetFiles, extractor) {
  const allSlices = [];
  for (const relPath of targetFiles) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;
    const currentContent = readTextFile(absPath);
    const oldContent = getHeadContent(relPath);
    const changedLines = getChangedLineNumbers(relPath, currentContent);
    const slices = extractor.extractSlices(relPath, oldContent, currentContent, changedLines);
    for (const slice of slices) {
      allSlices.push(slice);
    }
  }
  return allSlices;
}

/**
 * Resolve target files from CLI overrides, smoke flag, or git diff.
 *
 * @param explicitFiles - CLI specified files.
 * @param isSmoke - Whether smoke mode is active.
 * @returns Target file paths.
 */
function resolveTargetFiles(explicitFiles, isSmoke) {
  if (explicitFiles && explicitFiles.length > 0) return explicitFiles;
  if (isSmoke) {
    logGate(SMOKE_MODE_MESSAGE);
    return [SMOKE_TARGET_SLICE];
  }
  return getGitChangedFiles();
}

function isIssueWithinSlices(issue, allSlices) {
  if (!Array.isArray(allSlices) || allSlices.length === 0) return true;
  const issueFile = String(issue.location?.file || '').replace(/\\/g, '/');
  const issueLine = issue.location?.start?.line || 1;
  if (issueLine <= 1) return true;
  const matchingSlices = allSlices.filter(
    (slice) => String(slice.filePath || '').replace(/\\/g, '/') === issueFile,
  );
  if (matchingSlices.length === 0) return true;
  return matchingSlices.some((slice) => issueLine >= slice.startLine && issueLine <= slice.endLine);
}

/**
 * Loads recent trajectory run points from active runs ledger.
 *
 * @param line - Maximum runs to inspect.
 * @returns Array of parsed trajectory points.
 */
function parseTrajectoryLine(line) {
  try {
    const item = JSON.parse(line);
    if (!item) return null;
    return {
      timestamp: item.timestamp || item.t || Date.now(),
      netSemanticTurnover: Number(item.netSemanticTurnover) || 0,
      gatePassed: item.verdict === 'ADMITTED' || Boolean(item.gate?.pass),
    };
  } catch {
    return null;
  }
}

function loadRecentTrajectoryRuns(maxCount = 20) {
  const ledgerFile = path.join(ROOT, '.auto-refactor-cache', 'admission-turnover-ledger.ndjson');
  if (fs.existsSync(ledgerFile)) {
    try {
      const raw = fs.readFileSync(ledgerFile, 'utf8').trim();
      if (raw) {
        const records = raw
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-maxCount)
          .map(parseTrajectoryLine)
          .filter(Boolean);
        if (records.length > 0) {
          return records;
        }
      }
    } catch {
      // ignore read failure
    }
  }
  return [];
}

/**
 * Extracts line diff operations into arrays of added and deleted lines.
 *
 * @param oldContent - Content before modification.
 * @param newContent - Content after modification.
 * @returns Split added and deleted line arrays.
 */
function extractFileDiffLines(oldContent, newContent) {
  const { fastDiff } = require(MODULE_EDIT_DIFF);
  const { DIFF_OP_INSERT, DIFF_OP_DELETE } = require(MODULE_MYERS_ALGO);
  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const diffOperations = fastDiff(oldLines, newLines);
  const addedLines = [];
  const deletedLines = [];

  for (const operation of diffOperations) {
    if (operation.type === DIFF_OP_INSERT) {
      addedLines.push(newLines[operation.bIdx] ?? '');
    } else if (operation.type === DIFF_OP_DELETE) {
      deletedLines.push(oldLines[operation.aIdx] ?? '');
    }
  }

  return { addedLines, deletedLines };
}

/**
 * Evaluates net turnover and differential bounds across all target files.
 *
 * @param targetFiles - Array of relative file paths.
 * @returns Structured admission evaluation verdict.
 */
async function evaluateAdmissionTurnover(targetFiles) {
  const {
    computeNetSemanticTurnover,
    evaluateDifferentialBounds,
    compute5dElocDelta,
    evaluateCommitBatchBounds,
    calculateEmpiricalAdmissionThreshold,
    appendAdmissionAuditRecord,
    DEFAULT_TRAJECTORY_WINDOW_SIZE,
  } = require(MODULE_DIFF_BOUNDS_GOVERNOR);
  const { classifySemanticDelta } = require(MODULE_SEMANTIC_CLASSIFIER);

  const stagedFiles = [];
  let accumulatedSemanticAdded = 0;
  let accumulatedSemanticDeleted = 0;
  let accumulatedRelocated = 0;
  let accumulatedCosmetic = 0;
  let accumulatedPhysicalAdded = 0;
  let accumulatedPhysicalDeleted = 0;

  for (const relPath of targetFiles) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;
    const currentContent = readTextFile(absPath);
    const oldContent = getHeadContent(relPath);
    if (currentContent === oldContent) continue;

    const { addedLines, deletedLines } = extractFileDiffLines(oldContent, currentContent);
    const boundsVerdict = evaluateDifferentialBounds({
      filePath: relPath,
      oldContent,
      newContent: currentContent,
      addedLines,
      deletedLines,
    });

    if (!boundsVerdict.isAllowed) {
      return {
        passed: false,
        verdictCode: boundsVerdict.verdictCode,
        reason: `[${relPath}] ${boundsVerdict.reason || 'differential bounds violated'}`,
      };
    }

    const file5dDelta = compute5dElocDelta({
      filePath: relPath,
      oldContent,
      newContent: currentContent,
      addedLines,
      deletedLines,
    });

    stagedFiles.push({
      filePath: relPath,
      eloc5dAdd: file5dDelta.eloc5dAdd,
      eloc5dDel: file5dDelta.eloc5dDel,
      net5dTurnover: file5dDelta.net5dTurnover,
      rawAdd: addedLines.length,
      rawDel: deletedLines.length,
      boundsVerdict,
    });

    const delta = classifySemanticDelta(relPath, oldContent, currentContent);
    accumulatedSemanticAdded += delta.counters.added;
    accumulatedSemanticDeleted += delta.counters.deleted;
    accumulatedRelocated += delta.counters.relocated;
    accumulatedCosmetic += delta.counters.cosmetic;
    accumulatedPhysicalAdded += addedLines.length;
    accumulatedPhysicalDeleted += deletedLines.length;
  }

  const turnover = computeNetSemanticTurnover({
    semanticAddedEloc: accumulatedSemanticAdded,
    semanticDeletedEloc: accumulatedSemanticDeleted,
    relocatedEloc: accumulatedRelocated,
    cosmeticEloc: accumulatedCosmetic,
    physicalAddedLines: accumulatedPhysicalAdded,
    physicalDeletedLines: accumulatedPhysicalDeleted,
  });

  const recentRuns = loadRecentTrajectoryRuns(DEFAULT_TRAJECTORY_WINDOW_SIZE);
  const batchVerdict = evaluateCommitBatchBounds({
    stagedFiles,
    recentRuns,
    currentComplexity: DEFAULT_SLICE_COMPLEXITY_ESTIMATE,
    currentEloc: Math.max(1, accumulatedSemanticAdded + accumulatedSemanticDeleted),
  });

  const admission = calculateEmpiricalAdmissionThreshold({
    recentRuns,
    currentComplexity: DEFAULT_SLICE_COMPLEXITY_ESTIMATE,
    currentEloc: Math.max(1, accumulatedSemanticAdded + accumulatedSemanticDeleted),
  });

  // Record audit ledger entry
  await appendAdmissionAuditRecord(
    {
      timestamp: Date.now(),
      commitStagingDigest: `scan-${process.pid}`,
      lAdd: batchVerdict.total5dAdd,
      lDel: batchVerdict.total5dDel,
      netSemanticTurnover: batchVerdict.total5dTurnover,
      admissionThreshold: batchVerdict.admissionThreshold,
      turnoverRatio: turnover.turnoverRatio,
      verdict: batchVerdict.verdictCode,
      factors: {
        rollingMean: admission.rollingMean,
        rollingStdDev: admission.rollingStdDev,
        noisePenalty: admission.noiseFactor,
        confidence: admission.posteriorConfidence,
      },
    },
    ROOT,
  );

  return {
    passed: batchVerdict.passed,
    verdictCode: batchVerdict.verdictCode,
    netSemanticTurnover: batchVerdict.total5dTurnover,
    admissionThreshold: batchVerdict.admissionThreshold,
    turnoverRatio: turnover.turnoverRatio,
    reason: batchVerdict.passed ? undefined : batchVerdict.reason,
  };
}

/**
 * Read and print blocking summary from temporary report file.
 *
 * @param summaryParams - Summary report parameters.
 * @param summaryParams.fileCount - Scanned file count.
 * @param summaryParams.severity - Configured severity.
 * @param summaryParams.exitCode - CLI exit code.
 * @param summaryParams.allSlices - Extracted AST slices for range filtering.
 */
function reportBlockingSummary({ fileCount, severity, exitCode, allSlices }) {
  let blockingCount = 0;
  try {
    const report = JSON.parse(readTextFile(REPORT));
    const targetWeight = SEVERITY_WEIGHT_MAP[severity] ?? DEFAULT_SEVERITY_WEIGHT;
    const blocking = report.issues.filter(
      (issue) =>
        issue.isNew &&
        !issue.suppression &&
        !issue.clusteredInto &&
        isIssueWithinSlices(issue, allSlices) &&
        (SEVERITY_WEIGHT_MAP[issue.severity] ?? 1) >= targetWeight,
    );
    blockingCount = blocking.length;
    for (const issue of blocking.slice(0, MAX_PREVIEW_ISSUES)) {
      logGate(
        `  NEW ${issue.severity}: ${issue.analyzer}/${issue.rule} ` +
          `${issue.location.file}:${issue.location.start.line} — ${issue.message}`,
      );
    }
  } catch {
    // ignore: non-fatal if report file is missing or unreadable
  }
  fs.rmSync(REPORT, { force: true });
  const verdict = exitCode === EXIT_PASS ? STATUS_PASS_LABEL : STATUS_BLOCK_LABEL;
  logGate(
    `targeted-scan (files=${fileCount} newBlocking(${severity})=${blockingCount}) → ${verdict}`,
  );
}

/**
 * Execute targeted scan with active analyzers and baseline ratchet.
 *
 * @param scanParams - Scan execution parameters.
 * @param scanParams.targetFiles - Files to scan.
 * @param scanParams.activeAnalyzers - Selected analyzer subset.
 * @param scanParams.severity - Blocking severity threshold.
 * @param scanParams.allSlices - Extracted AST slices.
 * @returns Process exit code.
 */
function executeTargetedScan({ targetFiles, activeAnalyzers, severity, allSlices }) {
  const cliArgs = [
    CLI,
    CMD_SCAN,
    '--root',
    ROOT,
    '--config',
    CONFIG,
    '--include',
    targetFiles.join(','),
    '--analyzers',
    activeAnalyzers.join(','),
    '--format',
    'json',
    '--out',
    REPORT,
    '--baseline-granularity',
    BASELINE_GROUPED,
    '--baseline',
    BASELINE,
    '--fail-on-severity',
    severity,
    '--no-cache',
    '--no-daemon',
    '--log-level',
    LOG_LEVEL_WARN,
  ];

  const scanProcessResult = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });
  if (scanProcessResult.error) {
    logGateError(`failed to launch CLI: ${scanProcessResult.error.message}`);
    return EXIT_USAGE_ERROR;
  }
  const exitCode = scanProcessResult.status === null ? EXIT_USAGE_ERROR : scanProcessResult.status;
  reportBlockingSummary({ fileCount: targetFiles.length, severity, exitCode, allSlices });
  return exitCode;
}

/**
 * Main slice gate entry point.
 */
async function main() {
  const cliArguments = process.argv.slice(2);
  const severityIndex = cliArguments.indexOf('--severity');
  const severity = severityIndex >= 0 ? cliArguments[severityIndex + 1] : SEVERITY_ERROR;
  const filesIndex = cliArguments.indexOf('--files');
  const explicitFiles = filesIndex >= 0 ? cliArguments[filesIndex + 1].split(',') : null;
  const isSmoke = cliArguments.includes('--smoke');

  if (![SEVERITY_INFO, SEVERITY_WARNING, SEVERITY_ERROR].includes(severity)) {
    logGateError(`invalid --severity: ${severity}`);
    process.exit(EXIT_USAGE_ERROR);
  }
  if (!fs.existsSync(CLI)) {
    logGateError('dist/index.js missing — run "npm run build" first');
    process.exit(EXIT_USAGE_ERROR);
  }

  const targetFiles = resolveTargetFiles(explicitFiles, isSmoke);
  if (targetFiles.length === 0) {
    logGate(CLEAN_TREE_MESSAGE);
    process.exit(EXIT_PASS);
  }

  if (!isSmoke && !cliArguments.includes('--no-turnover-check')) {
    const admissionVerdict = await evaluateAdmissionTurnover(targetFiles);
    if (!admissionVerdict.passed) {
      logGateError(
        `✖ ${admissionVerdict.verdictCode}: ${admissionVerdict.reason || 'failed minimum admission criteria'}`,
      );
      process.exit(1);
    }
    logGate(
      `admission-turnover: net=${admissionVerdict.netSemanticTurnover.toFixed(1)} ` +
        `threshold=${admissionVerdict.admissionThreshold.toFixed(1)} ratio=${admissionVerdict.turnoverRatio.toFixed(3)} → ADMITTED`,
    );
  }

  // @lazy: Deferred import until dist/ is verified and files are discovered
  const { ASTSliceExtractor } = require(MODULE_SLICE_EXTRACTOR);
  // @lazy: Deferred import until dist/ is verified and files are discovered
  const { SparseMoEGateRouter } = require(MODULE_SPARSE_MOE_GATE);
  const allSlices = extractAllSlices(targetFiles, new ASTSliceExtractor());

  if (allSlices.length === 0) {
    logGate(NO_SLICES_MESSAGE);
    process.exit(EXIT_PASS);
  }

  const routingPlan = new SparseMoEGateRouter().routeCombinedSlices(allSlices);
  const activeAnalyzers = routingPlan.activeAnalyzers;
  const ratioPercentage = (routingPlan.activationRatio * PERCENT_MULTIPLIER).toFixed(
    DEFAULT_PREVIEW_PRECISION,
  );

  logGate(
    `slices=${allSlices.length} active=[${activeAnalyzers.join(',')}] ` +
      `activation=${ratioPercentage}% bypass=${routingPlan.skippedAnalyzers.length} analyzers`,
  );

  if (activeAnalyzers.length === 0) {
    logGate(ZERO_ANALYZERS_MESSAGE);
    process.exit(EXIT_PASS);
  }

  const exitCode = executeTargetedScan({ targetFiles, activeAnalyzers, severity, allSlices });
  process.exit(exitCode);
}

main().catch((err) => {
  logGateError(`runtime error: ${err.message}`);
  process.exit(EXIT_USAGE_ERROR);
});
