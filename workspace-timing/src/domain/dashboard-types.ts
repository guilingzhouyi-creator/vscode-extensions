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

/** 面板展示数据 */
export interface DashboardData {
    totalMs: number;
    todayMs: number;
    sessionsCount: number;
    /** 最近 7 天每日数据，用于柱状图 */
    dailyStats: DailyChartEntry[];
    /** 本周合计 (ms) */
    weekTotalMs: number;
    /** 跨工作区累计 ★ */
    globalTotalMs: number;
    /** 工作区数量 ★ */
    workspaceCount: number;
    /** 各工作区列表 ★ */
    workspaceList: Array<{ name: string; totalMs: number }>;
    isEnabled: boolean;
    globalDisabled: boolean;
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
    | { type: 'exportCSV' };
