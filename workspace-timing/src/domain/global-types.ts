/**
 * global-types — 跨工作区累计数据模型
 *
 * 存放在 domain 层，供 persistence 和 application 层引用。
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
    // 统一小写 + 去除末尾斜杠
    return uri.toLowerCase().replace(/\/+$/, '');
}
