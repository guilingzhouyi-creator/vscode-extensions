/**
 * Module: Unit Test — Simplification & Structure Smells Analyzer Suite
 * File Path: tests/unit/analyzers/simplify.test.ts
 * Architecture Role: Exercises SimplifyAnalyzer across parameter objects (SIM-ARGS-001),
 *   commented code blocks (SIM-COMC-001), and debug print leaks (SIM-PRNT-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports SimplifyAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert SIM-ARGS-001, SIM-COMC-001, and SIM-PRNT-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 15ms.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SimplifyAnalyzer } from '../../../src/analyzers/simplify';
import type { AnalyzerContext } from '../../../src/core/types';

describe('SimplifyAnalyzer Suite', () => {
    const analyzer = new SimplifyAnalyzer();

    beforeEach(() => {
        analyzer.resetState();
    });

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                maxFunctionParameters: 4,
            },
            config: {
                analyzers: {
                    simplify: { options: {} },
                },
            },
        };
    }

    it('permits concise functions with parameter objects and clean comments', () => {
        const code = [
            'export interface QueryOptions {',
            '    id: number;',
            '    limit: number;',
            '}',
            '',
            'export function executeQuery(options: QueryOptions): boolean {',
            '    return options.id > 0 && options.limit > 0;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/services/query.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags functions with more than 4 parameters (SIM-ARGS-001)', () => {
        const code = [
            'export function renderCanvas(',
            '    ctx: any,',
            '    width: number,',
            '    height: number,',
            '    scale: number,',
            '    offset: number,',
            '): void {',
            '    ctx.clear();',
            '}',
        ].join('\n');
        const ctx = createCtx('src/views/canvas.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const argsIssue = issues.find((i) => i.rule === 'SIM-ARGS-001');
        expect(argsIssue).toBeDefined();
        expect(argsIssue?.message).toContain('parameter object');
    });

    it('flags multi-line commented-out code blocks (SIM-COMC-001)', () => {
        const code = [
            'export function calculate(): number {',
            '    // const oldVal = 10;',
            '    // const intermediate = oldVal * 2;',
            '    // return intermediate;',
            '    return 42;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/calc.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const comcIssue = issues.find((i) => i.rule === 'SIM-COMC-001');
        expect(comcIssue).toBeDefined();
        expect(comcIssue?.message).toContain('commented-out code');
    });

    it('flags console.log in non-CLI, non-test production modules (SIM-PRNT-001)', () => {
        const code = [
            'export function processData(data: any): void {',
            '    console.log("processing data", data);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/core/engine.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const prntIssue = issues.find((i) => i.rule === 'SIM-PRNT-001');
        expect(prntIssue).toBeDefined();
        expect(prntIssue?.message).toContain('Debug output');
    });
});
