"use strict";
/**
 * WeeklyReportExporter — 周报导出器（Markdown）
 *
 * 把「本周」汇总成一段可粘贴的周报：
 * 本周总时长 / 日均 / 达标天数 / 本周效率 / 每日明细（含达标）/ 与上周对比。
 * 口径与 TimeAggregator 一致（自然周，本地时区）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeeklyReportExporter = void 0;
const TimeAggregator_1 = require("../../domain/TimeAggregator");
class WeeklyReportExporter {
    constructor() {
        this.formatName = 'markdown';
    }
    generate(input) {
        if (!input.daily.length) {
            return '# 周报 · Workspace Timing\n\n（暂无计时数据）';
        }
        const fmt = TimeAggregator_1.TimeAggregator.formatDuration;
        const todayStr = (0, TimeAggregator_1.localDateStr)(input.generatedAt);
        const daily = input.daily;
        const monday = daily[0];
        const sunday = daily[daily.length - 1];
        // 本周至今天数（不含未来天）
        const elapsedDays = daily.filter(d => d.dateStr <= todayStr).length || 1;
        const avgPerDay = input.weekTotalMs / elapsedDays;
        // 达标天数（仅统计本周至今，且有目标时）
        const hasGoal = input.dailyGoalMs > 0;
        let goalDays = 0;
        if (hasGoal) {
            for (const d of daily) {
                if (d.dateStr > todayStr)
                    continue; // 未来天不计
                if (d.totalMs >= input.dailyGoalMs && d.totalMs > 0)
                    goalDays++;
            }
        }
        const lines = [];
        lines.push('# 周报 · Workspace Timing');
        lines.push(`周期：${monday.dateStr}（周一）~ ${sunday.dateStr}（周日）`);
        lines.push(`工作区：${input.workspaceName}`);
        lines.push(`生成时间：${(0, TimeAggregator_1.localDateStr)(input.generatedAt)} ${pad(input.generatedAt.getHours())}:${pad(input.generatedAt.getMinutes())}`);
        lines.push('');
        lines.push('## 概览');
        lines.push(`- 本周总时长：${fmt(input.weekTotalMs)}`);
        lines.push(`- 日均时长：${fmt(avgPerDay)}（按本周至今 ${elapsedDays} 天计）`);
        lines.push(`- 达标天数：${hasGoal ? `${goalDays} / ${elapsedDays}（目标 ${fmt(input.dailyGoalMs)}/天）` : '未设置目标'}`);
        lines.push(`- 本周效率：${this.effLine(input.weekEfficiency)}`);
        lines.push('');
        lines.push('## 每日明细');
        lines.push('| 日期 | 星期 | 时长 | 达标 |');
        lines.push('|------|------|------|------|');
        for (const d of daily) {
            const isFuture = d.dateStr > todayStr;
            const dur = isFuture ? '—' : fmt(d.totalMs);
            let goal = '—';
            if (hasGoal && !isFuture) {
                goal = (d.totalMs >= input.dailyGoalMs && d.totalMs > 0) ? '✓' : '✗';
            }
            lines.push(`| ${d.dateStr} | ${d.weekday} | ${dur} | ${goal} |`);
        }
        lines.push('');
        lines.push('## 与上周对比');
        if (input.lastWeekTotalMs > 0) {
            const delta = (input.weekTotalMs - input.lastWeekTotalMs) / input.lastWeekTotalMs;
            const sign = delta >= 0 ? '+' : '';
            lines.push(`- 上周总时长：${fmt(input.lastWeekTotalMs)}`);
            lines.push(`- 本周 vs 上周：${sign}${(delta * 100).toFixed(1)}%`);
        }
        else {
            lines.push('- 上周无数据（首次记录周）');
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
exports.WeeklyReportExporter = WeeklyReportExporter;
function pad(n) {
    return String(n).padStart(2, '0');
}
//# sourceMappingURL=WeeklyReportExporter.js.map