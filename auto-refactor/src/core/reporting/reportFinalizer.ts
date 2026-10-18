/**
 * Module: Core Engine — Scan Report Finalization Pipeline
 * File Path: src/core/reporting/reportFinalizer.ts
 * Architecture Role: Post-scan enrichment and validation pipeline for raw ScanReport outputs;
 *   applies reasoned suppressions, global passes, and ratchet comparison.
 * Dependencies & Triggers: fs, ../types, ../config, ../logger, ../fileDiscovery,
 *   ../dependencyGraph, and ../analyzer; called by api.scan, scanWarm, scanDiff, and scanAndRender.
 * Responsibilities: Run global cross-file passes (import cycles, literal clusters, error flow),
 *   index and match suppressions, recalculate summary counters, and apply baseline ratchets.
 * Exit Semantics & Design Rationale: Finalization is idempotent via a non-enumerable symbol flag;
 *   mutates report in-place for performance and recomputes summary metrics consistently.
 */

import * as fs from 'fs';
import type { ScanConfig, ScanReport, Issue, SuppressionRule } from '../types';
import type { Scanner } from '../analyzer';
import { summarizeUncertainty } from './uncertaintySummary';
import type { Logger } from '../logger';
import { globToRegExp } from '../file-discovery';
import { runCyclePass } from '../dependency-graph';
import type { ObservedConstantDeclaration } from '../architecture/constant-library-auditor';
import { inspectConstantLibraryTopology } from '../architecture/constant-library-auditor';
import {
    BASELINE_GRANULARITY_GROUPED,
    groupCounts,
    handleBaselineUpdate,
    handleBaselineRatchet,
} from './baselineManager';
import { areAliasForms } from '../rules/aliases';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import { QualityScorer } from '../scoring/qualityScorer';
import { synthesizeStaticQualityVector } from '../scoring/static-quality-model';
import { computeDynamicQualityVector } from '../dynamic/dynamic-quality-scorer';
import { computeUnifiedQualityScore } from '../scoring/fusion-scorer';
import type { GovernanceProjectProfile } from '../scoring/fusion-scorer';
import { evaluateProjectAutonomy } from '../scoring/autonomy-scorer';
import { FindingConfidenceArbiter } from '../scoring/finding-confidence-arbiter';
import { BehavioralHotspotEvaluator, type FileHotspotInput } from '../evolution';

export { BASELINE_GRANULARITY_GROUPED, groupCounts };

/** Post-scan scope that sees the complete module set, so cross-file passes are allowed. */
export const POST_SCAN_SCOPE_FULL = 'full';

/** Post-scan scope limited to a changed-file subset, so cross-file passes are skipped. */
export const POST_SCAN_SCOPE_INCREMENTAL = 'incremental';

/** Post-scan scope: a full scan may use cross-file facts; an incremental one may not. */
export type PostScanScope = typeof POST_SCAN_SCOPE_FULL | typeof POST_SCAN_SCOPE_INCREMENTAL;

/** Named identifiers for post-scan analysis passes. */
const PASS_DEPENDENCY_GRAPH = 'dependency-graph';
const PASS_LITERAL_CLUSTERS = 'literal-clusters';
const PASS_CONSTANT_LIBRARY_TOPOLOGY = 'constant-library-topology';
const PASS_ERROR_FLOW = 'error-flow';
const PASS_SEMANTIC_COMPLEXITY = 'semantic-complexity';
const PASS_SUPPRESSIONS = 'suppressions';
const PASS_BASELINE = 'baseline';

/** Analyzer keys declared in scan configuration. */
const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';
const ANALYZER_CONSTANTS = 'constants';
const ANALYZER_HYGIENE = 'hygiene';
const ANALYZER_COMPLEXITY = 'complexity';

/** Option keys within analyzer configurations. */
const OPT_CROSS_FILE_LITERAL_CLUSTERS = 'crossFileLiteralClusters';
const OPT_CHECK_CONSTANT_TOPOLOGY = 'checkConstantTopology';
const OPT_ERROR_PROPAGATION = 'errorPropagation';
const OPT_CROSS_FN_COMPLEXITY = 'checkCrossFunctionComplexity';

/** Default baseline comparison granularity. */
const DEFAULT_BASELINE_GRANULARITY = 'id';

/** Delimiter separating symbol hierarchies. */
const SYMBOL_DOT_PREFIX = '.';

/** Baseline maximum score scalar for unified quality calculation. */
const SCORE_MAX_BASELINE = 100.0;

/** Governance maturity tier classifications. */
const TIER_INDUSTRIAL = 'industrial';
const TIER_DEMO = 'demo';
const TIER_PROTOTYPE = 'prototype';

/** Governance maturity stage representations. */
const STAGE_INDUSTRIAL_INFRASTRUCTURE = 'industrial_infrastructure';
const STAGE_PROTOTYPE = 'prototype';
const STAGE_PRODUCTION = 'production';

/** Governance scale grade classifications. */
const GRADE_ENTERPRISE = 'enterprise';
const GRADE_LARGE = 'large';
const GRADE_MEDIUM = 'medium';

/** Governance scale descriptors. */
const SCALE_MASSIVE = 'massive';
const SCALE_LARGE = 'large';
const SCALE_MEDIUM = 'medium';
const SCALE_SMALL = 'small';

/** Governance project archetype classifications. */
const ARCHETYPE_LIBRARY = 'library';
const ARCHETYPE_GAME = 'game';
const ARCHETYPE_WEB = 'web';

/** Governance architecture domain classifications. */
const DOMAIN_CORE_FRAMEWORK = 'core_framework';
const DOMAIN_ALGORITHM_LIB = 'algorithm_lib';
const DOMAIN_BUSINESS_APP = 'business_app';

/** User-facing diagnostic and warning notifications. */
const WARN_EMPTY_INCLUDE_GLOBS =
    'include globs matched 0 files — declared analyzers cannot fire; check include/exclude and the scanned root';
const WARN_INCREMENTAL_SCOPE_SKIPPED =
    'incremental scope: cross-file passes (import cycles / unused exports) are skipped — run a full scan for those signals';
const WARN_DEP_GRAPH_INCOMPLETE =
    'dependency-graph: dependency graph coverage incomplete (cache-hit paths); falling back to re-reading graph';
const WARN_LITERAL_CLUSTERS_CACHED =
    'literal-clusters: cached paths lack shared literal index, skipping (run full cold scan)';
const WARN_ERROR_FLOW_CACHED =
    'error-flow: cached paths lack shared call-graph index, skipping (run full cold scan)';
const WARN_SEMANTIC_COMPLEXITY_CACHED =
    'semantic-complexity: cached paths lack shared call-graph index, skipping (run full cold scan)';

/** Log messages for pass completion telemetry. */
const MSG_IMPORT_CYCLE_ISSUES = 'import-cycle issue(s)';
const MSG_LITERAL_CLUSTER_ISSUES = 'cross-file literal cluster issue(s)';
const MSG_CONST_TOPOLOGY_RECS = 'constant library recommendation(s)';
const MSG_ERROR_FLOW_ISSUES = 'error propagation chain issue(s)';
const MSG_SEMANTIC_COMPLEXITY_ISSUES = 'cross-function complexity issue(s)';

/** Empty string constant for fallback representation. */
const EMPTY_STRING = '';

/** Immutable empty array singletons for zero-allocation fallbacks in hot loops. */
const EMPTY_ISSUES: readonly Issue[] = Object.freeze([]);
const EMPTY_SUPPRESSIONS: readonly SuppressionRule[] = Object.freeze([]);

const FINALIZED = Symbol('auto-refactor:finalized');
const KEY_REPORT = 'report';
const KEY_CONFIG = 'config';

/** Options controlling baseline ratchet and update behavior. */
export interface FinalizeBaselineOptions {
    baseline?: string;
    updateBaseline?: string;
    baselineGranularity?: string;
    baselineRatchetDown?: boolean;
    forceBaselineExpand?: boolean;
}

/** Unified context structure aggregating parameters across report finalization passes. */
export interface FinalizeReportContext {
    report: ScanReport;
    config: ScanConfig;
    options: FinalizeBaselineOptions;
    logger: Logger;
    reportScanner?: Scanner | null;
    scope?: PostScanScope;
}

/** Execution context passed across individual post-scan analysis passes. */
interface PostScanPassContext {
    report: ScanReport;
    config: ScanConfig;
    logger: Logger;
    reportScanner: Scanner | null;
    scope: PostScanScope;
    warnings: string[];
    postScanPasses: string[];
}

/** Specification driving generic scanner-based post-scan passes without duplicated code. */
interface ScannerPassSpec {
    readonly passName: string;
    readonly missingScannerWarning: string;
    readonly logDescriptor: string;
    readonly collectIssues: (scanner: Scanner) => Issue[];
}

/**
 * Compute aggregate severity counts, totals, and uncertainty for a modified report.
 *
 * @param report - Report whose summary aggregates should be refreshed.
 */
export function computeSummary(report: ScanReport): void {
    const severityCounts: Record<Issue['severity'], number> = {
        info: 0,
        warning: 0,
        error: 0,
    };
    const issuesByAnalyzer: Record<string, number> = {};
    for (const issue of report.issues) {
        severityCounts[issue.severity]++;
        issuesByAnalyzer[issue.analyzer] = (issuesByAnalyzer[issue.analyzer] || 0) + 1;
    }
    report.summary.bySeverity = severityCounts;
    report.summary.byAnalyzer = issuesByAnalyzer;
    report.summary.issuesTotal = report.issues.length;
    report.summary.uncertainty = summarizeUncertainty(report.issues);
}

/** Exported alias maintaining 100% backward compatibility for callers. */
export const recomputeSummary = computeSummary;

/**
 * Validates that discovered include globs matched at least one scanned file.
 *
 * @param report - Current scan report to inspect.
 * @param warnings - Accumulator list of diagnostic warnings.
 */
function checkEmptyIncludeGlobs(report: ScanReport, warnings: string[]): void {
    if (report.summary.filesScanned === 0) {
        warnings.push(WARN_EMPTY_INCLUDE_GLOBS);
    }
}

/**
 * Executes a scanner-delegated pass, collecting issues and logging results.
 *
 * @param context - Execution context of the current post-scan cycle.
 * @param spec - Pass configuration specifying extraction and messaging.
 */
function executeScannerPass(context: PostScanPassContext, spec: ScannerPassSpec): void {
    context.postScanPasses.push(spec.passName);
    if (context.reportScanner === null) {
        context.warnings.push(spec.missingScannerWarning);
        return;
    }
    const detectedIssues = spec.collectIssues(context.reportScanner);
    if (detectedIssues.length === 0) {
        return;
    }
    context.report.issues.push(...detectedIssues);
    computeSummary(context.report);
    context.logger.info(`${spec.passName}: ${detectedIssues.length} ${spec.logDescriptor}`);
}

/**
 * Executes dependency graph analysis and circular dependency discovery.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
async function applyDependencyGraphPass(context: PostScanPassContext): Promise<void> {
    const { report, config, logger, reportScanner, scope, warnings, postScanPasses } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_DEPENDENCY_GRAPH] : undefined;
    if (scope !== POST_SCAN_SCOPE_FULL) {
        warnings.push(WARN_INCREMENTAL_SCOPE_SKIPPED);
    }
    if (!targetConfig?.enabled) return;

    postScanPasses.push(PASS_DEPENDENCY_GRAPH);
    const prebuilt = reportScanner ? reportScanner.getDependencyGraph() : null;
    const covered = prebuilt !== null && prebuilt.getModules().length >= report.fileMetrics.length;
    const cycle = await runCyclePass(report, config, logger, covered ? prebuilt : null);

    if (!covered && prebuilt !== null) {
        warnings.push(WARN_DEP_GRAPH_INCOMPLETE);
    }
    report.issues.push(...cycle.issues);
    warnings.push(...cycle.warnings);
    computeSummary(report);
    if (cycle.issues.length > 0) {
        logger.info(`${PASS_DEPENDENCY_GRAPH}: ${cycle.issues.length} ${MSG_IMPORT_CYCLE_ISSUES}`);
    }
}

/**
 * Executes cross-file literal cluster analysis if configured.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
function applyLiteralClustersPass(context: PostScanPassContext): void {
    const { config, scope } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_CONSTANTS] : undefined;
    const targetOptions = targetConfig?.options as Record<string, unknown> | undefined;
    if (!targetConfig?.enabled || targetOptions?.[OPT_CROSS_FILE_LITERAL_CLUSTERS] !== true) {
        return;
    }

    executeScannerPass(context, {
        passName: PASS_LITERAL_CLUSTERS,
        missingScannerWarning: WARN_LITERAL_CLUSTERS_CACHED,
        logDescriptor: MSG_LITERAL_CLUSTER_ISSUES,
        collectIssues: (scanner) => scanner.getLiteralClusterIssues(),
    });
}

/**
 * Inspects constant declarations for shared constant library opportunities.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
function applyConstTopologyPass(context: PostScanPassContext): void {
    const { report, config, logger, scope, postScanPasses } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_CONSTANTS] : undefined;
    const targetOptions = targetConfig?.options as Record<string, unknown> | undefined;
    if (!targetConfig?.enabled || targetOptions?.[OPT_CHECK_CONSTANT_TOPOLOGY] !== true) {
        return;
    }

    postScanPasses.push(PASS_CONSTANT_LIBRARY_TOPOLOGY);
    const declarations: ObservedConstantDeclaration[] = [];
    for (const issue of report.issues) {
        if (issue.analyzer === ANALYZER_CONSTANTS && issue.actionable?.targetSymbol) {
            declarations.push({
                name: issue.actionable.targetSymbol,
                normalizedValue: String(issue.detail?.value ?? EMPTY_STRING),
                filePath: issue.location.file,
                line: issue.location.start.line,
                isExported: true,
            });
        }
    }
    const topologyIssues = inspectConstantLibraryTopology(declarations);
    if (topologyIssues.length > 0) {
        report.issues.push(...topologyIssues);
        computeSummary(report);
        logger.info(
            `${PASS_CONSTANT_LIBRARY_TOPOLOGY}: emitted ${topologyIssues.length} ${MSG_CONST_TOPOLOGY_RECS}`,
        );
    }
}

/**
 * Executes cross-file error propagation flow analysis.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
function applyErrorFlowPass(context: PostScanPassContext): void {
    const { config, scope } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_HYGIENE] : undefined;
    const targetOptions = targetConfig?.options as Record<string, unknown> | undefined;
    if (!targetConfig?.enabled || targetOptions?.[OPT_ERROR_PROPAGATION] !== true) {
        return;
    }

    executeScannerPass(context, {
        passName: PASS_ERROR_FLOW,
        missingScannerWarning: WARN_ERROR_FLOW_CACHED,
        logDescriptor: MSG_ERROR_FLOW_ISSUES,
        collectIssues: (scanner) => scanner.getErrorFlowIssues(targetOptions),
    });
}

/**
 * Executes cross-function complexity and deep call-graph inspection.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
function applySemanticComplexityPass(context: PostScanPassContext): void {
    const { config, scope } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_COMPLEXITY] : undefined;
    const targetOptions = targetConfig?.options as Record<string, unknown> | undefined;
    if (!targetConfig?.enabled || targetOptions?.[OPT_CROSS_FN_COMPLEXITY] !== true) {
        return;
    }

    executeScannerPass(context, {
        passName: PASS_SEMANTIC_COMPLEXITY,
        missingScannerWarning: WARN_SEMANTIC_COMPLEXITY_CACHED,
        logDescriptor: MSG_SEMANTIC_COMPLEXITY_ISSUES,
        collectIssues: (scanner) => scanner.getSemanticComplexityIssues(targetOptions),
    });
}

/** Pre-indexed fast lookup structure for suppression rules. */
interface SuppressionIndex {
    readonly candidateRulesByAnalyzer: Map<string, SuppressionRule[]>;
    readonly generalRules: SuppressionRule[];
    readonly fileMatcherByRule: Map<SuppressionRule, RegExp>;
}

/**
 * Builds an indexed suppression lookup structure for O(1) analyzer bucketing.
 *
 * @param suppressions - Declared list of suppression rules.
 * @returns Pre-indexed suppression maps.
 */
function buildSuppressionIndex(suppressions: readonly SuppressionRule[]): SuppressionIndex {
    const rulesByAnalyzer = new Map<string, SuppressionRule[]>();
    const generalRules: SuppressionRule[] = [];
    const orderIndexByRule = new Map<SuppressionRule, number>();
    const fileMatcherByRule = new Map<SuppressionRule, RegExp>();

    suppressions.forEach((rule, index) => {
        orderIndexByRule.set(rule, index);
        if (rule.matchFile) {
            fileMatcherByRule.set(rule, globToRegExp(rule.matchFile.replace(/\\/g, '/')));
        }
        if (rule.matchAnalyzer) {
            const bucket = rulesByAnalyzer.get(rule.matchAnalyzer) ?? [];
            bucket.push(rule);
            rulesByAnalyzer.set(rule.matchAnalyzer, bucket);
        } else {
            generalRules.push(rule);
        }
    });

    const candidateRulesByAnalyzer = new Map<string, SuppressionRule[]>();
    for (const analyzer of rulesByAnalyzer.keys()) {
        const combinedRules = [
            ...(rulesByAnalyzer.get(analyzer) ?? EMPTY_SUPPRESSIONS),
            ...generalRules,
        ];
        combinedRules.sort(
            (firstRule, secondRule) =>
                (orderIndexByRule.get(firstRule) ?? 0) - (orderIndexByRule.get(secondRule) ?? 0),
        );
        candidateRulesByAnalyzer.set(analyzer, combinedRules);
    }
    generalRules.sort(
        (firstRule, secondRule) =>
            (orderIndexByRule.get(firstRule) ?? 0) - (orderIndexByRule.get(secondRule) ?? 0),
    );
    return { candidateRulesByAnalyzer, generalRules, fileMatcherByRule };
}

/**
 * Evaluates whether an individual issue matches any active suppression rule.
 *
 * @param issue - Issue to evaluate.
 * @param index - Pre-indexed suppression rule database.
 * @returns Matching suppression rule if applicable.
 */
function matchSuppression(issue: Issue, index: SuppressionIndex): SuppressionRule | undefined {
    const symbol =
        typeof issue.detail?.function === 'string'
            ? issue.detail.function
            : typeof issue.detail?.name === 'string'
              ? issue.detail.name
              : EMPTY_STRING;
    const candidates = index.candidateRulesByAnalyzer.get(issue.analyzer) ?? index.generalRules;
    const normalizedFilePath = issue.location.file.replace(/\\/g, '/');

    return candidates.find(
        (rule) =>
            (!rule.matchFile || index.fileMatcherByRule.get(rule)!.test(normalizedFilePath)) &&
            (!rule.matchRule || areAliasForms(issue.rule, rule.matchRule)) &&
            (!rule.matchSymbol ||
                symbol === rule.matchSymbol ||
                symbol.endsWith(SYMBOL_DOT_PREFIX + rule.matchSymbol)),
    );
}

/**
 * Applies configured suppression rules to all issues in the report.
 *
 * @param report - Scan report undergoing suppression filtering.
 * @param suppressions - Suppression rule collection.
 * @returns Total count of suppressed issues.
 */
async function applySuppressions(report: ScanReport, suppressions: readonly SuppressionRule[]): Promise<number> {
    const arbiter = new FindingConfidenceArbiter();
    const index = suppressions.length > 0 ? buildSuppressionIndex(suppressions) : null;
    let suppressedCount = 0;
    const fileCache = new Map<string, string>();

    for (const issue of report.issues) {
        const file = issue.location?.file;
        let fileContent = file ? fileCache.get(file) : undefined;
        if (file && fileContent === undefined && fs.existsSync(file)) {
            try {
                fileContent = await fs.promises.readFile(file, 'utf8');
                fileCache.set(file, fileContent);
            } catch (readError) {
                fileContent = '';
                void readError;
            }
        }
        if (fileContent) {
            const inlineCheck = arbiter.checkInlineSuppression(issue, fileContent);
            if (inlineCheck.isSuppressed) {
                suppressedCount++;
                issue.suppression = {
                    reason: inlineCheck.reason || 'Suppressed via inline comment directive',
                    downgraded: false,
                };
                continue;
            }
        }

        if (index) {
            const matchedRule = matchSuppression(issue, index);
            if (matchedRule) {
                suppressedCount++;
                issue.suppression = {
                    reason: matchedRule.reason,
                    downgraded: Boolean(matchedRule.downgradeTo),
                };
                if (matchedRule.downgradeTo) {
                    issue.severity = matchedRule.downgradeTo;
                }
            }
        }
    }
    computeSummary(report);
    return suppressedCount;
}

/** Dedicated baseline finalization context. */
interface BaselineFinalizationContext {
    report: ScanReport;
    config: ScanConfig;
    options: FinalizeBaselineOptions;
    logger: Logger;
    postScanPasses: string[];
}

/**
 * Finalizes baseline integration including ratchet verification and updates.
 *
 * @param context - Dedicated baseline finalization context.
 */
async function finalizeBaseline(context: BaselineFinalizationContext): Promise<void> {
    const { report, config, options, logger, postScanPasses } = context;
    const granularity =
        options.baselineGranularity || config.baselineGranularity || DEFAULT_BASELINE_GRANULARITY;
    const hasBaselineFile = Boolean(options.baseline && fs.existsSync(options.baseline));
    if (options.updateBaseline || hasBaselineFile) {
        postScanPasses.push(PASS_BASELINE);
    }
    if (options.updateBaseline) {
        await handleBaselineUpdate(report, options.updateBaseline, granularity, logger, {
            ratchetDown: options.baselineRatchetDown ?? true,
            forceExpand: options.forceBaselineExpand ?? false,
        });
    }
    if (options.baseline) {
        await handleBaselineRatchet(report, options.baseline, logger);
    }
}

/**
 * Groups issues by their originating file path for efficient per-file evaluation.
 *
 * @param issues - Flat array of detected issues.
 * @returns Map indexing issues by normalized file path.
 */
function groupIssuesByFile(issues: readonly Issue[]): Map<string, Issue[]> {
    const issuesByFile = new Map<string, Issue[]>();
    for (const targetIssue of issues) {
        const filePath = targetIssue.location?.file;
        if (!filePath) continue;
        const fileGroup = issuesByFile.get(filePath);
        if (fileGroup) {
            fileGroup.push(targetIssue);
        } else {
            issuesByFile.set(filePath, [targetIssue]);
        }
    }
    return issuesByFile;
}

/**
 * Resolves architectural governance project profile from scan configuration.
 *
 * @param config - Resolved scan configuration.
 * @returns Mapped governance project profile metadata.
 */
function resolveGovernanceProfile(config: ScanConfig): GovernanceProjectProfile {
    let stage: GovernanceProjectProfile['stage'] = STAGE_PRODUCTION;
    if (config.maturityTier === TIER_INDUSTRIAL) {
        stage = STAGE_INDUSTRIAL_INFRASTRUCTURE;
    } else if (config.maturityTier === TIER_DEMO || config.maturityTier === TIER_PROTOTYPE) {
        stage = STAGE_PROTOTYPE;
    }

    let scale: GovernanceProjectProfile['scale'] = SCALE_SMALL;
    if (config.scaleGrade === GRADE_ENTERPRISE) {
        scale = SCALE_MASSIVE;
    } else if (config.scaleGrade === GRADE_LARGE) {
        scale = SCALE_LARGE;
    } else if (config.scaleGrade === GRADE_MEDIUM) {
        scale = SCALE_MEDIUM;
    }

    let domain: GovernanceProjectProfile['domain'] = DOMAIN_CORE_FRAMEWORK;
    if (config.archetype === ARCHETYPE_LIBRARY) {
        domain = DOMAIN_ALGORITHM_LIB;
    } else if (config.archetype === ARCHETYPE_GAME || config.archetype === ARCHETYPE_WEB) {
        domain = DOMAIN_BUSINESS_APP;
    }

    return { stage, scale, domain };
}

/**
 * Recomputes quality scores, tri-plane vectors, and project autonomy indices.
 *
 * @param report - Report to enrich with updated scores.
 * @param config - Resolved scan configuration.
 * @param reportScanner - Scanner instance providing index cache when available.
 */
function refreshQualityScores(
    report: ScanReport,
    config: ScanConfig,
    reportScanner: Scanner | null,
): void {
    const effectiveScorerArchetype = config.reviewProfile ?? config.archetype;
    const scorer =
        reportScanner && typeof reportScanner.getQualityScorer === 'function'
            ? reportScanner.getQualityScorer()
            : new QualityScorer(
                  config.scoringWeights as unknown as Record<string, number>,
                  effectiveScorerArchetype,
              );

    const issuesByFile = groupIssuesByFile(report.issues);
    const fileQualityScores: Record<string, QualityScoreBreakdown> = {};
    const fileMetrics = report.fileMetrics ?? [];

    const fallbackIssues = EMPTY_ISSUES as unknown as Issue[];
    for (const metric of fileMetrics) {
        const fileIssues = issuesByFile.get(metric.file) || fallbackIssues;
        fileQualityScores[metric.file] = scorer.evaluateFile(
            metric.file,
            fileIssues,
            metric,
            config,
        );
    }
    report.fileQualityScores = fileQualityScores;
    const projectQualityScore = scorer.evaluateProject(
        fileQualityScores,
        fileMetrics,
        config,
        report.issues,
    );
    report.qualityScore = projectQualityScore;

    const staticVector = synthesizeStaticQualityVector(projectQualityScore.indices);
    const dynamicTelemetry = config.telemetryData;
    const dynamicVector = dynamicTelemetry
        ? computeDynamicQualityVector(dynamicTelemetry)
        : undefined;
    report.triPlaneQuality = computeUnifiedQualityScore(
        staticVector,
        dynamicVector,
        SCORE_MAX_BASELINE,
        resolveGovernanceProfile(config),
    );
    report.autonomy = evaluateProjectAutonomy(
        fileMetrics,
        report.issues,
        config,
        undefined,
        reportScanner && typeof reportScanner.getSymbolIndex === 'function'
            ? reportScanner.getSymbolIndex()
            : undefined,
    );
}

/**
 * Determines whether quality scores and composite metrics should be recomputed.
 *
 * @param report - Current scan report.
 * @param initialIssueCount - Count of issues before post-scan suppression.
 * @param suppressedCount - Count of suppressed issues.
 * @returns True if quality metrics require recalculation.
 */
function shouldRefreshQualityScores(
    report: ScanReport,
    initialIssueCount: number,
    suppressedCount: number,
): boolean {
    if (report.issues.length !== initialIssueCount || suppressedCount > 0) return true;
    return (
        !report.qualityScore ||
        !report.fileQualityScores ||
        !report.triPlaneQuality ||
        !report.autonomy
    );
}

/**
 * Executes behavioral hotspot evaluation across scanned files, ranking top refactoring hotspots.
 *
 * @param context - Current post-scan execution context.
 */
function applyEvolutionPass(context: PostScanPassContext): void {
    if (context.scope !== POST_SCAN_SCOPE_FULL || !context.report.fileMetrics || context.report.fileMetrics.length === 0) {
        return;
    }
    try {
        const evaluator = new BehavioralHotspotEvaluator();
        const inputs: FileHotspotInput[] = [];
        const issuesByFile = groupIssuesByFile(context.report.issues);

        for (const metric of context.report.fileMetrics) {
            const fileIssues = issuesByFile.get(metric.file) || [];
            inputs.push({
                filePath: metric.file,
                commits30Days: 1,
                eloc: metric.lines,
                cyclomaticComplexity: Math.max(1, metric.maxNestingDepth * 2),
                defectCount: fileIssues.length,
            });
        }

        const hotspotResults = evaluator.evaluateBatch(inputs);
        const topHotspots = hotspotResults.slice(0, 5);

        if (context.report.triPlaneQuality) {
            const triPlane = context.report.triPlaneQuality as unknown as Record<string, unknown>;
            triPlane.hotspots = topHotspots;

            const arbiter = new FindingConfidenceArbiter();
            const arbitration = arbiter.arbitrate(context.report.issues);
            if (arbitration.noisyRules && arbitration.noisyRules.length > 0) {
                triPlane.noisyRules = arbitration.noisyRules;
            }
        }
    } catch (evolutionError) {
        context.logger.info(`Behavioral hotspot evolution pass degraded: ${String(evolutionError)}`);
    }
}

/**
 * Post-scan pipeline enriching and finalizing a raw ScanReport.
 *
 * @param finalizeArguments - Context payload or positional execution arguments.
 * Concurrency: reentrant, idempotent async execution; safe for single-threaded runtime.
 */
export async function finalizeReport(
    ...finalizeArguments:
        | [context: FinalizeReportContext]
        | [
              report: ScanReport,
              config: ScanConfig,
              options: FinalizeBaselineOptions,
              logger: Logger,
              reportScanner?: Scanner | null,
              scope?: PostScanScope,
          ]
): Promise<void> {
    const firstArg = finalizeArguments[0];
    const isContextObject =
        finalizeArguments.length === 1 &&
        firstArg !== null &&
        typeof firstArg === 'object' &&
        KEY_REPORT in firstArg &&
        KEY_CONFIG in firstArg;

    const context: FinalizeReportContext = isContextObject
        ? (firstArg as FinalizeReportContext)
        : {
              report: finalizeArguments[0] as ScanReport,
              config: finalizeArguments[1] as ScanConfig,
              options: finalizeArguments[2] as FinalizeBaselineOptions,
              logger: finalizeArguments[3] as Logger,
              reportScanner: finalizeArguments[4] ?? null,
              scope: finalizeArguments[5] ?? POST_SCAN_SCOPE_FULL,
          };

    const { report, config, options, logger } = context;
    const reportScanner = context.reportScanner ?? null;
    const scope = context.scope ?? POST_SCAN_SCOPE_FULL;

    if ((report as unknown as Record<symbol, boolean>)[FINALIZED]) return;
    (report as unknown as Record<symbol, boolean>)[FINALIZED] = true;
    const postScanPasses: string[] = [];
    const initialIssueCount = report.issues.length;

    const warnings: string[] = [...(report.summary.warnings ?? [])];
    checkEmptyIncludeGlobs(report, warnings);

    const passContext: PostScanPassContext = {
        report,
        config,
        logger,
        reportScanner,
        scope,
        warnings,
        postScanPasses,
    };

    await applyDependencyGraphPass(passContext);
    applyLiteralClustersPass(passContext);
    applyConstTopologyPass(passContext);
    applyErrorFlowPass(passContext);
    applySemanticComplexityPass(passContext);

    postScanPasses.push(PASS_SUPPRESSIONS);
    const suppressedCount = await applySuppressions(report, config.suppressions ?? []);
    report.summary.suppressedCount = suppressedCount;
    report.summary.postScanPasses = postScanPasses;
    if (warnings.length > 0) report.summary.warnings = warnings;

    if (shouldRefreshQualityScores(report, initialIssueCount, suppressedCount)) {
        refreshQualityScores(report, config, reportScanner);
    }

    applyEvolutionPass(passContext);

    await finalizeBaseline({
        report,
        config,
        options,
        logger,
        postScanPasses,
    });
}
