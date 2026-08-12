"use strict";
/**
 * PeriodReportExporter — 周期报告导出器（周报 / 月报，Markdown）
 *
 * 把「本周」或「本月」汇总成可粘贴的报告，口径与 TimeAggregator 一致
 * （自然周/自然月，本地时区）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PeriodReportExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
class PeriodReportExporter {
    constructor() {
        this.formatName = 'markdown';
    }
    generate(input) {
        if (!input.daily.length) {
            return `# ${input.periodLabel}报 · Workspace Timing\n\n（暂无计时数据）`;
        }
        const fmt = TimeAggregator_1.TimeAggregator.formatDuration;
        const todayStr = (0, TimeAggregator_1.localDateStr)(input.generatedAt);
        const daily = input.daily;
        const first = daily[0];
        const last = daily[daily.length - 1];
        // 本周期至今天数（不含未来天）
        const elapsedDays = daily.filter(d => d.dateStr <= todayStr).length || 1;
        const avgPerDay = input.periodTotalMs / elapsedDays;
        const hasDailyGoal = input.dailyGoalMs > 0;
        let goalDays = 0;
        if (hasDailyGoal) {
            for (const d of daily) {
                if (d.dateStr > todayStr)
                    continue;
                if (d.totalMs >= input.dailyGoalMs && d.totalMs > 0)
                    goalDays++;
            }
        }
        const lines = [];
        lines.push(`# ${input.periodLabel}报 · Workspace Timing`);
        lines.push(`周期：${input.rangeLabel}`);
        lines.push(`工作区：${input.workspaceName}`);
        lines.push(`生成时间：${(0, TimeAggregator_1.localDateStr)(input.generatedAt)} ${pad(input.generatedAt.getHours())}:${pad(input.generatedAt.getMinutes())}`);
        lines.push('');
        lines.push('## 概览');
        lines.push(`- ${input.periodLabel}总时长：${fmt(input.periodTotalMs)}`);
        lines.push(`- 日均时长：${fmt(avgPerDay)}（按${input.periodLabel}至今 ${elapsedDays} 天计）`);
        lines.push(`- 达标天数：${hasDailyGoal ? `${goalDays} / ${elapsedDays}（目标 ${fmt(input.dailyGoalMs)}/天）` : '未设置目标'}`);
        if (input.periodGoalMs > 0) {
            const pct = input.periodTotalMs / input.periodGoalMs;
            lines.push(`- ${input.periodLabel}目标进度：${(pct * 100).toFixed(0)}%（${fmt(input.periodTotalMs)} / ${fmt(input.periodGoalMs)}）`);
        }
        lines.push(`- 本周期效率：${this.effLine(input.efficiency)}`);
        lines.push('');
        lines.push('## 每日明细');
        lines.push('| 日期 | 星期 | 时长 | 达标 |');
        lines.push('|------|------|------|------|');
        for (const d of daily) {
            const isFuture = d.dateStr > todayStr;
            const dur = isFuture ? '—' : fmt(d.totalMs);
            let goal = '—';
            if (hasDailyGoal && !isFuture) {
                goal = (d.totalMs >= input.dailyGoalMs && d.totalMs > 0) ? '✓' : '✗';
            }
            lines.push(`| ${d.dateStr} | ${d.weekday} | ${dur} | ${goal} |`);
        }
        lines.push('');
        lines.push(`## 与上一${input.periodLabel}对比`);
        if (input.lastPeriodTotalMs > 0) {
            const delta = (input.periodTotalMs - input.lastPeriodTotalMs) / input.lastPeriodTotalMs;
            const sign = delta >= 0 ? '+' : '';
            lines.push(`- 上一${input.periodLabel}总时长：${fmt(input.lastPeriodTotalMs)}`);
            lines.push(`- 本${input.periodLabel} vs 上一${input.periodLabel}：${sign}${(delta * 100).toFixed(1)}%`);
        }
        else {
            lines.push(`- 上一${input.periodLabel}无数据（首次记录）`);
        }
        lines.push('');
        return lines.join('\n');
    }
    effLine(eff) {
        if (eff === undefined)
            return '未启用效率统计';
        return `${(eff * 100).toFixed(0)}%（仅本次会话内编辑活跃度可信，历史天为 0%）`;
    }
}
exports.PeriodReportExporter = PeriodReportExporter;
function pad(n) {
    return String(n).padStart(2, '0');
}
//# sourceMappingURL=PeriodReportExporter.js.map