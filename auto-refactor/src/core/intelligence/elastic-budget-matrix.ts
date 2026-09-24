/**
 * Module: Core Engine - Role-Aware Elastic Budget Matrix
 * File Path: src/core/intelligence/elastic-budget-matrix.ts
 * Architecture Role: Multi-dimensional budget matrix providing elastic lines and complexity limits
 *   based on fine-grained file roles and effective code density metrics.
 * Dependencies & Triggers: Consumes FineGrainedFileRole and CodeDensityMetrics; consumed by
 *   large-file analyzer, architecture rules, and quality scorers.
 * Responsibilities: Resolve elastic physical line limits, effective code line (ECL) thresholds,
 *   cyclomatic complexity limits, and density-damping factors.
 * Exit Semantics & Design Rationale: Never throws; guarantees structured evaluation results
 *   preventing false-positive large-file alarms on well-documented or dictionary-heavy modules.
 */

import type { CodeDensityMetrics } from './code-density-analyzer';
import type { FineGrainedFileRole } from './file-role-inference';

/** 角色预算阈值契约 */
export interface RoleBudgetThresholds {
    /** 物理行警告阈值 */
    physicalLinesWarn: number;
    /** 物理行失败阈值 */
    physicalLinesFail: number;
    /** 真实有效代码行警告阈值 */
    effectiveLocWarn: number;
    /** 真实有效代码行失败阈值 */
    effectiveLocFail: number;
    /** 圈复杂度阈值 */
    complexityBudget: number;
    /** 嵌套深度阈值 */
    nestingDepthBudget: number;
}

/** 弹性预算评估结果 */
export interface ElasticBudgetEvaluation {
    /** 最终生效的物理行警告阈值（经密度阻尼调整后） */
    effectivePhysicalWarn: number;
    /** 最终生效的物理行失败阈值（经密度阻尼调整后） */
    effectivePhysicalFail: number;
    /** 是否超出了有效代码行预算 */
    isEffectiveLocExceeded: boolean;
    /** 是否应当触发大文件警告 */
    shouldFlagLargeFile: boolean;
    /** 触发违规时的严重度等级 ('warning' | 'error' | null) */
    violationSeverity: 'warning' | 'error' | null;
    /** 判定原因解释 */
    rationale: string;
}

/** 基础角色预算配置表 */
const BASE_ROLE_BUDGETS: Record<FineGrainedFileRole, RoleBudgetThresholds> = {
    core_trunk: {
        physicalLinesWarn: 500,
        physicalLinesFail: 900,
        effectiveLocWarn: 350,
        effectiveLocFail: 650,
        complexityBudget: 12,
        nestingDepthBudget: 4,
    },
    business_module: {
        physicalLinesWarn: 400,
        physicalLinesFail: 800,
        effectiveLocWarn: 280,
        effectiveLocFail: 550,
        complexityBudget: 10,
        nestingDepthBudget: 4,
    },
    shared_library: {
        physicalLinesWarn: 350,
        physicalLinesFail: 600,
        effectiveLocWarn: 220,
        effectiveLocFail: 450,
        complexityBudget: 8,
        nestingDepthBudget: 3,
    },
    algorithm_computation: {
        physicalLinesWarn: 800,
        physicalLinesFail: 1500,
        effectiveLocWarn: 600,
        effectiveLocFail: 1100,
        complexityBudget: 20,
        nestingDepthBudget: 5,
    },
    rules_registry: {
        physicalLinesWarn: 1200,
        physicalLinesFail: 3000,
        effectiveLocWarn: 800,
        effectiveLocFail: 2000,
        complexityBudget: 6,
        nestingDepthBudget: 3,
    },
    config_constant: {
        physicalLinesWarn: 1000,
        physicalLinesFail: 2500,
        effectiveLocWarn: 600,
        effectiveLocFail: 1500,
        complexityBudget: 4,
        nestingDepthBudget: 3,
    },
    test_suite: {
        physicalLinesWarn: 1000,
        physicalLinesFail: 2000,
        effectiveLocWarn: 700,
        effectiveLocFail: 1400,
        complexityBudget: 15,
        nestingDepthBudget: 4,
    },
    auto_generated: {
        physicalLinesWarn: Number.MAX_SAFE_INTEGER,
        physicalLinesFail: Number.MAX_SAFE_INTEGER,
        effectiveLocWarn: Number.MAX_SAFE_INTEGER,
        effectiveLocFail: Number.MAX_SAFE_INTEGER,
        complexityBudget: Number.MAX_SAFE_INTEGER,
        nestingDepthBudget: Number.MAX_SAFE_INTEGER,
    },
};

/**
 * 获取指定角色的基准预算阈值
 *
 * @param role - 细粒度架构角色
 * @returns 角色预算配置
 */
export function getRoleBudget(role: FineGrainedFileRole): RoleBudgetThresholds {
    return BASE_ROLE_BUDGETS[role] ?? BASE_ROLE_BUDGETS.business_module;
}

/**
 * 结合文件代码密度对文件规模进行弹性判定
 *
 * @param role - 文件角色
 * @param metrics - 代码密度分析指标
 * @returns 弹性预算综合评估结果
 */
export function evaluateRoleElasticBudget(
    role: FineGrainedFileRole,
    metrics: CodeDensityMetrics,
): ElasticBudgetEvaluation {
    const base = getRoleBudget(role);

    // 自动生成代码完全豁免
    if (role === 'auto_generated') {
        return {
            effectivePhysicalWarn: Number.MAX_SAFE_INTEGER,
            effectivePhysicalFail: Number.MAX_SAFE_INTEGER,
            isEffectiveLocExceeded: false,
            shouldFlagLargeFile: false,
            violationSeverity: null,
            rationale: 'Auto-generated code is exempt from file size and complexity limits',
        };
    }

    // 自述性优良/高注释/高静态数据的文件享受 1.5 倍物理行扩展缓冲
    const densityDampingFactor = metrics.isLowDensityDocumented ? 1.5 : 1.0;
    const effectivePhysicalWarn = Math.round(base.physicalLinesWarn * densityDampingFactor);
    const effectivePhysicalFail = Math.round(base.physicalLinesFail * densityDampingFactor);

    // 判定真实有效代码行超限状态
    const isEclFail = metrics.effectiveCodeLines >= base.effectiveLocFail;
    const isEclWarn = metrics.effectiveCodeLines >= base.effectiveLocWarn;
    const isPhysicalFail = metrics.physicalLines >= effectivePhysicalFail;
    const isPhysicalWarn = metrics.physicalLines >= effectivePhysicalWarn;

    // 核心判定准则：
    // 只有当有效代码行超标，或物理行超标且有效代码密度高于 0.35 时才报告违规
    let violationSeverity: 'warning' | 'error' | null = null;
    let rationale = 'File size is within elastic complexity budget';

    if (isEclFail || (isPhysicalFail && metrics.effectiveDensity > 0.35)) {
        violationSeverity = 'error';
        rationale = `Effective code lines (${metrics.effectiveCodeLines}) or physical lines (${metrics.physicalLines}) exceeds error threshold for role [${role}]`;
    } else if (isEclWarn || (isPhysicalWarn && metrics.effectiveDensity > 0.35)) {
        violationSeverity = 'warning';
        rationale = `Effective code lines (${metrics.effectiveCodeLines}) or physical lines (${metrics.physicalLines}) exceeds warning threshold for role [${role}]`;
    }

    return {
        effectivePhysicalWarn,
        effectivePhysicalFail,
        isEffectiveLocExceeded: isEclWarn,
        shouldFlagLargeFile: violationSeverity !== null,
        violationSeverity,
        rationale,
    };
}
