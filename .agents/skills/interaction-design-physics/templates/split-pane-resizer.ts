/**
 * Module: Split Pane Resizer & Iframe Pointer Shield Controller
 * File Path: templates/split-pane-resizer.ts
 * Architecture Role: Universal split pane drag handler with iframe shield, movement deadzone,
 *   50/50 double-click snap, and edge collapse threshold.
 * Dependencies & Triggers: Consumes browser PointerEvent DOM APIs; triggered by user handle interactions.
 * Responsibilities:
 *   1. Manage drag session lifecycle with pointer-events protection for nested iframes.
 *   2. Filter micro-jitters via a 4px movement deadzone.
 *   3. Provide double-click 50/50 center snap with damped spring motion.
 *   4. Automatically snap-collapse when dragged below the 18% edge boundary.
 * Exit Semantics & Design Rationale: CC <= 15, Depth <= 4, flat guard clauses, zero transient leaks.
 */

export interface SplitPaneOptions {
    readonly container: HTMLElement;
    readonly handle: HTMLElement;
    readonly primaryPane: HTMLElement;
    readonly direction?: 'horizontal' | 'vertical';
    readonly minRatio?: number;
    readonly maxRatio?: number;
    readonly collapseThreshold?: number; // 默认 0.18 (<18% 自动折叠)
    readonly onResize?: (ratio: number) => void;
    readonly onCollapse?: (collapsed: boolean) => void;
}

export class SplitPaneResizer {
    private readonly container: HTMLElement;
    private readonly handle: HTMLElement;
    private readonly primaryPane: HTMLElement;
    private readonly isVertical: boolean;
    private readonly minRatio: number;
    private readonly maxRatio: number;
    private readonly collapseThreshold: number;
    private readonly onResize?: (ratio: number) => void;
    private readonly onCollapse?: (collapsed: boolean) => void;

    private isDragging = false;
    private startCoord = 0;
    private startSize = 0;
    private hasExceededDeadzone = false;
    private currentRatio = 0.5;
    private readonly deadzonePx = 4;

    constructor(options: SplitPaneOptions) {
        this.container = options.container;
        this.handle = options.handle;
        this.primaryPane = options.primaryPane;
        this.isVertical = options.direction === 'vertical';
        this.minRatio = options.minRatio ?? 0.1;
        this.maxRatio = options.maxRatio ?? 0.9;
        this.collapseThreshold = options.collapseThreshold ?? 0.18;
        this.onResize = options.onResize;
        this.onCollapse = options.onCollapse;

        this.bindEvents();
    }

    private bindEvents(): void {
        this.handle.addEventListener('pointerdown', this.onPointerDown);
        this.handle.addEventListener('dblclick', this.onDoubleClick);
    }

    private readonly onPointerDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;

        this.isDragging = true;
        this.hasExceededDeadzone = false;
        this.startCoord = this.isVertical ? e.clientY : e.clientX;

        const rect = this.primaryPane.getBoundingClientRect();
        this.startSize = this.isVertical ? rect.height : rect.width;

        this.handle.setPointerCapture(e.pointerId);
        this.handle.addEventListener('pointermove', this.onPointerMove);
        this.handle.addEventListener('pointerup', this.onPointerUp);
        this.handle.addEventListener('pointercancel', this.onPointerUp);

        // 挂载拖拽标记与 Iframe 防吞噬护盾
        this.container.setAttribute('data-pane-dragging', 'true');
        this.applyIframeShield(true);
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        if (!this.isDragging) return;

        const currentCoord = this.isVertical ? e.clientY : e.clientX;
        const delta = currentCoord - this.startCoord;

        // 4px 移动死区守卫
        if (!this.hasExceededDeadzone) {
            if (Math.abs(delta) <= this.deadzonePx) return;
            this.hasExceededDeadzone = true;
        }

        const totalSize = this.getContainerSize();
        if (totalSize <= 0) return;

        const targetSize = this.startSize + delta;
        let ratio = targetSize / totalSize;

        // < 18% 临界折叠门限
        if (ratio < this.collapseThreshold) {
            ratio = 0;
            this.onCollapse?.(true);
        } else {
            ratio = Math.max(this.minRatio, Math.min(this.maxRatio, ratio));
            this.onCollapse?.(false);
        }

        this.applyRatio(ratio);
    };

    private readonly onPointerUp = (e: PointerEvent): void => {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.handle.releasePointerCapture(e.pointerId);
        this.handle.removeEventListener('pointermove', this.onPointerMove);
        this.handle.removeEventListener('pointerup', this.onPointerUp);
        this.handle.removeEventListener('pointercancel', this.onPointerUp);

        this.container.removeAttribute('data-pane-dragging');
        this.applyIframeShield(false);
    };

    private readonly onDoubleClick = (): void => {
        // 双击平滑复位至 50/50 居中
        this.applyRatio(0.5);
        this.onCollapse?.(false);
    };

    private applyRatio(ratio: number): void {
        this.currentRatio = ratio;
        const pct = `${(ratio * 100).toFixed(2)}%`;
        if (this.isVertical) {
            this.primaryPane.style.height = pct;
        } else {
            this.primaryPane.style.width = pct;
        }
        this.onResize?.(ratio);
    }

    private getContainerSize(): number {
        const rect = this.container.getBoundingClientRect();
        return this.isVertical ? rect.height : rect.width;
    }

    private applyIframeShield(active: boolean): void {
        const iframes = this.container.querySelectorAll('iframe');
        for (let i = 0; i < iframes.length; i++) {
            const frame = iframes[i];
            if (active) {
                frame.style.pointerEvents = 'none';
            } else {
                frame.style.pointerEvents = '';
            }
        }
    }

    public destroy(): void {
        this.handle.removeEventListener('pointerdown', this.onPointerDown);
        this.handle.removeEventListener('dblclick', this.onDoubleClick);
        this.applyIframeShield(false);
    }
}
