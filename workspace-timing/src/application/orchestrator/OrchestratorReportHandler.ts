/**
 * OrchestratorReportHandler — 计时总控器报表与数据导出处理器
 *
 * 职责：从 TimerOrchestrator 解耦的独立报表导出服务，承载 CSV 与 Markdown 格式的工时数据构建；
 * 契约：各导出方法执行工作区名称防卫清洗与规范化回退，所有导出操作记录日志审计。
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
     * 导出当前工作区计时数据为 CSV 字符串。
     *
     * @param data - 当前计时器只读数据视图
     * @param targetWorkspace - 目标工作区名称（若为空则回退为默认名）
     * @returns 格式化后的 CSV 文本
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
     *
     * @param data - 当前计时器只读数据视图
     * @param targetWorkspace - 目标工作区名称
     * @returns 聚合日报 CSV 文本
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
     * 导出日报 / 周报为 Markdown 文本。
     *
     * @param data - 当前计时器只读数据视图
     * @param kind - 报表类型（'daily' 或 'weekly'）
     * @param locale - 语言环境（'zh-CN' 或 'en'）
     * @returns 格式化后的 Markdown 报表文本
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
