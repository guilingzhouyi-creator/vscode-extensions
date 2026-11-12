/**
 * Module: Tooling / Staged Differential Diff & 5D Line Classifier
 * File Path: scripts/common/lib/differential-diff-parser.js
 * Architecture Role: Staged git diff parser and 5D Riemannian line semantic classifier
 * Dependencies & Triggers: Consumed by gate-differential-bounds.js, pre-commit-gate, and CLI audits
 * Responsibilities:
 *   1. Classify diff line semantics with stateful multi-line block comment tracking;
 *   2. Run git diff --cached and evaluate per-file physical/effective line metrics;
 *   3. Collect staged status list and dual-ledger Jeffreys Beta(0.5, 0.5) admission samples.
 * Exit Semantics & Design Rationale: Pure functional evaluator aligned with diff-bounds-contract.json.
 *   Maintains 100% behavioral parity with fg-algorithms::diff::eloc_5d and fg-gate::diff_bounds.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIFF_BOUNDS_CONTRACT = Object.freeze(require('../diff-bounds-contract.json'));
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
 * Checks whether a trimmed segment begins with a single-line comment delimiter across supported languages.
 *
 * @param {string} trimmed - Trimmed line segment.
 * @returns {boolean} True when line starts with a single-line comment token.
 */
function isSingleLineComment(trimmed) {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('--') ||
    trimmed.startsWith(';')
  );
}

/**
 * Detects mechanical forwarding or empty stub lines.
 *
 * @param {string} trimmed - Trimmed line text.
 * @returns {boolean} True if trampoline.
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
 * Updates block-comment tracker for trailing `/*` tokens outside quotes or `//` comments.
 *
 * @param {string} codeSlice - Trimmed code segment.
 * @param {{ inBlockComment: boolean, inDocComment: boolean }} state - Mutable block state.
 */
function scanTrailingBlockComment(codeSlice, state) {
  let index = 0;
  let inDoubleQuote = false;
  while (index < codeSlice.length) {
    const ch = codeSlice[index];
    if (inDoubleQuote) {
      if (ch === '\\' && index + 1 < codeSlice.length) {
        index += 2;
        continue;
      }
      if (ch === '"') inDoubleQuote = false;
      index += 1;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      index += 1;
      continue;
    }
    if (codeSlice.startsWith('//', index)) break;
    if (codeSlice.startsWith('/*', index)) {
      const isDoc = codeSlice.startsWith('/**', index) && !codeSlice.startsWith('/**/', index);
      const closePos = codeSlice.indexOf('*/', index + 2);
      if (closePos >= 0) {
        index = closePos + 2;
        continue;
      }
      state.inBlockComment = true;
      state.inDocComment = isDoc;
      break;
    }
    index += 1;
  }
}

/**
 * Classifies trimmed text starting outside an active block comment.
 *
 * @param {string} trimmed - Trimmed segment.
 * @param {{ inBlockComment: boolean, inDocComment: boolean }} state - Mutable block state.
 * @returns {number} Semantic line classification constant.
 */
function classifyUncommentedSegment(trimmed, state) {
  let current = trimmed;
  while (true) {
    if (current.length === 0) return LINE_BLANK;
    if (current.startsWith('///') || current.startsWith('//!')) return LINE_DOC_COMMENT;
    if (isSingleLineComment(current)) return LINE_COMMENT;
    if (current.startsWith('/*')) {
      const isDoc = current.startsWith('/**') && !current.startsWith('/**/');
      const afterOpen = current.slice(2);
      const closePos = afterOpen.indexOf('*/');
      if (closePos < 0) {
        state.inBlockComment = true;
        state.inDocComment = isDoc;
        return isDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
      }
      const afterClose = afterOpen.slice(closePos + 2).trim();
      if (afterClose.length === 0 || isSingleLineComment(afterClose)) {
        return isDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
      }
      current = afterClose;
      continue;
    }
    scanTrailingBlockComment(current, state);
    return isMechanicalTrampoline(current) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }
}

/**
 * Classifies one source line using and mutating multi-line block comment state.
 *
 * @param {string} line - Raw line text.
 * @param {{ inBlockComment: boolean, inDocComment: boolean }} state - Mutable block comment state.
 * @returns {number} Semantic kind constant.
 */
function classifyLineWithState(line, state) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return LINE_BLANK;
  if (state.inBlockComment) {
    const wasDoc = state.inDocComment;
    const closePos = trimmed.indexOf('*/');
    if (closePos < 0) {
      return wasDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
    }
    state.inBlockComment = false;
    state.inDocComment = false;
    const remainder = trimmed.slice(closePos + 2).trim();
    if (remainder.length === 0 || isSingleLineComment(remainder)) {
      return wasDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
    }
    return classifyUncommentedSegment(remainder, state);
  }
  return classifyUncommentedSegment(trimmed, state);
}

/**
 * Classifies a single isolated line slice with 5D Riemannian rules.
 *
 * @param {string} line - Raw line text.
 * @returns {number} Semantic kind constant.
 */
function classifyLine(line) {
  return classifyLineWithState(line, { inBlockComment: false, inDocComment: false });
}

/**
 * Checks if a file path belongs to auditable code files.
 *
 * @param {string} filePath - Path relative to repo root.
 * @returns {boolean} True if auditable source file.
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
 * Classifies every line of a file text snapshot in stateful block-comment order (1-based indexed).
 *
 * @param {string} sourceText - Full file content at a given git revision/index.
 * @returns {number[]} 0-based array mapping lineIdx -> LINE_* constant.
 */
function classifyAllLinesWithState(sourceText) {
  const state = { inBlockComment: false, inDocComment: false };
  return sourceText.split(/\r?\n/).map((line) => classifyLineWithState(line, state));
}

/**
 * Reads full blob content from index (`:path`) or `HEAD:path` for accurate block-comment context.
 *
 * @param {string} revSpec - Git object spec such as `:src/foo.ts` or `HEAD:src/foo.ts`.
 * @returns {string | null} File content or null if unavailable.
 */
function readGitBlobText(revSpec) {
  try {
    return execFileSync('git', ['show', revSpec], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/**
 * Evaluates staged diff for a single file using stateful multi-line comment tracking.
 *
 * @param {string} relativePath - Repo-relative staged file path.
 * @param {boolean} isNew - Whether file does not exist in HEAD.
 * @returns {object} File bounds metrics.
 */
function resolveDiffLineKind(line, lineNumber, kinds, fallbackState) {
  const index = lineNumber - 1;
  if (kinds && index >= 0 && index < kinds.length) {
    return kinds[index];
  }
  return classifyLineWithState(line.slice(1), fallbackState);
}

/** Accumulates hunk counts using full-file classifications and revision line coordinates. */
function countClassifiedDiffLines(diffRaw, oldLineKinds, newLineKinds) {
  const counts = { physAdd: 0, physDel: 0, substantiveAdd: 0, substantiveDel: 0, nonCommentNonBlankAdd: 0 };
  let oldLineNum = 0;
  let newLineNum = 0;
  const addFallbackState = { inBlockComment: false, inDocComment: false };
  const delFallbackState = { inBlockComment: false, inDocComment: false };
  for (const line of diffRaw.split(/\r?\n/)) {
    if (/^(?:\+\+\+|---|diff |index )/.test(line)) {
      continue;
    }
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunkMatch) {
      oldLineNum = Number(hunkMatch[1]);
      newLineNum = Number(hunkMatch[2]);
      continue;
    }
    if (line.startsWith('+')) {
      counts.physAdd += 1;
      const kind = resolveDiffLineKind(line, newLineNum++, newLineKinds, addFallbackState);
      counts.substantiveAdd += Number(kind === LINE_SUBSTANTIVE);
      counts.nonCommentNonBlankAdd += Number(kind === LINE_SUBSTANTIVE || kind === LINE_TRAMPOLINE);
    } else if (line.startsWith('-')) {
      counts.physDel += 1;
      const kind = resolveDiffLineKind(line, oldLineNum++, oldLineKinds, delFallbackState);
      counts.substantiveDel += Number(kind === LINE_SUBSTANTIVE);
    }
  }
  return counts;
}

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

  const headContent = isNew ? null : readGitBlobText(`HEAD:${relativePath}`);
  const indexContent = readGitBlobText(`:${relativePath}`);
  const oldLineKinds = headContent !== null ? classifyAllLinesWithState(headContent) : null;
  const newLineKinds = indexContent !== null ? classifyAllLinesWithState(indexContent) : null;

  const { physAdd, physDel, substantiveAdd, substantiveDel, nonCommentNonBlankAdd } =
    countClassifiedDiffLines(diffRaw, oldLineKinds, newLineKinds);

  const substantiveRatio = physAdd > 0 ? nonCommentNonBlankAdd / physAdd : 1.0;
  const tspr = physAdd === 0 ? 1.0 : nonCommentNonBlankAdd > 0 ? substantiveAdd / nonCommentNonBlankAdd : 0.0;

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
  DIFF_BOUNDS_CONTRACT,
  CODE_EXTENSIONS,
  EXEMPT_EXTENSIONS,
  LINE_BLANK,
  LINE_COMMENT,
  LINE_DOC_COMMENT,
  LINE_TRAMPOLINE,
  LINE_SUBSTANTIVE,
  classifyLine,
  classifyLineWithState,
  isMechanicalTrampoline,
  isAuditableCodeFile,
  getStagedStatusList,
  loadRecentTurnoverRecords,
  calculateEmpiricalAdmissionThreshold,
  evaluateFileStagedDiff,
});
