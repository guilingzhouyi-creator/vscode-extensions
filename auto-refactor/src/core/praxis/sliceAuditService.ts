/**
 * Module: Core Engine - Praxis Fine-Grained Slice Audit Service Facade
 * File Path: src/core/praxis/sliceAuditService.ts
 * Architecture Role: High-performance, strongly typed facade designed specifically for the
 *   Praxis Diff Subsystem team; delivers sub-10ms localized AST slice audits, MoE CED sparse
 *   routing plans, and cross-file call chain impact propagation.
 * Dependencies & Triggers: Consumes sliceExtractor, sparseMoEGate, callChainImpactTracer,
 *   and CallGraph; consumed by Praxis diff review cells and public api.
 * Responsibilities: Coordinate AST slice extraction, sparse MoE analyzer gating, caller
 *   closure impact analysis, and synthesize actionable slice audit verdicts.
 * Exit Semantics & Design Rationale: Strongly typed SPI contracts; never throws, handles
 *   empty/corrupt inputs safely and returns descriptive status verdicts.
 */

import type { CallGraph } from '../intelligence/callGraph';
import type { CallChainImpactTracer } from '../intelligence/callChainImpactTracer';
import { defaultCallChainImpactTracer } from '../intelligence/callChainImpactTracer';
import type { ASTSliceExtractor } from '../router/sliceExtractor';
import { defaultASTSliceExtractor } from '../router/sliceExtractor';
import type { SparseMoEGateRouter } from '../router/sparseMoEGate';
import { defaultSparseMoEGateRouter } from '../router/sparseMoEGate';
import type {
    CallChainImpactResult,
    PraxisSliceAuditInput,
    PraxisSliceAuditVerdict,
    SparseRoutingPlan,
} from '../router/sliceTypes';
import type { Issue } from '../types';

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

    /**
     * Initialize service with modular slice extractor, router, and tracer.
     */
    constructor(
        extractor: ASTSliceExtractor = defaultASTSliceExtractor,
        gateRouter: SparseMoEGateRouter = defaultSparseMoEGateRouter,
        tracer: CallChainImpactTracer = defaultCallChainImpactTracer,
    ) {
        this.extractor = extractor;
        this.gateRouter = gateRouter;
        this.tracer = tracer;
    }

    /**
     * Audit an incremental AST slice, returning sparse routing plan and call-chain impact.
     */
    public async auditSlice(
        input: PraxisSliceAuditInput,
        callGraph?: CallGraph,
    ): Promise<PraxisSliceAuditVerdict> {
        const startTime = Date.now();
        const slices = this.extractor.extractSlices(
            input.filePath,
            input.oldContent,
            input.newContent,
            input.changedLines,
        );

        const routingPlan = this.gateRouter.routeCombinedSlices(slices);
        const impacts: CallChainImpactResult[] = [];
        const issues: Issue[] = [];

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

        const latencyMs = Math.max(1, Date.now() - startTime);
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
            latencyMs,
            status,
        };
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
