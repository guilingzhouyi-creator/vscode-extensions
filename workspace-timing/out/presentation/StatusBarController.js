"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarController = void 0;
const vscode = __importStar(require("vscode"));
const TimeAggregator_1 = require("../domain/TimeAggregator");
const Logger_1 = require("../integration/Logger");
const index_1 = require("../i18n/index");
const MODE_LABELS = {
    'today-total': '今日优先',
    'total-today': '累计优先',
    'compact': '紧凑',
};
const MODE_CYCLE = ['today-total', 'total-today', 'compact'];
class StatusBarController {
    constructor() {
        this._enabled = true;
        this._mode = 'today-total';
        this._todayMs = 0;
        this._totalMs = 0;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'workspaceTiming.showStatus';
        this.statusBarItem.tooltip = (0, index_1.t)()['statusBar.tooltip'];
    }
    /** 更新配置 */
    updateConfig(config) {
        if (config.enabled !== undefined)
            this._enabled = config.enabled;
        this.refresh();
    }
    /** 更新计时数据并刷新显示 */
    updateTime(todayMs, totalMs) {
        this._todayMs = todayMs;
        this._totalMs = totalMs;
        this.refresh();
    }
    /** 刷新状态栏显示 */
    refresh() {
        if (!this._enabled) {
            this.statusBarItem.hide();
            return;
        }
        let text;
        switch (this._mode) {
            case 'today-total':
                text = TimeAggregator_1.TimeAggregator.formatDual(this._todayMs, this._totalMs);
                break;
            case 'total-today':
                text = `累计 ${TimeAggregator_1.TimeAggregator.formatDurationCompact(this._totalMs)} · 今日 ${TimeAggregator_1.TimeAggregator.formatDurationCompact(this._todayMs)}`;
                break;
            case 'compact':
                text = TimeAggregator_1.TimeAggregator.formatDurationCompact(this._todayMs);
                break;
        }
        this.statusBarItem.text = `$(watch) ${text}`;
        this.statusBarItem.tooltip = `${(0, index_1.t)()['statusBar.tooltip']}（${MODE_LABELS[this._mode]}）`;
        this.statusBarItem.show();
    }
    /** 循环切换显示模式 */
    cycleMode() {
        const idx = MODE_CYCLE.indexOf(this._mode);
        this._mode = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
        this.refresh();
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `StatusBarController: mode switched to ${this._mode}`);
        return this._mode;
    }
    /** 初始化显示 */
    show() {
        this.refresh();
    }
    /** 隐藏状态栏 */
    hide() {
        this.statusBarItem.hide();
    }
    /** 获取当前模式 */
    get mode() {
        return this._mode;
    }
    /** 释放资源 */
    dispose() {
        this.statusBarItem.dispose();
    }
}
exports.StatusBarController = StatusBarController;
//# sourceMappingURL=StatusBarController.js.map