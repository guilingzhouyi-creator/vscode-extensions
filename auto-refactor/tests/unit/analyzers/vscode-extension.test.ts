/**
 * Module: Unit Test — VS Code Extension Domain Analyzer Suite (VSC-* Rules)
 * File Path: tests/unit/analyzers/vscode-extension.test.ts
 * Architecture Role: Exercises VscodeExtensionAnalyzer across Disposable leak checks (VSC-MEM-001)
 *   and main thread synchronous I/O blocking (VSC-PERF-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports VscodeExtensionAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert VSC-MEM-001 and VSC-PERF-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { VscodeExtensionAnalyzer } from '../../../src/analyzers/vscode-extension';
import type { AnalyzerContext } from '../../../src/core/types';

describe('VscodeExtensionAnalyzer Suite', () => {
    const analyzer = new VscodeExtensionAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits compliant VS Code command registration tracked in subscriptions', () => {
        const code = [
            'import * as vscode from "vscode";',
            'export function activate(context: vscode.ExtensionContext) {',
            '    const disposable = vscode.commands.registerCommand("ext.run", () => {});',
            '    context.subscriptions.push(disposable);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/extension.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const memIssues = issues.filter((i) => i.rule === 'VSC-MEM-001');
        expect(memIssues).toHaveLength(0);
    });

    it('flags uncollected Disposable registration risking extension memory leak (VSC-MEM-001)', () => {
        const code = [
            'import * as vscode from "vscode";',
            'export function activate(context: vscode.ExtensionContext) {',
            '    vscode.commands.registerCommand("ext.leak", () => {});',
            '    // no subscriptions.push',
            '    const unrelated = 123;',
            '    const unrelated2 = 456;',
            '    const unrelated3 = 789;',
            '    const unrelated4 = 101;',
            '    const unrelated5 = 102;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/extension.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const leakIssue = issues.find((i) => i.rule === 'VSC-MEM-001');
        expect(leakIssue).toBeDefined();
        expect(leakIssue?.message).toContain('Disposable');
    });

    it('flags synchronous fs blocking I/O on extension activation path (VSC-PERF-001)', () => {
        const code = [
            'import * as fs from "fs";',
            'export function loadConfig(path: string): string {',
            '    return fs.readFileSync(path, "utf8");',
            '}',
        ].join('\n');
        const ctx = createCtx('src/loader.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const perfIssue = issues.find((i) => i.rule === 'VSC-PERF-001');
        expect(perfIssue).toBeDefined();
        expect(perfIssue?.message).toContain('Synchronous file I/O');
    });
});
