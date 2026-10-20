/**
 * Module: Unit Test — Physical Hygiene & Formatting Contract Verification
 * File Path: tests/unit/physical-hygiene.test.ts
 * Architecture Role: Regression and boundary verification suite for physical hygiene rules
 * Dependencies & Triggers: Vitest test runner; imports HygieneAnalyzer from src/analyzers/hygiene
 * Responsibilities: Exhaustively test HYG-EMP-001 (0-byte empty file), HYG-EMP-002 (comment-only hollow),
 *   HYG-BOM-001 (UTF-8 BOM), HYG-TRL-001 (POSIX EOF newline contract), HYG-IND-001 (pure space indent),
 *   and HYG-EOL-001 (CRLF/LF platform contract).
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; 100% green pass.
 */

import { describe, it, expect } from 'vitest';
import { HygieneAnalyzer } from '../../src/analyzers/hygiene';
import type { AnalyzerContext } from '../../src/core/types';

function createMockContext(filePath: string, content: string): AnalyzerContext {
    return {
        filePath,
        content,
        options: {},
        config: {} as any,
    };
}

describe('HygieneAnalyzer: Physical Hygiene 8-Dimension Guard', () => {
    const analyzer = new HygieneAnalyzer();

    it('emits HYG-EMP-001 on 0-byte or whitespace-only files', () => {
        const issuesEmpty = analyzer.analyze(undefined, createMockContext('src/empty.ts', ''));
        expect(issuesEmpty.some((i) => i.rule === 'HYG-EMP-001')).toBe(true);

        const issuesWhitespace = analyzer.analyze(undefined, createMockContext('src/blank.ts', '   \n  \t  \n'));
        expect(issuesWhitespace.some((i) => i.rule === 'HYG-EMP-001')).toBe(true);
    });

    it('emits HYG-EMP-002 on comment-only hollow files', () => {
        const commentOnlyTs = `
            /**
             * Module: Comment only
             * This file has no executable code.
             */
            // Another single line comment
            /* Inline comment block */
        \n`;
        const issues = analyzer.analyze(undefined, createMockContext('src/hollow.ts', commentOnlyTs));
        expect(issues.some((i) => i.rule === 'HYG-EMP-002')).toBe(true);

        // Markdown files and .d.ts should be exempt
        const issuesMd = analyzer.analyze(undefined, createMockContext('docs/readme.md', '# Just Markdown\n\nDocs here.\n'));
        expect(issuesMd.some((i) => i.rule === 'HYG-EMP-002')).toBe(false);

        const issuesDts = analyzer.analyze(undefined, createMockContext('src/types.d.ts', '// Type declaration stub\n'));
        expect(issuesDts.some((i) => i.rule === 'HYG-EMP-002')).toBe(false);
    });

    it('emits HYG-BOM-001 when UTF-8 BOM prefix is detected', () => {
        const bomContent = '\uFEFFexport const value = 42;\n';
        const issues = analyzer.analyze(undefined, createMockContext('src/bom-file.ts', bomContent));
        expect(issues.some((i) => i.rule === 'HYG-BOM-001')).toBe(true);

        const cleanContent = 'export const value = 42;\n';
        const cleanIssues = analyzer.analyze(undefined, createMockContext('src/clean.ts', cleanContent));
        expect(cleanIssues.some((i) => i.rule === 'HYG-BOM-001')).toBe(false);
    });

    it('emits HYG-TRL-001 when EOF newline is missing or excess blank lines accumulate', () => {
        // Missing newline at EOF
        const missingEof = 'export const a = 1;';
        const issuesMissing = analyzer.analyze(undefined, createMockContext('src/no-eof.ts', missingEof));
        expect(issuesMissing.some((i) => i.rule === 'HYG-TRL-001')).toBe(true);

        // Excess trailing blank lines
        const excessTrailing = 'export const a = 1;\n\n\n';
        const issuesExcess = analyzer.analyze(undefined, createMockContext('src/excess-eof.ts', excessTrailing));
        expect(issuesExcess.some((i) => i.rule === 'HYG-TRL-001')).toBe(true);

        // Standard single newline
        const cleanEof = 'export const a = 1;\n';
        const issuesClean = analyzer.analyze(undefined, createMockContext('src/clean-eof.ts', cleanEof));
        expect(issuesClean.some((i) => i.rule === 'HYG-TRL-001')).toBe(false);
    });

    it('emits HYG-IND-001 when tab character indentation is present in space-indented files', () => {
        const tabIndentedCode = 'function test() {\n\tconst x = 1;\n\treturn x;\n}\n';
        const issues = analyzer.analyze(undefined, createMockContext('src/tabbed.ts', tabIndentedCode));
        expect(issues.some((i) => i.rule === 'HYG-IND-001')).toBe(true);

        // GDScript should be exempt from tab prohibition
        const gdscriptTab = 'extends Node\n\nfunc _ready():\n\tpass\n';
        const issuesGd = analyzer.analyze(undefined, createMockContext('scripts/game.gd', gdscriptTab));
        expect(issuesGd.some((i) => i.rule === 'HYG-IND-001')).toBe(false);
    });

    it('emits HYG-EOL-001 when line endings violate CRLF for PowerShell and LF for others', () => {
        // PS1 with LF
        const ps1WithLf = 'Write-Host "Hello"\nWrite-Host "World"\n';
        const issuesPs1 = analyzer.analyze(undefined, createMockContext('scripts/run.ps1', ps1WithLf));
        expect(issuesPs1.some((i) => i.rule === 'HYG-EOL-001')).toBe(true);

        // TS with CRLF
        const tsWithCrlf = 'export const x = 1;\r\nexport const y = 2;\r\n';
        const issuesTs = analyzer.analyze(undefined, createMockContext('src/code.ts', tsWithCrlf));
        expect(issuesTs.some((i) => i.rule === 'HYG-EOL-001')).toBe(true);
    });

    it('emits HYG-CLT-001 on uncontrolled transient or system clutter files', () => {
        const issuesLog = analyzer.analyze(undefined, createMockContext('build.log', 'Log output here\n'));
        expect(issuesLog.some((i) => i.rule === 'HYG-CLT-001')).toBe(true);

        const issuesTmp = analyzer.analyze(undefined, createMockContext('src/data.tmp', 'temporary data\n'));
        expect(issuesTmp.some((i) => i.rule === 'HYG-CLT-001')).toBe(true);

        const issuesActual = analyzer.analyze(undefined, createMockContext('test.actual.json', '{"test": 1}\n'));
        expect(issuesActual.some((i) => i.rule === 'HYG-CLT-001')).toBe(true);

        const issuesDsStore = analyzer.analyze(undefined, createMockContext('.DS_Store', 'binary\n'));
        expect(issuesDsStore.some((i) => i.rule === 'HYG-CLT-001')).toBe(true);
    });

    it('emits EXT-DIR-001 on root directory script pollution while exempting standard configs and entrypoints', () => {
        // Flat scripts in root directory violate EXT-DIR-001
        const issuesRootJs = analyzer.analyze(undefined, createMockContext('test-probe.js', 'console.log("probe");\n'));
        expect(issuesRootJs.some((i) => i.rule === 'EXT-DIR-001')).toBe(true);

        const issuesRootPs1 = analyzer.analyze(undefined, createMockContext('temp-run.ps1', 'Write-Host "test"\r\n'));
        expect(issuesRootPs1.some((i) => i.rule === 'EXT-DIR-001')).toBe(true);

        // Scripts in subdirectories are allowed
        const issuesSubdir = analyzer.analyze(undefined, createMockContext('scripts/common/helper.js', 'console.log("ok");\n'));
        expect(issuesSubdir.some((i) => i.rule === 'EXT-DIR-001')).toBe(false);

        // Standard root config files and entrypoints are exempt
        const issuesConfig = analyzer.analyze(undefined, createMockContext('vite.config.ts', 'export default {};\n'));
        expect(issuesConfig.some((i) => i.rule === 'EXT-DIR-001')).toBe(false);

        const issuesEslint = analyzer.analyze(undefined, createMockContext('eslint.config.js', 'module.exports = {};\n'));
        expect(issuesEslint.some((i) => i.rule === 'EXT-DIR-001')).toBe(false);

        const issuesDot = analyzer.analyze(undefined, createMockContext('.eslintrc.js', 'module.exports = {};\n'));
        expect(issuesDot.some((i) => i.rule === 'EXT-DIR-001')).toBe(false);

        const issuesIndex = analyzer.analyze(undefined, createMockContext('index.ts', 'export const api = 1;\n'));
        expect(issuesIndex.some((i) => i.rule === 'EXT-DIR-001')).toBe(false);
    });
});
