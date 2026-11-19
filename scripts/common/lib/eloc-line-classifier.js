/**
 * Module: Workspace Governance — Multi-Language ELOC & Line Semantic Classifier SSOT
 * File Path: scripts/common/lib/eloc-line-classifier.js
 * Architecture Role: Single source of truth for stateful multi-language line semantic
 *   classification (blank, comment, doc-comment, trampoline, substantive) and source-level
 *   ELOC/wiring/noise summarization, backed by syntax rules in lib/eloc-language-rules.js.
 * Dependencies & Triggers: Consumes `./eloc-language-rules`;
 *   consumed by evaluate-eloc-budget.js, validate-code-density.js, lib/fast-staged-checks.js,
 *   lib/staged-slice-analyzers.js, and lib/differential-diff-parser.js.
 * Responsibilities:
 *   1. Classify individual lines with stateful multi-line comment/docstring tracking across
 *      C-style (//, /* *\/, /** *\/, ///, //!), hash (#, """/'''), PowerShell (<# #>), SQL/Lua (--), and INI (;);
 *   2. Summarize file-level ELOC, blank, comment, doc-comment, trampoline, wiring, and noise ratio;
 *   3. Re-export shared quality-budget contracts and language rule primitives for full compatibility.
 * Exit Semantics & Design Rationale: Pure diagnostic library with zero side effects or process exits.
 */
'use strict';

const {
  DEFAULT_QUALITY_BUDGET,
  QUALITY_BUDGET,
  loadQualityBudgetContract,
  HASH_DOCSTRING_EXTS,
  HASH_ONLY_EXTS,
  POWERSHELL_EXTS,
  INI_EXTS,
  isSingleLineComment,
  isDocCommentStart,
  isMechanicalTrampoline,
  scanTrailingBlockComment,
  stripInlineComment,
  countSemanticTokens,
  isWiringLine,
} = require('./eloc-language-rules');

const LINE_BLANK = 0;
const LINE_COMMENT = 1;
const LINE_DOC_COMMENT = 2;
const LINE_TRAMPOLINE = 3;
const LINE_SUBSTANTIVE = 4;

/**
 * Creates a fresh mutable line classifier state object.
 *
 * @returns {{ inBlockComment: boolean, inDocComment: boolean, quoteChar: string }}
 */
function createClassifierState() {
  return { inBlockComment: false, inDocComment: false, quoteChar: '' };
}

function classifyPowerShellLine(trimmed, state) {
  if (state.inBlockComment) {
    const endIdx = trimmed.indexOf('#>');
    if (endIdx < 0) return LINE_COMMENT;
    state.inBlockComment = false;
    state.inDocComment = false;
    const rest = trimmed.slice(endIdx + 2).trim();
    if (rest.length === 0 || rest.startsWith('#')) return LINE_COMMENT;
    return isMechanicalTrampoline(rest) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }
  if (trimmed.startsWith('<#')) {
    const endIdx = trimmed.indexOf('#>', 2);
    if (endIdx < 0) {
      state.inBlockComment = true;
      state.inDocComment = false;
      return LINE_COMMENT;
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    if (rest.length === 0 || rest.startsWith('#')) return LINE_COMMENT;
    return isMechanicalTrampoline(rest) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }
  if (trimmed.startsWith('#')) return LINE_COMMENT;
  return isMechanicalTrampoline(trimmed) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
}

function classifyTripleQuoteLine(trimmed, state) {
  if (state.inBlockComment && state.quoteChar) {
    const endIdx = trimmed.indexOf(state.quoteChar);
    if (endIdx < 0) return LINE_DOC_COMMENT;
    state.inBlockComment = false;
    state.inDocComment = false;
    state.quoteChar = '';
    const rest = trimmed.slice(endIdx + 3).trim();
    if (rest.length === 0 || rest.startsWith('#')) return LINE_DOC_COMMENT;
    return isMechanicalTrampoline(rest) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }
  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    const quote = trimmed.slice(0, 3);
    const endIdx = trimmed.indexOf(quote, 3);
    if (endIdx < 0) {
      state.inBlockComment = true;
      state.inDocComment = true;
      state.quoteChar = quote;
      return LINE_DOC_COMMENT;
    }
    const rest = trimmed.slice(endIdx + 3).trim();
    if (rest.length === 0 || rest.startsWith('#')) return LINE_DOC_COMMENT;
    return isMechanicalTrampoline(rest) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }
  if (trimmed.startsWith('#')) return LINE_COMMENT;
  return isMechanicalTrampoline(trimmed) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
}

function classifyUncommentedCStyle(trimmed, state, ext) {
  let current = trimmed;
  while (true) {
    if (current.length === 0) return LINE_BLANK;
    if (isDocCommentStart(current, ext)) return LINE_DOC_COMMENT;
    if (isSingleLineComment(current, ext)) return LINE_COMMENT;
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
      if (afterClose.length === 0 || isSingleLineComment(afterClose, ext)) {
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
 * Classifies one source line using and mutating multi-line block/docstring comment state.
 *
 * @param {string} line - Raw source line text.
 * @param {{ inBlockComment: boolean, inDocComment: boolean, quoteChar?: string }} state - Mutable parser state.
 * @param {string} [ext=''] - Optional lowercase file extension for language-accurate classification.
 * @returns {number} Semantic kind constant (`LINE_*`).
 */
function classifyLineWithState(line, state, ext = '') {
  const trimmed = line.trim();
  if (trimmed.length === 0) return LINE_BLANK;
  const normExt = ext ? ext.toLowerCase() : '';

  if (POWERSHELL_EXTS.has(normExt)) return classifyPowerShellLine(trimmed, state);
  if (HASH_DOCSTRING_EXTS.has(normExt)) return classifyTripleQuoteLine(trimmed, state);
  if (HASH_ONLY_EXTS.has(normExt) || INI_EXTS.has(normExt)) {
    if (isSingleLineComment(trimmed, normExt)) return LINE_COMMENT;
    return isMechanicalTrampoline(trimmed) ? LINE_TRAMPOLINE : LINE_SUBSTANTIVE;
  }

  if (state.inBlockComment) {
    const wasDoc = Boolean(state.inDocComment);
    const closePos = trimmed.indexOf('*/');
    if (closePos < 0) return wasDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
    state.inBlockComment = false;
    state.inDocComment = false;
    const remainder = trimmed.slice(closePos + 2).trim();
    if (remainder.length === 0 || isSingleLineComment(remainder, normExt)) {
      return wasDoc ? LINE_DOC_COMMENT : LINE_COMMENT;
    }
    return classifyUncommentedCStyle(remainder, state, normExt);
  }
  return classifyUncommentedCStyle(trimmed, state, normExt);
}

/**
 * Classifies a single isolated line without prior multi-line state.
 *
 * @param {string} line - Raw line text.
 * @param {string} [ext=''] - Optional lowercase file extension.
 * @returns {number} Semantic kind constant (`LINE_*`).
 */
function classifyLine(line, ext = '') {
  return classifyLineWithState(line, createClassifierState(), ext);
}

/**
 * Summarizes line-level ELOC, comment, blank, trampoline, wiring, and noise metrics for source content.
 *
 * @param {string} content - Raw source file content.
 * @param {string} [ext=''] - Lowercase file extension (e.g. '.ts', '.py', '.ps1').
 * @returns {{
 *   totalLines: number,
 *   eloc: number,
 *   blankLines: number,
 *   commentLines: number,
 *   docCommentLines: number,
 *   trampolineLines: number,
 *   wiringLines: number,
 *   noiseRatio: number
 * }}
 */
function summarizeSourceLines(content, ext = '') {
  const normExt = ext ? ext.toLowerCase() : '';
  const lines = String(content || '').split(/\r?\n/);
  const state = createClassifierState();

  let blankLines = 0;
  let commentLines = 0;
  let docCommentLines = 0;
  let trampolineLines = 0;
  let eloc = 0;
  let wiringLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kind = classifyLineWithState(line, state, normExt);
    if (kind === LINE_BLANK) {
      blankLines++;
    } else if (kind === LINE_DOC_COMMENT) {
      commentLines++;
      docCommentLines++;
    } else if (kind === LINE_COMMENT) {
      commentLines++;
    } else {
      eloc++;
      if (kind === LINE_TRAMPOLINE) trampolineLines++;
      const cleaned = stripInlineComment(line, normExt).trim();
      if (cleaned.length > 0 && isWiringLine(cleaned, normExt)) wiringLines++;
    }
  }

  const totalLines = lines.length;
  const nonEloc = Math.max(0, totalLines - eloc);
  const noiseRatio = nonEloc / Math.max(1, eloc);

  return { totalLines, eloc, blankLines, commentLines, docCommentLines, trampolineLines, wiringLines, noiseRatio };
}

module.exports = Object.freeze({
  LINE_BLANK,
  LINE_COMMENT,
  LINE_DOC_COMMENT,
  LINE_TRAMPOLINE,
  LINE_SUBSTANTIVE,
  DEFAULT_QUALITY_BUDGET,
  QUALITY_BUDGET,
  loadQualityBudgetContract,
  createClassifierState,
  isSingleLineComment,
  isMechanicalTrampoline,
  classifyLineWithState,
  classifyLine,
  stripInlineComment,
  countSemanticTokens,
  isWiringLine,
  summarizeSourceLines,
});
