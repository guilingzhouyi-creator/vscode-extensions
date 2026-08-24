/**
 * StatusBarController — 状态栏渲染
 *
 * 三种显示模式，点击循环切换：
 *   1. today-total  → "今日 30m · 累计 2h"
 *   2. total-today  → "累计 2h · 今日 30m"
 *   3. compact      → "30m"（仅今日）
 *
 * 边界：不关心计时逻辑，只负责显示
 */
export type StatusBarMode = 'today-total' | 'total-today' | 'compact';
export interface StatusBarConfig {
    enabled: boolean;
}
export declare class StatusBarController {
    private readonly statusBarItem;
    private _enabled;
    private _mode;
    private _todayMs;
    private _totalMs;
    constructor();
    /** 更新配置 */
    updateConfig(config: Partial<StatusBarConfig>): void;
    /** 更新计时数据并刷新显示 */
    updateTime(todayMs: number, totalMs: number): void;
    /** 刷新状态栏显示 */
    private refresh;
    /** 循环切换显示模式 */
    cycleMode(): StatusBarMode;
    /** 初始化显示 */
    show(): void;
    /** 隐藏状态栏 */
    hide(): void;
    /** 获取当前模式 */
    get mode(): StatusBarMode;
    /** 释放资源 */
    dispose(): void;
}
