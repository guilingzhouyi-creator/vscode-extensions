/**
 * WorkspaceTiming — Domain 层数据模型
 *
 * 所有时间单位统一为毫秒 (ms)。
 * 时间戳使用 Date.now() (UTC 毫秒)。
 * 零外部依赖。
 */

/** 数据格式当前版本（v2：新增 dailyTotals 沉淀层） */
export const LATEST_VERSION = 2;

// ─── 时间常量（唯一来源，禁止下游硬编码）──────────────
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

// ─── 默认值（引用时间常量）──────────────
export const DEFAULT_RING_BUFFER_CAP = 1024;
export const DEFAULT_JOURNAL_FLUSH_MS = 10 * MS_PER_SECOND;  // 10s — journal 落盘
export const DEFAULT_FULL_SAVE_MS = MS_PER_MINUTE;           // 60s — 全量存盘
/** 会话明细细细保留上限——兜底安全值；常规历史治理由 historyRawRetentionDays 折叠承担 */
export const DEFAULT_MAX_SESSIONS = 5000;
/** 原始会话保留窗（天）：超出窗口的会话按日折叠进 dailyTotals；0=永不折叠 */
export const DEFAULT_RAW_RETENTION_DAYS = 45;
/** journal 文件大小告警阈值 */
export const JOURNAL_WARN_BYTES = 5 * 1024 * 1024;
/** 崩溃补偿上限 24h，防止异常数据导致计时暴涨 */
export const CRASH_COMPENSATION_CAP_MS = MS_PER_DAY;
/** 周工作时长上限下限 (1h) */
export const MIN_WEEKLY_LIMIT_HOURS = 1;
/** 周工作时长上限上限 (168h = 7天*24小时) */
export const MAX_WEEKLY_LIMIT_HOURS = 168;
/** 周工作时长上限默认值 (40h) */
export const DEFAULT_WEEKLY_LIMIT_HOURS = 40;

/** 校验并钳制周工作时长上限（小时），非法输入（非数字/NaN/Infinity/越界）自动纠偏到 [1, 168] */
export function sanitizeWeeklyLimitHours(val: unknown): number {
    let n: number;
    if (typeof val === 'number') {
        n = val;
    } else if (typeof val === 'string') {
        n = parseInt(val, 10);
    } else {
        return DEFAULT_WEEKLY_LIMIT_HOURS;
    }
    if (!Number.isFinite(n) || Number.isNaN(n)) {
        return DEFAULT_WEEKLY_LIMIT_HOURS;
    }
    const rounded = Math.round(n);
    return Math.min(MAX_WEEKLY_LIMIT_HOURS, Math.max(MIN_WEEKLY_LIMIT_HOURS, rounded));
}

/** 校验周工作时长上限开关 */
export function sanitizeWeeklyLimitEnabled(val: unknown): boolean {
    return val === true || val === 'true';
}

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
    /** 周工作时长上限开关（默认不开启） */
    weeklyLimitEnabled: boolean;
    /** 周工作时长上限（小时，默认 40h） */
    weeklyLimitHours: number;
}

/** 默认配置 */
export const DEFAULT_CONFIG: TimingConfig = {
    enabled: true,
    globalDisabled: false,
    locale: 'auto',
    historyRawRetentionDays: DEFAULT_RAW_RETENTION_DAYS,
    safetySnapshot: true,
    weeklyLimitEnabled: false,
    weeklyLimitHours: 40,
    statusBarEnabled: true,
    backupToFile: true,
    journalEnabled: true,
    ringBufferCapacity: DEFAULT_RING_BUFFER_CAP,
    journalFlushIntervalMs: DEFAULT_JOURNAL_FLUSH_MS,
    fullSaveIntervalMs: DEFAULT_FULL_SAVE_MS,
    statusBarFormat: 'compact',
    maxSessions: DEFAULT_MAX_SESSIONS,
};
