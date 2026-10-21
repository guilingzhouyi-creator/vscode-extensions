/**
 * Module: Workspace Elastic High-Risk Debt Corridor & Accumulation Paydown Ratchet
 * File Path: scripts/common/tech-debt-corridor.js
 * Architecture Role: Mathematical corridor and state machine governing temporary high-risk technical
 *   debt. Permits controlled transient elasticity (High <= 1) while enforcing a strict accumulation
 *   ceiling (Ceiling <= 2) and interlocking with forced paydown mode to prevent architectural decay.
 * Dependencies & Triggers: Consumes Node.js standard fs and path; invoked by validate-commit-msg-style.js,
 *   validate-commit-msg.js, and pre-commit-gate workflows.
 * Responsibilities:
 *   1. Classify issues into Critical (0 tolerance), High (elastic corridor), and Low/Medium tiers;
 *   2. Maintain the chronological unsuppressed high-risk debt ledger (.audit-logs/tech-debt-ledger.json);
 *   3. Evaluate debt corridor allowance and trigger DEBT_CORRIDOR_EXHAUSTED when ceiling is breached;
 *   4. Interlock forced paydown mode: reject new features (feat) until prior debt is redeemed;
 *   5. Format structured quantitative directives and actionable guidance for Autonomous Agents.
 * Exit Semantics & Design Rationale: Exits with structured findings and state descriptors;
 *   guarantees zero-dependency execution in < 3ms.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const UTF8 = 'utf8';

/**
 * Environment variable that redirects the ledger directory.
 *
 * The corridor is a stateful machine: every permitted high-tier finding appends to the ledger and
 * three accumulated entries trigger forced paydown. Harnesses that drive the gate as a child
 * process therefore cannot exercise the corridor against the developer's real ledger without
 * poisoning it. An explicit override keeps the default production path intact while letting a
 * harness point at a throwaway directory.
 */
const LOG_DIR_ENV = 'GOVERNANCE_AUDIT_LOG_DIR';
const DEFAULT_LOG_DIR = process.env[LOG_DIR_ENV]
  ? path.resolve(process.env[LOG_DIR_ENV])
  : path.resolve(__dirname, '..', '..', '.audit-logs');
const DEBT_LEDGER_NAME = 'tech-debt-ledger.json';

const CRITICAL_DEBT_LIMIT = 0;
const MAX_SINGLE_HIGH_DEBT = 1;
const ACCUMULATION_CEILING = 2;

const MODE_NORMAL = 'NORMAL';
const MODE_ELASTIC_WARNING = 'ELASTIC_WARNING';
const MODE_FORCED_PAYDOWN = 'FORCED_PAYDOWN';

const STATUS_PASS = 'PASS';
const STATUS_WARN = 'WARN';
const STATUS_BLOCK = 'BLOCK';

const FORBIDDEN_TERMS_FILE = 'commit-msg-forbidden-terms.json';

/** Static critical rules outside the commit-message dictionary (secret, hygiene, SSOT drift). */
const STATIC_CRITICAL_RULE_IDS = ['GUARD-SSOT-001', 'RCFG-RULE-DRIFT'];
const STATIC_CRITICAL_RULE_PREFIXES = ['SEC-', 'HYG-EMP'];

/** Static elastic rules outside the commit-message dictionary (AST and facade absences). */
const STATIC_ELASTIC_RULE_IDS = ['GUARD-AST-001', 'ARCH-ABS-001'];

/**
 * Dictionary categories that stay inside the elastic corridor instead of the hard-zero tier.
 *
 * These two families describe *wording shape* (imperative mood in the header, zero point-of-view
 * in the body) rather than factual dishonesty. A commit that names the wrong verb still records
 * the real change, so it is permitted under a recorded debt entry. Every other `severity: error`
 * row in the dictionary blocks outright.
 */
const ELASTIC_DICTIONARY_CATEGORIES = new Set(['imperative_mood', 'zero_pov']);

/**
 * Reads the single-source forbidden-term dictionary and derives tier membership by rule ID.
 *
 * The corridor previously matched hard-coded category strings that no producer emitted
 * (`temporary_phrasing`, `hyperbolic_absolute`, ...), so all four honesty rules fell into the
 * medium tier and printed an empty elastic-corridor warning instead of blocking. Deriving the
 * tiers from the dictionary removes the second copy of that knowledge: a renamed or newly added
 * `severity: error` row becomes critical automatically, and the mirror can no longer drift.
 *
 * @returns {{ criticalRuleIds: string[], elasticRuleIds: string[] }} Rule IDs per tier.
 */
function loadDictionaryTiers() {
  const criticalRuleIds = [];
  const elasticRuleIds = [];
  let rules = [];
  try {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(__dirname, FORBIDDEN_TERMS_FILE), 'utf8')
    );
    rules = Array.isArray(dictionary.rules) ? dictionary.rules : [];
  } catch {
    // A missing or malformed dictionary must not silently downgrade the tier; callers fall back
    // to the static lists, and validate-commit-guardrail.js fails on the unreadable source.
    rules = [];
  }
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string') continue;
    if ((rule.severity || 'error') !== 'error') continue;
    if (ELASTIC_DICTIONARY_CATEGORIES.has(rule.category)) {
      elasticRuleIds.push(rule.id);
    } else {
      criticalRuleIds.push(rule.id);
    }
  }
  return { criticalRuleIds, elasticRuleIds };
}

const DICTIONARY_TIERS = loadDictionaryTiers();

/** Rule IDs that hard-block a commit regardless of the elastic corridor allowance. */
const CRITICAL_RULE_IDS = [...STATIC_CRITICAL_RULE_IDS, ...DICTIONARY_TIERS.criticalRuleIds];

/** Rule IDs permitted inside the elastic corridor and recorded in the debt ledger. */
const ELASTIC_RULE_IDS = [...STATIC_ELASTIC_RULE_IDS, ...DICTIONARY_TIERS.elasticRuleIds];

/**
 * Ensures target audit log directory exists.
 *
 * @param {string} logDir - Target directory path
 */
function ensureLogDirectory(logDir = DEFAULT_LOG_DIR) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/**
 * Reads current active high-risk debt ledger from disk.
 *
 * @param {string} [logDir] - Custom directory path
 * @returns {{ version: string, lastUpdated: string, items: Array<object> }}
 */
function readDebtLedger(logDir = DEFAULT_LOG_DIR) {
  const ledgerPath = path.join(logDir, DEBT_LEDGER_NAME);
  if (!fs.existsSync(ledgerPath)) {
    return { version: '1.0.0', lastUpdated: new Date().toISOString(), items: [] };
  }
  try {
    const raw = fs.readFileSync(ledgerPath, UTF8);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items)) {
      parsed.items = [];
    }
    return parsed;
  } catch {
    return { version: '1.0.0', lastUpdated: new Date().toISOString(), items: [] };
  }
}

/**
 * Atomically persists updated debt ledger to disk.
 *
 * @param {{ version: string, lastUpdated: string, items: Array<object> }} ledgerData
 * @param {string} [logDir]
 */
function writeDebtLedger(ledgerData, logDir = DEFAULT_LOG_DIR) {
  try {
    ensureLogDirectory(logDir);
    const ledgerPath = path.join(logDir, DEBT_LEDGER_NAME);
    const tmpPath = `${ledgerPath}.${Date.now().toString(36)}.tmp`;
    const payload = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      items: ledgerData.items || [],
    };
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), UTF8);
    fs.renameSync(tmpPath, ledgerPath);
  } catch {
    // Fail soft without disrupting primary workflow
  }
}

/**
 * Classifies an individual finding into its debt severity tier.
 *
 * Tier membership is resolved by rule ID against the single-source forbidden-term dictionary
 * (see `loadDictionaryTiers`), so a rule cannot be downgraded by a category-name mismatch.
 *
 * @param {object} finding - Lint or style finding
 * @returns {'critical' | 'high' | 'medium' | 'low'}
 */
function classifyFindingDebtTier(finding) {
  if (!finding) return 'low';
  const ruleId = (finding.ruleId || '').toUpperCase();
  const cat = (finding.category || '').toLowerCase();

  // Tier 1: Critical (hard zero tolerance)
  if (
    CRITICAL_RULE_IDS.includes(ruleId) ||
    STATIC_CRITICAL_RULE_PREFIXES.some((prefix) => ruleId.startsWith(prefix)) ||
    cat === 'temporary' ||
    cat === 'hyperbolic_affirmative' ||
    cat === 'hyperbolic_negative' ||
    cat === 'meta_narrative' ||
    cat === 'procedural_boilerplate' ||
    cat === 'execution_numeric_forbidden' ||
    cat === 'project_governance'
  ) {
    return 'critical';
  }

  // Tier 2: High (elastic corridor)
  if (ELASTIC_RULE_IDS.includes(ruleId) || finding.isHighDebt || cat === 'imperative_mood' || cat === 'zero_pov') {
    return 'high';
  }

  // Tier 3: Medium/Low
  return 'medium';
}

/**
 * Evaluates commit findings against the elastic high-risk debt corridor.
 *
 * @param {object} params
 * @param {Array<object>} params.findings - Current evaluated findings
 * @param {number} [params.styleScore=100] - Calculated style score
 * @param {string} [params.commitType=''] - Conventional commit type (feat, fix, refactor, etc.)
 * @param {string} [params.logDir] - Custom audit log directory
 * @param {string} [params.targetFile=''] - Path of commit message file being audited
 * @returns {object} Evaluation verdict with status, corridor metrics, and Agent directives
 */
function evaluateDebtCorridor({
  findings = [],
  styleScore = 100,
  commitType = '',
  logDir = DEFAULT_LOG_DIR,
  targetFile = '',
}) {
  const ledger = readDebtLedger(logDir);
  const accumulatedHighDebt = ledger.items.length;

  const criticalIssues = [];
  const currentHighIssues = [];
  const mediumLowIssues = [];

  for (const f of findings) {
    const tier = classifyFindingDebtTier(f);
    if (tier === 'critical') {
      criticalIssues.push(f);
    } else if (tier === 'high') {
      currentHighIssues.push(f);
    } else {
      mediumLowIssues.push(f);
    }
  }

  const currentHighCount = currentHighIssues.length;
  const totalProjectedDebt = accumulatedHighDebt + currentHighCount;

  // 1. Critical Hard-Zero Defense
  if (criticalIssues.length > CRITICAL_DEBT_LIMIT) {
    return {
      status: STATUS_BLOCK,
      mode: MODE_FORCED_PAYDOWN,
      reason: `Blocked by ${criticalIssues.length} critical zero-tolerance violations.`,
      criticalCount: criticalIssues.length,
      currentHighDebtCount: currentHighCount,
      accumulatedHighDebtCount: accumulatedHighDebt,
      elasticAllowance: MAX_SINGLE_HIGH_DEBT,
      ceiling: ACCUMULATION_CEILING,
      remainingCredit: 0,
      agentDirectives: buildAgentDirectives({
        criticalIssues,
        highIssues: currentHighIssues,
        mode: MODE_FORCED_PAYDOWN,
        isCritical: true,
        targetFile,
        totalProjectedDebt,
      }),
    };
  }

  // 2. Forced Paydown Mode Interlock (Ceiling Breached)
  // If accumulated debt already at or above ceiling, only allow refactor/fix with zero new debt
  const isAccumulationCeilingReached = accumulatedHighDebt >= ACCUMULATION_CEILING;
  const isSingleCommitExceeded = currentHighCount > MAX_SINGLE_HIGH_DEBT;
  const isProjectedCeilingBreached = totalProjectedDebt > ACCUMULATION_CEILING;

  if (isAccumulationCeilingReached || isSingleCommitExceeded || isProjectedCeilingBreached) {
    // If user attempts a new feature while debt ceiling is reached, block it immediately
    const isNewFeature = (commitType || '').toLowerCase() === 'feat';
    const violationSummary = isNewFeature
      ? `Feature development blocked: High-risk technical debt ceiling reached (${accumulatedHighDebt}/${ACCUMULATION_CEILING}). Must pay down prior debt before introducing new features.`
      : `Blocked: High-risk technical debt exceeds corridor budget (Current: ${currentHighCount}, Accumulated: ${accumulatedHighDebt}, Ceiling: ${ACCUMULATION_CEILING}).`;

    return {
      status: STATUS_BLOCK,
      mode: MODE_FORCED_PAYDOWN,
      reason: violationSummary,
      criticalCount: 0,
      currentHighDebtCount: currentHighCount,
      accumulatedHighDebtCount: accumulatedHighDebt,
      elasticAllowance: MAX_SINGLE_HIGH_DEBT,
      ceiling: ACCUMULATION_CEILING,
      remainingCredit: 0,
      agentDirectives: buildAgentDirectives({
        criticalIssues,
        highIssues: currentHighIssues,
        mode: MODE_FORCED_PAYDOWN,
        isCritical: false,
        unresolvedLedgerItems: ledger.items,
        targetFile,
        totalProjectedDebt,
      }),
    };
  }

  // 3. Elastic Warning Corridor (1 High Debt allowed transiently)
  if (currentHighCount > 0 || accumulatedHighDebt > 0) {
    const remainingCredit = Math.max(0, ACCUMULATION_CEILING - totalProjectedDebt);
    return {
      status: STATUS_PASS,
      warning: STATUS_WARN,
      mode: MODE_ELASTIC_WARNING,
      reason: `Permitted under elastic corridor: 1 high-risk debt item introduced (Accumulated: ${totalProjectedDebt}/${ACCUMULATION_CEILING}). Repayment required in subsequent commits.`,
      criticalCount: 0,
      currentHighDebtCount: currentHighCount,
      accumulatedHighDebtCount: totalProjectedDebt,
      elasticAllowance: MAX_SINGLE_HIGH_DEBT,
      ceiling: ACCUMULATION_CEILING,
      remainingCredit,
      agentDirectives: buildAgentDirectives({
        criticalIssues,
        highIssues: currentHighIssues,
        mode: MODE_ELASTIC_WARNING,
        isCritical: false,
        unresolvedLedgerItems: ledger.items,
        targetFile,
        totalProjectedDebt,
      }),
    };
  }

  // 4. Clean Normal Mode (Zero High Debt)
  return {
    status: STATUS_PASS,
    mode: MODE_NORMAL,
    reason: 'Zero high-risk technical debt. Corridor clean.',
    criticalCount: 0,
    currentHighDebtCount: 0,
    accumulatedHighDebtCount: 0,
    elasticAllowance: MAX_SINGLE_HIGH_DEBT,
    ceiling: ACCUMULATION_CEILING,
    remainingCredit: MAX_SINGLE_HIGH_DEBT,
    agentDirectives: null,
  };
}

/**
 * Registers newly accepted elastic debt or settles resolved debt in the ledger.
 *
 * @param {object} params
 * @param {Array<object>} params.newHighIssues - Newly introduced high-risk items
 * @param {boolean} [params.isCleanCommit=false] - If commit has 0 debt and type is refactor/fix, settle older debt
 * @param {string} [params.commitHash=''] - Git commit hash if known
 * @param {string} [params.logDir] - Custom directory
 */
function updateDebtLedger({
  newHighIssues = [],
  isCleanCommit = false,
  commitHash = '',
  logDir = DEFAULT_LOG_DIR,
}) {
  const ledger = readDebtLedger(logDir);
  const previousLength = ledger.items.length;

  // If this commit is clean and is refactoring/fixing, decrement accumulated debt
  if (isCleanCommit && ledger.items.length > 0) {
    // Pop the oldest debt item (FIFO settlement)
    ledger.items.shift();
  }

  // Append new elastic debt items introduced in this commit
  for (const item of newHighIssues) {
    ledger.items.push({
      id: `debt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ruleId: item.ruleId || 'HIGH-DEBT-UNKNOWN',
      term: item.term || '',
      line: item.lineNum || 1,
      reason: item.reason || '',
      guidance: item.guidance || '',
      introducedAt: new Date().toISOString(),
      commitHash: commitHash || '',
    });
  }

  // A no-op update must not touch the disk: writeDebtLedger materialises the directory and file,
  // so an empty batch would fabricate a ledger artifact claiming debt state that does not exist.
  if (ledger.items.length === previousLength) {
    return ledger.items.length;
  }

  writeDebtLedger(ledger, logDir);
  return ledger.items.length;
}

/**
 * Builds structured actionable directives for Autonomous Agents adhering to the workspace envelope protocol.
 *
 * @param {object} params
 * @param {Array<object>} params.criticalIssues
 * @param {Array<object>} params.highIssues
 * @param {string} params.mode
 * @param {boolean} params.isCritical
 * @param {Array<object>} [params.unresolvedLedgerItems=[]]
 * @param {string} [params.targetFile='']
 * @param {number} [params.totalProjectedDebt=0]
 * @returns {object} Normalized Agent directive envelope
 */
function buildAgentDirectives({
  criticalIssues = [],
  highIssues = [],
  mode,
  isCritical = false,
  unresolvedLedgerItems = [],
  targetFile = '',
  totalProjectedDebt = 0,
}) {
  const combined = [...criticalIssues, ...highIssues];
  const remediationPriority = Array.from(new Set(combined.map((c) => c.ruleId)));
  const target = targetFile || '.git/COMMIT_EDITMSG';

  const actionableRemediations = combined.map((issue) => ({
    ruleId: issue.ruleId,
    category: issue.category,
    line: issue.lineNum,
    offendingTerm: issue.term,
    reason: issue.reason,
    suggestedFix: issue.guidance,
    severity: isCritical ? 'CRITICAL' : 'HIGH_DEBT',
  }));

  const paydownInstructions = mode === MODE_FORCED_PAYDOWN
    ? [
        '【强制清偿模式 (FORCED_PAYDOWN)】：高危技术债蓄积达到上限，所有 feat 业务开发已锁定。',
        '下一批提交必须使用 refactor(...) 或 fix(...) 且必须优先清偿下列未决债务：',
        ...unresolvedLedgerItems.map((item, idx) => `  ${idx + 1}. [${item.ruleId}] ${item.reason} -> ${item.guidance}`),
      ]
    : [];

  return {
    targetFiles: [target],
    remediationPriority,
    verificationCommand: `pwsh -File scripts/ps1/commit-msg-gate.ps1 ${target}`,
    fastRecheckCommand: `node scripts/common/validate-commit-msg.js ${target}`,
    verificationTimeBudgetMs: 50,
    creditEnvelope: {
      mode,
      maxCredit: ACCUMULATION_CEILING,
      currentHighDebt: highIssues.length,
      accumulatedHighDebt: totalProjectedDebt,
      remainingCredit: Math.max(0, ACCUMULATION_CEILING - totalProjectedDebt),
      isFeatLocked: totalProjectedDebt >= ACCUMULATION_CEILING,
    },
    actionableRemediations,
    paydownInstructions,
  };
}

module.exports = {
  CRITICAL_DEBT_LIMIT,
  MAX_SINGLE_HIGH_DEBT,
  ACCUMULATION_CEILING,
  MODE_NORMAL,
  MODE_ELASTIC_WARNING,
  MODE_FORCED_PAYDOWN,
  STATUS_PASS,
  STATUS_WARN,
  STATUS_BLOCK,
  CRITICAL_RULE_IDS,
  ELASTIC_RULE_IDS,
  readDebtLedger,
  writeDebtLedger,
  classifyFindingDebtTier,
  evaluateDebtCorridor,
  updateDebtLedger,
};
