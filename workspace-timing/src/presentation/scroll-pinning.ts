/**
 * Module: ScrollPinning — 流式视口 150ms 冷却图钉控制器与吸附状态机
 * File Path: src/presentation/scroll-pinning.ts
 * Architecture Role: Presentation layer viewport scroll-anchor and intention cooldown controller
 * Dependencies & Triggers: DOM Scroll/Wheel/Touch events; applied to session lists, streaming logs, and real-time detail views
 * Responsibilities: Maintain 40px bottom-pinning invariant; enforce 150ms user input cooldown window; manage 120px quick-access floating capsule visibility; execute instantaneous zero-jitter alignment (behavior: "auto") during high-frequency streaming
 * Exit Semantics & Design Rationale: State machine arbitrating viewport dominance between automated streaming and human physical inputs; guarantees human priority while preventing layout reflow jitter
 */

export interface ScrollContainerLike {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    scrollTo?(options: { top: number; behavior?: 'auto' | 'smooth' }): void;
    addEventListener?(type: string, listener: (event: unknown) => void, options?: unknown): void;
    removeEventListener?(type: string, listener: (event: unknown) => void, options?: unknown): void;
}

export interface ScrollPinningOptions {
    /** 宿主滚动容器抽象 */
    container: ScrollContainerLike;
    /** 底部吸附容差门限（单位：像素，默认 40px） */
    pinTolerance?: number;
    /** 快速直达悬浮微胶囊触发门限（单位：像素，默认 120px） */
    capsuleThreshold?: number;
    /** 用户主动输入冷却锁定窗口（单位：毫秒，默认 150ms） */
    userInputCooldownMs?: number;
    /** 微胶囊可视状态变更监听器 */
    onCapsuleVisibilityChange?: (visible: boolean) => void;
    /** 图钉吸附状态变更监听器 */
    onPinnedStateChange?: (pinned: boolean) => void;
}

import {
    DEFAULT_PIN_TOLERANCE_PX,
    DEFAULT_CAPSULE_THRESHOLD_PX,
    DEFAULT_VIEWPORT_COOLDOWN_MS,
} from '../domain/models';

export class ScrollPinningController {
    public static readonly DEFAULT_PIN_TOLERANCE = DEFAULT_PIN_TOLERANCE_PX;
    public static readonly DEFAULT_CAPSULE_THRESHOLD = DEFAULT_CAPSULE_THRESHOLD_PX;
    public static readonly DEFAULT_COOLDOWN_MS = DEFAULT_VIEWPORT_COOLDOWN_MS;

    private readonly container: ScrollContainerLike;
    private readonly pinTolerance: number;
    private readonly capsuleThreshold: number;
    private readonly cooldownMs: number;
    private readonly onCapsuleVisibilityChange?: (visible: boolean) => void;
    private readonly onPinnedStateChange?: (pinned: boolean) => void;

    private isPinned: boolean = true;
    private isCapsuleVisible: boolean = false;
    private lastUserInputAt: number = 0;
    private isDisposed: boolean = false;

    private readonly boundOnScroll: (e: unknown) => void;
    private readonly boundOnUserInput: (e: unknown) => void;

    constructor(options: ScrollPinningOptions) {
        this.container = options.container;
        this.pinTolerance = options.pinTolerance ?? ScrollPinningController.DEFAULT_PIN_TOLERANCE;
        this.capsuleThreshold = options.capsuleThreshold ?? ScrollPinningController.DEFAULT_CAPSULE_THRESHOLD;
        this.cooldownMs = options.userInputCooldownMs ?? ScrollPinningController.DEFAULT_COOLDOWN_MS;
        this.onCapsuleVisibilityChange = options.onCapsuleVisibilityChange;
        this.onPinnedStateChange = options.onPinnedStateChange;

        this.boundOnScroll = () => this.handleContainerScroll();
        this.boundOnUserInput = () => this.recordUserInput();

        this.bindEvents();
        this.evaluateState(false);
    }

    /** 视口当前是否处于底部锁定图钉吸附状态 */
    public get pinned(): boolean {
        return this.isPinned;
    }

    /** 快速直达悬浮微胶囊当前是否可见 */
    public get capsuleVisible(): boolean {
        return this.isCapsuleVisible;
    }

    /** 获取最后一次用户输入时间戳 */
    public get lastInputTimestamp(): number {
        return this.lastUserInputAt;
    }

    /** 计算当前容器距离底部的绝对像素距离 */
    public getDistanceFromBottom(): number {
        const remaining = this.container.scrollHeight - (this.container.scrollTop + this.container.clientHeight);
        return remaining > 0 ? remaining : 0;
    }

    /**
     * 判定当前是否处于用户主动输入冷却窗口内。
     *
     * @param now 当前时间戳（未指定时由 performance.now() 或 Date.now() 判定）
     * @returns 是否处于冷却锁定中（true 表示物理剥夺自动化视口抢占）
     */
    public isInputCooling(now?: number): boolean {
        const currentTime = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
        return (currentTime - this.lastUserInputAt) <= this.cooldownMs;
    }

    /**
     * 记录用户主动物理交互（滚轮、拖拽、触控、按键）。
     *
     * @param timestamp 交互发生时间戳
     */
    public recordUserInput(timestamp?: number): void {
        if (this.isDisposed) return;
        this.lastUserInputAt = timestamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.evaluateState(true);
    }

    /**
     * 流式推流新内容追加通知。
     * 自动执行冷却窗口仲裁：若用户在 150ms 内有输入，物理剥夺自动滚动权限；
     * 若处于图钉吸附状态，使用 behavior: "auto" 瞬时无抖对齐底部。
     *
     * @param now 传入的时间戳
     * @returns 是否成功执行了贴底滚动
     */
    public notifyContentAppended(now?: number): boolean {
        if (this.isDisposed) return false;
        if (this.isInputCooling(now)) return false;
        if (!this.isPinned) return false;

        this.scrollToBottom('auto');
        return true;
    }

    /**
     * 滚动直达容器底部并恢复图钉吸附态。
     *
     * @param behavior 滚动行为模式，高频流式推流推荐 "auto"，用户点击直达推荐 "smooth"
     */
    public scrollToBottom(behavior: 'auto' | 'smooth' = 'auto'): void {
        if (this.isDisposed) return;
        const targetTop = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
        if (typeof this.container.scrollTo === 'function') {
            this.container.scrollTo({ top: targetTop, behavior });
        } else {
            this.container.scrollTop = targetTop;
        }

        this.setPinned(true);
        this.setCapsuleVisible(false);
    }

    /** 容器滚动事件监听回调 */
    private handleContainerScroll(): void {
        if (this.isDisposed) return;
        this.evaluateState(false);
    }

    /** 统一解算吸附态与胶囊显隐状态 */
    private evaluateState(fromUserInput: boolean): void {
        const distance = this.getDistanceFromBottom();
        const shouldPin = distance <= this.pinTolerance;
        const shouldShowCapsule = distance > this.capsuleThreshold;

        if (fromUserInput) {
            this.setPinned(shouldPin);
        } else if (shouldPin && !this.isPinned) {
            this.setPinned(true);
        }

        this.setCapsuleVisible(shouldShowCapsule);
    }

    private setPinned(pinned: boolean): void {
        if (this.isPinned === pinned) return;
        this.isPinned = pinned;
        this.onPinnedStateChange?.(pinned);
    }

    private setCapsuleVisible(visible: boolean): void {
        if (this.isCapsuleVisible === visible) return;
        this.isCapsuleVisible = visible;
        this.onCapsuleVisibilityChange?.(visible);
    }

    private bindEvents(): void {
        if (!this.container.addEventListener) return;
        this.container.addEventListener('scroll', this.boundOnScroll, { passive: true });
        this.container.addEventListener('wheel', this.boundOnUserInput, { passive: true });
        this.container.addEventListener('touchmove', this.boundOnUserInput, { passive: true });
        this.container.addEventListener('keydown', this.boundOnUserInput, { passive: true });
    }

    private unbindEvents(): void {
        if (!this.container.removeEventListener) return;
        this.container.removeEventListener('scroll', this.boundOnScroll);
        this.container.removeEventListener('wheel', this.boundOnUserInput);
        this.container.removeEventListener('touchmove', this.boundOnUserInput);
        this.container.removeEventListener('keydown', this.boundOnUserInput);
    }

    /** 销毁控制器并解绑所有事件监听 */
    public dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.unbindEvents();
    }
}
