/**
 * Module: Unit Test — Go Modernization & Style Analyzer Suite
 * File Path: tests/unit/analyzers/go-modern.test.ts
 * Architecture Role: Exercises GoModernAnalyzer across context-first parameters (GOM-CTX-001),
 *   receiver naming conventions (GOM-STYLE-001), and error variable naming (GOM-STYLE-002).
 * Dependencies & Triggers: vitest (describe, it, expect); imports GoModernAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert GOM-CTX-001, GOM-STYLE-001, and GOM-STYLE-002 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { GoModernAnalyzer } from '../../../src/analyzers/go-modern';
import type { AnalyzerContext } from '../../../src/core/types';

describe('GoModernAnalyzer Suite', () => {
    const analyzer = new GoModernAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits compliant Go code following standard idiomatic conventions', () => {
        const code = [
            '// Package server provides HTTP service routines.',
            'package server',
            '',
            'import "context"',
            '',
            'type Service struct{}',
            '',
            'func (s *Service) HandleRequest(ctx context.Context, id int) error {',
            '    return nil',
            '}',
        ].join('\n');
        const ctx = createCtx('pkg/server/handler.go', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags context.Context not being the first parameter (GOM-CTX-001)', () => {
        const code = [
            '// Package service provides domain logic.',
            'package service',
            '',
            'import "context"',
            '',
            'func QueryUser(id int, ctx context.Context) error {',
            '    return nil',
            '}',
        ].join('\n');
        const ctx = createCtx('pkg/service/user.go', code);
        const issues = analyzer.analyze(undefined, ctx);
        const ctxIssue = issues.find((i) => i.rule === 'GOM-CTX-001');
        expect(ctxIssue).toBeDefined();
        expect(ctxIssue?.message).toContain('context.Context');
    });

    it('flags unidiomatic receiver name like self or this (GOM-STYLE-001)', () => {
        const code = [
            '// Package storage manages disk records.',
            'package storage',
            '',
            'type Database struct{}',
            '',
            'func (self *Database) Connect() error {',
            '    return nil',
            '}',
        ].join('\n');
        const ctx = createCtx('pkg/storage/db.go', code);
        const issues = analyzer.analyze(undefined, ctx);
        const recvIssue = issues.find((i) => i.rule === 'GOM-STYLE-001');
        expect(recvIssue).toBeDefined();
        expect(recvIssue?.message).toContain('Receiver');
    });

    it('flags non-conforming error variable name (GOM-STYLE-002)', () => {
        const code = [
            '// Package client implements network client.',
            'package client',
            '',
            'func Fetch() {',
            '    var failure error',
            '    _ = failure',
            '}',
        ].join('\n');
        const ctx = createCtx('pkg/client/client.go', code);
        const issues = analyzer.analyze(undefined, ctx);
        const errIssue = issues.find((i) => i.rule === 'GOM-STYLE-002');
        expect(errIssue).toBeDefined();
        expect(errIssue?.message).toContain('err');
    });
});
