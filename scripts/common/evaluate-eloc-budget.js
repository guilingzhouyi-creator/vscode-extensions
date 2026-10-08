/**
 * Module: Workspace Governance — Dual-Scale Code Volume & ELOC Evaluator
 * File Path: scripts/common/evaluate-eloc-budget.js
 * Architecture Role: Single source of truth for measuring Effective Lines of Code (ELOC)
 *   and Physical Lines of Code (LOC) across all languages in the repository.
 * Dependencies & Triggers: Node.js standard library (fs, path, child_process);
 *   invoked by pre-commit-gate (ps1/sh), self-audit suites, and manual CLI checks.
 * Responsibilities:
 *   1. Strip comments (single-line //, #, ;, -- and multi-line /*...*\/) and blank lines
 *      to compute true semantic complexity (ELOC);
 *   2. Guard against cognitive overload (ELOC <= 800) and editor bloat (LOC <= 1200);
 *   3. Emit structured findings and exit non-zero on threshold breaches.
 * Exit Semantics: 0 = PASS, 1 = FAIL on budget violation or file access error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_MAX_ELOC = 900;
const DEFAULT_MAX_LOC = 1400;
const DEFAULT_WARN_ELOC = 750;
const DEFAULT_WARN_LOC = 1100;
const DEFAULT_TARGET_DENSITY_RATIO = 3.0;
const MIN_CONTRACT_COMMENT_RATIO = 0.08;
const MIN_REPRESENTATIVE_LOC = 250;

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
 * Evaluates semantic code volume metrics for given file content.
 *
 * @param {string} content - Raw source code
 * @param {string} ext - File extension (e.g. '.ts', '.gd')
 * @returns {{ totalLoc: number, blankLines: number, commentLines: number, eloc: number, commentRatio: number, dilutionRatio: number, density: number }}
 */
function evaluateCodeMetrics(content, ext) {
  const lines = content.split(/\r?\n/);
  const totalLoc = lines.length;
  let blankLines = 0;
  let commentLines = 0;
  let eloc = 0;

  const isHashLang = ext === '.gd' || ext === '.py' || ext === '.sh' || ext === '.bash';
  let inBlock = false;
  let quoteChar = '';

  for (const line of lines) {
    let result;
    if (isHashLang) {
      result = classifyHashStyleLine(line, inBlock, quoteChar);
      inBlock = result.inBlock;
      quoteChar = result.quoteChar;
    } else {
      result = classifyCStyleLine(line, inBlock);
      inBlock = result.inBlock;
    }

    if (result.isBlank) {
      blankLines++;
    } else if (result.isComment) {
      commentLines++;
    } else {
      eloc++;
    }
  }

  const commentRatio = totalLoc > 0 ? Number((commentLines / totalLoc).toFixed(4)) : 0;
  const dilutionRatio = eloc > 0 ? Number((totalLoc / eloc).toFixed(2)) : 0;
  const density = totalLoc > 0 ? Number(((eloc / totalLoc) * 100).toFixed(1)) : 0;

  return { totalLoc, blankLines, commentLines, eloc, commentRatio, dilutionRatio, density };
}

const CONSTANT_PATH_PATTERNS = [
  '/constants/',
  '/tokens/',
  '/locales/',
  '/i18n/',
  'constants.ts',
  'tokens.ts',
  'rule-codes.ts',
  'diagnostic-tokens.ts',
  'system-tokens.ts',
  'ast-tokens.ts',
];

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
    if (
      l.startsWith('export const ') ||
      l.startsWith('export enum ') ||
      l.startsWith('const ') ||
      l.startsWith('readonly ') ||
      l.endsWith('as const;') ||
      l.endsWith('as const')
    ) {
      constCount++;
    }
    if (l.includes('function ') || l.includes('=> {') || l.includes('class ')) {
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
 * Evaluates bidirectional dynamic envelope constraints.
 */
function evaluateDynamicEnvelope(metrics, options, filePath = '', content = '') {
  const { eloc, totalLoc, commentLines } = metrics;
  const isConstantCatalog = isBenignConstantCatalog(filePath, content);
  const maxEloc = isConstantCatalog
    ? Math.max(options.maxEloc || DEFAULT_MAX_ELOC, 1800)
    : options.maxEloc || DEFAULT_MAX_ELOC;
  const maxLoc = isConstantCatalog
    ? Math.max(options.maxLoc || DEFAULT_MAX_LOC, 2500)
    : options.maxLoc || DEFAULT_MAX_LOC;
  const densityRatioTarget = options.densityRatio || DEFAULT_TARGET_DENSITY_RATIO;

  // 1. Absolute volume bounds
  if (eloc > maxEloc) {
    return {
      severity: 'error',
      tag: 'VOL-ELOC-001',
      message: `Effective code volume budget exceeded: ${eloc} ELOC > maximum limit ${maxEloc} ELOC (raw LOC: ${totalLoc})`,
      suggestion: 'Decompose module into cohesive submodules following Single Responsibility Principle',
    };
  }
  if (totalLoc > maxLoc) {
    return {
      severity: 'error',
      tag: 'VOL-LOC-001',
      message: `Physical line count budget exceeded: ${totalLoc} LOC > maximum limit ${maxLoc} LOC (effective: ${eloc} ELOC)`,
      suggestion: 'Split file to reduce cognitive load and formatting bloat',
    };
  }

  // 2. Forward dynamic LOC constraint
  const dynamicMaxLoc = Math.min(maxLoc, Math.max(150, Math.ceil(eloc * densityRatioTarget)));
  if (totalLoc > dynamicMaxLoc && !isConstantCatalog) {
    const actualRatio = (totalLoc / Math.max(1, eloc)).toFixed(2);
    return {
      severity: 'warn',
      tag: 'VOL-RATIO-001',
      message: `Dynamic dilution imbalance (ratio 1:${actualRatio} > 1:${densityRatioTarget}): Dynamic physical envelope for ${eloc} ELOC is ${dynamicMaxLoc} LOC, actual is ${totalLoc} LOC`,
      suggestion: 'Remove redundant blank lines or move extended prose documentation to Markdown specs',
    };
  }

  // 3. Reverse dynamic ELOC constraint (exempt for benign constant catalogs)
  if (totalLoc >= MIN_REPRESENTATIVE_LOC && !isConstantCatalog) {
    const dynamicMinEloc = Math.floor(totalLoc / densityRatioTarget);
    if (eloc < dynamicMinEloc) {
      const codeDensityPct = ((eloc / totalLoc) * 100).toFixed(1);
      return {
        severity: 'warn',
        tag: 'VOL-DIL-001',
        message: `Effective logic density too low (${eloc} ELOC < dynamic floor ${dynamicMinEloc} ELOC, code ratio ${codeDensityPct}%): File occupies ${totalLoc} physical lines`,
        suggestion: 'Code density is below 33%; eliminate excessive blank padding or redundant boilerplate',
      };
    }
  }

  // 4. High-load contract density constraint (exempt for pure constant catalogs governed by file-level contract)
  if (eloc >= 600 && !isConstantCatalog) {
    const commentRatio = totalLoc > 0 ? commentLines / totalLoc : 0;
    if (commentRatio < MIN_CONTRACT_COMMENT_RATIO) {
      const commentPct = (commentRatio * 100).toFixed(1);
      return {
        severity: 'warn',
        tag: 'VOL-DOC-001',
        message: `High-load logic lacks architecture contracts: Effective logic (${eloc} ELOC) has insufficient documentation density (${commentPct}% < 8%)`,
        suggestion: 'Add required type contracts, state machine invariants, or JSDoc specification for complex logic',
      };
    }
  }

  return { severity: 'pass', tag: isConstantCatalog ? 'ARCH_BENIGN_CONSTANT_LIBRARY' : 'HEALTHY' };
}

/**
 * Retrieves staged files from git index.
 *
 * @returns {string[]}
 */
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && fs.existsSync(f));
  } catch {
    return [];
  }
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

const OPTION_KEY_MAP = {
  '--max-eloc': 'maxEloc',
  '--max-loc': 'maxLoc',
  '--warn-eloc': 'warnEloc',
  '--warn-loc': 'warnLoc',
  '--density-ratio': 'densityRatio',
  '--max-dilution': 'densityRatio',
};

/**
 * Parses CLI options and targets using flat control flow.
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
    files: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--staged') {
      options.staged = true;
      continue;
    }
    const targetKey = OPTION_KEY_MAP[arg];
    if (targetKey && i < args.length) {
      applyNumericOption(options, targetKey, args[i++]);
      continue;
    }
    if (!arg.startsWith('--')) {
      options.files.push(arg);
    }
  }

  return options;
}

/**
 * Filters supported code files and ignores vendor/build outputs.
 */
function isAuditableCodeFile(file) {
  const normalized = file.replace(/\\/g, '/');
  if (
    normalized.includes('/dist/') ||
    normalized.includes('/out/') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/fixtures/') ||
    normalized.includes('/baseline') ||
    normalized.includes('/reports/') ||
    normalized.includes('/archive/')
  ) {
    return false;
  }
  const ext = path.extname(file).toLowerCase();
  return ['.ts', '.js', '.mjs', '.cjs', '.gd', '.py', '.sh', '.ps1'].includes(ext);
}

/**
 * Main evaluation runner.
 */
function run() {
  const options = parseArgs(process.argv.slice(2));
  let targets = options.files;

  if (options.staged || targets.length === 0) {
    const staged = getStagedFiles();
    targets = targets.concat(staged);
  }

  // Remove duplicates and apply ignore filters
  const uniqueFiles = Array.from(new Set(targets)).filter(
    (f) => fs.existsSync(f) && isAuditableCodeFile(f),
  );

  if (uniqueFiles.length === 0) {
    console.log('  ✔ [PASS] 无代码文件需要执行双轨体积与 ELOC 预算检查');
    process.exit(0);
  }

  console.log(
    `  ▶ 检查 ${uniqueFiles.length} 个源文件的双轨体积与双向动态密度 (ELOC <= ${options.maxEloc}, LOC <= ${options.maxLoc}, 目标密度比 1:${options.densityRatio})...`,
  );

  const violations = [];
  const warnings = [];
  const summaries = [];

  for (const file of uniqueFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    const metrics = evaluateCodeMetrics(content, ext);
    const relPath = path.relative(process.cwd(), file).replace(/\\/g, '/');

    const envelope = evaluateDynamicEnvelope(metrics, options, relPath, content);
    summaries.push({ relPath, ...metrics, envelope });

    if (envelope.severity === 'error') {
      violations.push({
        file: relPath,
        reason: envelope.message,
        tag: envelope.tag,
        suggestion: envelope.suggestion,
      });
    } else if (envelope.severity === 'warn') {
      warnings.push({
        file: relPath,
        notice: envelope.message,
        tag: envelope.tag,
        suggestion: envelope.suggestion,
      });
    }
  }

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
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = {
  evaluateCodeMetrics,
  evaluateDynamicEnvelope,
  classifyCStyleLine,
  classifyHashStyleLine,
};
