/**
 * Module: Unit Test — Core Governance & Multi-Language Quality Rules Analyzer Suite
 * File Path: tests/unit/analyzers/governance.test.ts
 * Architecture Role: Exercises GovernanceAnalyzer across data clumps (GOV-DAT-001)
 *   and swallowed exception safety (ERR-SWL-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports GovernanceAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert GOV-DAT-001 and exception safety rules in standalone mode.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 20ms.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { GovernanceAnalyzer } from '../../../src/analyzers/governance';
import type { AnalyzerContext } from '../../../src/core/types';

describe('GovernanceAnalyzer Suite', () => {
    const analyzer = new GovernanceAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        const sourceFile = ts.createSourceFile(
            filePath,
            content,
            ts.ScriptTarget.Latest,
            true,
        );
        return {
            filePath,
            content,
            sourceFile,
            options: {},
            config: {
                analyzers: {
                    governance: { options: {} },
                },
            },
        };
    }

    it('permits clean TypeScript code adhering to all governance standards', () => {
        const code = [
            'export interface UserOptions {',
            '    name: string;',
            '    age: number;',
            '}',
            '',
            'export function registerUser(options: UserOptions): boolean {',
            '    return options.age >= 18;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/users.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags functions with excessive discrete scalar parameters (GOV-DAT-001)', () => {
        const code = [
            'export function createServer(',
            '    host: string,',
            '    port: number,',
            '    timeout: number,',
            '    retries: number,',
            '    secure: boolean,',
            '): void {',
            '    console.log(host, port, timeout, retries, secure);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/server.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        const clumpIssue = issues.find((i) => i.rule === 'GOV-DAT-001');
        expect(clumpIssue).toBeDefined();
        expect(clumpIssue?.message).toContain('parameters');
    });

    it('flags empty catch block with swallowed exception (GOV-EXC-001)', () => {
        const code = [
            'export function runRiskyTask(): void {',
            '    try {',
            '        JSON.parse("invalid");',
            '    } catch (e) {',
            '    }',
            '}',
        ].join('\n');
        const ctx = createCtx('src/task.ts', code);
        const issues = analyzer.analyze(ctx.sourceFile!, ctx);
        const swlIssue = issues.find((i) => i.rule === 'GOV-EXC-001');
        expect(swlIssue).toBeDefined();
        expect(swlIssue?.message).toContain('catch');
    });
});
