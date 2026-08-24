"use strict";
/**
 * ReportExporter — Markdown 报告导出器
 *
 * 将日报 / 周报导出为 Markdown 文本报告，便于提交周会或留档。
 * 复用 TimeAggregator 的领域统计方法，仅做格式化输出。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
class ReportExporter {
    /** 生成日报 Markdown */
    static buildDailyReport(detail) {
        const lines = [];
        lines.push(`# 📅 日报 · ${detail.date}`);
        lines.push('');
        lines.push(`- **当日时长**：${TimeAggregator_1.TimeAggregator.formatDuration(detail.totalMs)}`);
        lines.push(`- **会话数**：${detail.sessionCount}`);
        if (detail.activeWindow) {
            lines.push(`- **活跃时段**：${detail.activeWindow}`);
        }
        lines.push('');
        // 会话明细表
        if (detail.sessions.length > 0) {
            lines.push('## 会话明细');
            lines.push('');
            lines.push('| 开始 | 结束 | 时长 |');
            lines.push('|------|------|------|');
            for (const s of detail.sessions) {
                lines.push(`| ${s.startLabel} | ${s.endLabel} | ${TimeAggregator_1.TimeAggregator.formatDuration(s.durationMs)} |`);
            }
            lines.push('');
        }
        lines.push(`*生成时间：${new Date().toLocaleString()}*`);
        return lines.join('\n');
    }
    /** 生成周报 Markdown */
    static buildWeeklyReport(summary, trend, dailyStats) {
        const lines = [];
        lines.push(`# 📊 周报 · 第 ${summary.weekStart} 周`);
        lines.push('');
        lines.push('## 本周摘要');
        lines.push('');
        lines.push(`- **本周总时长**：${TimeAggregator_1.TimeAggregator.formatDuration(summary.totalMs)}`);
        lines.push(`- **日均时长**：${TimeAggregator_1.TimeAggregator.formatDuration(summary.avgDailyMs)}`);
        lines.push(`- **活跃天数**：${summary.activeDays} 天`);
        lines.push(`- **最活跃日期**：${summary.peakDate}（${TimeAggregator_1.TimeAggregator.formatDuration(summary.peakDateMs)}）`);
        lines.push(`- **本周会话数**：${summary.sessionCount}`);
        lines.push('');
        // 每日分布
        if (dailyStats.length > 0) {
            lines.push('## 每日分布');
            lines.push('');
            lines.push('| 日期 | 星期 | 时长 |');
            lines.push('|------|------|------|');
            for (const d of dailyStats) {
                lines.push(`| ${d.label} | 周${d.weekday} | ${TimeAggregator_1.TimeAggregator.formatDuration(d.totalMs)} |`);
            }
            lines.push('');
        }
        // 多周趋势
        if (trend.length > 0) {
            lines.push('## 多周趋势');
            lines.push('');
            lines.push('| 周起始 | 时长 | 会话数 |');
            lines.push('|--------|------|--------|');
            for (const w of trend) {
                lines.push(`| ${w.weekStart} | ${TimeAggregator_1.TimeAggregator.formatDuration(w.totalMs)} | ${w.sessionCount} |`);
            }
            lines.push('');
        }
        lines.push(`*生成时间：${new Date().toLocaleString()}*`);
        return lines.join('\n');
    }
}
exports.ReportExporter = ReportExporter;
//# sourceMappingURL=ReportExporter.js.map