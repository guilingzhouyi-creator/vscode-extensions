/**
 * Module: Unit Tests — Behavioral Hotspot & Temporal Coupling Evolution
 * File Path: tests/unit/evolution/behavioral-hotspot.test.ts
 * Architecture Role: Verifies CodeScene behavioral hotspot index computation,
 *   technical debt interest multiplier scaling, deterministic cohort ranking,
 *   Jaccard temporal coupling detection, cross-module shotgun surgery alerts,
 *   and defensive non-crash degradation.
 * Dependencies & Triggers: Imports BehavioralHotspotEvaluator and TemporalCouplingDetector;
 *   executed under vitest test runner (`npm run test:unit` or `npm test`).
 * Responsibilities:
 *   1. Assert pure-data activity scoring and saturation curve monotonicity.
 *   2. Assert static debt and composite hotspot index calculations across regimes.
 *   3. Assert technical debt interest multiplier compounding [1.0, 5.0].
 *   4. Assert deterministic hotspot batch ranking and actionable refactoring proposals.
 *   5. Assert Jaccard temporal coupling coefficient detection (threshold >= 0.6).
 *   6. Assert architectural module separation and cross-module shotgun surgery detection.
 *   7. Assert crash-resilient graceful degradation under malformed or absent inputs.
 * Exit Semantics & Design Rationale: Pure in-memory assertions with zero child processes;
 *   deterministic tolerances ensure reliable CI executions across platforms.
 */

import { describe, it, expect } from 'vitest';
import {
    BehavioralHotspotEvaluator,
    TemporalCouplingDetector,
    defaultModuleResolver,
    normalizeEvolutionPath,
    calculateAuthorEntropy,
    type FileHotspotInput,
    type CommitChangeSet,
    type GitFileHistoryProfile,
} from '../../../src/core/evolution';

describe('BehavioralHotspotEvaluator — Pure Data Metrics', () => {
    const evaluator = new BehavioralHotspotEvaluator({
        activityHalfPointCommits: 10,
        complexityHalfPoint: 20,
        elocHalfPoint: 600,
        defectHalfPoint: 5,
        maxInterestMultiplier: 5.0,
    });

    it('calculates zero activity when commits and churn are zero', () => {
        expect(evaluator.calculateActivityScore(0)).toBe(0.0);
        expect(evaluator.calculateActivityScore(0, 0)).toBe(0.0);
    });

    it('calculates monotonic activity saturation with commit counts', () => {
        const act5 = evaluator.calculateActivityScore(5);
        const act10 = evaluator.calculateActivityScore(10);
        const act30 = evaluator.calculateActivityScore(30);

        expect(act5).toBeGreaterThan(0.0);
        expect(act10).toBeGreaterThan(act5);
        expect(act30).toBeGreaterThan(act10);
        expect(act10).toBeCloseTo(10 / (10 + 10), 2);
    });

    it('blends churn lines into activity score when provided', () => {
        const withoutChurn = evaluator.calculateActivityScore(10, 0);
        const withChurn = evaluator.calculateActivityScore(10, 500);

        expect(withChurn).toBeGreaterThan(withoutChurn);
        expect(withChurn).toBeLessThanOrEqual(1.0);
    });

    it('calculates static debt score within bounded [0.0, 1.0] range', () => {
        const zeroDebt = evaluator.calculateStaticDebtScore(0, 0, 0);
        expect(zeroDebt).toBe(0.0);

        const moderateDebt = evaluator.calculateStaticDebtScore(20, 600, 5);
        expect(moderateDebt).toBeCloseTo(0.5, 2);

        const highDebt = evaluator.calculateStaticDebtScore(80, 2400, 25);
        expect(highDebt).toBeGreaterThan(0.75);
        expect(highDebt).toBeLessThanOrEqual(1.0);
    });

    it('assigns strictly zero hotspot score to dormant files regardless of debt', () => {
        const dormantComplexFile: FileHotspotInput = {
            filePath: 'src/legacy/complex-dormant.ts',
            commits30Days: 0,
            eloc: 2000,
            cyclomaticComplexity: 50,
            defectCount: 15,
        };

        const score = evaluator.calculateHotspotScore(dormantComplexFile);
        const interest = evaluator.calculateInterestMultiplier(dormantComplexFile);

        expect(score).toBe(0.0);
        expect(interest).toBe(1.0);
    });

    it('computes elevated hotspot score and compounding interest for active complex code', () => {
        const activeComplexFile: FileHotspotInput = {
            filePath: 'src/core/active-hotspot.ts',
            commits30Days: 25,
            eloc: 1200,
            cyclomaticComplexity: 35,
            defectCount: 8,
        };

        const score = evaluator.calculateHotspotScore(activeComplexFile);
        const interest = evaluator.calculateInterestMultiplier(activeComplexFile);

        expect(score).toBeGreaterThan(40.0);
        expect(interest).toBeGreaterThan(2.0);
        expect(interest).toBeLessThanOrEqual(5.0);
    });

    it('evaluates single file and provides critical refactoring recommendations', () => {
        const criticalInput: FileHotspotInput = {
            filePath: 'src/core/critical-kernel.ts',
            commits30Days: 45,
            eloc: 1800,
            cyclomaticComplexity: 45,
            defectCount: 12,
        };

        const result = evaluator.evaluateSingle(criticalInput);

        expect(result.filePath).toBe('src/core/critical-kernel.ts');
        expect(result.severity).toBe('critical');
        expect(result.hotspotScore).toBeGreaterThanOrEqual(60.0);
        expect(result.interestMultiplier).toBeGreaterThanOrEqual(3.0);
        expect(result.recommendation.action).toBe('immediate_refactor');
        expect(result.recommendation.summary).toContain('Critical behavioral hotspot');
    });

    it('evaluates batch files and assigns deterministic descending ranks', () => {
        const cohort: FileHotspotInput[] = [
            {
                filePath: 'src/cold.ts',
                commits30Days: 0,
                eloc: 100,
                cyclomaticComplexity: 2,
                defectCount: 0,
            },
            {
                filePath: 'src/hot.ts',
                commits30Days: 35,
                eloc: 1500,
                cyclomaticComplexity: 40,
                defectCount: 9,
            },
            {
                filePath: 'src/medium.ts',
                commits30Days: 12,
                eloc: 400,
                cyclomaticComplexity: 15,
                defectCount: 2,
            },
        ];

        const results = evaluator.evaluateBatch(cohort);

        expect(results).toHaveLength(3);
        expect(results[0].filePath).toBe('src/hot.ts');
        expect(results[0].rank).toBe(1);
        expect(results[1].filePath).toBe('src/medium.ts');
        expect(results[1].rank).toBe(2);
        expect(results[2].filePath).toBe('src/cold.ts');
        expect(results[2].rank).toBe(3);
    });

    it('safely extracts 30-day commits from git file history profiles', () => {
        const now = 1700000000000;
        const timeWithin30Days = now - 10 * 24 * 60 * 60 * 1000;
        const timeOlderThan30Days = now - 45 * 24 * 60 * 60 * 1000;

        const timeEvaluator = new BehavioralHotspotEvaluator({ nowTimestamp: now });

        const mockProfile: GitFileHistoryProfile = {
            filePath: 'src/core/profiled.ts',
            isGitAvailable: true,
            totalCommits: 3,
            bugFixCommits: 1,
            authorCommitCounts: { Alice: 3 },
            uniqueAuthorsCount: 1,
            firstSeenTimestamp: timeOlderThan30Days,
            lastModifiedTimestamp: timeWithin30Days,
            recentCommits: [
                {
                    hash: 'c1',
                    author: 'Alice',
                    timestamp: timeWithin30Days,
                    subject: 'fix: patch',
                    isBugFix: true,
                },
                {
                    hash: 'c2',
                    author: 'Alice',
                    timestamp: timeOlderThan30Days,
                    subject: 'feat: add',
                    isBugFix: false,
                },
            ],
        };

        const count = timeEvaluator.extract30DayCommitsFromProfile(mockProfile);
        expect(count).toBe(1);
    });

    it('detects burst spikes and accelerates interest multiplier when short-term churn spikes', () => {
        const burstInput: FileHotspotInput = {
            filePath: 'src/core/burst-module.ts',
            commits30Days: 12,
            commits7Days: 8,
            eloc: 800,
            cyclomaticComplexity: 25,
            defectCount: 4,
        };

        const result = evaluator.evaluateSingle(burstInput);
        expect(result.burstSpike).toBe(true);
        expect(result.churnAcceleration).toBeGreaterThanOrEqual(2.0);
        expect(result.recommendation.summary).toContain('[BURST SPIKE');
    });

    it('computes Shannon author entropy and dominant author ratio accurately', () => {
        // Single author: 0 entropy, 1.0 dominant ratio
        const singleAuthor = calculateAuthorEntropy({ Alice: 15 });
        expect(singleAuthor.entropy).toBe(0.0);
        expect(singleAuthor.primaryAuthorRatio).toBe(1.0);

        // 4 perfectly equal authors: maximum entropy (1.0), 0.25 dominant ratio
        const fourEqual = calculateAuthorEntropy({ Alice: 10, Bob: 10, Carol: 10, Dave: 10 });
        expect(fourEqual.entropy).toBe(1.0);
        expect(fourEqual.primaryAuthorRatio).toBe(0.25);

        // Skewed: Alice did 70, Bob did 10, Carol did 20
        const skewed = calculateAuthorEntropy({ Alice: 70, Bob: 10, Carol: 20 });
        expect(skewed.entropy).toBeGreaterThan(0.5);
        expect(skewed.entropy).toBeLessThan(1.0);
        expect(skewed.primaryAuthorRatio).toBe(0.7);

        // Empty or invalid input
        const empty = calculateAuthorEntropy({});
        expect(empty.entropy).toBe(0.0);
        expect(empty.primaryAuthorRatio).toBe(1.0);
    });

    it('flags author diffusion and compounds debt interest on fragmented ownership', () => {
        const diffusedInput: FileHotspotInput = {
            filePath: 'src/core/shared-commons.ts',
            commits30Days: 14,
            eloc: 950,
            cyclomaticComplexity: 28,
            defectCount: 5,
            authorEntropy: 0.88,
            primaryAuthorRatio: 0.28,
        };

        const result = evaluator.evaluateSingle(diffusedInput);
        expect(result.authorDiffusion).toBe(true);
        expect(result.authorEntropy).toBe(0.88);
        expect(result.recommendation.summary).toContain('[AUTHOR DIFFUSION:');
    });

    it('detects developer congestion and calculates Brooks Law coordination channels', () => {
        const congestedInput: FileHotspotInput = {
            filePath: 'src/core/congested-hub.ts',
            commits30Days: 12,
            eloc: 750,
            cyclomaticComplexity: 22,
            defectCount: 3,
            activeAuthorsCount: 5,
        };

        const result = evaluator.evaluateSingle(congestedInput);
        expect(result.developerCongestion).toBe(true);
        expect(result.activeAuthorsCount).toBe(5);
        expect(result.coordinationPaths).toBe(10); // 5 * 4 / 2 = 10
        expect(result.recommendation.summary).toContain('[DEVELOPER CONGESTION:');
        expect(result.recommendation.summary).toContain(
            '5 active authors and 10 communication channels',
        );
    });

    it('quantifies code health decay velocity and alerts on rapid decay', () => {
        const decayingInput: FileHotspotInput = {
            filePath: 'src/core/decaying-module.ts',
            commits30Days: 10,
            commits7Days: 6, // 7-day rate = 6/7 = 0.857, 30-day rate = 10/30 = 0.333 -> churnAcceleration = 2.57
            eloc: 750,
            cyclomaticComplexity: 22,
            defectCount: 4,
        };

        const result = evaluator.evaluateSingle(decayingInput);
        expect(result.decayVelocity).toBeGreaterThanOrEqual(2.0);
        expect(result.rapidDecay).toBe(true);
        expect(result.recommendation.summary).toContain('[RAPID DECAY:');
    });

    it('safely extracts 7-day commits from git file history profiles', () => {
        const now = 1700000000000;
        const timeWithin7Days = now - 3 * 24 * 60 * 60 * 1000;
        const timeWithin30Days = now - 15 * 24 * 60 * 60 * 1000;

        const timeEvaluator = new BehavioralHotspotEvaluator({ nowTimestamp: now });

        const mockProfile: GitFileHistoryProfile = {
            filePath: 'src/core/profiled7.ts',
            isGitAvailable: true,
            totalCommits: 2,
            bugFixCommits: 0,
            authorCommitCounts: { Bob: 2 },
            uniqueAuthorsCount: 1,
            firstSeenTimestamp: timeWithin30Days,
            lastModifiedTimestamp: timeWithin7Days,
            recentCommits: [
                {
                    hash: 'c1',
                    author: 'Bob',
                    timestamp: timeWithin7Days,
                    subject: 'fix: patch',
                    isBugFix: true,
                },
                {
                    hash: 'c2',
                    author: 'Bob',
                    timestamp: timeWithin30Days,
                    subject: 'feat: add',
                    isBugFix: false,
                },
            ],
        };

        expect(timeEvaluator.extract7DayCommitsFromProfile(mockProfile)).toBe(1);
        expect(timeEvaluator.extract30DayCommitsFromProfile(mockProfile)).toBe(2);
    });

    it('gracefully degrades to safe defaults on malformed or empty inputs', () => {
        const nullResult = evaluator.evaluateSingle(null as unknown as FileHotspotInput);
        expect(nullResult.hotspotScore).toBe(0.0);
        expect(nullResult.interestMultiplier).toBe(1.0);
        expect(nullResult.severity).toBe('low');

        const negativeInput: FileHotspotInput = {
            filePath: 'src/edge.ts',
            commits30Days: -5,
            eloc: -100,
            cyclomaticComplexity: NaN,
            defectCount: -2,
        };

        const edgeResult = evaluator.evaluateSingle(negativeInput);
        expect(edgeResult.hotspotScore).toBe(0.0);
        expect(edgeResult.interestMultiplier).toBe(1.0);

        const emptyBatch = evaluator.evaluateBatch([]);
        expect(emptyBatch).toEqual([]);
    });
});

describe('TemporalCouplingDetector — Pure Data & Shotgun Surgery', () => {
    const detector = new TemporalCouplingDetector({
        minJaccardSimilarity: 0.6,
        minSharedCommits: 2,
    });

    it('normalizes file paths cleanly', () => {
        expect(normalizeEvolutionPath('src\\core\\scanner\\file.ts')).toBe(
            'src/core/scanner/file.ts',
        );
        expect(normalizeEvolutionPath('/src/core/../core/file.ts')).toContain('file.ts');
    });

    it('resolves architectural modules with defaultModuleResolver', () => {
        expect(defaultModuleResolver('src/core/scanner/analyzer.ts')).toBe('src/core/scanner');
        expect(defaultModuleResolver('src/core/evolution/hotspot.ts')).toBe('src/core/evolution');
        expect(defaultModuleResolver('src/cli/index.ts')).toBe('src/cli');
        expect(defaultModuleResolver('tests/unit/test.ts')).toBe('tests/unit');
    });

    it('detects 100% co-change pairs with high Jaccard similarity', () => {
        const changeSets: CommitChangeSet[] = [
            { commitHash: 'c1', changedFiles: ['src/core/alpha.ts', 'src/core/beta.ts'] },
            { commitHash: 'c2', changedFiles: ['src/core/alpha.ts', 'src/core/beta.ts'] },
            { commitHash: 'c3', changedFiles: ['src/core/alpha.ts', 'src/core/beta.ts'] },
        ];

        const report = detector.detectFromChangeSets(changeSets);

        expect(report.pairs).toHaveLength(1);
        const pair = report.pairs[0];
        expect(pair.fileA).toBe('src/core/alpha.ts');
        expect(pair.fileB).toBe('src/core/beta.ts');
        expect(pair.sharedCommits).toBe(3);
        expect(pair.jaccardSimilarity).toBe(1.0);
        expect(pair.couplingPercentage).toBe(100.0);
        expect(pair.isCrossModule).toBe(false);
    });

    it('identifies cross-module shotgun surgery when different modules co-change', () => {
        const changeSets: CommitChangeSet[] = [
            {
                commitHash: 'c1',
                changedFiles: ['src/core/scanner/analyzer.ts', 'src/core/reporting/html-report.ts'],
            },
            {
                commitHash: 'c2',
                changedFiles: ['src/core/scanner/analyzer.ts', 'src/core/reporting/html-report.ts'],
            },
            {
                commitHash: 'c3',
                changedFiles: ['src/core/scanner/analyzer.ts', 'src/core/reporting/html-report.ts'],
            },
            {
                commitHash: 'c4',
                changedFiles: ['src/core/scanner/analyzer.ts'],
            },
        ];

        const report = detector.detectFromChangeSets(changeSets);

        expect(report.pairs).toHaveLength(1);
        const pair = report.pairs[0];
        expect(pair.isCrossModule).toBe(true);
        expect(pair.moduleA).toBe('src/core/reporting');
        expect(pair.moduleB).toBe('src/core/scanner');
        expect(pair.sharedCommits).toBe(3);
        // Union: 4 + 3 - 3 = 4 -> Jaccard: 3/4 = 0.75
        expect(pair.jaccardSimilarity).toBeCloseTo(0.75, 2);
        expect(pair.warningMessage).toContain('Cross-module shotgun surgery detected');
        expect(report.crossModuleWarningCount).toBe(1);
    });

    it('filters out weak co-changes below the minimum Jaccard threshold', () => {
        const changeSets: CommitChangeSet[] = [
            // Shared twice
            { commitHash: 'c1', changedFiles: ['src/core/a.ts', 'src/core/b.ts'] },
            { commitHash: 'c2', changedFiles: ['src/core/a.ts', 'src/core/b.ts'] },
            // A touched in 5 other commits alone
            { commitHash: 'c3', changedFiles: ['src/core/a.ts'] },
            { commitHash: 'c4', changedFiles: ['src/core/a.ts'] },
            { commitHash: 'c5', changedFiles: ['src/core/a.ts'] },
            { commitHash: 'c6', changedFiles: ['src/core/a.ts'] },
            { commitHash: 'c7', changedFiles: ['src/core/a.ts'] },
            // B touched in 4 other commits alone
            { commitHash: 'c8', changedFiles: ['src/core/b.ts'] },
            { commitHash: 'c9', changedFiles: ['src/core/b.ts'] },
            { commitHash: 'c10', changedFiles: ['src/core/b.ts'] },
            { commitHash: 'c11', changedFiles: ['src/core/b.ts'] },
        ];

        // Union: 7 + 6 - 2 = 11. Jaccard: 2 / 11 = 0.18 < 0.6
        const report = detector.detectFromChangeSets(changeSets);
        expect(report.pairs).toHaveLength(0);
    });

    it('filters out incidental single-commit co-changes when minSharedCommits is 2', () => {
        const changeSets: CommitChangeSet[] = [
            { commitHash: 'c1', changedFiles: ['src/a.ts', 'src/b.ts'] },
        ];

        const report = detector.detectFromChangeSets(changeSets);
        expect(report.pairs).toHaveLength(0);
    });

    it('parses raw git log output into structured commit change sets', () => {
        const rawLog = [
            '\x1ecommit101\x1fAlice\x1f1700000000\x1ffix: resolve memory leak\nsrc/core/a.ts\nsrc/core/b.ts',
            '\x1ecommit102\x1fBob\x1f1700010000\x1ffeat: add feature\nsrc/core/b.ts\nsrc/core/c.ts',
        ].join('');

        const changeSets = detector.parseGitLogOutput(rawLog);

        expect(changeSets).toHaveLength(2);
        expect(changeSets[0].commitHash).toBe('commit101');
        expect(changeSets[0].author).toBe('Alice');
        expect(changeSets[0].changedFiles).toEqual(['src/core/a.ts', 'src/core/b.ts']);
        expect(changeSets[1].changedFiles).toEqual(['src/core/b.ts', 'src/core/c.ts']);
    });

    it('gracefully degrades to safe empty report on empty or missing git repository', () => {
        const emptyReport = detector.detectFromChangeSets([]);
        expect(emptyReport.pairs).toEqual([]);
        expect(emptyReport.totalCommitsAnalyzed).toBe(0);
        expect(emptyReport.crossModuleWarningCount).toBe(0);

        const degradedReport = detector.detectFromRepository('non-existent-directory-probe');
        expect(degradedReport.pairs).toEqual([]);
        expect(degradedReport.isGitAvailable).toBe(false);
    });
});
