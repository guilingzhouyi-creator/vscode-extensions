/**
 * Module: ReportExporter — Markdown 周期报表导出器
 * File Path: src/application/exporters/ReportExporter.ts
 * Architecture Role: Application layer report formatter producing structured Markdown documents
 * Dependencies & Triggers: domain/TimeAggregator.ts, domain/dashboard-types.ts, i18n subsystem; invoked by exporters facade
 * Responsibilities: Render daily and weekly timing summaries, session details, and multi-week trends into localized Markdown documents
 * Exit Semantics & Design Rationale: Pure presentation formatting with zero external disk I/O; integrates i18n dictionaries to ensure complete bilingual report generation
 */

import { TimeAggregator, type DailyDetail, type WeeklySummary } from '../../domain/TimeAggregator';
import { MINUTES_PER_HOUR } from '../../domain/models';
import type { WeeklyTrendEntry } from '../../domain/dashboard-types';
import { t, format } from '../../i18n/index';

const MARKDOWN_TREND_TABLE_SEPARATOR = '|-----------------------|------|--------|';
const PAD_ZERO = '0';
const PAD_LEN = 2;

export type ReportKind = 'daily' | 'weekly';

function formatReportTimestamp(): string {
    const nowDate = new Date();
    const utcIsoString = nowDate.toISOString();
    const timeZoneId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const offsetMinutes = -nowDate.getTimezoneOffset();
    const signPrefix = offsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(offsetMinutes);
    const hoursStr = String(Math.floor(absMinutes / MINUTES_PER_HOUR)).padStart(PAD_LEN, PAD_ZERO);
    const minutesStr = String(absMinutes % MINUTES_PER_HOUR).padStart(PAD_LEN, PAD_ZERO);
    return `${nowDate.toLocaleString()} (UTC${signPrefix}${hoursStr}:${minutesStr}, ${timeZoneId}) | UTC: ${utcIsoString}`;
}

export class ReportExporter {
    /** 生成日报 Markdown */
    static buildDailyReport(detail: DailyDetail): string {
        const i18nDict = t();
        const reportLines: string[] = [];
        reportLines.push(`# ${format(i18nDict['report.daily.title'], detail.date)}`);
        reportLines.push('');
        reportLines.push(`- **${i18nDict['report.daily.todayDuration']}**：${TimeAggregator.formatDuration(detail.totalMs)}`);
        reportLines.push(`- **${i18nDict['report.daily.sessionCount']}**：${detail.sessionCount}`);
        if (detail.activeWindow) {
            reportLines.push(`- **${i18nDict['report.daily.activeWindow']}**：${detail.activeWindow}`);
        }
        reportLines.push('');

        // 会话明细表
        if (detail.sessions.length > 0) {
            reportLines.push(`## ${i18nDict['report.table.sessions']}`);
            reportLines.push('');
            reportLines.push(`| ${i18nDict['report.table.start']} | ${i18nDict['report.table.end']} | ${i18nDict['report.table.duration']} |`);
            reportLines.push('|------|------|------|');
            for (const sessionEntry of detail.sessions) {
                reportLines.push(
                    `| ${sessionEntry.startLabel} | ${sessionEntry.endLabel} | ${TimeAggregator.formatDuration(sessionEntry.durationMs)} |`,
                );
            }
            reportLines.push('');
        }

        reportLines.push(`*${format(i18nDict['report.generatedAt'], formatReportTimestamp())}*`);
        return reportLines.join('\n');
    }

    /** 生成周报 Markdown */
    static buildWeeklyReport(
        summary: WeeklySummary,
        trend: WeeklyTrendEntry[],
        dailyStats: { label: string; weekday: string; totalMs: number }[],
    ): string {
        const i18nDict = t();
        const reportLines: string[] = [];
        reportLines.push(`# ${format(i18nDict['report.weekly.title'], summary.weekStart)}`);
        reportLines.push('');
        reportLines.push(`## ${i18nDict['report.weekly.summary']}`);
        reportLines.push('');
        reportLines.push(`- **${i18nDict['report.weekly.totalDuration']}**：${TimeAggregator.formatDuration(summary.totalMs)}`);
        reportLines.push(`- **${i18nDict['report.weekly.avgDaily']}**：${TimeAggregator.formatDuration(summary.avgDailyMs)}`);
        reportLines.push(`- **${i18nDict['report.weekly.activeDays']}**：${format(i18nDict['report.weekly.activeDaysFmt'], summary.activeDays)}`);
        reportLines.push(`- **${i18nDict['report.weekly.peakDate']}**：${summary.peakDate}（${TimeAggregator.formatDuration(summary.peakDateMs)}）`);
        reportLines.push(`- **${i18nDict['report.weekly.sessionCount']}**：${summary.sessionCount}`);
        reportLines.push('');

        // 每日分布
        if (dailyStats.length > 0) {
            reportLines.push(`## ${i18nDict['report.weekly.distribution']}`);
            reportLines.push('');
            reportLines.push(`| ${i18nDict['report.table.date']} | ${i18nDict['report.table.weekday']} | ${i18nDict['report.table.duration']} |`);
            reportLines.push('|------|------|------|');
            for (const dayStat of dailyStats) {
                const weekdayDisplay = /^[一二三四五六日]$/.test(dayStat.weekday) ? `周${dayStat.weekday}` : dayStat.weekday;
                reportLines.push(`| ${dayStat.label} | ${weekdayDisplay} | ${TimeAggregator.formatDuration(dayStat.totalMs)} |`);
            }
            reportLines.push('');
        }

        // 多周趋势
        if (trend.length > 0) {
            reportLines.push(`## ${i18nDict['report.weekly.trend']}`);
            reportLines.push('');
            reportLines.push(`| ${i18nDict['report.table.weekRange']} | ${i18nDict['report.table.duration']} | ${i18nDict['report.table.sessionCount']} |`);
            reportLines.push(MARKDOWN_TREND_TABLE_SEPARATOR);
            for (const trendEntry of trend) {
                const rangeLabel = trendEntry.weekEnd ? `${trendEntry.weekStart} ~ ${trendEntry.weekEnd}` : trendEntry.weekStart;
                reportLines.push(
                    `| ${rangeLabel} | ${TimeAggregator.formatDuration(trendEntry.totalMs)} | ${trendEntry.sessionCount} |`,
                );
            }
            reportLines.push('');
        }

        reportLines.push(`*${format(i18nDict['report.generatedAt'], formatReportTimestamp())}*`);
        return reportLines.join('\n');
    }
}
