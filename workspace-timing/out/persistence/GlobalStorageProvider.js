"use strict";
/**
 * GlobalStorageProvider — 全局存储提供者
 *
 * 通过 VS Code 的 ExtensionContext.globalState 实现跨工作区数据共享。
 * 用于跨工作区累计时长汇总。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GlobalStorageProvider = void 0;
const global_types_1 = require("../domain/global-types");
const Logger_1 = require("../integration/Logger");
const STORAGE_KEY = 'workspaceTiming:global';
class GlobalStorageProvider {
    constructor(context) {
        this._available = true;
        this.context = context;
    }
    isAvailable() {
        return this._available;
    }
    /** 读取全局数据 */
    async load() {
        try {
            const raw = this.context.globalState.get(STORAGE_KEY);
            if (!raw)
                return (0, global_types_1.createEmptyGlobalData)();
            const data = JSON.parse(raw);
            if (typeof data.version !== 'number') {
                return (0, global_types_1.createEmptyGlobalData)();
            }
            return data;
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'GlobalStorage: load failed', err);
            this._available = false;
            return (0, global_types_1.createEmptyGlobalData)();
        }
    }
    /** 写入全局数据 */
    async save(data) {
        try {
            data.lastUpdatedAt = Date.now();
            const raw = JSON.stringify(data);
            await this.context.globalState.update(STORAGE_KEY, raw);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'GlobalStorage: save failed', err);
            throw err;
        }
    }
    /** 清空全局数据 */
    async delete() {
        try {
            await this.context.globalState.update(STORAGE_KEY, undefined);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'GlobalStorage: delete failed', err);
        }
    }
}
exports.GlobalStorageProvider = GlobalStorageProvider;
//# sourceMappingURL=GlobalStorageProvider.js.map