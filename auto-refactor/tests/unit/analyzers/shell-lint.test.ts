/**
 * Module: Unit Test — Shell Lint Analyzer Suite (SH-* and PS-* Rules)
 * File Path: tests/unit/analyzers/shell-lint.test.ts
 * Architecture Role: Exercises ShellLintAnalyzer line scanner across POSIX shell
 *   and PowerShell script conventions.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ShellLintAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert SH-INIT-001, SH-ERR-001, SH-CMD-001, PS-ALIAS-001,
 *   and PS-PARAM-001.
 * Exit Semantics & Design Rationale: In-memory pure line scan tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ShellLintAnalyzer } from '../../../src/analyzers/shell-lint';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ShellLintAnalyzer Suite', () => {
    const analyzer = new ShellLintAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    describe('POSIX Shell Discipline (SH-INIT-001 / SH-ERR-001 / SH-CMD-001)', () => {
        it('flags missing shebang in shell scripts', () => {
            const code = [
                'set -euo pipefail',
                'echo "Starting build..."',
            ].join('\n');
            const ctx = createCtx('scripts/deploy.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            const shebangIssue = issues.find((i) => i.rule === 'SH-INIT-001');
            expect(shebangIssue).toBeDefined();
            expect(shebangIssue?.message).toContain('shebang');
        });

        it('flags missing set -euo pipefail in shell scripts', () => {
            const code = [
                '#!/usr/bin/env bash',
                'echo "Running task..."',
            ].join('\n');
            const ctx = createCtx('scripts/build.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            const errIssue = issues.find((i) => i.rule === 'SH-ERR-001');
            expect(errIssue).toBeDefined();
            expect(errIssue?.message).toContain('strict error handling');
        });

        it('flags cd command without error recovery check', () => {
            const code = [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                'cd /tmp/workspace',
                'make build',
            ].join('\n');
            const ctx = createCtx('scripts/run.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            const cdIssue = issues.find((i) => i.rule === 'SH-CMD-001');
            expect(cdIssue).toBeDefined();
            expect(cdIssue?.message).toContain('cd');
        });

        it('permits compliant shell script with shebang, error trap, and cd check', () => {
            const code = [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                'cd /tmp/workspace || exit 1',
                'printf "%s\\n" "Done"',
            ].join('\n');
            const ctx = createCtx('scripts/clean.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            expect(issues.filter((i) => i.severity === 'error' || i.rule === 'SH-INIT-001' || i.rule === 'SH-ERR-001')).toHaveLength(0);
        });
    });

    describe('PowerShell Script Discipline (PS-ALIAS-001 / PS-PARAM-001)', () => {
        it('flags prohibited PowerShell alias usage (echo, gc, ls, cat)', () => {
            const code = [
                '[CmdletBinding()]',
                'param()',
                '# Synopsis header',
                'echo message',
            ].join('\n');
            const ctx = createCtx('scripts/task.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const aliasIssue = issues.find((i) => i.rule === 'PS-ALIAS-001');
            expect(aliasIssue).toBeDefined();
            expect(aliasIssue?.message).toContain('Write-Output');
        });

        it('flags untyped PowerShell parameter declarations inside functions', () => {
            const code = [
                'function Invoke-Build {',
                '    param(',
                '        $TargetDir,',
                '        $VerboseMode = $false',
                '    )',
                '    Write-Output "Building"',
                '}',
            ].join('\n');
            const ctx = createCtx('scripts/setup.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const paramIssue = issues.find((i) => i.rule === 'PS-PARAM-001');
            expect(paramIssue).toBeDefined();
            expect(paramIssue?.message).toContain('type annotation');
        });

        it('permits compliant strongly-typed PowerShell parameter', () => {
            const code = [
                'function Invoke-Build {',
                '    [CmdletBinding()]',
                '    param(',
                '        [string]$TargetDir',
                '    )',
                '    Write-Output "Configured"',
                '}',
            ].join('\n');
            const ctx = createCtx('scripts/valid.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const paramIssue = issues.find((i) => i.rule === 'PS-PARAM-001');
            expect(paramIssue).toBeUndefined();
        });
    });
});
