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
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const CONFIG = path.join(ROOT, 'auto-refactor.config.json');
const BASELINE = path.join(ROOT, 'baselines', 'self-scan.baseline.json');
const REPORT = path.join(os.tmpdir(), `auto-refactor-slice-scan-${process.pid}.json`);

const EXIT_PASS = 0;
const EXIT_USAGE_ERROR = 2;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const RADIX_DECIMAL = 10;
const GIT_STATUS_PREFIX_LENGTH = 3;
const MAX_PREVIEW_ISSUES = 5;
const PERCENT_MULTIPLIER = 100;
const DEFAULT_PREVIEW_PRECISION = 1;

const SEVERITY_WEIGHT_MAP = Object.freeze({ info: 0, warning: 1, error: 2 });
const DEFAULT_SEVERITY_WEIGHT = 2;

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
    const res = spawnSync('git', ['rev-parse', '--show-prefix'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return (res.stdout || '').trim().replace(/\\/g, '/');
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
    const diffOut = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const statusOut = spawnSync('git', ['status', '--porcelain'], {
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
    const diff = spawnSync('git', ['diff', '-U0', 'HEAD', '--', gitTarget], {
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
    const res = spawnSync('git', ['show', `HEAD:${gitTarget}`], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return res.status === 0 ? res.stdout : '';
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
    logGate('--smoke mode: targeting default slice');
    return ['src/core/router/sparseMoEGate.ts'];
  }
  const changed = getGitChangedFiles();
  if (changed.length > 0) return changed;
  return [];
}

/**
 * Read and print blocking summary from temporary report file.
 *
 * @param summaryParams - Summary report parameters.
 * @param summaryParams.fileCount - Scanned file count.
 * @param summaryParams.severity - Configured severity.
 * @param summaryParams.exitCode - CLI exit code.
 */
function reportBlockingSummary({ fileCount, severity, exitCode }) {
  let blockingCount = 0;
  try {
    const report = JSON.parse(readTextFile(REPORT));
    const targetWeight = SEVERITY_WEIGHT_MAP[severity] ?? DEFAULT_SEVERITY_WEIGHT;
    const blocking = report.issues.filter(
      (issue) =>
        issue.isNew &&
        !issue.suppression &&
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
  const verdict = exitCode === EXIT_PASS ? '✔ PASS' : '✖ BLOCK';
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
 * @returns Process exit code.
 */
function executeTargetedScan({ targetFiles, activeAnalyzers, severity }) {
  const cliArgs = [
    CLI,
    'scan',
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
    'grouped',
    '--baseline',
    BASELINE,
    '--fail-on-severity',
    severity,
    '--no-cache',
    '--no-daemon',
    '--log-level',
    'warn',
  ];

  const result = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    logGateError(`failed to launch CLI: ${result.error.message}`);
    return EXIT_USAGE_ERROR;
  }
  const exitCode = result.status === null ? EXIT_USAGE_ERROR : result.status;
  reportBlockingSummary({ fileCount: targetFiles.length, severity, exitCode });
  return exitCode;
}

/**
 * Main slice gate entry point.
 */
async function main() {
  const cliArguments = process.argv.slice(2);
  const severityIndex = cliArguments.indexOf('--severity');
  const severity = severityIndex >= 0 ? cliArguments[severityIndex + 1] : 'error';
  const filesIndex = cliArguments.indexOf('--files');
  const explicitFiles = filesIndex >= 0 ? cliArguments[filesIndex + 1].split(',') : null;
  const isSmoke = cliArguments.includes('--smoke');

  if (!['info', 'warning', 'error'].includes(severity)) {
    logGateError(`invalid --severity: ${severity}`);
    process.exit(EXIT_USAGE_ERROR);
  }
  if (!fs.existsSync(CLI)) {
    logGateError('dist/index.js missing — run "npm run build" first');
    process.exit(EXIT_USAGE_ERROR);
  }

  const targetFiles = resolveTargetFiles(explicitFiles, isSmoke);
  if (targetFiles.length === 0) {
    logGate('clean working tree: 0 changed files, 100% bypass → PASS');
    process.exit(EXIT_PASS);
  }

  const { ASTSliceExtractor } = require('../dist/core/router/sliceExtractor');
  const { SparseMoEGateRouter } = require('../dist/core/router/sparseMoEGate');
  const allSlices = extractAllSlices(targetFiles, new ASTSliceExtractor());

  if (allSlices.length === 0) {
    logGate('no AST slices extracted from changes; 100% bypass → PASS');
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
    logGate('0 active analyzers required: 100% bypass → PASS');
    process.exit(EXIT_PASS);
  }

  const exitCode = executeTargetedScan({ targetFiles, activeAnalyzers, severity });
  process.exit(exitCode);
}

main().catch((err) => {
  logGateError(`runtime error: ${err.message}`);
  process.exit(EXIT_USAGE_ERROR);
});
