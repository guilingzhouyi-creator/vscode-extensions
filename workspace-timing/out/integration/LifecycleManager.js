"use strict";
/**
 * LifecycleManager — 生命周期事件管理
 *
 * 职责：监听 VS Code 窗口/焦点/关闭事件，转发到 Application 层
 * 边界：只做事件转发，不做业务逻辑
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleManager = void 0;
const Logger_1 = require("./Logger");
class LifecycleManager {
    constructor(orchestrator) {
        this.disposables = [];
        this.orchestrator = orchestrator;
    }
    /** 挂载所有事件监听 */
    start() {
        // 窗口焦点变化（预留：后续可作为可选策略）
        // 当前需求"窗口打开即计"，不依赖焦点
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'LifecycleManager: started');
    }
    /** 停止所有监听 */
    stop() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'LifecycleManager: stopped');
    }
    /** VS Code 关闭前的清理 */
    async onVSCodeClose() {
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'LifecycleManager: VS Code closing');
        await this.orchestrator.stop();
        this.stop();
    }
}
exports.LifecycleManager = LifecycleManager;
//# sourceMappingURL=LifecycleManager.js.map