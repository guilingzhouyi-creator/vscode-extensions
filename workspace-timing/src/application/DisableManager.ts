/**
 * DisableManager — 禁用策略控制
 *
 * 职责：全局开关 + 工作区开关 + 优先级仲裁
 * 规则：全局禁用时无视工作区设置；全局启用时以工作区设置为准
 * 边界：不关心计时逻辑，只回答"当前是否应该计时"
 */

import { TimingConfig, DEFAULT_CONFIG } from '../domain/models';

export type DisableState = 'enabled' | 'workspace-disabled' | 'globally-disabled';

export class DisableManager {
    private _config: TimingConfig;

    constructor(config?: Partial<TimingConfig>) {
        this._config = { ...DEFAULT_CONFIG, ...config };
    }

    /** 获取当前配置快照 */
    get config(): Readonly<TimingConfig> {
        return this._config;
    }

    /** 更新配置 */
    updateConfig(partial: Partial<TimingConfig>): void {
        this._config = { ...this._config, ...partial };
    }

    /** 全局禁用判定 */
    isGloballyDisabled(): boolean {
        return this._config.globalDisabled;
    }

    /** 工作区禁用判定 */
    isWorkspaceDisabled(): boolean {
        return !this._config.enabled;
    }

    /** 综合判定：是否应该计时 */
    shouldCount(): boolean {
        if (this._config.globalDisabled) return false;
        return this._config.enabled;
    }

    /** 解析当前禁用状态 */
    resolveState(): DisableState {
        if (this._config.globalDisabled) return 'globally-disabled';
        if (!this._config.enabled) return 'workspace-disabled';
        return 'enabled';
    }

    /** 重置为默认配置 */
    reset(): void {
        this._config = { ...DEFAULT_CONFIG };
    }
}
