/**
 * Module: Unit Test — Data Access & Architecture Analyzer Suite
 * File Path: tests/unit/analyzers/data-architecture.test.ts
 * Architecture Role: Exercises DataArchitectureAnalyzer across unbounded queries (DAT-QRY-001),
 *   N+1 query loops (DAT-NPL-001), and hot-path serialization (DAT-SER-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports DataArchitectureAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert DAT-QRY-001, DAT-NPL-001, and DAT-SER-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { DataArchitectureAnalyzer } from '../../../src/analyzers/data-architecture';
import type { AnalyzerContext } from '../../../src/core/types';

describe('DataArchitectureAnalyzer Suite', () => {
    const analyzer = new DataArchitectureAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {
                analyzers: {
                    'data-architecture': { options: {} },
                },
            },
        };
    }

    it('permits compliant bounded queries and bulk lookups outside loops', () => {
        const code = [
            'export async function getUserList(req: any, res: any) {',
            '    const users = await db.findMany({ take: 20 });',
            '    res.json(users);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/controllers/user-controller.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags unbounded query on online request path (DAT-QRY-001)', () => {
        const code = [
            'export async function handleAllUsers(req: any, res: any) {',
            '    const users = await db.query("SELECT * FROM users");',
            '    res.json(users);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/api/routes/user-handler.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const qryIssue = issues.find((i) => i.rule === 'DAT-QRY-001');
        expect(qryIssue).toBeDefined();
        expect(qryIssue?.message).toContain('Unbounded');
    });

    it('flags N+1 database queries invoked inside loop (DAT-NPL-001)', () => {
        const code = [
            'export async function loadDetails(ids: number[]) {',
            '    const results = [];',
            '    for (const id of ids) {',
            '        const record = await db.query(`SELECT * FROM items WHERE id = ${id}`);',
            '        results.push(record);',
            '    }',
            '    return results;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/services/catalog-service.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const nplIssue = issues.find((i) => i.rule === 'DAT-NPL-001');
        expect(nplIssue).toBeDefined();
        expect(nplIssue?.message).toContain('N+1');
    });

    it('flags repeated JSON serialization inside loop hot path (DAT-SER-001)', () => {
        const code = [
            'export function serializePayloads(items: any[]) {',
            '    const serialized = [];',
            '    for (const item of items) {',
            '        serialized.push(JSON.stringify(item));',
            '    }',
            '    return serialized;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/handlers/export-handler.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const serIssue = issues.find((i) => i.rule === 'DAT-SER-001');
        expect(serIssue).toBeDefined();
        expect(serIssue?.message).toContain('serialization');
    });
});
