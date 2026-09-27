/**
 * Module: Core Evolution — Code Evolution Analyzer
 * File Path: src/core/evolution/code-evolution-analyzer.ts
 * Architecture Role: Computes time-series code evolution vulnerability multiplier V_evo(f)
 *   from git history metrics to dynamically amplify defect-prone technical debt deductions.
 * Dependencies & Triggers: Imports GitFileHistoryProfile from ./git-history-miner;
 *   invoked by QualityScorer and governance auditing pipelines.
 * Responsibilities:
 *   1. Calculate bug-prone quotient from historical fix/patch commit ratios.
 *   2. Compute normalized author entropy from multi-contributor churn distribution.
 *   3. Quantify code decay index based on staleness and elapsed modification windows.
 *   4. Evaluate technical debt velocity (convergence vs divergence rate).
 *   5. Formulate unified vulnerability multiplier V_evo(f) clamped to [0.5, 3.0].
 * Exit Semantics & Design Rationale: Safe 1.0 multiplier fallback when git data is absent,
 *   preventing false penalties in fresh or non-versioned environments.
 */

import {
    GitHistoryMiner,
    type GitFileHistoryProfile,
    type GitCommitRecord,
} from './git-history-miner';

/**
 * Detailed evolution metric measurements for a given file.
 */
export interface CodeEvolutionMetrics {
    filePath: string;
    vulnerabilityMultiplier: number;
    bugProneScore: number; // [0.0, 1.0]
    authorEntropyScore: number; // [0.0, 1.0]
    decayScore: number; // [0.0, 1.0]
    debtVelocityScore: number; // [-1.0, 1.0], positive = converging debt (healthy)
    isGitAvailable: boolean;
    totalCommitsEvaluated: number;
    actionableProposal?: {
        action: 'hotspot_refactor_recommended' | 'assign_code_owner' | 'stabilize_decay';
        rationale: string;
    };
}

/**
 * Configuration options for tuning evolutionary metrics, aging decay, and churn weights.
 */
export interface EvolutionAnalyzerOptions {
    nowTimestamp?: number;
    decayThresholdDays?: number;
    weightBugProne?: number;
    weightEntropy?: number;
    weightDecay?: number;
    weightVelocity?: number;
}

/**
 * Historical code evolution analyzer evaluating churn velocity,
 * bug proneness, and ownership entropy.
 */
export class CodeEvolutionAnalyzer {
    private readonly miner: GitHistoryMiner;
    private readonly nowTimestamp: number;
    private readonly decayThresholdDays: number;
    private readonly weightBugProne: number;
    private readonly weightEntropy: number;
    private readonly weightDecay: number;
    private readonly weightVelocity: number;

    constructor(miner?: GitHistoryMiner, options?: EvolutionAnalyzerOptions) {
        this.miner = miner || new GitHistoryMiner();
        this.nowTimestamp = options?.nowTimestamp ?? Date.now();
        this.decayThresholdDays = options?.decayThresholdDays ?? 180;
        this.weightBugProne = options?.weightBugProne ?? 0.5;
        this.weightEntropy = options?.weightEntropy ?? 0.3;
        this.weightDecay = options?.weightDecay ?? 0.2;
        this.weightVelocity = options?.weightVelocity ?? 0.2;
    }

    /**
     * Preload repository git history in batch to accelerate multiple file evaluations.
     *
     * @param targetDir - Optional root directory.
     * @param maxCommits - Optional maximum number of commits.
     */
    public preloadRepository(targetDir?: string, maxCommits?: number): void {
        this.miner.preloadRepository(targetDir, maxCommits);
    }

    /**
     * Analyze git evolution metrics for a batch of files with automated cache preloading.
     *
     * @param filePaths - Array of absolute or relative file paths.
     * @param targetDir - Optional root directory.
     * @returns Map of file paths to their CodeEvolutionMetrics.
     */
    public analyzeFilesBatch(
        filePaths: string[],
        targetDir?: string,
    ): Map<string, CodeEvolutionMetrics> {
        if (filePaths.length >= 3 && !this.miner.hasBatchCache()) {
            this.miner.preloadRepository(targetDir);
        }
        const results = new Map<string, CodeEvolutionMetrics>();
        for (const fp of filePaths) {
            results.set(fp, this.analyzeFile(fp, targetDir));
        }
        return results;
    }

    /**
     * Analyze git history of a target file and calculate its evolution vulnerability profile.
     *
     * @param filePath - Path of the file to analyze.
     * @param targetDir - Optional root directory for git execution.
     * @returns Computed CodeEvolutionMetrics.
     */
    public analyzeFile(filePath: string, targetDir?: string): CodeEvolutionMetrics {
        const historyProfile = this.miner.mineFileHistory(filePath, targetDir);
        return this.evaluateProfile(historyProfile);
    }

    /**
     * Pure evaluator transforming a GitFileHistoryProfile into quantified evolution metrics.
     */
    public evaluateProfile(profile: GitFileHistoryProfile): CodeEvolutionMetrics {
        if (!profile.isGitAvailable || profile.totalCommits === 0) {
            return {
                filePath: profile.filePath,
                vulnerabilityMultiplier: 1.0,
                bugProneScore: 0.0,
                authorEntropyScore: 0.0,
                decayScore: 0.0,
                debtVelocityScore: 0.0,
                isGitAvailable: false,
                totalCommitsEvaluated: 0,
            };
        }

        // 1. Bug-Prone Ratio: Bug fix commits / total commits
        const bugProneScore = +(profile.bugFixCommits / (profile.totalCommits + 0.0001)).toFixed(3);

        // 2. Author Entropy: Shannon entropy normalized by log2(K)
        const authorEntropyScore = this.calculateAuthorEntropy(
            profile.authorCommitCounts,
            profile.totalCommits,
        );

        // 3. Decay Index: Elapsed staleness from last modification
        const decayScore = this.calculateDecayScore(profile.lastModifiedTimestamp);

        // 4. Debt Velocity: Trend comparison between earlier and recent commits
        const debtVelocityScore = this.calculateDebtVelocity(profile.recentCommits);

        // 5. Composite Vulnerability Multiplier V_evo(f)
        // V_evo = 1.0 + w1*Bug + w2*Entropy + w3*Decay - w4*Velocity
        const rawMultiplier =
            1.0 +
            this.weightBugProne * bugProneScore +
            this.weightEntropy * authorEntropyScore +
            this.weightDecay * decayScore -
            this.weightVelocity * debtVelocityScore;

        const clampedMultiplier = +Math.max(0.5, Math.min(3.0, rawMultiplier)).toFixed(2);

        // 6. Actionable proposal generation for AI agent
        let actionableProposal: CodeEvolutionMetrics['actionableProposal'];
        if (clampedMultiplier >= 1.6 && bugProneScore > 0.4) {
            actionableProposal = {
                action: 'hotspot_refactor_recommended',
                rationale:
                    `File '${profile.filePath}' has high historical bug-proneness ` +
                    `(${(bugProneScore * 100).toFixed(0)}% fix commits). ` +
                    `Vulnerability multiplier is ${clampedMultiplier}x. ` +
                    `Modular decomposition and hardening are recommended.`,
            };
        } else if (authorEntropyScore > 0.75 && profile.uniqueAuthorsCount >= 4) {
            actionableProposal = {
                action: 'assign_code_owner',
                rationale:
                    `High author entropy (${authorEntropyScore}) across ` +
                    `${profile.uniqueAuthorsCount} contributors indicates fragmented ownership. ` +
                    `Establish a dedicated code owner to prevent structural drift.`,
            };
        } else if (decayScore > 0.7) {
            actionableProposal = {
                action: 'stabilize_decay',
                rationale:
                    `File has remained unmodified for an extended period ` +
                    `(decay score ${decayScore}). Verify API compatibility against modernized modules.`,
            };
        }

        return {
            filePath: profile.filePath,
            vulnerabilityMultiplier: clampedMultiplier,
            bugProneScore,
            authorEntropyScore,
            decayScore,
            debtVelocityScore,
            isGitAvailable: true,
            totalCommitsEvaluated: profile.totalCommits,
            actionableProposal,
        };
    }

    /**
     * Compute normalized Shannon entropy H / log2(K) of author contributions.
     */
    private calculateAuthorEntropy(
        authorCounts: Record<string, number>,
        totalCommits: number,
    ): number {
        const authors = Object.keys(authorCounts);
        const k = authors.length;
        if (k <= 1 || totalCommits <= 1) {
            return 0.0;
        }

        let entropy = 0.0;
        for (const author of authors) {
            const count = authorCounts[author];
            const p = count / totalCommits;
            if (p > 0) {
                entropy -= p * (Math.log(p) / Math.LN2);
            }
        }

        const maxEntropy = Math.log(k) / Math.LN2;
        if (maxEntropy <= 0.0001) {
            return 0.0;
        }

        return +Math.min(1.0, Math.max(0.0, entropy / maxEntropy)).toFixed(3);
    }

    /**
     * Compute decay score [0.0, 1.0] based on days since last commit.
     */
    private calculateDecayScore(lastModifiedTimestamp: number | null): number {
        if (!lastModifiedTimestamp) return 0.0;

        const elapsedMs = Math.max(0, this.nowTimestamp - lastModifiedTimestamp);
        const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

        if (elapsedDays <= 30) {
            return 0.0;
        }

        // Linear ramp between 30 days and (30 + decayThresholdDays)
        const ramp = (elapsedDays - 30) / this.decayThresholdDays;
        return +Math.min(1.0, Math.max(0.0, ramp)).toFixed(3);
    }

    /**
     * Compute debt velocity [-1.0, 1.0]: positive = converging (fewer bugs recently).
     */
    private calculateDebtVelocity(commits: GitCommitRecord[]): number {
        if (commits.length < 4) {
            return 0.0;
        }

        // Split commits chronologically into older half and newer half
        // (recentCommits are ordered from newest to oldest in git log)
        const mid = Math.floor(commits.length / 2);
        const newerHalf = commits.slice(0, mid);
        const olderHalf = commits.slice(mid);

        const newerBugRatio = newerHalf.filter((c) => c.isBugFix).length / newerHalf.length;
        const olderBugRatio = olderHalf.filter((c) => c.isBugFix).length / olderHalf.length;

        // If olderBugRatio > newerBugRatio, debt is converging (positive velocity)
        const diff = olderBugRatio - newerBugRatio;
        return +Math.max(-1.0, Math.min(1.0, diff)).toFixed(3);
    }
}
