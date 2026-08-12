/**
 * PeriodReportExporter — 周期报告导出器（周报 / 月报，Markdown）
 *
 * 把「本周」或「本月」汇总成可粘贴的报告，口径与 TimeAggregator 一致
 * （自然周/自然月，本地时区）。
 */
import { DailyChartEntry } from '../../domain/dashboard-types';
export type PeriodKind = 'week' | 'month';
export interface PeriodReportInput {
    workspaceName: string;
    /** 'week' | 'month' */
    kind: PeriodKind;
    /** 周期中文标签，如 "本周" / "本月" */
    periodLabel: string;
    /** 区间文案，如 "2026-08-01 ~ 2026-08-12" */
    rangeLabel: string;
    /** 完整自然周期每日明细 */
    daily: DailyChartEntry[];
    /** 周期总时长 (ms) */
    periodTotalMs: number;
    /** 上一周期总时长 (ms)，用于对比 */
    lastPeriodTotalMs: number;
    /** 每日目标 (ms) */
    dailyGoalMs: number;
    /** 周期目标 (ms)（周报用 weeklyGoalMs，月报为 0） */
    periodGoalMs: number;
    /** 本周期效率（0~1），仅"本次会话内"编辑活跃度可信 */
    efficiency?: number;
    generatedAt: Date;
}
export declare class PeriodReportExporter {
    readonly formatName = "markdown";
    generate(input: PeriodReportInput): string;
    private effLine;
}
