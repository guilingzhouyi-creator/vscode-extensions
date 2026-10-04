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

const DEFAULT_MAX_ELOC = 800;
const DEFAULT_MAX_LOC = 1200;
const DEFAULT_WARN_ELOC = 650;
const DEFAULT_WARN_LOC = 900;

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
 * @returns {{ totalLoc: number, blankLines: number, commentLines: number, eloc: number, commentRatio: number }}
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
  return { totalLoc, blankLines, commentLines, eloc, commentRatio };
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
  const parsed = parseInt(value, 10);
  if (!Number.isNaN(parsed)) {
    options[key] = parsed;
  }
}

/**
 * Parses CLI options and targets using flat control flow.
 */
function parseArgs(args) {
  const options = {
    maxEloc: DEFAULT_MAX_ELOC,
    maxLoc: DEFAULT_MAX_LOC,
    warnEloc: DEFAULT_WARN_ELOC,
    warnLoc: DEFAULT_WARN_LOC,
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
    if (arg === '--max-eloc' && i < args.length) {
      applyNumericOption(options, 'maxEloc', args[i++]);
      continue;
    }
    if (arg === '--max-loc' && i < args.length) {
      applyNumericOption(options, 'maxLoc', args[i++]);
      continue;
    }
    if (arg === '--warn-eloc' && i < args.length) {
      applyNumericOption(options, 'warnEloc', args[i++]);
      continue;
    }
    if (arg === '--warn-loc' && i < args.length) {
      applyNumericOption(options, 'warnLoc', args[i++]);
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
    `  ▶ 检查 ${uniqueFiles.length} 个源文件的双轨体积预算 (ELOC <= ${options.maxEloc}, LOC <= ${options.maxLoc})...`,
  );

  const violations = [];
  const warnings = [];
  const summaries = [];

  for (const file of uniqueFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const ext = path.extname(file).toLowerCase();
    const metrics = evaluateCodeMetrics(content, ext);
    const relPath = path.relative(process.cwd(), file).replace(/\\/g, '/');

    summaries.push({ relPath, ...metrics });

    if (metrics.eloc > options.maxEloc) {
      violations.push({
        file: relPath,
        reason: `ELOC 超标: 有效代码行 ${metrics.eloc} > 刚性预算 ${options.maxEloc} (物理 LOC: ${metrics.totalLoc})`,
      });
    } else if (metrics.totalLoc > options.maxLoc) {
      violations.push({
        file: relPath,
        reason: `物理 LOC 超标: 总行数 ${metrics.totalLoc} > 物理兜底线 ${options.maxLoc} (有效 ELOC: ${metrics.eloc})`,
      });
    } else if (metrics.eloc >= options.warnEloc || metrics.totalLoc >= options.warnLoc) {
      warnings.push({
        file: relPath,
        notice: `接近规模上限: ${metrics.eloc} ELOC / ${metrics.totalLoc} LOC (有效占比: ${((metrics.eloc / metrics.totalLoc) * 100).toFixed(1)}%)`,
      });
    }
  }

  if (warnings.length > 0) {
    console.log(`  ℹ️ [NOTICE] ${warnings.length} 个文件接近规模上限:`);
    for (const w of warnings) {
      console.log(`     - ${w.file}: ${w.notice}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n❌ [FAIL] 发现 ${violations.length} 个文件超出双轨体积预算:`);
    for (const v of violations) {
      console.error(`   - ${v.file}: ${v.reason}`);
    }
    console.error(`   👉 请重构拆分上述模块，降低单个文件的控制流规模或排版行数。\n`);
    process.exit(1);
  }

  summaries.sort((a, b) => b.eloc - a.eloc);
  const top = summaries[0];
  console.log(
    `  ✔ [PASS] 100% 文件符合双轨体积预算 (最高观测: ${top.relPath} -> ${top.eloc} ELOC / ${top.totalLoc} LOC)`,
  );
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = {
  evaluateCodeMetrics,
  classifyCStyleLine,
  classifyHashStyleLine,
};
