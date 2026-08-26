/**
 * ReportExporter — Markdown 报告导出器
 *
 * 将日报 / 周报导出为 Markdown 文本报告，便于提交周会或留档。
 * 复用 TimeAggregator 的领域统计方法，并结合 i18n 词条实现多语言 Markdown 输出。
 */

import { TimeAggregator, DailyDetail, WeeklySummary } from '../../domain/TimeAggregator';
import { WeeklyTrendEntry } from '../../domain/dashboard-types';
import { t, format } from '../../i18n/index';

export type ReportKind = 'daily' | 'weekly';

export class ReportExporter {
    /** 生成日报 Markdown */
    static buildDailyReport(detail: DailyDetail): string {
        const dict = t();
        const lines: string[] = [];
        lines.push(`# ${format(dict['report.daily.title'], detail.date)}`);
        lines.push('');
        lines.push(`- **${dict['report.daily.todayDuration']}**：${TimeAggregator.formatDuration(detail.totalMs)}`);
        lines.push(`- **${dict['report.daily.sessionCount']}**：${detail.sessionCount}`);
        if (detail.activeWindow) {
            lines.push(`- **${dict['report.daily.activeWindow']}**：${detail.activeWindow}`);
        }
        lines.push('');

        // 会话明细表
        if (detail.sessions.length > 0) {
            lines.push(`## ${dict['report.table.sessions']}`);
            lines.push('');
            lines.push(`| ${dict['report.table.start']} | ${dict['report.table.end']} | ${dict['report.table.duration']} |`);
            lines.push('|------|------|------|');
            for (const s of detail.sessions) {
                lines.push(
                    `| ${s.startLabel} | ${s.endLabel} | ${TimeAggregator.formatDuration(s.durationMs)} |`,
                );
            }
            lines.push('');
        }

        lines.push(`*${format(dict['report.generatedAt'], new Date().toLocaleString())}*`);
        return lines.join('\n');
    }

    /** 生成周报 Markdown */
    static buildWeeklyReport(
        summary: WeeklySummary,
        trend: WeeklyTrendEntry[],
        dailyStats: { label: string; weekday: string; totalMs: number }[],
    ): string {
        const dict = t();
        const lines: string[] = [];
        lines.push(`# ${format(dict['report.weekly.title'], summary.weekStart)}`);
        lines.push('');
        lines.push(`## ${dict['report.weekly.summary']}`);
        lines.push('');
        lines.push(`- **${dict['report.weekly.totalDuration']}**：${TimeAggregator.formatDuration(summary.totalMs)}`);
        lines.push(`- **${dict['report.weekly.avgDaily']}**：${TimeAggregator.formatDuration(summary.avgDailyMs)}`);
        lines.push(`- **${dict['report.weekly.activeDays']}**：${format(dict['report.weekly.activeDaysFmt'], summary.activeDays)}`);
        lines.push(`- **${dict['report.weekly.peakDate']}**：${summary.peakDate}（${TimeAggregator.formatDuration(summary.peakDateMs)}）`);
        lines.push(`- **${dict['report.weekly.sessionCount']}**：${summary.sessionCount}`);
        lines.push('');

        // 每日分布
        if (dailyStats.length > 0) {
            lines.push(`## ${dict['report.weekly.distribution']}`);
            lines.push('');
            lines.push(`| ${dict['report.table.date']} | ${dict['report.table.weekday']} | ${dict['report.table.duration']} |`);
            lines.push('|------|------|------|');
            for (const d of dailyStats) {
                const weekdayDisplay = /^[一二三四五六日]$/.test(d.weekday) ? `周${d.weekday}` : d.weekday;
                lines.push(`| ${d.label} | ${weekdayDisplay} | ${TimeAggregator.formatDuration(d.totalMs)} |`);
            }
            lines.push('');
        }

        // 多周趋势
        if (trend.length > 0) {
            lines.push(`## ${dict['report.weekly.trend']}`);
            lines.push('');
            lines.push(`| ${dict['report.table.weekStart']} | ${dict['report.table.duration']} | ${dict['report.table.sessionCount']} |`);
            lines.push('|--------|------|--------|');
            for (const w of trend) {
                lines.push(
                    `| ${w.weekStart} | ${TimeAggregator.formatDuration(w.totalMs)} | ${w.sessionCount} |`,
                );
            }
            lines.push('');
        }

        lines.push(`*${format(dict['report.generatedAt'], new Date().toLocaleString())}*`);
        return lines.join('\n');
    }
}
