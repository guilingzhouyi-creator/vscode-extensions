/**
 * Module: Unit Test — Architecture & Clean Layer Boundaries Analyzer Suite (ARCH-* Rules)
 * File Path: tests/unit/analyzers/architecture.test.ts
 * Architecture Role: Exercises ArchitectureAnalyzer across domain framework leaks (ARCH-LEAK-001)
 *   and layer inversion constraints.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ArchitectureAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert ARCH-LEAK-001 detection when domain layer imports framework modules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ArchitectureAnalyzer } from '../../../src/analyzers/architecture';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ArchitectureAnalyzer Suite', () => {
    const analyzer = new ArchitectureAnalyzer();

    function createCtx(filePath: string, content: string, options = {}): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                enforceCleanLayers: true,
                ...options,
            },
            config: {},
        };
    }

    it('permits domain logic with pure dependency injection and zero framework imports', () => {
        const code = [
            'export interface User {',
            '    id: string;',
            '    name: string;',
            '}',
            'export function validateUser(user: User): boolean {',
            '    return user.name.trim().length > 0;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/domain/entities/user.ts', code);
        const issues = analyzer.analyze(undefined as any, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags framework import inside domain core layer (ARCH-LEAK-001)', () => {
        const code = [
            'import express from "express";',
            'export class DomainUser {',
            '    handle(req: express.Request): void {}',
            '}',
        ].join('\n');
        const ctx = createCtx('src/domain/user.ts', code);
        const issues = analyzer.analyze(undefined as any, ctx);
        const leakIssue = issues.find((i) => i.rule === 'ARCH-LEAK-001');
        expect(leakIssue).toBeDefined();
        expect(leakIssue?.severity).toBe('error');
        expect(leakIssue?.message).toContain('express');
    });

    it('permits framework import inside infrastructure or adapter layers', () => {
        const code = [
            'import express from "express";',
            'export function createServer(): express.Application {',
            '    return express();',
            '}',
        ].join('\n');
        const ctx = createCtx('src/infrastructure/http/server.ts', code);
        const issues = analyzer.analyze(undefined as any, ctx);
        const leakIssue = issues.find((i) => i.rule === 'ARCH-LEAK-001');
        expect(leakIssue).toBeUndefined();
    });
});
