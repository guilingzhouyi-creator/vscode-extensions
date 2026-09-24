/**
 * Module: Core Engine - Review Context & State Fingerprint Cache
 * File Path: src/core/scheduler/review-context-cache.ts
 * Architecture Role: In-memory cache store preserving AST facts, density metrics, and findings;
 *   powers secondary cascade re-checks and cross-partition verification without redundant I/O.
 * Dependencies & Triggers: scheduler-types; consumed by sparse-orchestrator.
 * Responsibilities: Cache file review context keyed by file path and content fingerprint;
 *   track hit/miss metrics; provide query access for secondary semantic cascade passes.
 * Exit Semantics & Design Rationale: Bounded LRU-style in-memory map; never throws.
 */

import type { ReviewContextEntry } from './scheduler-types';

/** 最大缓存条目数 */
const MAX_CACHE_ENTRIES = 2000;

/** 简易快速哈希计算函数 */
export function computeSimpleContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        hash = (hash << 5) - hash + content.charCodeAt(i);
        hash |= 0;
    }
    return `h${hash}_${content.length}`;
}

/** 审查上下文缓存管理器 */
export class ReviewContextCache {
    private readonly entries = new Map<string, ReviewContextEntry>();
    private hitCount = 0;
    private missCount = 0;

    /**
     * 获取缓存条目
     *
     * @param filePath - 文件路径
     * @param contentHash - 内容哈希指纹
     * @returns 匹配的缓存条目或 undefined
     */
    public get(filePath: string, contentHash: string): ReviewContextEntry | undefined {
        const entry = this.entries.get(filePath);
        if (entry && entry.contentHash === contentHash) {
            this.hitCount++;
            return entry;
        }
        this.missCount++;
        return undefined;
    }

    /**
     * 写入或更新缓存条目
     *
     * @param entry - 审查上下文条目
     */
    public set(entry: ReviewContextEntry): void {
        if (this.entries.size >= MAX_CACHE_ENTRIES) {
            const firstKey = this.entries.keys().next().value;
            if (firstKey) {
                this.entries.delete(firstKey);
            }
        }
        this.entries.set(entry.filePath, entry);
    }

    /**
     * 获取已缓存的所有文件条目
     */
    public getAllEntries(): ReviewContextEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * 获取缓存统计指标
     */
    public getMetrics(): { hits: number; misses: number; hitRatio: number; size: number } {
        const total = this.hitCount + this.missCount;
        const hitRatio = total > 0 ? Number((this.hitCount / total).toFixed(3)) : 0;
        return {
            hits: this.hitCount,
            misses: this.missCount,
            hitRatio,
            size: this.entries.size,
        };
    }

    /**
     * 清空缓存
     */
    public clear(): void {
        this.entries.clear();
        this.hitCount = 0;
        this.missCount = 0;
    }
}

/** 默认全局审查上下文缓存单例 */
export const defaultReviewContextCache = new ReviewContextCache();
