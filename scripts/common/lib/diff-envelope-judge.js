/**
 * Module: Governance Guard — Staged Differential Envelope Judge
 * File Path: scripts/common/lib/diff-envelope-judge.js
 * Architecture Role: Turns per-file and per-batch measurements into violations. Pure judgement with
 *   one deliberate exception: the refactor witness reads git history, because whether a deletion
 *   migrated capability or erased it cannot be decided from the staged diff alone.
 * Dependencies & Triggers: diff-bounds-policy.js for every boundary, child_process for the witness
 *   query; consumed by gate-differential-bounds.js.
 * Responsibilities:
 *   1. Resolve which add and delete ceiling applies to one file, from its kind and its deletions.
 *   2. Emit a violation for each envelope or density measurement that falls outside its band.
 *   3. Emit the batch macro violations, including the empirical admission turnover floor.
 * Exit Semantics & Design Rationale: Total over the inputs it is given; the witness query degrades
 *   to "no witness" rather than throwing, because a git history that cannot be read must never grant
 *   the wider ceiling. Each density band produces two distinct violation types — a floor breach that
 *   no exemption may touch, and a target deficit that is a reviewability judgement. Keeping them
 *   apart here is what lets the ledger grant one and refuse the other without re-deriving anything.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const {
    DIFF_BOUNDS_CONTRACT,
    DIFF_RULES,
    FILE_ADD_BANDS,
    TEST_FILE_ADD_BANDS,
    FILE_DEL_BANDS,
    REFACTOR_WITNESS_MIN_DEL_ELOC,
    SUBSTANTIVE_RATIO_BAND,
    TSPR_BAND,
    DENSITY_MIN_PHYS_ADD,
    TSPR_VOUCH_FOR_DENSITY,
    DENSITY_FLOOR_BREACH,
    DENSITY_TARGET_DEFICIT,
    classifyBand,
    classifyDensity,
    isTestFilePath,
    BAND_ABOVE_CEILING,
} = require('./diff-bounds-policy');

/** Fraction of a deletion that a preceding commit's additions must cover to witness a refactor. */
const WITNESS_COVERAGE_RATIO = DIFF_BOUNDS_CONTRACT.expansionPolicy.witnessCoverageRatio;

/**
 * Detects whether the immediate preceding commit provided refactor addition capacity.
 *
 * @param minRequiredAddEloc - Minimum required weighted ELOC additions.
 * @returns True if the preceding commit carried sufficient refactoring additions.
 */
function checkHeadRefactorWitness(minRequiredAddEloc) {
    try {
        const raw = execFileSync('git', ['diff', 'HEAD~1..HEAD', '--numstat'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        let headAddLines = 0;
        for (const line of raw.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3 && parts[0] !== '-') {
                const added = parseInt(parts[0], 10);
                if (!isNaN(added)) headAddLines += added;
            }
        }
        return headAddLines * WITNESS_COVERAGE_RATIO >= minRequiredAddEloc;
    } catch {
        return false;
    }
}

/**
 * Resolves the added-logic ceiling that applies to one file.
 *
 * @param metrics - Per-file metrics from the parser.
 * @param batchRefactorWitness - Whether batch-level deletions witness cross-file refactoring.
 * @returns Ceiling in weighted ELOC.
 */
function resolveAddCeiling(metrics, batchRefactorWitness = false) {
    const bands = isTestFilePath(metrics.path) ? TEST_FILE_ADD_BANDS : FILE_ADD_BANDS;
    if (batchRefactorWitness) return bands.refactorWitness.ceiling;
    if (metrics.isNew) return bands.newFile.ceiling;
    if (metrics.elocDel > REFACTOR_WITNESS_MIN_DEL_ELOC) return bands.refactorWitness.ceiling;
    return bands.existingFile.ceiling;
}

/**
 * Resolves the removed-logic ceiling that applies to one file.
 *
 * @param metrics - Per-file metrics from the parser.
 * @param batchAddEloc - Added weighted ELOC across the whole batch.
 * @returns Ceiling in weighted ELOC.
 */
function resolveDelCeiling(metrics, batchAddEloc) {
    const required = metrics.elocDel * WITNESS_COVERAGE_RATIO;
    const witnessed = batchAddEloc >= required || checkHeadRefactorWitness(required);
    return witnessed ? FILE_DEL_BANDS.witnessed.ceiling : FILE_DEL_BANDS.plain.ceiling;
}

/**
 * Checks the added-logic envelope of one file.
 *
 * @param metrics - Per-file metrics.
 * @param violations - Collector that surviving violations are pushed onto.
 * @param batchRefactorWitness - Whether batch-level deletions witness cross-file refactoring.
 */
function checkAddEnvelope(metrics, violations, batchRefactorWitness = false) {
    const ceiling = resolveAddCeiling(metrics, batchRefactorWitness);
    if (classifyBand(metrics.elocAdd, Object.freeze({ ceiling })) !== BAND_ABOVE_CEILING) return;
    violations.push({
        type: 'FILE_ADD_OVERFLOW',
        ruleId: DIFF_RULES.bound,
        file: metrics.path,
        message: `单文件新增有效逻辑 (${metrics.elocAdd.toFixed(1)} weighted ELOC) 超出上限 (${ceiling.toFixed(1)} weighted ELOC)`,
        actionableFix: `拆分 ${metrics.path} 为更细内聚子模块，或按架构分层分批原子提交。`,
    });
}

/**
 * Checks the removed-logic envelope of one file.
 *
 * @param metrics - Per-file metrics.
 * @param batchAddEloc - Added weighted ELOC across the whole batch.
 * @param violations - Collector that surviving violations are pushed onto.
 */
function checkDelEnvelope(metrics, batchAddEloc, violations) {
    const ceiling = resolveDelCeiling(metrics, batchAddEloc);
    if (classifyBand(metrics.elocDel, Object.freeze({ ceiling })) !== BAND_ABOVE_CEILING) return;
    violations.push({
        type: 'CAPABILITY_EROSION',
        ruleId: DIFF_RULES.bound,
        file: metrics.path,
        message: `单文件删除逻辑 (${metrics.elocDel.toFixed(1)} weighted ELOC) 超出安全包络 (${ceiling.toFixed(1)} weighted ELOC)`,
        actionableFix: '把大面积删除拆成能力迁移与废弃两个阶段，并为删除附带重构证词。',
    });
}

/**
 * Checks one density band and pushes the matching violation.
 *
 * The violation type is decided by where the measurement sits, not by which band was read: a floor
 * breach is structural and unexemptible, a target deficit is the only type the ledger may grant.
 *
 * @param params - Measurement, band, discriminator names and repair guidance.
 * @param violations - Collector that surviving violations are pushed onto.
 */
function checkDensityBand(params, violations) {
    const { metrics, band, floorType, targetType, label, actionableFix } = params;
    const position = classifyDensity(params.measured, band);
    if (position === DENSITY_FLOOR_BREACH) {
        violations.push({
            type: floorType,
            ruleId: DIFF_RULES.density,
            file: metrics.path,
            message: `${label} (${(params.measured * 100).toFixed(1)}%) 低于刚性下限 (${(band.floor * 100).toFixed(1)}%)`,
            actionableFix,
            measured: params.measured,
            bandFloor: band.floor,
        });
        return;
    }
    if (position === DENSITY_TARGET_DEFICIT) {
        violations.push({
            type: targetType,
            ruleId: DIFF_RULES.density,
            file: metrics.path,
            message: `${label} (${(params.measured * 100).toFixed(1)}%) 低于审查目标线 (${(band.target * 100).toFixed(1)}%)`,
            actionableFix,
            measured: params.measured,
            bandFloor: band.floor,
        });
    }
}

/**
 * Checks the density and payload bands of one file.
 *
 * @param metrics - Per-file metrics.
 * @param violations - Collector that surviving violations are pushed onto.
 */
function checkDensityEnvelopes(metrics, violations) {
    if (metrics.physAdd < DENSITY_MIN_PHYS_ADD) return;
    // A payload ratio this high proves the non-code lines are explanation rather than filler, so the
    // substantive target stops blocking; the floor above still rejects genuinely empty content.
    const substantiveBand =
        metrics.tspr >= TSPR_VOUCH_FOR_DENSITY
            ? Object.freeze({ ...SUBSTANTIVE_RATIO_BAND, target: SUBSTANTIVE_RATIO_BAND.floor })
            : SUBSTANTIVE_RATIO_BAND;
    checkDensityBand(
        {
            metrics,
            measured: metrics.substantiveRatio,
            band: substantiveBand,
            floorType: 'SUBSTANTIVE_FLOOR_BREACH',
            targetType: 'SUBSTANTIVE_TARGET_DEFICIT',
            label: '实质行占比',
            actionableFix: '补入承载真实逻辑的代码行，或移除空注释与多余空行，提高技术密度。',
        },
        violations,
    );
    checkDensityBand(
        {
            metrics,
            measured: metrics.tspr,
            band: TSPR_BAND,
            floorType: 'TSPR_FLOOR_BREACH',
            targetType: 'CODE_DILUTION',
            label: '有效载荷率 TSPR',
            actionableFix: '消融机械转发跳板与空壳门面，提高真实语义行比例。',
        },
        violations,
    );
}

/**
 * Checks single-file micro envelopes.
 *
 * @param fileMetricsList - Per-file metrics for every auditable staged file.
 * @param batchAddEloc - Added weighted ELOC across the whole batch, used for the refactor witness.
 * @param violations - Collector that surviving violations are pushed onto.
 * @param options - Optional batch context (`batchRefactorWitness`).
 */
function checkFileMicroViolations(fileMetricsList, batchAddEloc, violations, options = {}) {
    const batchRefactorWitness = Boolean(options && options.batchRefactorWitness);
    for (const metrics of fileMetricsList) {
        checkAddEnvelope(metrics, violations, batchRefactorWitness);
        checkDelEnvelope(metrics, batchAddEloc, violations);
        checkDensityEnvelopes(metrics, violations);
    }
}

module.exports = Object.freeze({
    WITNESS_COVERAGE_RATIO,
    checkHeadRefactorWitness,
    resolveAddCeiling,
    resolveDelCeiling,
    checkAddEnvelope,
    checkDelEnvelope,
    checkDensityBand,
    checkDensityEnvelopes,
    checkFileMicroViolations,
});
