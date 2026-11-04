/**
 * Module: Governance Guard — Staged Batch Envelope Judge
 * File Path: scripts/common/lib/diff-batch-judge.js
 * Architecture Role: Judges a whole commit against its macro envelope and its empirical admission
 *   floor. Kept apart from the single-file judge because the two answer different questions and are
 *   resolved differently: a file over its ceiling is split into modules, a batch over its ceiling is
 *   split into commits.
 * Dependencies & Triggers: diff-bounds-policy.js for every boundary; consumed by
 *   diff-envelope-judge.js.
 * Responsibilities:
 *   1. Reject a batch whose added or deleted logic exceeds its macro ceiling.
 *   2. Reject a batch whose net turnover falls below the empirical admission floor.
 *   3. Attribute every violation to the batch rule, since no single file is at fault.
 * Exit Semantics & Design Rationale: Pure and total over the totals it is given. The turnover check
 *   is skipped when no auditable code is staged, because a commit that only touches documentation has
 *   no code turnover to judge and would otherwise fail for a category it does not belong to.
 */
'use strict';

const {
    DIFF_RULES,
    BATCH_BANDS,
    classifyBand,
    BAND_BELOW_FLOOR,
    BAND_ABOVE_CEILING,
} = require('./diff-bounds-policy');

/**
 * Pushes a batch overflow violation when the measurement clears its ceiling.
 *
 * @param params - Measurement, ceiling, discriminator and message builder.
 * @param violations - Collector that surviving violations are pushed onto.
 */
function checkBatchOverflow(params, violations) {
    const { measured, ceiling, type, describe, actionableFix } = params;
    if (classifyBand(measured, Object.freeze({ ceiling })) !== BAND_ABOVE_CEILING) return;
    violations.push({
        type,
        ruleId: DIFF_RULES.batch,
        file: '.',
        message: describe(measured, ceiling),
        actionableFix,
    });
}

/**
 * Checks batch-level macro envelopes and empirical admission turnover.
 *
 * @param params - Batch totals, admission threshold and whether any auditable code is staged.
 * @param violations - Collector that surviving violations are pushed onto.
 */
function checkBatchMacroViolations(params, violations) {
    const { totalElocAdd, totalElocDel, totalTurnover, admissionThreshold, hasAuditableCode } = params;

    checkBatchOverflow(
        {
            measured: totalElocAdd,
            ceiling: BATCH_BANDS.add.ceiling,
            type: 'BATCH_ADD_OVERFLOW',
            describe: (value, ceiling) =>
                `批次总新增有效逻辑 (${value.toFixed(1)} 5D ELOC) 超出批次宏观上限 (${ceiling.toFixed(1)} 5D ELOC)`,
            actionableFix: '按 batch-commit 技能规范，依架构分层拆分为多个原子提交。',
        },
        violations,
    );
    checkBatchOverflow(
        {
            measured: totalElocDel,
            ceiling: BATCH_BANDS.del.ceiling,
            type: 'BATCH_DEL_OVERFLOW',
            describe: (value, ceiling) =>
                `批次总删除逻辑 (${value.toFixed(1)} 5D ELOC) 超出批次宏观上限 (${ceiling.toFixed(1)} 5D ELOC)`,
            actionableFix: '把大规模消除拆成废弃隔离与物理移除两个独立批次。',
        },
        violations,
    );

    if (!hasAuditableCode) return;
    const turnoverBand = Object.freeze({ floor: admissionThreshold, ceiling: BATCH_BANDS.turnoverCap });
    if (classifyBand(totalTurnover, turnoverBand) !== BAND_BELOW_FLOOR) return;
    violations.push({
        type: 'ADMISSION_TURNOVER_DEFICIT',
        ruleId: DIFF_RULES.batch,
        file: '.',
        message: `批次净 5D ELOC 周转量 (${totalTurnover.toFixed(1)}) 低于经验准入底线 (${admissionThreshold.toFixed(1)})`,
        actionableFix: '每批次须包含可审查的实质代码更替量，避免仅提交微量改动。',
    });
}

module.exports = Object.freeze({
    checkBatchOverflow,
    checkBatchMacroViolations,
});
