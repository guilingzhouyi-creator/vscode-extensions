/**
 * Module: Unit Tests — Trajectory Learning, Holdout Generalization & PatchArbiter Real Issue Scanning
 * File Path: tests/unit/trajectory-and-patch-arbiter.test.ts
 * Architecture Role: Verifies production wiring for PatchArbiter real issue deduction,
 *   PraxisTrajectoryLearningService recipes.json persistence and holdout generalization index,
 *   and RegressionTrajectoryDetector GOV-TRJ-001 flip-flop oscillation interception.
 * Dependencies & Triggers: Executed via Vitest (`npx vitest run tests/unit/trajectory-and-patch-arbiter.test.ts`).
 * Responsibilities:
 *   1. Assert PatchArbiter penalizes candidate patches introducing real issues via built-in and custom scanners.
 *   2. Assert PraxisTrajectoryLearningService persists recipes.json and computes holdout generalization index.
 *   3. Assert RegressionTrajectoryDetector emits GOV-TRJ-001 on A->B->A content oscillations.
 * Exit Semantics & Design Rationale: Deterministic unit assertions using isolated temporary directories.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    PatchArbiter,
    RegressionTrajectoryDetector,
    TrajectoryRecipeExtractor,
    inspectPatchContentIssues,
} from '../../src/core/trajectory';
import {
    PraxisTrajectoryLearningService,
    createMultiAgentGovernanceService,
} from '../../src/core/praxis';
import type { QualityScoreBreakdown } from '../../src/core/scoring/scoringTypes';

function makeScore(compositeScore: number): QualityScoreBreakdown {
    return {
        compositeScore,
        indices: {} as QualityScoreBreakdown['indices'],
    } as QualityScoreBreakdown;
}

describe('PatchArbiter real issue scanning & deduction', () => {
    it('penalizes candidate patches that introduce type escapes or security issues without self-reported ruleHitIds', () => {
        const arbiter = new PatchArbiter();
        const baseCode = [
            'export function parseAmount(input: string): number {',
            '    const parsed = Number.parseFloat(input);',
            '    return Number.isFinite(parsed) ? parsed : 0;',
            '}',
        ].join('\n');
        const cleanCandidate = [
            'export function parseAmount(input: string): number {',
            '    if (input.trim().length === 0) return 0;',
            '    const parsed = Number.parseFloat(input);',
            '    return Number.isFinite(parsed) ? parsed : 0;',
            '}',
        ].join('\n');
        const dirtyCandidate = [
            'export function parseAmount(input: any): any {',
            '    console.log(input);',
            '    return eval(input as any);',
            '}',
        ].join('\n');

        const detected = inspectPatchContentIssues('src/amount.ts', dirtyCandidate);
        expect(detected.length).toBeGreaterThanOrEqual(3);

        const ranked = arbiter.arbitratePatches([
            { agentUid: 'agent-dirty', patchId: 'patch-dirty', filePath: 'src/amount.ts', timestamp: 1000, oldContent: baseCode, newContent: dirtyCandidate, addedLines: 3, deletedLines: 3 },
            { agentUid: 'agent-clean', patchId: 'patch-clean', filePath: 'src/amount.ts', timestamp: 1001, oldContent: baseCode, newContent: cleanCandidate, addedLines: 4, deletedLines: 2 },
        ]);

        expect(ranked).toHaveLength(2);
        expect(ranked[0].agentUid).toBe('agent-clean');
        expect(ranked[0].isRecommended).toBe(true);
        expect(ranked[1].agentUid).toBe('agent-dirty');
        expect(ranked[1].issuesCount).toBeGreaterThanOrEqual(3);
        expect(ranked[0].arbitrationScore).toBeGreaterThan(ranked[1].arbitrationScore);
    });

    it('supports custom issueScanner callbacks through PraxisMultiAgentGovernanceService', () => {
        const multiAgentService = createMultiAgentGovernanceService();
        const customScanner = (filePath: string, content: string) => {
            if (!content.includes('FORBIDDEN_CALL')) return [];
            return [{
                id: 'custom-1',
                rule: 'SEC-VUL-001',
                severity: 'error' as const,
                analyzer: 'security',
                message: 'Forbidden call detected',
                location: { file: filePath, start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
                detail: { category: 'security', fixable: false },
            }];
        };

        const candidates = multiAgentService.arbitrateCompetingPatches(
            [
                { agentUid: 'agent-bad', patchId: 'p1', filePath: 'src/mod.ts', timestamp: 100, oldContent: 'export const x = 1;\n', newContent: 'export const x = FORBIDDEN_CALL();\n', addedLines: 1, deletedLines: 1 },
                { agentUid: 'agent-good', patchId: 'p2', filePath: 'src/mod.ts', timestamp: 101, oldContent: 'export const x = 1;\n', newContent: 'export const x = 2;\n', addedLines: 1, deletedLines: 1 },
            ],
            customScanner,
        );

        expect(candidates[0].agentUid).toBe('agent-good');
        expect(candidates[1].issuesCount).toBeGreaterThanOrEqual(1);
    });
});

describe('PraxisTrajectoryLearningService persistence & holdout generalization', () => {
    it('persists recipes.json and computes measured holdout generalization index across trajectories', async () => {
        const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ar-trj-p1-'));
        try {
            const service = new PraxisTrajectoryLearningService(
                new TrajectoryRecipeExtractor(),
                new RegressionTrajectoryDetector(),
                tempRoot,
            );

            const beforeCode = [
                'function computeLegacy(a: number, b: number, c: number, d: number, e: number, f: number) {',
                '    return a + b + c + d + e + f;',
                '}',
                '// l4\n// l5\n// l6\n// l7\n// l8\n// l9\n// l10',
            ].join('\n');
            const afterCode = [
                'interface ComputeOptions { a: number; b: number; c: number; d: number; e: number; f: number; }',
                'function computeLegacy(options: ComputeOptions) {',
                '    return options.a + options.b;',
                '}',
            ].join('\n');

            const firstVerdict = await service.learnFromTrajectory({
                trajectoryId: 'trj-holdout-1',
                filePath: 'src/calc1.ts',
                beforeContent: beforeCode,
                afterContent: afterCode,
                beforeScore: makeScore(68),
                afterScore: makeScore(91),
                language: 'typescript',
                churnRatio: 0.2,
            });
            expect(firstVerdict.hasBadToGoodImprovement).toBe(true);
            expect(firstVerdict.extractedRecipe).toBeDefined();
            expect(firstVerdict.measurements.generalizationIndex.status).toBe('unmeasured');

            const secondVerdict = await service.learnFromTrajectory({
                trajectoryId: 'trj-holdout-2',
                filePath: 'src/calc2.ts',
                beforeContent: beforeCode,
                afterContent: afterCode,
                beforeScore: makeScore(70),
                afterScore: makeScore(94),
                language: 'typescript',
                churnRatio: 0.2,
            });
            expect(secondVerdict.measurements.generalizationIndex.status).toBe('measured');
            expect(secondVerdict.generalizationIndex).toBeGreaterThan(0);

            const recipesPath = path.join(tempRoot, '.refactor-trajectory', 'recipes.json');
            expect(fs.existsSync(recipesPath)).toBe(true);

            const reloadedService = new PraxisTrajectoryLearningService();
            const loadedRecipes = await reloadedService.loadRecipesFromDisk(tempRoot);
            expect(loadedRecipes.length).toBeGreaterThanOrEqual(1);
        } finally {
            await fs.promises.rm(tempRoot, { recursive: true, force: true });
        }
    });
});

describe('RegressionTrajectoryDetector GOV-TRJ-001 oscillation interception', () => {
    it('emits GOV-TRJ-001 when content revisions oscillate A -> B -> A', () => {
        const detector = new RegressionTrajectoryDetector();
        const revA1 = RegressionTrajectoryDetector.createContentRevision({
            revisionId: 'rev-1',
            content: 'export const mode = "alpha";\n',
            timestamp: 1000,
            compositeScore: 85,
        });
        const revB = RegressionTrajectoryDetector.createContentRevision({
            revisionId: 'rev-2',
            content: 'export const mode = "beta";\n',
            timestamp: 2000,
            compositeScore: 88,
        });
        const revA2 = RegressionTrajectoryDetector.createContentRevision({
            revisionId: 'rev-3',
            content: 'export const mode = "alpha";\n',
            timestamp: 3000,
            compositeScore: 85,
        });

        const issues = detector.detectRegressions('src/mode.ts', [revA1, revB, revA2]);
        expect(issues.length).toBeGreaterThanOrEqual(1);
        expect(issues[0].rule).toBe('GOV-TRJ-001');
        expect(issues[0].message).toContain('Cyclic flip-flop detected');
    });
});
