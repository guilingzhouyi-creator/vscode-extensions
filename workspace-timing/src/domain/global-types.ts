/**
 * Module: Global Timing Types (跨工作区全局统计数据模型)
 * File Path: src/domain/global-types.ts
 * Architecture Role: 领域模型层全局状态定义，规范跨多个 VS Code 工作区的累计时长汇总模型、工作区标识规范化与空状态工厂。
 * Dependencies & Triggers: 纯领域层定义，零外部依赖；供 GlobalStorageProvider 持久化与 TimerEngine 汇总时调用。
 * Responsibilities: 声明 WorkspaceRecord 与 GlobalTimingData 接口；提供 createEmptyGlobalData 空数据工厂；提供 normalizeWorkspaceId URI 稳定规范化。
 * Exit Semantics & Design Rationale: 数据结构通过 GLOBAL_VERSION 实现模式演化；normalizeWorkspaceId 保证跨平台大小写不敏感且尾部斜杠无关。
 */

export const GLOBAL_VERSION = 1;

/** 单个工作区的记录 */
export interface WorkspaceRecord {
    /** 工作区文件夹名 */
    name: string;
    /** 完整 URI 字符串 */
    uri: string;
    /** 该工作区累计时长 (ms) */
    totalMs: number;
    /** 上次同步时间戳 */
    lastSyncedAt: number;
}

/** 全局累计数据 */
export interface GlobalTimingData {
    version: number;
    /** 所有工作区累计时长总和 (ms) */
    totalMs: number;
    /** 各工作区明细，key = normalized workspace id */
    workspaces: Record<string, WorkspaceRecord>;
    /** 最后更新时间戳 */
    lastUpdatedAt: number;
}

/** 创建空的全局数据 */
export function createEmptyGlobalData(): GlobalTimingData {
    return {
        version: GLOBAL_VERSION,
        totalMs: 0,
        workspaces: {},
        lastUpdatedAt: 0,
    };
}

/**
 * 将工作区 URI 规范化为稳定 ID
 * 用于跨会话标识同一个工作区
 */
export function normalizeWorkspaceId(uri: string): string {
    return uri.toLowerCase().replace(/\/+$/, '');
}
