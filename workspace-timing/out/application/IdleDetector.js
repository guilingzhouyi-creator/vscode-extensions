"use strict";
/**
 * IdleDetector — 闲置检测器
 *
 * 职责：判定用户是否离开 / 非活跃，输出每日闲置时长供效率计算。
 * 效率公式：实际打字 / (总时长 - 闲置时长)
 *
 * ★ 修复（0.3.2）：
 *   - 原实现中 lastActivityMs 被写入但从未读取（死代码），且闲置仅在
 *     「失焦 → 重新聚焦且超时」时才被判定，聚焦但长时间不操作（阅读、思考）
 *     不会被计入闲置，导致效率比虚高。
 *   - 现改为每秒心跳驱动的判定：聚焦态下距上次编辑活动超过阈值即判定为闲置
 *     （回溯到最后一次活动时刻起算），并在出现新活动时结束；失焦态沿用
 *     「失焦超时回溯」逻辑。两种路径口径一致，闲置统计更真实。
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
exports.IdleDetector = void 0;
const vscode = __importStar(require("vscode"));
class IdleDetector {
    constructor(timeoutMs = 5 * 60 * 1000) {
        /** 累计闲置时长 (ms) — 按日统计 */
        this.dailyIdleMs = new Map();
        /** 当前闲置段开始时间（回溯到非活跃起点），0 = 未闲置 */
        this.idleStartMs = 0;
        /** 失焦时刻，用于失焦态的超时判定；聚焦时为 0 */
        this.focusLostAt = 0;
        /** 最后一次编辑 / 聚焦活动时刻 */
        this.lastActivityMs = 0;
        /** 当前窗口是否聚焦 */
        this.focused = true;
        this.disposables = [];
        this.timeoutMs = timeoutMs;
    }
    /** 启动监听 */
    start() {
        this.focused = true;
        this.lastActivityMs = Date.now();
        // 窗口焦点
        this.disposables.push(vscode.window.onDidChangeWindowState((e) => {
            if (e.focused) {
                this.onFocusGained();
            }
            else {
                this.onFocusLost();
            }
        }));
        // 编辑活动（重置空闲计时 / 结束进行中的闲置）
        this.disposables.push(vscode.workspace.onDidChangeTextDocument(() => {
            this.lastActivityMs = Date.now();
            if (this.idleStartMs > 0) {
                this.endIdlePeriod();
            }
        }));
    }
    /**
     * 心跳回调 — 每秒由 Scheduler 调用。
     * 依据最近活动时刻与聚焦状态判定闲置，使其对「聚焦但不操作」也生效。
     */
    tick() {
        const now = Date.now();
        // 已处于闲置：出现新活动则结束
        if (this.idleStartMs > 0) {
            if (this.lastActivityMs > this.idleStartMs) {
                this.endIdlePeriod();
            }
            return;
        }
        // 未闲置：判断是否已超过阈值进入闲置
        const ref = this.focused ? this.lastActivityMs : (this.focusLostAt || this.lastActivityMs);
        if (now - ref >= this.timeoutMs) {
            this.startIdlePeriod(ref);
        }
    }
    /** 获取指定日期的闲置时长 (ms) */
    getDailyIdleMs(dateStr) {
        return this.dailyIdleMs.get(dateStr) ?? 0;
    }
    /** 当前是否处于闲置状态 */
    get isIdle() {
        return this.idleStartMs > 0;
    }
    /** 停止监听 */
    stop() {
        if (this.idleStartMs > 0) {
            this.endIdlePeriod();
        }
        for (const d of this.disposables)
            d.dispose();
        this.disposables.length = 0;
    }
    onFocusLost() {
        this.focused = false;
        this.focusLostAt = Date.now();
    }
    onFocusGained() {
        this.focused = true;
        this.focusLostAt = 0;
        // 重新聚焦视为一次活动，避免「刚回窗口」立刻被判闲置
        this.lastActivityMs = Date.now();
    }
    startIdlePeriod(fromMs) {
        // 闲置起点回溯到非活跃开始的时刻，而非当前时刻
        this.idleStartMs = fromMs;
    }
    endIdlePeriod() {
        if (this.idleStartMs === 0)
            return;
        const idleMs = Date.now() - this.idleStartMs;
        this.idleStartMs = 0;
        if (idleMs <= 0)
            return;
        const today = this.todayStr();
        this.dailyIdleMs.set(today, (this.dailyIdleMs.get(today) ?? 0) + idleMs);
    }
    todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}
exports.IdleDetector = IdleDetector;
//# sourceMappingURL=IdleDetector.js.map