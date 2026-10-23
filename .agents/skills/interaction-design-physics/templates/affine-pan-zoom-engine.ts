/**
 * Module: Fixed-Anchor Affine Pan/Zoom Mathematics Engine
 * File Path: .agents/skills/interaction-design-physics/templates/affine-pan-zoom-engine.ts
 * Architecture Role: Deterministic 2D affine transform engine maintaining invariant pointer focus.
 * Dependencies & Triggers: Consumes DOM WheelEvent and PointerEvent inputs; outputs CSS transform matrices.
 * Responsibilities:
 *   1. Calculate affine translation guaranteeing cursor (Ox, Oy) remains physically motionless during zoom.
 *   2. Implement exp(-deltaY * 0.01) exponential scale step for scale-invariant smooth zooming.
 *   3. Enforce 0.7 damping on viewport boundary overflows and 4px deadzone for micro-tremor suppression.
 * Exit Semantics & Design Rationale: Pure mathematical solver, no external state dependencies, CC <= 15.
 */

export interface AffineViewport {
    readonly contentWidth: number;
    readonly contentHeight: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
}

export interface AffineTransformState {
    readonly scale: number;
    readonly tx: number;
    readonly ty: number;
    readonly idealTx: number;
    readonly idealTy: number;
}

export interface PointerScreenPoint {
    readonly clientX: number;
    readonly clientY: number;
}

export interface AffineEngineConfig {
    readonly minScale?: number;
    readonly maxScale?: number;
    readonly deadzonePx?: number;
    readonly overflowDamping?: number;
}

export interface ZoomAtAnchorParams {
    readonly viewport: AffineViewport;
    readonly currentState: AffineTransformState;
    readonly targetScale: number;
    readonly anchor: PointerScreenPoint;
}

export interface ApplyPanParams {
    readonly viewport: AffineViewport;
    readonly currentState: AffineTransformState;
    readonly deltaX: number;
    readonly deltaY: number;
}

export class AffinePanZoomEngine {
    private readonly minScale: number;
    private readonly maxScale: number;
    private readonly deadzonePx: number;
    private readonly overflowDamping: number;

    public constructor(config: AffineEngineConfig = {}) {
        this.minScale = config.minScale ?? 0.25;
        this.maxScale = config.maxScale ?? 8.0;
        this.deadzonePx = config.deadzonePx ?? 4.0;
        this.overflowDamping = config.overflowDamping ?? 0.7;
    }

    /**
     * Compute next scale using exponential wheel formula exp(-deltaY * 0.01).
     */
    public computeWheelScale(currentScale: number, deltaY: number): number {
        const factor = Math.exp(-deltaY * 0.01);
        const targetScale = currentScale * factor;
        return Math.min(this.maxScale, Math.max(this.minScale, targetScale));
    }

    /**
     * Solve fixed-anchor zoom preserving pointer position (Ox, Oy) in screen space.
     */
    public zoomAtAnchor(params: ZoomAtAnchorParams): AffineTransformState {
        const { viewport, currentState, targetScale, anchor } = params;
        const clampedScale = Math.min(this.maxScale, Math.max(this.minScale, targetScale));
        const ratio = clampedScale / currentState.scale;

        const centerX = viewport.viewportWidth / 2.0;
        const centerY = viewport.viewportHeight / 2.0;

        const offsetX = anchor.clientX - centerX;
        const offsetY = anchor.clientY - centerY;

        const idealTx = offsetX - (offsetX - currentState.idealTx) * ratio;
        const idealTy = offsetY - (offsetY - currentState.idealTy) * ratio;

        const maxTx = Math.max(0, (viewport.contentWidth * clampedScale - viewport.viewportWidth) / 2.0);
        const maxTy = Math.max(0, (viewport.contentHeight * clampedScale - viewport.viewportHeight) / 2.0);

        const tx = this.applyDampedClamping(idealTx, maxTx);
        const ty = this.applyDampedClamping(idealTy, maxTy);

        return {
            scale: clampedScale,
            tx,
            ty,
            idealTx,
            idealTy,
        };
    }

    /**
     * Apply pan translation with 4px deadzone guard.
     */
    public applyPan(params: ApplyPanParams): AffineTransformState {
        const { viewport, currentState, deltaX, deltaY } = params;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance < this.deadzonePx) {
            return currentState;
        }

        const idealTx = currentState.idealTx + deltaX;
        const idealTy = currentState.idealTy + deltaY;

        const maxTx = Math.max(0, (viewport.contentWidth * currentState.scale - viewport.viewportWidth) / 2.0);
        const maxTy = Math.max(0, (viewport.contentHeight * currentState.scale - viewport.viewportHeight) / 2.0);

        const tx = this.applyDampedClamping(idealTx, maxTx);
        const ty = this.applyDampedClamping(idealTy, maxTy);

        return {
            scale: currentState.scale,
            tx,
            ty,
            idealTx,
            idealTy,
        };
    }

    /**
     * Clamps within bound or applies 0.7 damping on overflow.
     */
    private applyDampedClamping(ideal: number, maxBound: number): number {
        if (Math.abs(ideal) <= maxBound) {
            return ideal;
        }
        const overflow = Math.abs(ideal) - maxBound;
        const damped = maxBound + overflow * this.overflowDamping;
        return ideal > 0 ? damped : -damped;
    }

    /**
     * Format as CSS matrix3d / matrix string.
     */
    public toCssMatrix(state: AffineTransformState): string {
        return `matrix(${state.scale.toFixed(4)}, 0, 0, ${state.scale.toFixed(4)}, ${state.tx.toFixed(2)}, ${state.ty.toFixed(2)})`;
    }
}
