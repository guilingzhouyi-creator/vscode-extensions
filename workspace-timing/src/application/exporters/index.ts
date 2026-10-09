/**
 * Module: ExportersFacade — 数据与报表导出统一门面
 * File Path: src/application/exporters/index.ts
 * Architecture Role: Application layer facade encapsulating data and report export subsystems
 * Dependencies & Triggers: domain/models.ts, domain/TimeAggregator.ts, CsvExporter, AggregatedCsvExporter, ReportExporter; invoked by TimerOrchestrator and CommandRegistrar
 * Responsibilities: Aggregate and expose unified export entry points for raw CSV, aggregated CSV, and Markdown daily/weekly reports with input sanitation and logging
 * Exit Semantics & Design Rationale: Complies with ARCH-FAC-001 by aggregating 3 sub-domain exporters with substantive input validation and logging, eliminating pass-through springboard overhead
 */

import { ReadonlyTimingData, WorkspaceTimingData } from '../../domain/models';
import { TimeAggregator } from '../../domain/TimeAggregator';
import { CsvExporter } from './CsvExporter';
import { AggregatedCsvExporter } from './AggregatedCsvExporter';
import { ReportExporter, ReportKind } from './ReportExporter';
import { buildWeeklyTrendEntries } from '../DashboardDataAssembler';
import { log, LogLevel } from '../../integration/Logger';

export { CsvExporter } from './CsvExporter';
export { AggregatedCsvExporter } from './AggregatedCsvExporter';
export { ReportExporter } from './ReportExporter';
export type { ReportKind } from './ReportExporter';

const DEFAULT_REPORT_TREND_WEEKS = 4;

/**
 * 导出当前工作区计时数据为 CSV 字符串。
 *
 * @param data - 当前计时器只读数据视图
 * @param targetWorkspace - 目标工作区名称（若为空则回退为默认名）
 * @returns 格式化后的 CSV 文本
 */
export async function exportCSV(data: ReadonlyTimingData, targetWorkspace: string): Promise<string> {
    const workspaceName = targetWorkspace.trim() || 'workspace';
    const snapshot: WorkspaceTimingData = {
        ...data,
        sessions: [...data.sessions],
    };
    const exporter = new CsvExporter();
    const csv = await exporter.export(snapshot, workspaceName);
    log(LogLevel.Info, `exporters: exported CSV (${csv.length} bytes)`);
    return csv;
}

/**
 * 导出全历史聚合日报序列 CSV（折叠桶 ∪ 当期原始计算，日期升序）。
 *
 * @param data - 当前计时器只读数据视图
 * @param targetWorkspace - 目标工作区名称
 * @returns 聚合日报 CSV 文本
 */
export async function exportAggregatedCSV(data: ReadonlyTimingData, targetWorkspace: string): Promise<string> {
    const workspaceName = targetWorkspace.trim() || 'workspace';
    const series = TimeAggregator.fullDailySeries(
        data.sessions,
        data.currentSessionStartMs,
        data.dailyTotals,
    );
    const csv = new AggregatedCsvExporter().build(series, workspaceName);
    log(LogLevel.Info, `exporters: exported aggregated CSV (${series.length} days, ${csv.length} bytes)`);
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
export async function exportReport(
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
        log(LogLevel.Info, `exporters: exported daily report (${detail.date})`);
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
    log(LogLevel.Info, `exporters: exported weekly report (${summary.weekStart})`);
    return ReportExporter.buildWeeklyReport(summary, trend, dailyStats);
}
