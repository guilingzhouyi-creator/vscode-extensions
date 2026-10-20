/**
 * Module: Workspace Governance — Dual-Scale Code Volume & 5D Code Density Evaluator
 * File Path: scripts/common/evaluate-eloc-budget.js
 * Architecture Role: Single source of truth for measuring Effective Lines of Code (ELOC),
 *   Physical Lines of Code (LOC), semantic token column density, and plumbing overhead
 *   across all languages in the repository.
 * Dependencies & Triggers: Node.js standard library (fs, path, child_process);
 *   invoked by pre-commit-gate (ps1/sh), validate-code-density.js, self-audit suites,
 *   and manual CLI checks.
 * Responsibilities:
 *   1. Strip comments (single-line //, #, ;, -- and multi-line /*...*\/) and blank lines
 *      to compute true semantic complexity (ELOC);
 *   2. Calculate semantic token density tau and log-normal column density rho_col;
 *   3. Enforce dynamic volume envelopes (ELOC <= 900, LOC <= 1400, density ratio 1:3);
 *   4. Evaluate True Semantic Payload Ratio (TSPR) and Plumbing Overhead Ratio (POR);
 *   5. Emit structured findings and exit non-zero on threshold breaches.
 * Exit Semantics & Design Rationale: 0 = PASS, 1 = FAIL on budget violation or file access error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getStagedFiles: queryStagedFiles } = require('./git-env');

const DEFAULT_MAX_ELOC = 900;
const DEFAULT_MAX_LOC = 1400;
const DEFAULT_WARN_ELOC = 750;
const DEFAULT_WARN_LOC = 1100;
const DEFAULT_TARGET_DENSITY_RATIO = 3.0;
const MIN_CONTRACT_COMMENT_RATIO = 0.08;
const MIN_REPRESENTATIVE_LOC = 250;

const LOG_NORMAL_MU = Math.log(7.5);
const LOG_NORMAL_SIGMA = 0.55;
const LOG_NORMAL_DENOM = 2 * LOG_NORMAL_SIGMA * LOG_NORMAL_SIGMA; // 0.605
const MAX_PLUMBING_RATIO = 0.60;
const MIN_TOKENS_PER_ELOC = 2.5;
const MAX_TOKENS_PER_ELOC = 22.0;

const TAG_VOL_ELOC = 'VOL-ELOC-001';
const TAG_VOL_LOC = 'VOL-LOC-001';
const TAG_VOL_RATIO = 'VOL-RATIO-001';
const TAG_VOL_DIL = 'VOL-DIL-001';
const TAG_VOL_DOC = 'VOL-DOC-001';
const TAG_ARCH_BENIGN = 'ARCH_BENIGN_CONSTANT_LIBRARY';
const TAG_HEALTHY = 'HEALTHY';

const SEVERITY_ERROR = 'error';
const SEVERITY_WARN = 'warn';
const SEVERITY_PASS = 'pass';

const SUGGESTION_SRP = 'Decompose module into cohesive submodules following Single Responsibility Principle';
const SUGGESTION_SPLIT = 'Split file to reduce cognitive load and formatting bloat';
const SUGGESTION_PROSE = 'Remove redundant blank lines or move extended prose documentation to Markdown specs';
const SUGGESTION_DENSITY = 'Code density is below 33%; eliminate excessive blank padding or redundant boilerplate';
const SUGGESTION_DOCS = 'Add required type contracts, state machine invariants, or JSDoc specification for complex logic';

const CONSTANT_MAX_ELOC = 1800;
const CONSTANT_MAX_LOC = 2500;
const DYNAMIC_MIN_PHYSICAL_LOC = 150;
const HIGH_LOAD_ELOC_THRESHOLD = 600;

/**
 * Multi-language syntactic verbosity coefficients.
 * Aligned with auto-refactor elastic budget matrix to normalize cognitive footprint.
 */
const VERBOSITY_RAW = '.py:0.7\n.gd:0.75\n.ts:1.0\n.js:1.0\n.rs:1.25\n.go:1.4\n.ps1:1.1\n.sh:1.0\n.bash:1.0';
const LANGUAGE_VERBOSITY_FACTORS = Object.freeze(
  Object.fromEntries(VERBOSITY_RAW.split('\n').map((line) => {
    const [ext, val] = line.split(':');
    return [ext, parseFloat(val)];
  }))
);

function getLanguageVerbosityFactor(filePath) {
  if (!filePath) return 1.0;
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_VERBOSITY_FACTORS[ext] || 1.0;
}

/**
 * Checks whether a line in a C-style language (TS, JS) is a comment or blank,
 * updating the block comment state accordingly.
 *
 * @param {string} line
 * @param {boolean} inBlockComment
 * @returns {{ isBlank: boolean, isComment: boolean, inBlock: boolean }}
 */
function classifyCStyleLine(line, inBlockComment) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, isComment: false, inBlock: inBlockComment };
  }

  if (inBlockComment) {
    const endIdx = trimmed.indexOf('*/');
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }

  if (trimmed.startsWith('/*')) {
    const endIdx = trimmed.indexOf('*/', 2);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }

  if (trimmed.startsWith('//') || (trimmed.startsWith('*') && !trimmed.startsWith('*='))) {
    return { isBlank: false, isComment: true, inBlock: false };
  }

  return { isBlank: false, isComment: false, inBlock: false };
}

/**
 * Checks whether a line in a hash-comment language (GDScript, Python, Shell) is a comment or blank.
 *
 * @param {string} line
 * @param {boolean} inTripleQuote
 * @param {string} quoteChar
 * @returns {{ isBlank: boolean, isComment: boolean, inBlock: boolean, quoteChar: string }}
 */
function classifyHashStyleLine(line, inTripleQuote, quoteChar) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, isComment: false, inBlock: inTripleQuote, quoteChar };
  }

  if (inTripleQuote) {
    const endIdx = trimmed.indexOf(quoteChar);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true, quoteChar };
    }
    const rest = trimmed.slice(endIdx + 3).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false, quoteChar: '' };
  }

  if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
    const currentQuote = trimmed.slice(0, 3);
    const endIdx = trimmed.indexOf(currentQuote, 3);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true, quoteChar: currentQuote };
    }
    const rest = trimmed.slice(endIdx + 3).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false, quoteChar: '' };
  }

  if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
    return { isBlank: false, isComment: true, inBlock: false, quoteChar: '' };
  }

  return { isBlank: false, isComment: false, inBlock: false, quoteChar: '' };
}

/**
 * Checks whether a line in a PowerShell script (.ps1) is a comment or blank,
 * handling single-line '#' comments and multi-line '<# ... #>' block comments.
 *
 * @param {string} line
 * @param {boolean} inBlockComment
 * @returns {{ isBlank: boolean, isComment: boolean, inBlock: boolean }}
 */
function classifyPowerShellLine(line, inBlockComment) {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { isBlank: true, isComment: false, inBlock: inBlockComment };
  }

  if (inBlockComment) {
    const endIdx = trimmed.indexOf('#>');
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }

  if (trimmed.startsWith('<#')) {
    const endIdx = trimmed.indexOf('#>', 2);
    if (endIdx === -1) {
      return { isBlank: false, isComment: true, inBlock: true };
    }
    const rest = trimmed.slice(endIdx + 2).trim();
    return { isBlank: false, isComment: rest.length === 0, inBlock: false };
  }

  if (trimmed.startsWith('#')) {
    return { isBlank: false, isComment: true, inBlock: false };
  }

  return { isBlank: false, isComment: false, inBlock: false };
}

const HASH_COMMENT_EXTS = new Set(['.gd', '.py', '.sh', '.bash', '.ps1']);
const QUOTE_CHARS = new Set(['"', "'", '`']);

function isCommentStart(ch, nextCh, isHash) {
  if (isHash) return ch === '#';
  return ch === '/' && nextCh === '/';
}

/**
 * Strips trailing single-line comments from an effective code line,
 * taking string literals into account to avoid false truncation.
 *
 * @param {string} line - Raw line text.
 * @param {string} ext - File extension.
 * @returns {string} Code text with trailing comments removed.
 */
function stripInlineComment(line, ext) {
  if (!line) return '';
  const isHash = HASH_COMMENT_EXTS.has(ext);
  let inQuote = null;
  let isEscaped = false;
  const len = line.length;

  for (let i = 0; i < len; i++) {
    const ch = line[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (QUOTE_CHARS.has(ch)) {
      inQuote = ch;
      continue;
    }
    if (isCommentStart(ch, line[i + 1], isHash)) {
      return line.slice(0, i);
    }
  }
  return line;
}

const TOKEN_PATTERN = /[a-zA-Z0-9_$]+|===|!==|==|!=|<=|>=|=>|&&|\|\||\+\+|--|[^\s\w]/g;

/**
 * Counts the number of semantic tokens in a code segment.
 *
 * @param {string} text - Code text stripped of comments.
 * @returns {number} Token count.
 */
function countSemanticTokens(text) {
  if (!text) return 0;
  const matches = text.match(TOKEN_PATTERN);
  return matches ? matches.length : 0;
}

/**
 * Detects whether a code line represents pure wiring/plumbing
 * (import, export forwarding, from, require, use, source).
 *
 * @param {string} trimmedLine - Cleaned, trimmed code line.
 * @param {string} ext - File extension.
 * @returns {boolean} True if the line is a plumbing statement.
 */
const RE_PLUMBING_IMPORT = /^(?:import\s+|import\(|from\s+|require\(|(?:const|let|var)\s+.*=\s*require\()/;
const RE_PLUMBING_EXPORT = /^export\s+(?:\*|type\s+\*|\{[^}]*\}\s*(?:from\s+[^;]+)?;?|default\s+[A-Za-z0-9_$]+;?$)/;
const RE_PLUMBING_CJS = /^(?:module\.exports\s*=|exports\.)/;
const RE_PLUMBING_SHELL = /^(?:source\s+|\.\s+|using\s+|Import-Module\s+)/;
const RE_PLUMBING_GD = /^(?:extends\s+|class_name\s+|(?:const|var)\s+\w+\s*=\s*preload\()/;
const RE_CONST_DECL = /^(?:export\s+(?:const|enum)|const|readonly)\s+|as\s+const;?$/;
const RE_FN_OR_CLASS = /function\s+|=>\s*\{|class\s+/;

const CONSTANT_PATH_PATTERNS = Object.freeze(
  '/constants/,/tokens/,/locales/,/i18n/,/types/,constants.ts,tokens.ts,rule-codes.ts,diagnostic-tokens.ts,system-tokens.ts,ast-tokens.ts,_types.gd,_types.ts,-types.ts'.split(',')
);

function isPlumbingLine(trimmedLine, ext) {
  if (!trimmedLine) return false;
  if (RE_PLUMBING_IMPORT.test(trimmedLine)) return true;
  if (RE_PLUMBING_EXPORT.test(trimmedLine)) return true;
  if (RE_PLUMBING_CJS.test(trimmedLine)) return true;
  if (RE_PLUMBING_SHELL.test(trimmedLine)) return true;
  if (ext === '.gd' && RE_PLUMBING_GD.test(trimmedLine)) return true;
  return false;
}

/**
 * Check if the file path matches benign constant catalog patterns.
 *
 * @param {string} filePath - Path to file.
 * @returns {boolean} True if matching path pattern.
 */
function isConstantPath(filePath) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  for (const pat of CONSTANT_PATH_PATTERNS) {
    if (norm.includes(pat)) return true;
  }
  return false;
}

/**
 * Check if file content predominantly consists of constants.
 *
 * @param {string} content - Raw file content.
 * @returns {boolean} True if constant content structure.
 */
function isConstantContentStructure(content) {
  if (!content || typeof content !== 'string') return false;
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));
  if (lines.length < 20) return false;

  let constCount = 0;
  let fnCount = 0;
  for (const l of lines) {
    if (RE_CONST_DECL.test(l)) {
      constCount++;
    }
    if (RE_FN_OR_CLASS.test(l)) {
      fnCount++;
    }
  }
  return constCount / lines.length >= 0.5 && fnCount <= 2;
}

/**
 * Detects whether a file represents a benign constant library or static data dictionary.
 *
 * @param {string} filePath - Path to file
 * @param {string} content - Raw file content
 * @returns {boolean} True if file is recognized as a benign constant catalog
 */
function isBenignConstantCatalog(filePath, content) {
  if (isConstantPath(filePath)) return true;
  return isConstantContentStructure(content);
}

/**
 * Checks whether a file path or content structure qualifies for plumbing/density exemptions.
 *
 * @param {string} filePath - Path to file.
 * @param {string} content - Raw content.
 * @returns {boolean} True if exempt from plumbing overhead check.
 */
function isPlumbingExemptPath(filePath, content = '') {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(norm);

  // 1. Barrel index files (facades specifically designed for re-exporting)
  if (base.startsWith('index.')) return true;

  // 2. TypeScript definition catalogs & type/enum contract dictionaries
  if (
    norm.endsWith('.d.ts') ||
    base.endsWith('_types.gd') ||
    base.endsWith('_types.ts') ||
    base.endsWith('-types.ts') ||
    norm.includes('/types/')
  ) {
    return true;
  }

  // 3. Benign constant & token catalogs
  if (isConstantPath(filePath)) return true;
  if (content && isConstantContentStructure(content)) return true;

  return false;
}

/**
 * Classifies a single line of source code based on language comment conventions.
 *
 * @param {string} line - Raw line text.
 * @param {string} ext - Lowercase file extension.
 * @param {{ inBlock: boolean, quoteChar: string }} state - Parser block comment state.
 * @returns {{ isBlank: boolean, isComment: boolean }}
 */
function classifySourceLine(line, ext, state) {
  if (ext === '.ps1') {
    const res = classifyPowerShellLine(line, state.inBlock);
    state.inBlock = res.inBlock;
    return res;
  }
  if (HASH_COMMENT_EXTS.has(ext)) {
    const res = classifyHashStyleLine(line, state.inBlock, state.quoteChar);
    state.inBlock = res.inBlock;
    state.quoteChar = res.quoteChar;
    return res;
  }
  const res = classifyCStyleLine(line, state.inBlock);
  state.inBlock = res.inBlock;
  return res;
}

function computeDerivedDensityMetrics({ totalLoc, eloc, commentLines, tokenCount, plumbingLines, isExempt }) {
  const commentRatio = totalLoc > 0 ? Number((commentLines / totalLoc).toFixed(4)) : 0;
  const dilutionRatio = eloc > 0 ? Number((totalLoc / eloc).toFixed(2)) : 0;
  const density = totalLoc > 0 ? Number(((eloc / totalLoc) * 100).toFixed(1)) : 0;

  const tokensPerEloc = eloc > 0 ? Number((tokenCount / eloc).toFixed(2)) : 0;
  let columnDensity = 0;
  if (tokensPerEloc > 0) {
    const lnTau = Math.log(tokensPerEloc);
    const diff = lnTau - LOG_NORMAL_MU;
    columnDensity = Number(Math.exp(-(diff * diff) / LOG_NORMAL_DENOM).toFixed(4));
  }

  const rawPor = eloc > 0 ? plumbingLines / eloc : 0;
  const rawTspr = 1.0 - rawPor;
  const tspr = Number(Math.max(0, Math.min(1.0, rawTspr)).toFixed(4));
  const plumbingRatio = Number(Math.max(0, Math.min(1.0, rawPor)).toFixed(4));

  const isPlumbingOverhead = !isExempt && plumbingRatio > MAX_PLUMBING_RATIO;
  const isColumnDiluted = eloc > 0 && tokensPerEloc < MIN_TOKENS_PER_ELOC;
  const isColumnPacked = tokensPerEloc > MAX_TOKENS_PER_ELOC;

  return {
    commentRatio,
    dilutionRatio,
    density,
    tokensPerEloc,
    columnDensity,
    tspr,
    plumbingRatio,
    isPlumbingOverhead,
    isColumnDiluted,
    isColumnPacked,
  };
}

/**
 * Parses and evaluates all code volume and 5D density metrics for a file.
 *
 * @param {string} content - Raw source code content.
 * @param {string} ext - Lowercase file extension (e.g. '.ts', '.gd').
 * @param {string} filePath - Path to file for exemption evaluation.
 * @returns {{
 *   totalLoc: number,
 *   blankLines: number,
 *   commentLines: number,
 *   eloc: number,
 *   commentRatio: number,
 *   dilutionRatio: number,
 *   density: number,
 *   tokenCount: number,
 *   tokensPerEloc: number,
 *   columnDensity: number,
 *   tspr: number,
 *   plumbingRatio: number,
 *   isPlumbingOverhead: boolean,
 *   isColumnDiluted: boolean,
 *   isColumnPacked: boolean
 * }}
 */
function evaluateCodeMetrics(content, ext, filePath = '') {
  const lines = content.split(/\r?\n/);
  const totalLoc = lines.length;
  let blankLines = 0;
  let commentLines = 0;
  let eloc = 0;
  let tokenCount = 0;
  let plumbingLines = 0;

  const state = { inBlock: false, quoteChar: '' };

  for (const line of lines) {
    const result = classifySourceLine(line, ext, state);
    if (result.isBlank) {
      blankLines++;
    } else if (result.isComment) {
      commentLines++;
    } else {
      eloc++;
      const cleaned = stripInlineComment(line, ext).trim();
      if (cleaned.length > 0) {
        tokenCount += countSemanticTokens(cleaned);
        if (isPlumbingLine(cleaned, ext)) {
          plumbingLines++;
        }
      }
    }
  }

  const isExempt = isPlumbingExemptPath(filePath, content);
  const derived = computeDerivedDensityMetrics({
    totalLoc,
    eloc,
    commentLines,
    tokenCount,
    plumbingLines,
    isExempt,
  });

  return {
    totalLoc,
    blankLines,
    commentLines,
    eloc,
    tokenCount,
    ...derived,
  };
}

/**
 * Evaluates bidirectional dynamic envelope constraints.
 */
function evaluateDynamicEnvelope(metrics, options, filePath = '', content = '') {
  const { eloc, totalLoc, commentLines } = metrics;
  const isConstantCatalog = isBenignConstantCatalog(filePath, content);
  const langFactor = getLanguageVerbosityFactor(filePath);
  const baseMaxEloc = options.maxEloc || DEFAULT_MAX_ELOC;
  const baseMaxLoc = options.maxLoc || DEFAULT_MAX_LOC;
  const maxEloc = isConstantCatalog
    ? Math.max(baseMaxEloc, CONSTANT_MAX_ELOC)
    : Math.round(baseMaxEloc * langFactor);
  const maxLoc = isConstantCatalog
    ? Math.max(baseMaxLoc, CONSTANT_MAX_LOC)
    : Math.round(baseMaxLoc * langFactor);
  const densityRatioTarget = options.densityRatio || DEFAULT_TARGET_DENSITY_RATIO;

  // 1. Absolute volume bounds
  if (eloc > maxEloc) {
    return {
      severity: SEVERITY_ERROR,
      tag: TAG_VOL_ELOC,
      message: `Effective code volume budget exceeded: ${eloc} ELOC > maximum limit ${maxEloc} ELOC (raw LOC: ${totalLoc})`,
      suggestion: SUGGESTION_SRP,
      actionable: {
        action: 'split_function',
        code: TAG_VOL_ELOC,
        taxonomy: 'CTRL_FLOW',
        targetScope: 'module_top_level',
        metricsBreakdown: {
          eloc,
          maxEloc,
          totalLoc,
          maxLoc,
          tokensPerEloc: metrics.tokensPerEloc,
          tspr: metrics.tspr,
        },
        templateSnippet: '// Decompose large functions into submodules or cohesive helpers',
        safeToAutomate: false,
        rationale: 'Effective logic exceeds maximum ELOC budget limit.',
      },
    };
  }
  if (totalLoc > maxLoc) {
    return {
      severity: SEVERITY_ERROR,
      tag: TAG_VOL_LOC,
      message: `Physical line count budget exceeded: ${totalLoc} LOC > maximum limit ${maxLoc} LOC (effective: ${eloc} ELOC)`,
      suggestion: SUGGESTION_SPLIT,
      actionable: {
        action: 'split_function',
        code: TAG_VOL_LOC,
        taxonomy: 'GOV_NORM',
        targetScope: 'module_top_level',
        metricsBreakdown: { eloc, totalLoc, maxLoc },
        templateSnippet: '// Split oversized file into multiple focused units',
        safeToAutomate: false,
        rationale: 'Physical line count exceeds maximum LOC budget limit.',
      },
    };
  }

  // 2. Forward dynamic LOC constraint
  const dynamicMaxLoc = Math.min(maxLoc, Math.max(DYNAMIC_MIN_PHYSICAL_LOC, Math.ceil(eloc * densityRatioTarget)));
  if (totalLoc > dynamicMaxLoc && !isConstantCatalog) {
    const actualRatio = (totalLoc / Math.max(1, eloc)).toFixed(2);
    return {
      severity: SEVERITY_WARN,
      tag: TAG_VOL_RATIO,
      message: `Dynamic dilution imbalance (ratio 1:${actualRatio} > 1:${densityRatioTarget}): Dynamic physical envelope for ${eloc} ELOC is ${dynamicMaxLoc} LOC, actual is ${totalLoc} LOC`,
      suggestion: SUGGESTION_PROSE,
      actionable: {
        action: 'compact_diluted_lines',
        code: TAG_VOL_RATIO,
        taxonomy: 'GOV_NORM',
        targetScope: 'module_top_level',
        metricsBreakdown: {
          eloc,
          totalLoc,
          dynamicMaxLoc,
          actualRatio: Number(actualRatio),
          densityRatioTarget,
        },
        templateSnippet: '// Consolidate fragmented line breaks or move extended prose documentation to Markdown specs',
        safeToAutomate: true,
        rationale: 'Physical line ratio exceeds dynamic envelope target ratio.',
      },
    };
  }

  // 3. Reverse dynamic ELOC constraint (exempt for benign constant catalogs)
  if (totalLoc >= MIN_REPRESENTATIVE_LOC && !isConstantCatalog) {
    const dynamicMinEloc = Math.floor(totalLoc / densityRatioTarget);
    if (eloc < dynamicMinEloc) {
      const codeDensityPct = ((eloc / totalLoc) * 100).toFixed(1);
      return {
        severity: SEVERITY_WARN,
        tag: TAG_VOL_DIL,
        message: `Effective logic density too low (${eloc} ELOC < dynamic floor ${dynamicMinEloc} ELOC, code ratio ${codeDensityPct}%): File occupies ${totalLoc} physical lines`,
        suggestion: SUGGESTION_DENSITY,
        actionable: {
          action: 'compact_diluted_lines',
          code: TAG_VOL_DIL,
          taxonomy: 'GOV_NORM',
          targetScope: 'module_top_level',
          metricsBreakdown: {
            eloc,
            dynamicMinEloc,
            totalLoc,
            codeDensityPct: Number(codeDensityPct),
          },
          templateSnippet: '// Eliminate excessive blank padding, remove trivial stubs, or tighten vertical layout',
          safeToAutomate: true,
          rationale: 'Effective logic density is below dynamic minimum floor.',
        },
      };
    }
  }

  // 4. High-load contract density constraint
  // (exempt for pure constant catalogs governed by file-level contract)
  if (eloc >= HIGH_LOAD_ELOC_THRESHOLD && !isConstantCatalog) {
    const commentRatio = totalLoc > 0 ? commentLines / totalLoc : 0;
    if (commentRatio < MIN_CONTRACT_COMMENT_RATIO) {
      const commentPct = (commentRatio * 100).toFixed(1);
      return {
        severity: SEVERITY_WARN,
        tag: TAG_VOL_DOC,
        message: `High-load logic lacks architecture contracts: Effective logic (${eloc} ELOC) has insufficient documentation density (${commentPct}% < 8%)`,
        suggestion: SUGGESTION_DOCS,
        actionable: {
          action: 'insert_comment_contract',
          code: TAG_VOL_DOC,
          taxonomy: 'GOV_NORM',
          targetScope: 'module_top_level',
          metricsBreakdown: {
            eloc,
            commentRatio,
            minRatio: MIN_CONTRACT_COMMENT_RATIO,
          },
          templateSnippet: '/**\n * Module: ...\n * Responsibilities: ...\n */',
          safeToAutomate: false,
          rationale: 'High-load logic requires standard architecture contract documentation.',
        },
      };
    }
  }

  return { severity: SEVERITY_PASS, tag: isConstantCatalog ? TAG_ARCH_BENIGN : TAG_HEALTHY };
}

/**
 * Retrieves staged files from git index.
 *
 * @returns {string[]}
 */
function getStagedFiles() {
  const root = path.resolve(__dirname, '..', '..');
  return queryStagedFiles(root).filter((f) => fs.existsSync(f));
}

/**
 * Safely applies numeric CLI options.
 */
function applyNumericOption(options, key, value) {
  const parsed = parseFloat(value);
  if (!Number.isNaN(parsed)) {
    options[key] = parsed;
  }
}

/**
 * Safely reads and parses a JSON file.
 */
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Searches upwards for project configuration files with volume overrides.
 */
function findProjectVolumeConfig(targetDir = process.cwd()) {
  let curr = path.resolve(targetDir);
  const root = path.parse(curr).root;
  while (curr && curr !== root) {
    const pkg = readJsonSafe(path.join(curr, 'package.json'));
    const gov = pkg?.governance?.volume || pkg?.governance?.elocBudget;
    if (gov) return gov;

    const cfg = readJsonSafe(path.join(curr, 'autoRefactor.config.json'));
    const thresh = cfg?.thresholds;
    if (thresh?.effectiveLocFail || thresh?.fileLinesFail) {
      return {
        maxEloc: thresh.effectiveLocFail,
        warnEloc: thresh.effectiveLocWarn,
        maxLoc: thresh.fileLinesFail,
        warnLoc: thresh.fileLinesWarn,
      };
    }

    curr = path.dirname(curr);
  }
  return null;
}

const OPTION_MAP_RAW = '--max-eloc:maxEloc\n--max-loc:maxLoc\n--warn-eloc:warnEloc\n--warn-loc:warnLoc\n--density-ratio:densityRatio\n--max-dilution:densityRatio';
const OPTION_KEY_MAP = Object.freeze(
  Object.fromEntries(OPTION_MAP_RAW.split('\n').map((l) => l.split(':')))
);

const USAGE_TEXT = [
  'Usage: node scripts/common/evaluate-eloc-budget.js [options] [files...]',
  '',
  'Target selection (pick one; defaults to staged files):',
  '  --staged                 Evaluate files staged in the Git index',
  '  --all                    Evaluate every auditable source file in the repository',
  '  <files...>               Evaluate explicit paths',
  '',
  'Volume overrides:',
  '  --max-eloc <n>           Hard ELOC ceiling (default 900)',
  '  --max-loc <n>            Hard physical-LOC ceiling (default 1400)',
  '  --warn-eloc <n>          ELOC warning line (default 750)',
  '  --warn-loc <n>           LOC warning line (default 1100)',
  '  --density-ratio <n>      Target LOC:ELOC dilution ratio (default 3.0)',
  '',
  'Output:',
  '  --json                   Emit machine-readable JSON',
  '  --help, -h               Print this message',
].join('\n');

/**
 * Parses CLI options and targets using flat control flow.
 *
 * Unknown flags are collected instead of being silently dropped: a typo such as
 * `--stage` must never degrade the gate into an empty-target green pass.
 *
 * @param {string[]} args - Raw process arguments.
 * @returns {object} Parsed option bag including `unknownArgs` and `help`.
 */
function parseArgs(args) {
  const projCfg = findProjectVolumeConfig();
  const options = {
    maxEloc: typeof projCfg?.maxEloc === 'number' ? projCfg.maxEloc : DEFAULT_MAX_ELOC,
    maxLoc: typeof projCfg?.maxLoc === 'number' ? projCfg.maxLoc : DEFAULT_MAX_LOC,
    warnEloc: typeof projCfg?.warnEloc === 'number' ? projCfg.warnEloc : DEFAULT_WARN_ELOC,
    warnLoc: typeof projCfg?.warnLoc === 'number' ? projCfg.warnLoc : DEFAULT_WARN_LOC,
    densityRatio:
      typeof projCfg?.densityRatio === 'number' ? projCfg.densityRatio : DEFAULT_TARGET_DENSITY_RATIO,
    staged: false,
    all: false,
    json: false,
    help: false,
    unknownArgs: [],
    files: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--staged') {
      options.staged = true;
      continue;
    }
    if (arg === '--all') {
      options.all = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const targetKey = OPTION_KEY_MAP[arg];
    if (targetKey) {
      if (i >= args.length) {
        options.unknownArgs.push(`${arg} (missing value)`);
        continue;
      }
      applyNumericOption(options, targetKey, args[i++]);
      continue;
    }
    if (arg.startsWith('-')) {
      options.unknownArgs.push(arg);
      continue;
    }
    options.files.push(arg);
  }

  return options;
}


const RE_IGNORED_PATHS = /\/(?:dist|out|node_modules|fixtures|baseline|reports|archive)\/|corpus/;
const AUDITABLE_EXTENSIONS = new Set('.ts,.js,.mjs,.cjs,.gd,.py,.sh,.ps1'.split(','));

/**
 * Filters supported code files and ignores vendor/build outputs.
 */
function isAuditableCodeFile(file) {
  const normalized = file.replace(/\\/g, '/');
  if (RE_IGNORED_PATHS.test(normalized)) {
    return false;
  }
  const ext = path.extname(file).toLowerCase();
  return AUDITABLE_EXTENSIONS.has(ext);
}

const RE_IGNORED_DIR_NAMES = new Set([
  '.git', '.agents', 'node_modules', 'dist', 'out', 'fixtures', 'baseline',
  'reports', 'archive', 'build', '.godot', '.refactor-trajectory',
]);

/**
 * Recursively enumerates auditable source files for `--all` mode.
 *
 * Uses the same directory-pruning set as validate-code-density.js so both
 * volume gates observe an identical target universe.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} [fileList] - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function findRepoCodeFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || RE_IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      findRepoCodeFiles(path.join(dir, entry.name), fileList);
      continue;
    }
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
    if (isAuditableCodeFile(rel)) {
      fileList.push(full);
    }
  }
  return fileList;
}

/**
 * Reports a target-selection outcome.
 *
 * @param {object} options - Parsed CLI options.
 * @param {string} note - Human-readable context for the empty result.
 */
function handleEmptyTargets(options, note) {
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: 'PASS',
          totalFiles: 0,
          note,
          violations: [],
          warnings: [],
          files: [],
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(`  ✔ [PASS] 双轨体积与 ELOC 预算检查：${note}`);
  process.exit(0);
}


const DEFAULT_BASELINE_REL = 'scripts/common/eloc-budget-baseline.json';

/**
 * Loads the frozen volume baseline.
 *
 * The baseline records files that already exceeded the envelope before the
 * full-repository scan existed. Entries freeze the current measured ELOC so the
 * gate can block growth without pretending the debt is absent.
 *
 * @param {string} repoRoot - Repository root used to resolve the baseline.
 * @returns {Map<string, number>} relPath -> frozen ELOC.
 */
function loadVolumeBaseline(repoRoot) {
  const baselinePath = path.join(repoRoot, DEFAULT_BASELINE_REL);
  if (!fs.existsSync(baselinePath)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const entries = Array.isArray(parsed?.frozenOverBudget) ? parsed.frozenOverBudget : [];
    return new Map(entries.map((e) => [e.file, Number(e.eloc)]));
  } catch {
    return new Map();
  }
}

/**
 * Applies the ratchet to a violation produced by the absolute envelope.
 *
 * @param {object} violation - Candidate violation record.
 * @param {number} eloc - Measured effective LOC.
 * @param {Map<string, number>} baseline - Frozen ELOC map.
 * @returns {{ suppression: string|null, excess: number }} Ratchet outcome.
 */
function applyVolumeRatchet(violation, eloc, baseline) {
  const frozen = baseline.get(violation.file);
  if (frozen === undefined) {
    return { suppression: null, excess: 0 };
  }
  if (eloc <= frozen) {
    return {
      suppression:
        `frozen at ${frozen} ELOC in eloc-budget-baseline.json; grow-only debt, not a new regression`,
      excess: 0,
    };
  }
  return { suppression: null, excess: eloc - frozen };
}

function auditFileCollection(uniqueFiles, options, baseline = new Map()) {
  const violations = [];
  const warnings = [];
  const summaries = [];

  for (const file of uniqueFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    const relPath = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const metrics = evaluateCodeMetrics(content, ext, relPath);

    const envelope = evaluateDynamicEnvelope(metrics, options, relPath, content);
    summaries.push({ relPath, ...metrics, envelope });

    if (envelope.severity === 'error') {
      const ratchet = applyVolumeRatchet({ file: relPath }, metrics.eloc, baseline);
      if (ratchet.suppression) {
        warnings.push({
          file: relPath,
          notice: `${envelope.message} (${ratchet.suppression})`,
          tag: envelope.tag,
          suggestion: envelope.suggestion,
          actionable: envelope.actionable,
        });
        continue;
      }
      violations.push({
        file: relPath,
        reason: ratchet.excess > 0
          ? `${envelope.message} — exceeded its frozen baseline by ${ratchet.excess} ELOC`
          : envelope.message,
        tag: envelope.tag,
        suggestion: envelope.suggestion,
        actionable: envelope.actionable,
      });
    } else if (envelope.severity === 'warn') {
      warnings.push({
        file: relPath,
        notice: envelope.message,
        tag: envelope.tag,
        suggestion: envelope.suggestion,
        actionable: envelope.actionable,
      });
    }
  }

  return { violations, warnings, summaries };
}


function printHumanAuditSummary(summaries, warnings, violations) {
  if (warnings.length > 0) {
    console.log(`  ℹ️ [NOTICE] ${warnings.length} file(s) touched dynamic envelope threshold:`);
    for (const w of warnings) {
      console.log(`     - ${w.file} [${w.tag}]: ${w.notice}`);
      if (w.suggestion) console.log(`       👉 Suggestion: ${w.suggestion}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ [FAIL] ${violations.length} file(s) exceeded dual-scale code volume budget:`);
    for (const v of violations) {
      console.error(`   - ${v.file} [${v.tag}]: ${v.reason}`);
      if (v.suggestion) console.error(`     👉 Suggestion: ${v.suggestion}`);
    }
    console.error(`   👉 Please decompose the above modules to lower complexity.\n`);
    process.exit(1);
  }

  summaries.sort((a, b) => b.eloc - a.eloc);
  const top = summaries[0];
  console.log(
    `  ✔ [PASS] 100% 文件符合双轨体积与动态包络约束 (最高观测: ${top.relPath} -> ${top.eloc} ELOC / ${top.totalLoc} LOC, 密度: ${top.density}%, 稀释比: 1:${top.dilutionRatio})`,
  );
  console.log(
    `     📊 [DENSITY] 语义载荷与列密度监控: TSPR ${(top.tspr * 100).toFixed(1)}%, τ = ${top.tokensPerEloc} tokens/line, ρ_col = ${top.columnDensity}`,
  );
  process.exit(0);
}

/**
 * Main evaluation runner.
 */
function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE_TEXT);
    process.exit(0);
  }

  if (options.unknownArgs.length > 0) {
    console.error(
      `❌ [FAIL] 无法识别的命令行参数: ${options.unknownArgs.join(', ')}\n` +
        '   未知参数会导致目标文件集合为空，从而产生假绿结果，故此处直接阻断 (VOL-ELOC-001)。\n' +
        `\n${USAGE_TEXT}`,
    );
    process.exit(2);
  }

  let targets = [...options.files];
  if (options.all) {
    targets = targets.concat(findRepoCodeFiles(process.cwd()));
  } else if (options.staged || targets.length === 0) {
    targets = targets.concat(getStagedFiles());
  }

  // Remove duplicates and apply ignore filters
  const uniqueFiles = Array.from(new Set(targets)).filter(
    (f) => fs.existsSync(f) && isAuditableCodeFile(f),
  );

  if (uniqueFiles.length === 0) {
    const note = options.all
      ? '全仓未发现可审计的源码文件'
      : '暂存区与显式入参中无可审计的源码文件';
    handleEmptyTargets(options, note);
    return;
  }


  if (!options.json) {
    console.log(
      `  ▶ 检查 ${uniqueFiles.length} 个源文件的双轨体积与双向动态密度 (ELOC <= ${options.maxEloc}, LOC <= ${options.maxLoc}, 目标密度比 1:${options.densityRatio})...`,
    );
  }

  const baseline = loadVolumeBaseline(path.resolve(__dirname, '../..'));
  const { violations, warnings, summaries } = auditFileCollection(uniqueFiles, options, baseline);


  if (options.json) {
    const report = {
      protocolVersion: '1.0.0',
      status: violations.length === 0 ? 'PASS' : 'FAIL',
      maxEloc: options.maxEloc,
      maxLoc: options.maxLoc,
      targetDensityRatio: options.densityRatio,
      totalFiles: uniqueFiles.length,
      violations,
      warnings,
      agentDirectives: violations.map((v) => ({
        file: v.file,
        ruleId: v.tag,
        action: v.actionable?.action || 'split_function',
        metrics: v.actionable?.metricsBreakdown,
        template: v.actionable?.templateSnippet,
        safeToAutomate: v.actionable?.safeToAutomate ?? false,
      })),
      files: summaries,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  printHumanAuditSummary(summaries, warnings, violations);
}

if (require.main === module) {
  run();
}

module.exports = {
  evaluateCodeMetrics,
  evaluateDynamicEnvelope,
  classifyCStyleLine,
  classifyHashStyleLine,
  classifyPowerShellLine,
  stripInlineComment,
  countSemanticTokens,
  isPlumbingLine,
  isPlumbingExemptPath,
  isConstantPath,
  isConstantContentStructure,
  isBenignConstantCatalog,
  getLanguageVerbosityFactor,
  isAuditableCodeFile,
  getStagedFiles,
};
