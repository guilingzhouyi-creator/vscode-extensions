/**
 * Module: AffineViewport — 光标不动点仿射变换与视口阻尼算子
 * File Path: src/presentation/affine-viewport.ts
 * Architecture Role: Presentation layer pure geometric affine transform and viewport dampening operator
 * Dependencies & Triggers: Consumed by interactive heatmap pan/zoom, active curve inspectors, and canvas views
 * Responsibilities: Compute affine pan/zoom transformations anchoring cursor (Ox, Oy) as physical invariant point; apply 0.7 boundary overflow dampening; filter micro-jitter via 4px movement deadzone
 * Exit Semantics & Design Rationale: Pure functional arithmetic operator without DOM dependencies or heap allocations; guarantees deterministic mathematical precision
 */

export interface AffinePoint {
    readonly x: number;
    readonly y: number;
}

export interface AffineViewportParams {
    /** 当前缩放比例 S_current */
    currentScale: number;
    /** 目标缩放比例 S_target */
    targetScale: number;
    /** 当前平移向量 tx, ty */
    currentTranslate: AffinePoint;
    /** 光标/指针锚定物理不动点 Ox, Oy（视口局部坐标系） */
    origin: AffinePoint;
    /** 视口可视尺寸 */
    viewportWidth: number;
    viewportHeight: number;
    /** 缩放主体内容原始物理尺寸 */
    contentWidth: number;
    contentHeight: number;
    /** 边界溢出阻尼系数（默认 0.7） */
    damping?: number;
    /** 缩放比例安全边界，默认 [0.1, 10.0] */
    minScale?: number;
    maxScale?: number;
}

export interface AffineTransformResult {
    readonly scale: number;
    readonly tx: number;
    readonly ty: number;
    readonly isDampedX: boolean;
    readonly isDampedY: boolean;
    readonly maxTx: number;
    readonly maxTy: number;
}

export interface AffinePanParams {
    /** 当前平移向量 */
    currentTranslate: AffinePoint;
    /** 手势拖拽位移向量 dx, dy */
    delta: AffinePoint;
    /** 当前缩放比例 */
    scale: number;
    /** 视口可视尺寸 */
    viewportWidth: number;
    viewportHeight: number;
    /** 缩放主体内容原始物理尺寸 */
    contentWidth: number;
    contentHeight: number;
    /** 移动死区门限（单位：像素，默认 4px） */
    deadzone?: number;
    /** 边界溢出阻尼系数（默认 0.7） */
    damping?: number;
}

export interface AffinePanResult {
    readonly tx: number;
    readonly ty: number;
    readonly wasSuppressed: boolean;
    readonly isDampedX: boolean;
    readonly isDampedY: boolean;
}

export const DEFAULT_AFFINE_DAMPING = 0.7;
export const DEFAULT_MOVEMENT_DEADZONE = 4;
export const DEFAULT_MIN_SCALE = 0.1;
export const DEFAULT_MAX_SCALE = 10.0;

/**
 * 判定手势移动向量是否处于手部生理微抖动死区内（欧氏距离 <= deadzone）。
 *
 * @param dx X 轴位移量
 * @param dy Y 轴位移量
 * @param deadzone 死区门限，默认 4px
 * @returns true 表示位移在死区内应被抑制，false 表示有效移动
 */
export function isWithinDeadzone(dx: number, dy: number, deadzone = DEFAULT_MOVEMENT_DEADZONE): boolean {
    const distSq = dx * dx + dy * dy;
    return distSq <= deadzone * deadzone;
}

/**
 * 单轴边界溢出阻尼计算纯函数。
 */
function applyAxisDamping(
    ideal: number,
    maxBound: number,
    damping: number
): { value: number; isDamped: boolean } {
    if (ideal > maxBound) {
        const overflow = ideal - maxBound;
        return { value: maxBound + overflow * damping, isDamped: true };
    }
    if (ideal < -maxBound) {
        const underflow = -maxBound - ideal;
        return { value: -maxBound - underflow * damping, isDamped: true };
    }
    return { value: ideal, isDamped: false };
}

/**
 * 以指针 (Ox, Oy) 为物理不动点的轻量仿射缩放计算纯函数。
 * 核心几何方程：
 * c = S_target / S_current
 * idealTx = Ox - (Ox - tx) * c
 * idealTy = Oy - (Oy - ty) * c
 */
export function computeAffineScaleTransform(params: AffineViewportParams): AffineTransformResult {
    const minS = params.minScale ?? DEFAULT_MIN_SCALE;
    const maxS = params.maxScale ?? DEFAULT_MAX_SCALE;
    const effectiveTargetScale = Math.min(Math.max(params.targetScale, minS), maxS);
    const safeCurrentScale = Math.max(params.currentScale, 0.0001);
    const c = effectiveTargetScale / safeCurrentScale;

    const idealTx = params.origin.x - (params.origin.x - params.currentTranslate.x) * c;
    const idealTy = params.origin.y - (params.origin.y - params.currentTranslate.y) * c;

    const maxTx = Math.max(0, (params.contentWidth * effectiveTargetScale - params.viewportWidth) / 2);
    const maxTy = Math.max(0, (params.contentHeight * effectiveTargetScale - params.viewportHeight) / 2);

    const damping = params.damping ?? DEFAULT_AFFINE_DAMPING;
    const dampedX = applyAxisDamping(idealTx, maxTx, damping);
    const dampedY = applyAxisDamping(idealTy, maxTy, damping);

    return {
        scale: effectiveTargetScale,
        tx: dampedX.value,
        ty: dampedY.value,
        isDampedX: dampedX.isDamped,
        isDampedY: dampedY.isDamped,
        maxTx,
        maxTy,
    };
}

/**
 * 带有 4px 移动死区与 0.7 边界阻尼的手势拖拽平移计算纯函数。
 */
export function computeAffinePan(params: AffinePanParams): AffinePanResult {
    const deadzone = params.deadzone ?? DEFAULT_MOVEMENT_DEADZONE;
    if (isWithinDeadzone(params.delta.x, params.delta.y, deadzone)) {
        return {
            tx: params.currentTranslate.x,
            ty: params.currentTranslate.y,
            wasSuppressed: true,
            isDampedX: false,
            isDampedY: false,
        };
    }

    const idealTx = params.currentTranslate.x + params.delta.x;
    const idealTy = params.currentTranslate.y + params.delta.y;

    const maxTx = Math.max(0, (params.contentWidth * params.scale - params.viewportWidth) / 2);
    const maxTy = Math.max(0, (params.contentHeight * params.scale - params.viewportHeight) / 2);

    const damping = params.damping ?? DEFAULT_AFFINE_DAMPING;
    const dampedX = applyAxisDamping(idealTx, maxTx, damping);
    const dampedY = applyAxisDamping(idealTy, maxTy, damping);

    return {
        tx: dampedX.value,
        ty: dampedY.value,
        wasSuppressed: false,
        isDampedX: dampedX.isDamped,
        isDampedY: dampedY.isDamped,
    };
}

/**
 * 拖拽松手后的硬截断复位辅助函数。
 */
export function clampAffineTranslate(
    tx: number,
    ty: number,
    maxTx: number,
    maxTy: number
): AffinePoint {
    const clampedX = Math.min(Math.max(tx, -maxTx), maxTx);
    const clampedY = Math.min(Math.max(ty, -maxTy), maxTy);
    return { x: clampedX, y: clampedY };
}

