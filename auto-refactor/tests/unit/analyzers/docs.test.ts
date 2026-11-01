/**
 * Module: Unit Test — Documentation & Markdown Reference Analyzer Suite (DOC-* Rules)
 * File Path: tests/unit/analyzers/docs.test.ts
 * Architecture Role: Exercises DocsAnalyzer across unbalanced code fences,
 *   dead path links, and non-markdown bypass contracts.
 * Dependencies & Triggers: vitest (describe, it, expect); imports DocsAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert DOC-FEN-001 (unbalanced fence) and markdown-only processing.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { DocsAnalyzer } from '../../../src/analyzers/docs';
import type { AnalyzerContext } from '../../../src/core/types';

describe('DocsAnalyzer Suite', () => {
    const analyzer = new DocsAnalyzer();

    function createCtx(filePath: string, content: string, options = {}): AnalyzerContext {
        return {
            filePath,
            content,
            options,
            config: {
                root: process.cwd(),
            },
        };
    }

    it('permits compliant markdown with balanced fences and valid prose', () => {
        const doc = [
            '# Architecture Overview',
            '',
            '```ts',
            'export const x = 1;',
            '```',
            '',
            'The module above exposes constant x.',
        ].join('\n');
        const ctx = createCtx('docs/arch.md', doc);
        const issues = analyzer.analyze(undefined, ctx);
        const fenceIssues = issues.filter((i) => i.rule === 'DOC-FEN-001');
        expect(fenceIssues).toHaveLength(0);
    });

    it('flags unbalanced code fence that is never closed (DOC-FEN-001)', () => {
        const doc = [
            '# Unclosed Section',
            '',
            '```ts',
            'export function broken(): void {',
            '',
            'Later prose swallowed into unclosed block...',
        ].join('\n');
        const ctx = createCtx('docs/unclosed.md', doc);
        const issues = analyzer.analyze(undefined, ctx);
        const fenceIssue = issues.find((i) => i.rule === 'DOC-FEN-001');
        expect(fenceIssue).toBeDefined();
        expect(fenceIssue?.severity).toBe('error');
        expect(fenceIssue?.message).toContain('Unbalanced code fence');
    });

    it('bypasses non-markdown source files by extension check', () => {
        const code = '```unbalanced in ts source';
        const ctx = createCtx('src/index.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });
});
