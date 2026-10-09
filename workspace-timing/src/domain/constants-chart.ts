/**
 * Module: Domain Constants — Visualization and Charts (图表与可视化常量)
 * File Path: src/domain/constants-chart.ts
 * Architecture Role: 领域模型层可视化布局与度量常数单源定义，向展示层与聚合器提供无副作用的几何尺度与时间跨度基准。
 * Dependencies & Triggers: 纯无依赖常量定义模块；被 DateUtils、HeatmapAggregator、WeeklyAggregator 与仪表盘视图消费。
 * Responsibilities: 统一定义热力图窗口跨度、自然周换算系数、趋势图回溯周期及日期切片偏移基准。
 * Exit Semantics & Design Rationale: 模块仅包含只读常量声明，编译期内联优化，运行时无副作用；变更需与图表前端网格对齐。
 */

/** 一周天数 */
export const DAYS_PER_WEEK = 7;

/** 一天小时数 */
export const HOURS_PER_DAY = 24;

/** 周日相对偏移量（用于星期转换） */
export const DAYS_TO_SUNDAY = 6;

/** 活动热力图默认回溯周数（半年视图，铺满全宽卡片） */
export const DEFAULT_HEATMAP_WEEKS = 24;

/** 活动热力图默认总格子数 */
export const DEFAULT_HEATMAP_DAYS = DEFAULT_HEATMAP_WEEKS * DAYS_PER_WEEK;

/** 周趋势图默认统计周数 */
export const DEFAULT_TREND_WEEKS = 4;

/** 图表百分比上限基准 (100%) */
export const PERCENT_FULL = 100;

/** YYYY-MM-DD 紧凑月日切片起始偏移量 (取 "MM-DD") */
export const ISO_DATE_MD_START = 5;
