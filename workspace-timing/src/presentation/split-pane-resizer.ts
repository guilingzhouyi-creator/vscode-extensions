/**
 * Module: SplitPaneResizer — 物理分栏分割手柄与手势防吞噬控制器
 * File Path: src/presentation/split-pane-resizer.ts
 * Architecture Role: Presentation layer gesture-based layout controller for split pane resizing
 * Dependencies & Triggers: DOM PointerEvent / MouseEvent subsystem; triggered by user resizing panel splits
 * Responsibilities: Manage continuous split-pane dragging with 4px motion dead zone; inject iframe pointer-events blocker; provide 50/50 center snap on double click, Escape key rollback, and <18% edge collapse
 * Exit Semantics & Design Rationale: State-machine-based gesture tracking; guarantees zero iframe pointer theft and zero accidental micro-jitter during layout adjustments
 */

import { PERCENT_MULTIPLIER } from '../domain/models';
import { TYPEOF_NUMBER, TYPEOF_UNDEFINED } from '../domain/constants';

const DIRECTION_HORIZONTAL = 'horizontal';
const DIRECTION_VERTICAL = 'vertical';

const EVENT_POINTER_DOWN = 'pointerdown';
const EVENT_DBLCLICK = 'dblclick';
const EVENT_POINTER_MOVE = 'pointermove';
const EVENT_POINTER_UP = 'pointerup';
const EVENT_POINTER_CANCEL = 'pointercancel';
const EVENT_KEY_DOWN = 'keydown';

const KEY_ESCAPE = 'Escape';

const ATTR_DATA_PANE_DRAGGING = 'data-pane-dragging';
const ATTR_VAL_TRUE = 'true';

const SELECTOR_IFRAME = 'iframe';
const STYLE_POINTER_EVENTS_NONE = 'none';
const STYLE_EMPTY = '';

const DEFAULT_COLLAPSE_THRESHOLD = 0.18;
const GESTURE_DEAD_ZONE_PX = 4;
const DEFAULT_INITIAL_RATIO = 0.5;

/**
 * Options for configuring the split pane gesture resizer.
 */
export interface SplitPaneResizerOptions {
    container: HTMLElement;
    handle: HTMLElement;
    firstPane: HTMLElement;
    secondPane: HTMLElement;
    direction?: 'horizontal' | 'vertical';
    initialRatio?: number;
    collapseThreshold?: number;
    onResize?: (ratio: number) => void;
    onCollapse?: (collapsed: boolean) => void;
}

/**
 * Presentation layer gesture-based layout controller for split pane resizing.
 */
export class SplitPaneResizer {
    private readonly container: HTMLElement;
    private readonly handle: HTMLElement;
    private readonly firstPane: HTMLElement;
    private readonly secondPane: HTMLElement;
    private readonly direction: 'horizontal' | 'vertical';
    private readonly collapseThreshold: number;
    private readonly onResize?: (ratio: number) => void;
    private readonly onCollapse?: (collapsed: boolean) => void;

    private currentRatio: number;
    private preDragRatio: number;
    private startX: number = 0;
    private startY: number = 0;
    private isPointerDown: boolean = false;
    private isDraggingActive: boolean = false;
    private isCollapsedState: boolean = false;
    private isDisposed: boolean = false;

    constructor(options: SplitPaneResizerOptions) {
        this.container = options.container;
        this.handle = options.handle;
        this.firstPane = options.firstPane;
        this.secondPane = options.secondPane;
        this.direction = options.direction ?? DIRECTION_HORIZONTAL;
        this.collapseThreshold = options.collapseThreshold ?? DEFAULT_COLLAPSE_THRESHOLD;
        this.onResize = options.onResize;
        this.onCollapse = options.onCollapse;

        this.currentRatio = typeof options.initialRatio === TYPEOF_NUMBER
            ? Math.max(0, Math.min(1.0, options.initialRatio as number))
            : DEFAULT_INITIAL_RATIO;
        this.preDragRatio = this.currentRatio;

        this.bindEvents();
        this.applyRatio(this.currentRatio);
    }

    public get ratio(): number {
        return this.currentRatio;
    }

    public get isDragging(): boolean {
        return this.isDraggingActive;
    }

    public get isCollapsed(): boolean {
        return this.isCollapsedState;
    }

    /** 设置分割比例（0.0 ~ 1.0） */
    public setRatio(ratio: number, notify: boolean = true): void {
        if (this.isDisposed) return;
        const clamped = Math.max(0, Math.min(1.0, ratio));

        if (clamped < this.collapseThreshold) {
            this.currentRatio = 0;
            this.isCollapsedState = true;
        } else {
            this.currentRatio = clamped;
            this.isCollapsedState = false;
        }

        this.applyRatio(this.currentRatio);

        if (notify) {
            this.onResize?.(this.currentRatio);
            this.onCollapse?.(this.isCollapsedState);
        }
    }

    /** 回滚至拖拽前比例（按 Escape 键触发） */
    public rollback(): void {
        if (this.isDisposed) return;
        this.setRatio(this.preDragRatio);
        this.stopDragging();
    }

    /** 双击手柄触发 50/50 居中吸附 */
    public snapToCenter(): void {
        this.setRatio(0.5);
    }

    /** 销毁实例并解绑事件 */
    public dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        this.stopDragging();
        this.unbindEvents();
    }

    private bindEvents(): void {
        this.handle.addEventListener(EVENT_POINTER_DOWN, this.onPointerDown);
        this.handle.addEventListener(EVENT_DBLCLICK, this.onDblClick);
        if (typeof window !== TYPEOF_UNDEFINED) {
            window.addEventListener(EVENT_POINTER_MOVE, this.onPointerMove);
            window.addEventListener(EVENT_POINTER_UP, this.onPointerUp);
            window.addEventListener(EVENT_POINTER_CANCEL, this.onPointerUp);
            window.addEventListener(EVENT_KEY_DOWN, this.onKeyDown);
        }
    }

    private unbindEvents(): void {
        this.handle.removeEventListener(EVENT_POINTER_DOWN, this.onPointerDown);
        this.handle.removeEventListener(EVENT_DBLCLICK, this.onDblClick);
        if (typeof window !== TYPEOF_UNDEFINED) {
            window.removeEventListener(EVENT_POINTER_MOVE, this.onPointerMove);
            window.removeEventListener(EVENT_POINTER_UP, this.onPointerUp);
            window.removeEventListener(EVENT_POINTER_CANCEL, this.onPointerUp);
            window.removeEventListener(EVENT_KEY_DOWN, this.onKeyDown);
        }
    }

    private onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        this.isPointerDown = true;
        this.isDraggingActive = false;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.preDragRatio = this.currentRatio;
    };

    private onPointerMove = (e: PointerEvent): void => {
        if (!this.isPointerDown || this.isDisposed) return;

        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;

        // 4px 手势移动死区判断
        if (!this.isDraggingActive) {
            if (Math.hypot(dx, dy) < GESTURE_DEAD_ZONE_PX) {
                return;
            }
            this.startDragging();
        }

        const newRatio = this.calculateRatioFromEvent(e);
        this.setRatio(newRatio);
    };

    private onPointerUp = (): void => {
        if (!this.isPointerDown) return;
        this.stopDragging();
    };

    private onDblClick = (): void => {
        this.snapToCenter();
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === KEY_ESCAPE && this.isDraggingActive) {
            this.rollback();
        }
    };

    private startDragging(): void {
        this.isDraggingActive = true;
        this.container.setAttribute(ATTR_DATA_PANE_DRAGGING, ATTR_VAL_TRUE);
        this.toggleIframeBlocker(true);
    }

    private stopDragging(): void {
        this.isPointerDown = false;
        this.isDraggingActive = false;
        this.container.removeAttribute(ATTR_DATA_PANE_DRAGGING);
        this.toggleIframeBlocker(false);
    }

    private toggleIframeBlocker(block: boolean): void {
        const iframes = this.container.querySelectorAll(SELECTOR_IFRAME);
        const styleVal = block ? STYLE_POINTER_EVENTS_NONE : STYLE_EMPTY;
        for (let i = 0; i < iframes.length; i++) {
            (iframes[i] as HTMLElement).style.pointerEvents = styleVal;
        }
    }

    private calculateRatioFromEvent(e: PointerEvent): number {
        const rect = this.container.getBoundingClientRect();
        if (this.direction === DIRECTION_HORIZONTAL) {
            if (rect.width <= 0) return 0.5;
            return (e.clientX - rect.left) / rect.width;
        }
        if (rect.height <= 0) return 0.5;
        return (e.clientY - rect.top) / rect.height;
    }

    private applyRatio(ratio: number): void {
        const pct = (ratio * PERCENT_MULTIPLIER).toFixed(2);
        const invPct = ((1.0 - ratio) * PERCENT_MULTIPLIER).toFixed(2);

        this.firstPane.style.flex = `0 0 ${pct}%`;
        this.secondPane.style.flex = `0 0 ${invPct}%`;
    }
}
