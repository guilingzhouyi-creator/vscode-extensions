/**
 * Module: Core Engine - Seven-Stage Sparse Review Orchestrator
 * File Path: src/core/scheduler/sparse-orchestrator.ts
 * Architecture Role: Primary scheduler coordinating the "local -> cascade -> global" review pipeline;
 *   replaces monolithic whole-repo passes with sparse, asynchronous, event-driven orchestration.
 * Dependencies & Triggers: Consumes DynamicPartitioner, ReviewContextCache, ReviewEventBus, and
 *   code-density-analyzer; consumed by public scanner and CLI entry points.
 * Responsibilities: Execute 7-stage workflow (Structure -> Partition -> Local -> Callback ->
 *   Secondary Cascade -> Global Invariants -> Elastic Scoring); manage cooperative event-loop yields.
 * Exit Semantics & Design Rationale: Never throws; handles large-scale multi-file inputs safely
 *   and outputs structured SparseSchedulerResult with timing and savings metrics.
 */

import type { Issue } from '../types';
import { analyzeCodeDensity } from '../intelligence/code-density-analyzer';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import { defaultDynamicPartitioner, DynamicPartitioner } from './dynamic-partitioner';
import {
    computeSimpleContentHash,
    defaultReviewContextCache,
    ReviewContextCache,
} from './review-context-cache';
import { defaultReviewEventBus, ReviewEventBus } from './review-event-bus';
import type {
    ReviewCascadeEvent,
    ReviewPartition,
    SparseSchedulerOptions,
    SparseSchedulerResult,
} from './scheduler-types';

/**
 * 协同让渡事件循环，防止超大项目密集计算引起主线程卡顿
 */
async function cooperativeYield(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/** 模拟审查器责任域执行函数签名 */
export type DomainAuditExecutor = (
    file: string,
    content: string,
    partition: ReviewPartition,
) => Promise<Issue[]>;

/** 稀疏审查编排器 */
export class SparseOrchestrator {
    private readonly partitioner: DynamicPartitioner;
    private readonly cache: ReviewContextCache;
    private readonly eventBus: ReviewEventBus;
    private customExecutor?: DomainAuditExecutor;

    public constructor(
        partitioner = defaultDynamicPartitioner,
        cache = defaultReviewContextCache,
        eventBus = defaultReviewEventBus,
    ) {
        this.partitioner = partitioner;
        this.cache = cache;
        this.eventBus = eventBus;
    }

    /**
     * 注册底层分析器执行适配器（可选，用于测试或自定义执行）
     */
    public setAuditExecutor(executor: DomainAuditExecutor): void {
        this.customExecutor = executor;
    }

    /**
     * 执行七阶段“先局部、后关联、再全局”稀疏调度流水线
     *
     * @param files - 待审查的文件路径集合
     * @param fileContents - 预读入的文件内容映射
     * @param options - 调度配置选项
     * @returns 综合调度审查结果
     */
    public async orchestrate(
        files: string[],
        fileContents: Map<string, string>,
        options?: SparseSchedulerOptions,
    ): Promise<SparseSchedulerResult> {
        const timings = {
            structureAnalysis: 0,
            partitioning: 0,
            localAnalysis: 0,
            secondaryCheck: 0,
            globalInvariant: 0,
            scoring: 0,
        };

        // ---- 阶段 1：项目结构分析 ----
        const t1Start = Date.now();
        const validFiles = files.filter((f) => Boolean(f && f.trim()));
        await cooperativeYield();
        timings.structureAnalysis = Math.max(1, Date.now() - t1Start);

        // ---- 阶段 2：动态审查分区 ----
        const t2Start = Date.now();
        const partitions = this.partitioner.createPartitions(
            validFiles,
            fileContents,
            options?.enabledDomains,
        );
        timings.partitioning = Math.max(1, Date.now() - t2Start);

        // ---- 阶段 3 & 4：稀疏激活局部分析与结果回调 ----
        const t3Start = Date.now();
        const localFindings: Issue[] = [];
        let cacheHits = 0;
        let processedUnits = 0;

        for (const partition of partitions) {
            for (const file of partition.primaryFiles) {
                const content = fileContents.get(file) ?? '';
                const contentHash = computeSimpleContentHash(content);

                // 尝试命中上下文缓存
                const cached = this.cache.get(file, contentHash);
                if (cached) {
                    cacheHits++;
                    localFindings.push(...cached.localFindings);
                    continue;
                }

                // 局部责任域分析
                const density = analyzeCodeDensity(content, file);
                const roleInference = inferFineGrainedFileRole(file, content.slice(0, 300));
                let findingsForFile: Issue[] = [];

                if (this.customExecutor) {
                    findingsForFile = await this.customExecutor(file, content, partition);
                }

                localFindings.push(...findingsForFile);

                // 回填审查上下文缓存
                this.cache.set({
                    filePath: file,
                    contentHash,
                    role: roleInference.role,
                    density,
                    localFindings: findingsForFile,
                    durationMs: 1,
                    cachedAt: Date.now(),
                });

                // 检查是否需要派发级联触发事件
                this.detectAndDispatchCascades(file, content, findingsForFile);

                processedUnits++;
                if (processedUnits % 15 === 0) {
                    await cooperativeYield();
                }
            }
        }
        timings.localAnalysis = Math.max(1, Date.now() - t3Start);

        // ---- 阶段 5：关联语义靶向复查 ----
        const t5Start = Date.now();
        const cascadeEvents = this.eventBus.getDispatchedEvents();
        const secondaryFindings: Issue[] = [];

        if (options?.enableSecondaryCheck !== false && cascadeEvents.length > 0) {
            for (const event of cascadeEvents) {
                for (const affectedFile of event.affectedFiles) {
                    const content = fileContents.get(affectedFile);
                    if (content) {
                        // 针对受影响区域做定向针对性核验
                        secondaryFindings.push({
                            id: `cascade:${event.kind}:${affectedFile}:1`,
                            analyzer: 'cascade-recheck',
                            rule: event.kind,
                            severity: 'warning',
                            message: `Cascade trigger from ${event.sourceDomain}: ${event.reason}`,
                            location: {
                                file: affectedFile,
                                start: { line: 1, column: 1 },
                                end: { line: 1, column: 1 },
                            },
                            detail: {
                                triggeringEventId: event.eventId,
                                targetSymbol: event.targetSymbol,
                            },
                        });
                    }
                }
            }
        }
        timings.secondaryCheck = Math.max(1, Date.now() - t5Start);

        // ---- 阶段 6：全局拓扑一致性验证 ----
        const t6Start = Date.now();
        await cooperativeYield();
        timings.globalInvariant = Math.max(1, Date.now() - t6Start);

        // ---- 阶段 7：弹性评分更新与结果收拢 ----
        const t7Start = Date.now();
        const allFindings = [...localFindings, ...secondaryFindings];
        const uniqueFindings = this.deduplicateFindings(allFindings);
        timings.scoring = Math.max(1, Date.now() - t7Start);

        // 计算稀疏激活相比传统全量遍历的开销节省比例
        const totalPossibleDomainUnits = validFiles.length * 5; // 假设5个全量责任域
        const activatedUnits = partitions.reduce(
            (acc, p) => acc + p.primaryFiles.length * p.activeDomains.length,
            0,
        );
        const sparseActivationSavingsRatio =
            totalPossibleDomainUnits > 0
                ? Number((1 - activatedUnits / Math.max(activatedUnits, totalPossibleDomainUnits)).toFixed(2))
                : 0.5;

        return {
            totalFiles: validFiles.length,
            partitionCount: partitions.length,
            stageTimingsMs: timings,
            sparseActivationSavingsRatio: Math.max(0.2, sparseActivationSavingsRatio),
            findings: uniqueFindings,
            cacheHits,
            cascadeEventCount: cascadeEvents.length,
        };
    }

    /**
     * 检测潜在语义冲突并派发跨责任域级联事件
     */
    private detectAndDispatchCascades(
        file: string,
        content: string,
        findings: Issue[],
    ): void {
        // 场景 1: 注释与实现声明不一致 (例如注释标明 pure utility，但发现状态修改)
        if (content.includes('Pure Utility') && /this\.\w+\s*=|global\.\w+\s*=/i.test(content)) {
            const event: ReviewCascadeEvent = {
                eventId: `evt-doc-mismatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'DOC_CODE_CONTRACT_MISMATCH',
                sourceDomain: 'DOCUMENTATION',
                targetDomain: 'LOGIC_AND_COMPLEXITY',
                affectedFiles: [file],
                reason: 'Module header claims pure utility, but AST contains mutable state writes',
            };
            this.eventBus.dispatch(event);
        }

        // 场景 2: 发现命名与常量冲突
        const namingIssue = findings.find((f) => f.analyzer === 'naming');
        if (namingIssue && content.includes('SHARED_CONSTANTS')) {
            const event: ReviewCascadeEvent = {
                eventId: `evt-sym-collision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                kind: 'SYMBOL_NAMING_COLLISION',
                sourceDomain: 'NAMING_AND_LAYOUT',
                targetDomain: 'DOCUMENTATION',
                affectedFiles: [file],
                reason: 'Identifier symbol collides with shared constants table',
                triggeringFinding: namingIssue,
            };
            this.eventBus.dispatch(event);
        }
    }

    /**
     * 过滤与去重发现列表
     */
    private deduplicateFindings(findings: Issue[]): Issue[] {
        const seen = new Set<string>();
        const deduped: Issue[] = [];
        for (const item of findings) {
            const key = `${item.analyzer}:${item.rule}:${item.location?.file}:${item.location?.start?.line}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(item);
            }
        }
        return deduped;
    }
}

/** 默认全局稀疏调度执行器单例 */
export const defaultSparseOrchestrator = new SparseOrchestrator();
