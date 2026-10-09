/**
 * Module: DisableManager — 计时启用/禁用策略仲裁器
 * File Path: src/application/DisableManager.ts
 * Architecture Role: Application layer policy arbiter for timing execution eligibility
 * Dependencies & Triggers: domain/models.ts; managed by TimerOrchestrator and mutated via ConfigWatcher or VS Code commands
 * Responsibilities: Maintain timing switch state; arbitrate hierarchical precedence between global kill-switch and workspace-level enable flag
 * Exit Semantics & Design Rationale: Deterministic priority rule (globalDisabled strictly overrides workspace enabled); provides atomic state snapshots with zero I/O side effects
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
