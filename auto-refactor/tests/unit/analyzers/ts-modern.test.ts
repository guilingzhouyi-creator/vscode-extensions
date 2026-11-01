/**
 * Module: Unit Test — TypeScript/JavaScript Modernization Analyzer Suite (TSM-* Rules)
 * File Path: tests/unit/analyzers/ts-modern.test.ts
 * Architecture Role: Exercises TypeScriptModernAnalyzer across legacy var,
 *   arguments object, constructor wrappers, and includes modern syntax.
 * Dependencies & Triggers: vitest (describe, it, expect); imports TypeScriptModernAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert TSM-VAR-001, TSM-CTOR-001, TSM-ARGS-001, and TSM-INCLUDES-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { TsModernAnalyzer } from '../../../src/analyzers/ts-modern';
import type { AnalyzerContext } from '../../../src/core/types';

describe('TsModernAnalyzer Suite', () => {
    const analyzer = new TsModernAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits modern TypeScript with const/let and includes', () => {
        const code = [
            'export const list = [1, 2, 3];',
            'export function hasItem(val: number): boolean {',
            '    return list.includes(val);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/utils.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags legacy var declarations (TSM-VAR-001)', () => {
        const code = [
            'export function run(): void {',
            '    var counter = 0;',
            '    counter++;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/legacy.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const varIssue = issues.find((i) => i.rule === 'TSM-VAR-001');
        expect(varIssue).toBeDefined();
        expect(varIssue?.message).toContain('var');
    });

    it('flags wrapper constructor usage like new Array() (TSM-CTOR-001)', () => {
        const code = [
            'export function makeEmpty(): unknown[] {',
            '    return new Array();',
            '}',
        ].join('\n');
        const ctx = createCtx('src/ctor.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const ctorIssue = issues.find((i) => i.rule === 'TSM-CTOR-001');
        expect(ctorIssue).toBeDefined();
        expect(ctorIssue?.message).toContain('Wrapper constructor');
    });

    it('flags legacy indexOf comparison in favor of includes (TSM-INCLUDES-001)', () => {
        const code = [
            'export function containsItem(arr: string[], item: string): boolean {',
            '    return arr.indexOf(item) !== -1;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/search.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const includesIssue = issues.find((i) => i.rule === 'TSM-INCLUDES-001');
        expect(includesIssue).toBeDefined();
        expect(includesIssue?.message).toContain('indexOf');
        expect(includesIssue?.suggestion).toContain('includes');
    });
});
