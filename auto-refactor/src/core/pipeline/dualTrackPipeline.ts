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
import type { Issue, FileMetric } from '../types';
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
import { ModuleDependencyGraph } from '../dependencyGraph';
import type { FileRevision } from '../trajectory/types';

/** Number of leading digest hex characters kept as the short revision identifier. */
const REVISION_ID_LENGTH = 16;

/** Severity value marking a blocking finding; rejects the file and raises escalations. */
const SEVERITY_ERROR = 'error';

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

    const targets =
        targetFiles && targetFiles.length > 0
            ? targetFiles.map((f) =>
                  path
                      .normalize(f)
                      .replace(/\\/g, '/')
                      .replace(/\.(ts|tsx|js|jsx|d\.ts)$/, ''),
              )
            : Array.from(edges.keys());

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

    // ----------------------------------------------------------------------
    // TRACK 1: FastTrack (Foreground Speculative Audit < 15ms)
    // ----------------------------------------------------------------------
    const fastIssues: Issue[] = [];
    const fastMetrics: FileMetric[] = [];
    const sparseRouting: Record<string, SparseRouteResult> = {};
    const allAnomalies: string[] = [];
    let lastScoreBreakdown: QualityScoreBreakdown | undefined;

    for (const input of inputs) {
        const { filePath, oldContent, newContent, changedLines } = input;

        // Step 1.1: Classify diff mutation semantics
        const classification = classifyDiff(oldContent, newContent, changedLines);

        // Step 1.2: Sparse Rule MoE Routing
        const routing = routeDiffToAnalyzers(classification, {
            availableAnalyzers: scanner.getPlan().map((p) => p.name),
            forceFull: options.forceFull,
        });
        sparseRouting[filePath] = routing;

        // Step 1.3: Review Memory domain fingerprinting & semantic reuse
        const currentDomains = extractCodeDomains(undefined, newContent);
        const existingRecord = memory.get(filePath);

        let activeAnalyzersToRun: Set<string> | undefined = routing.activeAnalyzers;

        if (existingRecord) {
            const matchResult = matchDomains(existingRecord, newContent, currentDomains);
            // If all domains matched and diff is purely literal/comment, keep only
            // minimal analyzers
            if (
                matchResult.isByteEqual ||
                matchResult.isSemanticEqual ||
                matchResult.impactedDomains.length === 0
            ) {
                if (classification.isDocOnly) {
                    activeAnalyzersToRun = new Set(['comments']);
                } else if (classification.categories.has('LITERAL_ONLY')) {
                    activeAnalyzersToRun = new Set(['constants', 'secrets']);
                }
            }
        }

        // Step 1.4: Execute localized sparse scan
        const fileResult = await scanner.runAnalyzers(
            filePath,
            newContent,
            undefined,
            activeAnalyzersToRun,
        );

        fastIssues.push(...fileResult.issues);
        if (fileResult.metric) {
            fastMetrics.push(fileResult.metric);
        }

        // Step 1.5: Compute speculative localized score
        const scoreBreakdown = scorer.evaluateFile(filePath, fileResult.issues, fileResult.metric);
        lastScoreBreakdown = scoreBreakdown;

        // Step 1.6: Update Review Memory with lightweight fingerprint
        const contentDigest = computeAstDigest(undefined, newContent);
        memory.put({
            filePath,
            fileHash: contentDigest,
            astDigest: contentDigest,
            codeDomains: currentDomains,
            ruleHits: fileResult.issues.map((i) => ({
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
            status: fileResult.issues.some((i) => i.severity === SEVERITY_ERROR)
                ? 'REJECTED'
                : 'APPROVED',
            activeAnalyzers: Array.from(activeAnalyzersToRun),
            overallScore: scoreBreakdown.compositeScore,
        });

        // Step 1.7: Change Trajectory recording and anomaly detection
        const revision: FileRevision = {
            revisionId: contentDigest.slice(0, REVISION_ID_LENGTH),
            timestamp: Date.now(),
            agentUid: author,
            fileHash: contentDigest,
            astDigest: contentDigest,
            qualityScore: scoreBreakdown,
            ruleHitIds: fileResult.issues.map((i) => i.id),
        };

        const comparison = trajectory.recordRevision(filePath, revision);
        if (comparison && comparison.anomalies.length > 0) {
            for (const a of comparison.anomalies) {
                allAnomalies.push(a.kind);
            }
        }
    }

    const overallFastScore =
        lastScoreBreakdown ||
        scorer.evaluateFile(inputs[0]?.filePath || 'unknown', fastIssues, fastMetrics[0] || null);
    const fastLatencyMs = Date.now() - t0;

    const agentGenerator = new AgentConstraintGenerator();
    const agentPrompt = agentGenerator.generate(
        { filePath: inputs[0]?.filePath || 'unknown' },
        memory.get(inputs[0]?.filePath || ''),
        trajectory.getTrajectory(inputs[0]?.filePath || ''),
    );

    const hasErrors = fastIssues.some((i) => i.severity === SEVERITY_ERROR);
    const fastVerdict: FastTrackVerdict = {
        status: hasErrors ? 'SPECULATIVE_REJECTED' : 'SPECULATIVE_PASSED',
        issues: fastIssues,
        score: overallFastScore,
        latencyMs: fastLatencyMs,
        sparseRouting,
        agentGuidancePrompt: agentPrompt.renderedMarkdown,
        anomaliesDetected: allAnomalies,
    };

    // ----------------------------------------------------------------------
    // TRACK 2: DeepTrack (Background Asynchronous Deep Analysis)
    // ----------------------------------------------------------------------
    const deepPromise = (async (): Promise<DeepTrackVerdict> => {
        const deepT0 = Date.now();
        const deepIssues: Issue[] = [];
        const escalationEvents: EscalationEvent[] = [];

        // Cooperative multitasking yield to ensure foreground thread finishes instant response
        await governor.yieldEventLoop();

        const graph = options.graph || scanner.getDependencyGraph() || new ModuleDependencyGraph();

        // Register modified contents into dependency graph
        for (const input of inputs) {
            graph.registerFromContent(input.filePath, input.newContent);
        }

        // Step 2.1: Reverse dependency transitive impact closure
        const affectedFilesSet = new Set<string>();
        for (const input of inputs) {
            const affected = graph.getAffectedFiles(input.filePath);
            for (const af of affected) {
                affectedFilesSet.add(af);
            }
        }
        const affectedFiles = Array.from(affectedFilesSet);

        // Step 2.2: Global Cycle Detection
        const modifiedPaths = inputs.map((i) => i.filePath);
        const cycles = detectDependencyCycles(graph, modifiedPaths);

        if (cycles.length > 0) {
            for (const cycle of cycles) {
                const cycleStr = cycle.join(' -> ');
                const rootFile = inputs[0]?.filePath || cycle[0];
                const cycleIssue: Issue = {
                    id: `dependency-graph:import-cycle:${rootFile}:1`,
                    analyzer: 'dependency-graph',
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
                    type: 'CIRCULAR_DEPENDENCY',
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
        }

        // Step 2.3: Architecture boundary checks across affected files
        const archEnabled = scanner.getPlan().some((p) => p.name === 'architecture');
        if (archEnabled) {
            for (const input of inputs) {
                // Quick rule: domain/core layers must not import ui/controller/frontend
                const norm = input.filePath.replace(/\\/g, '/').toLowerCase();
                if (norm.includes('/core/') || norm.includes('/domain/')) {
                    const importsFromUpper =
                        /(?:from|require\()\s*['"]([^'"]*(?:ui|view|frontend|cli|controllers)[^'"]*)['"]/i.exec(
                            input.newContent,
                        );
                    if (importsFromUpper) {
                        const archIssue: Issue = {
                            id: `architecture:layer-boundary:${input.filePath}:1`,
                            analyzer: 'architecture',
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
                            type: 'ARCHITECTURE_BREACH',
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
        const isEscalated = escalationEvents.length > 0;

        return {
            status: isEscalated ? 'ESCALATED' : 'CONFIRMED',
            deepIssues,
            affectedFiles,
            cycles,
            latencyMs: deepLatencyMs,
            escalationEvents,
        };
    })();

    return {
        fastVerdict,
        deepPromise,
    };
}
