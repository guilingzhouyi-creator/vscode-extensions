/**
 * Module: Unit Test — Hygiene Analyzer Suite (HYG-* Rules)
 * File Path: tests/unit/analyzers/hygiene.test.ts
 * Architecture Role: Exercises HygieneAnalyzer across naming drift, dead code,
 *   placeholder stubs, transient jargon, and floating promises.
 * Dependencies & Triggers: vitest (describe, it, expect); imports HygieneAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert HYG-NAM-001, HYG-DED-001, HYG-STB-001, HYG-STB-002,
 *   ERR-MSG-001, and ERR-FLT-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests with zero disk I/O;
 *   guarantees sub-millisecond assertion execution.
 */

import { describe, it, expect } from 'vitest';
import { HygieneAnalyzer } from '../../../src/analyzers/hygiene';
import type { AnalyzerContext } from '../../../src/core/types';

describe('HygieneAnalyzer Suite', () => {
    const analyzer = new HygieneAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                checkDeadCode: true,
                checkNaming: true,
                checkTemporaryStubs: true,
                checkDuplicateBlocks: false,
                checkWrappers: true,
            },
            config: {},
        };
    }

    describe('File Naming Drift (HYG-NAM-001)', () => {
        it('flags mixed camel and underscore TypeScript filenames', () => {
            const ctx = createCtx('src/my_Bad_Camel_Module.ts', 'export const x = 1;\n');
            const issues = analyzer.analyze(undefined, ctx);
            const namingIssue = issues.find((i) => i.rule === 'HYG-NAM-001');
            expect(namingIssue).toBeDefined();
            expect(namingIssue?.severity).toBe('info');
            expect(namingIssue?.message).toContain('kebab-case');
        });

        it('permits compliant kebab-case TypeScript filenames', () => {
            const ctx = createCtx('src/my-clean-module.ts', 'export const x = 1;\n');
            const issues = analyzer.analyze(undefined, ctx);
            const namingIssue = issues.find((i) => i.rule === 'HYG-NAM-001');
            expect(namingIssue).toBeUndefined();
        });

        it('flags non-snake_case Python filenames', () => {
            const ctx = createCtx('scripts/myBadModule.py', 'def run(): pass\n');
            const issues = analyzer.analyze(undefined, ctx);
            const namingIssue = issues.find((i) => i.rule === 'HYG-NAM-001');
            expect(namingIssue).toBeDefined();
            expect(namingIssue?.severity).toBe('warning');
            expect(namingIssue?.message).toContain('snake_case');
        });
    });

    describe('Placeholder Markers & Jargon (HYG-STB-001 / HYG-STB-002)', () => {
        it('flags unresolved placeholder markers (TODO/FIXME/XXX/HACK)', () => {
            const code = [
                'export function calculate(): number {',
                '    // TODO: implement real algorithm',
                '    return 0;',
                '}',
            ].join('\n');
            const ctx = createCtx('src/calc.ts', code);
            const issues = analyzer.analyze(undefined, ctx);
            const stubIssue = issues.find((i) => i.rule === 'HYG-STB-001');
            expect(stubIssue).toBeDefined();
            expect(stubIssue?.message).toContain('placeholder marker');
        });

        it('flags transient process jargon in non-whitelisted prose', () => {
            const code = [
                '// wip: quick fix for deployment',
                'export const legacyMode = true;',
            ].join('\n');
            const ctx = createCtx('src/mode.ts', code);
            const issues = analyzer.analyze(undefined, ctx);
            const jargonIssue = issues.find((i) => i.rule === 'HYG-STB-002');
            expect(jargonIssue).toBeDefined();
        });
    });

    describe('Dead Code Detection (HYG-DED-001)', () => {
        it('flags unreachable statements following terminal return', () => {
            const code = [
                'export function compute(val: number): number {',
                '    return val * 2;',
                '    const unreachable = val + 1;',
                '}',
            ].join('\n');
            const ctx = createCtx('src/math.ts', code);
            const issues = analyzer.analyze(undefined, ctx);
            const deadCodeIssue = issues.find((i) => i.rule === 'HYG-DED-001');
            expect(deadCodeIssue).toBeDefined();
            expect(deadCodeIssue?.message).toContain('Dead code detected');
        });
    });

    describe('Error Messaging & Floating Promises (ERR-MSG-001 / ERR-FLT-001)', () => {
        it('flags vague throw statements lacking informative message', () => {
            const code = [
                'export function fail(): void {',
                '    throw new Error("error");',
                '}',
            ].join('\n');
            const ctx = createCtx('src/error.ts', code);
            const issues = analyzer.analyze(undefined, ctx);
            const errMsgIssue = issues.find((i) => i.rule === 'ERR-MSG-001');
            expect(errMsgIssue).toBeDefined();
        });

        it('flags unhandled floating promise calls without catch or await', () => {
            const code = [
                'export function trigger(): void {',
                '    Promise.resolve(42);',
                '}',
            ].join('\n');
            const ctx = createCtx('src/service.ts', code);
            const issues = analyzer.analyze(undefined, ctx);
            const floatIssue = issues.find((i) => i.rule === 'ERR-FLT-001');
            expect(floatIssue).toBeDefined();
        });
    });
});
