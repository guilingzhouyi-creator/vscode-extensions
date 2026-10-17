/**
 * Module: Unit Test — Declarative Modern Language Pack Metapack
 * File Path: tests/unit/declarative-modern-pack.test.ts
 * Architecture Role: Comprehensive unit test suite for DeclarativeModernAnalyzer,
 *     ensuring extension filtering, masking, condition evaluation, actionable payload
 *     injection, and multi-line hooks behave with 100% determinism.
 * Dependencies & Triggers: `npx vitest run tests/unit/declarative-modern-pack.test.ts`;
 *     imports DeclarativeModernAnalyzer and core types.
 * Responsibilities: Prove functional correctness and parity of declarative modern packs.
 * Exit Semantics & Design Rationale: Standard Vitest assertions; exits 0 on PASS.
 */

import { describe, expect, it } from 'vitest';
import {
    DeclarativeModernAnalyzer,
    type DeclarativeModernPackConfig,
    type LineScanContext,
} from '../../src/analyzers/declarative-modern-pack';
import { SEVERITY_WARNING, SEVERITY_INFO, type AnalyzerContext } from '../../src/core/types';

describe('DeclarativeModernAnalyzer', () => {
    const TEST_CONFIG: DeclarativeModernPackConfig = {
        analyzerId: 'test-modern',
        fileExtensions: ['.mock', '.testlang'],
        maskConfig: {
            lineComment: '//',
            quoteChars: '"',
        },
        rules: [
            {
                rule: 'TM-ERR-001',
                severity: SEVERITY_WARNING,
                message: 'Deprecated call used',
                suggestion: 'Replace with modern equivalent',
                pattern: /\bdeprecatedCall\(\)/,
                actionable: {
                    action: 'simplify_control_flow',
                    codeId: '001',
                    templateSnippet: 'modernCall()',
                    autoSafe: true,
                },
            },
            {
                rule: 'TM-SUP-001',
                severity: SEVERITY_INFO,
                message: 'Flag with suppression',
                suggestion: 'Check safety',
                pattern: /\bdangerousFlag\b/,
                negativePattern: /safeContext/,
            },
            {
                rule: 'TM-COND-001',
                severity: SEVERITY_INFO,
                message: 'Custom condition violation',
                suggestion: 'Fix indentation',
                condition: (ctx: LineScanContext) => ctx.trimmed.startsWith('forbiddenPrefix'),
            },
        ],
    };

    it('ignores files with non-matching extensions', () => {
        const analyzer = new DeclarativeModernAnalyzer(TEST_CONFIG);
        const ctx: AnalyzerContext = {
            filePath: 'src/main.ts',
            content: 'deprecatedCall();',
            projectRoot: '/test',
            options: {},
        };
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('detects pattern violations and attaches canonical actionable payloads', () => {
        const analyzer = new DeclarativeModernAnalyzer(TEST_CONFIG);
        const ctx: AnalyzerContext = {
            filePath: 'src/main.mock',
            content: '// deprecatedCall(); in comment\nconst x = deprecatedCall();',
            projectRoot: '/test',
            options: {},
        };
        const issues = analyzer.analyze(undefined, ctx);

        expect(issues).toHaveLength(1);
        const [issue] = issues;
        expect(issue.rule).toBe('TM-ERR-001');
        expect(issue.location.start.line).toBe(2);
        expect(issue.actionable).toBeDefined();
        expect(issue.actionable?.code).toBe('AR:TM:001');
        expect(issue.actionable?.templateSnippet).toBe('modernCall()');
        expect(issue.actionable?.safeToAutomate).toBe(true);
    });

    it('suppresses issues when negativePattern matches', () => {
        const analyzer = new DeclarativeModernAnalyzer(TEST_CONFIG);
        const ctx: AnalyzerContext = {
            filePath: 'src/main.mock',
            content: 'dangerousFlag;\ndangerousFlag safeContext;',
            projectRoot: '/test',
            options: {},
        };
        const issues = analyzer.analyze(undefined, ctx);

        expect(issues).toHaveLength(1);
        expect(issues[0].location.start.line).toBe(1);
    });

    it('evaluates custom condition predicates accurately', () => {
        const analyzer = new DeclarativeModernAnalyzer(TEST_CONFIG);
        const ctx: AnalyzerContext = {
            filePath: 'src/main.testlang',
            content: 'forbiddenPrefix();\nallowedPrefix();',
            projectRoot: '/test',
            options: {},
        };
        const issues = analyzer.analyze(undefined, ctx);

        expect(issues).toHaveLength(1);
        expect(issues[0].rule).toBe('TM-COND-001');
        expect(issues[0].location.start.line).toBe(1);
    });
});
