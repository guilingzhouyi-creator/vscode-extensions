/**
 * Module: Domain Constants — Visualization and Charts
 * File Path: src/domain/constants-chart.ts
 * Architecture Role: Single source of truth for dashboard layout, chart dimensions and heatmap thresholds.
 */

/** 一周天数 */
export const DAYS_PER_WEEK = 7;

/** 一天小时数 */
export const HOURS_PER_DAY = 24;

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
