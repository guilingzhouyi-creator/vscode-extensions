/**
 * Module: Unit Test — Affine Transform & Spectral Gamma Operators
 * File Path: tests/unit/math/affine-and-spectral.test.ts
 * Architecture Role: Deterministic verification of cursor fixed-point affine and 8% / 0.7-gamma math operators.
 * Dependencies & Triggers: vitest, affine-transform, spectral-gamma.
 * Responsibilities:
 *   1. Verify cursor anchor invariance under scaling and rotation.
 *   2. Verify batch in-place Float64Array affine transformations.
 *   3. Verify 8% noise floor suppression and 0.7 power Gamma compression curve.
 *   4. Verify in-place Float64Array spectral compression.
 * Exit Semantics & Design Rationale: Standard vitest suite; 100% deterministic mathematical verification.
 */

import { describe, it, expect } from 'vitest';
import {
    transformPoint,
    transformPointsInPlace,
    invertTransform,
} from '../../../src/math/affine-transform';
import {
    compressSpectralSample,
    compressSpectralBufferInPlace,
} from '../../../src/math/spectral-gamma';

describe('Affine Transform Math Operator', () => {
    it('should keep cursor anchor point strictly invariant under scaling and rotation', () => {
        const params = {
            cursorX: 100,
            cursorY: 200,
            scaleX: 2.5,
            scaleY: 3.0,
            rotationRad: Math.PI / 4,
            translateX: 0,
            translateY: 0,
        };
        const res = transformPoint(100, 200, params);
        expect(res.x).toBeCloseTo(100, 6);
        expect(res.y).toBeCloseTo(200, 6);
    });

    it('should scale and translate points relative to cursor', () => {
        const params = {
            cursorX: 10,
            cursorY: 10,
            scaleX: 2.0,
            scaleY: 2.0,
            translateX: 5,
            translateY: 5,
        };
        // Point (20, 20): offset is (10, 10) * 2 = (20, 20) + anchor(10, 10) + trans(5, 5) = (35, 35)
        const res = transformPoint(20, 20, params);
        expect(res.x).toBe(35);
        expect(res.y).toBe(35);
    });

    it('should perform batch in-place transform on Float64Array', () => {
        const coords = new Float64Array([10, 10, 20, 20]);
        const params = {
            cursorX: 10,
            cursorY: 10,
            scaleX: 2.0,
            scaleY: 2.0,
            translateX: 5,
            translateY: 5,
        };
        transformPointsInPlace(coords, params);
        // Anchor (10, 10) becomes (15, 15)
        expect(coords[0]).toBe(15);
        expect(coords[1]).toBe(15);
        // Point (20, 20) becomes (35, 35)
        expect(coords[2]).toBe(35);
        expect(coords[3]).toBe(35);
    });

    it('should roundtrip with inverse transform', () => {
        const params = {
            cursorX: 50,
            cursorY: 50,
            scaleX: 1.5,
            scaleY: 1.5,
            rotationRad: 0.3,
            translateX: 12,
            translateY: -8,
        };
        const transformed = transformPoint(80, 90, params);
        const inv = invertTransform(params);
        const restored = transformPoint(transformed.x, transformed.y, inv);
        expect(restored.x).toBeCloseTo(80, 5);
        expect(restored.y).toBeCloseTo(90, 5);
    });
});

describe('Spectral Gamma Math Operator', () => {
    it('should suppress amplitudes below 8% noise floor to zero', () => {
        expect(compressSpectralSample(0.0)).toBe(0.0);
        expect(compressSpectralSample(0.05)).toBe(0.0);
        expect(compressSpectralSample(0.08)).toBe(0.0);
    });

    it('should preserve ceiling at 1.0', () => {
        expect(compressSpectralSample(1.0)).toBe(1.0);
        expect(compressSpectralSample(1.2)).toBe(1.0);
    });

    it('should apply 0.7 Gamma power curve above 8% floor', () => {
        // Midway: 0.08 + (1 - 0.08) * 0.5 = 0.08 + 0.46 = 0.54
        const expected = Math.pow(0.5, 0.7); // ~0.6155722
        const actual = compressSpectralSample(0.54);
        expect(actual).toBeCloseTo(expected, 5);
    });

    it('should perform in-place compression on Float64Array buffer', () => {
        const buffer = new Float64Array([0.02, 0.08, 0.54, 1.0]);
        compressSpectralBufferInPlace(buffer);
        expect(buffer[0]).toBe(0.0);
        expect(buffer[1]).toBe(0.0);
        expect(buffer[2]).toBeCloseTo(Math.pow(0.5, 0.7), 5);
        expect(buffer[3]).toBe(1.0);
    });
});

