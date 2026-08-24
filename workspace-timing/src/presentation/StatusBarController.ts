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

import * as vscode from 'vscode';
import { TimeAggregator } from '../domain/TimeAggregator';
import { LogLevel, log } from '../integration/Logger';
import { t } from '../i18n/index';

export type StatusBarMode = 'today-total' | 'total-today' | 'compact';

const MODE_LABELS: Record<StatusBarMode, string> = {
    'today-total': '今日优先',
    'total-today': '累计优先',
    'compact': '紧凑',
};

const MODE_CYCLE: StatusBarMode[] = ['today-total', 'total-today', 'compact'];

export interface StatusBarConfig {
    enabled: boolean;
}

export class StatusBarController {
    private readonly statusBarItem: vscode.StatusBarItem;
    private _enabled: boolean = true;
    private _mode: StatusBarMode = 'today-total';
    private _todayMs: number = 0;
    private _totalMs: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100,
        );
        this.statusBarItem.command = 'workspaceTiming.showStatus';
        this.statusBarItem.tooltip = t()['statusBar.tooltip'];
    }

    /** 更新配置 */
    updateConfig(config: Partial<StatusBarConfig>): void {
        if (config.enabled !== undefined) this._enabled = config.enabled;
        this.refresh();
    }

    /** 更新计时数据并刷新显示 */
    updateTime(todayMs: number, totalMs: number): void {
        this._todayMs = todayMs;
        this._totalMs = totalMs;
        this.refresh();
    }

    /** 刷新状态栏显示 */
    private refresh(): void {
        if (!this._enabled) {
            this.statusBarItem.hide();
            return;
        }

        let text: string;
        switch (this._mode) {
            case 'today-total':
                text = TimeAggregator.formatDual(this._todayMs, this._totalMs);
                break;
            case 'total-today':
                text = `累计 ${TimeAggregator.formatDurationCompact(this._totalMs)} · 今日 ${TimeAggregator.formatDurationCompact(this._todayMs)}`;
                break;
            case 'compact':
                text = TimeAggregator.formatDurationCompact(this._todayMs);
                break;
        }

        this.statusBarItem.text = `$(watch) ${text}`;
        this.statusBarItem.tooltip = `${t()['statusBar.tooltip']}（${MODE_LABELS[this._mode]}）`;
        this.statusBarItem.show();
    }

    /** 循环切换显示模式 */
    cycleMode(): StatusBarMode {
        const idx = MODE_CYCLE.indexOf(this._mode);
        this._mode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
        this.refresh();
        log(LogLevel.Debug, `StatusBarController: mode switched to ${this._mode}`);
        return this._mode;
    }

    /** 初始化显示 */
    show(): void {
        this.refresh();
    }

    /** 隐藏状态栏 */
    hide(): void {
        this.statusBarItem.hide();
    }

    /** 获取当前模式 */
    get mode(): StatusBarMode {
        return this._mode;
    }

    /** 释放资源 */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}
