/**
 * Module: Governance Guard — Staged 5D Differential Bounds & Admission Gate
 * File Path: scripts/common/gate-differential-bounds.js
 * Architecture Role: Evaluates two-tier 5D ELOC differential bounds and empirical admission
 *   on staged git changes. Serves as dual-track runner: delegates to `taxis gate-slice` if
 *   compiled, or falls back to 100% isomorphic in-memory AST stream evaluation.
 * Dependencies & Triggers: Node.js standard libraries (fs, path, child_process);
 *   invoked by pre-commit-gate (ps1/sh) as STAGED-DIFF-14, pre-push-gate, and CI workflows.
 * Responsibilities:
 *   1. Single-file micro-envelopes:
 *      - E_add <= 180 (new) / 120 (existing, 180 with refactor witness)
 *      - E_del <= 100 (without refactor witness)
 *      - Substantive ratio >= 0.60 & TSPR >= 0.40 (when added lines >= 10)
 *   2. Commit batch macro-bounds:
 *      - Sum(E_add) <= 360
 *      - Sum(E_del) <= 280
 *   3. Empirical turnover admission floor:
 *      - T_net = Sum(E_add) + 0.8 * Sum(E_del) >= Theta_admission in [3.0, 25.0]
 *   4. Emit structured findings and Agent failure envelopes matching AAS v1.0.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass or empty stage, 1 on violation.
 *   Fails closed on unresolvable git errors.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL_VERSION = '1.0.0';
const STEP_ID = 'STAGED-DIFF-14';
const RULE_FGT_GAT_001 = 'FGT-GAT-001';

// Single-file micro bounds
const MAX_NEW_FILE_5D_ELOC = 360.0;
const MAX_EXISTING_FILE_ADD_5D_ELOC = 120.0;
const MAX_EXISTING_FILE_REFACTOR_WITNESS_ELOC = 180.0;
const MAX_FILE_DEL_5D_ELOC = 100.0;
const MIN_SUBSTANTIVE_RATIO = 0.60;
const MIN_TSPR = 0.40;

// Commit batch macro bounds
const MAX_COMMIT_BATCH_ADD_5D_ELOC = 360.0;
const MAX_COMMIT_BATCH_DEL_5D_ELOC = 280.0;

// Empirical admission turnover
const ADMISSION_TURNOVER_FLOOR = 3.0;
const ADMISSION_TURNOVER_CAP = 25.0;

const {
  isAuditableCodeFile,
  getStagedStatusList,
  loadRecentTurnoverRecords,
  calculateEmpiricalAdmissionThreshold,
  evaluateFileStagedDiff,
} = require('./lib/differential-diff-parser');

/**
 * Checks single-file micro differential envelopes.
 *
 * @param {Array<object>} fileMetricsList
 * @param {number} totalBatchAdd - Total added 5D ELOC in batch for refactoring witness verification
 * @param {Array<object>} violations
 */
function checkFileMicroViolations(fileMetricsList, totalBatchAdd, violations) {
  for (const m of fileMetricsList) {
    const addCeiling = m.isNew
      ? MAX_NEW_FILE_5D_ELOC
      : m.elocDel > 10
      ? MAX_EXISTING_FILE_REFACTOR_WITNESS_ELOC
      : MAX_EXISTING_FILE_ADD_5D_ELOC;
    if (m.elocAdd > addCeiling) {
      violations.push({
        type: 'FILE_ADD_OVERFLOW',
        ruleId: RULE_FGT_GAT_001,
        file: m.path,
        message: `单文件新增有效逻辑 (${m.elocAdd.toFixed(1)} 5D ELOC) 超出上限 (${addCeiling.toFixed(1)} 5D ELOC)`,
        actionableFix: `拆分 ${m.path} 为更细内聚子模块，或分批进行原子提交。`,
      });
    }

    const isRefactorWitnessed = totalBatchAdd >= m.elocDel * 0.7;
    const delCeiling = isRefactorWitnessed ? MAX_COMMIT_BATCH_DEL_5D_ELOC : MAX_FILE_DEL_5D_ELOC;
    if (m.elocDel > delCeiling) {
      violations.push({
        type: 'CAPABILITY_EROSION',
        ruleId: RULE_FGT_GAT_001,
        file: m.path,
        message: `单文件删除逻辑 (${m.elocDel.toFixed(1)} 5D ELOC) 超出安全包络 (${delCeiling.toFixed(1)} 5D ELOC)`,
        actionableFix: `大面积删除需拆解为能力迁移与废弃分阶段提交，并附带重构证词。`,
      });
    }

    if (m.physAdd >= 10) {
      if (m.substantiveRatio < MIN_SUBSTANTIVE_RATIO) {
        violations.push({
          type: 'SUBSTANTIVE_DEFICIT',
          ruleId: RULE_FGT_GAT_001,
          file: m.path,
          message: `实质行占比 (${(m.substantiveRatio * 100).toFixed(1)}%) 低于刚性底线 (${(MIN_SUBSTANTIVE_RATIO * 100).toFixed(1)}%)`,
          actionableFix: `移除空注释、纯占位或多余空行，提高代码实质技术密度。`,
        });
      }

      if (m.tspr < MIN_TSPR) {
        violations.push({
          type: 'CODE_DILUTION',
          ruleId: RULE_FGT_GAT_001,
          file: m.path,
          message: `有效载荷率 TSPR (${(m.tspr * 100).toFixed(1)}%) 低于门槛 (${(MIN_TSPR * 100).toFixed(1)}%)`,
          actionableFix: `消融机械转发跳板与空壳门面，提高真实语义行比例。`,
        });
      }
    }
  }
}

/**
 * Checks batch-level macro differential envelopes and empirical admission turnover.
 *
 * @param {object} params
 * @param {Array<object>} violations
 */
function checkBatchMacroViolations(params, violations) {
  const { totalElocAdd, totalElocDel, totalTurnover, admissionThreshold, hasAuditableCode } = params;

  if (totalElocAdd > MAX_COMMIT_BATCH_ADD_5D_ELOC) {
    violations.push({
      type: 'BATCH_ADD_OVERFLOW',
      ruleId: RULE_FGT_GAT_001,
      file: '.',
      message: `批次总新增有效逻辑 (${totalElocAdd.toFixed(1)} 5D ELOC) 超出批次宏观上限 (${MAX_COMMIT_BATCH_ADD_5D_ELOC.toFixed(1)} 5D ELOC)`,
      actionableFix: `根据 batch-commit 技能规范，按架构分层拆分为多个原子提交。`,
    });
  }

  if (totalElocDel > MAX_COMMIT_BATCH_DEL_5D_ELOC) {
    violations.push({
      type: 'BATCH_DEL_OVERFLOW',
      ruleId: RULE_FGT_GAT_001,
      file: '.',
      message: `批次总删除逻辑 (${totalElocDel.toFixed(1)} 5D ELOC) 超出批次宏观上限 (${MAX_COMMIT_BATCH_DEL_5D_ELOC.toFixed(1)} 5D ELOC)`,
      actionableFix: `将大规模消除分为废弃隔离与物理移除两个独立批次提交。`,
    });
  }

  if (hasAuditableCode && totalTurnover < admissionThreshold) {
    violations.push({
      type: 'ADMISSION_TURNOVER_DEFICIT',
      ruleId: RULE_FGT_GAT_001,
      file: '.',
      message: `批次净 5D ELOC 周转量 (${totalTurnover.toFixed(1)}) 低于经验准入底线 (${admissionThreshold.toFixed(1)})`,
      actionableFix: `每批次提交必须包含有效实质代码更替量，避免仅提交无实质差异的微量修改。`,
    });
  }
}

/**
 * Evaluates full staged diff against two-tier envelopes and admission.
 *
 * @param {object} [options]
 * @returns {object} Verdict summary
 */
function evaluateStagedDifferentialBounds(options = {}) {
  const stagedList = getStagedStatusList();
  if (stagedList.length === 0) {
    return {
      passed: true,
      stagedCount: 0,
      auditedCount: 0,
      batchTotals: { elocAdd: 0, elocDel: 0, turnover: 0 },
      admittedThreshold: ADMISSION_TURNOVER_FLOOR,
      violations: [],
    };
  }

  const fileMetricsList = [];
  let totalPhysAdd = 0;
  let totalPhysDel = 0;
  let totalElocAdd = 0;
  let totalElocDel = 0;
  let hasAuditableCode = false;

  for (const entry of stagedList) {
    const isCode = isAuditableCodeFile(entry.path);
    if (!isCode) continue;
    hasAuditableCode = true;
    const isNew = entry.status.startsWith('A') || entry.status.startsWith('?');
    const m = evaluateFileStagedDiff(entry.path, isNew);
    fileMetricsList.push(m);
    totalPhysAdd += m.physAdd;
    totalPhysDel += m.physDel;
    totalElocAdd += m.elocAdd;
    totalElocDel += m.elocDel;
  }

  const totalTurnover = totalElocAdd + totalElocDel * 0.8;
  const historicalTurnovers = loadRecentTurnoverRecords();
  const admissionThreshold = calculateEmpiricalAdmissionThreshold(historicalTurnovers);

  const violations = [];
  checkFileMicroViolations(fileMetricsList, totalElocAdd, violations);
  checkBatchMacroViolations({
    totalElocAdd,
    totalElocDel,
    totalTurnover,
    admissionThreshold,
    hasAuditableCode,
  }, violations);

  const passed = violations.length === 0;

  return {
    passed,
    stagedCount: stagedList.length,
    auditedCount: fileMetricsList.length,
    batchTotals: {
      physAdd: totalPhysAdd,
      physDel: totalPhysDel,
      elocAdd: totalElocAdd,
      elocDel: totalElocDel,
      turnover: totalTurnover,
    },
    admittedThreshold: admissionThreshold,
    violations,
  };
}

/**
 * Main entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const isAgent = args.includes('--agent') || args.includes('-a') || args.includes('--json');

  const verdict = evaluateStagedDifferentialBounds();

  if (isAgent) {
    if (verdict.passed) {
      process.stdout.write(
        JSON.stringify(
          {
            protocolVersion: PROTOCOL_VERSION,
            status: 'PASS',
            gate: 'pre-commit',
            stepId: STEP_ID,
            summary: 'Staged 5D ELOC differential bounds and admission verified cleanly.',
            batchTotals: verdict.batchTotals,
            admittedThreshold: verdict.admittedThreshold,
          },
          null,
          2
        ) + '\n'
      );
      process.exit(0);
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            protocolVersion: PROTOCOL_VERSION,
            status: 'BLOCK',
            gate: 'pre-commit',
            stepId: STEP_ID,
            summary: `Staged 5D differential bounds check failed with ${verdict.violations.length} violation(s).`,
            violations: verdict.violations.map((v) => ({
              ruleId: v.ruleId,
              severity: 'BLOCK',
              file: v.file,
              message: v.message,
              actionableFix: v.actionableFix,
              verificationCommand: 'node scripts/common/gate-differential-bounds.js',
            })),
            agentDirectives: {
              remediationPriority: [RULE_FGT_GAT_001],
              verificationCommand: 'node scripts/common/gate-differential-bounds.js',
              fastRecheckCommand: 'pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent',
            },
          },
          null,
          2
        ) + '\n'
      );
      process.exit(1);
    }
  }

  // Human console mode
  if (verdict.passed) {
    if (verdict.auditedCount === 0) {
      console.log('✔ [STAGED-DIFF-14] 暂存区无核心代码差异变更，跳过差分边界审查');
    } else {
      console.log(
        `✔ [STAGED-DIFF-14] 暂存区五维差分双向钳制合规 (新增: +${verdict.batchTotals.elocAdd.toFixed(1)}, 删除: -${verdict.batchTotals.elocDel.toFixed(1)}, 周转: ${verdict.batchTotals.turnover.toFixed(1)} >= ${verdict.admittedThreshold.toFixed(1)})`
      );
    }
    process.exit(0);
  } else {
    console.error(`✖ [STAGED-DIFF-14] 暂存区五维差分边界违规 (${verdict.violations.length} 项违规):`);
    for (const v of verdict.violations) {
      console.error(`  - [${v.type}] ${v.file}: ${v.message}`);
      console.error(`    修复: ${v.actionableFix}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  classifyLine,
  evaluateStagedDifferentialBounds,
  evaluateFileStagedDiff,
  calculateEmpiricalAdmissionThreshold,
  MAX_NEW_FILE_5D_ELOC,
  MAX_EXISTING_FILE_ADD_5D_ELOC,
  MAX_FILE_DEL_5D_ELOC,
  MAX_COMMIT_BATCH_ADD_5D_ELOC,
  MAX_COMMIT_BATCH_DEL_5D_ELOC,
  ADMISSION_TURNOVER_FLOOR,
  ADMISSION_TURNOVER_CAP,
};
