/**
 * Module: Tooling / Commit Message Typography & Section Density Validator
 * File Path: scripts/common/lib/commit-typography-validator.js
 * Architecture Role: Isolated evaluator for typography, punctuation, character boundaries, and section substantive density
 * Dependencies & Triggers: Consumed by commit-structure-contract.js and git commit-msg gates
 * Responsibilities:
 *   1. Reject zero-width characters, BOM, full-width punctuation, and emoji in commit messages;
 *   2. Enforce bracket formatting and hyphen list item standards;
 *   3. Enforce substantive length floors for Why, Fixed, Verification, and bullet items.
 * Exit Semantics & Design Rationale: Diagnostic sink collector.
 *   Extracted from commit-structure-contract.js to satisfy 5D ELOC micro-bounds and single responsibility.
 */

'use strict';

const ZERO_WIDTH_REGEX = /[\u200B\u200C\u200D\u200E\u200F\uFEFF]/;
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const FULLWIDTH_COLON_REGEX = /[）\)]：|\b[a-z]+(\([^\)]+\))?：/;
const MISSING_COLON_SPACE_REGEX = /\):[^\s]/;
const MULTI_COLON_SPACE_REGEX = /\):\s{2,}/;

/**
 * Verifies typography, character encoding, hidden control characters, and punctuation.
 *
 * @param {string} content - Full raw commit message.
 * @param {{body: string}} parsed - Parsed message parts.
 * @param {object} STEP - Step identity enum.
 * @param {Function} add - Finding sink.
 */
function checkTypographyAndPunctuation(content, parsed, STEP, add) {
  if (ZERO_WIDTH_REGEX.test(content)) {
    add(
      STEP.density,
      'GUARD-MSG-001',
      '提交信息包含非法零宽或隐藏格式控制字符 (如 BOM, ZWSP, ZWNJ)',
      'remove zero-width and invisible control characters; ensure UTF-8 without BOM'
    );
  }

  if (/\n\s*\n\s*\n/.test(parsed.body)) {
    add(
      STEP.split,
      'GUARD-MSG-001',
      '正文包含连续多个空行注水，区块之间严格仅允许单个空行分隔',
      'remove consecutive blank lines, keeping exactly one blank line between sections'
    );
  }

  const lines = parsed.body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[【［]/.test(line) || /[】］]$/.test(line)) {
      add(
        STEP.sections,
        'GUARD-MSG-001',
        `区块标题使用了全角或方头括号: "${line}" (第 ${i + 3} 行)`,
        "use standard ASCII square brackets '[' and ']'"
      );
    }
    if (/^[*+•、]\s+/.test(line)) {
      add(
        STEP.sections,
        'GUARD-MSG-001',
        `列表项使用了非法符号开头: "${line.slice(0, 5)}" (第 ${i + 3} 行)`,
        "list items must start with ASCII hyphen and space ('- ')"
      );
    }
  }
}

/**
 * Parses the commit body into a dictionary of section line arrays.
 *
 * @param {string} body - Commit body.
 * @returns {Record<string, string[]>} Map of section name to line array.
 */
function parseSectionLines(body) {
  const lines = body.split(/\r?\n/);
  const sections = {};
  let currentKey = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = /^\[([a-zA-Z\u4e00-\u9fff\s/]+)\]/.exec(trimmed);
    if (headingMatch) {
      if (currentKey) {
        sections[currentKey] = currentLines;
      }
      currentKey = headingMatch[1].toLowerCase();
      currentLines = [];
      continue;
    }
    if (currentKey) {
      currentLines.push(line);
    }
  }
  if (currentKey) {
    sections[currentKey] = currentLines;
  }
  return sections;
}

/**
 * Validates threshold bounds for specialized sections (Why, Fixed, Verification).
 *
 * @param {string} key - Lowercase section key.
 * @param {number} substantive - Count of substantive characters.
 * @param {object} STEP - Step identity enum.
 * @param {Function} add - Finding sink.
 */
function checkSectionThreshold(key, substantive, STEP, add) {
  if (substantive <= 0) return;
  if ((key.includes('why') || key.includes('动机') || key.includes('背景')) && substantive < 15) {
    add(
      STEP.density,
      'GUARD-MSG-001',
      `[Why / 动机背景] 区块实质字数不足 (${substantive} < 15 字符)`,
      'explain the architectural rationale and trigger background in detail'
    );
  }
  if ((key.includes('fixed') || key.includes('修复')) && substantive < 12) {
    add(
      STEP.density,
      'GUARD-MSG-001',
      `[Fixed / 修复缺陷] 区块实质字数不足 (${substantive} < 12 字符)`,
      'describe defect symptom, root cause and remedy with at least 12 characters'
    );
  }
  if ((key.includes('verification') || key.includes('验证')) && substantive < 12) {
    add(
      STEP.density,
      'GUARD-MSG-001',
      `[Verification / 验证闭环] 区块实质字数不足 (${substantive} < 12 字符)`,
      'provide falsifiable verification assertion with at least 12 characters'
    );
  }
}

/**
 * Checks bullet item length invariants for modification lists.
 *
 * @param {string[]} sLines - Section lines.
 * @param {object} STEP - Step identity enum.
 * @param {Function} add - Finding sink.
 */
function checkBulletItemLengths(sLines, STEP, add) {
  const bulletItems = sLines.map((l) => l.trim()).filter((l) => l.startsWith('-'));
  for (const item of bulletItems) {
    const itemSubstantive = item.replace(/^-\s*/, '').replace(/[\s`'"]/g, '').length;
    if (itemSubstantive > 0 && itemSubstantive < 8 && !item.includes('<')) {
      add(
        STEP.density,
        'GUARD-MSG-001',
        `清单条目内容过短 (${itemSubstantive} < 8 字符): "${item}"`,
        'each bullet item must contain at least 8 substantive characters describing what changed'
      );
    }
  }
}

/**
 * Checks density and substantive bounds of individual declared sections.
 *
 * @param {string} body - Commit body.
 * @param {Function} countSubstantive - Function to count substantive characters in line array.
 * @param {object} STEP - Step identity enum.
 * @param {Function} add - Finding sink.
 */
function checkSectionDensityBounds(body, countSubstantive, STEP, add) {
  const sections = parseSectionLines(body);
  for (const [key, sLines] of Object.entries(sections)) {
    const substantive = countSubstantive(sLines);
    checkSectionThreshold(key, substantive, STEP, add);
    if (key.includes('added') || key.includes('changed') || key.includes('fixed') || key.includes('removed')) {
      checkBulletItemLengths(sLines, STEP, add);
    }
  }
}

module.exports = Object.freeze({
  ZERO_WIDTH_REGEX,
  EMOJI_REGEX,
  FULLWIDTH_COLON_REGEX,
  MISSING_COLON_SPACE_REGEX,
  MULTI_COLON_SPACE_REGEX,
  checkTypographyAndPunctuation,
  checkSectionDensityBounds,
});
