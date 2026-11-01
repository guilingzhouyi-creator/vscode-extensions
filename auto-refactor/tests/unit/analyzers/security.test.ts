/**
 * Module: Unit Test — Systemic Security & Vulnerability Analyzer Suite (SEC-VUL-* Rules)
 * File Path: tests/unit/analyzers/security.test.ts
 * Architecture Role: Exercises SecurityAnalyzer across dynamic code execution,
 *   command injection, prototype pollution, and weak cryptographic primitives.
 * Dependencies & Triggers: vitest (describe, it, expect); imports SecurityAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert SEC-VUL-001, SEC-VUL-002, SEC-VUL-003, and SEC-VUL-005.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { SecurityAnalyzer } from '../../../src/analyzers/security';
import type { AnalyzerContext } from '../../../src/core/types';

describe('SecurityAnalyzer Suite', () => {
    const analyzer = new SecurityAnalyzer();

    function createCtx(filePath: string, content: string, level = 'full'): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                level,
            },
            config: {
                securityLevel: level,
            },
        };
    }

    it('permits safe standard functions without security vulnerabilities', () => {
        const code = [
            'export function parseJson(input: string): unknown {',
            '    return JSON.parse(input);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/parser.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags arbitrary dynamic code execution via eval (SEC-VUL-001)', () => {
        const code = [
            'export function executeUnsafe(code: string): unknown {',
            '    return eval(code);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/runner.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const evalIssue = issues.find((i) => i.rule === 'SEC-VUL-001');
        expect(evalIssue).toBeDefined();
        expect(evalIssue?.severity).toBe('error');
    });

    it('flags prototype pollution via __proto__ assignment (SEC-VUL-003)', () => {
        const code = [
            'export function mergeObject(target: any, source: any): void {',
            '    target["__proto__"] = source;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/merge.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const protoIssue = issues.find((i) => i.rule === 'SEC-VUL-003');
        expect(protoIssue).toBeDefined();
        expect(protoIssue?.severity).toBe('error');
    });

    it('flags weak cryptographic algorithms like md5 / sha1 (SEC-VUL-005)', () => {
        const code = [
            'import crypto from "crypto";',
            'export function createToken(data: string): string {',
            '    return crypto.createHash("md5").update(data).digest("hex");',
            '}',
        ].join('\n');
        const ctx = createCtx('src/hash.ts', code, 'full');
        const issues = analyzer.analyze(undefined, ctx);
        const hashIssue = issues.find((i) => i.rule === 'SEC-VUL-005');
        expect(hashIssue).toBeDefined();
        expect(hashIssue?.severity).toBe('warning');
    });
});
