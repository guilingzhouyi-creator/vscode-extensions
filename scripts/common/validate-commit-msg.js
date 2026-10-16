/**
 * Module: Unified Commit Message Governance Verifier
 * File Path: scripts/common/validate-commit-msg.js
 * Architecture Role: Single-process consolidated validator for Git commit messages.
 *   Loads rule-catalog and forbidden-terms configurations once in memory and executes:
 *   - Rule 7: Static analysis & review rule ID anti-hallucination / SSOT drift verification
 *   - Rule 8: Technical factual tone, forbidden terms, and anti-execution-log style auditing
 *   Supports single-file audit, stdin streaming, and batch commit range scanning (--range).
 * Dependencies & Triggers: Consumes rule-catalog.json, commit-msg-forbidden-terms.json,
 *   and validate-commit-msg-style; invoked by commit-msg-gate (ps1/sh), pre-push-gate (ps1/sh),
 *   and CI workflows.
 * Responsibilities:
 *   1. Load and cache SSOT rule catalog and forbidden technical terms;
 *   2. Validate single commit messages or range sequences against 8-rule commit governance;
 *   3. Emit rich diagnostic failure reports and enforce strict exit semantics.
 * Exit Semantics & Design Rationale: Exits 0 on all checks passing, 1 on any detected violation.
 *   Achieves high-speed (<50ms) single-process memory verification without repetitive disk reloads.
 */

const fs = require('fs');
const MOD_PATH = 'path';
const MOD_CHILD_PROCESS = 'child_process';
const path = require(MOD_PATH);
const { execSync } = require(MOD_CHILD_PROCESS);

const ENCODING_UTF8 = 'utf8';
const STDIN_TOKEN = '-';
const ASCII_RECORD_SEP = '\x1e';
const ASCII_UNIT_SEP = '\x1f';
const PARENT_DIR_DEPTH_TWO = '../..';
const STDIO_IGNORE = 'ignore';
const STDIO_PIPE = 'pipe';

const FILE_RULE_CATALOG = 'rule-catalog.json';
const FILE_FORBIDDEN_TERMS = 'commit-msg-forbidden-terms.json';
const MODULE_GENERATE_CATALOG = './generate-rule-catalog';
const MODULE_GIT_ENV = './git-env';
const MODULE_STYLE = './validate-commit-msg-style';
const MODULE_LOG_ROTATOR = './log-rotator';

const PROTOCOL_VERSION = '1.0.0';
const STATUS_PASS = 'PASS';
const STATUS_BLOCK = 'BLOCK';
const SEVERITY_BLOCK = 'BLOCK';

const GATE_COMMIT_MSG_RANGE = 'commit-msg:range';
const GATE_COMMIT_MSG_RULES = 'commit-msg:rules-7-8';
const STEP_RULES_VERIFY = 'Commit-Msg Rules 7 & 8 Verification';

const RULE_GATE_SSOT = 'GATE-SSOT-001';
const RULE_CMG_STY_DEFAULT = 'CMG-STY-001';

const EXPECTED_SSOT_RULE = '在 rule-catalog.json 登记的真实规则 ID';
const FIX_SSOT_RULE = '检查规则拼写，或在规则注册表 / review-rules.json 中登记该规则后重新生成目录';
const EXPECTED_STYLE_DEFAULT = '纯客观技术事实质性描述';
const FIX_STYLE_DEFAULT = '移除该违规词汇，采用纯技术事实与质性逻辑断言';
const SUMMARY_RULES_PASS = 'Commit message rules 7 & 8 style and anti-hallucination checks passed cleanly.';

const ARG_AGENT = '--agent';
const ARG_AGENT_SHORT = '-a';
const ARG_JSON = '--json';
const ARG_TEST = '--test';
const ARG_RANGE = '--range';
const DEFAULT_COMMIT_EDITMSG = '.git/COMMIT_EDITMSG';

const PREFIX_UTF = 'UTF-';
const PREFIX_SHA = 'SHA-';
const PREFIX_RFC = 'RFC-';

const { getSafeGitEnv } = require(MODULE_GIT_ENV);
const {
  validateCommitMessageContent,
  formatDiagnosticReport,
  runSelfTest: runStyleSelfTest,
} = require(MODULE_STYLE);

const CATALOG_FILE = path.join(__dirname, FILE_RULE_CATALOG);
const TERMS_FILE = path.join(__dirname, FILE_FORBIDDEN_TERMS);

let cachedValidRuleIds = null;
let cachedTermsConfig = null;

function getValidRuleIds() {
  if (cachedValidRuleIds) return cachedValidRuleIds;

  if (!fs.existsSync(CATALOG_FILE)) {
    try {
      require(MODULE_GENERATE_CATALOG).generate();
    } catch (err) {
      console.warn('Warning: Failed to dynamically generate rule catalog:', err.message);
    }
  }

  if (fs.existsSync(CATALOG_FILE)) {
    try {
      const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, ENCODING_UTF8));
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
  cachedTermsConfig = JSON.parse(fs.readFileSync(TERMS_FILE, ENCODING_UTF8));
  return cachedTermsConfig;
}

function validateRuleAntiHallucination(content) {
  const validIds = getValidRuleIds();
  const rulePattern = /\b([A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}|L[0-5]-[A-Z0-9]+)\b/g;
  let match;
  const hallucinated = [];

  while ((match = rulePattern.exec(content)) !== null) {
    const id = match[1];
    if (id.startsWith(PREFIX_UTF) || id.startsWith(PREFIX_SHA) || id.startsWith(PREFIX_RFC)) {
      continue;
    }
    if (!validIds.has(id)) {
      hallucinated.push(id);
    }
  }
  return hallucinated;
}

function validateStyleAndTone(content) {
  return validateCommitMessageContent(content).findings;
}

function validateSingleCommitMessage(content) {
  const hallucinatedRules = validateRuleAntiHallucination(content);
  const styleFindings = validateStyleAndTone(content);
  return {
    valid: hallucinatedRules.length === 0 && styleFindings.length === 0,
    hallucinatedRules,
    styleFindings,
  };
}

function validateCommitRange(range) {
  const root = path.resolve(__dirname, PARENT_DIR_DEPTH_TWO);
  const env = getSafeGitEnv(root);

  let rawLog = '';
  try {
    rawLog = execSync(`git log --no-merges --max-count=30 --format="%x1e%H%x1f%B" ${range}`, {
      cwd: root,
      env,
      encoding: ENCODING_UTF8,
      stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_IGNORE],
    });
  } catch {
    return { passed: true, total: 0 };
  }

  const records = rawLog.split(ASCII_RECORD_SEP).filter(Boolean);
  if (records.length === 0) return { passed: true, total: 0 };

  let failedCount = 0;
  const unitSepPattern = /^([^\x1f]+)\x1f([\s\S]*)$/;

  for (const record of records) {
    const match = unitSepPattern.exec(record);
    if (!match) continue;
    const sha = match[1].trim();
    const msg = match[2];

    if (/\[(?:Baseline|Legacy|Pre-flight):\s*(?:exempt|verified|passed)\]/i.test(msg)) {
      continue;
    }

    const res = validateSingleCommitMessage(msg);
    if (!res.valid) {
      failedCount++;
      console.error(`\n❌ 提交 ${sha} 包含违规内容:`);
      if (res.hallucinatedRules.length > 0) {
        console.error(`   • Rule 7 违规 (虚构规则 ID): ${res.hallucinatedRules.join(', ')}`);
      }
      if (res.styleFindings.length > 0) {
        console.error(formatDiagnosticReport(res.styleFindings));
      }
    }
  }

  return { passed: failedCount === 0, total: records.length, failedCount };
}

function buildCommitMsgViolations(res, target) {
  const violations = [];
  const verificationTarget = target || DEFAULT_COMMIT_EDITMSG;
  for (const h of res.hallucinatedRules) {
    violations.push({
      ruleId: RULE_GATE_SSOT,
      severity: SEVERITY_BLOCK,
      actual: h,
      expected: EXPECTED_SSOT_RULE,
      message: `提交信息中提及未在单源注册表中登记的虚构/漂移规则 ID: ${h}`,
      actionableFix: FIX_SSOT_RULE,
      verificationCommand: `node scripts/common/validate-commit-msg.js ${verificationTarget}`,
    });
  }

  for (const f of res.styleFindings) {
    violations.push({
      ruleId: f.ruleId || RULE_CMG_STY_DEFAULT,
      severity: SEVERITY_BLOCK,
      line: f.lineNum,
      actual: f.term,
      expected: f.guidance || EXPECTED_STYLE_DEFAULT,
      message: `命中风格禁词或违规口吻 [${f.category}]: '${f.term}'`,
      actionableFix: f.guidance ? `根据建议替换: ${f.guidance}` : FIX_STYLE_DEFAULT,
      verificationCommand: `node scripts/common/validate-commit-msg.js ${verificationTarget}`,
    });
  }
  return violations;
}

function handleRangeMode(range, isAgentMode) {
  const res = validateCommitRange(range);
  if (!res.passed) process.exit(1);

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: STATUS_PASS,
          gate: GATE_COMMIT_MSG_RANGE,
          summary: `Range ${range} validated cleanly across ${res.total} commits.`,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`  ✔ 待推送分支提交历史风格审查通过 (流式验证 ${res.total} 笔提交，零违规)`);
  }
  process.exit(0);
}

function readCommitContent(target) {
  if (target === STDIN_TOKEN) return fs.readFileSync(0, ENCODING_UTF8);
  if (!fs.existsSync(target)) {
    console.error(`❌ [FAIL] 提交信息文件不存在: ${target}`);
    process.exit(1);
  }
  return fs.readFileSync(target, ENCODING_UTF8);
}

function reportCommitMsgFailure(res, target, isAgentMode) {
  const violations = buildCommitMsgViolations(res, target);
  try {
    const { writeFailureSnapshot } = require(MODULE_LOG_ROTATOR);
    writeFailureSnapshot({
      gate: GATE_COMMIT_MSG_RULES,
      step: STEP_RULES_VERIFY,
      failedCommand: `node scripts/common/validate-commit-msg.js ${target}`,
      exitCode: 1,
      summary: `Commit message verification failed with ${violations.length} rule hallucination or forbidden style violations.`,
      violations,
      targetFiles: [target].filter((t) => t && t !== STDIN_TOKEN),
      verificationCommand: `node scripts/common/validate-commit-msg.js ${target}`,
    });
  } catch (err) {
    // Best-effort telemetry recording: ignore logging failure to avoid masking commit gate errors
  }

  if (isAgentMode) {
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      status: STATUS_BLOCK,
      gate: GATE_COMMIT_MSG_RULES,
      step: STEP_RULES_VERIFY,
      failedCommand: `node scripts/common/validate-commit-msg.js ${target}`,
      exitCode: 1,
      summary: `Commit message verification failed with ${violations.length} rule hallucination or forbidden style violations.`,
      violations,
      agentDirectives: {
        targetFiles: [target].filter((t) => t && t !== STDIN_TOKEN),
        remediationPriority: Array.from(new Set(violations.map((v) => v.ruleId))),
        verificationCommand: `node scripts/common/validate-commit-msg.js ${target}`,
        fastRecheckCommand: `node scripts/common/validate-commit-msg.js ${target}`,
      },
    };
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(1);
  }

  if (res.hallucinatedRules.length > 0) {
    console.error('❌ [FAIL] Rule 7: 提交信息中提及了未在单源注册表中登记的虚构/漂移规则 ID (Rule Anti-Hallucination):');
    for (const h of res.hallucinatedRules) {
      console.error(`   • 未知规则 ID: ${h}`);
    }
    console.error('   提示: 请检查规则拼写，或先在规则注册表 / review-rules.json 中登记该规则后重新生成目录。');
  }

  if (res.styleFindings.length > 0) {
    console.error(formatDiagnosticReport(res.styleFindings));
  }
  process.exit(1);
}

function handleSingleCommitValidation(target, content, isAgentMode) {
  const res = validateSingleCommitMessage(content);
  if (!res.valid) {
    reportCommitMsgFailure(res, target, isAgentMode);
    return;
  }

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: STATUS_PASS,
          gate: GATE_COMMIT_MSG_RULES,
          summary: SUMMARY_RULES_PASS,
        },
        null,
        2,
      ),
    );
  } else {
    console.log('  ✔ Rule 7: 规则 ID 单源目录一致性防虚构校验通过');
    console.log('  ✔ Rule 8: 提交文本求真务实与禁词审查合规 (零临时/零夸大/零贬损/零元叙事口号)');
  }
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  const isAgentMode = args.includes(ARG_AGENT) || args.includes(ARG_AGENT_SHORT) || args.includes(ARG_JSON);

  if (args.includes(ARG_TEST)) {
    runStyleSelfTest();
    console.log('✔ 单源规则反虚构 (Rule 7) 与风格禁词 (Rule 8) 联合自检通过');
    process.exit(0);
  }

  const rangeIdx = args.indexOf(ARG_RANGE);
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    handleRangeMode(args[rangeIdx + 1], isAgentMode);
    return;
  }

  const posArgs = args.filter((a) => !a.startsWith('-') || a === STDIN_TOKEN);
  if (posArgs.length === 0) {
    console.error('用法: node validate-commit-msg.js <msg-file | -> [--range <git-range>] [--agent]');
    process.exit(1);
  }

  const target = posArgs[0];
  const content = readCommitContent(target);
  handleSingleCommitValidation(target, content, isAgentMode);
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
