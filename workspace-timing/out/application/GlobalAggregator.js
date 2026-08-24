"use strict";
/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 边界：不直接依赖 VS Code API —— 工作区信息由构造函数注入
 *       （workspaceInfo 解析器），因此可脱离 VS Code 做纯 Node 单测。
 *
 * 调用方：Scheduler 周期全量存盘回调（onFullSaved）、TimerOrchestrator.saveNow()/newPeriod()
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalAggregator = void 0;
const Logger_1 = require("../integration/Logger");
class GlobalAggregator {
    constructor(storage, workspaceInfo) {
        this._cached = null;
        /** sync 进行中标志（防重入：并发 load→modify→save 会互相覆盖丢失写入） */
        this._syncing = false;
        /**
         * 上次已成功同步的本工作区 totalMs；相等则跳过整轮读→改→写。
         * ★ 在 doSync 成功后才记账：失败不更新，下轮 checkpoint 会重试（避免旧值卡死跳过）。
         */
        this._lastSyncedTotalMs = null;
        this.storage = storage;
        this.workspaceInfo = workspaceInfo;
    }
    /**
     * 将当前工作区的计时同步到全局存储
     * 由 Scheduler 周期全量存盘回调与 TimerOrchestrator.saveNow() 调用
     */
    async sync(localTotalMs) {
        if (this._syncing)
            return; // 上一轮尚未完成，跳过本轮（下轮 checkpoint 会再同步）
        if (this._lastSyncedTotalMs === localTotalMs)
            return; // 未变化，跳过整轮读写
        this._syncing = true;
        try {
            // ★ 仅在真正写成功后才记账：doSync 内部吞掉的失败返回 false，
            //   守卫保持旧值，下轮 checkpoint 会用同值重试（否则会永久卡住不回填）。
            if (await this.doSync(localTotalMs)) {
                this._lastSyncedTotalMs = localTotalMs;
            }
        }
        finally {
            this._syncing = false;
        }
    }
    /** 执行一轮同步；返回是否成功（无可做之事/失败均返回 false，由调用方决定是否记账） */
    async doSync(localTotalMs) {
        if (!this.storage.isAvailable())
            return false;
        const info = this.workspaceInfo();
        if (!info)
            return false;
        try {
            const global = await this.storage.load();
            // 回收陈旧条目：长期未同步的工作区（缺 lastSyncedAt 视为最陈旧）不再计入。
            // 当前工作区条目随后会被刷新，不受影响。
            const now = Date.now();
            const pruned = [];
            for (const [id, w] of Object.entries(global.workspaces)) {
                if (now - (w.lastSyncedAt ?? 0) > GlobalAggregator.STALE_TTL_MS) {
                    delete global.workspaces[id];
                    pruned.push(`${w.name}(${Math.round((w.totalMs ?? 0) / 3600000)}h)`);
                }
            }
            if (pruned.length > 0) {
                (0, Logger_1.log)(Logger_1.LogLevel.Info, `GlobalAggregator: pruned ${pruned.length} stale workspace entr(y/ies): ${pruned.join(', ')}`);
            }
            // 更新/添加当前工作区记录
            global.workspaces[info.id] = {
                name: info.name,
                uri: info.uri,
                totalMs: localTotalMs,
                lastSyncedAt: Date.now(),
            };
            // 重新计算总和
            global.totalMs = Object.values(global.workspaces).reduce((sum, w) => sum + w.totalMs, 0);
            await this.storage.save(global);
            this._cached = global;
            (0, Logger_1.log)(Logger_1.LogLevel.Debug, `GlobalAggregator: synced (workspace=${info.name}, totalMs=${localTotalMs}, global=${global.totalMs})`);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'GlobalAggregator: sync failed', err);
            return false;
        }
        return true;
    }
    /** 获取全局快照 */
    async snapshot() {
        const global = this._cached ?? await this.storage.load();
        this._cached = global;
        return {
            totalMs: global.totalMs,
            workspaceCount: Object.keys(global.workspaces).length,
            workspaces: Object.values(global.workspaces)
                .map(w => ({ name: w.name, totalMs: w.totalMs }))
                .sort((a, b) => b.totalMs - a.totalMs),
        };
    }
    /** 清空全局数据 */
    async reset() {
        await this.storage.delete();
        this._cached = null;
        this._lastSyncedTotalMs = null;
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'GlobalAggregator: reset');
    }
}
exports.GlobalAggregator = GlobalAggregator;
/**
 * 陈旧条目回收阈值：超过该天数未同步的工作区不再计入跨工作区累计。
 * 背景：globalState 跨版本持久共享，历史遗留的失联工作区（已删除/改道的项目、
 * 旧双计数 bug 时代的膨胀值）会永远计入总和，导致"跨工作区累计"虚高失真。
 */
GlobalAggregator.STALE_TTL_MS = 30 * 24 * 3600_000;
//# sourceMappingURL=GlobalAggregator.js.map