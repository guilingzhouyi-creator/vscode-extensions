/**
 * JsonExporter — 全量数据 JSON 导出
 *
 * 把面板/统计所需的全部数据（累计、目标、连续打卡、每日/每月明细、
 * 热力图、原始会话列表）序列化为 JSON，便于二次分析或迁移。
 */

import { DailyChartEntry, HeatmapDay } from '../../domain/dashboard-types';
import { TimeSession } from '../../domain/models';

export interface ExportBundle {
    workspaceName: string;
    exportedAt: string;
    totals: {
        todayMs: number;
        thisWeekMs: number;
        thisMonthMs: number;
        totalMs: number;
        globalTotalMs: number;
    };
    streak: number;
    goals: {
        dailyGoalMs: number;
        weeklyGoalMs: number;
    };
    dailyStats: DailyChartEntry[];
    monthDailyStats: DailyChartEntry[];
    heatmap: HeatmapDay[];
    sessions: TimeSession[];
}

export class JsonExporter {
    readonly formatName = 'json';

    exportBundle(bundle: ExportBundle): string {
        return JSON.stringify(bundle, null, 2);
    }
}
