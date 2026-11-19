/**
 * Module: Governance Guard — Staged Differential Verdict Reporter
 * File Path: scripts/common/lib/diff-verdict-reporter.js
 * Architecture Role: Renders a staged-differential verdict as either the Agent protocol envelope or
 *   a human console reading, so the gate's orchestration never contains presentation logic.
 * Dependencies & Triggers: Node stdlib only; consumed by gate-differential-bounds.js.
 * Responsibilities:
 *   1. Emit the AAS-shaped Agent envelope, with violations, remedies and escalation notices.
 *   2. Emit the human reading, with exemptions and refusals attributed to their clause.
 *   3. Terminate with the exit code the verdict implies.
 * Exit Semantics & Design Rationale: Writes to stdout and calls `process.exit`, because the gate is
 *   a terminal script and its exit code is the contract the pre-commit shell reads. An exemption is
 *   announced in both modes: a silent pass would make a granted relaxation indistinguishable from a
 *   clean commit, which is the one thing the exemption mechanism must never allow.
 */
'use strict';

/**
 * Builds the Agent-facing violation record.
 *
 * @param violation - Internal violation record.
 * @returns Agent envelope entry.
 */
function toAgentViolation(violation) {
    const entry = {
        ruleId: violation.ruleId,
        severity: 'BLOCK',
        file: violation.file,
        message: violation.message,
        actionableFix: violation.actionableFix,
        verificationCommand: 'node scripts/common/gate-differential-bounds.js',
    };
    if (violation.streak !== undefined) entry.blockStreak = violation.streak;
    if (violation.exemption) {
        entry.exemption = {
            outcome: violation.exemption.outcome,
            reasons: violation.exemption.reasons,
        };
    }
    return entry;
}

/**
 * Emits the Agent protocol envelope and terminates.
 *
 * @param verdict - Verdict summary.
 * @param acknowledged - Whether the operator acknowledged the streak escalation.
 * @param context - Protocol version, gate name and step identifier.
 */
function emitAgentVerdict(verdict, acknowledged, context) {
    const payload = {
        protocolVersion: context.PROTOCOL_VERSION,
        status: verdict.passed ? 'PASS' : 'BLOCK',
        gate: context.GATE_NAME,
        stepId: context.STEP_ID,
        batchTotals: verdict.batchTotals,
        admittedThreshold: verdict.admittedThreshold,
    };

    if (verdict.passed) {
        payload.summary =
            verdict.exemptions.length > 0
                ? `Staged differential envelopes verified with ${verdict.exemptions.length} audited exemption(s).`
                : 'Staged weighted ELOC differential envelopes and admission verified cleanly.';
        if (verdict.exemptions.length > 0) {
            payload.exemptions = verdict.exemptions.map((entry) => entry.record);
        }
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        process.exit(0);
    }

    payload.summary = `Staged weighted differential bounds check failed with ${verdict.violations.length} violation(s).`;
    payload.violations = verdict.violations.map(toAgentViolation);
    payload.agentDirectives = {
        remediationPriority: [...new Set(verdict.violations.map((entry) => entry.ruleId))],
        verificationCommand: 'node scripts/common/gate-differential-bounds.js',
        fastRecheckCommand: 'pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent',
        acknowledgedStreak: acknowledged,
    };
    if (verdict.escalations.length > 0) payload.escalations = verdict.escalations;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(1);
}

/**
 * Formats a ratio as a percentage with one decimal.
 *
 * @param ratio - Value in [0, 1].
 * @returns Percentage string.
 */
function percent(ratio) {
    return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Emits the human console verdict and terminates.
 *
 * @param verdict - Verdict summary.
 */
function emitHumanVerdict(verdict) {
    for (const exemption of verdict.exemptions) {
        const { record } = exemption;
        const verb = exemption.fresh ? '获得豁免' : '复用既有豁免';
        console.log(
            `▲ [STAGED-DIFF-14] ${record.path} 依 ${record.rule} ${verb}：实测 ${percent(record.measured)}，目标 ${percent(record.target)}，放宽后目标线 ${percent(record.relaxedLine)}`,
        );
    }
    for (const escalation of verdict.escalations) {
        console.log(`▲ [STAGED-DIFF-14] [${escalation.ruleId}] ${escalation.message}`);
    }

    if (verdict.passed) {
        if (verdict.auditedCount === 0) {
            console.log('✔ [STAGED-DIFF-14] 暂存区无核心代码差异变更，跳过差分边界审查');
        } else {
            console.log(
                `✔ [STAGED-DIFF-14] 暂存区五维差分双向钳制合规 (新增: +${verdict.batchTotals.elocAdd.toFixed(1)}, 删除: -${verdict.batchTotals.elocDel.toFixed(1)}, 周转: ${verdict.batchTotals.turnover.toFixed(1)} >= ${verdict.admittedThreshold.toFixed(1)})`,
            );
        }
        process.exit(0);
    }

    console.error(`✖ [STAGED-DIFF-14] 暂存区五维差分边界违规 (${verdict.violations.length} 项违规):`);
    for (const violation of verdict.violations) {
        console.error(`  - [${violation.type}] ${violation.file}: ${violation.message}`);
        console.error(`    修复: ${violation.actionableFix}`);
        if (violation.exemption) {
            console.error(
                `    豁免: ${violation.exemption.outcome} — ${violation.exemption.reasons.join('; ')}`,
            );
        }
    }
    process.exit(1);
}

module.exports = Object.freeze({
    toAgentViolation,
    emitAgentVerdict,
    emitHumanVerdict,
    percent,
});
