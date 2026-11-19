/**
 * Module: Governance Guard — Fast Staged File & Volume Check Primitives
 * File Path: scripts/common/lib/fast-staged-checks.js
 * Architecture Role: Single-pass per-file physical hygiene, comment-shell, indentation, and
 *   dual-scale ELOC/LOC volume evaluators consumed by gate-fast-staged.js, paired with
 *   nomenclature and envelope primitives from lib/fast-staged-nomenclature.js.
 * Dependencies & Triggers: Uses Node.js built-in `path`, `evaluate-eloc-budget.js`,
 *   `./eloc-line-classifier`, and `./fast-staged-nomenclature`; imported by gate-fast-staged.js.
 * Responsibilities:
 *   1. Measure ELOC, physical LOC, and wiring-line ratios using SSOT line classifiers;
 *   2. Enforce EOL, NO-BOM, terminal POSIX newline, space indentation, and non-hollow checks;
 *   3. Enforce dual-scale ELOC/LOC volume budgets, vertical density, and POR ceilings;
 *   4. Re-export nomenclature and violation envelope helpers for backward compatibility.
 * Exit Semantics & Design Rationale: Pure diagnostic library returning or pushing violation
 *   records without mutating process exit state.
 */
'use strict';

const path = require('path');
const { getLanguageVerbosityFactor } = require('../evaluate-eloc-budget');
const { summarizeSourceLines } = require('./eloc-line-classifier');
const {
  RULES,
  SEVERITY_BLOCK,
  MAX_ELOC_BUDGET,
  MAX_LOC_BUDGET,
  DENSITY_RATIO_LIMIT,
  PLUMBING_RATIO_LIMIT,
  VIOLATION_TPLS,
  createViolation,
  pushTemplateViolation,
  validateFilenameSlang,
  isMorphemeValid,
  validateFilenameSegments,
  validateFilenameLength,
  checkClutterAndRootScript,
} = require('./fast-staged-nomenclature');

const COMMENT_CHECK_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.gd', '.py', '.rs', '.sh', '.ps1']);
const INDENT_WIDTH_BY_EXT = Object.freeze({ '.ts': 4, '.tsx': 4, '.js': 2, '.jsx': 2, '.mjs': 2, '.cjs': 2 });

const EOL_CRLF = 'CRLF';
const EOL_LF = 'LF';
const BYTE_CR = 0x0d;
const BYTE_BOM = Object.freeze([0xef, 0xbb, 0xbf]);
const MAX_INDENT_WARNINGS_PER_FILE = 3;

/**
 * Measures ELOC, physical LOC, and wiring-line count for staged content via SSOT classifier.
 *
 * @param {string} content - File content.
 * @param {string} ext - Lowercase file extension.
 * @returns {{ totalLoc: number, eloc: number, wiringCount: number }} Volume metrics.
 */
function calculateEloc(content, ext) {
  const summary = summarizeSourceLines(content, ext);
  return { totalLoc: summary.totalLines, eloc: summary.eloc, wiringCount: summary.wiringLines };
}

/**
 * Validates cross-platform line ending contract (.ps1 must be CRLF, others must be LF).
 *
 * @param {string} file - Relative file path.
 * @param {Buffer} buffer - Raw file byte buffer.
 * @param {Array} lineEndingViolations - Collector array for LINE-ENDING findings.
 */
function validateFileEol(file, buffer, lineEndingViolations) {
  const hasCR = buffer.includes(BYTE_CR);
  if (file.endsWith('.ps1') && !hasCR) {
    pushTemplateViolation(lineEndingViolations, {
      ruleId: RULES.HYG_EOL_001, file, tpl: VIOLATION_TPLS.EOL_PS1,
      message: `PowerShell 脚本必须使用 CRLF 换行符: ${file}`, actual: EOL_LF, expected: EOL_CRLF,
    });
  } else if (hasCR && /\.(?:sh|ts|tsx|js|jsx|mjs|cjs|gd|json|md|py|rs|ya?ml|toml|css|html|svg)$/i.test(file)) {
    pushTemplateViolation(lineEndingViolations, {
      ruleId: RULES.HYG_EOL_001, file, tpl: VIOLATION_TPLS.EOL_LF,
      message: `代码/文档必须使用 LF 换行符，检测到 CRLF: ${file}`, actual: EOL_CRLF, expected: EOL_LF,
    });
  }
}

/**
 * Rejects UTF-8 BOM prefixes on staged text files.
 *
 * @param {Buffer} buffer - Raw staged bytes.
 * @param {string} file - Relative file path.
 * @param {Array} violations - Collector array.
 */
function validateFileBom(buffer, file, violations) {
  const hasBom = buffer.length >= 3 && buffer[0] === BYTE_BOM[0] && buffer[1] === BYTE_BOM[1] && buffer[2] === BYTE_BOM[2];
  if (!hasBom) return;
  violations.push(createViolation({
    ruleId: RULES.HYG_BOM_001, file, message: `检测到 UTF-8 BOM 前缀，必须为 NO-BOM: ${file}`,
    actual: 'UTF-8 with BOM', expected: 'UTF-8 without BOM', actionableFix: '以 UTF-8 无 BOM 重新保存该文件',
  }));
}

/**
 * Enforces a single POSIX terminal newline without trailing blank lines.
 *
 * @param {string} content - Decoded staged content.
 * @param {string} file - Relative file path.
 * @param {Array} violations - Collector array.
 */
function validateFileTerminalNewline(content, file, violations) {
  const missing = !content.endsWith('\n') && !content.endsWith('\r');
  const multiple = /\n[ \t]*\n[ \t]*$/.test(content);
  if (!missing && !multiple) return;
  violations.push(createViolation({
    ruleId: RULES.HYG_TRL_001, file,
    message: missing ? `文件末尾缺少 POSIX 换行: ${file}` : `文件末尾存在多余空行: ${file}`,
    actual: missing ? 'missing terminal newline' : 'multiple trailing newlines',
    expected: 'exactly one terminal newline', actionableFix: '保留且仅保留一个文件末尾换行符',
  }));
}

/**
 * Rejects tab indentation outside GDScript and Makefile.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} violations - Collector array.
 */
function validateFileIndent(file, content, violations) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.gd' || path.basename(file) === 'Makefile' || !content.includes('\t')) return;
  violations.push(createViolation({
    ruleId: RULES.HYG_IND_001, file, message: `非 GDScript 文件出现 Tab 缩进: ${file}`,
    actual: 'tab indentation', expected: 'space indentation only', actionableFix: '将 Tab 替换为空格（TS 4 个，其余 2 个）',
  }));
}

/**
 * Detects comment-only hollow files after stripping language comment syntax.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} violations - Collector array.
 */
function validateCommentOnly(file, content, violations) {
  const ext = path.extname(file).toLowerCase();
  if (!COMMENT_CHECK_EXTENSIONS.has(ext)) return;
  const summary = summarizeSourceLines(content, ext);
  if (summary.eloc > 0 || summary.commentLines === 0) return;
  violations.push(createViolation({
    ruleId: RULES.HYG_EMP_002, file, message: `发现纯注释空壳文件（剥离注释后无有效代码）: ${file}`,
    actual: 'comment-only payload', expected: 'executable or type declarations', actionableFix: '补充实质代码或删除该空壳文件',
  }));
}

/**
 * Collects advisory indent-width warnings for TS/JS files (non-blocking).
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Decoded staged content.
 * @param {Array} warnings - Collector array.
 */
function collectIndentWidthWarnings(file, content, warnings) {
  const ext = path.extname(file).toLowerCase();
  const width = INDENT_WIDTH_BY_EXT[ext];
  if (!width) return;
  const lines = content.split(/\r?\n/);
  let reported = 0;
  for (let index = 0; index < lines.length && reported < MAX_INDENT_WARNINGS_PER_FILE; index += 1) {
    if (/^\s*(?:\*|\/\/|#)/.test(lines[index])) continue;
    const previous = index > 0 ? lines[index - 1].trimEnd() : '';
    if (/[+,[(=?:&|]$/.test(previous)) continue;
    const match = lines[index].match(/^( +)\S/);
    if (!match || match[1].length % width === 0) continue;
    warnings.push({ file, line: index + 1, actual: `${match[1].length} spaces`, expected: `multiple of ${width}` });
    reported += 1;
  }
}

function isPlumbingExemptFast(file) {
  const norm = file.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(norm);
  if (base.startsWith('index.') || norm.endsWith('.d.ts')) return true;
  if (base.endsWith('_types.gd') || base.endsWith('_types.ts') || base.endsWith('-types.ts')) return true;
  if (/(?:\/constants\/|\/tokens\/|\/locales\/|\/i18n\/|\/types\/)/.test(norm)) return true;
  return /(?:tests\/|\.test\.|\.spec\.|test_)/i.test(norm);
}

/**
 * Validates dual-scale volume budgets (ELOC <= 900, LOC <= 1400) and density/POR ratios.
 *
 * @param {string} file - Relative file path.
 * @param {string} content - Raw text content of the file.
 * @param {Array} volumeViolations - Collector array for VOLUME-BUDGET findings.
 */
function validateFileVolume(file, content, volumeViolations) {
  const norm = file.replace(/\\/g, '/');
  if (
    !/\.(?:ts|tsx|js|jsx|gd|py|sh|ps1|mjs|cjs|rs|go)$/i.test(file) ||
    /(?:dist\/|out\/|fixtures\/|baseline|reports\/|\.d\.ts$|corpus)/.test(norm)
  ) {
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const { totalLoc, eloc, wiringCount } = calculateEloc(content, ext);
  const langFactor = typeof getLanguageVerbosityFactor === 'function' ? getLanguageVerbosityFactor(file) : 1.0;
  const maxEloc = Math.round(MAX_ELOC_BUDGET * langFactor);
  const maxLoc = Math.round(MAX_LOC_BUDGET * langFactor);
  if (eloc > maxEloc) {
    pushTemplateViolation(volumeViolations, {
      ruleId: RULES.VOL_ELOC_001, file, tpl: VIOLATION_TPLS.VOL_ELOC,
      message: `单文件有效行数超标 (${eloc} > ${maxEloc} ELOC): ${file}`, actual: `ELOC = ${eloc}`,
    });
  }
  if (totalLoc > maxLoc) {
    pushTemplateViolation(volumeViolations, {
      ruleId: RULES.VOL_LOC_001, file, tpl: VIOLATION_TPLS.VOL_LOC,
      message: `单文件行数超标 (${totalLoc} > ${maxLoc} LOC): ${file}`, actual: `LOC = ${totalLoc}`,
    });
  }
  if (isPlumbingExemptFast(file)) return;
  if (totalLoc >= 250 && eloc > 0 && totalLoc > eloc * DENSITY_RATIO_LIMIT) {
    const actualRatio = (totalLoc / eloc).toFixed(2);
    volumeViolations.push(createViolation({
      ruleId: RULES.VOL_RATIO_001, file,
      message: `垂直行稀释比超标 (LOC: ${totalLoc} > ELOC: ${eloc} * ${DENSITY_RATIO_LIMIT} = ${Math.round(eloc * DENSITY_RATIO_LIMIT)}, 比例 1:${actualRatio}): ${file}`,
      actual: `1:${actualRatio}`, expected: `<= 1:${DENSITY_RATIO_LIMIT.toFixed(2)}`,
      actionableFix: '消除空行堆叠或将长篇散文注释移至 Markdown 规范文档 (VOL-RATIO-001)',
    }));
  }
  if (eloc >= 10 && wiringCount / eloc > PLUMBING_RATIO_LIMIT) {
    const wiringPct = ((wiringCount / eloc) * 100).toFixed(1);
    volumeViolations.push(createViolation({
      ruleId: RULES.ARCH_FAC_001, file,
      message: `接线代码占比超标 (${wiringPct}% > ${(PLUMBING_RATIO_LIMIT * 100).toFixed(1)}%, ELOC: ${eloc}): ${file}`,
      actual: `${wiringPct}%`, expected: `<= ${(PLUMBING_RATIO_LIMIT * 100).toFixed(1)}%`,
      actionableFix: '消除空心透传跳板或为门面注入实质领域能力/不可变性冻结 (ARCH-FAC-001)',
    }));
  }
}

module.exports = Object.freeze({
  RULES,
  SEVERITY_BLOCK,
  MAX_ELOC_BUDGET,
  MAX_LOC_BUDGET,
  DENSITY_RATIO_LIMIT,
  PLUMBING_RATIO_LIMIT,
  VIOLATION_TPLS,
  createViolation,
  calculateEloc,
  validateFilenameSlang,
  isMorphemeValid,
  validateFilenameSegments,
  validateFilenameLength,
  validateFileEol,
  validateFileBom,
  validateFileTerminalNewline,
  validateFileIndent,
  validateCommentOnly,
  collectIndentWidthWarnings,
  validateFileVolume,
  checkClutterAndRootScript,
});
