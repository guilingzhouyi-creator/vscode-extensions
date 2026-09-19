/**
 * Module: Core Engine — Praxis Diff Governance Subsystem Facade
 * File Path: src/core/praxis/diffGovernance.ts
 * Architecture Role: Primary service interface and facade for the Praxis Diff review
 *   and governance subsystem, orchestrating semantic enrichment, Layer 1 rule evaluation,
 *   threshold verification, and merge gate decisions.
 * Dependencies & Triggers: Consumes contracts and defaults from ./index; consumes SemanticGraph
 *   and defaultPyramidEvaluator; consumed by external Praxis development teams.
 * Responsibilities: Provide interface-driven diff inspection, AST/LSP context enrichment,
 *   backward dependency impact calculation, and unified issue aggregation.
 * Exit Semantics & Design Rationale: Interface-first design ensures long-term API stability
 *   for Praxis cells without breaking changes or tight coupling to internal AST implementations.
 */

import type { DiffInput, Issue } from '../types';
import type {
    PraxisCardContext,
    PraxisEnrichedContext,
    PraxisPluginHooks,
    PraxisVerdict,
    ReviewDiffHunk,
} from './contracts';
import {
    DefaultPraxisAttributionResolver,
    DefaultPraxisHumanFaceStorage,
    DefaultPraxisRollbackGatekeeper,
    DefaultPraxisThresholdPolicy,
} from './defaults';
import { SemanticPraxisContextEnricher } from './semanticEnricher';
import { SemanticGraph } from '../semantic/semanticGraph';
import { defaultPyramidEvaluator } from '../rules/pyramid/layer1Evaluator';
import { defaultPerformanceEvaluator } from '../rules/pyramid/performanceRules';
import { defaultDataArchitectureEvaluator } from '../intelligence/dataArchitecture';
import { defaultTestModernityEvaluator, isTestFilePath } from '../intelligence/testModernity';
import { defaultSemanticAdapterRegistry } from '../semantic/adapters/registry';
import { defaultMetaArchitectureEvaluator, SemanticArchitectureGraph } from '../architecture';
import { evaluatePatchQuality, type PatchQualityResult } from '../scoring/patchQuality';

/**
 * Options configuring the Praxis diff governance execution.
 */
export interface PraxisGovernanceOptions<TMeta = Record<string, unknown>> {
    /** Optional custom Praxis SPI plugin hooks */
    hooks?: PraxisPluginHooks<TMeta>;
    /** Pre-built or incremental SemanticGraph instance */
    graph?: SemanticGraph;
    /** Dynamic task card context */
    cardContext?: PraxisCardContext<TMeta>;
    /** Whether to run deep algorithmic and loop performance audit (default: true) */
    enablePerformanceAudit?: boolean;
    /** Whether to run data architecture and query governance audit (default: true) */
    enableDataArchitectureAudit?: boolean;
    /** Whether to run test modernity and contract coverage audit (default: true) */
    enableTestModernityAudit?: boolean;
    /** Whether to run semantic architecture & meta-architecture audit (default: true) */
    enableArchitectureAudit?: boolean;
    /** Whether to evaluate patch quality and eight-pillar quantification (default: true) */
    enablePatchQuality?: boolean;
    /** Whether diff is targeting engine self-repo */
    isSelfRepo?: boolean;
    /** Minimum EMTD threshold (default: 100) */
    minTestEmtd?: number;
    /** Minimum CBCR threshold (default: 0.70) */
    minTestCbcr?: number;
    /** Whether test integrity issues (e.g. TST-TAU-001) are fatal errors (default: true) */
    testIntegrityFatal?: boolean;
}

/**
 * Composite governance report delivered to Praxis review cells.
 */
export interface PraxisDiffGovernanceResult {
    /** Rich review diff hunks with AST and impact closure metadata */
    hunks: ReviewDiffHunk[];
    /** Quality, architecture, and security issues detected */
    issues: Issue[];
    /** Consolidated merge gate verdict */
    verdict: PraxisVerdict;
    /** Aggregated backward impact summary across all changed symbols */
    impactSummary: {
        totalImpactedFiles: number;
        affectedFiles: string[];
    };
    /** Patch quality evaluation score and eight-pillar breakdown */
    patchQuality?: PatchQualityResult;
    /** Delta score resulting from this diff */
    deltaScore?: number;
}

/**
 * Formal service interface exposed to the Praxis development team.
 */
export interface IPraxisDiffGovernanceService {
    /**
     * Conducts a comprehensive semantic-aware diff review for a given file change.
     */
    reviewDiff(
        input: DiffInput,
        options?: PraxisGovernanceOptions,
    ): Promise<PraxisDiffGovernanceResult>;

    /**
     * Enriches a series of raw diff hunks with semantic graph context and impact closures.
     */
    enrichHunks(filePath: string, hunks: ReviewDiffHunk[], graph?: SemanticGraph): ReviewDiffHunk[];

    /**
     * Creates a composite bundle of standard Praxis SPI hooks with SemanticGraph integration.
     */
    createHooks(graph?: SemanticGraph): PraxisPluginHooks;
}

/**
 * High-performance, interface-driven implementation of the Praxis Diff Governance Subsystem.
 */
export class PraxisDiffGovernanceService implements IPraxisDiffGovernanceService {
    /**
     * Creates standard Praxis hooks with semantic graph enrichment enabled.
     */
    public createHooks(graph?: SemanticGraph): PraxisPluginHooks {
        return {
            attributionResolver: new DefaultPraxisAttributionResolver(),
            contextEnricher: new SemanticPraxisContextEnricher(graph),
            thresholdPolicy: new DefaultPraxisThresholdPolicy(),
            humanStorage: new DefaultPraxisHumanFaceStorage(),
            rollbackGatekeeper: new DefaultPraxisRollbackGatekeeper(),
        };
    }

    /**
     * Enriches diff hunks using either the provided or newly populated graph.
     */
    public enrichHunks(
        filePath: string,
        hunks: ReviewDiffHunk[],
        graph?: SemanticGraph,
    ): ReviewDiffHunk[] {
        const enricher = new SemanticPraxisContextEnricher(graph);
        for (const hunk of hunks) {
            const context: PraxisEnrichedContext = enricher.enrichHunk(filePath, hunk);
            hunk.astContext = {
                enclosingSymbol: context.enclosingSymbol,
                symbolKind: context.symbolKind,
                scopeRange: context.scopeRange,
                impactFiles: context.impactFiles,
            };
        }
        return hunks;
    }

    /**
     * Executes the end-to-end diff governance review.
     */
    public async reviewDiff(
        input: DiffInput,
        options: PraxisGovernanceOptions = {},
    ): Promise<PraxisDiffGovernanceResult> {
        const filePath = input.filePath;
        const newContent = input.newContent;
        const graph = options.graph || new SemanticGraph();

        if (newContent) {
            defaultSemanticAdapterRegistry.extractFileToGraph(filePath, newContent, graph);
        }

        const issues: Issue[] = [
            ...defaultPyramidEvaluator.evaluateAllLayer1(graph, { currentFilePath: filePath }),
            ...this.runPerformanceAudit(filePath, newContent, options),
            ...this.runDataArchAudit(filePath, newContent, graph, options),
            ...this.runTestModernityAudit(filePath, newContent, options),
            ...this.runArchitectureAudit(graph, options),
        ];

        const patchQuality = this.runPatchQualityAudit(
            filePath,
            input.oldContent ?? '',
            newContent,
            issues,
            options,
        );

        if (patchQuality?.gamingViolations?.length) {
            issues.push(...patchQuality.gamingViolations);
        }

        const rawHunks = this.buildInitialHunks(input);
        const enrichedHunks = this.enrichHunks(filePath, rawHunks, graph);
        const hooks = options.hooks || this.createHooks(graph);

        const rawVerdict = await this.evaluateHunksVerdict(
            filePath,
            enrichedHunks,
            hooks.thresholdPolicy,
        );
        let verdict = this.resolveBlockingVerdict(issues, rawVerdict);
        if (patchQuality?.verdict === 'gaming_rejected') {
            verdict = {
                status: 'major_rework_needed',
                isMajorChange: true,
                shouldEscalateToL3A: true,
                violations: [
                    ...(verdict.violations || []),
                    'Anti-gaming violation: detected artificial metric manipulation.',
                ],
            };
        }
        const affectedFiles = this.computeAggregatedImpact(enrichedHunks);

        return {
            hunks: enrichedHunks,
            issues,
            verdict,
            impactSummary: {
                totalImpactedFiles: affectedFiles.length,
                affectedFiles,
            },
            patchQuality,
            deltaScore: patchQuality?.deltaScore,
        };
    }

    private runPatchQualityAudit(
        filePath: string,
        oldContent: string,
        newContent: string | undefined,
        issues: Issue[],
        options: PraxisGovernanceOptions,
    ): PatchQualityResult | undefined {
        const enabled = options.enablePatchQuality ?? true;
        if (!enabled || !newContent) {
            return undefined;
        }
        return evaluatePatchQuality({
            filePath,
            beforeContent: oldContent,
            afterContent: newContent,
            newIssues: issues,
        });
    }

    private runPerformanceAudit(
        filePath: string,
        newContent: string | undefined,
        options: PraxisGovernanceOptions,
    ): Issue[] {
        const enabled = options.enablePerformanceAudit ?? true;
        if (!enabled || !newContent) {
            return [];
        }
        return defaultPerformanceEvaluator.auditSource(filePath, newContent);
    }

    private runDataArchAudit(
        filePath: string,
        newContent: string | undefined,
        graph: SemanticGraph,
        options: PraxisGovernanceOptions,
    ): Issue[] {
        const enabled = options.enableDataArchitectureAudit ?? true;
        if (!enabled || !newContent) {
            return [];
        }
        return defaultDataArchitectureEvaluator.audit(filePath, newContent, graph);
    }

    private runTestModernityAudit(
        filePath: string,
        newContent: string | undefined,
        options: PraxisGovernanceOptions,
    ): Issue[] {
        const enabled = options.enableTestModernityAudit ?? true;
        if (!enabled || !newContent || !isTestFilePath(filePath)) {
            return [];
        }
        return defaultTestModernityEvaluator.auditTestSource(filePath, newContent, {
            minEmtd: options.minTestEmtd,
            minCbcr: options.minTestCbcr,
            strict: options.testIntegrityFatal ?? true,
        });
    }

    private runArchitectureAudit(graph: SemanticGraph, options: PraxisGovernanceOptions): Issue[] {
        const enabled = options.enableArchitectureAudit ?? true;
        if (!enabled) {
            return [];
        }
        const archGraph = SemanticArchitectureGraph.fromSemanticGraph(graph, {
            isSelfRepo: options.isSelfRepo,
        });
        return defaultMetaArchitectureEvaluator.evaluate(archGraph, {
            enforceHeadless: true,
            enforceCleanLayers: true,
            flagCrossDomainBypass: true,
            flagConfigHardcoding: true,
            flagGeneralizationLeak: true,
            flagSelfViolation: true,
            isSelfRepo: options.isSelfRepo,
        }).issues;
    }

    private async evaluateHunksVerdict(
        filePath: string,
        hunks: ReviewDiffHunk[],
        policy: PraxisPluginHooks['thresholdPolicy'],
    ): Promise<PraxisVerdict> {
        const activePolicy = policy || new DefaultPraxisThresholdPolicy();
        let highest: PraxisVerdict = {
            status: 'passed',
            isMajorChange: false,
            shouldEscalateToL3A: false,
        };

        for (const hunk of hunks) {
            const ctx: PraxisEnrichedContext = {
                enclosingSymbol: hunk.astContext?.enclosingSymbol,
                impactFiles: hunk.astContext?.impactFiles,
            };
            const v = await activePolicy.evaluateChange(filePath, hunk, ctx);
            if (v.status === 'major_rework_needed') {
                return v;
            }
            if (v.status === 'minor_fix_needed') {
                highest = v;
            }
        }
        return highest;
    }

    private resolveBlockingVerdict(issues: Issue[], currentVerdict: PraxisVerdict): PraxisVerdict {
        const hasBlocking = issues.some((i) => i.severity === 'error');
        if (hasBlocking && currentVerdict.status !== 'major_rework_needed') {
            return {
                status: 'major_rework_needed',
                isMajorChange: true,
                shouldEscalateToL3A: true,
                violations: issues.map((i) => `[${i.rule}] ${i.message}`),
            };
        }
        return currentVerdict;
    }

    private computeAggregatedImpact(hunks: ReviewDiffHunk[]): string[] {
        const impactSet = new Set<string>();
        for (const h of hunks) {
            if (h.astContext?.impactFiles) {
                for (const f of h.astContext.impactFiles) {
                    impactSet.add(f);
                }
            }
        }
        return Array.from(impactSet);
    }

    /**
     * Converts DiffInput into baseline ReviewDiffHunk structures.
     */
    private buildInitialHunks(input: DiffInput): ReviewDiffHunk[] {
        const lines = (input.newContent || '').split(/\r?\n/);
        return [
            {
                hunkId: `hunk:${input.filePath}:1`,
                header: `@@ -1,1 +1,${lines.length} @@`,
                oldSpan: { startLine: 1, lineCount: 1 },
                newSpan: { startLine: 1, lineCount: lines.length },
                lines: lines.map((content, idx) => ({
                    type: 'insert',
                    lineNoNew: idx + 1,
                    content,
                })),
            },
        ];
    }
}

/** Default singleton instance for Praxis integration */
export const defaultPraxisGovernanceService = new PraxisDiffGovernanceService();

/**
 * Factory creating a fresh instance of Praxis diff governance service.
 *
 * @returns Fresh instance conforming to IPraxisDiffGovernanceService.
 */
export function createPraxisDiffGovernanceService(): IPraxisDiffGovernanceService {
    return new PraxisDiffGovernanceService();
}
