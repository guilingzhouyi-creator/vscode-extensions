/**
 * Module: Core Reporting — Post-Scan Governance, Calibration & Evolution Enrichment
 * File Path: src/core/reporting/post-scan-enrichment.ts
 * Architecture Role: Cohesive post-scan enrichment subsystem unifying native eight-pillar
 *   hierarchical synthesis, three-source Bayesian calibration loading, adaptive supervisor
 *   weight evolution, single-pass Git evolution/temporal coupling analysis, and LCOV coverage
 *   damping into ScanReport without inflating reportFinalizer volume.
 * Dependencies & Triggers: Consumes fs.promises, ../scoring, ../praxis/feedback-adaptive-supervisor
 *   and ../evolution, ../telemetry/lcov-ingester, ../intelligence/elastic-debt-budget; invoked by
 *   reportFinalizer during async report finalization.
 * Responsibilities:
 *   1. Deserialize review-verdicts.json via JSON.parse and merge baseline corpus + online memory.
 *   2. Synchronize FeedbackAdaptiveSupervisor weights and Empirical-Bayes tuned parameters.
 *   3. Synthesize native ScanReport.governance (eightPillars, domains, topHotspots).
 *   4. Reuse a single GitHistoryMiner batch for hotspots, fragility, and temporal coupling, and
 *      apply LCOV line-level coverage damping onto ScanReport.evolution.
 * Exit Semantics & Design Rationale: Strictly asynchronous I/O (zero *Sync calls); fail-soft on
 *   missing optional telemetry artifacts while explicitly logging corrupt JSON ledgers.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    EvolutionFragileFileEntry,
    EvolutionSummary,
    EvolutionTemporalCouplingEntry,
    FileMetric,
    HierarchicalDomainSummary,
    HierarchicalGovernanceSummary,
    HierarchicalHotspotEntry,
    Issue,
    ScanConfig,
    ScanReport,
    Severity,
} from '../types';
import type { Scanner } from '../analyzer';
import type { Logger } from '../logger';
import type { RuleCalibrationStats } from '../scoring/confidence-calibration';
import {
    harvestOnlineCalibrationCounts,
    loadCalibrationCorpus,
    type RuleOutcomeCounts,
} from '../scoring/calibration-corpus';
import { aggregateVerdicts, parseReviewVerdictLedger } from '../scoring/review-verdict-ledger';
import {
    aggregateProjectScore,
    computeStaticIssueRisk,
    fuseCascadedRisks,
    resolveQualityGrade,
    RollingSamplingGovernor,
    scoreFileQuality,
    synthesizeEightPillars,
    tuneParametersEmpiricalBayes,
    type FileQualityScore,
    type FusionWeights,
} from '../scoring';
import { extractDomainName } from '../architecture/roleInference';
import { defaultAdaptiveSupervisor } from '../praxis/feedback-adaptive-supervisor';
import { classifyElasticDebtTier } from '../intelligence/elastic-debt-budget';
import {
    BehavioralHotspotEvaluator,
    CodeEvolutionAnalyzer,
    GitHistoryMiner,
    TemporalCouplingDetector,
    type CommitChangeSet,
    type FileHotspotInput,
    type GitFileHistoryProfile,
} from '../evolution';
import { LcovIngester, type FileCoverageProfile } from '../telemetry/lcov-ingester';
import {
    deriveScoreMemoKey,
    loadScoreMemo,
    saveScoreMemo,
    SCORE_MEMO_VERSION,
    type ScoreMemoHeader,
} from '../scoring/score-memo';
import { pMap } from '../scanner/worker-scheduler';

const SCOPE_FULL = 'full';
/**
 * Source reads kept in flight while scoring every file that owns a finding.
 *
 * Scoring needs the file's text, so a cold scan re-reads the whole working set here. Sixteen
 * concurrent reads keeps the storage queue busy without opening one handle per file.
 */
const SCORING_READ_CONCURRENCY = 16;
/**
 * Process-wide history miner.
 *
 * Mining shells out to `git log` and costs hundreds of milliseconds; a second scan of the same
 * repository used to pay it again for identical history. One instance lets the miner's own
 * HEAD-keyed cache answer repeat calls, and it is invalidated automatically when HEAD moves.
 */
let sharedMiner: GitHistoryMiner | null = null;
function sharedHistoryMiner(): GitHistoryMiner {
    if (sharedMiner === null) sharedMiner = new GitHistoryMiner();
    return sharedMiner;
}
const ENCODING_UTF8 = 'utf8';
const DIR_TRAJECTORY = '.refactor-trajectory';
const DIR_CACHE = '.auto-refactor-cache';
const DIR_BASELINES = 'baselines';
const DIR_COVERAGE = 'coverage';
const FILE_REVIEW_VERDICTS = 'review-verdicts.json';
const FILE_CONFIDENCE_CALIBRATION = 'confidence-calibration.json';
const FILE_GOVERNANCE_SUPERVISOR = 'governance-supervisor.json';
const FILE_ROLLING_STATE = 'rolling-sampling-state.json';
const FILE_LCOV_INFO = 'lcov.info';
const PASS_LABEL_ARBITRATION = 'arbitration';

const TIER_CRITICAL = 'critical';
const TIER_HIGH = 'high';
const TOP_HOTSPOTS_LIMIT = 10;
const TOP_BEHAVIORAL_HOTSPOTS_LIMIT = 5;
const TOP_FRAGILE_FILES_LIMIT = 15;
const TOP_TEMPORAL_COUPLINGS_LIMIT = 15;
const FRAGILITY_REPORT_THRESHOLD = 1.05;
const MIN_EVOLUTION_SCORE_DELTA = 0.05;
const MAX_LCOV_BYTES = 33554432;
const NESTING_COMPLEXITY_FACTOR = 2;
const MIN_DERIVED_COMPLEXITY = 1;
const NEUTRAL_MULTIPLIER = 1.0;
const SCORE_HUNDRED = 100.0;
const WEIGHT_BLEND_SUPERVISOR = 0.7;
const WEIGHT_BLEND_EMPIRICAL = 0.3;
const ERR_CODE_ENOENT = 'ENOENT';
/** Parameters controlling three-source calibration loading. */
export interface LoadCalibrationStatsParams {
    readonly corpusPath?: string;
    readonly rootDir?: string;
    readonly scope: string;
    readonly logger: Logger;
    readonly reportScanner?: Scanner | null;
}
/** Parameters controlling adaptive supervisor synchronization. */
export interface SupervisorSyncParams {
    readonly config: ScanConfig;
    readonly scope: string;
    readonly historicalScore?: number;
    readonly currentCompositeScore?: number | null;
}
/** Parameters controlling native eight-pillar governance synthesis. */
export interface SynthesizeGovernanceParams {
    readonly report: ScanReport;
    readonly config: ScanConfig;
    readonly scope: string;
    /**
     * Source text already held in memory, keyed by repository-relative path. On a cold scan the
     * scanner has just read every file, so supplying the map here turns a second full read of the
     * working set into a lookup; absent or missing an entry, the file is read from disk as before.
     */
    readonly contentByPath?: ReadonlyMap<string, string>;
    /** Logger used to report memo reuse rates; the pass stays silent when omitted. */
    readonly logger?: Logger;
}
/** Parameters controlling single-pass evolution and LCOV coverage enrichment. */
export interface EvolutionEnrichmentParams {
    readonly report: ScanReport;
    readonly config: ScanConfig;
    readonly scope: string;
    readonly logger: Logger;
    readonly reportScanner?: Scanner | null;
}

async function readOptionalTextAsync(filePath: string): Promise<string | undefined> {
    try {
        return await fs.promises.readFile(filePath, ENCODING_UTF8);
    } catch (readError) {
        const code = (readError as NodeJS.ErrnoException)?.code;
        if (code === ERR_CODE_ENOENT) {
            return undefined;
        }
        return undefined;
    }
}

async function directoryExistsAsync(dirPath: string): Promise<boolean> {
    try {
        const stat = await fs.promises.stat(dirPath);
        return stat.isDirectory();
    } catch {
        // Absence of optional directory is expected in fresh workspaces
        return false;
    }
}

function recordRuleFixOutcome(
    outcomes: Map<string, { fixedCount: number; regressionCount: number }>,
    ruleId: string,
    succeeded: boolean,
): void {
    let bucket = outcomes.get(ruleId);
    if (!bucket) {
        bucket = { fixedCount: 0, regressionCount: 0 };
        outcomes.set(ruleId, bucket);
    }
    if (succeeded) {
        bucket.fixedCount += 1;
    } else {
        bucket.regressionCount += 1;
    }
}

function accumulateFixResultsList(
    outcomes: Map<string, { fixedCount: number; regressionCount: number }>,
    fixResults: ReadonlyArray<{
        readonly fixedRules?: readonly string[];
        readonly success?: boolean;
    }>,
): void {
    for (const fixItem of fixResults) {
        if (!Array.isArray(fixItem.fixedRules)) continue;
        const succeeded = Boolean(fixItem.success);
        for (const ruleId of fixItem.fixedRules) {
            if (ruleId) recordRuleFixOutcome(outcomes, ruleId, succeeded);
        }
    }
}

function collectMemoryFixOutcomes(
    reportScanner?: Scanner | null,
): Record<string, RuleOutcomeCounts> {
    if (!reportScanner || typeof reportScanner.getReviewMemory !== 'function') {
        return {};
    }
    const outcomesMap = new Map<string, { fixedCount: number; regressionCount: number }>();
    const records = reportScanner.getReviewMemory().getAll();
    for (const record of records) {
        if (Array.isArray(record.fixResults)) {
            accumulateFixResultsList(outcomesMap, record.fixResults);
        }
    }
    return Object.fromEntries(outcomesMap.entries());
}

function mergeStatsPair(
    primary: readonly RuleCalibrationStats[],
    secondary: readonly RuleCalibrationStats[],
): RuleCalibrationStats[] {
    const mergedMap = new Map<string, { tp: number; fp: number }>();
    for (const item of primary) {
        mergedMap.set(item.rule, { tp: item.truePositives, fp: item.falsePositives });
    }
    for (const item of secondary) {
        const existing = mergedMap.get(item.rule);
        if (existing) {
            existing.tp += item.truePositives;
            existing.fp += item.falsePositives;
        } else {
            mergedMap.set(item.rule, { tp: item.truePositives, fp: item.falsePositives });
        }
    }
    const combined: RuleCalibrationStats[] = [];
    for (const [rule, counts] of mergedMap.entries()) {
        if (counts.tp + counts.fp > 0) {
            combined.push({
                rule,
                truePositives: counts.tp,
                falsePositives: counts.fp,
            });
        }
    }
    return combined.sort((left, right) => left.rule.localeCompare(right.rule));
}

function applySupervisorReliabilityMultipliers(
    stats: readonly RuleCalibrationStats[],
): RuleCalibrationStats[] {
    if (stats.length === 0) return [];
    const adjusted: RuleCalibrationStats[] = [];
    for (const item of stats) {
        const multiplier = defaultAdaptiveSupervisor.updateRuleConfidence(
            item.rule,
            NEUTRAL_MULTIPLIER,
        );
        if (multiplier < NEUTRAL_MULTIPLIER && item.truePositives > 0) {
            const penaltyFp = Math.max(
                item.falsePositives,
                Math.round((NEUTRAL_MULTIPLIER - multiplier) * item.truePositives),
            );
            adjusted.push({
                rule: item.rule,
                truePositives: item.truePositives,
                falsePositives: penaltyFp,
            });
        } else {
            adjusted.push(item);
        }
    }
    return adjusted;
}

async function loadVerdictLedgerStats(
    rootDir: string,
    logger: Logger,
): Promise<RuleCalibrationStats[]> {
    const ledgerPath = path.join(rootDir, DIR_TRAJECTORY, FILE_REVIEW_VERDICTS);
    const rawLedger = await readOptionalTextAsync(ledgerPath);
    if (rawLedger === undefined) return [];

    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(rawLedger);
    } catch (parseError) {
        logger.warn(
            `${PASS_LABEL_ARBITRATION}: corrupt JSON in review verdict ledger ${ledgerPath} (${String(parseError)})`,
        );
        return [];
    }

    const parsedLedger = parseReviewVerdictLedger(parsedJson);
    if (parsedLedger.rejections.length > 0) {
        logger.info(
            `${PASS_LABEL_ARBITRATION}: ${parsedLedger.rejections.length} verdict entry(ies) rejected`,
        );
    }
    return parsedLedger.records.length > 0 ? aggregateVerdicts(parsedLedger.records) : [];
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = Object.freeze({
    info: 0,
    warning: 1,
    error: 2,
});
/**
 * Applies optional per-analyzer severity ceilings (`analyzers.<name>.severity`) declared in config
 * and reconciles `report.summary.bySeverity` counters in place.
 *
 * @param report - Mutable ScanReport containing raw analyzer issues.
 * @param config - Resolved ScanConfig declaring analyzer entries.
 * @returns Number of issues downgraded by per-analyzer severity ceilings.
 */
export function applyAnalyzerSeverityCaps(report: ScanReport, config: ScanConfig): number {
    const analyzersCfg = config.analyzers;
    if (!analyzersCfg || report.issues.length === 0) return 0;

    let cappedCount = 0;
    for (const issue of report.issues) {
        const capSeverity: Severity | undefined = analyzersCfg[issue.analyzer]?.severity;
        if (!capSeverity) continue;
        if (SEVERITY_ORDER[issue.severity] > SEVERITY_ORDER[capSeverity]) {
            const oldSeverity = issue.severity;
            issue.severity = capSeverity;
            report.summary.bySeverity[oldSeverity] = Math.max(
                0,
                (report.summary.bySeverity[oldSeverity] ?? 0) - 1,
            );
            report.summary.bySeverity[capSeverity] =
                (report.summary.bySeverity[capSeverity] ?? 0) + 1;
            cappedCount += 1;
        }
    }
    return cappedCount;
}
/**
 * Loads rule calibration statistics by combining review verdicts, baseline calibration corpus,
 * online ReviewMemory fix outcomes, and FeedbackAdaptiveSupervisor reliability multipliers.
 * Concurrency: Requires external synchronization per workspace root when persisting snapshots.
 *
 * @param params - Calibration loading parameters.
 * @returns Merged and sorted rule calibration statistics.
 */
export async function loadEnrichedCalibrationStats(
    params: LoadCalibrationStatsParams,
): Promise<RuleCalibrationStats[]> {
    const { corpusPath, rootDir, scope, logger, reportScanner } = params;

    if (corpusPath) {
        const explicitCorpus = await loadCalibrationCorpus(corpusPath, readOptionalTextAsync);
        if (explicitCorpus.rejections.length > 0) {
            logger.info(
                `${PASS_LABEL_ARBITRATION}: ${explicitCorpus.rejections.length} calibration corpus entry(ies) ` +
                    `rejected (${explicitCorpus.rejections.join('; ')})`,
            );
        }
        return applySupervisorReliabilityMultipliers(explicitCorpus.stats);
    }

    if (!rootDir) return [];

    const verdictStats = await loadVerdictLedgerStats(rootDir, logger);
    const defaultCorpusPath = path.join(rootDir, DIR_BASELINES, FILE_CONFIDENCE_CALIBRATION);
    const baselineCorpus = await loadCalibrationCorpus(defaultCorpusPath, readOptionalTextAsync);
    if (baselineCorpus.rejections.length > 0) {
        logger.info(
            `${PASS_LABEL_ARBITRATION}: ${baselineCorpus.rejections.length} baseline calibration entry(ies) rejected`,
        );
    }

    let merged = mergeStatsPair(baselineCorpus.stats, verdictStats);
    if (scope === SCOPE_FULL) {
        const fixOutcomes = collectMemoryFixOutcomes(reportScanner);
        if (Object.keys(fixOutcomes).length > 0) {
            merged = harvestOnlineCalibrationCounts(fixOutcomes, [], merged);
        }
    }

    return applySupervisorReliabilityMultipliers(merged);
}

async function resolveSupervisorSnapshotPath(rootDir: string): Promise<string> {
    const trajectoryDir = path.join(rootDir, DIR_TRAJECTORY);
    if (await directoryExistsAsync(trajectoryDir)) {
        return path.join(trajectoryDir, FILE_GOVERNANCE_SUPERVISOR);
    }
    return path.join(rootDir, DIR_CACHE, FILE_GOVERNANCE_SUPERVISOR);
}

function blendWithEmpiricalBayes(
    supervisorWeights: Readonly<FusionWeights>,
    rootDir: string,
): FusionWeights {
    const stateFile = path.join(rootDir, DIR_CACHE, FILE_ROLLING_STATE);
    const governor = new RollingSamplingGovernor({ stateFilePath: stateFile });
    const rollingState = governor.evaluateState();
    if (rollingState.sampleCount === 0) {
        return { ...supervisorWeights };
    }
    const tuned = tuneParametersEmpiricalBayes(rollingState);
    const rawWs =
        WEIGHT_BLEND_SUPERVISOR * supervisorWeights.Ws +
        WEIGHT_BLEND_EMPIRICAL * tuned.staticPlaneWeight;
    const rawWd =
        WEIGHT_BLEND_SUPERVISOR * supervisorWeights.Wd +
        WEIGHT_BLEND_EMPIRICAL * tuned.dynamicPlaneWeight;
    const rawWf =
        WEIGHT_BLEND_SUPERVISOR * supervisorWeights.Wf +
        WEIGHT_BLEND_EMPIRICAL * tuned.historicalPlaneWeight;
    const total = rawWs + rawWd + rawWf;
    if (total <= 0) return { ...supervisorWeights };
    return {
        Ws: rawWs / total,
        Wd: rawWd / total,
        Wf: rawWf / total,
    };
}

function isEligibleForSupervisorEvolution(
    params: SupervisorSyncParams,
): params is SupervisorSyncParams & {
    readonly historicalScore: number;
    readonly currentCompositeScore: number;
} {
    const { scope, historicalScore, currentCompositeScore } = params;
    if (scope !== SCOPE_FULL) return false;
    if (typeof historicalScore !== 'number' || !Number.isFinite(historicalScore)) return false;
    if (typeof currentCompositeScore !== 'number' || !Number.isFinite(currentCompositeScore)) {
        return false;
    }
    return Math.abs(currentCompositeScore - historicalScore) >= MIN_EVOLUTION_SCORE_DELTA;
}

async function persistSupervisorSnapshotIfNeeded(options: {
    readonly rootDir: string;
    readonly snapshotPath: string;
    readonly hadSnapshot: boolean;
    readonly evolved: boolean;
    readonly config: ScanConfig;
}): Promise<void> {
    if (options.config.cacheEnabled === false) return;
    const trajectoryDir = path.join(options.rootDir, DIR_TRAJECTORY);
    const shouldInitSnapshot = !options.hadSnapshot && (await directoryExistsAsync(trajectoryDir));
    if (!options.evolved && !shouldInitSnapshot) return;
    try {
        await defaultAdaptiveSupervisor.saveLedgerSnapshotAsync(
            options.snapshotPath,
            options.config.archetype ?? 'standard',
        );
    } catch {
        // Best-effort snapshot persistence; in-memory supervisor state remains valid
    }
}
/**
 * Loads FeedbackAdaptiveSupervisor learned weights, blends Empirical-Bayes shrinkage priors,
 * and evolves/persists the governance supervisor snapshot during full scans.
 * Concurrency: Serializes supervisor snapshot writes per target root directory.
 *
 * @param params - Supervisor synchronization parameters.
 * @returns Effective tri-plane FusionWeights prior to unobserved-plane renormalization.
 */
export async function syncAdaptiveSupervisorState(
    params: SupervisorSyncParams,
): Promise<FusionWeights> {
    const { config, scope } = params;
    const rootDir = config.root || process.cwd();
    const snapshotPath = await resolveSupervisorSnapshotPath(rootDir);
    const hadSnapshot = await defaultAdaptiveSupervisor.loadLedgerSnapshotAsync(snapshotPath);

    let evolved = false;
    if (isEligibleForSupervisorEvolution(params)) {
        defaultAdaptiveSupervisor.runOutcomeEvolution({
            predictedScore: params.historicalScore,
            actualOutcomeScore: params.currentCompositeScore,
        });
        evolved = true;
    }

    if (scope === SCOPE_FULL) {
        await persistSupervisorSnapshotIfNeeded({
            rootDir,
            snapshotPath,
            hadSnapshot,
            evolved,
            config,
        });
    }

    return blendWithEmpiricalBayes(defaultAdaptiveSupervisor.getWeights(), rootDir);
}
/**
 * Lazily retrieves or initializes an issue array bucket for a given file path.
 *
 * @param map - Mutable file-path to issue-array index.
 * @param filePath - Normalized file path key.
 * @returns Mutable issue bucket array.
 */
function getOrCreateIssueBucket(map: Map<string, Issue[]>, filePath: string): Issue[] {
    let bucket = map.get(filePath);
    if (!bucket) {
        bucket = [];
        map.set(filePath, bucket);
    }
    return bucket;
}
/**
 * Indexes all unclustered issues by file path while ensuring every scored FileMetric
 * entry has at least an empty bucket for accurate per-file quality synthesis.
 *
 * @param issues - Post-enrichment diagnostic list.
 * @param fileMetrics - Per-file AST and structural metrics.
 * @returns Map from file path to active issues.
 */
function buildActiveFileIssuesMap(
    issues: readonly Issue[],
    fileMetrics: readonly FileMetric[],
): Map<string, Issue[]> {
    const fileIssuesMap = new Map<string, Issue[]>();
    for (const issue of issues) {
        if (issue.clusteredInto) continue;
        const filePath = issue.location?.file;
        if (filePath) {
            getOrCreateIssueBucket(fileIssuesMap, filePath).push(issue);
        }
    }
    for (const metric of fileMetrics) {
        if (metric.file) {
            getOrCreateIssueBucket(fileIssuesMap, metric.file);
        }
    }
    return fileIssuesMap;
}
/**
 * Ranks per-file quality scores by active issue count and projects the top hotspots
 * with elastic debt tier tallies (`criticalCount`, `highCount`) for AAS reporting.
 *
 * @param fileScores - Per-file eight-pillar quality scores.
 * @returns Ranked hotspot entries capped at TOP_HOTSPOTS_LIMIT.
 */
function computeHierarchicalHotspots(
    fileScores: readonly FileQualityScore[],
): HierarchicalHotspotEntry[] {
    return [...fileScores]
        .sort((left, right) => right.issues.length - left.issues.length)
        .slice(0, TOP_HOTSPOTS_LIMIT)
        .map((scoredFile) => {
            let criticalCount = 0;
            let highCount = 0;
            for (const issue of scoredFile.issues) {
                const tier = classifyElasticDebtTier(issue);
                if (tier === TIER_CRITICAL) criticalCount += 1;
                else if (tier === TIER_HIGH) highCount += 1;
            }
            return {
                filePath: scoredFile.filePath,
                domain: scoredFile.domainName,
                totalIssues: scoredFile.issues.length,
                criticalCount,
                highCount,
                compositeScore: scoredFile.compositeScore,
                effectiveDensity: scoredFile.effectiveDensity,
            };
        });
}
/**
 * Projects a lightweight O(1) eight-pillar governance summary from top-level
 * QualityScorer indices during incremental or fast-mode scans without extra disk I/O.
 *
 * @param report - Active ScanReport with populated qualityScore.
 * @returns Lightweight HierarchicalGovernanceSummary or undefined when unscored.
 */
function buildLightweightGovernance(report: ScanReport): HierarchicalGovernanceSummary | undefined {
    const qualityScore = report.qualityScore;
    if (!qualityScore?.indices) return undefined;
    const eightPillars = synthesizeEightPillars(qualityScore.indices);
    const compositeScore = qualityScore.compositeScore ?? eightPillars.compositeScore;
    return {
        hierarchicalCompositeScore: compositeScore,
        grade: qualityScore.grade ?? resolveQualityGrade(compositeScore),
        eightPillars,
        tenDimensions: { ...qualityScore.indices },
        effectiveCodeDensity: qualityScore.effectiveCodeDensity ?? 0,
        ...(qualityScore.densityTensorSummary
            ? { densityTensorSummary: qualityScore.densityTensorSummary }
            : {}),
        domains: [],
        topHotspots: [],
    };
}
/** Resolves a repository-relative path to an absolute one for an optional disk read. */
function resolveReadPath(rootDir: string, filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
}
/**
 * Builds the configuration fingerprint a memoized score depends on: `scoreFileQuality` folds the
 * resolved scoring weights into its result, so a payload produced under different weights must not
 * be served. Only the fields that reach the scorer participate.
 */
function deriveScoreMemoConfigKey(config: ScanConfig): string {
    return JSON.stringify({
        weights: config.scoringWeights ?? null,
        archetype: config.archetype ?? null,
        reviewProfile: config.reviewProfile ?? null,
        scoring: config.scoring ?? null,
    });
}
/**
 * Synthesizes native eight-pillar and hierarchical domain governance directly onto ScanReport.
 *
 * Full scans evaluate per-file eight-pillar scores asynchronously; incremental/slice scans project
 * lightweight eight-pillar indices from QualityScorer in O(1) without extra disk reads.
 *
 * @param params - Governance synthesis parameters.
 * @returns Populated HierarchicalGovernanceSummary or undefined when no files were scored.
 */
export async function synthesizeNativeGovernance(
    params: SynthesizeGovernanceParams,
): Promise<HierarchicalGovernanceSummary | undefined> {
    const { report, config, scope, contentByPath } = params;
    const fileMetrics = report.fileMetrics ?? [];
    if (scope !== SCOPE_FULL || fileMetrics.length === 0) {
        return buildLightweightGovernance(report);
    }

    const rootDir = report.root || config.root || process.cwd();
    const fileIssuesMap = buildActiveFileIssuesMap(report.issues, fileMetrics);
    const entries = Array.from(fileIssuesMap.entries());
    // Per-file scoring is the single most expensive stage of the post-scan pass: measured at
    // 549 ms of CPU across 405 files, against 51 ms to read the same text. It is a pure function of
    // (content, findings, domain, module), so a repeat scan of an unchanged tree can reuse the
    // answer instead of recomputing it. The memo is additive and fail-soft — any miss simply falls
    // through to scoring, so a disabled cache or a stale payload costs nothing but the old work.
    const memoHeader: ScoreMemoHeader = {
        version: SCORE_MEMO_VERSION,
        configKey: deriveScoreMemoConfigKey(config),
    };
    const memoEnabled = config.cacheEnabled !== false;
    const memo = memoEnabled
        ? loadScoreMemo(rootDir, memoHeader)
        : new Map<string, FileQualityScore>();
    let memoReused = 0;
    const memoWrites = new Map<string, FileQualityScore>();
    // Scoring needs every file that owns a finding. On a cold scan the scanner has already read
    // all of them, so `contentByPath` is consulted first and the disk read is only a fallback.
    // Reads run with bounded fan-out: a bare `Promise.all` opened one handle per file and spent
    // most of its wall time contending on the descriptor table.
    const fileScores = await pMap(
        entries,
        SCORING_READ_CONCURRENCY,
        async ([filePath, fileIssues]) => {
            const cached = contentByPath?.get(filePath);
            const content =
                cached ?? (await readOptionalTextAsync(resolveReadPath(rootDir, filePath))) ?? '';
            const domainName = extractDomainName(filePath);
            const moduleName = path.basename(path.dirname(filePath));
            const memoKey = deriveScoreMemoKey(content, fileIssues, { domainName, moduleName });
            const remembered = memo.get(memoKey);
            if (remembered) {
                memoReused += 1;
                return remembered;
            }
            const scored = scoreFileQuality({
                filePath,
                content,
                issues: fileIssues,
                domainName,
                moduleName,
            });
            memoWrites.set(memoKey, scored);
            return scored;
        },
    );

    if (memoEnabled) {
        // Merging instead of replacing keeps scores for files this scan did not score — a slice
        // scan would otherwise evict the whole project's memo with its own handful of entries.
        for (const [key, value] of memoWrites) memo.set(key, value);
        if (memoWrites.size > 0) saveScoreMemo(rootDir, memoHeader, memo);
    }
    if (memoReused > 0) {
        params.logger?.info?.(
            `governance scoring: reused ${memoReused}/${entries.length} memoized file scores`,
        );
    }

    if (fileScores.length === 0) {
        return buildLightweightGovernance(report);
    }

    const projectScore = aggregateProjectScore(fileScores);
    const domains: HierarchicalDomainSummary[] = projectScore.domains.map((domainItem) => ({
        domainName: domainItem.domainName,
        compositeScore: domainItem.compositeScore,
        pillars: domainItem.pillars,
        moduleCount: domainItem.modules.length,
    }));

    return {
        hierarchicalCompositeScore: projectScore.compositeScore,
        grade: projectScore.grade,
        eightPillars: projectScore.eightPillars,
        tenDimensions: projectScore.tenDimensions,
        effectiveCodeDensity: projectScore.effectiveCodeDensity,
        ...(projectScore.densityTensorSummary
            ? { densityTensorSummary: projectScore.densityTensorSummary }
            : {}),
        domains,
        topHotspots: computeHierarchicalHotspots(fileScores),
    };
}

function deriveFileHotspotComplexity(
    metric: FileMetric,
    fileIssues: readonly Issue[] | undefined,
): number {
    let observedMax = 0;
    const list = fileIssues ?? [];
    for (const issue of list) {
        const complexityVal = Number(issue.detail?.complexity);
        if (complexityVal > observedMax) observedMax = complexityVal;
    }
    return Math.max(
        MIN_DERIVED_COMPLEXITY,
        observedMax,
        metric.maxNestingDepth * NESTING_COMPLEXITY_FACTOR,
    );
}

function countUnsuppressedFileIssues(fileIssues: readonly Issue[] | undefined): number {
    if (!fileIssues) return 0;
    let activeCount = 0;
    for (const issue of fileIssues) {
        if (!issue.suppression && !issue.clusteredInto) {
            activeCount += 1;
        }
    }
    return activeCount;
}

function buildHotspotInputFromProfile(
    metric: FileMetric,
    fileIssues: readonly Issue[] | undefined,
    entry: {
        readonly profile?: GitFileHistoryProfile;
        readonly evaluator: BehavioralHotspotEvaluator;
    },
): FileHotspotInput {
    const { profile, evaluator } = entry;
    const commits30Days = profile ? evaluator.extract30DayCommitsFromProfile(profile) : 0;
    const commits7Days = profile ? evaluator.extract7DayCommitsFromProfile(profile) : undefined;
    const activeAuthorsCount = profile
        ? evaluator.extractActiveAuthorsFromProfile(profile)
        : undefined;

    return {
        filePath: metric.file,
        commits30Days,
        commits7Days,
        eloc: metric.lines,
        cyclomaticComplexity: deriveFileHotspotComplexity(metric, fileIssues),
        defectCount: countUnsuppressedFileIssues(fileIssues),
        totalCommits: profile?.totalCommits,
        activeAuthorsCount,
        lastModifiedTimestamp: profile?.lastModifiedTimestamp ?? undefined,
    };
}

interface CommitAccumulatorBucket {
    readonly files: Set<string>;
    readonly timestamp: number;
    readonly author: string;
    readonly message: string;
}

function getOrCreateCommitBucket(
    commitsMap: Map<string, CommitAccumulatorBucket>,
    commit: GitFileHistoryProfile['recentCommits'][number],
): CommitAccumulatorBucket {
    let bucket = commitsMap.get(commit.hash);
    if (!bucket) {
        bucket = {
            files: new Set<string>(),
            timestamp: commit.timestamp,
            author: commit.author,
            message: commit.subject,
        };
        commitsMap.set(commit.hash, bucket);
    }
    return bucket;
}

function recordProfileCommitsForFile(
    commitsMap: Map<string, CommitAccumulatorBucket>,
    filePath: string,
    recentCommits: GitFileHistoryProfile['recentCommits'],
): void {
    for (const commit of recentCommits) {
        if (!commit.hash) continue;
        getOrCreateCommitBucket(commitsMap, commit).files.add(filePath);
    }
}

function buildChangeSetsFromProfiles(
    fileMetrics: readonly FileMetric[],
    gitProfiles: Map<string, GitFileHistoryProfile>,
    rootDir: string,
): CommitChangeSet[] {
    const commitsMap = new Map<string, CommitAccumulatorBucket>();
    for (const metric of fileMetrics) {
        const profile =
            gitProfiles.get(metric.file) ?? gitProfiles.get(path.resolve(rootDir, metric.file));
        if (profile && Array.isArray(profile.recentCommits)) {
            recordProfileCommitsForFile(commitsMap, metric.file, profile.recentCommits);
        }
    }
    return Array.from(commitsMap.entries()).map(([commitHash, data]) => ({
        commitHash,
        changedFiles: Array.from(data.files),
        timestamp: data.timestamp,
        author: data.author,
        message: data.message,
    }));
}

async function loadLcovProfilesAsync(
    rootDir: string,
): Promise<{ ingester: LcovIngester; profiles: Map<string, FileCoverageProfile> } | undefined> {
    const lcovPath = path.join(rootDir, DIR_COVERAGE, FILE_LCOV_INFO);
    try {
        const stat = await fs.promises.stat(lcovPath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LCOV_BYTES) {
            return undefined;
        }
        const lcovText = await fs.promises.readFile(lcovPath, ENCODING_UTF8);
        const ingester = new LcovIngester();
        const profiles = ingester.parse(lcovText);
        return profiles.size > 0 ? { ingester, profiles } : undefined;
    } catch {
        // Absence of coverage/lcov.info is expected when tests ran without coverage flags
        return undefined;
    }
}

function evaluateCoverageAndCascadedRisk(
    issuesByFile: Map<string, Issue[]>,
    coverageState:
        { ingester: LcovIngester; profiles: Map<string, FileCoverageProfile> } | undefined,
): number {
    if (!coverageState) return 0;
    const { ingester, profiles } = coverageState;
    let appliedCount = 0;

    for (const [filePath, fileIssues] of issuesByFile.entries()) {
        const profile = ingester.findProfile(filePath, profiles);
        if (!profile) continue;
        appliedCount += 1;

        for (const issue of fileIssues) {
            if (issue.clusteredInto || issue.suppression) continue;
            const line = issue.location?.start?.line ?? 1;
            const damping = ingester.evaluateCoverageDamping(profile, line);
            if (damping.dampingMultiplier !== NEUTRAL_MULTIPLIER) {
                const dynamicRisk = ingester.asDynamicEvidence(profile, line, issue.rule);
                const staticRisk = computeStaticIssueRisk(issue);
                const fused = fuseCascadedRisks(staticRisk, dynamicRisk);
                if (issue.detail && typeof issue.detail === 'object') {
                    (issue.detail as Record<string, unknown>).coverageDamping =
                        damping.dampingMultiplier;
                    (issue.detail as Record<string, unknown>).fusedRiskScore = fused.fusedScore;
                }
            }
        }
    }
    return appliedCount;
}

function groupReportIssuesByFile(issues: readonly Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();
    for (const issue of issues) {
        const file = issue.location?.file;
        if (file) {
            getOrCreateIssueBucket(grouped, file).push(issue);
        }
    }
    return grouped;
}

function collectFragileFilesAndHotspots(
    fileMetrics: readonly FileMetric[],
    issuesByFile: Map<string, Issue[]>,
    miningContext: {
        readonly rootDir: string;
        readonly gitProfiles: Map<string, GitFileHistoryProfile>;
        readonly evaluator: BehavioralHotspotEvaluator;
        readonly evolutionAnalyzer: CodeEvolutionAnalyzer;
    },
): {
    readonly hotspotInputs: FileHotspotInput[];
    readonly fragileFiles: EvolutionFragileFileEntry[];
} {
    const { rootDir, gitProfiles, evaluator, evolutionAnalyzer } = miningContext;
    const hotspotInputs: FileHotspotInput[] = [];
    const fragileCandidates: EvolutionFragileFileEntry[] = [];

    for (const metric of fileMetrics) {
        const fileIssues = issuesByFile.get(metric.file);
        const profile =
            gitProfiles.get(metric.file) ?? gitProfiles.get(path.resolve(rootDir, metric.file));
        hotspotInputs.push(
            buildHotspotInputFromProfile(metric, fileIssues, { profile, evaluator }),
        );

        if (profile && profile.isGitAvailable && profile.totalCommits > 0) {
            const evoMetrics = evolutionAnalyzer.evaluateProfile(profile);
            if (evoMetrics.vulnerabilityMultiplier >= FRAGILITY_REPORT_THRESHOLD) {
                fragileCandidates.push({
                    file: metric.file,
                    fragilityScore: evoMetrics.vulnerabilityMultiplier,
                    churnCount: profile.totalCommits,
                    authorEntropy: evoMetrics.authorEntropyScore,
                });
            }
        }
    }

    fragileCandidates.sort((left, right) => right.fragilityScore - left.fragilityScore);
    return {
        hotspotInputs,
        fragileFiles: fragileCandidates.slice(0, TOP_FRAGILE_FILES_LIMIT),
    };
}
/**
 * Executes single-pass Git history mining for behavioral hotspots, code evolution fragility,
 * and temporal coupling detection, alongside LCOV line-level coverage damping.
 * Concurrency: Reentrant per ScanReport instance; reads git history and coverage read-only.
 *
 * @param params - Evolution and coverage enrichment parameters.
 */
export async function enrichEvolutionAndCoverage(params: EvolutionEnrichmentParams): Promise<void> {
    const { report, config, scope, logger } = params;
    const fileMetrics = report.fileMetrics;
    if (scope !== SCOPE_FULL || !fileMetrics || fileMetrics.length === 0) {
        return;
    }

    try {
        const rootDir = report.root || config.root || process.cwd();
        const miner = sharedHistoryMiner();
        // `--no-cache` must govern the history cache too, not just L1/L2: the disk layer is the
        // whole reason a repeat scan can skip `git log`, and honouring the flag here keeps "no
        // cache" meaning no reuse anywhere.
        miner.setDiskCacheEnabled(config.cacheEnabled !== false);
        const evaluator = new BehavioralHotspotEvaluator();
        const evolutionAnalyzer = new CodeEvolutionAnalyzer(miner);
        const couplingDetector = new TemporalCouplingDetector({ targetDir: rootDir });

        const gitProfiles = miner.mineRepositoryHistoryBatch(rootDir);
        const issuesByFile = groupReportIssuesByFile(report.issues);

        const { hotspotInputs, fragileFiles } = collectFragileFilesAndHotspots(
            fileMetrics,
            issuesByFile,
            { rootDir, gitProfiles, evaluator, evolutionAnalyzer },
        );

        const hotspotResults = evaluator.evaluateBatch(hotspotInputs);
        if (report.triPlaneQuality) {
            const triPlane = report.triPlaneQuality as unknown as Record<string, unknown>;
            triPlane.hotspots = hotspotResults.slice(0, TOP_BEHAVIORAL_HOTSPOTS_LIMIT);
            const noisyRules = report.summary.arbitration?.noisyRules;
            if (noisyRules && noisyRules.length > 0) {
                triPlane.noisyRules = noisyRules;
            }
        }

        const changeSets = buildChangeSetsFromProfiles(fileMetrics, gitProfiles, rootDir);
        const couplingReport = couplingDetector.detectFromChangeSets(changeSets);
        const temporalCouplings: EvolutionTemporalCouplingEntry[] = couplingReport.pairs
            .slice(0, TOP_TEMPORAL_COUPLINGS_LIMIT)
            .map((pair) => ({
                fileA: pair.fileA,
                fileB: pair.fileB,
                supportCommits: pair.sharedCommits,
                couplingConfidence:
                    Math.round((pair.couplingPercentage / SCORE_HUNDRED) * SCORE_HUNDRED) /
                    SCORE_HUNDRED,
                isCrossModule: pair.isCrossModule,
            }));

        const coverageState = await loadLcovProfilesAsync(rootDir);
        const coverageDampingAppliedCount = evaluateCoverageAndCascadedRisk(
            issuesByFile,
            coverageState,
        );

        const evolutionSummary: EvolutionSummary = {
            fragileFiles,
            temporalCouplings,
            coverageDampingAppliedCount,
        };
        report.evolution = evolutionSummary;
    } catch (evolutionError) {
        logger.info(`Post-scan evolution and coverage pass degraded: ${String(evolutionError)}`);
    }
}
