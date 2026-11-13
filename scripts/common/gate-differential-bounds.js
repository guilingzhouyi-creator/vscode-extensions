/**
 * Module: Governance Guard — Staged 5D Differential Bounds & Admission Gate
 * File Path: scripts/common/gate-differential-bounds.js
 * Architecture Role: Orchestrates the staged differential check: collects measurements, delegates
 *   judgement to diff-envelope-judge.js, applies the streak and exemption policy, then hands the
 *   verdict to a reporter. Holds no threshold and no judging logic of its own.
 * Dependencies & Triggers: differential-diff-parser.js for measurement, diff-envelope-judge.js for
 *   verdicts, diff-exemption-ledger.js for streaks and grants, diff-verdict-reporter.js for output;
 *   invoked by pre-commit-gate (ps1/sh) as STAGED-DIFF-14, pre-push-gate, and CI workflows.
 * Responsibilities:
 *   1. Measure every auditable staged file and accumulate the batch totals.
 *   2. Ask the judge for violations, then let the ledger resolve any exemptible one.
 *   3. Return a verdict summary and hand it to the reporter for Agent or human output.
 * Exit Semantics & Design Rationale: Exits 0 on a clean pass or an empty stage, 1 on any surviving
 *   violation. Fails closed on unresolvable git errors. The exemption is applied after judging and
 *   before escalation on purpose: a block already covered by a recorded grant must not keep counting
 *   up, since that would demand human acknowledgement forever on a repeated CI run.
 */
'use strict';

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL_VERSION = '1.0.0';
const STEP_ID = 'STAGED-DIFF-14';
const GATE_NAME = 'pre-commit';

const { BATCH_BANDS } = require('./lib/diff-bounds-policy');
const { checkFileMicroViolations } = require('./lib/diff-envelope-judge');
const { checkBatchMacroViolations } = require('./lib/diff-batch-judge');
const {
    recordRunStreaks,
    requestExemption,
    streakKey,
    GRANT_GRANTED,
    GRANT_REUSED,
} = require('./lib/diff-exemption-ledger');
const { emitAgentVerdict, emitHumanVerdict } = require('./lib/diff-verdict-reporter');
const {
    loadRecentTurnoverRecords,
    loadRecentAdmissionSamples,
    calculateEmpiricalAdmissionThreshold,
    evaluateFileStagedDiff,
    isAuditableCodeFile,
    getStagedStatusList,
    readGitBlobText,
} = require('./lib/differential-diff-parser');

/** Violation types the ledger may resolve; every other type is structural. */
const EXEMPTIBLE_VIOLATION_TYPES = Object.freeze(['SUBSTANTIVE_TARGET_DEFICIT']);

/** Weight of a deleted 5D ELOC in the net turnover, below the weight of an added one. */
const DELETION_TURNOVER_WEIGHT = BATCH_BANDS.deletionTurnoverWeight;

/** Streak at which a repeated block is announced as possibly structural. */
const ESCALATION_NOTICE_STREAK = 2;

/**
 * Measures every auditable staged file and accumulates the batch totals.
 *
 * @param stagedList - Staged entries from the parser.
 * @returns Per-file metrics, an index by path, and the batch totals.
 */
function measureStagedFiles(stagedList) {
    const fileMetricsList = [];
    const metricsByPath = new Map();
    const totals = { physAdd: 0, physDel: 0, elocAdd: 0, elocDel: 0 };

    for (const entry of stagedList) {
        if (!isAuditableCodeFile(entry.path)) continue;
        const isNew = entry.status.startsWith('A') || entry.status.startsWith('?');
        const metrics = evaluateFileStagedDiff(entry.path, isNew);
        fileMetricsList.push(metrics);
        metricsByPath.set(metrics.path, metrics);
        totals.physAdd += metrics.physAdd;
        totals.physDel += metrics.physDel;
        totals.elocAdd += metrics.elocAdd;
        totals.elocDel += metrics.elocDel;
    }
    totals.turnover = totals.elocAdd + totals.elocDel * DELETION_TURNOVER_WEIGHT;
    return { fileMetricsList, metricsByPath, totals };
}

/**
 * Applies the streak and exemption policy to this run, mutating the violation list in place.
 *
 * @param violations - Violations emitted by this run.
 * @param metricsByPath - Per-file metrics keyed by staged path.
 * @param ackStreak - Operator acknowledgement that allows counting past the escalation threshold.
 * @returns Streak map, exemption list and escalation notices.
 */
function resolveViolations(violations, metricsByPath, ackStreak) {
    const recordedStreaks = recordRunStreaks(violations);
    const exemptions = [];
    const unresolved = [];

    for (const violation of violations) {
        violation.streak = recordedStreaks[streakKey(violation.file ?? '.', violation.type)] ?? 1;
        const metrics = metricsByPath.get(violation.file);
        const exemptible = EXEMPTIBLE_VIOLATION_TYPES.includes(violation.type) && metrics;

        if (!exemptible) {
            unresolved.push(violation);
            continue;
        }

        const outcome = requestExemption({
            file: violation.file,
            violationType: violation.type,
            ruleId: violation.ruleId,
            isNew: metrics.isNew,
            physAdd: metrics.physAdd,
            measured: violation.measured,
            eligibilityValue: violation.measured,
            streak: violation.streak,
            batchGrantedCount: exemptions.filter((entry) => entry.fresh).length,
        });

        if (outcome.outcome === GRANT_GRANTED || outcome.outcome === GRANT_REUSED) {
            exemptions.push({
                violation,
                record: outcome.record,
                fresh: outcome.outcome === GRANT_GRANTED,
            });
            continue;
        }
        violation.exemption = { outcome: outcome.outcome, reasons: outcome.reasons };
        unresolved.push(violation);
    }

    violations.splice(0, violations.length, ...unresolved);
    return {
        streaks: recordedStreaks,
        exemptions,
        escalations: collectStreakEscalations(unresolved, ackStreak),
    };
}

/**
 * Builds escalation notices for the violations that remain unresolved.
 *
 * @param unresolved - Violations that no grant covers.
 * @param ackStreak - Whether the operator acknowledged the escalation.
 * @returns Escalation notices.
 */
function collectStreakEscalations(unresolved, ackStreak) {
    const escalations = [];
    for (const violation of unresolved) {
        const identifier = violation.file ?? '.';
        if (violation.streak === ESCALATION_NOTICE_STREAK) {
            escalations.push({
                ruleId: 'GAT-STREAK-001',
                file: identifier,
                message: `${identifier} 的 ${violation.type} 已连续第 ${violation.streak} 次阻断，须评估是否属结构性冲突。`,
            });
        }
        if (violation.streak >= 5) {
            escalations.push({
                ruleId: 'GAT-STREAK-001',
                file: identifier,
                message: `${identifier} 的 ${violation.type} 连续 ${violation.streak} 次阻断尚未收敛，需人工确认后携 --acknowledge-streak 复跑。`,
                acknowledged: ackStreak,
            });
            if (ackStreak) violation.acknowledgedStreak = true;
        }
    }
    return escalations;
}

/**
 * Evaluates the full staged diff and applies the streak and exemption policy.
 *
 * @param options - Object carrying `ackStreak`.
 * @returns Verdict summary.
 */
function evaluateStagedDifferentialBounds(options = {}) {
    const stagedList = getStagedStatusList();
    if (stagedList.length === 0) {
        return {
            passed: true,
            stagedCount: 0,
            auditedCount: 0,
            batchTotals: { physAdd: 0, physDel: 0, elocAdd: 0, elocDel: 0, turnover: 0 },
            admittedThreshold: BATCH_BANDS.turnoverFloor,
            violations: [],
            exemptions: [],
            escalations: [],
        };
    }

    const { fileMetricsList, metricsByPath, totals } = measureStagedFiles(stagedList);
    const recentSamples = typeof loadRecentAdmissionSamples === 'function'
        ? loadRecentAdmissionSamples()
        : loadRecentTurnoverRecords();
    const admissionThreshold = calculateEmpiricalAdmissionThreshold(recentSamples);

    const violations = [];
    checkFileMicroViolations(fileMetricsList, totals.elocAdd, violations);
    checkBatchMacroViolations(
        {
            totalElocAdd: totals.elocAdd,
            totalElocDel: totals.elocDel,
            totalTurnover: totals.turnover,
            admissionThreshold,
            hasAuditableCode: fileMetricsList.length > 0,
        },
        violations,
    );

    const policy = resolveViolations(violations, metricsByPath, options.ackStreak);
    return {
        passed: violations.length === 0,
        stagedCount: stagedList.length,
        auditedCount: fileMetricsList.length,
        batchTotals: totals,
        admittedThreshold: admissionThreshold,
        violations,
        exemptions: policy.exemptions,
        escalations: policy.escalations,
        streaks: policy.streaks,
    };
}

function auditSliceStep(codeFiles, steps) {
    try {
        const { analyzeSourceText, DEFAULT_CONFIG } = require('./validate-staged-slice');
        const violations = [];
        for (const f of codeFiles) {
            if (!/\.(ts|tsx|js|jsx)$/.test(f.path)) continue;
            const c = typeof readGitBlobText === 'function' ? readGitBlobText(`:${f.path}`) : null;
            if (!c) continue;
            const findings = analyzeSourceText(c, f.path, DEFAULT_CONFIG, null);
            if (findings && findings.length > 0) {
                for (const item of findings) {
                    violations.push({ file: f.path, line: item.line || 1, ruleId: item.rule || 'GUARD-AST-001', message: item.message });
                }
            }
        }
        if (violations.length > 0) {
            steps['STAGED-SLICE-11'] = {
                status: 'BLOCK',
                detail: `AST切片复杂度超标 (${violations.length} 处违规: ${violations[0].message})`,
                ruleId: 'GUARD-AST-001',
                summary: violations[0].message,
                violations,
            };
        } else {
            steps['STAGED-SLICE-11'] = { status: 'PASS', detail: '暂存区 AST 切片复杂度合规', ruleId: 'GUARD-AST-001', violations: [] };
        }
    } catch (err) {
        steps['STAGED-SLICE-11'] = { status: 'BLOCK', detail: `AST切片审查异常: ${err.message}`, ruleId: 'GUARD-AST-001', summary: err.message, violations: [{ message: err.message }] };
    }
}

function auditDensityStep(auditableFiles, steps) {
    try {
        const { auditFileDensity } = require('./validate-code-density');
        const densityOptions = { porLimit: 0.6, minTau: 2.5, maxTau: 22 };
        const densityViolations = [];
        for (const f of auditableFiles) {
            const c = typeof readGitBlobText === 'function' ? readGitBlobText(`:${f.path}`) : null;
            if (c === null) continue;
            const res = auditFileDensity(f.path, densityOptions, c);
            if (res && res.violations && res.violations.length > 0) {
                densityViolations.push(...res.violations);
            }
        }
        if (densityViolations.length > 0) {
            steps['STAGED-DENSITY-12'] = {
                status: 'BLOCK',
                detail: `代码密度审查未通过: ${densityViolations[0].message}`,
                ruleId: 'VOL-DIL-001',
                summary: densityViolations[0].message,
                violations: densityViolations,
            };
        } else {
            steps['STAGED-DENSITY-12'] = { status: 'PASS', detail: '暂存区代码密度与接线载荷合规', ruleId: 'VOL-DIL-001', violations: [] };
        }
    } catch (err) {
        steps['STAGED-DENSITY-12'] = { status: 'BLOCK', detail: `代码密度审查异常: ${err.message}`, ruleId: 'VOL-DIL-001', summary: err.message, violations: [{ message: err.message }] };
    }
}

function auditVolumeStep(auditableFiles, steps) {
    try {
        const { evaluateCodeMetrics, evaluateDynamicEnvelope } = require('./evaluate-eloc-budget');
        const volumeViolations = [];
        for (const f of auditableFiles) {
            const c = typeof readGitBlobText === 'function' ? readGitBlobText(`:${f.path}`) : null;
            if (c === null) continue;
            const ext = path.extname(f.path).toLowerCase();
            const m = evaluateCodeMetrics(c, ext, f.path);
            const env = evaluateDynamicEnvelope(m, {}, f.path, c);
            if (env.severity === 'error') {
                volumeViolations.push({ file: f.path, ruleId: 'VOL-ELOC-001', message: env.reason || `双轨体积超标 (${m.eloc} ELOC, ${m.totalLoc} LOC)` });
            }
        }
        if (volumeViolations.length > 0) {
            steps['STAGED-VOLUME-13'] = {
                status: 'BLOCK',
                detail: `模块双轨体积超限: ${volumeViolations[0].message}`,
                ruleId: 'VOL-ELOC-001',
                summary: volumeViolations[0].message,
                violations: volumeViolations,
            };
        } else {
            steps['STAGED-VOLUME-13'] = { status: 'PASS', detail: '暂存区双轨体积与动态包络合规', ruleId: 'VOL-ELOC-001', violations: [] };
        }
    } catch (err) {
        steps['STAGED-VOLUME-13'] = { status: 'BLOCK', detail: `双轨体积审查异常: ${err.message}`, ruleId: 'VOL-ELOC-001', summary: err.message, violations: [{ message: err.message }] };
    }
}

function auditDiffStep(options, steps) {
    try {
        const diffResult = evaluateStagedDifferentialBounds(options);
        if (diffResult.violations && diffResult.violations.length > 0) {
            steps['STAGED-DIFF-14'] = {
                status: 'BLOCK',
                detail: `五维微分边界未达标: ${diffResult.violations[0].message}`,
                ruleId: 'FGT-GAT-001',
                summary: diffResult.violations[0].message,
                violations: diffResult.violations,
            };
        } else {
            steps['STAGED-DIFF-14'] = { status: 'PASS', detail: '暂存区五维微分边界与准入周转合规', ruleId: 'FGT-GAT-001', violations: [] };
        }
    } catch (err) {
        steps['STAGED-DIFF-14'] = { status: 'BLOCK', detail: `差分边界审查异常: ${err.message}`, ruleId: 'FGT-GAT-001', summary: err.message, violations: [{ message: err.message }] };
    }
}

/**
 * Executes unified in-memory streaming validation across STAGED-SLICE-11..14 in a single process.
 *
 * @param {object} [options]
 * @returns {{ passed: boolean, steps: Record<string, { status: string, detail: string, ruleId: string, summary?: string, violations?: any[] }> }}
 */
function evaluateStagedStreamingSuite(options = {}) {
    const stagedList = getStagedStatusList();
    const auditableFiles = stagedList.filter(entry => isAuditableCodeFile(entry.path));
    const codeFiles = stagedList.filter(entry => /\.(ts|js|rs|py|gd)$/.test(entry.path) && !entry.path.endsWith('.d.ts'));

    const steps = {
        'STAGED-SLICE-11': { status: 'SKIP', detail: '无暂存代码', ruleId: 'GUARD-AST-001', violations: [] },
        'STAGED-DENSITY-12': { status: 'SKIP', detail: '无暂存可审计代码', ruleId: 'VOL-DIL-001', violations: [] },
        'STAGED-VOLUME-13': { status: 'SKIP', detail: '无暂存可审计代码', ruleId: 'VOL-ELOC-001', violations: [] },
        'STAGED-DIFF-14': { status: 'SKIP', detail: '无暂存可审计代码', ruleId: 'FGT-GAT-001', violations: [] },
    };

    if (codeFiles.length > 0) auditSliceStep(codeFiles, steps);
    if (auditableFiles.length > 0) {
        auditDensityStep(auditableFiles, steps);
        auditVolumeStep(auditableFiles, steps);
        auditDiffStep(options, steps);
    }

    const passed = Object.values(steps).every(s => s.status !== 'BLOCK');
    return { passed, steps };
}

/**
 * Main entry point.
 */
function main() {
    const args = process.argv.slice(2);
    const isAgent = args.includes('--agent') || args.includes('-a') || args.includes('--json');
    const isStream = args.includes('--stream') || args.includes('--unified');
    const acknowledged = args.includes('--acknowledge-streak');
    const context = { PROTOCOL_VERSION, GATE_NAME, STEP_ID };

    if (isStream) {
        const streamResult = evaluateStagedStreamingSuite({ ackStreak: acknowledged });
        process.stdout.write(JSON.stringify(streamResult) + '\n');
        process.exit(streamResult.passed ? 0 : 1);
    }

    const verdict = evaluateStagedDifferentialBounds({ ackStreak: acknowledged });
    if (isAgent) emitAgentVerdict(verdict, acknowledged, context);
    else emitHumanVerdict(verdict);
}

if (require.main === module) main();

module.exports = {
    REPO_ROOT,
    evaluateStagedDifferentialBounds,
    evaluateStagedStreamingSuite,
    measureStagedFiles,
    resolveViolations,
};
