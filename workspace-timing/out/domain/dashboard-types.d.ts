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
    /** 完整日期，如 "2026-06-10" */
    dateStr: string;
    /** 星期，如 "一" */
    weekday: string;
    /** 当日毫秒数 */
    totalMs: number;
    /** 活跃编辑时长 (ms) — ActivityTracker 提供 */
    activeMs?: number;
    /** 闲置时长 (ms) — IdleDetector 提供 */
    idleMs?: number;
    /** 效率比 (0-1) — activeMs / (totalMs - idleMs) */
    efficiency?: number;
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
    /** 本月合计 (ms) */
    monthTotalMs: number;
    /** 本周效率 (0-1) */
    weekEfficiency?: number;
    /** 跨工作区累计 */
    globalTotalMs: number;
    /** 工作区数量 */
    workspaceCount: number;
    /** 各工作区列表 */
    workspaceList: Array<{
        name: string;
        totalMs: number;
    }>;
    isEnabled: boolean;
    globalDisabled: boolean;
    statusBarEnabled: boolean;
    journalEnabled: boolean;
    backupToFile: boolean;
    ringBufferCapacity: number;
    journalFlushIntervalMs: number;
    fullSaveIntervalMs: number;
    maxSessions: number;
    /** 效率追踪开关 */
    efficiencyEnabled: boolean;
    /** 每日目标 (ms) */
    dailyGoalMs: number;
    /** 每周目标 (ms) */
    weeklyGoalMs: number;
    /** 连续打卡天数（每日目标达成连续计数） */
    streak: number;
    /** 状态栏点击行为 */
    statusBarClickAction: 'cycle' | 'dashboard';
}
/** 面板消息协议 */
export type DashboardMessage = {
    type: 'updateConfig';
    payload: Partial<DashboardData>;
} | {
    type: 'newPeriod';
} | {
    type: 'reset';
} | {
    type: 'exportCSV';
} | {
    type: 'exportWeeklyReport';
} | {
    type: 'exportMonthlyReport';
} | {
    type: 'exportJson';
} | {
    type: 'exportDiagnostic';
} | {
    type: 'langToggle';
};
