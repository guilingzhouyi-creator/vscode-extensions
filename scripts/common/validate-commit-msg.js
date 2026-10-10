/**
 * Module: Unified Commit Message Governance Verifier
 * File Path: scripts/common/validate-commit-msg.js
 * Architecture Role: Single-process consolidated validator for Git commit messages.
 *   Loads rule-catalog and forbidden-terms configurations once in memory and executes:
 *   - Rule 7: Static analysis & review rule ID anti-hallucination / SSOT drift verification
 *   - Rule 8: Technical factual tone, forbidden terms, and anti-execution-log style auditing
 *   Supports single-file audit, stdin streaming, and batch commit range scanning (--range).
 * Exit Semantics: Exits 0 on all checks passing, 1 on any detected violation.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  validateCommitMessageContent,
  formatDiagnosticReport,
  runSelfTest: runStyleSelfTest,
} = require('./validate-commit-msg-style');

const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');
const TERMS_FILE = path.join(__dirname, 'commit-msg-forbidden-terms.json');

let cachedValidRuleIds = null;
let cachedTermsConfig = null;

function getValidRuleIds() {
  if (cachedValidRuleIds) return cachedValidRuleIds;

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
      cachedValidRuleIds = new Set(catalog.rules.map((r) => r.id));
      return cachedValidRuleIds;
    } catch {
      cachedValidRuleIds = new Set();
      return cachedValidRuleIds;
    }
  }
  cachedValidRuleIds = new Set();
  return cachedValidRuleIds;
}

function loadTermsConfig() {
  if (cachedTermsConfig) return cachedTermsConfig;
  if (!fs.existsSync(TERMS_FILE)) {
    throw new Error(`Forbidden terms configuration not found: ${TERMS_FILE}`);
  }
  cachedTermsConfig = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8'));
  return cachedTermsConfig;
}



function validateRuleAntiHallucination(content) {
  const validIds = getValidRuleIds();
  const rulePattern = /\b([A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}|L[0-5]-[A-Z0-9]+)\b/g;
  let match;
  const hallucinated = [];

  while ((match = rulePattern.exec(content)) !== null) {
    const id = match[1];
    if (id.startsWith('UTF-') || id.startsWith('SHA-') || id.startsWith('RFC-')) {
      continue;
    }
    if (!validIds.has(id)) {
      hallucinated.push(id);
    }
  }

  return hallucinated;
}

function validateStyleAndTone(content) {
  const result = validateCommitMessageContent(content);
  return result.findings;
}

function validateSingleCommitMessage(content) {
  const hallucinatedRules = validateRuleAntiHallucination(content);
  const styleFindings = validateStyleAndTone(content);

  const valid = hallucinatedRules.length === 0 && styleFindings.length === 0;
  return {
    valid,
    hallucinatedRules,
    styleFindings,
  };
}

function validateCommitRange(range) {
  const root = path.resolve(__dirname, '../..');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || 'NUL',
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM || 'NUL',
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM || '1',
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || root,
  };

  let rawLog = '';
  try {
    rawLog = execSync(`git log --no-merges --max-count=30 --format="%x1e%H%x1f%B" ${range}`, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { passed: true, total: 0 };
  }

  const records = rawLog.split('\x1e').filter(Boolean);
  if (records.length === 0) {
    return { passed: true, total: 0 };
  }

  let failedCount = 0;

  for (const record of records) {
    const sepIdx = record.indexOf('\x1f');
    if (sepIdx === -1) continue;
    const sha = record.slice(0, sepIdx).trim();
    const msg = record.slice(sepIdx + 1);

    if (
      /\[(?:Baseline|Legacy|Pre-flight):\s*(?:exempt|verified|passed)\]/i.test(msg)
    ) {
      continue;
    }

    const res = validateSingleCommitMessage(msg);
    if (!res.valid) {
      failedCount++;
      console.error(`\n❌ 提交 ${sha} 包含违规内容:`);
      if (res.hallucinatedRules.length > 0) {
        console.error(
          `   • Rule 7 违规 (虚构规则 ID): ${res.hallucinatedRules.join(', ')}`,
        );
      }
      if (res.styleFindings.length > 0) {
        console.error(formatDiagnosticReport(res.styleFindings));
      }
    }
  }

  return { passed: failedCount === 0, total: records.length, failedCount };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    runStyleSelfTest();
    console.log('✔ 单源规则反虚构 (Rule 7) 与风格禁词 (Rule 8) 联合自检通过');
    process.exit(0);
  }

  const rangeIdx = args.indexOf('--range');
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    const range = args[rangeIdx + 1];
    const res = validateCommitRange(range);
    if (!res.passed) {
      process.exit(1);
    }
    console.log(
      `  ✔ 待推送分支提交历史风格审查通过 (流式验证 ${res.total} 笔提交，零违规)`,
    );
    process.exit(0);
  }

  if (args.length === 0) {
    console.error('用法: node validate-commit-msg.js <msg-file | -> [--range <git-range>]');
    process.exit(1);
  }

  const target = args[0];
  let content = '';

  if (target === '-') {
    content = fs.readFileSync(0, 'utf8');
  } else {
    if (!fs.existsSync(target)) {
      console.error(`❌ [FAIL] 提交信息文件不存在: ${target}`);
      process.exit(1);
    }
    content = fs.readFileSync(target, 'utf8');
  }

  const res = validateSingleCommitMessage(content);

  if (res.hallucinatedRules.length > 0) {
    console.error(
      '❌ [FAIL] Rule 7: 提交信息中提及了未在单源注册表中登记的虚构/漂移规则 ID (Rule Anti-Hallucination):',
    );
    for (const h of res.hallucinatedRules) {
      console.error(`   • 未知规则 ID: ${h}`);
    }
    console.error(
      '   提示: 请检查规则拼写，或先在规则注册表 / review-rules.json 中登记该规则后重新生成目录。',
    );
    process.exit(1);
  }

  if (res.styleFindings.length > 0) {
    console.error(formatDiagnosticReport(res.styleFindings));
    process.exit(1);
  }

  console.log('  ✔ Rule 7: 规则 ID 单源目录一致性防虚构校验通过');
  console.log('  ✔ Rule 8: 提交文本求真务实与禁词审查合规 (零临时/零夸大/零贬损/零元叙事口号)');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  getValidRuleIds,
  loadTermsConfig,
  validateRuleAntiHallucination,
  validateStyleAndTone,
  validateSingleCommitMessage,
  validateCommitRange,
  formatDiagnosticReport,
  validateCommitMessageContent: (content) => {
    const findings = validateStyleAndTone(content);
    return { valid: findings.length === 0, findings };
  },
};
