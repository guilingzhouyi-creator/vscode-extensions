/**
 * Module: Core Engine - Praxis Fine-Grained Slice Audit Service Facade
 * File Path: src/core/praxis/sliceAuditService.ts
 * Architecture Role: High-performance, strongly typed facade designed specifically for the
 *   Praxis Diff Subsystem team; delivers sub-10ms localized AST slice audits, MoE CED sparse
 *   routing plans, cross-file call chain impact propagation, and the sparse reference replay
 *   window that bounds each audit instead of regenerating the whole file.
 * Dependencies & Triggers: Consumes sliceExtractor, sparseMoEGate, callChainImpactTracer, the
 *   sparse reference replay planner and CallGraph; consumed by Praxis diff review cells and the
 *   public api.
 * Responsibilities: Coordinate AST slice extraction, sparse MoE analyzer gating, caller
 *   closure impact analysis, sparse reference window planning, and synthesize actionable slice
 *   verdicts.
 * Exit Semantics & Design Rationale: Strongly typed SPI contracts; never throws, handles
 *   empty/corrupt inputs safely and returns descriptive status verdicts. The window summary is
 *   always populated when contents are supplied, so a reviewer can tell a bounded local audit from
 *   a whole-file fallback without re-deriving the diff.
 */

import type { CallGraph } from '../intelligence/callGraph';
import type { CallChainImpactTracer } from '../intelligence/callChainImpactTracer';
import { defaultCallChainImpactTracer } from '../intelligence/callChainImpactTracer';
import { createCallGraphReferenceResolver } from '../intelligence/sparse-reference-resolver';
import type { ASTSliceExtractor } from '../router/sliceExtractor';
import { defaultASTSliceExtractor } from '../router/sliceExtractor';
import type { SparseMoEGateRouter } from '../router/sparseMoEGate';
import { defaultSparseMoEGateRouter } from '../router/sparseMoEGate';
import type {
    SparseReferenceReplayManager,
    SparseReplayWindow,
} from '../ast/sparse-reference-replay';
import { defaultSparseReferenceReplayManager } from '../ast/sparse-reference-replay';
import type {
    CallChainImpactResult,
    PraxisSliceAuditInput,
    PraxisSliceAuditVerdict,
    SliceReplayWindowSummary,
    SparseRoutingPlan,
} from '../router/sliceTypes';
import type { Issue } from '../types';
import type { CompactAgentPrompt } from '../guidance/agentConstraintGenerator';
import { formatCompactAgentPrompt } from '../guidance/agentConstraintGenerator';

const NANOS_PER_MICRO = 1000n;
const MICROS_PER_MILLI = 1000;
const SCOPE_FULL_FILE = 'full';

/**
 * Fold discrete 1-based changed line numbers into a 1-based [min, max] boundary range.
 *
 * @param changedLines - Array of modified line numbers.
 * @returns [firstLine, lastLine] tuple, or undefined when changedLines is empty or omitted.
 */
function foldChangedLineBounds(changedLines?: readonly number[]): readonly [number, number] | undefined {
    if (!changedLines || changedLines.length === 0) return undefined;
    let min = changedLines[0];
    let max = changedLines[0];
    for (let i = 1; i < changedLines.length; i++) {
        const line = changedLines[i];
        if (line < min) min = line;
        if (line > max) max = line;
    }
    return [min, max];
}

/**
 * Project a sparse reference window into the serializable verdict shape.
 *
 * @param window - Planner window for the audited file.
 * @returns Window summary carrying only transport-safe facts.
 */
function summarizeWindow(window: SparseReplayWindow): SliceReplayWindowSummary {
    return {
        startLine: window.startLine,
        endLine: window.endLine,
        isBounded: window.isBounded,
        isSparseBridged: window.isSparseBridged,
        sparseReferenceCount: window.sparseReferences.length,
        sparseReferences: window.sparseReferences.length > 0 ? window.sparseReferences : undefined,
        reason: window.reason,
    };
}

/**
 * Interface contract provided to Praxis team for fine-grained AST slice audit governance.
 */
export interface IPraxisSliceAuditService {
    /**
     * Audit an incremental AST slice, returning sparse routing plan and call-chain impact.
     *
     * @param input - Diff slice code and line boundaries.
     * @param callGraph - Optional pre-warmed repository CallGraph.
     * @returns Detailed slice audit verdict with latency measurement.
     */
    auditSlice(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): Promise<PraxisSliceAuditVerdict>;

    /**
     * Audit an incremental AST slice and synthesize a Compact Agent Prompt Protocol (CAPP) verdict.
     *
     * @param input - Diff slice code and line boundaries.
     * @param callGraph - Optional pre-warmed repository CallGraph.
     * @returns CompactAgentPrompt for direct injection into agent context windows.
     */
    auditAgentSlice(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): Promise<CompactAgentPrompt>;

    /**
     * Trace the caller blast radius for a symbol without executing full review.
     *
     * @param file - File declaring the symbol.
     * @param symbol - Symbol name.
     * @param hasBreakingMutation - Whether the signature mutated breakably.
     * @param callGraph - In-memory CallGraph instance.
     * @returns CallChainImpactResult.
     */
    traceCallImpact(
        file: string,
        symbol: string,
        hasBreakingMutation?: boolean,
        callGraph?: CallGraph,
    ): CallChainImpactResult;

    /**
     * Compute the Sparse MoE routing plan without running analyzers.
     *
     * @param file - File path.
     * @param oldCode - Content before change.
     * @param newCode - Content after change.
     * @param changedLines - Optional changed line numbers.
     * @returns SparseRoutingPlan with active and bypassed analyzer subsets.
     */
    getRoutingPlan(
        file: string,
        oldCode: string,
        newCode: string,
        changedLines?: number[],
    ): SparseRoutingPlan;
}

/**
 * Implementation of the Praxis fine-grained slice audit governance facade.
 */
export class PraxisSliceAuditService implements IPraxisSliceAuditService {
    private readonly extractor: ASTSliceExtractor;

    private readonly gateRouter: SparseMoEGateRouter;

    private readonly tracer: CallChainImpactTracer;

    private readonly replayPlanner: SparseReferenceReplayManager;

    /**
     * Initialize service with modular slice extractor, router, tracer and replay planner.
     */
    constructor(
        extractor: ASTSliceExtractor = defaultASTSliceExtractor,
        gateRouter: SparseMoEGateRouter = defaultSparseMoEGateRouter,
        tracer: CallChainImpactTracer = defaultCallChainImpactTracer,
        replayPlanner: SparseReferenceReplayManager = defaultSparseReferenceReplayManager,
    ) {
        this.extractor = extractor;
        this.gateRouter = gateRouter;
        this.tracer = tracer;
        this.replayPlanner = replayPlanner;
    }

    /**
     * Audit an incremental AST slice, returning sparse routing plan and call-chain impact.
     */
    public async auditSlice(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): Promise<PraxisSliceAuditVerdict> {
        const startHr = process.hrtime.bigint();
        const slices = this.extractor.extractSlices(
            input.filePath,
            input.oldContent,
            input.newContent,
            input.changedLines,
        );

        const routingPlan = this.gateRouter.routeCombinedSlices(slices);
        const impacts: CallChainImpactResult[] = [];
        const issues: Issue[] = [];
        const replayWindow = this.planReplayWindow(input, callGraph);

        const maxDepth = input.maxCallDepth ?? 3;
        for (const slice of slices) {
            if (slice.symbolName && slice.symbolName !== 'top-level') {
                const impact = this.tracer.traceSliceImpact(slice, callGraph, maxDepth);
                impacts.push(impact);
                for (const issue of impact.issues) {
                    issues.push(issue);
                }
            }
        }

        const latencyUs = Number((process.hrtime.bigint() - startHr) / NANOS_PER_MICRO);
        const latencyMs = Number(latencyUs) / MICROS_PER_MILLI;
        const hasErrors = issues.some((i) => i.severity === 'error');
        const hasWarnings = issues.some((i) => i.severity === 'warning');
        const status: 'PASS' | 'WARN' | 'BLOCK' = hasErrors
            ? 'BLOCK'
            : hasWarnings
                ? 'WARN'
                : 'PASS';

        return {
            filePath: input.filePath,
            slices,
            routingPlan,
            impacts,
            issues,
            replayWindow,
            latencyUs,
            latencyMs,
            status,
        };
    }

    /**
     * Plan the sparse reference replay window for this audit.
     *
     * A signature mutation no longer forces a whole-file statement: the planner bounds the window
     * to the mutated declaration and attaches the external call sites it could reach, so the
     * verdict can name the blast radius instead of re-reading every file.
     *
     * @param input - Slice audit input carrying contents and changed lines.
     * @param callGraph - Call graph used to resolve sparse references, when available.
     * @returns Serializable window summary for the verdict.
     */
    private planReplayWindow(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): SliceReplayWindowSummary {
        const lineBounds = foldChangedLineBounds(input.changedLines);
        const window = this.replayPlanner.computeSparseReplayWindow({
            filePath: input.filePath,
            oldContent: input.oldContent,
            newContent: input.newContent,
            changedLines: lineBounds,
            resolveReferences: callGraph ? createCallGraphReferenceResolver(callGraph) : undefined,
        });
        return summarizeWindow(window);
    }

    /**
     * Audit incremental slice and format as CAPP prompt.
     */
    public async auditAgentSlice(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): Promise<CompactAgentPrompt> {
        const verdict = await this.auditSlice(input, callGraph);
        const linesDesc =
            input.changedLines.length > 0 ? `L${input.changedLines.join(',')}` : SCOPE_FULL_FILE;
        const target = `${input.filePath}#${linesDesc}`;
        return formatCompactAgentPrompt(target, verdict.issues);
    }

    /**
     * Trace caller blast radius for a symbol.
     */
    public traceCallImpact(
        file: string,
        symbol: string,
        hasBreakingMutation = false,
        callGraph?: CallGraph,
    ): CallChainImpactResult {
        return this.tracer.traceSymbolImpact(symbol, file, hasBreakingMutation, callGraph);
    }

    /**
     * Compute sparse routing plan without running analyzers.
     */
    public getRoutingPlan(
        file: string,
        oldCode: string,
        newCode: string,
        changedLines?: number[],
    ): SparseRoutingPlan {
        const slices = this.extractor.extractSlices(file, oldCode, newCode, changedLines);
        return this.gateRouter.routeCombinedSlices(slices);
    }
}

/** Global default singleton instance of PraxisSliceAuditService. */
export const defaultPraxisSliceAuditService = new PraxisSliceAuditService();

/**
 * Factory creating a fresh instance of IPraxisSliceAuditService.
 *
 * @returns Configured IPraxisSliceAuditService instance.
 */
export function createPraxisSliceAuditService(): IPraxisSliceAuditService {
    return new PraxisSliceAuditService();
}
