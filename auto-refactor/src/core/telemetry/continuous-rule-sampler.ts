/**
 * Module: Core Telemetry — Continuous Empirical Rule Sampling Sidecar
 * File Path: src/core/telemetry/continuous-rule-sampler.ts
 * Architecture Role: Non-blocking sidecar telemetry accumulator tracking rule evaluations,
 *   raw detections, suppressions, and spatial co-occurrence topologies across scan runs.
 * Dependencies & Triggers: Consumed by Scanner in src/core/analyzer.ts during scan finalization,
 *   CLI analytics, and governance audit scripts.
 * Responsibilities:
 *   1. Track empirical evaluations, detections, and suppressions per rule across scan sessions;
 *   2. Compute Bayesian Jeffreys Beta(0.5, 0.5) posterior activation frequencies and 95% intervals;
 *   3. Calculate empirical binary entropy of rule activations to quantify information yield;
 *   4. Track spatial file-level co-occurrences and calculate Jaccard similarity matrices;
 *   5. Automatically identify candidate redundant rule clusters when Jaccard index exceeds 0.85;
 *   6. Hydrate and persist sampling ledgers asynchronously without disrupting scan execution.
 * Exit Semantics & Design Rationale: Completely non-blocking and fail-safe. If cache I/O fails,
 *   the error is absorbed and logged without interrupting or degrading the active scan report.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Issue } from '../types';

/**
 * Empirical rule sampling record with Bayesian conjugate prior estimates.
 */
export interface RuleSamplingRecord {
    ruleId: string;
    totalEvaluations: number;
    totalHits: number;
    suppressedHits: number;
    posteriorMean: number;
    credibleLower95: number;
    credibleUpper95: number;
    entropy: number;
    lastObservedTimestamp: number;
}

/**
 * Empirical spatial co-occurrence metrics between pairs of rules.
 */
export interface RuleCoOccurrenceRecord {
    pairKey: string;
    ruleA: string;
    ruleB: string;
    coHits: number;
    jaccardSimilarity: number;
    isRedundantCandidate: boolean;
}

/**
 * Complete serialized rule sampling ledger schema.
 */
export interface RuleSamplingLedger {
    version: string;
    lastUpdated: string;
    totalScans: number;
    totalFilesEvaluated: number;
    rules: Record<string, RuleSamplingRecord>;
    coOccurrences: Record<string, RuleCoOccurrenceRecord>;
}

/**
 * Options for recording a completed scan into the sampling sidecar.
 */
export interface RecordScanOptions {
    filesScanned: number;
    issues: Issue[];
    timestamp?: number;
}

interface PosteriorMetrics {
    mean: number;
    lower95: number;
    upper95: number;
    entropy: number;
}

const LEDGER_SCHEMA_VERSION = '1.0.0';
const REDUNDANCY_JACCARD_THRESHOLD = 0.85;
const REDUNDANCY_MIN_COHITS = 5;
const NORMAL_95_Z = 1.96;
const PRECISION_POSTERIOR = 6;
const PRECISION_JACCARD = 4;

interface CoOccurrenceEntry {
    ruleA: string;
    ruleB: string;
    coHits: number;
}

/**
 * Computes binary Shannon entropy for a given activation probability.
 *
 * @param probability - Activation probability in [0, 1].
 * @returns Binary entropy in bits in [0, 1].
 */
export function computeBinaryEntropy(probability: number): number {
    if (probability <= 0 || probability >= 1) {
        return 0;
    }
    const probActive = probability;
    const probInactive = 1 - probability;
    const entropy = -(probActive * Math.log2(probActive) + probInactive * Math.log2(probInactive));
    return Number.isFinite(entropy) ? Math.max(0, Math.min(1, entropy)) : 0;
}

/**
 * Computes Bayesian Beta(0.5, 0.5) conjugate posterior statistics.
 *
 * @param hits - Observed hit count.
 * @param evaluations - Total opportunity evaluations.
 * @returns Posterior mean, 95% credible interval, and entropy.
 */
export function computeJeffreysPosterior(hits: number, evaluations: number): PosteriorMetrics {
    const alpha0 = 0.5;
    const beta0 = 0.5;
    const alpha = hits + alpha0;
    const beta = Math.max(0, evaluations - hits) + beta0;
    const total = alpha + beta;

    const mean = alpha / total;
    const variance = (alpha * beta) / (total * total * (total + 1));
    const stdDev = Math.sqrt(Math.max(0, variance));

    const lower95 = Math.max(0, mean - NORMAL_95_Z * stdDev);
    const upper95 = Math.min(1, mean + NORMAL_95_Z * stdDev);
    const entropy = computeBinaryEntropy(mean);

    return {
        mean: +mean.toFixed(PRECISION_POSTERIOR),
        lower95: +lower95.toFixed(PRECISION_POSTERIOR),
        upper95: +upper95.toFixed(PRECISION_POSTERIOR),
        entropy: +entropy.toFixed(PRECISION_POSTERIOR),
    };
}

/**
 * Derives a canonical lexicographically ordered pair key for two rule IDs.
 *
 * @param ruleA - First rule identifier.
 * @param ruleB - Second rule identifier.
 * @returns Sorted pair identifier tuple and string key.
 */
export function createSortedPairKey(
    ruleA: string,
    ruleB: string,
): { key: string; first: string; second: string } {
    if (ruleA < ruleB) {
        return { key: `${ruleA}::${ruleB}`, first: ruleA, second: ruleB };
    }
    return { key: `${ruleB}::${ruleA}`, first: ruleB, second: ruleA };
}

/**
 * Computes Jaccard similarity index from co-occurrence and marginal counts.
 *
 * @param coHits - Count of joint occurrences.
 * @param hitsA - Marginal hit count of rule A.
 * @param hitsB - Marginal hit count of rule B.
 * @returns Jaccard similarity coefficient in [0, 1].
 */
export function computeFrequencyJaccardSimilarity(
    coHits: number,
    hitsA: number,
    hitsB: number,
): number {
    const union = hitsA + hitsB - coHits;
    if (union <= 0) return 0;
    const similarity = coHits / union;
    return +Math.min(1, Math.max(0, similarity)).toFixed(PRECISION_JACCARD);
}

function getOrCreateFileRuleSet(map: Map<string, Set<string>>, file: string): Set<string> {
    const existing = map.get(file);
    if (existing) return existing;
    const created = new Set<string>();
    map.set(file, created);
    return created;
}

/**
 * Continuous rule sampling sidecar tracking rule frequency dynamics and redundancies.
 */
export class ContinuousRuleSamplingSidecar {
    private totalScans = 0;
    private totalFilesEvaluated = 0;
    private readonly ruleRecords = new Map<string, RuleSamplingRecord>();
    private readonly ruleFileHitCounts = new Map<string, number>();
    private readonly coOccurrenceEntries = new Map<string, CoOccurrenceEntry>();

    /**
     * Ingests a completed scan pass into the empirical sampling distribution.
     *
     * @param options - Execution scan outcome containing filesScanned and collected issues.
     */
    public recordScan(options: RecordScanOptions): void {
        const { filesScanned, issues } = options;
        const now = options.timestamp ?? Date.now();
        const effectiveFiles = Math.max(0, filesScanned);

        this.totalScans += 1;
        this.totalFilesEvaluated += effectiveFiles;

        const fileHitsMap = new Map<string, Set<string>>();
        const scanRuleHits = new Map<string, number>();
        const scanRuleSuppressions = new Map<string, number>();

        this.accumulateScanIssues({
            issues,
            fileHitsMap,
            scanRuleHits,
            scanRuleSuppressions,
        });

        this.updateRuleRecords({
            scanRuleHits,
            scanRuleSuppressions,
            fileHitsMap,
            effectiveFiles,
            now,
        });

        this.updateCoOccurrences(fileHitsMap);
    }

    private accumulateScanIssues(params: {
        issues: Issue[];
        fileHitsMap: Map<string, Set<string>>;
        scanRuleHits: Map<string, number>;
        scanRuleSuppressions: Map<string, number>;
    }): void {
        const { issues, fileHitsMap, scanRuleHits, scanRuleSuppressions } = params;

        for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            const ruleId = issue.rule;
            if (!ruleId) continue;

            scanRuleHits.set(ruleId, (scanRuleHits.get(ruleId) ?? 0) + 1);
            if (issue.suppression || issue.clusteredInto) {
                scanRuleSuppressions.set(ruleId, (scanRuleSuppressions.get(ruleId) ?? 0) + 1);
            }

            const fileRules = getOrCreateFileRuleSet(fileHitsMap, issue.location.file);
            fileRules.add(ruleId);
        }
    }

    private updateRuleRecords(params: {
        scanRuleHits: Map<string, number>;
        scanRuleSuppressions: Map<string, number>;
        fileHitsMap: Map<string, Set<string>>;
        effectiveFiles: number;
        now: number;
    }): void {
        const { scanRuleHits, scanRuleSuppressions, fileHitsMap, effectiveFiles, now } = params;

        for (const fileRules of fileHitsMap.values()) {
            for (const ruleId of fileRules) {
                this.ruleFileHitCounts.set(ruleId, (this.ruleFileHitCounts.get(ruleId) ?? 0) + 1);
            }
        }

        for (const [ruleId, hits] of scanRuleHits.entries()) {
            const existing = this.ruleRecords.get(ruleId);
            const totalHits = (existing?.totalHits ?? 0) + hits;
            const suppressedHits =
                (existing?.suppressedHits ?? 0) + (scanRuleSuppressions.get(ruleId) ?? 0);
            const totalEvaluations =
                (existing?.totalEvaluations ?? this.totalFilesEvaluated - effectiveFiles) +
                effectiveFiles;

            const posterior = computeJeffreysPosterior(
                totalHits,
                Math.max(totalHits, totalEvaluations),
            );

            this.ruleRecords.set(ruleId, {
                ruleId,
                totalEvaluations,
                totalHits,
                suppressedHits,
                posteriorMean: posterior.mean,
                credibleLower95: posterior.lower95,
                credibleUpper95: posterior.upper95,
                entropy: posterior.entropy,
                lastObservedTimestamp: now,
            });
        }
    }

    private updateCoOccurrences(fileHitsMap: Map<string, Set<string>>): void {
        for (const rulesInFile of fileHitsMap.values()) {
            if (rulesInFile.size >= 2) {
                this.accumulateRulePairsForFile(Array.from(rulesInFile).sort());
            }
        }
    }

    private accumulateRulePairsForFile(rulesArray: string[]): void {
        for (let i = 0; i < rulesArray.length; i++) {
            for (let j = i + 1; j < rulesArray.length; j++) {
                const pair = createSortedPairKey(rulesArray[i], rulesArray[j]);
                const existing = this.coOccurrenceEntries.get(pair.key);
                if (existing) {
                    existing.coHits += 1;
                } else {
                    this.coOccurrenceEntries.set(pair.key, {
                        ruleA: pair.first,
                        ruleB: pair.second,
                        coHits: 1,
                    });
                }
            }
        }
    }

    /**
     * Builds and exports a deeply frozen snapshot of the cumulative rule sampling ledger.
     *
     * @returns Immutable RuleSamplingLedger object.
     */
    public exportLedger(): Readonly<RuleSamplingLedger> {
        const rules: Record<string, RuleSamplingRecord> = {};
        for (const [ruleId, record] of this.ruleRecords.entries()) {
            rules[ruleId] = Object.freeze({ ...record });
        }

        const coOccurrences: Record<string, RuleCoOccurrenceRecord> = {};
        for (const [pairKey, item] of this.coOccurrenceEntries.entries()) {
            const hitsA = this.ruleFileHitCounts.get(item.ruleA) ?? item.coHits;
            const hitsB = this.ruleFileHitCounts.get(item.ruleB) ?? item.coHits;
            const similarity = computeFrequencyJaccardSimilarity(item.coHits, hitsA, hitsB);

            coOccurrences[pairKey] = Object.freeze({
                pairKey,
                ruleA: item.ruleA,
                ruleB: item.ruleB,
                coHits: item.coHits,
                jaccardSimilarity: similarity,
                isRedundantCandidate:
                    similarity >= REDUNDANCY_JACCARD_THRESHOLD &&
                    item.coHits >= REDUNDANCY_MIN_COHITS,
            });
        }

        return Object.freeze({
            version: LEDGER_SCHEMA_VERSION,
            lastUpdated: new Date().toISOString(),
            totalScans: this.totalScans,
            totalFilesEvaluated: this.totalFilesEvaluated,
            rules: Object.freeze(rules),
            coOccurrences: Object.freeze(coOccurrences),
        });
    }

    /**
     * Hydrates state from a previously persisted sampling ledger.
     *
     * @param data - Candidate parsed JSON object.
     */
    public importLedger(data: unknown): void {
        if (!data || typeof data !== 'object') return;
        const candidate = data as Partial<RuleSamplingLedger>;

        this.importMetadata(candidate);
        this.importRuleRecords(candidate.rules);
        this.importCoOccurrences(candidate.coOccurrences);
    }

    private importMetadata(candidate: Partial<RuleSamplingLedger>): void {
        if (typeof candidate.totalScans === 'number') {
            this.totalScans = Math.max(0, candidate.totalScans);
        }
        if (typeof candidate.totalFilesEvaluated === 'number') {
            this.totalFilesEvaluated = Math.max(0, candidate.totalFilesEvaluated);
        }
    }

    private importSingleRuleRecord(ruleId: string, item: unknown): void {
        if (!item || typeof item !== 'object') return;
        const record = item as Partial<RuleSamplingRecord>;
        const totalHits = Number(record.totalHits) || 0;

        this.ruleRecords.set(ruleId, {
            ruleId,
            totalEvaluations: Number(record.totalEvaluations) || 0,
            totalHits,
            suppressedHits: Number(record.suppressedHits) || 0,
            posteriorMean: Number(record.posteriorMean) || 0,
            credibleLower95: Number(record.credibleLower95) || 0,
            credibleUpper95: Number(record.credibleUpper95) || 0,
            entropy: Number(record.entropy) || 0,
            lastObservedTimestamp: Number(record.lastObservedTimestamp) || Date.now(),
        });
        this.ruleFileHitCounts.set(ruleId, totalHits);
    }

    private importRuleRecords(rules: unknown): void {
        if (!rules || typeof rules !== 'object') return;
        for (const [ruleId, item] of Object.entries(rules)) {
            this.importSingleRuleRecord(ruleId, item);
        }
    }

    private importCoOccurrences(coOccurrences: unknown): void {
        if (!coOccurrences || typeof coOccurrences !== 'object') return;
        for (const [key, item] of Object.entries(coOccurrences)) {
            if (!item || typeof item !== 'object') continue;
            const coRecord = item as Partial<RuleCoOccurrenceRecord>;
            if (coRecord.ruleA && coRecord.ruleB) {
                this.coOccurrenceEntries.set(key, {
                    ruleA: coRecord.ruleA,
                    ruleB: coRecord.ruleB,
                    coHits: Number(coRecord.coHits) || 0,
                });
            }
        }
    }

    /**
     * Asynchronously loads ledger data from disk fail-safely.
     *
     * @param ledgerPath - Path to stored ledger file.
     * @returns True if successfully loaded, false otherwise.
     */
    public async loadLedgerFromFile(ledgerPath: string): Promise<boolean> {
        try {
            const raw = await fs.promises.readFile(ledgerPath, 'utf8');
            const parsed = JSON.parse(raw);
            this.importLedger(parsed);
            return true;
        } catch (readError) {
            void readError;
            return false;
        }
    }

    /**
     * Asynchronously writes ledger data to disk fail-safely.
     *
     * @param ledgerPath - Target disk path.
     */
    public async saveLedgerToFile(ledgerPath: string): Promise<void> {
        try {
            const dir = path.dirname(ledgerPath);
            await fs.promises.mkdir(dir, { recursive: true });
            const snapshot = this.exportLedger();
            const payload = JSON.stringify(snapshot, null, 2);
            await fs.promises.writeFile(ledgerPath, payload, 'utf8');
        } catch (writeError) {
            void writeError;
        }
    }
}

/**
 * Shared default singleton instance of the continuous rule sampler sidecar.
 */
export const defaultContinuousRuleSampler = new ContinuousRuleSamplingSidecar();
