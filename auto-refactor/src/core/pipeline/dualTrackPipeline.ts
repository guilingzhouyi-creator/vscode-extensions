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
 *   promise. Yielding the event loop before deep work keeps the speculative foreground
 *   response fast, matching the DeepSeek 4.1 asymmetric design.
 */

import * as path from 'path';
import type { Scanner } from '../analyzer';
import type { Issue, FileMetric, ProjectArchetype } from '../types';
import { SEVERITY_ERROR } from '../types';
import { classifyDiff } from '../router/diffClassifier';
import type { SparseRouteResult } from '../router/sparseRuleRouter';
import { routeDiffToAnalyzers } from '../router/sparseRuleRouter';
import type { EscalationEvent } from './escalationChannel';
import { EscalationChannel } from './escalationChannel';
import { LoadGovernor } from '../profiler/loadGovernor';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import { extractCodeDomains, computeAstDigest } from '../memory/domainFingerprint';
import { matchDomains } from '../memory/semanticMatcher';
import { AgentConstraintGenerator } from '../guidance/agentConstraintGenerator';
import { ModuleDependencyGraph } from '../dependency-graph';
import type { FileRevision } from '../trajectory/types';

/** Number of leading digest hex characters kept as the short revision identifier. */
const REVISION_ID_LENGTH = 16;

/**
 * Reusable singleton instance of AgentConstraintGenerator to eliminate
 * per-invocation heap churn.
 */
const SHARED_AGENT_CONSTRAINT_GENERATOR = new AgentConstraintGenerator();

/** Default loop iterations between event loop yields in DFS cycle detection. */
const DEFAULT_DFS_YIELD_INTERVAL = 50;

/** Batch size of affected files to inspect before yielding the event loop. */
const AFFECTED_FILES_YIELD_BATCH = 50;

/** Architecture rule analyzer identifier for deep layer checks. */
const ANALYZER_ARCHITECTURE = 'architecture';

/** Dependency graph analyzer identifier for circular dependency checks. */
const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';

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
    /** Optional pre-computed changed-line markers forwarded to the diff classifier. */
    changedLines?: string[];
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

/**
 * Normalize target files or fallback to all known forward edge keys.
 *
 * @param targetFiles - Optional roots supplied by caller.
 * @param edges - Dependency graph forward edges.
 * @returns Array of normalized root node IDs.
 */
function normalizeDependencyRoots(
    targetFiles: string[] | undefined,
    edges: Map<string, Set<string>>,
): string[] {
    if (targetFiles && targetFiles.length > 0) {
        return targetFiles.map((f) =>
            path
                .normalize(f)
                .replace(/\\/g, '/')
                .replace(/\.(ts|tsx|js|jsx|d\.ts)$/, ''),
        );
    }
    return Array.from(edges.keys());
}

/**
 * Detect dependency cycles with an iterative three-color (WHITE/GRAY/BLACK) DFS over the
 * graph's forward edges. An explicit frame stack removes the V8 call-stack limit, so deeply
 * nested dependency chains cannot overflow.
 *
 * @param graph - Dependency graph to inspect; only its current forward edges are read.
 * @param targetFiles - Optional roots; paths are normalized and extension-stripped before use.
 *   When omitted or empty, every known graph node is used as a root.
 * @returns Deduplicated cycle paths, each closed by repeating its entry node; empty when acyclic.
 */
export function detectDependencyCycles(
    graph: ModuleDependencyGraph,
    targetFiles?: string[],
): string[][] {
    const edges = graph.getForwardEdges();
    // 0 = unvisited (WHITE), 1 = visiting (GRAY), 2 = visited (BLACK)
    const WHITE = 0,
        GRAY = 1,
        BLACK = 2;
    const visited = new Map<string, number>();
    const cycles: string[][] = [];
    const seenCycleKeys = new Set<string>();

    const targets = normalizeDependencyRoots(targetFiles, edges);

    interface DfsFrame {
        node: string;
        neighbors: string[];
        idx: number;
    }

    for (const root of targets) {
        if ((visited.get(root) ?? WHITE) !== WHITE) continue;

        visited.set(root, GRAY);
        const activePath: string[] = [root];
        const frameStack: DfsFrame[] = [
            {
                node: root,
                neighbors: edges.get(root) ? Array.from(edges.get(root)!) : [],
                idx: 0,
            },
        ];

        while (frameStack.length > 0) {
            const top = frameStack[frameStack.length - 1];

            if (top.idx >= top.neighbors.length) {
                // All neighbors explored; retreat
                visited.set(top.node, BLACK);
                frameStack.pop();
                activePath.pop();
                continue;
            }

            const next = top.neighbors[top.idx++];
            const state = visited.get(next) ?? WHITE;

            if (state === GRAY) {
                // Cycle detected: next is on the current DFS active path
                const cycleStartIndex = activePath.indexOf(next);
                if (cycleStartIndex !== -1) {
                    const cyclePath = activePath.slice(cycleStartIndex).concat(next);
                    const key = cyclePath.slice().sort().join('->');
                    if (!seenCycleKeys.has(key)) {
                        seenCycleKeys.add(key);
                        cycles.push(cyclePath);
                    }
                }
            } else if (state === WHITE) {
                // Unvisited neighbor: advance forward
                visited.set(next, GRAY);
                activePath.push(next);
                frameStack.push({
                    node: next,
                    neighbors: edges.get(next) ? Array.from(edges.get(next)!) : [],
                    idx: 0,
                });
            }
            // If BLACK (state === 2), cross-edge to already completed component, ignore.
        }
    }

    return cycles;
}

/**
 * Asynchronous, time-sliced variant of {@link detectDependencyCycles}.
 * Periodically yields the event loop every `yieldInterval` frames to prevent event-loop
 * starvation on massive enterprise dependency graphs.
 *
 * @param graph - Dependency graph to inspect; only its current forward edges are read.
 * @param targetFiles - Optional roots; paths are normalized and extension-stripped before use.
 * @param governor - Optional LoadGovernor instance used for yielding; if omitted,
 *   yielding is skipped.
 * @param yieldInterval - Number of loop iterations between event loop yields (default: 50).
 * @returns Deduplicated cycle paths, each closed by repeating its entry node.
 */
export async function detectDependencyCyclesAsync(
    graph: ModuleDependencyGraph,
    targetFiles?: string[],
    governor?: LoadGovernor,
    yieldInterval = DEFAULT_DFS_YIELD_INTERVAL,
): Promise<string[][]> {
    const edges = graph.getForwardEdges();
    // 0 = unvisited (WHITE), 1 = visiting (GRAY), 2 = visited (BLACK)
    const WHITE = 0,
        GRAY = 1,
        BLACK = 2;
    const visited = new Map<string, number>();
    const cycles: string[][] = [];
    const seenCycleKeys = new Set<string>();

    const targets = normalizeDependencyRoots(targetFiles, edges);

    interface DfsFrame {
        node: string;
        neighbors: string[];
        idx: number;
    }

    let frameCount = 0;

    for (const root of targets) {
        if ((visited.get(root) ?? WHITE) !== WHITE) continue;

        visited.set(root, GRAY);
        const activePath: string[] = [root];
        const frameStack: DfsFrame[] = [
            {
                node: root,
                neighbors: edges.get(root) ? Array.from(edges.get(root)!) : [],
                idx: 0,
            },
        ];

        while (frameStack.length > 0) {
            frameCount++;
            if (governor && frameCount % yieldInterval === 0) {
                await governor.yieldEventLoop();
            }

            const top = frameStack[frameStack.length - 1];

            if (top.idx >= top.neighbors.length) {
                // All neighbors explored; retreat
                visited.set(top.node, BLACK);
                frameStack.pop();
                activePath.pop();
                continue;
            }

            const next = top.neighbors[top.idx++];
            const state = visited.get(next) ?? WHITE;

            if (state === GRAY) {
                // Cycle detected: next is on the current DFS active path
                const cycleStartIndex = activePath.indexOf(next);
                if (cycleStartIndex !== -1) {
                    const cyclePath = activePath.slice(cycleStartIndex).concat(next);
                    const key = cyclePath.slice().sort().join('->');
                    if (!seenCycleKeys.has(key)) {
                        seenCycleKeys.add(key);
                        cycles.push(cyclePath);
                    }
                }
            } else if (state === WHITE) {
                // Unvisited neighbor: advance forward
                visited.set(next, GRAY);
                activePath.push(next);
                frameStack.push({
                    node: next,
                    neighbors: edges.get(next) ? Array.from(edges.get(next)!) : [],
                    idx: 0,
                });
            }
            // If BLACK (state === 2), cross-edge to already completed component, ignore.
        }
    }

    return cycles;
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
/**
 * Refine active analyzers via ReviewMemory domain matching when clean.
 *
 * @param existingRecord - Cached review record for the file.
 * @param isTainted - True if file was previously contaminated/rejected by DeepTrack.
 * @param newContent - New file content string.
 * @param currentDomains - Extracted code domains from the new content.
 * @param classification - Diff semantic classification.
 * @param defaultAnalyzers - Default routed analyzers from MoE router.
 * @returns Narrowed active analyzer set.
 */
function refineActiveAnalyzers(
    existingRecord: import('../memory/types').ReviewMemoryRecord | undefined,
    isTainted: boolean,
    newContent: string,
    currentDomains: import('../memory/types').CodeDomainFingerprint[],
    classification: import('../router/diffClassifier').DiffClassificationResult,
    defaultAnalyzers: Set<string>,
): Set<string> {
    if (!existingRecord || isTainted) return defaultAnalyzers;

    const matchResult = matchDomains(existingRecord, newContent, currentDomains);
    const isClean =
        matchResult.isByteEqual ||
        matchResult.isSemanticEqual ||
        matchResult.impactedDomains.length === 0;

    if (isClean) {
        if (classification.isDocOnly) {
            return new Set(['comments']);
        }
        if (classification.categories.has('LITERAL_ONLY')) {
            return new Set(['constants', 'secrets']);
        }
    }
    return defaultAnalyzers;
}

/**
 * Persist audit findings to ReviewMemory and record trajectory revision.
 *
 * @param memory - Review memory manager.
 * @param trajectory - Change trajectory manager.
 * @param filePath - Path to modified file.
 * @param newContent - Current file content.
 * @param currentDomains - Code domain fingerprints.
 * @param fileIssues - Localized issues found in this file.
 * @param scoreBreakdown - Transparent quality breakdown.
 * @param author - Agent author UID.
 * @param activeAnalyzers - Analyzers activated for this file.
 * @param allAnomalies - Mutable array receiving detected anomaly kinds.
 */
function recordMemoryAndTrajectory(
    memory: import('../memory/reviewMemory').ReviewMemoryManager,
    trajectory: import('../trajectory/changeTrajectory').ChangeTrajectoryManager,
    filePath: string,
    newContent: string,
    currentDomains: import('../memory/types').CodeDomainFingerprint[],
    fileIssues: Issue[],
    scoreBreakdown: QualityScoreBreakdown,
    author: string,
    activeAnalyzers: string[],
    allAnomalies: string[],
): void {
    const contentDigest = computeAstDigest(undefined, newContent);
    memory.put({
        filePath,
        fileHash: contentDigest,
        astDigest: contentDigest,
        codeDomains: currentDomains,
        ruleHits: fileIssues.map((i) => ({
            id: i.id,
            analyzer: i.analyzer,
            rule: i.rule,
            severity: i.severity,
            line: i.location.start.line,
            message: i.message,
        })),
        qualityScores: scoreBreakdown,
        lastAudited: Date.now(),
        revisionId: contentDigest.slice(0, REVISION_ID_LENGTH),
        contextWindows: { imports: [], exports: [] },
        fixResults: [],
        status: fileIssues.some((i) => i.severity === SEVERITY_ERROR) ? 'REJECTED' : 'APPROVED',
        activeAnalyzers,
        overallScore: scoreBreakdown.compositeScore,
    });

    const revision: FileRevision = {
        revisionId: contentDigest.slice(0, REVISION_ID_LENGTH),
        timestamp: Date.now(),
        agentUid: author,
        fileHash: contentDigest,
        astDigest: contentDigest,
        qualityScore: scoreBreakdown,
        ruleHitIds: fileIssues.map((i) => i.id),
    };

    const comparison = trajectory.recordRevision(filePath, revision);
    if (comparison && comparison.anomalies.length > 0) {
        for (const a of comparison.anomalies) {
            allAnomalies.push(a.kind);
        }
    }
}

/**
 * Execute DeepTrack background closure: dependency impact, cycles and layer checks.
 *
 * @param scanner - Scanner supplying dependency graph and plan.
 * @param inputs - Mutated file inputs.
 * @param options - Collaborators and graph overrides.
 * @param governor - Cooperative load governor.
 * @param channel - Escalation broadcast channel.
 * @param memory - Review memory manager for taint propagation.
 * @param trajectory - Trajectory manager for regression recording.
 * @returns Confirmed or escalated verdict.
 */
async function executeDeepTrack(
    scanner: Scanner,
    inputs: DiffFileInput[],
    options: DualTrackOptions,
    governor: LoadGovernor,
    channel: EscalationChannel,
    memory: import('../memory/reviewMemory').ReviewMemoryManager,
    trajectory: import('../trajectory/changeTrajectory').ChangeTrajectoryManager,
): Promise<DeepTrackVerdict> {
    const deepT0 = Date.now();
    const deepIssues: Issue[] = [];
    const escalationEvents: EscalationEvent[] = [];

    await governor.yieldEventLoop();

    const graph = options.graph || scanner.getDependencyGraph() || new ModuleDependencyGraph();

    for (const input of inputs) {
        graph.registerFromContent(input.filePath, input.newContent);
    }

    const affectedFilesSet = new Set<string>();
    let yieldCounter = 0;

    for (const input of inputs) {
        const affected = graph.getAffectedFiles(input.filePath);
        for (const af of affected) affectedFilesSet.add(af);
        yieldCounter++;
        if (yieldCounter % AFFECTED_FILES_YIELD_BATCH === 0) {
            await governor.yieldEventLoop();
        }
    }
    const affectedFiles = Array.from(affectedFilesSet);

    const modifiedPaths = inputs.map((i) => i.filePath);
    const cycles = await detectDependencyCyclesAsync(graph, modifiedPaths, governor);

    for (const cycle of cycles) {
        const cycleStr = cycle.join(' -> ');
        const rootFile = inputs[0]?.filePath || cycle[0];
        const cycleIssue: Issue = {
            id: `${ANALYZER_DEPENDENCY_GRAPH}:${RULE_IMPORT_CYCLE}:${rootFile}:1`,
            analyzer: ANALYZER_DEPENDENCY_GRAPH,
            rule: 'import-cycle',
            severity: SEVERITY_ERROR,
            message: `DeepTrack detected circular dependency: ${cycleStr}`,
            location: {
                file: rootFile,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 1 },
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

    const archEnabled = scanner.getPlan().some((p) => p.name === ANALYZER_ARCHITECTURE);
    if (archEnabled) {
        for (const input of inputs) {
            const norm = input.filePath.replace(/\\/g, '/').toLowerCase();
            if (norm.includes('/core/') || norm.includes('/domain/')) {
                const importsFromUpper =
                    /(?:from|require\()\s*['"]([^'"]*(?:ui|view|frontend|cli|controllers)[^'"]*)['"]/i.exec(
                        input.newContent,
                    );
                if (importsFromUpper) {
                    const archIssue: Issue = {
                        id: `${ANALYZER_ARCHITECTURE}:${RULE_CLEAN_LAYER_VIOLATION}:${input.filePath}:1`,
                        analyzer: ANALYZER_ARCHITECTURE,
                        rule: 'clean-layer-violation',
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
        }
    }

    const deepLatencyMs = Date.now() - deepT0;
    return {
        status: escalationEvents.length > 0 ? STATUS_ESCALATED : STATUS_CONFIRMED,
        deepIssues,
        affectedFiles,
        cycles,
        latencyMs: deepLatencyMs,
        escalationEvents,
    };
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
 * Audit a single file mutation in FastTrack: diff classification, sparse MoE routing,
 * localized scan execution, scoring and memory persistence.
 */
async function auditSingleFileInput(
    scanner: Scanner,
    input: DiffFileInput,
    options: DualTrackOptions,
    memory: import('../memory/reviewMemory').ReviewMemoryManager,
    trajectory: import('../trajectory/changeTrajectory').ChangeTrajectoryManager,
    scorer: import('../scoring/qualityScorer').QualityScorer,
    author: string,
    archetype: ProjectArchetype | undefined,
    acc: FastTrackAccumulator,
): Promise<void> {
    const { filePath, oldContent, newContent, changedLines } = input;

    // Step 1.1: Classify diff mutation semantics
    const classification = classifyDiff(oldContent, newContent, changedLines, filePath);

    // Step 1.2: Sparse Rule MoE Routing
    const routing = routeDiffToAnalyzers(classification, {
        availableAnalyzers: scanner.getPlan().map((p) => p.name),
        forceFull: options.forceFull,
        archetype,
    });
    acc.sparseRouting[filePath] = routing;

    // Step 1.3: Review Memory domain fingerprinting & semantic reuse
    const currentDomains = extractCodeDomains(undefined, newContent);
    const existingRecord = memory.get(filePath);
    const isTainted =
        existingRecord?.status === 'REJECTED' || existingRecord?.status === 'CONTAMINATED';

    const activeAnalyzersToRun = refineActiveAnalyzers(
        existingRecord,
        isTainted,
        newContent,
        currentDomains,
        classification,
        routing.activeAnalyzers,
    );

    // Step 1.4: Execute localized sparse scan
    const fileResult = await scanner.runAnalyzers(
        filePath,
        newContent,
        undefined,
        activeAnalyzersToRun,
    );

    acc.fastIssues.push(...fileResult.issues);
    if (fileResult.metric) {
        acc.fastMetrics.push(fileResult.metric);
    }

    // Step 1.5: Compute speculative localized score
    const scoreBreakdown = scorer.evaluateFile(filePath, fileResult.issues, fileResult.metric);
    acc.lastScoreBreakdown = scoreBreakdown;

    // Step 1.6 & 1.7: Update Review Memory and Trajectory
    recordMemoryAndTrajectory(
        memory,
        trajectory,
        filePath,
        newContent,
        currentDomains,
        fileResult.issues,
        scoreBreakdown,
        author,
        Array.from(activeAnalyzersToRun),
        acc.allAnomalies,
    );
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
    const t0 = Date.now();
    const governor = options.loadGovernor || new LoadGovernor();
    const channel = options.escalationChannel || new EscalationChannel();
    const memory = scanner.getReviewMemory();
    const trajectory = scanner.getTrajectoryManager();
    const scorer = scanner.getQualityScorer();
    const author = options.author || 'agent-worker';
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
        await auditSingleFileInput(
            scanner,
            input,
            options,
            memory,
            trajectory,
            scorer,
            author,
            archetype,
            acc,
        );
    }

    const overallFastScore =
        acc.lastScoreBreakdown ||
        scorer.evaluateFile(
            inputs[0]?.filePath || 'unknown',
            acc.fastIssues,
            acc.fastMetrics[0] || null,
        );
    const fastLatencyMs = Date.now() - t0;

    const agentPrompt = SHARED_AGENT_CONSTRAINT_GENERATOR.generate(
        { filePath: inputs[0]?.filePath || 'unknown' },
        memory.get(inputs[0]?.filePath || ''),
        trajectory.getTrajectory(inputs[0]?.filePath || ''),
    );

    const hasErrors = acc.fastIssues.some((i) => i.severity === SEVERITY_ERROR);
    const fastVerdict: FastTrackVerdict = {
        status: hasErrors ? 'SPECULATIVE_REJECTED' : 'SPECULATIVE_PASSED',
        issues: acc.fastIssues,
        score: overallFastScore,
        latencyMs: fastLatencyMs,
        sparseRouting: acc.sparseRouting,
        agentGuidancePrompt: agentPrompt.renderedMarkdown,
        anomaliesDetected: acc.allAnomalies,
    };

    // ----------------------------------------------------------------------
    // TRACK 2: DeepTrack (Background Asynchronous Deep Analysis)
    // ----------------------------------------------------------------------
    const deepPromise = executeDeepTrack(
        scanner,
        inputs,
        options,
        governor,
        channel,
        memory,
        trajectory,
    );

    return {
        fastVerdict,
        deepPromise,
    };
}
