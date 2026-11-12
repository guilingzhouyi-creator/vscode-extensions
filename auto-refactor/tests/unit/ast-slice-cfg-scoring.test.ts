/**
 * Module: Unit Test — AST Slice, CFG Builder, Native Routing & Scoring Closures
 * File Path: tests/unit/ast-slice-cfg-scoring.test.ts
 * Architecture Role: Verifies native bridge crossover, SourceFile caching, DocsAnalyzer
 *   path existence caching, multilang slice boundaries, CFG branch convergence, and scoring math.
 * Dependencies & Triggers: Consumes src/core/native, src/core/cfg, src/core/router,
 *   src/core/scoring, and src/analyzers; executed via vitest.
 * Responsibilities: Comprehensive assertions on Phase 1.4 architectural enhancements.
 * Exit Semantics & Design Rationale: Exits cleanly on 100% assertions satisfied.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    nativeCore,
    getNativeCoreStatus,
    getRawNativeBinding,
} from '../../src/core/native/native-bridge';
import { DocsAnalyzer } from '../../src/analyzers/docs';
import { ASTSliceExtractor } from '../../src/core/router/sliceExtractor';
import { extractASTSlices } from '../../src/core/ast/sliceExtractor';
import { CfgBuilder } from '../../src/core/cfg/cfg-builder';
import { synthesizeEightPillars } from '../../src/core/scoring/eightPillarModel';
import { computeSecurityCeiling } from '../../src/core/scoring/scorer-formulas';
import { synthesizeStaticQualityVector } from '../../src/core/scoring/static-quality-model';
import { parseCalibrationCorpus } from '../../src/core/scoring/calibration-corpus';

describe('Native Bridge Routing & Crossover', () => {
    it('verifies raw native binding and DAG topological ordering', () => {
        const raw = getRawNativeBinding();
        const status = getNativeCoreStatus();
        if (status.isNativeAvailable) {
            expect(raw).not.toBeNull();
            expect(typeof raw?.analyzeDependencyGraph).toBe('function');
        }

        const dag: [string, string][] = [['A', 'B'], ['B', 'C']];
        const res = nativeCore.analyzeDependencyGraph(dag);
        expect(res.isAcyclic).toBe(true);
        expect(res.topologicalOrder).toContain('A');

        const cyclic: [string, string][] = [['X', 'Y'], ['Y', 'X']];
        expect(nativeCore.analyzeDependencyGraph(cyclic).isAcyclic).toBe(false);
    });

    it('masks compact code using fast JS path', () => {
        const source = 'const x = "inside {str}"; // comment\nreturn x;';
        const masked = nativeCore.maskSourceCodeCompact(source, { lineComment: '//', quoteChars: '"' });
        expect(masked).not.toContain('inside {str}');
        expect(masked).not.toContain('comment');
    });
});

describe('DocsAnalyzer Path Existence Caching', () => {
    it('caches existence results and clears them on reset', () => {
        const docs = new DocsAnalyzer();
        const testFile = path.resolve(__dirname, 'ast-slice-cfg-scoring.test.ts');
        const checker = docs as unknown as {
            checkPathExists: (p: string) => boolean;
            pathExistsCache: Map<string, boolean>;
        };

        expect(checker.checkPathExists(testFile)).toBe(true);
        expect(checker.checkPathExists('missing.xyz')).toBe(false);
        expect(checker.pathExistsCache.size).toBe(2);

        docs.resetState();
        expect(checker.pathExistsCache.size).toBe(0);
    });
});

describe('ASTSliceExtractor Multilang Boundary Extraction', () => {
    it('extracts TypeScript function slices and ignores braces in strings or comments', () => {
        const extractor = new ASTSliceExtractor();
        const code = [
            'export function compute(val: number): number {',
            '    const s = "text {with} brace";',
            '    // comment {with} brace',
            '    return val + 1;',
            '}',
        ].join('\n');

        const slices = extractor.extractSlices('calc.ts', code, code, [2]);
        expect(slices.length).toBe(1);
        expect(slices[0].symbolName).toBe('compute');
        expect(slices[0].startLine).toBe(1);
        expect(slices[0].endLine).toBe(5);
    });

    it('extracts Python and GDScript indentation boundaries', () => {
        const py = 'def calculate(x):\n    y = x * 2\n    return y\n\ndef next_fn():\n    pass';
        const pySlices = extractASTSlices('app.py', py, py, [2]);
        expect(pySlices.length).toBe(1);
        expect(pySlices[0].symbolName).toBe('calculate');
        expect(pySlices[0].startLine).toBe(1);
        expect(pySlices[0].endLine).toBe(3);

        const gd = 'func on_hit(dmg: int) -> void:\n    hp -= dmg\n    emit_signal("hit")\n';
        const gdSlices = extractASTSlices('mob.gd', gd, gd, [2]);
        expect(gdSlices.length).toBe(1);
        expect(gdSlices[0].symbolName).toBe('on_hit');
        expect(gdSlices[0].startLine).toBe(1);
        expect(gdSlices[0].endLine).toBe(3);
    });
});

describe('CfgBuilder Branch Convergence to MergeBlock', () => {
    it('converges then and else branches to merge block upon closing', () => {
        const builder = new CfgBuilder();
        const lines = [
            'const x = 10;',
            'if (x > 5) {',
            '    runA();',
            '} else {',
            '    runB();',
            '}',
            'return x;',
        ];

        const cfg = builder.buildFromLines(lines);
        const reachable = cfg.getReachableBlocks();
        expect(reachable.length).toBeGreaterThanOrEqual(4);
        const edges = cfg.getAllEdges();
        expect(edges.some((e) => e.kind === 'true-branch')).toBe(true);
        expect(edges.some((e) => e.kind === 'false-branch')).toBe(true);

        const retBlock = reachable.find((b) => b.statements.some((s) => s.kind === 'return'));
        expect(retBlock?.successors.some((s) => s.kind === 'exit')).toBe(true);
    });
});

describe('Scoring Models Alignment & Calibration Harvesting', () => {
    it('synthesizes eight pillars and attributes modernity correctly', () => {
        const indices = {
            architectureConsistency: 90,
            maintainability: 85,
            performanceEfficiency: 95,
            codeSecurity: 100,
            semanticPurity: 90,
            techDebtRisk: 80,
            standardization: 90,
            commentQuality: 85,
            duplication: 95,
            modernity: 80,
        };
        const breakdown = synthesizeEightPillars(indices, 88, 92);
        expect(breakdown.compositeScore).toBe(90.57);
        expect(breakdown.pillars.security).toBe(99.75);
    });

    it('saturates security ceiling via tanh and evaluates 8-dim static vector', () => {
        const clean = computeSecurityCeiling({ exportedSymbols: 0, nonBlankLines: 0 });
        const exposed = computeSecurityCeiling({ exportedSymbols: 500, nonBlankLines: 5000 });
        expect(clean).toBe(99.75);
        expect(exposed).toBeGreaterThanOrEqual(99.2);

        const staticVec = synthesizeStaticQualityVector({
            architectureConsistency: 92,
            maintainability: 88,
            performanceEfficiency: 95,
            codeSecurity: 100,
            semanticPurity: 90,
            techDebtRisk: 80,
            standardization: 90,
            commentQuality: 90,
            duplication: 95,
            modernity: 82,
        });
        expect(staticVec.S).toBe(99.75);
        expect(staticVec.T).toBe(82);
    });

    it('loads harvested confidence calibration corpus cleanly', () => {
        const corpusPath = path.resolve(__dirname, '../../baselines/confidence-calibration.json');
        const raw = fs.readFileSync(corpusPath, 'utf8');
        const parsed = parseCalibrationCorpus(JSON.parse(raw));
        expect(parsed.rejections.length).toBe(0);
        expect(parsed.stats.length).toBeGreaterThanOrEqual(10);
    });
});
