/**
 * Module: Tooling — Workspace Quantitative Risk & Financial Debt Evaluator
 * File Path: scripts/common/evaluate-workspace-quant.js
 * Architecture Role: Evaluates financial debt ledger, risk-adjusted quality performance,
 *   debt inequality (Gini/Entropy), and stochastic dynamics across workspace history.
 * Dependencies & Triggers: Pure Node.js CLI/module; consumes .audit-logs/audit-history.jsonl
 *   and baseline-signatures.json; invoked by audit-all runner and record-workspace-audit.js.
 * Responsibilities:
 *   1. Extract recent sliding-window audit score history (30~50 commits).
 *   2. Extract file-level defect counts and rule family distributions.
 *   3. Compute ICR, QSR, Sortino, Debt Gini, Entropy, VaR 95%, MDD, and half-life.
 *   4. Provide machine-actionable JSON or terminal formatted presentation.
 * Exit Semantics & Design Rationale: Exits 0 on clean calculation, degrades gracefully
 *   with safe fallbacks if historical logs or signatures are absent. Execution time <= 15ms.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT_HISTORY_PATH = path.join(REPO_ROOT, '.audit-logs', 'audit-history.jsonl');
const BASELINE_SIGS_PATH = path.join(
    REPO_ROOT,
    'auto-refactor',
    '.refactor-trajectory',
    'baseline-signatures.json',
);

const DEFAULT_SLIDING_WINDOW = 40;
const MIN_SAMPLES = 5;

/**
 * Safely parse JSON from a file path.
 */
function readJsonSafely(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const text = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * Safely parse non-empty JSON lines from a ledger file.
 */
function loadRecentAuditEntries(historyPath, windowSize = DEFAULT_SLIDING_WINDOW) {
    try {
        if (!fs.existsSync(historyPath)) return [];
        const content = fs.readFileSync(historyPath, 'utf8');
        const lines = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const recent = lines.slice(-windowSize);
        const entries = [];
        for (const line of recent) {
            try {
                const entry = JSON.parse(line);
                if (entry && typeof entry === 'object') {
                    entries.push(entry);
                }
            } catch {
                // Ignore corrupted lines
            }
        }
        return entries;
    } catch {
        return [];
    }
}

/**
 * Load recent audit history scores from jsonl ledger.
 */
function loadRecentScores(historyPath, windowSize = DEFAULT_SLIDING_WINDOW) {
    const entries = loadRecentAuditEntries(historyPath, windowSize);
    const scores = [];
    for (const entry of entries) {
        const score = Number(entry.score);
        if (Number.isFinite(score)) {
            scores.push(score);
        }
    }
    return scores;
}

/**
 * Extract empirical refactoring yield and debt accrual deltas from history ledger.
 */
function extractDebtDeltas(historyPath, windowSize = DEFAULT_SLIDING_WINDOW) {
    const entries = loadRecentAuditEntries(historyPath, windowSize);
    const validDebts = [];
    for (const entry of entries) {
        if (entry.debt !== null && entry.debt !== undefined) {
            const debt = Number(entry.debt);
            if (Number.isFinite(debt) && debt > 0) {
                validDebts.push(debt);
            }
        }
    }
    if (validDebts.length < 2) {
        return { yieldMinutes: undefined, accrualMinutes: undefined };
    }
    let totalYield = 0;
    let totalAccrual = 0;
    let transitionCount = 0;
    for (let i = 1; i < validDebts.length; i++) {
        const delta = validDebts[i] - validDebts[i - 1];
        if (delta < 0) {
            totalYield += Math.abs(delta);
            transitionCount++;
        } else if (delta > 0) {
            totalAccrual += delta;
            transitionCount++;
        }
    }
    if (transitionCount === 0) {
        return { yieldMinutes: undefined, accrualMinutes: undefined };
    }
    return { yieldMinutes: totalYield, accrualMinutes: totalAccrual };
}

/**
 * Extract debt items and rule categories from baseline signatures.
 */
function extractDebtDistribution(sigsPath) {
    const data = readJsonSafely(sigsPath);
    if (!data || !data.files || typeof data.files !== 'object') {
        return { fileDebts: [], ruleCategoryCounts: {}, totalFindings: 0 };
    }

    const fileDebts = [];
    const ruleCategoryCounts = {};
    let totalFindings = 0;

    for (const findings of Object.values(data.files)) {
        if (!Array.isArray(findings)) continue;
        const count = findings.length;
        fileDebts.push(count);
        totalFindings += count;

        for (const item of findings) {
            const ruleId = typeof item.r === 'string' ? item.r : '';
            const prefixMatch = ruleId.match(/^([A-Z]{2,4})-/);
            const family = prefixMatch ? prefixMatch[1] : 'OTHER';
            ruleCategoryCounts[family] = (ruleCategoryCounts[family] || 0) + 1;
        }
    }

    return { fileDebts, ruleCategoryCounts, totalFindings };
}

/**
 * Try importing compiled quantitative-risk-model from auto-refactor/dist.
 */
function resolveQuantEngine() {
    const distPath = path.join(
        REPO_ROOT,
        'auto-refactor',
        'dist',
        'core',
        'scoring',
        'quantitative-risk-model.js',
    );
    try {
        if (fs.existsSync(distPath)) {
            return require(distPath);
        }
    } catch {
        // Fallback to internal computation below
    }
    return null;
}

/**
 * Evaluate full workspace quantitative risk metrics.
 *
 * @param {string} root - Repository root path.
 * @param {object} [options={}] - Runtime evaluation context.
 * @param {boolean} [options.isBlocked=false] - Whether gate is currently in BLOCK status.
 * @returns {object} Quantitative metrics envelope.
 */
function evaluateWorkspaceQuant(root = REPO_ROOT, options = {}) {
    const isBlocked = Boolean(options.isBlocked);
    const windowSize =
        typeof options.windowSize === 'number' && options.windowSize > 0
            ? options.windowSize
            : DEFAULT_SLIDING_WINDOW;
    const historyPath = path.join(root, '.audit-logs', 'audit-history.jsonl');
    const sigsPath = path.join(
        root,
        'auto-refactor',
        '.refactor-trajectory',
        'baseline-signatures.json',
    );

    const scores = loadRecentScores(historyPath, windowSize);
    const { fileDebts, ruleCategoryCounts, totalFindings } = extractDebtDistribution(sigsPath);
    const { yieldMinutes, accrualMinutes } = extractDebtDeltas(historyPath, windowSize);

    const engine = resolveQuantEngine();

    if (engine) {
        const assessment = engine.evaluateQuantitativeRiskModel(
            {
                totalRemediationMinutes: totalFindings,
                refactoringYieldMinutes: yieldMinutes,
                debtAccrualMinutes: accrualMinutes,
            },
            { historyScores: scores, windowSize },
            { fileDebts, ruleCategoryCounts },
            { historyScores: scores, windowSize },
        );

        const rcr = assessment.financial.rcr ?? assessment.financial.interestCoverageRatio;
        const erq = assessment.riskRatios.erq ?? assessment.riskRatios.qsr;
        let ddr = assessment.riskRatios.ddr ?? assessment.riskRatios.sortino;
        const dsi = assessment.inequality.dsi ?? assessment.inequality.debtGini;
        const rcd = assessment.inequality.rcd ?? assessment.inequality.defectEntropy;
        let edb95 = assessment.riskRatios.edb95 ?? assessment.riskRatios.var95;
        const ptd = assessment.riskRatios.ptd ?? assessment.riskRatios.mdd;
        const ehl = assessment.stochastic.ehl ?? assessment.stochastic.halfLifeCommits;

        // 当门禁当前发生阻断时，将阻断事件映射为外生质量冲击 (Exogenous Shock)
        if (isBlocked) {
            ddr = Math.min(ddr, 0.0);
            edb95 = Math.max(edb95, 35.0);
        }

        return {
            rcr,
            erq,
            ddr,
            dsi,
            rcd,
            edb95,
            ptd,
            ehl,
            icr: rcr,
            qsr: erq,
            sortino: ddr,
            debtGini: dsi,
            defectEntropy: rcd,
            var95: edb95,
            mdd: ptd,
            halfLifeCommits: ehl,
            status: assessment.financial.status,
            sampleCount: scores.length,
            isSampleSufficient: scores.length >= MIN_SAMPLES,
            totalFindings,
            isBlocked,
            ...(isBlocked ? { shockLevel: 'HIGH', shockAlert: '当前检测到门禁阻断冲击 (Quality Shock Event)' } : {}),
        };
    }

    // Graceful fallback if dist is unbuilt or evaluation is unavailable
    const fallbackDdr = isBlocked ? 0.0 : 0.0;
    const fallbackEdb = isBlocked ? 35.0 : 0.0;
    return {
        rcr: 0.0,
        erq: 0.0,
        ddr: fallbackDdr,
        dsi: 0.0,
        rcd: 0.0,
        edb95: fallbackEdb,
        ptd: 0.0,
        ehl: 0.0,
        icr: 0.0,
        qsr: 0.0,
        sortino: fallbackDdr,
        debtGini: 0.0,
        defectEntropy: 0.0,
        var95: fallbackEdb,
        mdd: 0.0,
        halfLifeCommits: 0.0,
        status: 'insufficient_samples',
        sampleCount: scores.length,
        isSampleSufficient: false,
        totalFindings,
        isBlocked,
        ...(isBlocked ? { shockLevel: 'HIGH', shockAlert: '当前检测到门禁阻断冲击 (Quality Shock Event)' } : {}),
    };
}

module.exports = {
    evaluateWorkspaceQuant,
    loadRecentScores,
    extractDebtDistribution,
    extractDebtDeltas,
};

if (require.main === module) {
    const args = process.argv.slice(2);
    const isJson = args.includes('--json');
    const isBlocked = args.includes('--blocked');
    let windowSize;
    const windowIdx = args.findIndex((a) => a === '--window' || a === '-w');
    if (windowIdx !== -1 && args[windowIdx + 1]) {
        const parsed = parseInt(args[windowIdx + 1], 10);
        if (Number.isFinite(parsed) && parsed > 0) windowSize = parsed;
    }
    const result = evaluateWorkspaceQuant(REPO_ROOT, { isBlocked, windowSize });

    if (isJson) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
        const statusBadge =
            result.status === 'de-leveraging'
                ? '🟢 [强净消融]'
                : result.status === 'balanced'
                  ? '🟡 [动态均势]'
                  : result.status === 'insufficient_samples'
                    ? '⚪ [样本匮乏]'
                    : '🔴 [赤字膨胀]';
        process.stdout.write(`\n=== 架构动力学与韧性量化模型 (Architecture Dynamics & Resilience, ADR-Q) ===\n`);
        process.stdout.write(` 【偿债动力学】\n`);
        process.stdout.write(`  • 消融代偿比 (RCR)   : ${result.rcr.toFixed(2)}x ${statusBadge}\n`);
        process.stdout.write(` 【时序韧性包络】\n`);
        process.stdout.write(`  • 质量坚韧商 (ERQ)   : ${result.erq.toFixed(2)}\n`);
        process.stdout.write(`  • 破位防御度 (DDR)   : ${result.ddr.toFixed(2)}\n`);
        process.stdout.write(`  • 极端退化包络 (EDB) : ${result.edb95.toFixed(2)}%\n`);
        process.stdout.write(`  • 历史峰谷落差 (PTD) : ${result.ptd.toFixed(2)}%\n`);
        process.stdout.write(`  • 扰动自愈步长 (EHL) : ${result.ehl.toFixed(1)} 步\n`);
        process.stdout.write(` 【空间拓扑散度】\n`);
        process.stdout.write(`  • 债务偏聚指数 (DSI) : ${result.dsi.toFixed(2)}\n`);
        process.stdout.write(`  • 根因发散熵   (RCD) : ${result.rcd.toFixed(2)}\n`);
        process.stdout.write(`=========================================================================\n`);
    }
}
