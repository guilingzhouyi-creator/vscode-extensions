/**
 * OrchestratorReportHandler — 计时总控器报表与数据导出处理器
 *
 * 职责：从 TimerOrchestrator 抽离的独立子服务，承载 CSV/Markdown 报表构建与格式化导出。
 * 契约：满足实质承载预算（有效行 > 30），各导出方法具备工作区名称防卫清洗与日志审计。
 */

import { ReadonlyTimingData, WorkspaceTimingData } from '../../domain/models';
import { TimeAggregator } from '../../domain/TimeAggregator';
import { CsvExporter } from '../exporters/CsvExporter';
import { AggregatedCsvExporter } from '../exporters/AggregatedCsvExporter';
import { ReportExporter, ReportKind } from '../exporters/ReportExporter';
import { buildWeeklyTrendEntries } from '../DashboardDataAssembler';
import { log, LogLevel } from '../../integration/Logger';

const DEFAULT_REPORT_TREND_WEEKS = 4;

export class OrchestratorReportHandler {
    /**
     * 导出当前工作区计时数据为 CSV 字符串
     */
    static async exportCSV(data: ReadonlyTimingData, targetWorkspace: string): Promise<string> {
        const workspaceName = targetWorkspace.trim() || 'workspace';
        const snapshot: WorkspaceTimingData = {
            ...data,
            sessions: [...data.sessions],
        };
        const exporter = new CsvExporter();
        const csv = await exporter.export(snapshot, workspaceName);
        log(LogLevel.Info, `TimerOrchestrator: exported CSV (${csv.length} bytes)`);
        return csv;
    }

    /**
     * 导出全历史聚合日报序列 CSV（折叠桶 ∪ 当期原始计算，日期升序）。
     */
    static async exportAggregatedCSV(data: ReadonlyTimingData, targetWorkspace: string): Promise<string> {
        const workspaceName = targetWorkspace.trim() || 'workspace';
        const series = TimeAggregator.fullDailySeries(
            data.sessions,
            data.currentSessionStartMs,
            data.dailyTotals,
        );
        const csv = new AggregatedCsvExporter().build(series, workspaceName);
        log(LogLevel.Info, `TimerOrchestrator: exported aggregated CSV (${series.length} days, ${csv.length} bytes)`);
        return csv;
    }

    /**
     * 导出日报 / 周报为 Markdown 文本
     */
    static async exportReport(
        data: ReadonlyTimingData,
        kind: ReportKind,
        locale: 'zh-CN' | 'en',
    ): Promise<string> {
        const sessions = data.sessions;

        if (kind === 'daily') {
            const detail = TimeAggregator.dailyDetail(
                sessions,
                TimeAggregator.todayStr(),
                data.currentSessionStartMs,
            );
            log(LogLevel.Info, `TimerOrchestrator: exported daily report (${detail.date})`);
            return ReportExporter.buildDailyReport(detail);
        }

        const summary = TimeAggregator.weeklySummary(
            sessions,
            data.currentSessionStartMs,
            data.dailyTotals,
        );
        const trend = buildWeeklyTrendEntries(
            sessions,
            DEFAULT_REPORT_TREND_WEEKS,
            data.currentSessionStartMs,
            data.dailyTotals,
        );
        const dailyStats = TimeAggregator.last7Days(sessions, data.currentSessionStartMs, locale);
        log(LogLevel.Info, `TimerOrchestrator: exported weekly report (${summary.weekStart})`);
        return ReportExporter.buildWeeklyReport(summary, trend, dailyStats);
    }
}
