/**
 * Universal Fixed-Anchor Point Affine Pan/Zoom Mathematics
 * 
 * 核心机制：以鼠标指针或手势中心 [Ox, Oy] 为物理不变不动点解算仿射位移与边界钳制。
 */

export interface ViewportFitInfo {
    readonly fitWidth: number;
    readonly fitHeight: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly fitCenterX: number;
    readonly fitCenterY: number;
}

export interface TransformState {
    readonly scale: number;
    readonly idealTx: number;
    readonly idealTy: number;
    readonly tx: number;
    readonly ty: number;
    readonly maxTx: number;
    readonly maxTy: number;
}

export interface PointerCoord {
    readonly clientX: number;
    readonly clientY: number;
}

function clamp(value: number, bound: number): number {
    return Math.max(-bound, Math.min(bound, value));
}

export function calcMaxTranslate(contentDim: number, viewportDim: number, scale: number): number {
    const overflow = Math.max(0, (contentDim * scale - viewportDim) / 2.0);
    const damping = Math.min(1.0, Math.max(0, (scale - 1.05) / 0.95));
    return overflow * damping;
}

export function calculateAnchorZoom(
    fitInfo: ViewportFitInfo,
    currentPos: TransformState,
    targetScale: number,
    pointerPos: PointerCoord | null,
): TransformState {
    const maxTx = calcMaxTranslate(fitInfo.fitWidth, fitInfo.viewportWidth, targetScale);
    const maxTy = calcMaxTranslate(fitInfo.fitHeight, fitInfo.viewportHeight, targetScale);

    const offsetX = pointerPos ? pointerPos.clientX - fitInfo.fitCenterX : 0;
    const offsetY = pointerPos ? pointerPos.clientY - fitInfo.fitCenterY : 0;

    const ratio = targetScale / currentPos.scale;
    const idealTx = offsetX - (offsetX - currentPos.idealTx) * ratio;
    const idealTy = offsetY - (offsetY - currentPos.idealTy) * ratio;

    const tx = clamp(idealTx, maxTx);
    const ty = clamp(idealTy, maxTy);

    return {
        scale: targetScale,
        idealTx,
        idealTy,
        tx,
        ty,
        maxTx,
        maxTy,
    };
}
