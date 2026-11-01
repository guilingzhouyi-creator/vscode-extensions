/**
 * Module: Unit Test — Secrets & Credential Leak Analyzer Suite
 * File Path: tests/unit/analyzers/secrets.test.ts
 * Architecture Role: Exercises SecretsAnalyzer across hardcoded tokens, API keys,
 *   private keys, and high-entropy secrets.
 * Dependencies & Triggers: vitest (describe, it, expect); imports SecretsAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert secret-detected and high-entropy-token detection.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests with zero disk I/O.
 */

import { describe, it, expect } from 'vitest';
import { SecretsAnalyzer } from '../../../src/analyzers/secrets';
import type { AnalyzerContext } from '../../../src/core/types';

describe('SecretsAnalyzer Suite', () => {
    const analyzer = new SecretsAnalyzer();

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

    it('permits clean source code without secrets', () => {
        const code = [
            'export const API_BASE_URL = "https://api.example.com/v1";',
            'export function getHeader(): Record<string, string> {',
            '    return { "Content-Type": "application/json" };',
            '}',
        ].join('\n');
        const ctx = createCtx('src/client.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags hardcoded private key block (secret-detected)', () => {
        const code = [
            'const privateKey = `-----BEGIN RSA PRIVATE KEY----- // test-secret placeholder',
            'MIIEowIBAAKCAQEA0Y1+...',
            '-----END RSA PRIVATE KEY-----`;',
        ].join('\n');
        const ctx = createCtx('src/crypto.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const secretIssue = issues.find((i) => i.rule === 'secret-detected');
        expect(secretIssue).toBeDefined();
        expect(secretIssue?.severity).toBe('error');
    });

    it('flags high-entropy token (high-entropy-token or secret-detected)', () => {
        const code = [
            'const secretKey = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd"; // test-secret placeholder',
        ].join('\n');
        const ctx = createCtx('src/auth.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].rule).toMatch(/secret-detected|high-entropy-token/);
    });

    it('skips test files when scanTests is false', () => {
        const code = 'const fakeSecret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcd"; // test-secret placeholder';
        const ctx = createCtx('tests/unit/auth.test.ts', code, { scanTests: false });
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });
});
