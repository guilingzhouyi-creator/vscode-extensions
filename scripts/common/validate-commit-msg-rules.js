/**
 * Module: Commit Message Rule Anti-Hallucination Verifier
 * File Path: scripts/common/validate-commit-msg-rules.js
 * Architecture Role: Ensures that any static analysis or review rule IDs mentioned in Git commit messages
 *   exist in the workspace Single-Source-of-Truth rule catalog.
 * Dependencies & Triggers: Invoked by commit-msg-gate.sh and commit-msg-gate.ps1.
 * Exit Semantics: Exits 0 if all mentioned rule IDs are valid or no rule IDs mentioned; exits 1 on hallucinated IDs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');

function getValidRuleIds() {
  if (!fs.existsSync(CATALOG_FILE)) {
    try {
      require('./generate-rule-catalog').generate();
    } catch (err) {
      console.warn('Warning: Failed to dynamically generate rule catalog:', err.message);
    }
  }

  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      return new Set(catalog.rules.map((r) => r.id));
    } catch {
      return new Set();
    }
  }
  return new Set();
}

function validateCommitMsgFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ [FAIL] 提交信息文件不存在: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const validIds = getValidRuleIds();

  // Pattern for rule IDs (e.g. ADV-PRF-002, L0-COMPILE, HYG-DIL-001, etc.)
  const rulePattern = /\b([A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}|L[0-5]-[A-Z0-9]+)\b/g;
  let match;
  const hallucinated = [];

  while ((match = rulePattern.exec(content)) !== null) {
    const id = match[1];
    // Exclude git/system constants if any
    if (id.startsWith('UTF-') || id.startsWith('SHA-') || id.startsWith('RFC-')) {
      continue;
    }
    if (!validIds.has(id)) {
      hallucinated.push(id);
    }
  }

  if (hallucinated.length > 0) {
    console.error('❌ [FAIL] Rule 7: 提交信息中提及了未在单源注册表中登记的虚构/漂移规则 ID (Rule Anti-Hallucination):');
    for (const h of hallucinated) {
      console.error(`   • 未知规则 ID: ${h}`);
    }
    console.error('   提示: 请检查规则拼写，或先在规则注册表 / review-rules.json 中登记该规则后重新生成目录。');
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/common/validate-commit-msg-rules.js <commit-msg-file>');
    process.exit(1);
  }
  validateCommitMsgFile(fileArg);
}

module.exports = { validateCommitMsgFile };
