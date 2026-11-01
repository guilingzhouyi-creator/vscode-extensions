/**
 * Module: Unit Test — Concurrency & Asynchronous Lifecycle Analyzer Suite
 * File Path: tests/unit/analyzers/concurrency.test.ts
 * Architecture Role: Exercises ConcurrencyAnalyzer across lock boundaries (RSM-LOCK-001)
 *   and symmetric resource disposal (PRF-LEAK-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports ConcurrencyAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert RSM-LOCK-001 (lock across await) and PRF-LEAK-001 (event listener leak).
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ConcurrencyAnalyzer } from '../../../src/analyzers/concurrency';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ConcurrencyAnalyzer Suite', () => {
    const analyzer = new ConcurrencyAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits clean async functions with locks released before await', () => {
        const code = [
            'export async function safeUpdate(mutex: any): Promise<void> {',
            '    mutex.lock();',
            '    const data = 1;',
            '    mutex.unlock();',
            '    await fetch("/api/notify");',
            '}',
        ].join('\n');
        const ctx = createCtx('src/safe-concurrency.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags lock guard held across await boundary (RSM-LOCK-001)', () => {
        const code = [
            'export async function riskyTask(mutex: any): Promise<void> {',
            '    mutex.acquire();',
            '    await fetch("/api/remote-data");',
            '    mutex.release();',
            '}',
        ].join('\n');
        const ctx = createCtx('src/deadlock-risk.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const lockIssue = issues.find((i) => i.rule === 'RSM-LOCK-001');
        expect(lockIssue).toBeDefined();
        expect(lockIssue?.message).toContain('deadlock');
    });

    it('flags event listener registered without matching teardown/dispose (PRF-LEAK-001)', () => {
        const lines: string[] = [
            'export class EventBridge {',
            '    init(): void {',
            '        window.addEventListener("message", this.onMessage);',
            '    }',
            '    onMessage(): void {}',
        ];
        // Must exceed 30 lines to trigger PRF-LEAK-001
        for (let i = 0; i < 30; i++) {
            lines.push(`    helper_${i}() { return ${i}; }`);
        }
        lines.push('}');
        const ctx = createCtx('src/bridge.ts', lines.join('\n'));
        const issues = analyzer.analyze(undefined, ctx);
        const leakIssue = issues.find((i) => i.rule === 'PRF-LEAK-001');
        expect(leakIssue).toBeDefined();
        expect(leakIssue?.message).toContain('teardown/dispose');
    });

    it('permits event listener when matching dispose or removeEventListener exists', () => {
        const lines: string[] = [
            'export class SafeBridge {',
            '    init(): void {',
            '        window.addEventListener("message", this.onMessage);',
            '    }',
            '    dispose(): void {',
            '        window.removeEventListener("message", this.onMessage);',
            '    }',
        ];
        for (let i = 0; i < 30; i++) {
            lines.push(`    helper_${i}() { return ${i}; }`);
        }
        lines.push('}');
        const ctx = createCtx('src/safe-bridge.ts', lines.join('\n'));
        const issues = analyzer.analyze(undefined, ctx);
        const leakIssue = issues.find((i) => i.rule === 'PRF-LEAK-001');
        expect(leakIssue).toBeUndefined();
    });
});
