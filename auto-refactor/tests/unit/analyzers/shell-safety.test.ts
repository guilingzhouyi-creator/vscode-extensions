/**
 * Module: Unit Test — Shell Safety Analyzer Suite (GUARD-DESTR-001 & GUARD-VAR-001)
 * File Path: tests/unit/analyzers/shell-safety.test.ts
 * Architecture Role: Exercises ShellSafetyAnalyzer taint tracking across destructive file operations
 *   and automatic-variable shadow protections.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ShellSafetyAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert GUARD-DESTR-001 (dangerous recursive deletion) and GUARD-VAR-001
 *   (read-only automatic variable mutation).
 * Exit Semantics & Design Rationale: Pure in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ShellSafetyAnalyzer } from '../../../src/analyzers/shell-safety';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ShellSafetyAnalyzer Suite', () => {
    const analyzer = new ShellSafetyAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                checkDestructiveOperands: true,
                checkAutomaticVariables: true,
            },
            config: {},
        };
    }

    describe('Destructive Operand Safety (GUARD-DESTR-001)', () => {
        it('flags recursive deletion with root operand in shell script', () => {
            const code = [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                'rm -rf /',
            ].join('\n');
            const ctx = createCtx('scripts/clean.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            const destrIssue = issues.find((i) => i.rule === 'GUARD-DESTR-001');
            expect(destrIssue).toBeDefined();
            expect(destrIssue?.severity).toBe('error');
        });

        it('flags Remove-Item with dangerous root or unanchored path in PowerShell', () => {
            const code = [
                '$ErrorActionPreference = "Stop"',
                'Remove-Item -Recurse -Force /',
            ].join('\n');
            const ctx = createCtx('scripts/clean.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const destrIssue = issues.find((i) => i.rule === 'GUARD-DESTR-001');
            expect(destrIssue).toBeDefined();
            expect(destrIssue?.severity).toBe('error');
        });

        it('permits safe literal relative target cleanup', () => {
            const code = [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                'rm -rf ./tmp/build-cache',
            ].join('\n');
            const ctx = createCtx('scripts/safe-clean.sh', code);
            const issues = analyzer.analyze(undefined, ctx);
            const destrIssue = issues.find((i) => i.rule === 'GUARD-DESTR-001');
            expect(destrIssue).toBeUndefined();
        });
    });

    describe('PowerShell Automatic Variable Protection (GUARD-VAR-001)', () => {
        it('flags assignment to PowerShell automatic read-only variable ($PID)', () => {
            const code = [
                '$ErrorActionPreference = "Stop"',
                '$PID = 12345',
            ].join('\n');
            const ctx = createCtx('scripts/process.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const varIssue = issues.find((i) => i.rule === 'GUARD-VAR-001');
            expect(varIssue).toBeDefined();
            expect(varIssue?.severity).toBe('error');
            expect(varIssue?.message).toContain('$PID');
        });

        it('flags assignment to PowerShell automatic read-only variable ($HOME)', () => {
            const code = [
                '$ErrorActionPreference = "Stop"',
                '$HOME = "/custom/home"',
            ].join('\n');
            const ctx = createCtx('scripts/env.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const varIssue = issues.find((i) => i.rule === 'GUARD-VAR-001');
            expect(varIssue).toBeDefined();
            expect(varIssue?.severity).toBe('error');
            expect(varIssue?.message).toContain('$HOME');
        });

        it('permits standard user variable assignments', () => {
            const code = [
                '$ErrorActionPreference = "Stop"',
                '$MyCustomPath = "/tmp/data"',
                'Write-Output $MyCustomPath',
            ].join('\n');
            const ctx = createCtx('scripts/user.ps1', code);
            const issues = analyzer.analyze(undefined, ctx);
            const varIssue = issues.find((i) => i.rule === 'GUARD-VAR-001');
            expect(varIssue).toBeUndefined();
        });
    });
});
