/**
 * Module: Unit Test — Gate Architecture Governance Analyzer Suite
 * File Path: tests/unit/analyzers/gate-architecture.test.ts
 * Architecture Role: Exercises GateArchitectureAnalyzer across manifest discovery and gate health audits.
 * Dependencies & Triggers: vitest (describe, it, expect, beforeEach); imports GateArchitectureAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert gate candidate filtering, cache management, and manifest auditing.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 15ms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GateArchitectureAnalyzer } from '../../../src/analyzers/gate-architecture';
import type { AnalyzerContext } from '../../../src/core/types';

describe('GateArchitectureAnalyzer Suite', () => {
    const analyzer = new GateArchitectureAnalyzer();

    beforeEach(() => {
        GateArchitectureAnalyzer.clearCache();
    });

    function createCtx(filePath: string, content: string = ''): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {
                root: process.cwd(),
                analyzers: {
                    'gate-architecture': { options: {} },
                },
            },
        };
    }

    it('bypasses non-manifest and non-gate files immediately', () => {
        const ctx = createCtx('src/utils/math.ts', 'export const add = (a: number, b: number) => a + b;');
        const issues = analyzer.analyze(undefined as any, ctx);
        expect(issues).toHaveLength(0);
    });

    it('evaluates primary project manifest against gate architecture', () => {
        const ctx = createCtx('package.json', '{\n  "name": "sample-pkg"\n}');
        const issues = analyzer.analyze(undefined as any, ctx);
        expect(Array.isArray(issues)).toBe(true);
    });

    it('clears static cache cleanly on demand', () => {
        expect(() => GateArchitectureAnalyzer.clearCache()).not.toThrow();
    });
});
