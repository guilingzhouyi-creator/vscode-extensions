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
 * Parses one NDJSON record into normalized `{ turnover, passed }` form supporting both ledgers.
 *
 * @param {string} trimmedLine - Raw NDJSON record line.
 * @returns {{ turnover: number, passed: boolean } | null} Parsed sample or null.
 */
function parseLedgerSample(trimmedLine) {
  try {
    const parsed = JSON.parse(trimmedLine);
    const turnover =
      typeof parsed.turnover === 'number'
        ? parsed.turnover
        : typeof parsed.netSemanticTurnover === 'number'
          ? parsed.netSemanticTurnover
          : null;
    if (turnover === null || !Number.isFinite(turnover)) return null;
    let passed = turnover >= DIFF_BOUNDS_CONTRACT.empiricalAdmission.turnoverFloor;
    if (typeof parsed.passed === 'boolean') passed = parsed.passed;
    else if (typeof parsed.gatePassed === 'boolean') passed = parsed.gatePassed;
    else if (typeof parsed.verdict === 'string') passed = parsed.verdict === 'ADMITTED';
    return { turnover, passed };
  } catch {
    return null;
  }
}

/**
 * Reads recent admission trajectory samples from both Taxis and auto-refactor NDJSON ledgers.
 *
 * @returns {Array<{ turnover: number, passed: boolean }>}
 */
function loadRecentAdmissionSamples() {
  const candidateLedgers = [
    path.join(REPO_ROOT, DIFF_BOUNDS_CONTRACT.ledgers.taxisRelative),
    path.join(REPO_ROOT, DIFF_BOUNDS_CONTRACT.ledgers.autoRefactorRelative),
    path.join(REPO_ROOT, 'auto-refactor', DIFF_BOUNDS_CONTRACT.ledgers.autoRefactorRelative),
  ];
  const samples = [];
  for (const ledgerPath of candidateLedgers) {
    if (!fs.existsSync(ledgerPath)) continue;
    try {
      const content = fs.readFileSync(ledgerPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const sample = parseLedgerSample(trimmed);
        if (sample) samples.push(sample);
      }
    } catch {
      // Ignore unreadable ledger file
    }
  }
  return samples;
}

/**
 * Reads historical turnover numbers from dual admission ledgers.
 *
 * @returns {number[]}
 */
function loadRecentTurnoverRecords() {
  return loadRecentAdmissionSamples().map((sample) => sample.turnover);
}

/**
 * Normalizes mixed numeric/sample trajectory inputs into `{ turnover, passed }` records.
 *
 * @param {Array<number | { turnover?: number, netSemanticTurnover?: number, passed?: boolean, gatePassed?: boolean, verdict?: string }>} entries
 * @param {number} floor
 * @returns {Array<{ turnover: number, passed: boolean }>}
 */
function normalizeTrajectorySamples(entries, floor) {
  if (!Array.isArray(entries)) return [];
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      normalized.push({ turnover: entry, passed: entry >= floor });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const turnover =
      typeof entry.turnover === 'number'
        ? entry.turnover
        : typeof entry.netSemanticTurnover === 'number'
          ? entry.netSemanticTurnover
          : null;
    if (turnover === null || !Number.isFinite(turnover)) continue;
    let passed = turnover >= floor;
    if (typeof entry.passed === 'boolean') passed = entry.passed;
    else if (typeof entry.gatePassed === 'boolean') passed = entry.gatePassed;
    else if (typeof entry.verdict === 'string') passed = entry.verdict === 'ADMITTED';
    normalized.push({ turnover, passed });
  }
  return normalized;
}

/**
 * Calculates Bayesian Jeffreys Beta(0.5, 0.5) empirical admission threshold aligned with SSOT contract.
 *
 * Accepts either raw numeric turnovers or structured `{ turnover, passed }` samples. Uses population
 * variance via Welford's algorithm and pass-rate Jeffreys posterior `(passCount + 0.5) / (N + 1.0)`.
 *
 * @param {Array<number | { turnover: number, passed?: boolean }>} recentInput
 * @param {number} [floor]
 * @param {number} [cap]
 * @param {{ currentComplexity?: number, currentEloc?: number }} [options]
 * @returns {number} Calibrated empirical threshold clamped to [floor, cap].
 */
function calculateEmpiricalAdmissionThreshold(
  recentInput,
  floor = DIFF_BOUNDS_CONTRACT.empiricalAdmission.turnoverFloor,
  cap = DIFF_BOUNDS_CONTRACT.empiricalAdmission.turnoverCap,
  options = {},
) {
  const policy = DIFF_BOUNDS_CONTRACT.empiricalAdmission;
  const samples = normalizeTrajectorySamples(recentInput, floor).slice(-policy.trajectoryWindowSize);
  if (samples.length < policy.minTrajectorySamples) {
    return floor;
  }

  let validCount = 0;
  let runningMean = 0;
  let secondMomentSum = 0;
  let passCount = 0;

  for (const sample of samples) {
    validCount += 1;
    if (sample.passed) passCount += 1;
    const delta = sample.turnover - runningMean;
    runningMean += delta / validCount;
    const deltaAfter = sample.turnover - runningMean;
    secondMomentSum += delta * deltaAfter;
  }

  if (validCount < policy.minTrajectorySamples) {
    return floor;
  }

  const variance = Math.max(0, secondMomentSum / validCount);
  const standardDeviation = Math.sqrt(variance);
  const posteriorConfidence =
    (passCount + policy.jeffreysPriorAlpha) /
    (validCount + policy.jeffreysPriorAlpha + policy.jeffreysPriorBeta);

  const complexity = Number(options.currentComplexity || 0);
  const eloc = Math.max(1, Number(options.currentEloc || 1));
  const rawNoise = Number.isFinite(complexity) && complexity > 0 ? complexity / eloc : 0;
  const noiseFactor = Math.min(Math.max(rawNoise, 0), policy.maxNoiseCeiling) / policy.maxNoiseCeiling;

  const statisticalCenter = Math.max(0, runningMean - policy.stdDevDiscountFactor * standardDeviation);
  const calibrated = statisticalCenter * (1.0 - noiseFactor) * posteriorConfidence;
  const clamped = Math.min(Math.max(calibrated, floor), cap);
  return Math.round(clamped * 100) / 100;
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

/** Resolves a hunk line against full revision context, with stateful fallback for absent blobs. */
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
  let inHunk = false;
  for (const line of diffRaw.split(/\r?\n/)) {
    const hunkMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunkMatch) {
      oldLineNum = Number(hunkMatch[1]);
      newLineNum = Number(hunkMatch[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
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

/** Evaluates one staged file using full-revision line classifications and stateful fallback. */
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
  loadRecentAdmissionSamples,
  loadRecentTurnoverRecords,
  calculateEmpiricalAdmissionThreshold,
  evaluateFileStagedDiff,
});
