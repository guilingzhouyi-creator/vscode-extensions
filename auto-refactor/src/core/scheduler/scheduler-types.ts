/**
 * Module: Core Engine - Scale-Adaptive Sparse Scheduler Contracts
 * File Path: src/core/scheduler/scheduler-types.ts
 * Architecture Role: Strongly typed contracts and interfaces for dynamic project partitioning,
 *   responsibility domain bindings, cross-reviewer event cascades, and sparse orchestration.
 * Dependencies & Triggers: Consumes Issue from core/types and FineGrainedFileRole from intelligence;
 *   consumed by dynamic-partitioner, sparse-orchestrator, and public APIs.
 * Responsibilities: Declare reviewer responsibility domains, partition descriptors, cascade event
 *   payloads, review context cache entries, and the ISparseOrchestrator SPI contract.
 * Exit Semantics & Design Rationale: Pure contract module with zero runtime overhead; ensures strict
 *   isolation boundaries and predictable event flow between specialized analyzers.
 */

import type { Issue } from '../types';
import type { FineGrainedFileRole } from '../intelligence/file-role-inference';
import type { CodeDensityMetrics } from '../intelligence/code-density-analyzer';

/** 审查器专属责任域分类 */
export type ReviewerDomain =
    | 'DOCUMENTATION'
    | 'LOGIC_AND_COMPLEXITY'
    | 'NAMING_AND_LAYOUT'
    | 'ARCHITECTURE'
    | 'SECURITY_AND_SECRETS';

/** 审查器责任域绑定映射 */
export interface ReviewDomainBinding {
    /** 责任域类别 */
    domain: ReviewerDomain;
    /** 该责任域所包含的分析器名称列表 */
    analyzers: string[];
    /** 负责审查的核心语法特征描述 */
    scopeDescription: string;
}

/** 动态工作分区定义 */
export interface ReviewPartition {
    /** 分区唯一标识符 (例如 "part-core-cache") */
    id: string;
    /** 分区主负责分析的文件集合 */
    primaryFiles: string[];
    /** 分区关联的只读上下文文件 (用于推导依赖或类型) */
    contextFiles: string[];
    /** 分区预估总计算负荷 (基于 ECL * 复杂度) */
    estimatedWorkload: number;
    /** 该分区激活审查的责任域列表 */
    activeDomains: ReviewerDomain[];
    /** 分区内代表性文件的主导架构角色 */
    dominantRole: FineGrainedFileRole;
}

/** 跨审查域级联触发事件类型 */
export type ReviewCascadeEventKind =
    | 'DOC_CODE_CONTRACT_MISMATCH'
    | 'SYMBOL_NAMING_COLLISION'
    | 'UNBOUNDED_COMPLEXITY_SPIKE'
    | 'CROSS_FILE_DEPENDENCY_MUTATION';

/** 跨审查域级联触发事件载荷 */
export interface ReviewCascadeEvent {
    /** 事件唯一编号 */
    eventId: string;
    /** 事件类别 */
    kind: ReviewCascadeEventKind;
    /** 发起源分析器或责任域 */
    sourceDomain: ReviewerDomain;
    /** 建议靶向激活动作的目标责任域 */
    targetDomain: ReviewerDomain;
    /** 关联触发的具体文件路径列表 */
    affectedFiles: string[];
    /** 关联触发的代码符号 (如特定函数或变量名) */
    targetSymbol?: string;
    /** 触发原因描述 */
    reason: string;
    /** 初始检测到的事实缺陷 (Issue) */
    triggeringFinding?: Issue;
}

/** 审查上下文缓存条目 */
export interface ReviewContextEntry {
    /** 文件路径 */
    filePath: string;
    /** 内容散列值 (指纹) */
    contentHash: string;
    /** 文件角色 */
    role: FineGrainedFileRole;
    /** 代码密度指标 */
    density: CodeDensityMetrics;
    /** 一阶段局部审计产出的发现列表 */
    localFindings: Issue[];
    /** 分析耗时毫秒数 */
    durationMs: number;
    /** 缓存记录时间戳 */
    cachedAt: number;
}

/** 稀疏调度执行选项 */
export interface SparseSchedulerOptions {
    /** 最大并行度，缺省遵循 LoadGovernor */
    maxConcurrency?: number;
    /** 是否启用二阶段关联复查（默认 true） */
    enableSecondaryCheck?: boolean;
    /** 局部责任域剪枝过滤（默认全部激活） */
    enabledDomains?: ReviewerDomain[];
    /** 强制最大分区文件数上限（默认 25） */
    maxPartitionFiles?: number;
}

/** 七阶段调度执行总结载荷 */
export interface SparseSchedulerResult {
    /** 参与审查的文件总数 */
    totalFiles: number;
    /** 划分的动态分区总数 */
    partitionCount: number;
    /** 各阶段耗时明细 (毫秒) */
    stageTimingsMs: {
        structureAnalysis: number;
        partitioning: number;
        localAnalysis: number;
        secondaryCheck: number;
        globalInvariant: number;
        scoring: number;
    };
    /** 稀疏激活相比传统全量扫描的 CPU 耗时节省比例 (0.00 ~ 1.00) */
    sparseActivationSavingsRatio: number;
    /** 最终综合审查发现列表 (去重后) */
    findings: Issue[];
    /** 审查上下文缓存命中数 */
    cacheHits: number;
    /** 级联触发的二阶段复查事件总数 */
    cascadeEventCount: number;
}
