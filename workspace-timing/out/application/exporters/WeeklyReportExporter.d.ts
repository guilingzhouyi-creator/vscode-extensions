/**
 * WeeklyReportExporter — 周报导出器（Markdown）
 *
 * 把「本周」汇总成一段可粘贴的周报：
 * 本周总时长 / 日均 / 达标天数 / 本周效率 / 每日明细（含达标）/ 与上周对比。
 * 口径与 TimeAggregator 一致（自然周，本地时区）。
 */
import { DailyChartEntry } from '../../domain/dashboard-types';
export interface WeeklyReportInput {
    workspaceName: string;
    /** 完整自然周每日明细（本周一 → 本周日，未来天时长为 0） */
    daily: DailyChartEntry[];
    weekTotalMs: number;
    dailyGoalMs: number;
    lastWeekTotalMs: number;
    /** 本周效率（0~1）。仅"本次会话内"编辑活跃度可信，历史天恒为 0% */
    weekEfficiency?: number;
    generatedAt: Date;
}
export declare class WeeklyReportExporter {
    readonly formatName = "markdown";
    generate(input: WeeklyReportInput): string;
    private effLine;
}
