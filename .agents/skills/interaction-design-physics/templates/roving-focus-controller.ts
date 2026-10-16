/**
 * Module: WAI-ARIA Roving TabIndex & 2D Focus Navigation Controller
 * File Path: templates/roving-focus-controller.ts
 * Architecture Role: Universal keyboard navigation engine implementing the Roving TabIndex pattern
 *   with loop wrapping, 2D matrix navigation, and bidirectional RTL mirroring.
 * Dependencies & Triggers: Consumes browser KeyboardEvent DOM APIs; triggered by keydown on composite widgets.
 * Responsibilities:
 *   1. Maintain single active tabIndex=0 with all siblings at -1.
 *   2. Resolve 1D linear and 2D grid matrix navigation.
 *   3. Support loop boundary wrapping and RTL horizontal direction mirroring.
 *   4. Keep control flow flat with CC <= 15 and Depth <= 4.
 * Exit Semantics & Design Rationale: Accessible, deterministic, zero layout shift or focus leaks.
 */

export interface RovingFocusOptions {
    readonly container: HTMLElement;
    readonly itemSelector: string;
    readonly orientation?: 'horizontal' | 'vertical' | 'both';
    readonly loop?: boolean;
    readonly columns?: number; // 2D 矩阵列数，不传或 <= 1 为一维列表
    readonly onFocusChange?: (item: HTMLElement, index: number) => void;
}

export class RovingFocusController {
    private readonly container: HTMLElement;
    private readonly itemSelector: string;
    private readonly orientation: 'horizontal' | 'vertical' | 'both';
    private readonly loop: boolean;
    private readonly columns: number;
    private readonly onFocusChange?: (item: HTMLElement, index: number) => void;

    private currentIndex = 0;

    constructor(options: RovingFocusOptions) {
        this.container = options.container;
        this.itemSelector = options.itemSelector;
        this.orientation = options.orientation ?? 'horizontal';
        this.loop = options.loop ?? true;
        this.columns = Math.max(1, options.columns ?? 1);
        this.onFocusChange = options.onFocusChange;

        this.initTabIndex();
        this.container.addEventListener('keydown', this.onKeyDown);
    }

    private getItems(): HTMLElement[] {
        return Array.from(this.container.querySelectorAll(this.itemSelector));
    }

    private initTabIndex(): void {
        const items = this.getItems();
        for (let i = 0; i < items.length; i++) {
            items[i].setAttribute('tabindex', i === this.currentIndex ? '0' : '-1');
        }
    }

    private readonly onKeyDown = (e: KeyboardEvent): void => {
        const items = this.getItems();
        if (items.length === 0) return;

        const isRtl = this.isRtlMode();
        let targetIndex = this.currentIndex;

        switch (e.key) {
            case 'ArrowRight':
                if (this.orientation === 'vertical') return;
                targetIndex = this.step(isRtl ? -1 : 1, items.length);
                break;
            case 'ArrowLeft':
                if (this.orientation === 'vertical') return;
                targetIndex = this.step(isRtl ? 1 : -1, items.length);
                break;
            case 'ArrowDown':
                if (this.orientation === 'horizontal') return;
                targetIndex = this.step(this.columns, items.length);
                break;
            case 'ArrowUp':
                if (this.orientation === 'horizontal') return;
                targetIndex = this.step(-this.columns, items.length);
                break;
            case 'Home':
                targetIndex = 0;
                break;
            case 'End':
                targetIndex = items.length - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        this.moveToIndex(targetIndex, items);
    };

    private step(offset: number, total: number): number {
        let next = this.currentIndex + offset;
        if (!this.loop) {
            return Math.max(0, Math.min(total - 1, next));
        }

        if (next < 0) {
            next = total + (next % total);
        }
        return next % total;
    }

    public moveToIndex(index: number, cachedItems?: HTMLElement[]): void {
        const items = cachedItems ?? this.getItems();
        if (index < 0 || index >= items.length) return;

        const prevItem = items[this.currentIndex];
        const nextItem = items[index];

        if (prevItem) prevItem.setAttribute('tabindex', '-1');
        if (nextItem) {
            nextItem.setAttribute('tabindex', '0');
            nextItem.focus();
        }

        this.currentIndex = index;
        this.onFocusChange?.(nextItem, index);
    }

    private isRtlMode(): boolean {
        const dir = this.container.getAttribute('dir') || document.documentElement.getAttribute('dir');
        return dir === 'rtl';
    }

    public destroy(): void {
        this.container.removeEventListener('keydown', this.onKeyDown);
    }
}
