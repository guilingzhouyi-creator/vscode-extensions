/**
 * Module: Viewport Scroll Pinning & Intent Cooldown Controller
 * File Path: .agents/skills/interaction-design-physics/templates/scroll-pinning-controller.ts
 * Architecture Role: High-performance viewport pinning controller for streaming text and chat interfaces.
 * Dependencies & Triggers: Consumes DOM Scroll APIs and performance.now(); driven by user input events and stream chunks.
 * Responsibilities:
 *   1. Arbitrate between programmatic stream auto-scrolling and manual user scrolling.
 *   2. Enforce 150ms cooldown window where user physical interaction unconditionally overrides auto-scroll.
 *   3. Maintain 40px bottom pinning tolerance and 120px threshold for jump-to-bottom indicator.
 *   4. Enforce behavior: "auto" for streaming chunks to eliminate jitter, reserving "smooth" for manual button clicks.
 * Exit Semantics & Design Rationale: Exits cleanly by returning immutable state snapshots; zero transient heap allocation during streaming.
 */

export interface ScrollPinningOptions {
    readonly cooldownMs?: number;
    readonly bottomTolerancePx?: number;
    readonly jumpThresholdPx?: number;
}

export interface ScrollPinningState {
    readonly isPinned: boolean;
    readonly showJumpToBottom: boolean;
    readonly distanceFromBottom: number;
}

export class ScrollPinningController {
    private readonly container: HTMLElement;
    private readonly cooldownMs: number;
    private readonly bottomTolerancePx: number;
    private readonly jumpThresholdPx: number;

    private isPinned: boolean = true;
    private showJumpToBottom: boolean = false;
    private lastUserInputAt: number = 0;
    private isProgrammaticScroll: boolean = false;

    public constructor(container: HTMLElement, options: ScrollPinningOptions = {}) {
        this.container = container;
        this.cooldownMs = options.cooldownMs ?? 150;
        this.bottomTolerancePx = options.bottomTolerancePx ?? 40;
        this.jumpThresholdPx = options.jumpThresholdPx ?? 120;
    }

    /**
     * Record explicit user physical interaction (wheel, touchmove, pointerdown, keydown).
     * Locks out programmatic auto-scroll for cooldownMs window.
     */
    public onUserInput(): void {
        this.lastUserInputAt = performance.now();
        this.isPinned = false;
    }

    /**
     * Handle scroll event from the container element.
     */
    public onScroll(): ScrollPinningState {
        if (this.isProgrammaticScroll) {
            this.isProgrammaticScroll = false;
            return this.getState();
        }

        const distanceFromBottom = this.calculateDistanceFromBottom();
        this.isPinned = distanceFromBottom <= this.bottomTolerancePx;
        this.showJumpToBottom = distanceFromBottom > this.jumpThresholdPx;

        return this.getState();
    }

    /**
     * Called when a new text chunk is appended in streaming mode.
     * Enforces instant alignment (behavior: "auto") to prevent cumulative frame jitter.
     */
    public onStreamChunk(): boolean {
        const now = performance.now();
        const isInCooldown = (now - this.lastUserInputAt) <= this.cooldownMs;

        if (isInCooldown || !this.isPinned) {
            return false;
        }

        this.scrollToBottomInstant();
        return true;
    }

    /**
     * Manually jump to bottom (e.g. from floating jump button).
     * Uses smooth scrolling when requested by human.
     */
    public jumpToBottom(smooth: boolean = true): void {
        this.isProgrammaticScroll = true;
        this.isPinned = true;
        this.showJumpToBottom = false;

        this.container.scrollTo({
            top: this.container.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
        });
    }

    /**
     * Instant bottom alignment without smooth animation.
     */
    private scrollToBottomInstant(): void {
        this.isProgrammaticScroll = true;
        this.container.scrollTo({
            top: this.container.scrollHeight,
            behavior: 'auto',
        });
    }

    private calculateDistanceFromBottom(): number {
        const { scrollHeight, scrollTop, clientHeight } = this.container;
        return Math.max(0, scrollHeight - scrollTop - clientHeight);
    }

    public getState(): ScrollPinningState {
        return {
            isPinned: this.isPinned,
            showJumpToBottom: this.showJumpToBottom,
            distanceFromBottom: this.calculateDistanceFromBottom(),
        };
    }
}

