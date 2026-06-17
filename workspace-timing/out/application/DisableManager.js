"use strict";
/**
 * DisableManager — 禁用策略控制
 *
 * 职责：全局开关 + 工作区开关 + 优先级仲裁
 * 规则：全局禁用时无视工作区设置；全局启用时以工作区设置为准
 * 边界：不关心计时逻辑，只回答"当前是否应该计时"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisableManager = void 0;
const models_1 = require("../domain/models");
const Logger_1 = require("../integration/Logger");
class DisableManager {
    constructor(config) {
        this._onChange = null;
        this._config = { ...models_1.DEFAULT_CONFIG, ...config };
    }
    /** 获取当前配置快照 */
    get config() {
        return this._config;
    }
    /** 更新配置 */
    updateConfig(partial) {
        const before = this.resolveState();
        this._config = { ...this._config, ...partial };
        const after = this.resolveState();
        if (before !== after) {
            (0, Logger_1.log)(Logger_1.LogLevel.Info, `DisableManager: state changed ${before} → ${after}`);
            this._onChange?.(after);
        }
    }
    /** 注册状态变更回调 */
    onChange(cb) {
        this._onChange = cb;
    }
    /** 全局禁用判定 */
    isGloballyDisabled() {
        return this._config.globalDisabled;
    }
    /** 工作区禁用判定 */
    isWorkspaceDisabled() {
        return !this._config.enabled;
    }
    /** 综合判定：是否应该计时 */
    shouldCount() {
        if (this._config.globalDisabled)
            return false;
        return this._config.enabled;
    }
    /** 解析当前禁用状态 */
    resolveState() {
        if (this._config.globalDisabled)
            return 'globally-disabled';
        if (!this._config.enabled)
            return 'workspace-disabled';
        return 'enabled';
    }
    /** 重置为默认配置 */
    reset() {
        this._config = { ...models_1.DEFAULT_CONFIG };
    }
}
exports.DisableManager = DisableManager;
//# sourceMappingURL=DisableManager.js.map