/**
 * Module: Unit Test — Cyclomatic Complexity Analyzer Suite
 * File Path: tests/unit/analyzers/complexity.test.ts
 * Architecture Role: Exercises ComplexityAnalyzer across cyclomatic thresholds (high-complexity)
 *   and nested branching constraints (CPX-NEST-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports ComplexityAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert high-complexity and CPX-NEST-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 25ms.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { ComplexityAnalyzer } from '../../../src/analyzers/complexity';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ComplexityAnalyzer Suite', () => {
    const analyzer = new ComplexityAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true,
        );
        return {
            filePath,
            content,
            sourceFile,
            options: {
                complexityWarn: 10,
                complexityFail: 15,
            },
            config: {
                analyzers: {
                    complexity: { options: {} },
                },
            },
        };
    }

    it('permits clean functions with low cyclomatic complexity and shallow nesting', () => {
        const code = [
            'export function clamp(val: number, min: number, max: number): number {',
            '    if (val < min) return min;',
            '    if (val > max) return max;',
            '    return val;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/math.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags functions with cyclomatic complexity exceeding warning threshold (high-complexity)', () => {
        const branches = [];
        for (let i = 0; i < 12; i++) {
            branches.push(`    if (x === ${i}) return ${i};`);
        }
        const code = [
            'export function dispatchCode(x: number): number {',
            ...branches,
            '    return -1;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/dispatcher.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        const cpxIssue = issues.find((i) => i.rule === 'high-complexity');
        expect(cpxIssue).toBeDefined();
        expect(cpxIssue?.message).toContain('cyclomatic complexity');
    });

    it('flags deeply nested conditionals (CPX-NEST-001)', () => {
        const code = [
            'export function verifyDeep(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean) {',
            '    if (a) {',
            '        if (b) {',
            '            if (c) {',
            '                if (d) {',
            '                    if (e) {',
            '                        return true;',
            '                    }',
            '                }',
            '            }',
            '        }',
            '    }',
            '    return false;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/nested.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        const nestIssue = issues.find((i) => i.rule === 'CPX-NEST-001' || i.rule.includes('NEST'));
        expect(nestIssue).toBeDefined();
    });
});
