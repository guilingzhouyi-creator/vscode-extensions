/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */
/** 数据格式当前版本 */
export declare const LATEST_VERSION = 1;
/** 一条原子时间片 — 用于缓存层和 journal */
export interface TimeSlice {
    /** 时间片结束时间戳 (Date.now()) */
    timestamp: number;
    /** 本片时长 (ms)，通常是 1000（1 秒） */
    deltaMs: number;
}
/** 单次会话记录 */
export interface TimeSession {
    /** 会话开始时间戳 (Date.now()) */
    startMs: number;
    /** 会话结束时间戳 */
    endMs: number;
    /** 本次会话时长 (ms) */
    durationMs: number;
}
/** 工作区计时主数据 */
export interface WorkspaceTimingData {
    /** 数据格式版本，用于向后兼容 */
    version: number;
    /** 累计总时长 (ms) */
    totalMs: number;
    /** 当前会话开始时间戳；0 表示无活跃会话 */
    currentSessionStartMs: number;
    /** 上次持久化时间戳 */
    lastSavedAtMs: number;
    /** 该工作区是否启用计时 */
    isEnabled: boolean;
    /** 历史会话列表 */
    sessions: TimeSession[];
    /** 扩展元数据容器 — 供插件/第三方使用 */
    metadata?: Record<string, string>;
}
/** 创建一个空的 WorkspaceTimingData */
export declare function createEmptyTimingData(): WorkspaceTimingData;
/** 插件配置模型 */
export interface TimingConfig {
    /** 工作区级启用开关 */
    enabled: boolean;
    /** 全局禁用开关 */
    globalDisabled: boolean;
    /** 状态栏显示开关 */
    statusBarEnabled: boolean;
    /** 是否启用 JSON 文件备份 */
    backupToFile: boolean;
    /** 是否启用 journal 崩溃保护 */
    journalEnabled: boolean;
    /** RingBuffer 容量 */
    ringBufferCapacity: number;
    /** journal flush 间隔 (ms) */
    journalFlushIntervalMs: number;
    /** 全量存盘间隔 (ms) */
    fullSaveIntervalMs: number;
    /** 状态栏显示格式 */
    statusBarFormat: 'compact' | 'detailed';
    /** 历史会话保留上限（0 = 不限） */
    maxSessions: number;
}
/** 默认配置 */
export declare const DEFAULT_CONFIG: TimingConfig;
