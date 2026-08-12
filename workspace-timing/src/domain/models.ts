/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */

/** 数据格式当前版本 */
export const LATEST_VERSION = 1;

// ─── 时间常量（唯一来源，禁止下游硬编码）──────────────
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_DAY = 86400000;

// ─── 调度器默认间隔（引用时间常量）────────────────────
export const DEFAULT_HEARTBEAT_MS = MS_PER_SECOND;        // 1s — 心跳推入 RingBuffer
export const DEFAULT_STATUS_BAR_MS = 5 * MS_PER_SECOND;   // 5s — 状态栏刷新
export const DEFAULT_JOURNAL_FLUSH_MS = 10 * MS_PER_SECOND; // 10s — journal 落盘
export const DEFAULT_FULL_SAVE_MS = MS_PER_MINUTE;          // 60s — 全量存盘
export const DEFAULT_RING_BUFFER_CAP = 1024;
export const DEFAULT_MAX_SESSIONS = 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * MS_PER_MINUTE;  // 5 分钟
export const DEFAULT_DAILY_GOAL_MS = 6 * MS_PER_HOUR;        // 6 小时
export const CRASH_COMPENSATION_CAP_MS = MS_PER_DAY;        // 崩溃补偿上限 24h

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
export function createEmptyTimingData(): WorkspaceTimingData {
    return {
        version: LATEST_VERSION,
        totalMs: 0,
        currentSessionStartMs: 0,
        lastSavedAtMs: 0,
        isEnabled: true,
        sessions: [],
    };
}

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
    /** 状态栏点击行为 */
    statusBarClickAction: 'cycle' | 'dashboard';
    /** 历史会话保留上限（0 = 不限） */
    maxSessions: number;
    /** 编辑活跃度追踪（效率转化） */
    activityTrackingEnabled: boolean;
    /** 闲置超时 (ms)，0 = 禁用闲置检测 */
    idleTimeoutMs: number;
    /** 每日目标时长 (ms)，0 = 不设目标 */
    dailyGoalMs: number;
}

/** 默认配置 */
export const DEFAULT_CONFIG: TimingConfig = {
    enabled: true,
    globalDisabled: false,
    statusBarEnabled: true,
    backupToFile: true,
    journalEnabled: true,
    ringBufferCapacity: DEFAULT_RING_BUFFER_CAP,
    journalFlushIntervalMs: DEFAULT_JOURNAL_FLUSH_MS,
    fullSaveIntervalMs: DEFAULT_FULL_SAVE_MS,
    statusBarFormat: 'compact',
    statusBarClickAction: 'cycle',
    maxSessions: DEFAULT_MAX_SESSIONS,
    activityTrackingEnabled: true,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    dailyGoalMs: DEFAULT_DAILY_GOAL_MS,
};
