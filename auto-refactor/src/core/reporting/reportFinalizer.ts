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
import type { ScanConfig, ScanReport, Issue } from '../types';
import type { Scanner } from '../analyzer';
import { summarizeUncertainty } from './canonical-issue-builder';
import type { Logger } from '../logger';
import { runCyclePass } from '../dependency-graph';
import type { ObservedConstantDeclaration } from '../architecture/constant-library-auditor';
import { inspectConstantLibraryTopology } from '../architecture/constant-library-auditor';
import {
    auditEmptyDirectories,
    toIgnoredDirectoryName,
} from '../intelligence/empty-directory-audit';
import {
    BASELINE_GRANULARITY_GROUPED,
    groupCounts,
    handleBaselineUpdate,
    handleBaselineRatchet,
} from './baselineManager';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import { QualityScorer } from '../scoring/qualityScorer';
import { synthesizeStaticQualityVector } from '../scoring/static-quality-model';
import { computeDynamicQualityVector } from '../dynamic/dynamic-quality-scorer';
import { computeUnifiedQualityScore } from '../scoring/fusion-scorer';
import type { GovernanceProjectProfile } from '../scoring/fusion-scorer';
import { evaluateProjectAutonomy } from '../scoring/autonomy-scorer';
import { applySuppressions } from './post-scan-suppressions';
import { applyArbitrationPass, synthesizeProjectQuant } from './post-scan-arbitration';
import {
    recordHistoricalQualitySample,
    resolveHistoricalQualityScore,
} from '../scoring/rolling-sampling-governor';
import {
    applyAnalyzerSeverityCaps,
    enrichEvolutionAndCoverage,
    loadEnrichedCalibrationStats,
    syncAdaptiveSupervisorState,
    synthesizeNativeGovernance,
} from './post-scan-enrichment';

export { BASELINE_GRANULARITY_GROUPED, groupCounts };

export { POST_SCAN_SCOPE_FULL, POST_SCAN_SCOPE_INCREMENTAL } from './report-finalization-context';
export type {
    PostScanScope,
    FinalizeBaselineOptions,
    FinalizeReportContext,
} from './report-finalization-context';
import { POST_SCAN_SCOPE_FULL, resolveFinalizeContext } from './report-finalization-context';
import type {
    PostScanScope,
    FinalizeBaselineOptions,
    FinalizeReportArguments,
} from './report-finalization-context';

/** Named identifiers for post-scan analysis passes. */
const PASS_DEPENDENCY_GRAPH = 'dependency-graph';
const PASS_LITERAL_CLUSTERS = 'literal-clusters';
const PASS_CONSTANT_LIBRARY_TOPOLOGY = 'constant-library-topology';
const PASS_EMPTY_DIRECTORIES = 'empty-directories';
const PASS_ERROR_FLOW = 'error-flow';
const PASS_SEMANTIC_COMPLEXITY = 'semantic-complexity';
const PASS_SUPPRESSIONS = 'suppressions';
const PASS_ARBITRATION = 'arbitration';
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
const OPT_CHECK_EMPTY_DIRECTORIES = 'checkEmptyDirectories';

/** Default baseline comparison granularity. */
const DEFAULT_BASELINE_GRANULARITY = 'id';

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
const MSG_EMPTY_DIRECTORY_ISSUES = 'lingering empty directory finding(s)';

/** Empty string constant for fallback representation. */
const EMPTY_STRING = '';

/** Immutable empty array singleton for zero-allocation fallbacks in hot loops. */
const EMPTY_ISSUES: readonly Issue[] = Object.freeze([]);

const FINALIZED = Symbol('auto-refactor:finalized');

/** Execution context passed across individual post-scan analysis passes. */
interface PostScanPassContext {
    report: ScanReport;
    config: ScanConfig;
    logger: Logger;
    reportScanner: Scanner | null;
    scope: PostScanScope;
    warnings: string[];
    postScanPasses: string[];
    snapshotSource?: ReadonlyMap<string, string>;
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
    const cycle = await runCyclePass(
        report,
        config,
        logger,
        covered ? prebuilt : null,
        context.snapshotSource,
    );

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

/**
 * Reports directories that keep no live entries, completing the physical hygiene matrix.
 *
 * The hygiene analyzer is a per-file pass, so it can reach seven of the eight hygiene dimensions;
 * a lingering empty directory has no file to attach to. The whole-tree view exists only here,
 * which is why the rule lives in the post-scan channel and is skipped for incremental scopes: a
 * changed-file subset has no tree to judge.
 *
 * @param context - Execution context of the current post-scan cycle.
 */
function applyEmptyDirectoryPass(context: PostScanPassContext): void {
    const { report, config, logger, scope, postScanPasses } = context;
    const targetConfig =
        scope === POST_SCAN_SCOPE_FULL ? config.analyzers[ANALYZER_HYGIENE] : undefined;
    const targetOptions = targetConfig?.options as Record<string, unknown> | undefined;
    if (!targetConfig?.enabled || targetOptions?.[OPT_CHECK_EMPTY_DIRECTORIES] === false) {
        return;
    }

    postScanPasses.push(PASS_EMPTY_DIRECTORIES);
    const issues = auditEmptyDirectories(config.root, {
        ignoredDirectoryNames: config.exclude
            .map((entry) => toIgnoredDirectoryName(entry))
            .filter((entry): entry is string => entry !== null),
    });
    if (issues.length === 0) {
        return;
    }
    report.issues.push(...issues);
    computeSummary(report);
    logger.info(`${PASS_EMPTY_DIRECTORIES}: ${issues.length} ${MSG_EMPTY_DIRECTORY_ISSUES}`);
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

function collectDirtyFiles(report: ScanReport, initialIssueCount: number): Set<string> {
    const dirtyFiles = new Set<string>();
    const issues = report.issues;
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        const file = issue.location?.file;
        if (!file) continue;
        if (
            i >= initialIssueCount ||
            issue.suppression !== undefined ||
            issue.clusteredInto !== undefined
        ) {
            dirtyFiles.add(file);
        }
    }
    return dirtyFiles;
}

interface RefreshQualityScoresParams {
    readonly report: ScanReport;
    readonly config: ScanConfig;
    readonly reportScanner: Scanner | null;
    readonly scope: PostScanScope;
    readonly logger: Logger;
    readonly initialIssueCount?: number;
    readonly snapshotSource?: ReadonlyMap<string, string>;
}

/**
 * Ensures the report carries an autonomy evaluation, reusing the one the scan already produced.
 *
 * `buildScanReport` scores autonomy with the scanner's symbol index, which is the same index this
 * pass would pass and yields the same result. Recomputing it read every file a second time — the
 * autonomy pass reads each file's import preamble — so the existing value stands unless a slice
 * scan never produced one. Extracted from `refreshQualityScores` so that adding the guard there did
 * not raise that function's cyclomatic complexity.
 *
 * @param report - Report to enrich in place.
 * @param config - Resolved scan configuration.
 * @param reportScanner - Scanner that produced the report, when it is this process's own.
 */
function applyAutonomyScore(
    report: ScanReport,
    config: ScanConfig,
    reportScanner: Scanner | null,
): void {
    if (report.autonomy) return;
    report.autonomy = evaluateProjectAutonomy(
        report.fileMetrics ?? [],
        report.issues,
        config,
        reportScanner?.retainedSourceText() as Map<string, string> | undefined,
        reportScanner && typeof reportScanner.getSymbolIndex === 'function'
            ? reportScanner.getSymbolIndex()
            : undefined,
    );
}

/**
 * Recomputes quality scores, tri-plane vectors, and project autonomy indices.
 *
 * @param params - Context carrying report, resolved config, scanner, scope, and initial count.
 */
async function refreshQualityScores(params: RefreshQualityScoresParams): Promise<void> {
    const { report, config, reportScanner, initialIssueCount = 0 } = params;
    const effectiveScorerArchetype = config.reviewProfile ?? config.archetype;
    const scorer =
        reportScanner && typeof reportScanner.getQualityScorer === 'function'
            ? reportScanner.getQualityScorer()
            : new QualityScorer(
                  config.scoringWeights as unknown as Record<string, number>,
                  effectiveScorerArchetype,
              );

    const existingScores = report.fileQualityScores;
    const dirtyFiles = existingScores ? collectDirtyFiles(report, initialIssueCount) : null;
    const issuesByFile = groupIssuesByFile(report.issues);
    const fileQualityScores: Record<string, QualityScoreBreakdown> = {};
    const fileMetrics = report.fileMetrics ?? [];

    const fallbackIssues = EMPTY_ISSUES as unknown as Issue[];
    for (const metric of fileMetrics) {
        const cached = existingScores?.[metric.file];
        if (cached && dirtyFiles && !dirtyFiles.has(metric.file)) {
            fileQualityScores[metric.file] = cached;
            continue;
        }
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
    await refreshQualityProjections(params, projectQualityScore);
}

/** Project static scores and source-aware enrichment without persisting snapshot history. */
async function refreshQualityProjections(
    params: RefreshQualityScoresParams,
    projectQualityScore: NonNullable<ScanReport['qualityScore']>,
): Promise<void> {
    const { report, config, reportScanner, scope, logger } = params;
    const fileMetrics = report.fileMetrics ?? [];
    const staticVector = synthesizeStaticQualityVector(projectQualityScore.indices);
    const dynamicTelemetry = config.telemetryData;
    const dynamicVector =
        dynamicTelemetry && dynamicTelemetry.isObserved !== false
            ? computeDynamicQualityVector(dynamicTelemetry)
            : undefined;
    const historicalScore = params.snapshotSource
        ? undefined
        : resolveHistoricalQualityScore(config);
    const supervisorWeights = params.snapshotSource
        ? undefined
        : await syncAdaptiveSupervisorState({
              config,
              scope,
              historicalScore,
              currentCompositeScore: projectQualityScore.compositeScore,
          });
    report.triPlaneQuality = computeUnifiedQualityScore(
        staticVector,
        dynamicVector,
        historicalScore,
        {
            ...resolveGovernanceProfile(config),
            supervisorWeights,
        },
    );
    const totalEffectiveLines = fileMetrics.reduce(
        (acc, item) => acc + (item.nonBlankLines || 0),
        0,
    );
    if (!params.snapshotSource) {
        recordHistoricalQualitySample(
            config,
            projectQualityScore.compositeScore,
            totalEffectiveLines,
        );
    }
    projectQualityScore.quant = synthesizeProjectQuant(
        config,
        projectQualityScore,
        fileMetrics,
        report.issues,
    );
    if (!params.snapshotSource) applyAutonomyScore(report, config, reportScanner);
    report.governance = await synthesizeNativeGovernance({
        report,
        config,
        scope,
        // Reuse the text this scan already read; empty when retention sealed, or when the report
        // came from a warm/daemon scan, in which case governance reads from disk instead.
        contentByPath: params.snapshotSource ?? reportScanner?.retainedSourceText(),
        allowHostRead: params.snapshotSource === undefined,
        logger,
    });
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
    for (let i = 0; i < report.issues.length; i++) {
        if (report.issues[i].clusteredInto) return true;
    }
    return (
        !report.qualityScore ||
        !report.fileQualityScores ||
        !report.triPlaneQuality ||
        !report.autonomy ||
        !report.governance
    );
}

/**
 * Post-scan pipeline enriching and finalizing a raw ScanReport.
 *
 * @param finalizeArguments - Context payload or positional execution arguments.
 * Concurrency: reentrant, idempotent async execution; safe for single-threaded runtime.
 */
export async function finalizeReport(...finalizeArguments: FinalizeReportArguments): Promise<void> {
    const context = resolveFinalizeContext(finalizeArguments);

    const { report, config, options, logger, snapshotSource } = context;
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
        snapshotSource,
    };

    await applyDependencyGraphPass(passContext);
    applyLiteralClustersPass(passContext);
    applyConstTopologyPass(passContext);
    applyErrorFlowPass(passContext);
    applySemanticComplexityPass(passContext);
    if (!snapshotSource) applyEmptyDirectoryPass(passContext);

    const cappedCount = applyAnalyzerSeverityCaps(report, config);
    postScanPasses.push(PASS_SUPPRESSIONS);
    const suppressedCount = await applySuppressions(
        report,
        config.suppressions ?? [],
        config.root,
        snapshotSource ?? reportScanner?.retainedSourceText(),
        snapshotSource === undefined,
    );
    computeSummary(report);
    report.summary.suppressedCount = suppressedCount;

    if (snapshotSource) {
        warnings.push('snapshot-external-enrichment-unavailable');
        await refreshQualityScores({
            report,
            config,
            reportScanner,
            scope,
            logger,
            initialIssueCount,
            snapshotSource,
        });
        computeSummary(report);
        report.summary.postScanPasses = postScanPasses;
        report.summary.warnings = warnings;
        return;
    }

    const calibrationStats = await loadEnrichedCalibrationStats({
        corpusPath: options.confidenceCorpus,
        rootDir: config.root,
        scope,
        logger,
        reportScanner,
    });
    await applyArbitrationPass(passContext, options.reviewQueue, calibrationStats);
    postScanPasses.push(PASS_ARBITRATION);

    report.summary.postScanPasses = postScanPasses;
    if (warnings.length > 0) report.summary.warnings = warnings;

    if (shouldRefreshQualityScores(report, initialIssueCount, suppressedCount + cappedCount)) {
        await refreshQualityScores({
            report,
            config,
            reportScanner,
            scope,
            logger,
            initialIssueCount,
        });
    }

    await enrichEvolutionAndCoverage({
        report,
        config,
        scope,
        logger,
        reportScanner,
    });

    await finalizeBaseline({
        report,
        config,
        options,
        logger,
        postScanPasses,
    });
}
