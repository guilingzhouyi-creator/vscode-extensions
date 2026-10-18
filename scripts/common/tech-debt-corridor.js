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
const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '..', '.audit-logs');
const DEBT_LEDGER_NAME = 'tech-debt-ledger.json';

const CRITICAL_DEBT_LIMIT = 0;
const MAX_SINGLE_HIGH_DEBT = 1;
const ACCUMULATION_CEILING = 2;

const MODE_NORMAL = 'NORMAL';
const MODE_ELASTIC_WARNING = 'ELASTIC_WARNING';
const MODE_FORCED_PAYDOWN = 'FORCED_PAYDOWN';

const STATUS_PASS = 'PASS';
const STATUS_PASS_WITH_WARNING = 'PASS_WITH_WARNING';
const STATUS_BLOCK = 'BLOCK';

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
 * @param {object} finding - Lint or style finding
 * @returns {'critical' | 'high' | 'medium' | 'low'}
 */
function classifyFindingDebtTier(finding) {
  if (!finding) return 'low';
  const ruleId = (finding.ruleId || '').toUpperCase();
  const cat = (finding.category || '').toLowerCase();

  // Tier 1: Critical (hard zero tolerance)
  if (
    ruleId.startsWith('SEC-') ||
    ruleId.startsWith('HYG-EMP') ||
    ruleId === 'GATE-SSOT-001' ||
    ruleId === 'RCFG-RULE-DRIFT' ||
    cat === 'temporary_phrasing' ||
    cat === 'hyperbolic_absolute' ||
    cat === 'derogatory_negative' ||
    cat === 'meta_slogans'
  ) {
    return 'critical';
  }

  // Tier 2: High (elastic corridor)
  if (
    finding.isHighDebt ||
    ruleId === 'CMG-STY-007' ||
    ruleId === 'CMG-STY-008' ||
    ruleId === 'GATE-AST-001' ||
    ruleId === 'ARCH-ABS-001' ||
    cat === 'imperative_mood' ||
    cat === 'zero_pov'
  ) {
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
 * @returns {object} Evaluation verdict with status, corridor metrics, and Agent directives
 */
function evaluateDebtCorridor({
  findings = [],
  styleScore = 100,
  commitType = '',
  logDir = DEFAULT_LOG_DIR,
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
      agentDirectives: buildAgentDirectives(criticalIssues, currentHighIssues, MODE_FORCED_PAYDOWN, true),
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
      agentDirectives: buildAgentDirectives(criticalIssues, currentHighIssues, MODE_FORCED_PAYDOWN, false, ledger.items),
    };
  }

  // 3. Elastic Warning Corridor (1 High Debt allowed transiently)
  if (currentHighCount > 0 || accumulatedHighDebt > 0) {
    const remainingCredit = Math.max(0, ACCUMULATION_CEILING - totalProjectedDebt);
    return {
      status: STATUS_PASS_WITH_WARNING,
      mode: MODE_ELASTIC_WARNING,
      reason: `Permitted under elastic corridor: 1 high-risk debt item introduced (Accumulated: ${totalProjectedDebt}/${ACCUMULATION_CEILING}). Repayment required in subsequent commits.`,
      criticalCount: 0,
      currentHighDebtCount: currentHighCount,
      accumulatedHighDebtCount: totalProjectedDebt,
      elasticAllowance: MAX_SINGLE_HIGH_DEBT,
      ceiling: ACCUMULATION_CEILING,
      remainingCredit,
      agentDirectives: buildAgentDirectives(criticalIssues, currentHighIssues, MODE_ELASTIC_WARNING, false, ledger.items),
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

  writeDebtLedger(ledger, logDir);
  return ledger.items.length;
}

/**
 * Builds structured actionable directives for Autonomous Agents.
 *
 * @param {Array<object>} criticalIssues
 * @param {Array<object>} highIssues
 * @param {string} mode
 * @param {boolean} isCritical
 * @param {Array<object>} [unresolvedLedgerItems=[]]
 * @returns {object} Normalized Agent directive envelope
 */
function buildAgentDirectives(criticalIssues, highIssues, mode, isCritical, unresolvedLedgerItems = []) {
  const combined = [...criticalIssues, ...highIssues];
  const remediationPriority = Array.from(new Set(combined.map((c) => c.ruleId)));

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
    mode,
    remediationPriority,
    actionableRemediations,
    paydownInstructions,
    fastRecheckCommand: 'node scripts/common/validate-commit-msg.js .git/COMMIT_EDITMSG',
    verificationTimeBudgetMs: 50,
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
  STATUS_PASS_WITH_WARNING,
  STATUS_BLOCK,
  readDebtLedger,
  writeDebtLedger,
  classifyFindingDebtTier,
  evaluateDebtCorridor,
  updateDebtLedger,
};
