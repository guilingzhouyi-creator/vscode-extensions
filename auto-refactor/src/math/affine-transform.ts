/**
 * Module: Math Operators — Cursor Fixed-Point Affine Transformation
 * File Path: src/math/affine-transform.ts
 * Architecture Role: Pure TS operator performing cursor fixed-point affine coordinate transforms
 *   (scaling, rotation, translation around an arbitrary anchor point) with zero heap allocation.
 * Dependencies & Triggers: Independent pure math module; consumed by UI canvas, vector renderers,
 *   and interactive coordinate systems.
 * Responsibilities:
 *   1. Transform single 2D points relative to an arbitrary cursor anchor point (cx, cy).
 *   2. Transform flat Float64Array coordinate buffers in-place with zero memory allocation.
 *   3. Calculate inverse affine transformations for screen-to-canvas coordinate mapping.
 * Exit Semantics & Design Rationale: CC <= 8; pure arithmetic;
 *   zero loop heap allocations; no exceptions thrown.
 */

/**
 * Parameters defining a 2D affine transformation around a cursor anchor point.
 */
export interface AffineTransformParams {
    /** Fixed cursor anchor X coordinate. */
    readonly cursorX: number;
    /** Fixed cursor anchor Y coordinate. */
    readonly cursorY: number;
    /** Scale factor along X axis (default 1.0). */
    readonly scaleX?: number;
    /** Scale factor along Y axis (default 1.0). */
    readonly scaleY?: number;
    /** Rotation angle in radians around anchor (default 0.0). */
    readonly rotationRad?: number;
    /** Translation offset along X axis (default 0.0). */
    readonly translateX?: number;
    /** Translation offset along Y axis (default 0.0). */
    readonly translateY?: number;
}

/**
 * Represents a 2D point coordinate pair.
 */
export interface Point2D {
    x: number;
    y: number;
}

/**
 * Transforms a single point (x, y) relative to cursor fixed-point anchor.
 * CC = 4, Depth = 2.
 *
 * @param x - Input X coordinate.
 * @param y - Input Y coordinate.
 * @param params - Affine transformation parameters.
 * @param out - Optional target point to write result into.
 * @returns Transformed point coordinates.
 */
export function transformPoint(
    x: number,
    y: number,
    params: AffineTransformParams,
    out?: Point2D,
): Point2D {
    const cx = params.cursorX;
    const cy = params.cursorY;
    const sx = params.scaleX ?? 1.0;
    const sy = params.scaleY ?? 1.0;
    const rad = params.rotationRad ?? 0.0;
    const tx = params.translateX ?? 0.0;
    const ty = params.translateY ?? 0.0;

    // 1. Shift relative to cursor anchor
    const dx = x - cx;
    const dy = y - cy;

    // 2. Scale
    const scaledX = dx * sx;
    const scaledY = dy * sy;

    // 3. Rotate and restore anchor + translation
    const cosTheta = Math.cos(rad);
    const sinTheta = Math.sin(rad);
    const rx = scaledX * cosTheta - scaledY * sinTheta;
    const ry = scaledX * sinTheta + scaledY * cosTheta;

    const resX = rx + cx + tx;
    const resY = ry + cy + ty;

    if (out) {
        out.x = resX;
        out.y = resY;
        return out;
    }
    return { x: resX, y: resY };
}

/**
 * In-place batch coordinate transformation on Float64Array (x0, y0, x1, y1, ...).
 * Zero heap allocations inside loop (CPX-SPACE-001). CC = 3, Depth = 2.
 *
 * @param coords - Flat coordinate array modified in-place.
 * @param params - Affine transformation parameters.
 */
export function transformPointsInPlace(coords: Float64Array, params: AffineTransformParams): void {
    const cx = params.cursorX;
    const cy = params.cursorY;
    const sx = params.scaleX ?? 1.0;
    const sy = params.scaleY ?? 1.0;
    const rad = params.rotationRad ?? 0.0;
    const tx = params.translateX ?? 0.0;
    const ty = params.translateY ?? 0.0;

    const cosTheta = Math.cos(rad);
    const sinTheta = Math.sin(rad);

    const len = coords.length - (coords.length % 2);
    for (let i = 0; i < len; i += 2) {
        const dx = coords[i] - cx;
        const dy = coords[i + 1] - cy;

        const scaledX = dx * sx;
        const scaledY = dy * sy;

        coords[i] = scaledX * cosTheta - scaledY * sinTheta + cx + tx;
        coords[i + 1] = scaledX * sinTheta + scaledY * cosTheta + cy + ty;
    }
}

/**
 * Computes inverse affine transform parameters for round-trip coordinate mapping.
 * CC = 3, Depth = 1.
 *
 * @param params - Forward affine transformation parameters.
 * @returns Inverse affine transformation parameters.
 */
export function invertTransform(params: AffineTransformParams): AffineTransformParams {
    const sx = params.scaleX ?? 1.0;
    const sy = params.scaleY ?? 1.0;
    const invSx = sx !== 0 ? 1.0 / sx : 1.0;
    const invSy = sy !== 0 ? 1.0 / sy : 1.0;

    const rad = params.rotationRad ?? 0.0;
    const invRad = -rad;

    const tx = params.translateX ?? 0.0;
    const ty = params.translateY ?? 0.0;

    const invCos = Math.cos(invRad);
    const invSin = Math.sin(invRad);
    const scaledTx = tx * invSx;
    const scaledTy = ty * invSy;
    const invTx = -(scaledTx * invCos - scaledTy * invSin);
    const invTy = -(scaledTx * invSin + scaledTy * invCos);

    return {
        cursorX: params.cursorX,
        cursorY: params.cursorY,
        scaleX: invSx,
        scaleY: invSy,
        rotationRad: invRad,
        translateX: invTx,
        translateY: invTy,
    };
}
