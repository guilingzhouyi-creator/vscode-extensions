"use strict";
/**
 * GlobalAggregator — 跨工作区累计同步服务
 *
 * 职责：在每次 fullSave 后将当前工作区的计时数据同步到 globalState。
 * 实现跨工作区时长汇总。
 *
 * 调用方：TimerOrchestrator.saveCheckpoint() 结束后触发
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
exports.GlobalAggregator = void 0;
const vscode = __importStar(require("vscode"));
const global_types_1 = require("../domain/global-types");
const Logger_1 = require("../integration/Logger");
class GlobalAggregator {
    constructor(storage) {
        this._cached = null;
        this.storage = storage;
    }
    /**
     * 将当前工作区的计时同步到全局存储
     * 由 TimerOrchestrator.saveCheckpoint() 结束后调用
     */
    async sync(localTotalMs) {
        if (!this.storage.isAvailable())
            return;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceRoot)
            return;
        const wsId = (0, global_types_1.normalizeWorkspaceId)(workspaceRoot.uri.toString());
        const wsName = workspaceRoot.name;
        try {
            const global = await this.storage.load();
            // 更新/添加当前工作区记录
            global.workspaces[wsId] = {
                name: wsName,
                uri: workspaceRoot.uri.toString(),
                totalMs: localTotalMs,
                lastSyncedAt: Date.now(),
            };
            // 重新计算总和
            global.totalMs = Object.values(global.workspaces).reduce((sum, w) => sum + w.totalMs, 0);
            await this.storage.save(global);
            this._cached = global;
            (0, Logger_1.log)(Logger_1.LogLevel.Debug, `GlobalAggregator: synced (workspace=${wsName}, totalMs=${localTotalMs}, global=${global.totalMs})`);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'GlobalAggregator: sync failed', err);
        }
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
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'GlobalAggregator: reset');
    }
}
exports.GlobalAggregator = GlobalAggregator;
//# sourceMappingURL=GlobalAggregator.js.map