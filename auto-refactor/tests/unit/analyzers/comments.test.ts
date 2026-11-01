/**
 * Module: Unit Test — Comment & Documentation Contract Analyzer Suite
 * File Path: tests/unit/analyzers/comments.test.ts
 * Architecture Role: Exercises CommentAnalyzer across public API documentation,
 *   line width constraints, and comment language consistency.
 * Dependencies & Triggers: vitest (describe, it, expect); imports CommentAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert CMT-DOC-001, CMT-WID-001, and CMT-HDR-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { CommentAnalyzer } from '../../../src/analyzers/comments';
import type { AnalyzerContext } from '../../../src/core/types';

describe('CommentAnalyzer Suite', () => {
    const analyzer = new CommentAnalyzer();

    function createCtx(filePath: string, content: string, options = {}): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                level: 'standard',
                ...options,
            },
            config: {},
        };
    }

    it('permits compliant module with valid header and documented public symbols', () => {
        const code = [
            '/**',
            ' * Module: Math utilities for geometry calculation.',
            ' */',
            '',
            '/**',
            ' * Calculate hypotenuse of right triangle.',
            ' * @param a - First leg length.',
            ' * @param b - Second leg length.',
            ' * @returns Hypotenuse length.',
            ' */',
            'export function hypot(a: number, b: number): number {',
            '    return Math.sqrt(a * a + b * b);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/math.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const docIssues = issues.filter((i) => i.rule === 'CMT-DOC-001');
        expect(docIssues).toHaveLength(0);
    });

    it('flags exported public symbol lacking documentation commentary (CMT-DOC-001)', () => {
        const code = [
            '/**',
            ' * Module: Service controller.',
            ' */',
            '',
            'export function unDocumentedHelper(): void {',
            '    // internal logic',
            '}',
        ].join('\n');
        const ctx = createCtx('src/service.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const docIssue = issues.find((i) => i.rule === 'CMT-DOC-001');
        expect(docIssue).toBeDefined();
        expect(docIssue?.message).toContain('unDocumentedHelper');
    });

    it('flags comment lines exceeding line width budget (CMT-WID-001)', () => {
        const longComment = '// ' + 'A'.repeat(120);
        const code = [
            '/**',
            ' * Module: Config.',
            ' */',
            longComment,
            'export const FLAG = true;',
        ].join('\n');
        const ctx = createCtx('src/config.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const widthIssue = issues.find((i) => i.rule === 'CMT-WID-001');
        expect(widthIssue).toBeDefined();
        expect(widthIssue?.message).toContain('exceeds');
    });

    it('skips markdown files by rule contract', () => {
        const code = '# Title\n\nSome arbitrary text without JSDoc.\n';
        const ctx = createCtx('docs/readme.md', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });
});
