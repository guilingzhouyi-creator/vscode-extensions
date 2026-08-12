"use strict";
/**
 * ActivityTracker — 编辑活跃度追踪
 *
 * 职责：监听 onDidChangeTextDocument，统计每秒是否有编辑活动。
 *       心跳 (1s) 调用 tick() 消费累积标志，累加每日活跃秒数。
 * 边界：不持久化 — 仅会话内有效，重启归零。
 *
 * 效率 = 活跃时长 / 计时器时长
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
exports.ActivityTracker = void 0;
const vscode = __importStar(require("vscode"));
const models_1 = require("../domain/models");
const TimeAggregator_1 = require("../domain/TimeAggregator");
class ActivityTracker {
    constructor() {
        /** dateStr → 活跃秒数 */
        this.dailyActiveSeconds = new Map();
        this.changedSinceLastBeat = false;
        this.disposables = [];
    }
    /** 启动监听 */
    start() {
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(() => {
            this.changedSinceLastBeat = true;
        }));
    }
    /**
     * 心跳回调 — 每秒由 Scheduler 调用。
     * 消费 changedSinceLastBeat 标志，累加当日活跃秒数。
     */
    tick() {
        if (this.changedSinceLastBeat) {
            const today = (0, TimeAggregator_1.localDateStr)(new Date());
            const current = this.dailyActiveSeconds.get(today) ?? 0;
            this.dailyActiveSeconds.set(today, current + 1);
            this.changedSinceLastBeat = false;
        }
    }
    /** 获取指定日期的活跃时长 (ms) */
    getDailyActiveMs(dateStr) {
        return (this.dailyActiveSeconds.get(dateStr) ?? 0) * models_1.MS_PER_SECOND;
    }
    /** 获取最近 7 天的活跃快照（由外部填充 totalMs） */
    getSnapshot(dailyTotalMs) {
        const result = [];
        for (const [date, totalMs] of dailyTotalMs) {
            const activeMs = this.getDailyActiveMs(date);
            result.push({
                date,
                activeMs,
                totalMs,
                ratio: totalMs > 0 ? activeMs / totalMs : 0,
            });
        }
        return result;
    }
    /** 停止监听 */
    stop() {
        for (const d of this.disposables)
            d.dispose();
        this.disposables.length = 0;
    }
}
exports.ActivityTracker = ActivityTracker;
//# sourceMappingURL=ActivityTracker.js.map