/**
 * dashboard-types — 面板数据共享类型
 *
 * 存放在 domain 层以确保所有上层（application、presentation）都能引用，
 * 不违反"上层可依赖下层"的单向依赖规则。
 */

/** 柱状图每日一条 */
export interface DailyChartEntry {
    /** 显示标签，如 "06-10" */
    label: string;
    /** 星期，如 "一" */
    weekday: string;
    /** 当日毫秒数 */
    totalMs: number;
}

/** 周报趋势一条（每周） */
export interface WeeklyTrendEntry {
    /** 周起始日期 YYYY-MM-DD（周一） */
    weekStart: string;
    /** 显示标签，如 "06-10" */
    label: string;
    /** 本周时长 (ms) */
    totalMs: number;
    /** 本周会话数 */
    sessionCount: number;
}

/** 单日会话明细（供面板展示） */
export interface DailyDetail {
    date: string;
    totalMs: number;
    sessionCount: number;
    sessions: Array<{ startLabel: string; endLabel: string; durationMs: number }>;
    peakHour: number;
    activeWindow: string;
    /** 按小时分布（跨小时会话按实际经过时间分摊） */
    hourly: Array<{ hour: number; totalMs: number; sessionCount: number }>;
}

/** 周报文字摘要 */
export interface WeeklySummary {
    totalMs: number;
    sessionCount: number;
    avgDailyMs: number;
    peakDate: string;
    peakDateMs: number;
    activeDays: number;
}

/** 热力图单个格子（活动时间线） */
export interface HeatmapDay {
    /** 完整日期 YYYY-MM-DD */
    dateStr: string;
    /** 星期索引：0=周一 … 6=周日 */
    weekday: number;
    /** 当日累计毫秒 */
    totalMs: number;
    /** 着色等级 0~4（0=无记录） */
    level: 0 | 1 | 2 | 3 | 4;
    /** 是否为未来日期（当前周尚未到达的天） */
    future: boolean;
}

/** 面板展示数据 */
export interface DashboardData {
    totalMs: number;
    todayMs: number;
    sessionsCount: number;
    /** 最近 7 天每日数据，用于柱状图 */
    dailyStats: DailyChartEntry[];
    /** 活动时间线热力图（近 12 周，按日） */
    heatmap: HeatmapDay[];
    /** 本周合计 (ms) */
    weekTotalMs: number;
    /** 周报多周趋势（近 4 周）★ */
    weeklyTrend: WeeklyTrendEntry[];
    /** 周报文字摘要 ★ */
    weeklySummary: WeeklySummary | null;
    /** 今日会话明细 ★ */
    todayDetail: DailyDetail | null;
    /** 跨工作区累计 ★ */
    globalTotalMs: number;
    /** 工作区数量 ★ */
    workspaceCount: number;
    /** 各工作区列表 ★ */
    workspaceList: Array<{ name: string; totalMs: number }>;
    isEnabled: boolean;
    globalDisabled: boolean;
    /** 界面语言（auto=跟随 VS Code 显示语言） */
    locale: 'auto' | 'zh-CN' | 'en';
    statusBarEnabled: boolean;
    journalEnabled: boolean;
    backupToFile: boolean;
    ringBufferCapacity: number;
    journalFlushIntervalMs: number;
    fullSaveIntervalMs: number;
    maxSessions: number;
}

/** 面板消息协议 */
export type DashboardMessage =
    | { type: 'updateConfig'; payload: Partial<DashboardData> }
    | { type: 'newPeriod' }
    | { type: 'reset' }
    | { type: 'clearHistory' }
    | { type: 'exportCSV' }
    | { type: 'exportAggregated' }
    | { type: 'exportReport'; payload: { kind: 'daily' | 'weekly' } }
    /** webview → 宿主：请求实时活跃曲线（最近 N 条时间片） */
    | { type: 'getActiveCurve' };

/** 实时活跃曲线数据（宿主 → webview 回推） */
export interface ActiveCurveData {
    /** 最近 N 条时间片（按时间升序，1 条 ≈ 1 秒） */
    slices: Array<{ t: number; ms: number }>;
}
