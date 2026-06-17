/**
 * DisableManager — 禁用策略控制
 *
 * 职责：全局开关 + 工作区开关 + 优先级仲裁
 * 规则：全局禁用时无视工作区设置；全局启用时以工作区设置为准
 * 边界：不关心计时逻辑，只回答"当前是否应该计时"
 */
import { TimingConfig } from '../domain/models';
export type DisableState = 'enabled' | 'workspace-disabled' | 'globally-disabled';
export declare class DisableManager {
    private _config;
    private _onChange;
    constructor(config?: Partial<TimingConfig>);
    /** 获取当前配置快照 */
    get config(): Readonly<TimingConfig>;
    /** 更新配置 */
    updateConfig(partial: Partial<TimingConfig>): void;
    /** 注册状态变更回调 */
    onChange(cb: (state: DisableState) => void): void;
    /** 全局禁用判定 */
    isGloballyDisabled(): boolean;
    /** 工作区禁用判定 */
    isWorkspaceDisabled(): boolean;
    /** 综合判定：是否应该计时 */
    shouldCount(): boolean;
    /** 解析当前禁用状态 */
    resolveState(): DisableState;
    /** 重置为默认配置 */
    reset(): void;
}
