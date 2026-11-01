/**
 * Module: Unit Test — Large File & Volume Analyzer Suite
 * File Path: tests/unit/analyzers/large-file.test.ts
 * Architecture Role: Exercises LargeFileAnalyzer across physical LOC, ELOC ceilings,
 *   and density envelope constraints.
 * Dependencies & Triggers: vitest (describe, it, expect); imports LargeFileAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert large-file detection on oversized files and compliance on standard files.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 15ms.
 */

import { describe, it, expect } from 'vitest';
import { LargeFileAnalyzer } from '../../../src/analyzers/large-file';
import type { AnalyzerContext } from '../../../src/core/types';

describe('LargeFileAnalyzer Suite', () => {
    const analyzer = new LargeFileAnalyzer();

    function createCtx(filePath: string, content: string, options = {}): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                fileLinesWarn: 20,
                fileLinesFail: 50,
                fileFunctionsWarn: 5,
                ...options,
            },
            config: {},
        };
    }

    it('permits compact module within configured thresholds', () => {
        const code = [
            'export function hello(): string {',
            '    return "world";',
            '}',
        ].join('\n');
        const ctx = createCtx('src/hello.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const volumeIssues = issues.filter((i) => i.rule === 'large-file' || i.rule.startsWith('VOL-'));
        expect(volumeIssues).toHaveLength(0);
    });

    it('flags oversized file exceeding line thresholds', () => {
        const lines: string[] = ['// Oversized file test header'];
        for (let i = 0; i < 30; i++) {
            lines.push(`export function fn_${i}(): number { return ${i}; }`);
        }
        const code = lines.join('\n');
        const ctx = createCtx('src/huge-module.ts', code, { fileLinesWarn: 15, fileFunctionsWarn: 3 });
        const issues = analyzer.analyze(undefined, ctx);
        const volumeIssues = issues.filter((i) => i.rule === 'large-file' || i.rule.startsWith('VOL-'));
        expect(volumeIssues.length).toBeGreaterThan(0);
        expect(volumeIssues[0].severity).toBe('warning');
    });

    it('skips markdown documentation files by extension exemption', () => {
        const lines: string[] = ['# Architecture Document'];
        for (let i = 0; i < 100; i++) {
            lines.push(`Line ${i}: detailed description of architecture.`);
        }
        const code = lines.join('\n');
        const ctx = createCtx('docs/arch.md', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });
});
