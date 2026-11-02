/**
 * Module: Tooling / Staged Differential Diff & 5D Line Classifier
 * File Path: scripts/common/lib/differential-diff-parser.js
 * Architecture Role: Staged git diff parser and 5D Riemannian line semantic classifier
 * Dependencies & Triggers: Consumed by gate-differential-bounds.js, pre-commit-gate, and CLI audits
 * Responsibilities:
 *   1. Classify diff line semantics (blank, comment, doc comment, trampoline, substantive);
 *   2. Run git diff --cached and evaluate per-file physical/effective line metrics;
 *   3. Collect staged status list and historical turnover records.
 * Exit Semantics & Design Rationale: Pure functional evaluator.
 *   Extracted from gate-differential-bounds.js to preserve single-file volume budget <= 900 ELOC
 *   and keep staged differential evaluation within the single-commit rate limit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.rs', '.gd', '.py', '.sh', '.bash', '.ps1',
]);

const EXEMPT_EXTENSIONS = new Set([
  '.md', '.json', '.yml', '.yaml', '.txt', '.toml', '.svg', '.png', '.lock',
]);

const LINE_BLANK = 0;
const LINE_COMMENT = 1;
const LINE_DOC_COMMENT = 2;
const LINE_TRAMPOLINE = 3;
const LINE_SUBSTANTIVE = 4;

/**
 * Detects mechanical forwarding or empty stub lines.
 *
 * @param {string} trimmed - Trimmed line text
 * @returns {boolean} True if trampoline
 */
function isMechanicalTrampoline(trimmed) {
  const isShortForwardingCall =
    (trimmed.startsWith('return ') || trimmed.startsWith('self.') || trimmed.startsWith('this.')) &&
    trimmed.endsWith(';') &&
    trimmed.includes('(') &&
    trimmed.length <= 45;
  return isShortForwardingCall || trimmed === '{}' || trimmed === '};';
}

/**
 * Classifies a line slice with 5D Riemannian rules.
 *
 * @param {string} line - Raw line text
 * @returns {number} Semantic kind
 */
function classifyLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return LINE_BLANK;
  if (trimmed.startsWith('///') || trimmed.startsWith('//!') || trimmed.startsWith('/**')) {
    return LINE_DOC_COMMENT;
  }
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.endsWith('*/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith(';')
  ) {
    return LINE_COMMENT;
  }
  if (isMechanicalTrampoline(trimmed)) {
    return LINE_TRAMPOLINE;
  }
  return LINE_SUBSTANTIVE;
}

/**
 * Checks if a file path belongs to auditable code files.
 *
 * @param {string} filePath - Path relative to repo root
 * @returns {boolean}
 */
function isAuditableCodeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (EXEMPT_EXTENSIONS.has(ext)) return false;
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Collects staged files with git diff status.
 *
 * @returns {Array<{status: string, path: string}>}
 */
function getStagedStatusList() {
  try {
    const raw = execFileSync('git', ['diff', '--cached', '--name-status'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { status: parts[0] || 'M', path: parts[parts.length - 1] };
      })
      .filter((entry) => Boolean(entry.path));
  } catch {
    return [];
  }
}

/**
 * Reads historical turnover records from git telemetry ledger.
 *
 * @returns {number[]}
 */
function loadRecentTurnoverRecords() {
  const ledgerPath = path.join(REPO_ROOT, '.git', 'telemetry', 'admission_ledger.ndjson');
  if (!fs.existsSync(ledgerPath)) return [];
  try {
    const content = fs.readFileSync(ledgerPath, 'utf8');
    const records = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line.trim());
        if (typeof parsed.turnover === 'number') {
          records.push(parsed.turnover);
        }
      } catch {
        // Ignore corrupted entry
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Calculates Bayesian empirical admission threshold.
 *
 * @param {number[]} recentTurnovers
 * @returns {number}
 */
function calculateEmpiricalAdmissionThreshold(recentTurnovers, floor = 3.0, cap = 25.0) {
  if (recentTurnovers.length < 3) {
    return floor;
  }
  const sampleCount = recentTurnovers.length;
  const turnoverSum = recentTurnovers.reduce((acc, v) => acc + v, 0);
  const empiricalMean = turnoverSum / sampleCount;

  const sampleVariance =
    recentTurnovers
      .map((val) => (val - empiricalMean) * (val - empiricalMean))
      .reduce((acc, v) => acc + v, 0) / Math.max(1.0, sampleCount - 1.0);
  const standardDeviation = Math.sqrt(sampleVariance);

  const jeffreysPosteriorMean = (0.5 + turnoverSum) / (1.0 + sampleCount);
  const candidateThreshold = jeffreysPosteriorMean - 0.5 * standardDeviation;

  return Math.min(Math.max(candidateThreshold, floor), cap);
}

/**
 * Evaluates staged diff for a single file.
 *
 * @param {string} relativePath
 * @param {boolean} isNew
 * @returns {object} File bounds metrics
 */
function evaluateFileStagedDiff(relativePath, isNew) {
  let diffRaw = '';
  try {
    diffRaw = execFileSync('git', ['diff', '--cached', '-U0', '--no-color', '--', relativePath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Diff failure fallback
  }

  let physAdd = 0;
  let physDel = 0;
  let substantiveAdd = 0;
  let substantiveDel = 0;
  let nonCommentNonBlankAdd = 0;

  const lines = diffRaw.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('+')) {
      physAdd++;
      const kind = classifyLine(line.slice(1));
      if (kind === LINE_SUBSTANTIVE) {
        substantiveAdd++;
        nonCommentNonBlankAdd++;
      } else if (kind === LINE_TRAMPOLINE) {
        nonCommentNonBlankAdd++;
      }
    } else if (line.startsWith('-')) {
      physDel++;
      const kind = classifyLine(line.slice(1));
      if (kind === LINE_SUBSTANTIVE) {
        substantiveDel++;
      }
    }
  }

  const substantiveRatio = physAdd > 0 ? nonCommentNonBlankAdd / physAdd : 1.0;
  const tspr = nonCommentNonBlankAdd > 0 ? substantiveAdd / nonCommentNonBlankAdd : 1.0;

  return {
    path: relativePath,
    isNew,
    physAdd,
    physDel,
    elocAdd: substantiveAdd,
    elocDel: substantiveDel,
    substantiveRatio,
    tspr,
  };
}

module.exports = Object.freeze({
  REPO_ROOT,
  CODE_EXTENSIONS,
  EXEMPT_EXTENSIONS,
  LINE_BLANK,
  LINE_COMMENT,
  LINE_DOC_COMMENT,
  LINE_TRAMPOLINE,
  LINE_SUBSTANTIVE,
  classifyLine,
  isMechanicalTrampoline,
  isAuditableCodeFile,
  getStagedStatusList,
  loadRecentTurnoverRecords,
  calculateEmpiricalAdmissionThreshold,
  evaluateFileStagedDiff,
});
