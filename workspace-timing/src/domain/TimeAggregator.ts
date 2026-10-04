/**
 * TimeAggregator — 时间聚合器统一门面（Facade）
 *
 * 职责：作为时间聚合领域的对外统一入口与聚合出口，聚合子领域模块：
 *   - date-utils: 本地时区日期解析、展开与切分
 *   - duration-formatter: 人类可读与紧凑时长排版
 *   - daily-aggregator: 日报统计、小时分布与会话裁剪
 *   - weekly-aggregator: 周报统计、多周趋势与全历史日报序列
 *   - heatmap-aggregator: 24 周活动热力图网格构建与聚合
 * 契约：对全库已有调用点 100% 保持签名向后兼容；满足实质承载预算（聚合 5 个子领域模块）。
 */
// 子模块重导出（保证既有消费端解构 import 无损兼容）
export {
    localDateStr,
    parseLocalDate,
    todayStr,
    weekStartStr,
    splitByNaturalDay,
    eachDaySegment,
} from './aggregator/date-utils';

export {
    formatDuration,
    formatDurationCompact,
    formatTime,
} from './aggregator/duration-formatter';

export type {
    DailyStats,
    DailySessionEntry,
    HourlyBucket,
    DailyDetail,
} from './aggregator/daily-aggregator';

export {
    todayMs,
    dailyStats,
    dailyDetail,
} from './aggregator/daily-aggregator';

export type {
    WeeklyStats,
    WeeklySummary,
} from './aggregator/weekly-aggregator';

export {
    weeklyStats,
    last7Days,
    fullDailySeries,
    weeklyTrend,
    weeklySummary,
} from './aggregator/weekly-aggregator';

export {
    heatmapDays,
    heatmapLevel,
} from './aggregator/heatmap-aggregator';

// 导入实现供门面静态类转发
import * as DateUtils from './aggregator/date-utils';
import * as DurationFormatter from './aggregator/duration-formatter';
import * as DailyAgg from './aggregator/daily-aggregator';
import * as WeeklyAgg from './aggregator/weekly-aggregator';
import * as HeatmapAgg from './aggregator/heatmap-aggregator';

/**
 * 时间聚合器统一门面对象（不可变冻结保障，聚合 5 个子领域纯函数模块）
 */
export const TimeAggregator = Object.freeze({
    /** 今天的本地日期字符串 (YYYY-MM-DD) */
    todayStr: DateUtils.todayStr,

    /** 将区间 [startMs, endMs) 按本地自然日切分为 TimeSession 片段 */
    splitByNaturalDay: DateUtils.splitByNaturalDay,

    /** 计算时间戳所在周的起始日（周一）本地日期字符串 */
    weekStartStr: DateUtils.weekStartStr,

    /** 展开自然日分段（内部辅助，保留访问以兼容旧单测/子系统） */
    eachDaySegment: DateUtils.eachDaySegment,

    /** 格式化毫秒为人类可读字符串 (如 "1h 1m 1s") */
    formatDuration: DurationFormatter.formatDuration,

    /** 紧凑格式时长 (如 "1h 1m") */
    formatDurationCompact: DurationFormatter.formatDurationCompact,

    /** 计算今日累计时长 (ms) */
    todayMs: DailyAgg.todayMs,

    /** 按日聚合会话列表 */
    dailyStats: DailyAgg.dailyStats,

    /** 获取指定日期的会话明细 */
    dailyDetail: DailyAgg.dailyDetail,

    /** 按周聚合会话列表 */
    weeklyStats: WeeklyAgg.weeklyStats,

    /** 最近 7 天每日统计 */
    last7Days: WeeklyAgg.last7Days,

    /** 全历史日报序列（聚合导出用） */
    fullDailySeries: WeeklyAgg.fullDailySeries,

    /** 近 N 周按周聚合趋势 */
    weeklyTrend: WeeklyAgg.weeklyTrend,

    /** 周报文字摘要 */
    weeklySummary: WeeklyAgg.weeklySummary,

    /** 活动时间线热力图 */
    heatmapDays: HeatmapAgg.heatmapDays,
});

export type TimeAggregator = typeof TimeAggregator;

