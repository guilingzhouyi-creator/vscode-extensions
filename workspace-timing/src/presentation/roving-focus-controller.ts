/**
 * Module: RovingFocusController — WAI-ARIA 键盘盲操漫游焦点控制器
 * File Path: src/presentation/roving-focus-controller.ts
 * Architecture Role: Presentation layer keyboard navigation and accessible focus manager
 * Dependencies & Triggers: DOM KeyboardEvent / FocusEvent subsystem; applied to session lists, history tables, and interactive card items
 * Responsibilities: Maintain WAI-ARIA roving tabindex invariant (active=0, inactive=-1); handle ArrowUp/Down/Left/Right, Home, and End keys with circular wrap-around; skip disabled elements
 * Exit Semantics & Design Rationale: Pure stateful controller operating on DOM node collections; eliminates keyboard trap and guarantees 100% blind-keyboard accessible navigation
 */

import { TYPEOF_NUMBER } from '../domain/constants';

const KEY_ARROW_DOWN = 'ArrowDown';
const KEY_ARROW_UP = 'ArrowUp';
const KEY_ARROW_RIGHT = 'ArrowRight';
const KEY_ARROW_LEFT = 'ArrowLeft';
const KEY_HOME = 'Home';
const KEY_END = 'End';

const ORIENTATION_VERTICAL = 'vertical';
const ORIENTATION_HORIZONTAL = 'horizontal';
const ORIENTATION_BOTH = 'both';

const EVENT_KEY_DOWN = 'keydown';
const EVENT_FOCUS_IN = 'focusin';

const ATTR_DISABLED = 'disabled';
const ATTR_ARIA_DISABLED = 'aria-disabled';
const ATTR_VAL_TRUE = 'true';

/**
 * Configuration options for initializing the roving focus controller.
 */
export interface RovingFocusOptions {
    container: HTMLElement;
    itemSelector: string;
    orientation?: 'vertical' | 'horizontal' | 'both';
    initialIndex?: number;
    loop?: boolean;
    onFocusChange?: (index: number, element: HTMLElement) => void;
}

/**
 * Stateful controller maintaining WAI-ARIA roving tabindex invariant across list items.
 */
export class RovingFocusController {
    private readonly container: HTMLElement;
    private readonly itemSelector: string;
    private readonly orientation: 'vertical' | 'horizontal' | 'both';
    private readonly loop: boolean;
    private readonly onFocusChange?: (index: number, element: HTMLElement) => void;

    private currentIndex: number = 0;
    private isDisposed: boolean = false;

    constructor(options: RovingFocusOptions) {
        this.container = options.container;
        this.itemSelector = options.itemSelector;
        this.orientation = options.orientation ?? ORIENTATION_VERTICAL;
        this.loop = options.loop ?? true;
        this.onFocusChange = options.onFocusChange;

        if (typeof options.initialIndex === TYPEOF_NUMBER && (options.initialIndex as number) >= 0) {
            this.currentIndex = options.initialIndex as number;
        }

        this.bindEvents();
        this.refreshTabIndices(false);
    }

    public get activeIndex(): number {
        return this.currentIndex;
    }

    /** 激活指定索引元素，并同步更新全局 tabindex 状态 */
    public setActiveIndex(index: number, shouldFocus: boolean = true): void {
        if (this.isDisposed) return;
        const items = this.getItems();
        if (items.length === 0) return;

        const targetIndex = Math.max(0, Math.min(items.length - 1, index));
        if (!this.isItemInteractive(items[targetIndex])) return;

        this.currentIndex = targetIndex;
        this.refreshTabIndices(shouldFocus);
    }

    /** 刷新子项 tabindex 属性并执行可选聚焦 */
    public refreshTabIndices(shouldFocus: boolean = false): void {
        if (this.isDisposed) return;
        const items = this.getItems();
        if (items.length === 0) return;

        if (this.currentIndex >= items.length) {
            this.currentIndex = items.length - 1;
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (i === this.currentIndex) {
                item.tabIndex = 0;
                if (shouldFocus) {
                    item.focus();
                }
            } else {
                item.tabIndex = -1;
            }
        }

        if (items[this.currentIndex]) {
            this.onFocusChange?.(this.currentIndex, items[this.currentIndex]);
        }
    }

    /** 处理全键盘导航按键事件（返回 true 表示已消费阻止默认行为） */
    public handleKeyDown(event: KeyboardEvent): boolean {
        if (this.isDisposed) return false;
        const items = this.getItems();
        if (items.length === 0) return false;

        const targetIndex = this.resolveKeyTarget(event.key, items);
        if (targetIndex < 0 || targetIndex >= items.length) {
            return false;
        }

        event.preventDefault();
        this.setActiveIndex(targetIndex, true);
        return true;
    }

    private static readonly ARROW_STEPS: Record<string, { delta: number; axis: 'vertical' | 'horizontal' }> = {
        [KEY_ARROW_DOWN]: { delta: 1, axis: ORIENTATION_VERTICAL },
        [KEY_ARROW_UP]: { delta: -1, axis: ORIENTATION_VERTICAL },
        [KEY_ARROW_RIGHT]: { delta: 1, axis: ORIENTATION_HORIZONTAL },
        [KEY_ARROW_LEFT]: { delta: -1, axis: ORIENTATION_HORIZONTAL },
    };

    private resolveArrowStep(key: string): number | null {
        const stepDef = RovingFocusController.ARROW_STEPS[key];
        if (!stepDef) return null;
        if (this.orientation !== ORIENTATION_BOTH && this.orientation !== stepDef.axis) {
            return null;
        }
        return stepDef.delta;
    }

    private resolveKeyTarget(key: string, items: HTMLElement[]): number {
        const step = this.resolveArrowStep(key);
        if (step !== null) {
            return this.findNextIndex(items, step);
        }
        if (key === KEY_HOME) {
            return this.findFirstEnabledIndex(items);
        }
        if (key === KEY_END) {
            return this.findLastEnabledIndex(items);
        }
        return -1;
    }

    /** 销毁控制器并解绑事件 */
    public dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.container.removeEventListener(EVENT_KEY_DOWN, this.onContainerKeyDown);
        this.container.removeEventListener(EVENT_FOCUS_IN, this.onContainerFocusIn);
    }

    private bindEvents(): void {
        this.container.addEventListener(EVENT_KEY_DOWN, this.onContainerKeyDown);
        this.container.addEventListener(EVENT_FOCUS_IN, this.onContainerFocusIn);
    }

    private onContainerKeyDown = (e: KeyboardEvent): void => {
        this.handleKeyDown(e);
    };

    private onContainerFocusIn = (e: FocusEvent): void => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const items = this.getItems();
        const found = items.indexOf(target);
        if (found >= 0 && found !== this.currentIndex) {
            this.setActiveIndex(found, false);
        }
    };

    private getItems(): HTMLElement[] {
        const nodeList = this.container.querySelectorAll(this.itemSelector);
        const result: HTMLElement[] = [];
        for (let i = 0; i < nodeList.length; i++) {
            result.push(nodeList[i] as HTMLElement);
        }
        return result;
    }

    private isItemInteractive(item: HTMLElement): boolean {
        if (!item) return false;
        if (item.hasAttribute(ATTR_DISABLED)) return false;
        if (item.getAttribute(ATTR_ARIA_DISABLED) === ATTR_VAL_TRUE) return false;
        return true;
    }

    private findNextIndex(items: HTMLElement[], step: number): number {
        const count = items.length;
        let candidate = this.currentIndex;

        for (let i = 0; i < count; i++) {
            candidate += step;
            if (this.loop) {
                candidate = (candidate + count) % count;
            } else if (candidate < 0 || candidate >= count) {
                return this.currentIndex;
            }

            if (this.isItemInteractive(items[candidate])) {
                return candidate;
            }
        }
        return this.currentIndex;
    }

    private findFirstEnabledIndex(items: HTMLElement[]): number {
        for (let i = 0; i < items.length; i++) {
            if (this.isItemInteractive(items[i])) return i;
        }
        return this.currentIndex;
    }

    private findLastEnabledIndex(items: HTMLElement[]): number {
        for (let i = items.length - 1; i >= 0; i--) {
            if (this.isItemInteractive(items[i])) return i;
        }
        return this.currentIndex;
    }
}
