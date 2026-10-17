/**
 * Module: Core Engine — Asymmetric Dual-Track Audit Pipeline
 * File Path: src/core/pipeline/dualTrackPipeline.ts
 * Architecture Role: Orchestration layer between Scanner and the router/scoring/memory
 *   subsystems; Track 1 (FastTrack) is a localized, sparse-routed speculative audit with
 *   Review Memory reuse (< 15ms) producing verdicts, scores and agent prompts, while Track 2
 *   (DeepTrack) asynchronously audits global dependency impact, cycles and architectural
 *   boundaries, escalating violations.
 * Dependencies & Triggers: Imports path, Scanner, Issue/Severity/FileMetric, classifyDiff,
 *   routeDiffToAnalyzers, EscalationChannel/EscalationEvent, LoadGovernor, QualityScorer,
 *   review-memory domain fingerprinting/matching, AgentConstraintGenerator,
 *   ModuleDependencyGraph and FileRevision; triggered per executeDualTrack call, with
 *   detectDependencyCycles available to dependency-graph consumers.
 * Responsibilities: detectDependencyCycles runs an iterative three-color DFS with an explicit
 *   frame stack over the dependency graph, normalizes target roots and returns deduplicated
 *   cycle paths; executeDualTrack classifies each diff, sparsely routes analyzers, narrows the
 *   active set on Review Memory domain reuse, runs localized scans, scores files, updates
 *   Review Memory and change trajectory, and generates agent guidance; its background track
 *   registers modified content into the dependency graph, computes reverse-dependency affected
 *   files, detects cycles, and flags core/domain imports of ui/view/frontend/cli/controllers
 *   by publishing CIRCULAR_DEPENDENCY / ARCHITECTURE_BREACH events to the EscalationChannel.
 * Exit Semantics & Design Rationale: detectDependencyCycles returns [] when acyclic and never
 *   throws; executeDualTrack resolves with a FastTrack verdict (SPECULATIVE_PASSED unless an
 *   error issue exists) plus a deepPromise, so callers must await it for CONFIRMED/ESCALATED;
 *   fast-track failures reject the outer promise while deep-track failures reject only that
 *   promise. Yielding the event loop before deep work decouples foreground speculative
 *   response latency from heavy background dependency and architecture graph evaluations.
 */

import type { Scanner } from '../analyzer';
import type { Issue, FileMetric, ProjectArchetype } from '../types';
import { SEVERITY_ERROR } from '../types';
import { classifyDiff } from '../router/diffClassifier';
import type { DiffClassificationResult } from '../router/diffClassifier';
import type { SparseRouteResult } from '../router/sparseRuleRouter';
import { routeDiffToAnalyzers } from '../router/sparseRuleRouter';
import type { EscalationEvent } from './escalationChannel';
import { EscalationChannel } from './escalationChannel';
import { LoadGovernor } from '../profiler/loadGovernor';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import type { QualityScorer } from '../scoring/qualityScorer';
import { extractCodeDomains, computeAstDigest } from '../memory/domainFingerprint';
import { matchDomains } from '../memory/semanticMatcher';
import { AgentConstraintGenerator } from '../guidance/agentConstraintGenerator';
import { ModuleDependencyGraph } from '../dependency-graph';
import type { FileRevision } from '../trajectory/types';
import type { ReviewMemoryManager } from '../memory/reviewMemory';
import type { CodeDomainFingerprint, ReviewMemoryRecord } from '../memory/types';
import type { ChangeTrajectoryManager } from '../trajectory/changeTrajectory';
import { detectDependencyCycles, detectDependencyCyclesAsync } from './cycle-detector';

/** Number of leading digest hex characters kept as the short revision identifier. */
const REVISION_ID_LENGTH = 16;

/**
 * Reusable singleton instance of AgentConstraintGenerator to eliminate
 * per-invocation heap churn.
 */
const SHARED_AGENT_CONSTRAINT_GENERATOR = new AgentConstraintGenerator();

/** Batch size of affected files to inspect before yielding the event loop. */
const AFFECTED_FILES_YIELD_BATCH = 50;

/** Architecture rule analyzer identifier for deep layer checks. */
const ANALYZER_ARCHITECTURE = 'architecture';

/** Dependency graph analyzer identifier for circular dependency checks. */
const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';

/** Comments analyzer identifier. */
const ANALYZER_COMMENTS = 'comments';

/** Constants analyzer identifier. */
const ANALYZER_CONSTANTS = 'constants';

/** Secrets analyzer identifier. */
const ANALYZER_SECRETS = 'secrets';

/** Diff classification literal only category identifier. */
const DIFF_CATEGORY_LITERAL_ONLY = 'LITERAL_ONLY';

/** Clean layer violation rule identifier. */
const RULE_CLEAN_LAYER_VIOLATION = 'clean-layer-violation';

/** Import cycle rule identifier. */
const RULE_IMPORT_CYCLE = 'import-cycle';

/** Escalation event type for architecture boundary breaches. */
const EVENT_ARCHITECTURE_BREACH = 'ARCHITECTURE_BREACH';

/** Escalation event type for circular dependencies. */
const EVENT_CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY';

/** DeepTrack status when escalation events were published. */
const STATUS_ESCALATED = 'ESCALATED';

/** DeepTrack status when no escalation events were published. */
const STATUS_CONFIRMED = 'CONFIRMED';

/** Memory record status when rejected. */
const STATUS_REJECTED = 'REJECTED';

/** Memory record status when approved. */
const STATUS_APPROVED = 'APPROVED';

/** Memory record status when contaminated. */
const STATUS_CONTAMINATED = 'CONTAMINATED';

/** FastTrack verdict status when passed. */
const VERDICT_SPECULATIVE_PASSED = 'SPECULATIVE_PASSED';

/** FastTrack verdict status when rejected. */
const VERDICT_SPECULATIVE_REJECTED = 'SPECULATIVE_REJECTED';

/** Default agent author string. */
const DEFAULT_AGENT_AUTHOR = 'agent-worker';

/** Fallback file path when missing. */
const FALLBACK_FILE_PATH = 'unknown';

/** Arrow connector for stringifying dependency cycles. */
const CYCLE_CONNECTOR = ' -> ';

/** Root location line number for synthesized issues. */
const DEFAULT_LOCATION_LINE = 1;

/** Root location column number for synthesized issues. */
const DEFAULT_LOCATION_COL = 1;

/** Colon-one suffix for root line location ID. */
const ROOT_LOCATION_SUFFIX = ':1';

/** Path pattern identifying core or domain modules subject to architecture layering rules. */
const ARCH_CORE_DOMAIN_PATH_RE = /[/\\](?:core|domain)[/\\]/i;

/** Quick check pattern verifying that source text contains import or require statements. */
const IMPORT_KEYWORD_QUICK_CHECK = /(?:from|require\()/i;

/**
 * Precompiled regular expression matching forbidden upper-layer imports
 * from core/domain modules.
 */
const FORBIDDEN_UPPER_IMPORT_RE =
    /(?:from|require\()\s*['"]([^'"]*(?:ui|view|frontend|cli|controllers)[^'"]*)['"]/i;

/**
 * One file mutation handed to {@link executeDualTrack}: the two content snapshots plus the
 * optional changed-line list that lets the diff classifier skip recomputing hunks.
 */
export interface DiffFileInput {
    /** Repo-relative or absolute path used as review-memory and dependency-graph key. */
    filePath: string;
    /** Content before this mutation; may be empty for a newly added file. */
    oldContent: string;
    /** Content after this mutation; may be empty for a deletion. */
    newContent: string;
}

/**
 * Result of the foreground speculative track: localized issues, a quality score, sparse routing
 * decisions per file, and the anomaly kinds observed while replaying the change trajectory.
 */
export interface FastTrackVerdict {
    /** SPECULATIVE_REJECTED when any error-severity issue was found, otherwise PASSED. */
    status: 'SPECULATIVE_PASSED' | 'SPECULATIVE_REJECTED';
    /** Issues surfaced by the localized scans of the fast track. */
    issues: Issue[];
    /** Composite quality breakdown for the last processed file. */
    score: QualityScoreBreakdown;
    /** Wall-clock duration of the foreground track in milliseconds. */
    latencyMs: number;
    /** Per-file sparse-routing decision selecting which analyzers actually ran. */
    sparseRouting: Record<string, SparseRouteResult>;
    /** Rendered agent guidance, when the constraint generator produced any. */
    agentGuidancePrompt?: string;
    /** Anomaly kinds detected while recording change-trajectory revisions. */
    anomaliesDetected: string[];
}

/**
 * Result of the background deep track: confirmed issues plus the transitive affected-file
 * closure, dependency cycles, and the escalation events published for them.
 */
export interface DeepTrackVerdict {
    /** ESCALATED when at least one cycle or boundary event was published, else CONFIRMED. */
    status: 'CONFIRMED' | 'ESCALATED';
    /** Issues confirmed by whole-graph analysis (cycles, architecture breaches). */
    deepIssues: Issue[];
    /** Transitive reverse-dependency closure of the changed files. */
    affectedFiles: string[];
    /** Dependency cycles among the changed roots, each path closed by its entry node. */
    cycles: string[][];
    /** Wall-clock duration of the background track in milliseconds. */
    latencyMs: number;
    /** Escalation events handed to the channel, in detection order. */
    escalationEvents: EscalationEvent[];
}

/**
 * Handle returned by {@link executeDualTrack}: the already-resolved fast verdict plus the
 * pending deep-track promise that callers must await for CONFIRMED/ESCALATED findings.
 */
export interface DualTrackExecution {
    /** Foreground speculative verdict, available once the call's promise resolves. */
    fastVerdict: FastTrackVerdict;
    /** Background deep verdict; rejects independently of the fast track on deep failure. */
    deepPromise: Promise<DeepTrackVerdict>;
}

/**
 * Optional collaborators and overrides for {@link executeDualTrack}; every field is optional and
 * falls back to a fresh default instance or to scanner-owned state.
 */
export interface DualTrackOptions {
    /** Escalation sink for deep-track events; a fresh channel is created when omitted. */
    escalationChannel?: EscalationChannel;
    /** Cooperative load governor used for event-loop yields; created when omitted. */
    loadGovernor?: LoadGovernor;
    /** Agent identity recorded on trajectory revisions; defaults to 'agent-worker'. */
    author?: string;
    /** When true, disables sparse routing so every analyzer runs on every input. */
    forceFull?: boolean;
    /** Dependency graph to audit; falls back to the scanner's graph, then to an empty one. */
    graph?: ModuleDependencyGraph;
    /** Project archetype to steer sparse general code routing instead of 100% full activation. */
    archetype?: ProjectArchetype;
}

export { detectDependencyCycles, detectDependencyCyclesAsync };

/** Parameter context for refining active analyzers based on ReviewMemory match. */
export interface RefineAnalyzersContext {
    readonly existingRecord?: ReviewMemoryRecord;
    readonly isTainted: boolean;
    readonly newContent: string;
    readonly currentDomains: CodeDomainFingerprint[];
    readonly classification: DiffClassificationResult;
    readonly defaultAnalyzers: Set<string>;
}

/** Parameter context for persisting audit findings to review memory and trajectory. */
export interface MemoryTrajectoryContext {
    readonly memory: ReviewMemoryManager;
    readonly trajectory: ChangeTrajectoryManager;
    readonly filePath: string;
    readonly newContent: string;
    readonly currentDomains: CodeDomainFingerprint[];
    readonly fileIssues: Issue[];
    readonly scoreBreakdown: QualityScoreBreakdown;
    readonly author: string;
    readonly activeAnalyzers: string[];
    readonly allAnomalies: string[];
}

/** Parameter context for executing background deep analysis track. */
export interface DeepTrackExecutionPlan {
    readonly scanner: Scanner;
    readonly inputs: DiffFileInput[];
    readonly options: DualTrackOptions;
    readonly governor: LoadGovernor;
    readonly channel: EscalationChannel;
    readonly memory: ReviewMemoryManager;
    readonly trajectory: ChangeTrajectoryManager;
}

/** Parameter context for checking architecture boundary violations. */
interface ArchitectureBreachCheckContext {
    readonly inputs: DiffFileInput[];
    readonly affectedFiles: string[];
    readonly deepIssues: Issue[];
    readonly escalationEvents: EscalationEvent[];
    readonly channel: EscalationChannel;
    readonly memory: ReviewMemoryManager;
    readonly trajectory: ChangeTrajectoryManager;
}

/** Parameter context for resolving sparse active analyzers for a single file. */
interface ResolveAnalyzersContext {
    readonly scanner: Scanner;
    readonly input: DiffFileInput;
    readonly options: DualTrackOptions;
    readonly memory: ReviewMemoryManager;
    readonly archetype: ProjectArchetype | undefined;
    readonly acc: FastTrackAccumulator;
}

/** Parameter context for auditing a single file mutation in fast track. */
interface AuditFileInputContext {
    readonly scanner: Scanner;
    readonly input: DiffFileInput;
    readonly options: DualTrackOptions;
    readonly memory: ReviewMemoryManager;
    readonly trajectory: ChangeTrajectoryManager;
    readonly scorer: QualityScorer;
    readonly author: string;
    readonly archetype: ProjectArchetype | undefined;
    readonly acc: FastTrackAccumulator;
}

/** Parameter context for building fast track speculative verdict. */
interface FastTrackVerdictContext {
    readonly acc: FastTrackAccumulator;
    readonly inputs: DiffFileInput[];
    readonly scorer: QualityScorer;
    readonly memory: ReviewMemoryManager;
    readonly trajectory: ChangeTrajectoryManager;
    readonly fastTrackStartTimeMs: number;
}

/**
 * Refine active analyzers via ReviewMemory domain matching when clean.
 *
 * @param context - Parameter context for analyzer refinement.
 * @returns Narrowed active analyzer set.
 */
function computeRefinedActiveAnalyzers(context: RefineAnalyzersContext): Set<string> {
    const {
        existingRecord,
        isTainted,
        newContent,
        currentDomains,
        classification,
        defaultAnalyzers,
    } = context;
    if (!existingRecord || isTainted) return defaultAnalyzers;

    const matchResult = matchDomains(existingRecord, newContent, currentDomains);
    const isClean =
        matchResult.isByteEqual ||
        matchResult.isSemanticEqual ||
        matchResult.impactedDomains.length === 0;

    if (isClean) {
        if (classification.isDocOnly) {
            return new Set([ANALYZER_COMMENTS]);
        }
        if (classification.categories.has(DIFF_CATEGORY_LITERAL_ONLY)) {
            return new Set([ANALYZER_CONSTANTS, ANALYZER_SECRETS]);
        }
    }
    return defaultAnalyzers;
}

/**
 * Persist audit findings to ReviewMemory and record trajectory revision.
 *
 * @param context - Parameter context for memory and trajectory recording.
 */
function runMemoryAndTrajectoryRecording(context: MemoryTrajectoryContext): void {
    const {
        memory,
        trajectory,
        filePath,
        newContent,
        currentDomains,
        fileIssues,
        scoreBreakdown,
        author,
        activeAnalyzers,
        allAnomalies,
    } = context;

    const contentDigest = computeAstDigest(undefined, newContent);
    const hasErrorIssue = fileIssues.some((issue) => issue.severity === SEVERITY_ERROR);
    const revisionId = contentDigest.slice(0, REVISION_ID_LENGTH);

    memory.put({
        filePath,
        fileHash: contentDigest,
        astDigest: contentDigest,
        codeDomains: currentDomains,
        ruleHits: fileIssues.map((issue) => ({
            id: issue.id,
            analyzer: issue.analyzer,
            rule: issue.rule,
            severity: issue.severity,
            line: issue.location.start.line,
            message: issue.message,
        })),
        qualityScores: scoreBreakdown,
        lastAudited: Date.now(),
        revisionId,
        contextWindows: { imports: [], exports: [] },
        fixResults: [],
        status: hasErrorIssue ? STATUS_REJECTED : STATUS_APPROVED,
        activeAnalyzers,
        overallScore: scoreBreakdown.compositeScore,
    });

    const revision: FileRevision = {
        revisionId,
        timestamp: Date.now(),
        agentUid: author,
        fileHash: contentDigest,
        astDigest: contentDigest,
        qualityScore: scoreBreakdown,
        ruleHitIds: fileIssues.map((issue) => issue.id),
    };

    const comparison = trajectory.recordRevision(filePath, revision);
    if (comparison && comparison.anomalies.length > 0) {
        for (const anomaly of comparison.anomalies) {
            allAnomalies.push(anomaly.kind);
        }
    }
}

/**
 * Register mutated inputs and compute transitive affected files closure.
 */
async function computeAffectedFilesClosure(
    graph: ModuleDependencyGraph,
    inputs: DiffFileInput[],
    governor: LoadGovernor,
): Promise<string[]> {
    for (const input of inputs) {
        graph.registerFromContent(input.filePath, input.newContent);
    }

    const affectedFilesSet = new Set<string>();
    let yieldCounter = 0;

    for (const input of inputs) {
        const affected = graph.getAffectedFiles(input.filePath);
        for (let i = 0; i < affected.length; i++) {
            affectedFilesSet.add(affected[i]);
        }
        yieldCounter++;
        if (yieldCounter % AFFECTED_FILES_YIELD_BATCH === 0) {
            await governor.yieldEventLoop();
        }
    }
    return Array.from(affectedFilesSet);
}

/** Parameter context for cycle escalation auditing. */
interface CycleEscalationContext {
    readonly plan: DeepTrackExecutionPlan;
    readonly graph: ModuleDependencyGraph;
    readonly affectedFiles: string[];
    readonly deepIssues: Issue[];
    readonly escalationEvents: EscalationEvent[];
}

/**
 * Detect circular dependencies across changed roots and publish escalation events.
 */
async function auditCycleEscalations(context: CycleEscalationContext): Promise<string[][]> {
    const { plan, graph, affectedFiles, deepIssues, escalationEvents } = context;
    const { inputs, governor, channel, memory, trajectory } = plan;
    const modifiedPaths = inputs.map((input) => input.filePath);
    const cycles = await detectDependencyCyclesAsync(graph, modifiedPaths, governor);

    for (const cycle of cycles) {
        const cycleStr = cycle.join(CYCLE_CONNECTOR);
        const rootFile = inputs[0]?.filePath || cycle[0];
        const cycleIssue: Issue = {
            id: `${ANALYZER_DEPENDENCY_GRAPH}:${RULE_IMPORT_CYCLE}:${rootFile}${ROOT_LOCATION_SUFFIX}`,
            analyzer: ANALYZER_DEPENDENCY_GRAPH,
            rule: RULE_IMPORT_CYCLE,
            severity: SEVERITY_ERROR,
            message: `DeepTrack detected circular dependency: ${cycleStr}`,
            location: {
                file: rootFile,
                start: { line: DEFAULT_LOCATION_LINE, column: DEFAULT_LOCATION_COL },
                end: { line: DEFAULT_LOCATION_LINE, column: DEFAULT_LOCATION_COL },
            },
            detail: { cycle: cycleStr },
        };
        deepIssues.push(cycleIssue);

        const escalation: EscalationEvent = {
            type: EVENT_CIRCULAR_DEPENDENCY,
            sourceFile: rootFile,
            affectedFiles,
            issues: [cycleIssue],
            severity: SEVERITY_ERROR,
            message: `Circular dependency introduced: ${cycleStr}`,
            timestamp: Date.now(),
        };
        escalationEvents.push(escalation);
        await channel.publish(escalation, memory, trajectory);
    }
    return cycles;
}

/**
 * Execute DeepTrack background closure: dependency impact, cycles and layer checks.
 *
 * @param plan - Parameter context for deep track execution.
 * @returns Confirmed or escalated verdict.
 */
async function executeDeepTrack(plan: DeepTrackExecutionPlan): Promise<DeepTrackVerdict> {
    const { scanner, inputs, options, governor, channel, memory, trajectory } = plan;
    const deepTrackStartTimeMs = Date.now();
    const deepIssues: Issue[] = [];
    const escalationEvents: EscalationEvent[] = [];

    await governor.yieldEventLoop();

    const graph = options.graph || scanner.getDependencyGraph() || new ModuleDependencyGraph();
    const affectedFiles = await computeAffectedFilesClosure(graph, inputs, governor);
    const cycles = await auditCycleEscalations({
        plan,
        graph,
        affectedFiles,
        deepIssues,
        escalationEvents,
    });

    const archEnabled = scanner
        .getPlan()
        .some((planEntry) => planEntry.name === ANALYZER_ARCHITECTURE);
    if (archEnabled) {
        await checkArchitectureLayerBreaches({
            inputs,
            affectedFiles,
            deepIssues,
            escalationEvents,
            channel,
            memory,
            trajectory,
        });
    }

    const deepLatencyMs = Date.now() - deepTrackStartTimeMs;
    return {
        status: escalationEvents.length > 0 ? STATUS_ESCALATED : STATUS_CONFIRMED,
        deepIssues,
        affectedFiles,
        cycles,
        latencyMs: deepLatencyMs,
        escalationEvents,
    };
}

/**
 * Detect clean architecture boundary violations where core/domain imports outer layers.
 */
async function checkArchitectureLayerBreaches(
    context: ArchitectureBreachCheckContext,
): Promise<void> {
    const { inputs, affectedFiles, deepIssues, escalationEvents, channel, memory, trajectory } =
        context;

    for (const input of inputs) {
        if (!ARCH_CORE_DOMAIN_PATH_RE.test(input.filePath)) {
            continue;
        }
        if (!IMPORT_KEYWORD_QUICK_CHECK.test(input.newContent)) {
            continue;
        }
        const importsFromUpper = FORBIDDEN_UPPER_IMPORT_RE.exec(input.newContent);
        if (!importsFromUpper) {
            continue;
        }
        const archIssue: Issue = {
            id: `${ANALYZER_ARCHITECTURE}:${RULE_CLEAN_LAYER_VIOLATION}:${input.filePath}:1`,
            analyzer: ANALYZER_ARCHITECTURE,
            rule: RULE_CLEAN_LAYER_VIOLATION,
            severity: SEVERITY_ERROR,
            message: `Architecture boundary breach: core layer imports outer layer '${importsFromUpper[1]}'`,
            location: {
                file: input.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
            },
            detail: { forbiddenImport: importsFromUpper[1] },
        };
        deepIssues.push(archIssue);

        const escalation: EscalationEvent = {
            type: EVENT_ARCHITECTURE_BREACH,
            sourceFile: input.filePath,
            affectedFiles,
            issues: [archIssue],
            severity: SEVERITY_ERROR,
            message: `Architecture layer boundary breach in ${input.filePath}`,
            timestamp: Date.now(),
        };
        escalationEvents.push(escalation);
        await channel.publish(escalation, memory, trajectory);
    }
}

/** Mutable state container accumulating foreground speculative audit results. */
interface FastTrackAccumulator {
    fastIssues: Issue[];
    fastMetrics: FileMetric[];
    sparseRouting: Record<string, SparseRouteResult>;
    allAnomalies: string[];
    lastScoreBreakdown?: QualityScoreBreakdown;
}

/**
 * Classify file diff and resolve sparse active analyzers using review memory.
 */
function resolveActiveAnalyzersForFile(context: ResolveAnalyzersContext): {
    activeAnalyzers: Set<string>;
    currentDomains: ReturnType<typeof extractCodeDomains>;
} {
    const { scanner, input, options, memory, archetype, acc } = context;
    const { filePath, oldContent, newContent } = input;
    const classification = classifyDiff(oldContent, newContent, { filePath });
    const routing = routeDiffToAnalyzers(classification, {
        availableAnalyzers: scanner.getPlan().map((planEntry) => planEntry.name),
        forceFull: options.forceFull,
        archetype,
    });
    acc.sparseRouting[filePath] = routing;

    const currentDomains = extractCodeDomains(undefined, newContent);
    const existingRecord = memory.get(filePath);
    const isTainted =
        existingRecord?.status === STATUS_REJECTED ||
        existingRecord?.status === STATUS_CONTAMINATED;

    const activeAnalyzers = computeRefinedActiveAnalyzers({
        existingRecord,
        isTainted,
        newContent,
        currentDomains,
        classification,
        defaultAnalyzers: routing.activeAnalyzers,
    });
    return { activeAnalyzers, currentDomains };
}

/**
 * Audit a single file mutation in FastTrack: diff classification, sparse MoE routing,
 * localized scan execution, scoring and memory persistence.
 */
async function auditSingleFileInput(context: AuditFileInputContext): Promise<void> {
    const inputTarget = context.input;
    const { activeAnalyzers, currentDomains } = resolveActiveAnalyzersForFile(context);

    const fileResult = await context.scanner.runAnalyzers(
        inputTarget.filePath,
        inputTarget.newContent,
        undefined,
        activeAnalyzers,
    );

    context.acc.fastIssues.push(...fileResult.issues);
    if (fileResult.metric) {
        context.acc.fastMetrics.push(fileResult.metric);
    }

    const scoreBreakdown = context.scorer.evaluateFile(
        inputTarget.filePath,
        fileResult.issues,
        fileResult.metric,
    );
    context.acc.lastScoreBreakdown = scoreBreakdown;

    runMemoryAndTrajectoryRecording({
        memory: context.memory,
        trajectory: context.trajectory,
        filePath: inputTarget.filePath,
        newContent: inputTarget.newContent,
        currentDomains,
        fileIssues: fileResult.issues,
        scoreBreakdown,
        author: context.author,
        activeAnalyzers: Array.from(activeAnalyzers),
        allAnomalies: context.acc.allAnomalies,
    });
}

/**
 * Assemble fast-track speculative verdict, scoring breakdown and agent prompt.
 */
function buildFastTrackVerdict(context: FastTrackVerdictContext): FastTrackVerdict {
    const { acc, inputs, scorer, memory, trajectory, fastTrackStartTimeMs } = context;
    const firstPath = inputs[0]?.filePath || FALLBACK_FILE_PATH;
    const overallFastScore =
        acc.lastScoreBreakdown ||
        scorer.evaluateFile(firstPath, acc.fastIssues, acc.fastMetrics[0] || null);
    const fastLatencyMs = Date.now() - fastTrackStartTimeMs;

    const agentPrompt = SHARED_AGENT_CONSTRAINT_GENERATOR.generate(
        { filePath: firstPath },
        memory.get(inputs[0]?.filePath || ''),
        trajectory.getTrajectory(inputs[0]?.filePath || ''),
    );

    const hasErrors = acc.fastIssues.some((issue) => issue.severity === SEVERITY_ERROR);
    return {
        status: hasErrors ? VERDICT_SPECULATIVE_REJECTED : VERDICT_SPECULATIVE_PASSED,
        issues: acc.fastIssues,
        score: overallFastScore,
        latencyMs: fastLatencyMs,
        sparseRouting: acc.sparseRouting,
        agentGuidancePrompt: agentPrompt.renderedMarkdown,
        anomaliesDetected: acc.allAnomalies,
    };
}

/**
 * Run the asymmetric dual-track audit: a foreground pass produces a speculative verdict from
 * sparse, localized scans, then an async deep closure resolves the confirmed or escalated
 * verdict over the whole dependency graph.
 *
 * Concurrency: the deep track is an async closure that awaits a governor yield before heavy
 * work, so it never delays the fast result. Inputs are processed sequentially, but scanner-owned
 * review memory and trajectory are mutated in place, so callers must serialize concurrent calls
 * that share one scanner. Fast-track failures reject the returned promise; deep-track failures
 * reject only `deepPromise`.
 *
 * @param scanner - Scanner supplying analyzers, review memory, trajectory, scorer and graph.
 * @param inputs - File mutations to audit; an empty list still yields a fallback verdict.
 * @param options - Optional collaborators, author, dependency graph and routing overrides.
 * @returns Fast verdict plus the pending deep promise; the deep track is not awaited inline.
 * @throws Propagates fast-track scanner/analyzer errors; deep work rejects deepPromise instead.
 */
export async function executeDualTrack(
    scanner: Scanner,
    inputs: DiffFileInput[],
    options: DualTrackOptions = {},
): Promise<DualTrackExecution> {
    const fastTrackStartTimeMs = Date.now();
    const governor = options.loadGovernor || new LoadGovernor();
    const channel = options.escalationChannel || new EscalationChannel();
    const memory = scanner.getReviewMemory();
    const trajectory = scanner.getTrajectoryManager();
    const scorer = scanner.getQualityScorer();
    const author = options.author || DEFAULT_AGENT_AUTHOR;
    const archetype = options.archetype || scanner.getArchetype?.();

    // ----------------------------------------------------------------------
    // TRACK 1: FastTrack (Foreground Speculative Audit < 15ms)
    // ----------------------------------------------------------------------
    const acc: FastTrackAccumulator = {
        fastIssues: [],
        fastMetrics: [],
        sparseRouting: {},
        allAnomalies: [],
    };

    for (const input of inputs) {
        await auditSingleFileInput({
            scanner,
            input,
            options,
            memory,
            trajectory,
            scorer,
            author,
            archetype,
            acc,
        });
    }

    const fastVerdict = buildFastTrackVerdict({
        acc,
        inputs,
        scorer,
        memory,
        trajectory,
        fastTrackStartTimeMs,
    });

    // ----------------------------------------------------------------------
    // TRACK 2: DeepTrack (Background Asynchronous Deep Analysis)
    // ----------------------------------------------------------------------
    const deepPromise = executeDeepTrack({
        scanner,
        inputs,
        options,
        governor,
        channel,
        memory,
        trajectory,
    });

    return {
        fastVerdict,
        deepPromise,
    };
}
