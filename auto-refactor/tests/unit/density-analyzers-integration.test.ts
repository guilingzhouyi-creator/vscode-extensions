/**
 * Module: Unit Test — Five-Dimensional Density & Analyzer Integration Suite
 * File Path: tests/unit/density-analyzers-integration.test.ts
 * Architecture Role: Verifies the end-to-end integration of five-dimensional effective
 *   code density rules (ARCH-PLM-001, SIM-INL-001, CPX-TRV-001) emitted by the core
 *   ArchitectureAnalyzer, SimplifyAnalyzer, and ComplexityAnalyzer pipelines.
 * Dependencies & Triggers: Vitest test framework; consumes compiled artifacts from dist/
 *   to align with production runtime adapter resolution.
 * Responsibilities:
 *   1. Validate ARCH-PLM-001 emission on excessive plumbing code and verify facade exemptions.
 *   2. Validate SIM-INL-001 emission on single-use orphan micro-functions and verify lifecycle exemptions.
 *   3. Validate CPX-TRV-001 emission on tautological loops and verify stateful mutation exemptions.
 *   4. Validate per-file 5D density tensor metrics in FileMetric.
 * Exit Semantics & Design Rationale: Deterministic, hermetic assertions with 100% pass rate.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
const { ArchitectureAnalyzer } = require('../../dist/analyzers/architecture');
const { SimplifyAnalyzer } = require('../../dist/analyzers/simplify');
const { ComplexityAnalyzer } = require('../../dist/analyzers/complexity');
const { auditOrphanInlining } = require('../../dist/analyzers/simplify-inlining');
const { computeEffectiveCodeDensity } = require('../../dist/core/scoring/effectiveDensity');
import type { AnalyzerContext, Issue } from '../../src/core/types';

function createMockContext(filePath: string, content: string): AnalyzerContext {
    return {
        filePath,
        content,
        options: {
            complexityWarn: 15,
            complexityFail: 25,
            flagVacuousTrampolines: true,
            flagHollowFacades: true,
            flagPlumbingOverhead: true,
        },
        config: {
            thresholds: {
                complexityWarn: 15,
                complexityFail: 25,
            },
        },
    };
}

describe('Five-Dimensional Density Analyzer Integration', () => {
    describe('ArchitectureAnalyzer (ARCH-PLM-001: Plumbing Overhead Ratio)', () => {
        it('should emit ARCH-PLM-001 when plumbing and wiring dominate module payload', () => {
            const plumbingCode = [
                'export { a1, a2, a3, a4, a5 } from "./source-a";',
                'export { b1, b2, b3, b4, b5 } from "./source-b";',
                'export { c1, c2, c3, c4, c5 } from "./source-c";',
                'export { d1, d2, d3, d4, d5 } from "./source-d";',
                'export { e1, e2, e3, e4, e5 } from "./source-e";',
                'export { f1, f2, f3, f4, f5 } from "./source-f";',
                'export { g1, g2, g3, g4, g5 } from "./source-g";',
                'export { h1, h2, h3, h4, h5 } from "./source-h";',
                'export { i1, i2, i3, i4, i5 } from "./source-i";',
                'export { j1, j2, j3, j4, j5 } from "./source-j";',
                'export { k1, k2, k3, k4, k5 } from "./source-k";',
                'export { l1, l2, l3, l4, l5 } from "./source-l";',
                'export { m1, m2, m3, m4, m5 } from "./source-m";',
                'export { n1, n2, n3, n4, n5 } from "./source-n";',
                'export { o1, o2, o3, o4, o5 } from "./source-o";',
                'export { p1, p2, p3, p4, p5 } from "./source-p";',
            ].join('\n');

            const filePath = 'src/api/router-bridge.ts';
            const sf = ts.createSourceFile(filePath, plumbingCode, ts.ScriptTarget.Latest, true);
            const analyzer = new ArchitectureAnalyzer();
            const ctx = createMockContext(filePath, plumbingCode);

            const issues = analyzer.analyze(sf, ctx);
            const plmIssue = issues.find((i: Issue) => i.rule === 'ARCH-PLM-001');

            expect(plmIssue).toBeDefined();
            expect(plmIssue?.analyzer).toBe('architecture');
            expect(plmIssue?.severity).toBe('warning');
            expect(plmIssue?.detail?.por).toBeGreaterThan(0.60);
        });

        it('should exempt legitimate index.ts barrels and frozen facades from ARCH-PLM-001', () => {
            const barrelCode = [
                'export * from "./source-a";',
                'export * from "./source-b";',
                'export * from "./source-c";',
                'export * from "./source-d";',
                'export * from "./source-e";',
                'export * from "./source-f";',
                'export * from "./source-g";',
                'export * from "./source-h";',
                'export * from "./source-i";',
                'export * from "./source-j";',
                'export * from "./source-k";',
                'export * from "./source-l";',
                'export * from "./source-m";',
                'export * from "./source-n";',
                'export * from "./source-o";',
                'export * from "./source-p";',
            ].join('\n');

            // Barrel index.ts exemption
            const indexFile = 'src/api/index.ts';
            const sfIndex = ts.createSourceFile(indexFile, barrelCode, ts.ScriptTarget.Latest, true);
            const analyzer = new ArchitectureAnalyzer();
            const ctxIndex = createMockContext(indexFile, barrelCode);

            const issuesIndex = analyzer.analyze(sfIndex, ctxIndex);
            const plmIndexIssue = issuesIndex.find((i: Issue) => i.rule === 'ARCH-PLM-001');
            expect(plmIndexIssue).toBeUndefined();

            // Frozen facade exemption
            const frozenFacadeCode = [
                'import { a1 } from "./source-a";',
                'import { b1 } from "./source-b";',
                'export const ServiceFacade = Object.freeze({',
                '    a1,',
                '    b1,',
                '    version: "1.0.0",',
                '});',
            ].join('\n');
            const facadeFile = 'src/services/serviceFacade.ts';
            const sfFacade = ts.createSourceFile(facadeFile, frozenFacadeCode, ts.ScriptTarget.Latest, true);
            const ctxFacade = createMockContext(facadeFile, frozenFacadeCode);
            const issuesFacade = analyzer.analyze(sfFacade, ctxFacade);
            const plmFacadeIssue = issuesFacade.find((i: Issue) => i.rule === 'ARCH-PLM-001');
            expect(plmFacadeIssue).toBeUndefined();
        });
    });

    describe('SimplifyAnalyzer (SIM-INL-001: Orphan Micro-Function Inlining)', () => {
        it('should emit SIM-INL-001 when a single-use micro-fragment has high vector similarity with caller', () => {
            const inlineCode = [
                'function formatPart(): string {',
                '    return prefix + "_" + label + "_" + suffix;',
                '}',
                'export function renderHeader(): string {',
                '    const prefix = getPrefix();',
                '    const label = getLabel();',
                '    const suffix = getSuffix();',
                '    const part = formatPart();',
                '    return prefix + "_" + label + "_" + suffix + ":" + part;',
                '}',
            ].join('\n');

            const filePath = 'src/components/header-renderer.ts';
            const sf = ts.createSourceFile(filePath, inlineCode, ts.ScriptTarget.Latest, true);
            const ctx = createMockContext(filePath, inlineCode);

            const issues: Issue[] = [];
            auditOrphanInlining(sf, ctx, {}, issues);

            const inlIssue = issues.find((i: Issue) => i.rule === 'SIM-INL-001');
            expect(inlIssue).toBeDefined();
            expect(inlIssue?.analyzer).toBe('simplify');
            expect(inlIssue?.severity).toBe('info');
            expect(inlIssue?.detail?.function).toBe('formatPart');
            expect(inlIssue?.detail?.inliningUtility).toBeGreaterThanOrEqual(0.70);
        });

        it('should exempt exported functions and lifecycle hooks from SIM-INL-001', () => {
            const lifecycleCode = [
                'export function activate(ctx: any): void {',
                '    setupLifecycle();',
                '}',
                'function setupLifecycle(): void {',
                '    // single-use private setup',
                '}',
                'export function deactivate(): void {',
                '    // lifecycle hook',
                '}',
            ].join('\n');

            const filePath = 'src/extension.ts';
            const sf = ts.createSourceFile(filePath, lifecycleCode, ts.ScriptTarget.Latest, true);
            const ctx = createMockContext(filePath, lifecycleCode);

            const issues: Issue[] = [];
            auditOrphanInlining(sf, ctx, {}, issues);

            const inlIssue = issues.find((i: Issue) => i.detail?.function === 'activate');
            expect(inlIssue).toBeUndefined();
        });
    });

    describe('ComplexityAnalyzer (CPX-TRV-001: Tautological Loops)', () => {
        it('should emit CPX-TRV-001 on tautological loops with zero state mutation entropy delta', () => {
            const loopCode = [
                'export function vacuousTraversal(items: number[]): void {',
                '    for (let i = 0; i < items.length; i++) {',
                '        // vacuous loop with no state mutations or side effects',
                '    }',
                '}',
            ].join('\n');

            const filePath = 'src/data/empty-loop-runner.ts';
            const sf = ts.createSourceFile(filePath, loopCode, ts.ScriptTarget.Latest, true);
            const analyzer = new ComplexityAnalyzer();
            const ctx = createMockContext(filePath, loopCode);

            const issues = analyzer.analyze(sf, ctx);
            const trvIssue = issues.find((i: Issue) => i.rule === 'CPX-TRV-001');

            expect(trvIssue).toBeDefined();
            expect(trvIssue?.analyzer).toBe('complexity');
            expect(trvIssue?.severity).toBe('warning');
            expect(trvIssue?.detail?.symbol).toBe('vacuousTraversal');
            expect(trvIssue?.detail?.deltaEntropy).toBeLessThanOrEqual(0.05);
        });

        it('should exempt loops with real state mutations or side-effects from CPX-TRV-001', () => {
            const activeLoopCode = [
                'export function accumulateSum(items: number[]): number {',
                '    let total = 0;',
                '    for (let i = 0; i < items.length; i++) {',
                '        total += items[i];',
                '    }',
                '    return total;',
                '}',
            ].join('\n');

            const filePath = 'src/data/accumulator.ts';
            const sf = ts.createSourceFile(filePath, activeLoopCode, ts.ScriptTarget.Latest, true);
            const analyzer = new ComplexityAnalyzer();
            const ctx = createMockContext(filePath, activeLoopCode);

            const issues = analyzer.analyze(sf, ctx);
            const trvIssue = issues.find((i: Issue) => i.rule === 'CPX-TRV-001');
            expect(trvIssue).toBeUndefined();
        });
    });

    describe('FileMetric 5D Density Tensor Collection', () => {
        it('should calculate complete 5D density tensor metrics for source code', () => {
            const sampleSource = [
                'import { resolve } from "path";',
                'import { readFileSync } from "fs";',
                '',
                'export function readConfig(path: string): Record<string, string> {',
                '    const fullPath = resolve(path);',
                '    const raw = readFileSync(fullPath, "utf-8");',
                '    const parsed = JSON.parse(raw);',
                '    return Object.freeze({ ...parsed });',
                '}',
            ].join('\n');

            const densityResult = computeEffectiveCodeDensity(sampleSource, 9);

            expect(densityResult.effectiveDensity).toBeGreaterThan(0);
            expect(densityResult.tspr).toBeDefined();
            expect(densityResult.por).toBeDefined();
            expect(densityResult.columnDensity).toBeDefined();
            expect(densityResult.compositeDensity).toBeDefined();

            expect(densityResult.tspr! + densityResult.por!).toBeCloseTo(1.0, 5);
            expect(densityResult.compositeDensity!).toBeGreaterThan(0);
            expect(densityResult.compositeDensity!).toBeLessThanOrEqual(1.0);
        });
    });
});
