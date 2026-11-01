/**
 * Module: Unit Test — Production Build Hygiene & Exposure Analyzer Suite (PROD-HYG-* Rules)
 * File Path: tests/unit/analyzers/production-hygiene.test.ts
 * Architecture Role: Exercises ProductionHygieneAnalyzer across debug residues,
 *   source map leakage, and client secret variable exposures.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ProductionHygieneAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert PROD-HYG-001, PROD-HYG-002, and PROD-HYG-003.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ProductionHygieneAnalyzer } from '../../../src/analyzers/production-hygiene';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ProductionHygieneAnalyzer Suite', () => {
    const analyzer = new ProductionHygieneAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits clean production minified script without leaks', () => {
        const code = 'var a=function(){return 42;};export default a;\n';
        const ctx = createCtx('dist/bundle.min.js', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags debug residue and absolute path leaks in production artifacts (PROD-HYG-001)', () => {
        const code = [
            'function run() {',
            '    console.debug("debugging internal payload");',
            '    const p = "/Users/developer/workspace/app.js";',
            '}',
        ].join('\n');
        const ctx = createCtx('dist/app.min.js', code);
        const issues = analyzer.analyze(undefined, ctx);
        const residueIssues = issues.filter((i) => i.rule === 'PROD-HYG-001');
        expect(residueIssues.length).toBeGreaterThan(0);
    });

    it('flags public sourceMappingURL directive in production build (PROD-HYG-002)', () => {
        const code = [
            'function bundle() { return true; }',
            '//# sourceMappingURL=bundle.js.map',
        ].join('\n');
        const ctx = createCtx('dist/bundle.min.js', code);
        const issues = analyzer.analyze(undefined, ctx);
        const mapIssue = issues.find((i) => i.rule === 'PROD-HYG-002');
        expect(mapIssue).toBeDefined();
        expect(mapIssue?.severity).toBe('error');
    });

    it('flags backend environment secret exposure in frontend client code (PROD-HYG-003)', () => {
        const code = [
            'export function getSecretToken(): string {',
            '    return process.env.DATABASE_URL || "";',
            '}',
        ].join('\n');
        const ctx = createCtx('src/components/profile-card.tsx', code);
        const issues = analyzer.analyze(undefined, ctx);
        const envIssue = issues.find((i) => i.rule === 'PROD-HYG-003');
        expect(envIssue).toBeDefined();
        expect(envIssue?.severity).toBe('error');
        expect(envIssue?.message).toContain('DATABASE_URL');
    });
});
