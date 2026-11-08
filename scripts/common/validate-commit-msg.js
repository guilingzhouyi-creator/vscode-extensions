/**
 * Module: Unified Commit Message Governance Verifier
 * File Path: scripts/common/validate-commit-msg.js
 * Architecture Role: Single-process consolidated validator for Git commit messages.
 *   Loads rule-catalog and forbidden-terms configurations once in memory and executes:
 *   - RULE-TRUTH-08: Static analysis & review rule ID anti-hallucination / SSOT drift verification
 *   - TEXT-TRUTH-09: Technical factual tone, forbidden terms, and anti-execution-log style auditing
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
const { execFileSync } = require(MOD_CHILD_PROCESS);

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
const MODULE_DEBT_CORRIDOR = './tech-debt-corridor';
const MODULE_STRUCTURE = './commit-structure-contract';

const FILE_COMMIT_HISTORY_BASELINE = 'commit-history-baseline.json';

const PROTOCOL_VERSION = '1.0.0';
const STATUS_PASS = 'PASS';
const STATUS_BLOCK = 'BLOCK';
const STATUS_WARN = 'WARN';
const SEVERITY_BLOCK = 'BLOCK';

const GATE_COMMIT_MSG_RANGE = 'commit-msg:range';
const GATE_COMMIT_MSG_RULES = 'commit-msg:rules-7-8';
const STEP_RULES_VERIFY = 'Commit-Msg Rules 7 & 8 Verification';

const RULE_GATE_SSOT = 'GUARD-SSOT-001';
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
const PREFIX_CVE = 'CVE-';
const PREFIX_ISO = 'ISO-';
const EXTERNAL_ID_PREFIXES = Object.freeze([PREFIX_UTF, PREFIX_SHA, PREFIX_RFC, PREFIX_CVE, PREFIX_ISO]);

const { getSafeGitEnv } = require(MODULE_GIT_ENV);
const {
  validateCommitMessageContent,
  formatDiagnosticReport,
  runSelfTest: runStyleSelfTest,
} = require(MODULE_STYLE);
const { verifyStructure, STEP: STRUCTURE_STEP } = require(MODULE_STRUCTURE);

/** The structure-contract step that owns codename detection. */
const STEP_BATCH_CODE = STRUCTURE_STEP.batch;

const CATALOG_FILE = path.join(__dirname, FILE_RULE_CATALOG);
const TERMS_FILE = path.join(__dirname, FILE_FORBIDDEN_TERMS);

let cachedValidRuleIds = null;
let cachedTermsConfig = null;

function getValidRuleIds() {
  if (cachedValidRuleIds) return cachedValidRuleIds;

  if (!fs.existsSync(CATALOG_FILE)) {
    try {
      require(MODULE_GENERATE_CATALOG).generate(true);
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
  const rulePattern = /\b([A-Z]{2,4}(?:-[A-Z0-9]+){2,}|L[0-5]-[A-Z0-9]+)\b/g;
  let match;
  const hallucinated = [];

  while ((match = rulePattern.exec(content)) !== null) {
    const id = match[1];
    if (EXTERNAL_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      continue;
    }
    if (/^(?:PC|PP)-\d{2}-\d{2}$/.test(id)) {
      continue;
    }
    if (!validIds.has(id)) {
      hallucinated.push(id);
    }
  }
  return hallucinated;
}

function validateStyleAndTone(content, options = {}) {
  return validateCommitMessageContent(content, options);
}

/**
 * Projects the structure contract's `BATCH-CODE-07` finding into the legacy shape the callers print.
 *
 * This used to be a second detector with its own vocabulary (`wip|temp|new|v\d+`), while the
 * contract carried `sprint\s*\d+|pass\s*[1-6]|w[1-9]`. Both were registered under `CMG-STY-001`, so
 * the pair claimed to be one rule while disagreeing on seven of nine samples: `wip` blocked here and
 * passed there, `sprint 3` blocked there and passed here.
 *
 * The extra vocabulary was also rejecting honest prose. `new analyzer` and `v2 版本` are ordinary
 * technical English, and `temp`/`wip` are already covered by the dictionary's `CMG-STY-001` entries
 * with whitelist protection that a bare regex cannot offer — `temp file` is a whitelisted technical
 * term, yet the old scanner blocked it anyway.
 *
 * @param {string} content - Raw commit message.
 * @returns {Array<{ lineNum: number, term: string, category: string }>} Findings.
 */
function validateBatchCodename(content) {
  return verifyStructure(content)
    .filter((finding) => finding.step === STEP_BATCH_CODE)
    .map((finding) => ({
      ruleId: finding.ruleId || 'CMG-STY-001',
      lineNum: finding.line || 0,
      term: finding.token || '',
      category: 'batch_codename',
    }));
}

function validateSingleCommitMessage(content, options = {}) {
  const hallucinatedRules = validateRuleAntiHallucination(content);
  const batchFindings = validateBatchCodename(content);
  const structureFindings = verifyStructure(content, options);
  const styleResult = validateStyleAndTone(content, options);
  const styleFindings = [...batchFindings, ...styleResult.findings];
  const hasCriticalBatch = batchFindings.length > 0;
  // A structural violation is never elastic: an unknown commit type or a missing project block is
  // not a wording problem the corridor can absorb. Before this check existed here, `--range` on
  // push verified only rule truth and forbidden terms, so a commit with no project block or a
  // malformed header passed the pre-push gate whenever the hook had not run.
  const hasStructural = structureFindings.length > 0;
  const isPermittedUnderCorridor =
    !hasCriticalBatch &&
    !hasStructural &&
    hallucinatedRules.length === 0 &&
    Boolean(styleResult.isPermittedUnderCorridor);

  return {
    valid: hallucinatedRules.length === 0 && !hasCriticalBatch && !hasStructural && styleResult.valid,
    isPermittedUnderCorridor,
    hallucinatedRules,
    batchFindings,
    structureFindings,
    styleFindings,
    guardrail: styleResult.guardrail,
    debtVerdict: styleResult.debtVerdict,
  };
}

/**
 * Loads the commit-history freeze ledger keyed by commit SHA.
 *
 * Each entry records the rule IDs a commit predates. The ledger exists because a published
 * commit message is immutable: the previous `[Baseline: exempt]` marker could only be added by
 * rewriting history, so tightening any rule retroactively bricked every earlier commit and
 * blocked the push outright.
 *
 * @returns {Map<string, Set<string>>} commit SHA -> frozen rule IDs.
 */
function loadCommitHistoryBaseline() {
  const baselinePath = path.join(__dirname, FILE_COMMIT_HISTORY_BASELINE);
  if (!fs.existsSync(baselinePath)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, ENCODING_UTF8));
    const entries = Array.isArray(parsed?.frozenCommits) ? parsed.frozenCommits : [];
    return new Map(entries.map((entry) => [entry.sha, new Set(entry.ruleIds || [])]));
  } catch (parseErr) {
    // A malformed ledger must not silently masquerade as "no frozen commits": that would
    // re-arm every retroactive block while printing a clean-looking run.
    console.error(`WARN commit-history baseline unreadable (${baselinePath}): ${parseErr.message}`);
    return new Map();
  }
}

function applyHistoryBaselineFreeze(res, frozenRules) {
  let liveStructure = res.structureFindings || [];
  let liveHallucinated = res.hallucinatedRules || [];
  let liveStyle = res.styleFindings || [];
  let liveBatch = res.batchFindings || [];
  let isLivePermitted = res.isPermittedUnderCorridor;

  if (!frozenRules) {
    return { isFrozen: false, isLivePermitted, liveStructure, liveHallucinated, liveStyle };
  }

  liveStructure = liveStructure.filter((f) => !frozenRules.has(f.ruleId));
  if (frozenRules.has(RULE_GATE_SSOT)) {
    liveHallucinated = [];
  }
  liveStyle = liveStyle.filter((f) => !frozenRules.has(f.ruleId));
  liveBatch = liveBatch.filter((f) => !frozenRules.has(f.ruleId));

  const liveFindingsCount =
    liveStructure.length + liveHallucinated.length + liveStyle.length + liveBatch.length;
  if (liveFindingsCount === 0) {
    return { isFrozen: true, isLivePermitted: true, liveStructure, liveHallucinated, liveStyle };
  }

  if (liveStructure.length > 0 || liveHallucinated.length > 0 || liveBatch.length > 0) {
    isLivePermitted = false;
  } else {
    const { evaluateDebtCorridor } = require(MODULE_DEBT_CORRIDOR);
    const debtVerdict = evaluateDebtCorridor({
      findings: liveStyle,
      styleScore: res.guardrail?.styleScore || 0,
      commitType: res.guardrail?.parsedStructure?.type || '',
      skipLog: true,
    });
    isLivePermitted = debtVerdict.status !== STATUS_BLOCK;
  }

  return { isFrozen: false, isLivePermitted, liveStructure, liveHallucinated, liveStyle };
}

function logRangeCommitResult(sha, live) {
  if (!live.isLivePermitted) {
    console.error(`\n❌ 提交 ${sha} 包含刚性违规内容:`);
    if (live.liveHallucinated.length > 0) {
      console.error(`   • RULE-TRUTH-08 违规 (虚构规则 ID): ${live.liveHallucinated.join(', ')}`);
    }
    for (const s of live.liveStructure) {
      console.error(`   • [${s.step}] 结构契约违规: ${s.message} (${s.detail})`);
    }
    if (live.liveStyle.length > 0) {
      console.error(formatDiagnosticReport(live.liveStyle));
    }
    return;
  }
  if (live.liveStyle.length > 0) {
    console.warn(`\n⚠️  提交 ${sha} 包含弹性技术债 (已在弹性走廊配额内放行):`);
    for (const f of live.liveStyle) {
      console.warn(`   • [${f.ruleId}] 第 ${f.lineNum} 行: ${f.term} -> 建议: ${f.guidance || '陈述客观技术事实'}`);
    }
  }
}

function validateCommitRange(range) {
  const root = path.resolve(__dirname, PARENT_DIR_DEPTH_TWO);
  const env = getSafeGitEnv(root);

  let rawLog = '';
  try {
    rawLog = execFileSync('git', ['log', '--no-merges', '--format=%x1e%H%x1f%B', range], {
      cwd: root,
      env,
      encoding: ENCODING_UTF8,
      stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_IGNORE],
    });
  } catch (err) {
    return { passed: false, total: 0, failure: `Unable to resolve commit range '${range}': ${err.message}` };
  }

  const records = rawLog.split(ASCII_RECORD_SEP).filter(Boolean);
  if (records.length === 0) return { passed: true, total: 0 };

  let failedCount = 0;
  let frozenCount = 0;
  const historyBaseline = loadCommitHistoryBaseline();
  const unitSepPattern = /^([^\x1f]+)\x1f([\s\S]*)$/;

  for (const record of records) {
    const match = unitSepPattern.exec(record);
    if (!match) continue;
    const sha = match[1].trim();
    const res = validateSingleCommitMessage(match[2]);
    const live = applyHistoryBaselineFreeze(res, historyBaseline.get(sha));
    if (live.isFrozen) {
      frozenCount++;
      continue;
    }
    if (!live.isLivePermitted) failedCount++;
    logRangeCommitResult(sha, live);
  }

  return { passed: failedCount === 0, total: records.length, failedCount, frozenCount };
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

  for (const s of res.structureFindings || []) {
    violations.push({
      ruleId: s.ruleId,
      severity: SEVERITY_BLOCK,
      step: s.step,
      actual: s.message,
      expected: s.detail,
      message: `[${s.step}] ${s.message}`,
      actionableFix: s.detail,
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
  if (!res.passed) {
    if (res.failure) console.error(`✖ BLOCK ${res.failure}`);
    process.exit(1);
  }

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
    const frozenNote = res.frozenCount > 0
      ? `，其中 ${res.frozenCount} 笔按冻结清单放行（写入时该规则尚未收紧）`
      : '';
    console.log(`  ✔ 待推送分支提交历史风格审查通过 (流式验证 ${res.total} 笔提交${frozenNote})`);
  }
  process.exit(0);
}

function readCommitContent(target) {
  if (target === STDIN_TOKEN) return fs.readFileSync(0, ENCODING_UTF8);
  if (!fs.existsSync(target)) {
    console.error(`✖ BLOCK 提交信息文件不存在: ${target}`);
    process.exit(1);
  }
  return fs.readFileSync(target, ENCODING_UTF8);
}

function resolveCommitFailureSummary(res, violationsCount) {
  if (res.structureFindings && res.structureFindings.length > 0) {
    return `Commit message structural contract failed with ${res.structureFindings.length} violation(s).`;
  }
  if (res.hallucinatedRules && res.hallucinatedRules.length > 0) {
    return `Commit message referenced ${res.hallucinatedRules.length} unregistered/hallucinated rule ID(s).`;
  }
  if (res.debtVerdict?.reason && !res.debtVerdict.passed) {
    return res.debtVerdict.reason;
  }
  return `Commit message verification failed with ${violationsCount} rule hallucination or forbidden style violations.`;
}

function printHumanCommitFailure(res) {
  if (res.debtVerdict?.status === STATUS_BLOCK && res.debtVerdict?.reason) {
    console.error(`✖ [DEBT-CORRIDOR-BLOCK] ${res.debtVerdict.reason}`);
  }
  if ((res.structureFindings || []).length > 0) {
    console.error('✖ BLOCK GUARD-MSG-001: 提交信息未满足结构契约规范:');
    for (const s of res.structureFindings) {
      console.error(`   • [${s.step}] 结构契约违规: ${s.message}${s.detail ? ` (${s.detail})` : ''}`);
    }
  }
  if (res.hallucinatedRules.length > 0) {
    console.error('✖ BLOCK RULE-TRUTH-08: 提交信息提及未在单源注册表登记的虚构或漂移规则 ID:');
    for (const h of res.hallucinatedRules) {
      console.error(`   • 未知规则 ID: ${h}`);
    }
    console.error('   提示: 请检查规则拼写，或先在规则注册表 / review-rules.json 中登记该规则后重新生成目录。');
  }
  if ((res.batchFindings || []).length > 0) {
    console.error('✖ BLOCK SLANG-GUARD-02: 提交信息包含施工批次或临时标记 (一票否决，不进入弹性走廊):');
    for (const f of res.batchFindings) {
      console.error(`   • 第 ${f.lineNum} 行: '${f.term}'`);
    }
    console.error('   提示: 移除 pN / phaseN / stN / wip / temp / new / vN 等过程性代号，改用客观技术描述。');
  }
  if (res.styleFindings.length > 0) {
    console.error(formatDiagnosticReport(res.styleFindings));
  }
}

function reportCommitMsgFailure(res, target, isAgentMode) {
  const violations = buildCommitMsgViolations(res, target);
  const failureSummary = resolveCommitFailureSummary(res, violations.length);
  const targetFiles = [target].filter((t) => t && t !== STDIN_TOKEN);

  try {
    const { writeFailureSnapshot } = require(MODULE_LOG_ROTATOR);
    writeFailureSnapshot({
      gate: GATE_COMMIT_MSG_RULES,
      step: STEP_RULES_VERIFY,
      failedCommand: `node scripts/common/validate-commit-msg.js ${target}`,
      exitCode: 1,
      summary: failureSummary,
      violations,
      targetFiles,
      verificationCommand: `node scripts/common/validate-commit-msg.js ${target}`,
    });
  } catch {
    // Best-effort telemetry recording: ignore logging failure to avoid masking commit gate errors
  }

  if (isAgentMode) {
    const targetVerification = targetFiles[0] || '.git/COMMIT_EDITMSG';
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      status: STATUS_BLOCK,
      gate: GATE_COMMIT_MSG_RULES,
      step: STEP_RULES_VERIFY,
      failedCommand: `node scripts/common/validate-commit-msg.js ${target}`,
      exitCode: 1,
      summary: failureSummary,
      violations,
      debtCorridor: res.debtVerdict,
      agentDirectives: {
        ...(res.debtVerdict?.agentDirectives || {}),
        targetFiles,
        remediationPriority: Array.from(new Set(violations.map((v) => v.ruleId))),
        verificationCommand: `pwsh -File scripts/ps1/commit-msg-gate.ps1 ${targetVerification}`,
        fastRecheckCommand: `node scripts/common/validate-commit-msg.js ${targetVerification}`,
      },
    };
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(1);
  }

  printHumanCommitFailure(res);
  process.exit(1);
}

function handleSingleCommitValidation(target, content, isAgentMode) {
  const targetFile = target && target !== STDIN_TOKEN ? target : '';
  const targetVerification = targetFile || '.git/COMMIT_EDITMSG';
  const res = validateSingleCommitMessage(content, { targetFile });
  const commitType = res.guardrail?.parsedStructure?.type || '';

  // 1. Blocked: Critical failure or debt ceiling exhausted
  if (!res.isPermittedUnderCorridor) {
    reportCommitMsgFailure(res, target, isAgentMode);
    return;
  }

  // 2. Permitted with findings: the ledger writer itself ignores empty batches, so medium-tier
  //    findings cannot fabricate debt. Only high-tier findings are reported as corridor debt.
  if (!res.valid) {
    const { updateDebtLedger } = require(MODULE_DEBT_CORRIDOR);
    const highIssues = res.styleFindings.filter((f) => f.isHighDebt);
    updateDebtLedger({ newHighIssues: highIssues });

    if (isAgentMode) {
      // The summary must state which tier the findings occupy: medium-tier findings are permitted
      // without ledger entry, so reporting them as high-risk debt would misdirect remediation.
      const summaryText = highIssues.length > 0
        ? `Commit message permitted under elastic corridor with ${highIssues.length} high-risk style debt items.`
        : `Commit message permitted with ${res.styleFindings.length} medium-tier style findings; no debt recorded.`;
      console.log(
        JSON.stringify(
          {
            protocolVersion: PROTOCOL_VERSION,
            status: STATUS_PASS,
            warning: STATUS_WARN,
            gate: GATE_COMMIT_MSG_RULES,
            summary: summaryText,
            debtCorridor: res.debtVerdict,
            agentDirectives: {
              ...(res.debtVerdict?.agentDirectives || {}),
              targetFiles: targetFile ? [targetFile] : [],
              verificationCommand: `pwsh -File scripts/ps1/commit-msg-gate.ps1 ${targetVerification}`,
              fastRecheckCommand: `node scripts/common/validate-commit-msg.js ${targetVerification}`,
            },
          },
          null,
          2
        )
      );
    } else if (highIssues.length > 0) {
      console.log('  ⚠️ [DEBT-CORRIDOR] 提交信息包含弹性高危风格技术债 (已在弹性走廊配额内放行，已记入账本，后续提交请优先清偿):');
      for (const h of highIssues) {
        console.log(`     • [${h.ruleId}] 第 ${h.lineNum} 行: ${h.term} -> 推荐: ${h.guidance}`);
      }
    } else {
      // Medium-tier findings still permit the commit, but they are not corridor debt: the ledger
      // records nothing and no paydown is owed. Rendering the high-debt banner here produced an
      // empty bullet list that claimed debt while the ledger stayed empty.
      console.log('  ⚠️ [STYLE-NOTICE] 提交信息命中中危风格项 (不记入技术债账本，无需清偿):');
      for (const f of res.styleFindings) {
        console.log(`     • [${f.ruleId}] 第 ${f.lineNum} 行: ${f.term} -> 推荐: ${f.guidance}`);
      }
    }
    process.exit(0);
  }

  // 3. Fully Clean Pass: Zero violations. If refactor/fix, settle previous debt!
  if (commitType === 'refactor' || commitType === 'fix') {
    const { updateDebtLedger } = require(MODULE_DEBT_CORRIDOR);
    updateDebtLedger({ isCleanCommit: true });
  }

  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: STATUS_PASS,
          gate: GATE_COMMIT_MSG_RULES,
          summary: SUMMARY_RULES_PASS,
          debtCorridor: res.debtVerdict,
          agentDirectives: {
            targetFiles: targetFile ? [targetFile] : [],
            remediationPriority: [],
            verificationCommand: `pwsh -File scripts/ps1/commit-msg-gate.ps1 ${targetVerification}`,
            fastRecheckCommand: `node scripts/common/validate-commit-msg.js ${targetVerification}`,
            creditEnvelope: {
              mode: 'NORMAL',
              maxCredit: 2,
              currentHighDebt: 0,
              accumulatedHighDebt: 0,
              remainingCredit: 2,
              isFeatLocked: false,
            },
            actionableRemediations: [],
            paydownInstructions: [],
          },
        },
        null,
        2
      )
    );
  } else {
    
    
  }
  process.exit(0);
}

/**
 * Runs only the structural contract and reports it in the agent envelope.
 *
 * Kept separate from `handleSingleCommitValidation` because the caller is a shell script that has
 * already announced the nine step banners: this mode must answer "did the structure hold" without
 * touching the ledger, the corridor, or the style dictionary.
 *
 * @param {string[]} args - Full argument vector.
 * @param {boolean} isAgentMode - Whether to emit the structured envelope.
 * @returns {void}
 */
function handleStructureOnlyMode(args, isAgentMode) {
  const target = args.find((a) => !a.startsWith('-') || a === STDIN_TOKEN);
  const content = readCommitContent(target);
  if (content === null) {
    console.error('✖ BLOCK 提交信息文件不存在或未提供');
    process.exit(1);
  }
  const findings = verifyStructure(content);
  const passed = findings.length === 0;
  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: PROTOCOL_VERSION,
          status: passed ? STATUS_PASS : STATUS_BLOCK,
          gate: 'commit-msg:structure',
          findings,
          summary: passed ? 'Structural contract satisfied.' : `${findings.length} structural violation(s).`,
        },
        null,
        2,
      ),
    );
  } else if (!passed) {
    console.error('✖ BLOCK 提交信息结构契约未通过:');
    for (const f of findings) console.error(`  • [${f.step}] ${f.message} — ${f.detail}`);
  }
  process.exit(passed ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  const isAgentMode = args.includes(ARG_AGENT) || args.includes(ARG_AGENT_SHORT) || args.includes(ARG_JSON);

  // The shell entry points delegate their seven structural checks here. `--structure-only` keeps the
  // delegation narrow: the shell has already rendered its step banners, and re-running the style
  // dictionary would report the same finding twice under two different step ids.
  if (args.includes('--structure-only')) {
    handleStructureOnlyMode(args, isAgentMode);
    return;
  }

  if (args.includes(ARG_TEST)) {
    runStyleSelfTest();
    
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
