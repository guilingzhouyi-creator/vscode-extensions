/**
 * ReportExporter — Markdown 报告导出器
 *
 * 将日报 / 周报导出为 Markdown 文本报告，便于提交周会或留档。
 * 复用 TimeAggregator 的领域统计方法，仅做格式化输出。
 */
import { DailyDetail, WeeklySummary } from '../../domain/TimeAggregator';
import { WeeklyTrendEntry } from '../../domain/dashboard-types';
export type ReportKind = 'daily' | 'weekly';
export declare class ReportExporter {
    /** 生成日报 Markdown */
    static buildDailyReport(detail: DailyDetail): string;
    /** 生成周报 Markdown */
    static buildWeeklyReport(summary: WeeklySummary, trend: WeeklyTrendEntry[], dailyStats: {
        label: string;
        weekday: string;
        totalMs: number;
    }[]): string;
}
