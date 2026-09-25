#!/usr/bin/env node
/**
 * Module: Verification Harness — Self Norms (language and constant discipline)
 * File Path: scripts/validate-self-norms.js
 * Architecture Role: Ratchet over two norms the engine already satisfies but nothing enforced:
 *   code positions in `src` must stay ASCII (the substrate's identifiers and syntax are
 *   English-only), and governance rule bodies must not carry inline numeric thresholds.
 * Dependencies & Triggers: `npm run validate-self-norms`; reads `src/**\/*.ts` and the shared
 *   source-mask primitive; needs a prior `npm run build`.
 * Responsibilities: Assert zero non-ASCII characters outside comments and string literals at every
 *   layer; assert no inline numeric comparison stands in for a named or configured threshold; and
 *   fail when a rule hardcodes a path fragment outside the recorded debt baseline.
 * Exit Semantics & Design Rationale: Exits 1 on any new violation so a regression cannot be merged
 *   silently, and exits 0 when the tree matches the recorded state. Measured via the masker rather
 *   than a regex: a character's position in the masked view is what distinguishes prose from code,
 *   which is exactly the distinction both norms are about. The path-fragment baseline is explicit
 *   debt, not an exemption list: adding to it requires editing this file, which is the review the
 *   norm is meant to force.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { maskSourceText, SOURCE_MASK_PRESETS } = require(path.join(ROOT, 'dist/core/source-mask'));

/**
 * Rule files that still hardcode path fragments, with the reason. Recorded debt: shrinking this
 * list is the goal, and a NEW file appearing here is a failure rather than a footnote.
 */
/**
 * Rule files that still exempt a corpus by NAME rather than by directory, with the reason.
 * Recorded debt: shrinking this list is the goal, and a NEW file appearing here is a failure
 * rather than a footnote. The directory-membership form is no longer debt at all - every
 * `includes('/<dir>/')` guard migrated to `pathScope.pathHasSegment`, because the substring form
 * silently never matched the repository-relative paths this engine produces.
 */
const HARDCODED_PATH_DEBT = {
  'src/core/governance/rules/debugLogging.ts': 'entry-point name suffixes (index.ts, cli.ts)',
  'src/core/governance/rules/exceptionSafety.ts': 'Rust test-file name suffix (_test.rs)',
  'src/core/governance/rules/sanitization.ts': 'self-description name suffix (sanitization.ts)',
};

/**
 * Collect every TypeScript file under a directory.
 *
 * @param dir - Directory to walk.
 * @param out - Accumulator for absolute paths.
 * @returns Absolute paths of every `.ts` file found.
 */
function tsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Check 1: no non-ASCII character may appear at a code position anywhere in `src`.
 *
 * @returns List of human-readable violations.
 */
function checkAsciiCodePositions() {
  const violations = [];
  for (const abs of tsFiles(path.join(ROOT, 'src'))) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const content = fs.readFileSync(abs, 'utf8');
    const { raw, masked } = maskSourceText(content, SOURCE_MASK_PRESETS.typescript);
    for (let i = 0; i < raw.length; i += 1) {
      const line = raw[i];
      if (!/[^\u0000-\u007f]/.test(line)) continue;
      const m = masked[i] ?? '';
      for (let c = 0; c < line.length; c += 1) {
        if (line.charCodeAt(c) < 0x80) continue;
        if ((m[c] ?? ' ') === ' ') continue; // inside a comment or literal: allowed prose
        violations.push(`${rel}:${i + 1} non-ASCII at a code position`);
      }
    }
  }
  return violations;
}

/**
 * Check 2: rule bodies must not compare against an inline numeric threshold.
 *
 * @returns List of human-readable violations.
 */
function checkInlineThresholds() {
  const violations = [];
  const dir = path.join(ROOT, 'src/core/governance/rules');
  for (const abs of tsFiles(dir)) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue; // comment
      if (/^const [A-Z0-9_]+\s*[:=]/.test(line)) continue; // the named constant itself
      if (/[<>]=?\s*\d{2,}|\d{2,}\s*[<>]=?/.test(line)) {
        violations.push(`${rel}:${i + 1} inline numeric threshold: ${line.trim().slice(0, 70)}`);
      }
    }
  }
  return violations;
}

/**
 * Check 3: a rule must not hardcode a path fragment outside the recorded debt list.
 *
 * @returns List of human-readable violations.
 */
function checkHardcodedPaths() {
  const violations = [];
  const dir = path.join(ROOT, 'src/core/governance/rules');
  const debt = Object.keys(HARDCODED_PATH_DEBT);
  for (const abs of tsFiles(dir)) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const text = fs.readFileSync(abs, 'utf8');
    const hit =
      /includes\(['"]\/(?:tests?|benchmarks?|scripts?|samples?)\/['"]\)/.test(text) ||
      /endsWith\(['"][a-z0-9_.-]+\.(?:ts|py|gd|rs)['"]\)/.test(text) ||
      /fileNameEndsWith\([^)]*\[[^\]]*['"][a-z0-9_.-]+\.(?:ts|py|gd|rs)['"]/.test(text);
    if (!hit) continue;
    if (debt.includes(rel)) continue;
    violations.push(`${rel} hardcodes a path fragment and is not in the recorded debt list`);
  }
  return violations;
}

/**
 * Known white-listed constants allowed to contain specific Chinese literals in core messages.
 * Only SIX_FIELD_HEADERS_ZH is permitted, as it defines AST regex matching targets for
 * localized file-header specifications.
 */
const ALLOWED_ZH_LITERALS_IN_MESSAGES = new Set([
  '模块归属',
  '文件路径',
  '架构定位',
  '依赖与触发',
  '职责说明',
  '退出语义与设计依据',
]);

/**
 * Scan a single line's string literals for unauthorized Chinese characters.
 *
 * @param rel - Repo-relative file path.
 * @param lineNum - 1-based line number.
 * @param line - Source line text.
 * @param violations - Violations accumulator.
 */
function scanLineForChineseLiterals(rel, lineNum, line, violations) {
  const codeOnly = line.replace(/\/\/.*$/, '');
  const strRegex = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match;
  while ((match = strRegex.exec(codeOnly)) !== null) {
    const literalContent = match[2];
    if (!/[\u4e00-\u9fa5]/.test(literalContent)) continue;
    if (
      rel === 'src/core/messages/comments.ts' &&
      ALLOWED_ZH_LITERALS_IN_MESSAGES.has(literalContent.trim())
    ) {
      continue;
    }
    violations.push(
      `${rel}:${lineNum} non-English/Chinese text in message/prompt literal: '${literalContent.trim().slice(0, 50)}'`,
    );
  }
}

/**
 * Check one message file for unauthorized Chinese characters.
 *
 * @param abs - Absolute file path.
 * @param violations - Violations accumulator.
 */
function checkSingleMessageFile(abs, violations) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const lines = fs.readFileSync(abs, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    if (!/[\u4e00-\u9fa5]/.test(line)) continue;
    scanLineForChineseLiterals(rel, i + 1, line, violations);
  }
}

/**
 * Check 4: core messages and prompt catalogs must maintain a strict English baseline.
 * String literals across src/core/messages and src/core/guidance must not leak Chinese text
 * outside explicit AST matching target exemptions.
 *
 * @returns List of human-readable violations.
 */
function checkCoreMessageEnglishPurity() {
  const violations = [];
  const targetDirs = [path.join(ROOT, 'src/core/messages'), path.join(ROOT, 'src/core/guidance')];
  const files = targetDirs.flatMap((dir) => (fs.existsSync(dir) ? tsFiles(dir) : []));

  for (const abs of files) {
    checkSingleMessageFile(abs, violations);
  }
  return violations;
}

/**
 * Check one analyzer file for Chinese characters in issue message or suggestion.
 *
 * @param abs - Absolute file path.
 * @param violations - Violations accumulator.
 */
function checkSingleAnalyzerFile(abs, violations) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
    if (/(?:message|suggestion)\s*:\s*[`'"].*[\u4e00-\u9fa5]/.test(line)) {
      violations.push(
        `${rel}:${i + 1} analyzer issue message/suggestion contains Chinese text: ${line.trim().slice(0, 70)}`,
      );
    }
  }
}

/**
 * Check 5: analyzer diagnostic issues (message, suggestion) must adhere to English baseline.
 *
 * @returns List of human-readable violations.
 */
function checkAnalyzerDiagnosticPurity() {
  const violations = [];
  const dir = path.join(ROOT, 'src/analyzers');
  if (!fs.existsSync(dir)) return violations;

  for (const abs of tsFiles(dir)) {
    checkSingleAnalyzerFile(abs, violations);
  }
  return violations;
}

function main() {
  console.log('\n=== Self Norms: language and constant discipline ===');
  const groups = [
    ['ASCII-only at code positions', checkAsciiCodePositions()],
    ['no inline numeric thresholds in rules', checkInlineThresholds()],
    ['no new hardcoded path fragments', checkHardcodedPaths()],
    ['pure English baseline in core messages & prompts', checkCoreMessageEnglishPurity()],
    ['pure English baseline in analyzer diagnostics', checkAnalyzerDiagnosticPurity()],
  ];

  let failed = false;
  for (const [name, violations] of groups) {
    if (violations.length === 0) {
      console.log(`  [PASS] ${name}`);
      continue;
    }
    failed = true;
    console.log(`  [FAIL] ${name} (${violations.length})`);
    for (const v of violations.slice(0, 10)) console.log(`      ${v}`);
  }

  console.log(
    `\n  recorded path-fragment debt (${Object.keys(HARDCODED_PATH_DEBT).length} files, shrink-only):`,
  );
  for (const [file, why] of Object.entries(HARDCODED_PATH_DEBT))
    console.log(`      ${file} — ${why}`);

  if (failed) {
    console.error('\nSELF NORM VIOLATIONS FOUND');
    process.exit(1);
  }
  console.log('\nALL SELF NORM CHECKS PASSED SUCCESSFULLY!');
}

main();
