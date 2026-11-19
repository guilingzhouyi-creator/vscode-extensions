/**
 * Module: Workspace Governance — Multi-Language Syntax Rules & Quality Budget Loader
 * File Path: scripts/common/lib/eloc-language-rules.js
 * Architecture Role: Provides language-specific comment/trampoline/wiring predicates, inline comment
 *   stripping, semantic token counting, and defensive loading of quality-budget-contract.json.
 * Dependencies & Triggers: Consumes optional `../quality-budget-contract.json`; imported by
 *   scripts/common/lib/eloc-line-classifier.js.
 * Responsibilities:
 *   1. Load `quality-budget-contract.json` defensively with canonical `DEFAULT_QUALITY_BUDGET`;
 *   2. Maintain extension sets and regex rules for C-style, hash, PowerShell, SQL/Lua, and INI;
 *   3. Detect single-line comments, doc-comment prefixes, mechanical trampolines, and wiring lines;
 *   4. Track trailing multi-line block comments, strip inline comments, and count semantic tokens.
 * Exit Semantics & Design Rationale: Pure diagnostic library with zero side effects or process exits.
 */
'use strict';

const DEFAULT_QUALITY_BUDGET = Object.freeze({
  schema: 'quality-budget-contract/v1',
  volume: Object.freeze({
    maxEloc: 900,
    maxLoc: 1400,
    constantMaxEloc: 1800,
    constantMaxLoc: 2500,
    targetDensityRatio: 3.0,
    maxDilutionRatio: 3.0,
  }),
  complexity: Object.freeze({
    maxCc: 15,
    maxPrivateCc: 18,
    maxDispatcherCc: 25,
    maxNestingDepth: 4,
    maxNoiseRatio: 4.0,
  }),
  density: Object.freeze({
    maxPor: 0.6,
    tauMin: 2.5,
    tauMax: 22.0,
  }),
});

/**
 * Loads `scripts/common/quality-budget-contract.json` defensively, falling back to canonical defaults.
 *
 * @returns {typeof DEFAULT_QUALITY_BUDGET} Frozen quality budget contract.
 */
function loadQualityBudgetContract() {
  try {
    const loaded = require('../quality-budget-contract.json');
    if (loaded && typeof loaded === 'object') {
      return Object.freeze({
        schema: loaded.schema || DEFAULT_QUALITY_BUDGET.schema,
        volume: Object.freeze({ ...DEFAULT_QUALITY_BUDGET.volume, ...(loaded.volume || {}) }),
        complexity: Object.freeze({ ...DEFAULT_QUALITY_BUDGET.complexity, ...(loaded.complexity || {}) }),
        density: Object.freeze({ ...DEFAULT_QUALITY_BUDGET.density, ...(loaded.density || {}) }),
      });
    }
  } catch {
    // Fallback to DEFAULT_QUALITY_BUDGET when contract JSON is unavailable during parallel runs.
  }
  return DEFAULT_QUALITY_BUDGET;
}

const QUALITY_BUDGET = loadQualityBudgetContract();

const HASH_DOCSTRING_EXTS = new Set(['.gd', '.py', '.sh', '.bash']);
const HASH_ONLY_EXTS = new Set(['.yml', '.yaml', '.toml', '.rb']);
const POWERSHELL_EXTS = new Set(['.ps1', '.psm1', '.psd1']);
const SQL_LUA_EXTS = new Set(['.sql', '.lua']);
const INI_EXTS = new Set(['.ini', '.cfg', '.conf']);
const HASH_INLINE_EXTS = new Set(['.gd', '.py', '.sh', '.bash', '.ps1', '.psm1', '.psd1', '.yml', '.yaml', '.toml', '.rb']);
const QUOTE_CHARS = new Set(['"', "'", '`']);
const TOKEN_PATTERN = /[a-zA-Z0-9_$]+|===|!==|==|!=|<=|>=|=>|&&|\|\||\+\+|--|[^\s\w]/g;

const RE_WIRING_IMPORT = /^(?:import\s+|import\(|from\s+|require\(|(?:const|let|var)\s+.*=\s*require\()/;
const RE_WIRING_EXPORT = /^export\s+(?:\*|type\s+\*|\{[^}]*\}\s*(?:from\s+[^;]+)?;?|default\s+[A-Za-z0-9_$]+;?$)/;
const RE_WIRING_CJS = /^(?:module\.exports\s*=|exports\.)/;
const RE_WIRING_SHELL = /^(?:source\s+|\.\s+|using\s+|Import-Module\s+)/;
const RE_WIRING_GD = /^(?:extends\s+|class_name\s+|(?:const|var)\s+\w+\s*=\s*preload\()/;

/**
 * Checks whether a trimmed segment begins with a single-line comment delimiter.
 *
 * @param {string} trimmed - Trimmed line segment.
 * @param {string} [ext=''] - Lowercase file extension; empty enables language-agnostic matching.
 * @returns {boolean} True when segment starts with a single-line comment token.
 */
function isSingleLineComment(trimmed, ext = '') {
  if (!ext) {
    return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--') || trimmed.startsWith(';');
  }
  if (POWERSHELL_EXTS.has(ext) || HASH_DOCSTRING_EXTS.has(ext) || HASH_ONLY_EXTS.has(ext)) return trimmed.startsWith('#');
  if (SQL_LUA_EXTS.has(ext)) return trimmed.startsWith('--');
  if (INI_EXTS.has(ext)) return trimmed.startsWith(';') || trimmed.startsWith('#');
  return trimmed.startsWith('//');
}

/**
 * Checks whether a trimmed segment starts with a C/Rust single-line doc comment (`///` or `//!`).
 *
 * @param {string} trimmed - Trimmed line segment.
 * @param {string} [ext=''] - Lowercase file extension.
 * @returns {boolean}
 */
function isDocCommentStart(trimmed, ext = '') {
  if (ext && (POWERSHELL_EXTS.has(ext) || HASH_DOCSTRING_EXTS.has(ext) || HASH_ONLY_EXTS.has(ext) || INI_EXTS.has(ext))) {
    return false;
  }
  return trimmed.startsWith('///') || trimmed.startsWith('//!');
}

/**
 * Detects mechanical forwarding or empty stub lines.
 *
 * @param {string} trimmed - Trimmed line text.
 * @returns {boolean} True if line is a mechanical trampoline.
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
 * Updates block-comment state for trailing block-open tokens outside quotes or line comments.
 *
 * @param {string} codeSlice - Trimmed code segment.
 * @param {{ inBlockComment: boolean, inDocComment: boolean }} state - Mutable block state.
 */
function scanTrailingBlockComment(codeSlice, state) {
  let index = 0;
  let activeQuote = '';
  while (index < codeSlice.length) {
    const ch = codeSlice[index];
    if (activeQuote) {
      if (ch === '\\' && index + 1 < codeSlice.length) { index += 2; continue; }
      if (ch === activeQuote) activeQuote = '';
      index += 1;
      continue;
    }
    if (QUOTE_CHARS.has(ch)) { activeQuote = ch; index += 1; continue; }
    if (codeSlice.startsWith('//', index)) break;
    if (codeSlice.startsWith('/*', index)) {
      const isDoc = codeSlice.startsWith('/**', index) && !codeSlice.startsWith('/**/', index);
      const closePos = codeSlice.indexOf('*/', index + 2);
      if (closePos >= 0) { index = closePos + 2; continue; }
      state.inBlockComment = true;
      state.inDocComment = isDoc;
      break;
    }
    index += 1;
  }
}

function isInlineCommentAt(line, index, ext) {
  const ch = line[index];
  if (HASH_INLINE_EXTS.has(ext)) return ch === '#';
  if (SQL_LUA_EXTS.has(ext)) return ch === '-' && line[index + 1] === '-';
  if (INI_EXTS.has(ext)) return ch === ';' || ch === '#';
  return ch === '/' && line[index + 1] === '/';
}

/**
 * Strips trailing single-line comments from a code line while respecting quoted literals.
 *
 * @param {string} line - Raw line text.
 * @param {string} [ext=''] - Lowercase file extension.
 * @returns {string} Code text with trailing inline comment removed.
 */
function stripInlineComment(line, ext = '') {
  if (!line) return '';
  const normExt = ext ? ext.toLowerCase() : '';
  let inQuote = null;
  let isEscaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (isEscaped) { isEscaped = false; continue; }
    if (ch === '\\') { isEscaped = true; continue; }
    if (inQuote) { if (ch === inQuote) inQuote = null; continue; }
    if (QUOTE_CHARS.has(ch)) { inQuote = ch; continue; }
    if (isInlineCommentAt(line, i, normExt)) return line.slice(0, i);
  }
  return line;
}

/**
 * Counts semantic tokens in a comment-stripped code segment.
 *
 * @param {string} text - Comment-stripped source text.
 * @returns {number} Semantic token count.
 */
function countSemanticTokens(text) {
  if (!text) return 0;
  const matches = text.match(TOKEN_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * Detects whether a trimmed effective code line is pure wiring/plumbing
 * (import, export forwarding, require, module.exports, source, extends/preload).
 *
 * @param {string} trimmedLine - Comment-stripped, trimmed code line.
 * @param {string} [ext=''] - Lowercase file extension.
 * @returns {boolean} True when the line represents pure wiring/plumbing.
 */
function isWiringLine(trimmedLine, ext = '') {
  if (!trimmedLine) return false;
  if (
    RE_WIRING_IMPORT.test(trimmedLine) ||
    RE_WIRING_EXPORT.test(trimmedLine) ||
    RE_WIRING_CJS.test(trimmedLine) ||
    RE_WIRING_SHELL.test(trimmedLine)
  ) {
    return true;
  }
  return ext === '.gd' && RE_WIRING_GD.test(trimmedLine);
}

module.exports = Object.freeze({
  DEFAULT_QUALITY_BUDGET,
  QUALITY_BUDGET,
  loadQualityBudgetContract,
  HASH_DOCSTRING_EXTS,
  HASH_ONLY_EXTS,
  POWERSHELL_EXTS,
  SQL_LUA_EXTS,
  INI_EXTS,
  isSingleLineComment,
  isDocCommentStart,
  isMechanicalTrampoline,
  scanTrailingBlockComment,
  stripInlineComment,
  countSemanticTokens,
  isWiringLine,
});
