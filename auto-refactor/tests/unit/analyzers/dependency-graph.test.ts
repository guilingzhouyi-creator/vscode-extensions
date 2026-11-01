/**
 * Module: Unit Test — Dependency Graph Boundary Analyzer Suite
 * File Path: tests/unit/analyzers/dependency-graph.test.ts
 * Architecture Role: Exercises DependencyGraphAnalyzer across group boundaries (disallowed-import)
 *   and external package restrictions.
 * Dependencies & Triggers: vitest (describe, it, expect); imports DependencyGraphAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert disallowed-import rules for cross-layer imports and unapproved external packages.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { DependencyGraphAnalyzer } from '../../../src/analyzers/dependency-graph';
import type { AnalyzerContext } from '../../../src/core/types';

describe('DependencyGraphAnalyzer Suite', () => {
    const analyzer = new DependencyGraphAnalyzer();

    const graphConfig = {
        groups: {
            domain: ['src/domain/**'],
            infra: ['src/infra/**'],
        },
        rules: {
            domain: {
                allowGroups: [], // domain is strictly isolated
                allowExternal: ['crypto'],
            },
        },
    };

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: graphConfig,
            config: {
                analyzers: {
                    'dependency-graph': { options: graphConfig },
                },
            },
        };
    }

    it('permits domain module importing intra-group peer and allowed external packages', () => {
        const code = [
            'import { UserEntity } from "./user-entity";',
            'import * as crypto from "crypto";',
            'export const createId = () => crypto.randomUUID();',
        ].join('\n');
        const ctx = createCtx('src/domain/user-service.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags domain module importing infrastructure layer (disallowed-import)', () => {
        const code = [
            'import { DatabasePool } from "../infra/db";',
            'export const repo = new DatabasePool();',
        ].join('\n');
        const ctx = createCtx('src/domain/order-service.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const depIssue = issues.find((i) => i.rule === 'disallowed-import');
        expect(depIssue).toBeDefined();
        expect(depIssue?.message).toContain('Cross-group dependency violation');
    });

    it('flags domain module importing unapproved third-party package (disallowed-import)', () => {
        const code = [
            'import axios from "axios";',
            'export const fetchExternal = () => axios.get("/api");',
        ].join('\n');
        const ctx = createCtx('src/domain/api-client.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const extIssue = issues.find((i) => i.rule === 'disallowed-import');
        expect(extIssue).toBeDefined();
        expect(extIssue?.message).toContain('axios');
    });
});
