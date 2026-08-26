/**
 * ReportExporter — Markdown 报告生成器单测（支持中英双语输出）
 *
 * 验证：日报/周报的 Markdown 结构、表格渲染、中英文词条自适应。
 * 依赖 out/ 编译产物，先 npm run compile。
 */
'use strict';

const assert = require('assert');
const { ReportExporter } = require('../../out/application/exporters/ReportExporter.js');
const { setLocale, init } = require('../../out/i18n/index.js');

describe('ReportExporter（Markdown 报表导出器）', () => {
    const mockDaily = {
        date: '2026-08-26',
        totalMs: 7200000,
        sessionCount: 2,
        sessions: [
            { startLabel: '09:00', endLabel: '10:00', durationMs: 3600000 },
            { startLabel: '14:00', endLabel: '15:00', durationMs: 3600000 },
        ],
        hourly: [],
        peakHour: 9,
        activeWindow: '09:00-10:00',
    };

    const mockWeeklySummary = {
        weekStart: '2026-08-24',
        totalMs: 14400000,
        sessionCount: 4,
        avgDailyMs: 7200000,
        peakDate: '2026-08-26',
        peakDateMs: 7200000,
        activeDays: 2,
    };

    const mockWeeklyTrend = [
        { weekStart: '2026-08-24', totalMs: 14400000, sessionCount: 4 },
        { weekStart: '2026-08-17', totalMs: 10800000, sessionCount: 3 },
    ];

    const mockDailyStatsZh = [
        { label: '08-25', weekday: '二', totalMs: 7200000 },
        { label: '08-26', weekday: '三', totalMs: 7200000 },
    ];

    const mockDailyStatsEn = [
        { label: '08-25', weekday: 'Tue', totalMs: 7200000 },
        { label: '08-26', weekday: 'Wed', totalMs: 7200000 },
    ];

    it('buildDailyReport：中文环境下生成标准中文日报 Markdown', () => {
        setLocale('zh-CN');
        const md = ReportExporter.buildDailyReport(mockDaily);

        assert.ok(md.includes('# 📅 日报 · 2026-08-26'), '含中文标题');
        assert.ok(md.includes('- **当日时长**：2h 0m 0s') || md.includes('- **当日时长**：2h'), '含当日时长');
        assert.ok(md.includes('- **会话数**：2'), '含会话数');
        assert.ok(md.includes('- **活跃时段**：09:00-10:00'), '含活跃时段');
        assert.ok(md.includes('## 会话明细'), '含会话明细');
        assert.ok(md.includes('| 开始 | 结束 | 时长 |'), '含中文表头');
        assert.ok(md.includes('| 09:00 | 10:00 |'), '含会话行');
    });

    it('buildDailyReport：英文环境下生成标准英文日报 Markdown', () => {
        setLocale('en');
        const md = ReportExporter.buildDailyReport(mockDaily);

        assert.ok(md.includes('# 📅 Daily Report · 2026-08-26'), '含英文标题');
        assert.ok(md.includes("- **Today's Duration**："), '含英文时长标签');
        assert.ok(md.includes('- **Session Count**：2'), '含英文会话数');
        assert.ok(md.includes('- **Active Window**：09:00-10:00'), '含英文活跃时段');
        assert.ok(md.includes('## Session Details'), '含英文明细标题');
        assert.ok(md.includes('| Start | End | Duration |'), '含英文表头');
    });

    it('buildWeeklyReport：中文环境下生成标准中文周报 Markdown', () => {
        setLocale('zh-CN');
        const md = ReportExporter.buildWeeklyReport(mockWeeklySummary, mockWeeklyTrend, mockDailyStatsZh);

        assert.ok(md.includes('# 📊 周报 · 第 2026-08-24 周'), '含中文周报标题');
        assert.ok(md.includes('## 本周摘要'), '含本周摘要');
        assert.ok(md.includes('- **本周总时长**：'), '含总时长');
        assert.ok(md.includes('- **活跃天数**：2 天'), '含天数格式化');
        assert.ok(md.includes('## 每日分布'), '含每日分布');
        assert.ok(md.includes('| 08-25 | 周二 |'), '星期带周前缀');
        assert.ok(md.includes('## 多周趋势'), '含多周趋势');
        assert.ok(md.includes('| 周起始 | 时长 | 会话数 |'), '含多周趋势表头');
    });

    it('buildWeeklyReport：英文环境下生成标准英文周报 Markdown', () => {
        setLocale('en');
        const md = ReportExporter.buildWeeklyReport(mockWeeklySummary, mockWeeklyTrend, mockDailyStatsEn);

        assert.ok(md.includes('# 📊 Weekly Report · Week of 2026-08-24'), '含英文周报标题');
        assert.ok(md.includes('## Weekly Summary'), '含英文周报摘要');
        assert.ok(md.includes('- **Total Duration**：'), '含英文总时长');
        assert.ok(md.includes('- **Active Days**：2 days'), '含英文活跃天数');
        assert.ok(md.includes('## Daily Distribution'), '含英文每日分布');
        assert.ok(md.includes('| 08-25 | Tue |'), '英文星期正常呈现');
        assert.ok(md.includes('## Multi-Week Trend'), '含英文多周趋势');
        assert.ok(md.includes('| Week Start | Duration | Sessions |'), '含英文多周趋势表头');
    });
});
