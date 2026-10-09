/**
 * Module: Domain Models & Constants (领域核心实体、常量与配置净化)
 * File Path: src/domain/models.ts
 * Architecture Role: 领域模型层核心单源真相（SSOT），定义时间片、会话、持久化实体结构、配置界限及数值净化守卫。
 * Dependencies & Triggers: 纯 TypeScript 实现，零外部依赖；在扩展激活、配置变更、时间切片生成与落盘校验全链路贯穿触发。
 * Responsibilities: 定义时间单位常数与状态机枚举；定义 WorkspaceTimingData 及日桶、会话数据结构；提供配置范围合法域 clamp 净化器。
 * Exit Semantics & Design Rationale: 统一毫秒物理量纲与不可变类型视图 (ReadonlyTimingData)；数值净化器杜绝 NaN/越界引发状态机异常。
 * Contract Invariant & Boundary: 强类型不变量保证：所有工时量度均为物理量纲非负毫秒数 (*Ms)；各配置边界上下界在 clamp 净化器中严格闭合；状态机转换仅允许 ORCHESTRATOR_STATES 定义的确定性状态。
 */

/** 契约版本：数据存储格式版本 3（双轨模式 manual/ai、idleSessions 与沉淀层，满足向前兼容） */
export const LATEST_VERSION = 3;

/** 计时活动模式枚举：手动编码 vs AI 辅助协作 */
export type ActivityMode = 'manual' | 'ai';

// ─── 基础单位转换常数（消灭魔法数字）──────────────
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
export const HOURS_PER_DAY = 24;
export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
export const DEFAULT_JOURNAL_FLUSH_SECONDS = 10;
export const JOURNAL_WARN_MB = 5;
export const SLEEP_DETECT_GAP_SECONDS = 15;
export const RADIX_DECIMAL = 10;

// ─── 计时状态机枚举（单一真源契约）───────────────────
export const ORCHESTRATOR_STATES = {
    IDLE: 'idle',
    RUNNING: 'running',
    DISABLED: 'disabled',
    SAVING: 'saving',
    STOPPED: 'stopped',
    ERROR: 'error',
    PAUSED_IDLE: 'paused_idle',
} as const;
export type OrchestratorState = typeof ORCHESTRATOR_STATES[keyof typeof ORCHESTRATOR_STATES];

// ─── 时间常量（唯一来源，禁止下游硬编码）──────────────
export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

// ─── 默认值（引用时间常量）──────────────
export const DEFAULT_RING_BUFFER_CAP = 1024;
export const DEFAULT_JOURNAL_FLUSH_MS = DEFAULT_JOURNAL_FLUSH_SECONDS * MS_PER_SECOND;  // 10s — journal 落盘
/** 单日原始会话保留上限（每日最高 20 条，超出将自动清除最远会话条目） */
export const MAX_SESSIONS_PER_DAY = 20;
/** 会话明细保留上限——兜底安全值（每周 7 天 * 20 条 = 140 条） */
export const DEFAULT_MAX_SESSIONS = 140;
/** 原始会话保留窗（天）：超出窗口的会话按日折叠进 dailyTotals；0=不折叠（保留全量原始明细） */
export const DEFAULT_RAW_RETENTION_DAYS = 45;
/** journal 文件大小告警阈值 */
export const JOURNAL_WARN_BYTES = JOURNAL_WARN_MB * BYTES_PER_MB;
/** 周工作时长上限下限 (1h) */
export const MIN_WEEKLY_LIMIT_HOURS = 1;
/** 周工作时长上限上限 (168h = 7天*24小时) */
export const MAX_WEEKLY_LIMIT_HOURS = 168;
/** 周工作时长上限默认值 (40h) */
export const DEFAULT_WEEKLY_LIMIT_HOURS = 40;
/** 跨工作区陈旧条目回收天数 (30天) 与对应毫秒阈值 */
export const GLOBAL_STALE_DAYS = 30;
export const GLOBAL_STALE_TTL_MS = GLOBAL_STALE_DAYS * MS_PER_DAY;
/** 系统休眠/挂起恢复检测间隔阈值 (15s) */
export const SLEEP_DETECT_GAP_MS = SLEEP_DETECT_GAP_SECONDS * MS_PER_SECOND;
/** 检查点周期性折叠触发步长 (每 50 次 checkpoint) */
export const FOLD_CHECKPOINT_MOD = 50;
/** 恢复与会话管理器默认容量兜底上限 */
export const DEFAULT_SESSION_CAP = 140;
/** 日志 ISO 时间戳截取切片起止索引 (HH:mm:ss.sss) */
export const ISO_TIME_START = 11;
export const ISO_TIME_END = 23;
/** Webview CSP Nonce 字符长度 */
export const CSP_NONCE_LENGTH = 32;
/** 状态栏右侧停靠优先级 */
export const STATUS_BAR_PRIORITY = 100;

// ─── 配置边界单一真源 ────────────────────────────────
// 以下上下界是配置合法域的【唯一权威】，与 package.json contributes 的
// minimum/maximum 及面板输入框 min/max 属性必须严格一致（三方同源，禁止漂移）。
/** RingBuffer 容量合法域 [64, 65536] */
export const MIN_RING_BUFFER_CAPACITY = 64;
export const MAX_RING_BUFFER_CAPACITY = 65536;
/** journal flush 间隔合法域 [1000, 300000] ms */
export const MIN_JOURNAL_FLUSH_MS = 1000;
export const MAX_JOURNAL_FLUSH_MS = 300000;
/** 全量存盘间隔合法域 [5000, 600000] ms */
export const MIN_FULL_SAVE_MS = 5000;
export const MAX_FULL_SAVE_MS = 600000;
/** 原始会话保留窗合法域 [0, 3650] 天 */
export const MAX_RAW_RETENTION_DAYS = 3650;

/** 空闲超时分钟数合法域 [0, 120]（0 为关闭空闲检测） */
export const MIN_IDLE_TIMEOUT_MINUTES = 0;
export const MAX_IDLE_TIMEOUT_MINUTES = 120;
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5;

/** AI 冷却秒数合法域 [10, 600] */
export const MIN_AI_COOLDOWN_SECONDS = 10;
export const MAX_AI_COOLDOWN_SECONDS = 600;
export const DEFAULT_AI_COOLDOWN_SECONDS = 120;

/** AI 检测默认开关 */
export const DEFAULT_AI_DETECTION_ENABLED = true;

/**
 * 契约算法：数值净化器与安全钳制器 (clampNumber)
 * 边界保证：非法输入（非数字/NaN/Infinity/空字符串/布尔值）确定性回退至 fallback，合法数值闭合钳制到 [min, max] 区间。
 * @param val 输入待校验值
 * @param min 下限闭界
 * @param max 上限闭界
 * @param fallback 越界或非法类型时的回退默认值
 * @returns 净化后的安全整数不变量
 */
export function clampNumber(
    val: unknown,
    min: number,
    max: number,
    fallback: number,
): number {
    if (val === null || val === undefined || typeof val === 'boolean') return fallback;
    if (typeof val === 'string' && val.trim() === '') return fallback;
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeRingBufferCapacity(val: unknown): number {
    return clampNumber(val, MIN_RING_BUFFER_CAPACITY, MAX_RING_BUFFER_CAPACITY, DEFAULT_RING_BUFFER_CAP);
}

export function sanitizeJournalFlushIntervalMs(val: unknown): number {
    return clampNumber(val, MIN_JOURNAL_FLUSH_MS, MAX_JOURNAL_FLUSH_MS, DEFAULT_JOURNAL_FLUSH_MS);
}

export function sanitizeFullSaveIntervalMs(val: unknown): number {
    return clampNumber(val, MIN_FULL_SAVE_MS, MAX_FULL_SAVE_MS, MS_PER_MINUTE);
}

export function sanitizeHistoryRawRetentionDays(val: unknown): number {
    return clampNumber(val, 0, MAX_RAW_RETENTION_DAYS, DEFAULT_RAW_RETENTION_DAYS);
}

export function sanitizeMaxSessions(val: unknown): number {
    return clampNumber(val, 0, Number.MAX_SAFE_INTEGER, DEFAULT_MAX_SESSIONS);
}

export function sanitizeIdleTimeoutMinutes(val: unknown): number {
    return clampNumber(val, MIN_IDLE_TIMEOUT_MINUTES, MAX_IDLE_TIMEOUT_MINUTES, DEFAULT_IDLE_TIMEOUT_MINUTES);
}

export function sanitizeAiDetectionEnabled(val: unknown): boolean {
    if (val === undefined || val === null) return DEFAULT_AI_DETECTION_ENABLED;
    return val === true || val === 'true';
}

export function sanitizeAiCooldownSeconds(val: unknown): number {
    return clampNumber(val, MIN_AI_COOLDOWN_SECONDS, MAX_AI_COOLDOWN_SECONDS, DEFAULT_AI_COOLDOWN_SECONDS);
}

const STATUS_BAR_MODES: ReadonlySet<string> = new Set(['today-total', 'total-today', 'compact']);

/** 状态栏模式净化：非枚举值（手写配置漂移）回退默认 */
export function sanitizeStatusBarMode(val: unknown): StatusBarMode {
    if (isString(val) && STATUS_BAR_MODES.has(val)) return val as StatusBarMode;
    return DEFAULT_CONFIG.statusBarMode;
}

const LOCALES: ReadonlySet<string> = new Set(['auto', 'zh-CN', 'en']);

/** 语言净化：非枚举值（手写配置漂移）回退 auto */
export function sanitizeLocale(val: unknown): Locale {
    if (isString(val) && LOCALES.has(val)) return val as Locale;
    return DEFAULT_CONFIG.locale;
}

/** 字符串类型守卫（复用避免字面量 'string' 散布） */
function isString(val: unknown): val is string {
    return typeof val === 'string';
}

/** 校验并钳制周工作时长上限（小时），非法输入（非数字/NaN/Infinity/越界）自动纠偏到 [1, 168] */
export function sanitizeWeeklyLimitHours(val: unknown): number {
    let n: number;
    if (typeof val === 'number') {
        n = val;
    } else if (isString(val)) {
        n = parseInt(val, RADIX_DECIMAL);
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

/**
 * 架构契约模型：单日聚合沉淀（折叠层）(DailyTotal)
 * 不变量契约：该自然日内工时满足非负性 (totalMs >= 0) 与单调累加性；口径与 TimeAggregator 完全一致。
 */
export interface DailyTotal {
    /** 契约工时：该日累计时长毫秒数 (ms) */
    totalMs: number;
    /** 契约计数：该日独立会话数（会话归属其起始自然日） */
    sessionCount: number;
    /** 契约工时：该日手动编码累计时长 (ms) */
    manualMs?: number;
    /** 契约工时：该日 AI 辅助累计时长 (ms) */
    aiMs?: number;
    /** 契约工时：该日空闲离开累计总时长 (ms) */
    idleTotalMs?: number;
    /** 契约计数：该日空闲段总次数 */
    idleSessionCount?: number;
}

/** 架构契约：日桶表映射，key 必须为规范的本地日期格式 "YYYY-MM-DD" */
export type DailyTotalsMap = Record<string, DailyTotal>;

/**
 * 架构契约模型：原子物理时间切片 (TimeSlice)
 * 设计依据：用于 RingBuffer 内存缓冲与追加式 Journal 崩溃防护，保证原子提交。
 * 不变量契约：deltaMs 必须大于 0，timestamp 保持时间戳单调递增。
 */
export interface TimeSlice {
    /** 契约时间戳：时间片采样结束时间戳 (Date.now()) */
    timestamp: number;
    /** 契约时长：本片离散时长 (ms)，通常为 1000ms */
    deltaMs: number;
    /** 模式契约：时间片活动模式 */
    mode?: ActivityMode;
}

/**
 * 架构契约模型：系统离开/空闲段记录 (IdleSession)
 * 不变量契约：endMs >= startMs，且 durationMs === endMs - startMs。
 */
export interface IdleSession {
    /** 契约时间戳：空闲开始时间戳 */
    startMs: number;
    /** 契约时间戳：空闲结束时间戳 */
    endMs: number;
    /** 契约时长：空闲历时 (ms) */
    durationMs: number;
    /** 状态原因：空闲判定原因描述 */
    reason?: string;
}

/**
 * 架构契约模型：单次有效工作会话记录 (TimeSession)
 * 不变量契约：endMs >= startMs，durationMs === endMs - startMs，且 manualMs 与 aiMs 之和满足时长守恒律。
 */
export interface TimeSession {
    /** 契约时间戳：会话开始时间戳 (Date.now()) */
    startMs: number;
    /** 契约时间戳：会话结束时间戳 */
    endMs: number;
    /** 契约时长：本次会话总工时 (ms) */
    durationMs: number;
    /** 契约时长：手动编码工时 (ms) */
    manualMs?: number;
    /** 契约时长：AI 辅助工时 (ms) */
    aiMs?: number;
}

/**
 * 架构契约模型：工作区计时主数据结构 (WorkspaceTimingData SSOT)
 * 设计依据：单一真实源持久化载体，承载版本元数据、总工时与双层会话存储（原始明细层 + 沉淀日桶层）。
 * 不变量契约：totalMs 满足时间守恒律：等于原始会话历时与历史沉淀日桶工时之和。
 */
export interface WorkspaceTimingData {
    /** 持久化数据结构演进版本号（当前版本：LATEST_VERSION） */
    version: number;

    /** 累计总时长 (ms) */
    totalMs: number;

    /** 累计手动总时长 (ms) */
    manualTotalMs?: number;

    /** 累计 AI 总时长 (ms) */
    aiTotalMs?: number;

    /** 累计空闲离开总时长 (ms) */
    idleTotalMs?: number;

    /** 当前会话开始时间戳；0 表示无活跃会话 */
    currentSessionStartMs: number;

    /** 上次持久化时间戳 */
    lastSavedAtMs: number;

    /** 该工作区是否启用计时 */
    isEnabled: boolean;

    /** 历史会话列表 */
    sessions: TimeSession[];

    /** 空闲记录列表 */
    idleSessions?: readonly IdleSession[];

    /**
     * 日聚合沉淀层（数据存储格式版本 2 及以上）：超出原始保留窗的会话按日折叠于此。
     * 口径与 TimeAggregator 完全一致；缺省（数据存储格式版本 1 数据）表示尚未迁移。
     */
    dailyTotals?: DailyTotalsMap;

    /** 扩展元数据容器 — 供插件/第三方使用 */
    metadata?: TimingMetadata;
}

/** 扩展元数据结构 */
export interface TimingMetadata {
    lastJournalTs?: number | string;
    foldedSessionCount?: number;
    journalPlaybackCount?: number;
    [key: string]: unknown;
}

/** 创建一个空的 WorkspaceTimingData */
export function createEmptyTimingData(): WorkspaceTimingData {
    return {
        version: LATEST_VERSION,
        totalMs: 0,
        manualTotalMs: 0,
        aiTotalMs: 0,
        currentSessionStartMs: 0,
        lastSavedAtMs: 0,
        isEnabled: true,
        sessions: [],
        idleSessions: [],
        dailyTotals: {},
    };
}

/**
 * TimerEngine 对外暴露的只读数据视图：
 * sessions 与 idleSessions 冻结为只读数组（ReadonlyArray），越权突变在编译期报错；
 * 其余字段经 Readonly 浅冻结。内部可变副本仅 TimerEngine 私有持有。
 */
export type ReadonlyTimingData = Readonly<Omit<WorkspaceTimingData, 'sessions' | 'idleSessions'>> & {
    readonly sessions: readonly TimeSession[];
    readonly idleSessions?: readonly IdleSession[];
};

export type Locale = 'auto' | 'zh-CN' | 'en';

/** 状态栏显示模式（今日优先 / 累计优先 / 紧凑；点击状态栏循环切换） */
export type StatusBarMode = 'today-total' | 'total-today' | 'compact';

/** 插件配置模型 */
export interface TimingConfig {
    /** 工作区级启用开关 */
    enabled: boolean;
    /** 全局禁用开关 */
    globalDisabled: boolean;
    /** 界面语言：auto=跟随 VS Code 显示语言 */
    locale: Locale;
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
    /** 状态栏初始显示模式（点击状态栏循环切换并持久化） */
    statusBarMode: StatusBarMode;
    /** 历史会话保留上限（0 = 不限）。兜底安全值；常规治理走 rawRetentionDays 折叠 */
    maxSessions: number;
    /** 原始会话保留窗（天）：超窗会话按日折叠进 dailyTotals；0=不折叠（保留全量原始明细） */
    historyRawRetentionDays: number;
    /** 破坏性操作（重置/清除历史/还原）前自动写安全快照 */
    safetySnapshot: boolean;
    /** 周工作时长上限开关（默认不开启） */
    weeklyLimitEnabled: boolean;
    /** 周工作时长上限（小时，默认 40h） */
    weeklyLimitHours: number;
    /** 空闲超时分钟数（0 为关闭） */
    idleTimeoutMinutes: number;
    /** 是否启用 AI 活动检测 */
    aiDetectionEnabled: boolean;
    /** AI 检测冷却秒数 */
    aiCooldownSeconds: number;
}

/** 默认配置 */
export const DEFAULT_CONFIG: TimingConfig = {
    enabled: true,
    globalDisabled: false,
    locale: 'auto',
    historyRawRetentionDays: DEFAULT_RAW_RETENTION_DAYS,
    safetySnapshot: true,
    weeklyLimitEnabled: false,
    weeklyLimitHours: DEFAULT_WEEKLY_LIMIT_HOURS,
    statusBarEnabled: true,
    backupToFile: true,
    journalEnabled: true,
    ringBufferCapacity: DEFAULT_RING_BUFFER_CAP,
    journalFlushIntervalMs: DEFAULT_JOURNAL_FLUSH_MS,
    fullSaveIntervalMs: MS_PER_MINUTE,
    statusBarMode: 'today-total',
    maxSessions: DEFAULT_MAX_SESSIONS,
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    aiDetectionEnabled: DEFAULT_AI_DETECTION_ENABLED,
    aiCooldownSeconds: DEFAULT_AI_COOLDOWN_SECONDS,
};
