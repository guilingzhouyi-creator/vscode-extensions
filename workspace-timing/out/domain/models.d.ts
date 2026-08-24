/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */
/** 数据格式当前版本（v2：新增 dailyTotals 沉淀层） */
export declare const LATEST_VERSION = 2;
export declare const MS_PER_SECOND = 1000;
export declare const MS_PER_MINUTE: number;
export declare const MS_PER_HOUR: number;
export declare const MS_PER_DAY: number;
export declare const DEFAULT_RING_BUFFER_CAP = 1024;
export declare const DEFAULT_JOURNAL_FLUSH_MS: number;
export declare const DEFAULT_FULL_SAVE_MS: number;
/** 会话明细细细保留上限——兜底安全值；常规历史治理由 historyRawRetentionDays 折叠承担 */
export declare const DEFAULT_MAX_SESSIONS = 5000;
/** 原始会话保留窗（天）：超出窗口的会话按日折叠进 dailyTotals；0=永不折叠 */
export declare const DEFAULT_RAW_RETENTION_DAYS = 45;
/** journal 文件大小告警阈值 */
export declare const JOURNAL_WARN_BYTES: number;
/** 崩溃补偿上限 24h，防止异常数据导致计时暴涨 */
export declare const CRASH_COMPENSATION_CAP_MS: number;
/** 单日聚合沉淀（折叠层）：某自然日的时长与会话数 */
export interface DailyTotal {
    /** 该日累计时长 (ms) */
    totalMs: number;
    /** 该日会话数（会话归属其起始自然日，与 TimeAggregator 口径一致） */
    sessionCount: number;
}
/** 日桶表：key = 本地日期 "YYYY-MM-DD" */
export type DailyTotalsMap = Record<string, DailyTotal>;
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
    /**
     * 日聚合沉淀层（v2+）：超出原始保留窗的会话按日折叠于此。
     * 口径与 TimeAggregator 完全一致；缺省（v1 数据）表示尚未迁移。
     */
    dailyTotals?: DailyTotalsMap;
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
    /** 界面语言：auto=跟随 VS Code 显示语言 */
    locale: 'auto' | 'zh-CN' | 'en';
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
    /** 历史会话保留上限（0 = 不限）。兜底安全值；常规治理走 rawRetentionDays 折叠 */
    maxSessions: number;
    /** 原始会话保留窗（天）：超窗会话按日折叠进 dailyTotals；0 = 永不折叠 */
    historyRawRetentionDays: number;
    /** 破坏性操作（重置/清除历史/还原）前自动写安全快照 */
    safetySnapshot: boolean;
}
/** 默认配置 */
export declare const DEFAULT_CONFIG: TimingConfig;
