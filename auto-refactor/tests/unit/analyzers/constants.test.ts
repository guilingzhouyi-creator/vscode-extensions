/**
 * Module: Unit Test — Constants & Literal Discipline Analyzer Suite
 * File Path: tests/unit/analyzers/constants.test.ts
 * Architecture Role: Exercises ConstantsAnalyzer across hardcoded strings,
 *   duplicate literals, and unextracted magic numbers.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ConstantsAnalyzer and ts;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert hardcoded-string, duplicate-literal, and magic-number rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 15ms.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { ConstantsAnalyzer } from '../../../src/analyzers/constants';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ConstantsAnalyzer Suite', () => {
    const analyzer = new ConstantsAnalyzer();

    function createCtx(filePath: string, content: string, options = {}): { sourceFile: ts.SourceFile; ctx: AnalyzerContext } {
        const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
        const ctx: AnalyzerContext = {
            filePath,
            content,
            options: {
                flagHardcodedStrings: true,
                flagMagicNumbers: true,
                flagDuplicates: true,
                duplicateThreshold: 3,
                ...options,
            },
            config: {},
        };
        return { sourceFile, ctx };
    }

    it('permits named constant declarations without flagging them as hardcoded', () => {
        const code = [
            'export const DEFAULT_TIMEOUT_MS = 5000;',
            'export const AUTH_HEADER_BEARER = "Bearer ";',
        ].join('\n');
        const { sourceFile, ctx } = createCtx('src/constants.ts', code);
        const issues = analyzer.analyze(sourceFile, ctx);
        const hardcodedIssues = issues.filter((i) => i.rule === 'hardcoded-string');
        expect(hardcodedIssues).toHaveLength(0);
    });

    it('flags unextracted hardcoded string inside function body (hardcoded-string)', () => {
        const code = [
            'export function getApiEndpoint(): string {',
            '    return "https://production.api.internal.service/v2/gateway/ingress";',
            '}',
        ].join('\n');
        const { sourceFile, ctx } = createCtx('src/client.ts', code);
        const issues = analyzer.analyze(sourceFile, ctx);
        const strIssue = issues.find((i) => i.rule === 'hardcoded-string');
        expect(strIssue).toBeDefined();
        expect(strIssue?.message).toContain('Hardcoded string');
    });

    it('flags repeated literal occurrences exceeding duplicate threshold (duplicate-literal)', () => {
        const code = [
            'export function handleStatus(code: number): string {',
            '    if (code === 1) return "application/json";',
            '    if (code === 2) return "application/json";',
            '    if (code === 3) return "application/json";',
            '    return "application/json";',
            '}',
        ].join('\n');
        const { sourceFile, ctx } = createCtx('src/handler.ts', code, { duplicateThreshold: 2 });
        const issues = analyzer.analyze(sourceFile, ctx);
        const dupIssue = issues.find((i) => i.rule === 'duplicate-literal');
        expect(dupIssue).toBeDefined();
        expect(dupIssue?.message).toContain('repeated');
    });

    it('flags unnamed magic numbers in algorithmic logic (magic-number)', () => {
        const code = [
            'export function computeBackoff(attempt: number): number {',
            '    return attempt * 86400;',
            '}',
        ].join('\n');
        const { sourceFile, ctx } = createCtx('src/backoff.ts', code, { minMagicNumber: 100 });
        const issues = analyzer.analyze(sourceFile, ctx);
        const numIssue = issues.find((i) => i.rule === 'magic-number');
        expect(numIssue).toBeDefined();
        expect(numIssue?.message).toContain('Magic number 86400');
    });
});
