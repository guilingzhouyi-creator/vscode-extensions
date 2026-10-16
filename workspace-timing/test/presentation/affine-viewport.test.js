/**
 * AffineViewport 算子单元测试套件
 * 运行环境：Node.js Mocha，验证光标不动点、0.7 边界溢出阻尼与 4px 移动死区
 */
'use strict';

const assert = require('assert');
const {
    isWithinDeadzone,
    computeAffineScaleTransform,
    computeAffinePan,
    clampAffineTranslate,
} = require('../../out/presentation/affine-viewport.js');

describe('AffineViewport（光标不动点仿射变换与阻尼算子）', () => {
    describe('isWithinDeadzone（4px 移动死区防抖）', () => {
        it('位移向量距离 <= 4px 时返回 true，判定为生理微抖动', () => {
            assert.strictEqual(isWithinDeadzone(0, 0), true);
            assert.strictEqual(isWithinDeadzone(2, 2), true); // sqrt(8) ≈ 2.828 <= 4
            assert.strictEqual(isWithinDeadzone(4, 0), true); // 4 == 4
            assert.strictEqual(isWithinDeadzone(0, -4), true);
        });

        it('位移向量距离 > 4px 时返回 false，判定为有效移动', () => {
            assert.strictEqual(isWithinDeadzone(4.1, 0), false);
            assert.strictEqual(isWithinDeadzone(3, 3), false); // sqrt(18) ≈ 4.24 > 4
            assert.strictEqual(isWithinDeadzone(-5, 0), false);
        });
    });

    describe('computeAffineScaleTransform（以光标为物理不动点的仿射缩放）', () => {
        it('在不动点 (Ox, Oy) 处缩放，理想平移量精确满足 idealTx = Ox - (Ox - tx) * c', () => {
            const result = computeAffineScaleTransform({
                currentScale: 1.0,
                targetScale: 2.0,
                currentTranslate: { x: 0, y: 0 },
                origin: { x: 100, y: 150 },
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
            });

            assert.strictEqual(result.scale, 2.0);
            // c = 2.0 / 1.0 = 2.0
            // idealTx = 100 - (100 - 0) * 2 = -100
            // idealTy = 150 - (150 - 0) * 2 = -150
            // maxTx = (400 * 2 - 400) / 2 = 200
            // maxTy = (300 * 2 - 300) / 2 = 150
            // idealTx=-100 处于 [-200, 200] 内，未阻尼
            assert.strictEqual(result.tx, -100);
            assert.strictEqual(result.ty, -150);
            assert.strictEqual(result.isDampedX, false);
            assert.strictEqual(result.isDampedY, false);
        });

        it('当平移量溢出边界时，应用 0.7 物理阻尼系数柔化手感', () => {
            const result = computeAffineScaleTransform({
                currentScale: 1.0,
                targetScale: 2.0,
                currentTranslate: { x: 0, y: 0 },
                origin: { x: -200, y: 0 },
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
                damping: 0.7,
            });

            // c = 2.0; idealTx = -200 - (-200 - 0) * 2 = 200
            // maxTx = (800 - 400) / 2 = 200. 若 origin 改为 -250：
            const overflowResult = computeAffineScaleTransform({
                currentScale: 1.0,
                targetScale: 2.0,
                currentTranslate: { x: 0, y: 0 },
                origin: { x: -250, y: 0 },
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
                damping: 0.7,
            });

            // idealTx = -250 - (-250) * 2 = 250
            // maxTx = 200. overflow = 50. damped = 200 + 50 * 0.7 = 235
            assert.strictEqual(overflowResult.isDampedX, true);
            assert.strictEqual(overflowResult.tx, 235);
        });

        it('目标缩放比受 minScale 与 maxScale 安全钳制', () => {
            const result = computeAffineScaleTransform({
                currentScale: 1.0,
                targetScale: 99.0, // 超过最大限制
                currentTranslate: { x: 0, y: 0 },
                origin: { x: 0, y: 0 },
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
                maxScale: 5.0,
            });

            assert.strictEqual(result.scale, 5.0);
        });
    });

    describe('computeAffinePan（带 4px 死区与 0.7 边界阻尼的平移）', () => {
        it('拖拽位移 <= 4px 时被死区过滤，坐标保持原样', () => {
            const result = computeAffinePan({
                currentTranslate: { x: 50, y: 50 },
                delta: { x: 2, y: 2 },
                scale: 1.0,
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
            });

            assert.strictEqual(result.wasSuppressed, true);
            assert.strictEqual(result.tx, 50);
            assert.strictEqual(result.ty, 50);
        });

        it('有效位移正常平移并在溢出边界时施加 0.7 阻尼', () => {
            const result = computeAffinePan({
                currentTranslate: { x: 190, y: 0 },
                delta: { x: 30, y: 0 }, // 190 + 30 = 220
                scale: 2.0,
                viewportWidth: 400,
                viewportHeight: 300,
                contentWidth: 400,
                contentHeight: 300,
                damping: 0.7,
            });

            // maxTx = (800 - 400) / 2 = 200
            // idealTx = 220, overflow = 20 -> 200 + 20 * 0.7 = 214
            assert.strictEqual(result.wasSuppressed, false);
            assert.strictEqual(result.isDampedX, true);
            assert.strictEqual(result.tx, 214);
        });
    });

    describe('clampAffineTranslate（硬截断辅助）', () => {
        it('将超出边界的坐标截断在 [-max, max] 范围内', () => {
            const clamped = clampAffineTranslate(250, -300, 200, 150);
            assert.deepStrictEqual(clamped, { x: 200, y: -150 });
        });
    });
});

