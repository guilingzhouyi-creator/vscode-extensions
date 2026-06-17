"use strict";
/**
 * WorkspaceStateProvider — 主存储提供者
 *
 * 通过 VS Code 的 workspaceState 进行存储。
 * 优点是自动按工作区隔离、无需额外文件、读写快速。
 * 缺点是数据不直观可见。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceStateProvider = void 0;
const Logger_1 = require("../integration/Logger");
const STORAGE_KEY = 'workspaceTiming:data';
class WorkspaceStateProvider {
    constructor(context) {
        this.id = 'workspace-state';
        this._available = true;
        this.context = context;
    }
    isAvailable() {
        return this._available;
    }
    async load() {
        try {
            const raw = this.context.workspaceState.get(STORAGE_KEY);
            if (!raw)
                return null;
            const data = JSON.parse(raw);
            // 基本校验
            if (typeof data.totalMs !== 'number' || typeof data.version !== 'number') {
                (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'WorkspaceStateProvider: invalid data format, ignoring');
                return null;
            }
            return data;
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'WorkspaceStateProvider: load failed', err);
            this._available = false;
            return null;
        }
    }
    async save(data) {
        try {
            const raw = JSON.stringify(data);
            await this.context.workspaceState.update(STORAGE_KEY, raw);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceStateProvider: save failed', err);
            throw err;
        }
    }
    async delete() {
        try {
            await this.context.workspaceState.update(STORAGE_KEY, undefined);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'WorkspaceStateProvider: delete failed', err);
            throw err;
        }
    }
}
exports.WorkspaceStateProvider = WorkspaceStateProvider;
//# sourceMappingURL=WorkspaceStateProvider.js.map