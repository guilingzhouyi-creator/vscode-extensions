/**
 * Module: Core Architecture — Meta Architecture Rules Evaluator
 * File Path: src/core/architecture/metaArchitectureEvaluator.ts
 * Architecture Role: Evaluator of the 6 core meta-architecture rules over
 *   SemanticArchitectureGraph, enforcing headless isolation, unidirectional layering,
 *   boundary encapsulation, and self-checks.
 * Dependencies & Triggers: Consumes SemanticArchitectureGraph and types from ./types, Issue schema.
 * Responsibilities: Evaluate ARCH-HDL-001, clean-layer-violation / ARCH-DIR-001, ARCH-BND-001,
 *   ARCH-CFG-001, ARCH-LEAK-001, and ARCH-GLB-001; produce canonical Issue models.
 * Exit Semantics & Design Rationale: Pure, deterministic graph inspection returning Issue records.
 */

import type { Issue } from '../types';
import type { SemanticArchitectureGraph } from './semanticArchitectureGraph';
import type {
    ArchitectureAuditOptions,
    ArchitectureAuditResult,
    SemanticArchitectureEdge,
    SemanticArchitectureNode,
} from './types';
import { DEFAULT_ALLOWED_DEPENDENCIES } from './types';
import { auditConfigDrivenArchitecture } from './config-driven-architecture';
import { auditFileTaxonomy } from './file-taxonomy-ontology';
import type { FileBehavioralMetrics, FileTaxonomyAuditResult } from './file-taxonomy-ontology';
import { auditBoundaryDiscipline } from '../intelligence/boundary-discipline-engine';
import type {
    BoundaryDisciplineResult,
    UtilityFileInspectionContext,
    UtilitySymbolDescriptor,
} from '../intelligence/boundary-discipline-engine';
import {
    META_ARCH_RULES,
    evaluateHeadlessPurity,
    evaluateLayerInversion,
    evaluateBoundaryBypass,
    evaluateConfigLeakage,
    evaluateGlobalMutableState,
    evaluateGeneralizationLeak,
} from './meta-architecture-rules';

export { META_ARCH_RULES };

/**
 * Evaluator engine for SemanticArchitectureGraph.
 */
export class MetaArchitectureEvaluator {
    private evaluatePerNodeAudits(
        nodes: SemanticArchitectureNode[],
        options: ArchitectureAuditOptions,
        isSelfRepo: boolean,
        issues: Issue[],
    ): void {
        const enforceHeadless = options.enforceHeadless ?? true;
        const flagConfig = options.flagConfigHardcoding ?? true;
        const flagGeneralization = options.flagGeneralizationLeak ?? true;
        const flagGlobal = options.flagGlobalCoupling ?? true;

        for (const node of nodes) {
            if (enforceHeadless) {
                evaluateHeadlessPurity(node, issues, isSelfRepo);
            }
            if (flagConfig) {
                evaluateConfigLeakage(node, issues);
            }
            if (flagGeneralization) {
                evaluateGeneralizationLeak(node, issues);
            }
            if (flagGlobal) {
                evaluateGlobalMutableState(node, issues);
            }
        }
    }

    private evaluateLayerInversions(
        graph: SemanticArchitectureGraph,
        enforceCleanLayers: boolean,
        isSelfRepo: boolean,
        issues: Issue[],
    ): number {
        if (!enforceCleanLayers) return 0;
        const inversions = graph.findLayerInversions(DEFAULT_ALLOWED_DEPENDENCIES);
        for (const edge of inversions) {
            const from = graph.getNode(edge.fromNodeId);
            const to = graph.getNode(edge.toNodeId);
            if (from && to) {
                evaluateLayerInversion(edge, from, to, issues, isSelfRepo);
            }
        }
        return inversions.length;
    }

    private evaluatePrivateBypasses(
        graph: SemanticArchitectureGraph,
        flagBypass: boolean,
        issues: Issue[],
    ): number {
        if (!flagBypass) return 0;
        const bypasses = graph.findPrivateBypasses();
        for (const edge of bypasses) {
            const from = graph.getNode(edge.fromNodeId);
            const to = graph.getNode(edge.toNodeId);
            if (from && to) {
                evaluateBoundaryBypass(edge, from, to, issues);
            }
        }
        return bypasses.length;
    }

    private evaluateConfigMaturity(
        nodes: SemanticArchitectureNode[],
        flagConfig: boolean,
        issues: Issue[],
    ): import('./config-driven-architecture').ConfigDrivenAnalysisResult | undefined {
        if (!flagConfig) return undefined;
        const configFiles = nodes.map((n) => ({
            filePath: n.filePath,
            content: '',
            imports: n.imports,
            isDomainCore: n.role === 'headless_domain_core',
        }));
        const domainSet = new Set(nodes.map((n) => n.domainName).filter(Boolean));
        const configMaturity = auditConfigDrivenArchitecture(configFiles, {
            fileCount: nodes.length,
            domainCount: domainSet.size || 1,
        });
        issues.push(...configMaturity.issues);
        return configMaturity;
    }

    private evaluateTaxonomyAudit(
        nodes: SemanticArchitectureNode[],
        edges: SemanticArchitectureEdge[],
        graph: SemanticArchitectureGraph,
        flagTaxonomy: boolean,
        issues: Issue[],
    ): FileTaxonomyAuditResult | undefined {
        if (!flagTaxonomy) return undefined;

        const fanInMap = new Map<string, number>();
        const crossDomainFanInMap = new Map<string, Set<string>>();
        const fanOutMap = new Map<string, number>();

        for (const edge of edges) {
            fanOutMap.set(edge.fromNodeId, (fanOutMap.get(edge.fromNodeId) ?? 0) + 1);
            fanInMap.set(edge.toNodeId, (fanInMap.get(edge.toNodeId) ?? 0) + 1);
            if (edge.isCrossDomain) {
                const fromNode = graph.getNode(edge.fromNodeId);
                if (fromNode) {
                    let domainSet = crossDomainFanInMap.get(edge.toNodeId);
                    if (!domainSet) {
                        domainSet = new Set<string>();
                        crossDomainFanInMap.set(edge.toNodeId, domainSet);
                    }
                    domainSet.add(fromNode.domainName);
                }
            }
        }

        const metricsList: FileBehavioralMetrics[] = nodes.map((node) => {
            const isUtilOrShared = /[\/\\](?:utils?|helpers?|shared|common)[\/\\]/i.test(
                node.filePath,
            );
            const isInfra = /[\/\\](?:infra|storage|db|network|fs|system)[\/\\]/i.test(
                node.filePath,
            );
            const isRule = /[\/\\](?:rules?|policies|policy)[\/\\]/i.test(node.filePath);
            const isPool = /[\/\\](?:pool|buffer|cache)[\/\\]/i.test(node.filePath);
            const isAlgo = /[\/\\](?:algo|math|transforms?|operators?)[\/\\]/i.test(node.filePath);
            const isConst = /[\/\\](?:constants?|literals?|enums?)[\/\\]/i.test(node.filePath);

            return {
                filePath: node.filePath,
                loc: 100,
                codeDensity: 0.8,
                exportedSymbolCount: node.exports.length,
                fanInCount: fanInMap.get(node.id) ?? 0,
                crossDomainFanIn: crossDomainFanInMap.get(node.id)?.size ?? 0,
                fanOutCount: fanOutMap.get(node.id) ?? 0,
                isStateful: node.hasGlobalMutableState,
                hasGlobalMutableState: node.hasGlobalMutableState,
                pureFunctionRatio: isUtilOrShared || isAlgo || isConst ? 0.9 : 0.5,
                hasIoOrSystemImports: isInfra,
                hasPoolOrBufferSymbols: isPool,
                hasRuleOrPolicySymbols: isRule,
                hasConstantOrEnumOnly: isConst,
                hasMathOrAlgoKeywords: isAlgo,
                domainName: node.domainName,
            };
        });

        const fileTaxonomyResult = auditFileTaxonomy(metricsList);
        issues.push(...fileTaxonomyResult.issues);
        return fileTaxonomyResult;
    }

    private evaluateDisciplineAudit(
        nodes: SemanticArchitectureNode[],
        flagDiscipline: boolean,
        issues: Issue[],
    ): BoundaryDisciplineResult | undefined {
        if (!flagDiscipline) return undefined;

        const utilityContexts: UtilityFileInspectionContext[] = nodes
            .filter((node) =>
                /(?:^|[\/\\])(?:utils?|helpers?|common|tools?|misc|shared-utils?)(?:\.[a-zA-Z0-9]+)?$/i.test(
                    node.filePath,
                ),
            )
            .map((node) => ({
                filePath: node.filePath,
                loc: 150,
                exportedSymbols: node.exports.map((exp, idx) => ({
                    name: exp,
                    line: idx * 10 + 1,
                    category: (idx % 2 === 0
                        ? 'math'
                        : 'formatting') as UtilitySymbolDescriptor['category'],
                    suggestedStream: 'algorithm_operator_library' as const,
                    isPure: true,
                })),
                distinctCategoryCount: Math.min(node.exports.length, 3),
                isGenericUtilityName: true,
                hasCyclicDependencies: false,
                delegationHopDepth: 1,
            }));

        const boundaryDisciplineResult = auditBoundaryDiscipline(utilityContexts);
        issues.push(...boundaryDisciplineResult.issues);
        return boundaryDisciplineResult;
    }

    private buildAuditResult(
        graph: SemanticArchitectureGraph,
        nodes: SemanticArchitectureNode[],
        edges: SemanticArchitectureEdge[],
        issues: Issue[],
        inversionCount: number,
        privateBypassCount: number,
        configMaturity: ArchitectureAuditResult['configMaturity'],
        fileTaxonomyResult: FileTaxonomyAuditResult | undefined,
        boundaryDisciplineResult: BoundaryDisciplineResult | undefined,
    ): ArchitectureAuditResult {
        const headlessBreachCount = graph.findHeadlessViolations().length;
        const layerDistribution = graph.computeDistribution();
        const nodeMap = new Map<string, SemanticArchitectureNode>();
        for (const n of nodes) {
            nodeMap.set(n.id, n);
        }

        return {
            nodes: nodeMap,
            edges,
            issues,
            layerDistribution,
            inversionCount,
            headlessBreachCount,
            privateBypassCount,
            passed: !issues.some((i) => i.severity === 'error'),
            configMaturity,
            fileTaxonomyResult,
            boundaryDisciplineResult,
        };
    }

    /**
     * Executes comprehensive meta-architectural analysis on the graph.
     */
    public evaluate(
        graph: SemanticArchitectureGraph,
        options: ArchitectureAuditOptions = {},
    ): ArchitectureAuditResult {
        const issues: Issue[] = [];
        const isSelfRepo = options.isSelfRepo ?? false;
        const nodes = graph.getAllNodes();
        const edges = graph.getAllEdges();

        this.evaluatePerNodeAudits(nodes, options, isSelfRepo, issues);
        const inversionCount = this.evaluateLayerInversions(
            graph,
            options.enforceCleanLayers ?? true,
            isSelfRepo,
            issues,
        );
        const privateBypassCount = this.evaluatePrivateBypasses(
            graph,
            options.flagCrossDomainBypass ?? true,
            issues,
        );
        const configMaturity = this.evaluateConfigMaturity(
            nodes,
            options.flagConfigHardcoding ?? true,
            issues,
        );
        const fileTaxonomyResult = this.evaluateTaxonomyAudit(
            nodes,
            edges,
            graph,
            options.flagFileTaxonomy ?? true,
            issues,
        );
        const boundaryDisciplineResult = this.evaluateDisciplineAudit(
            nodes,
            options.flagBoundaryDiscipline ?? true,
            issues,
        );

        return this.buildAuditResult(
            graph,
            nodes,
            edges,
            issues,
            inversionCount,
            privateBypassCount,
            configMaturity,
            fileTaxonomyResult,
            boundaryDisciplineResult,
        );
    }
}

/** Singleton default meta-architecture evaluator */
export const defaultMetaArchitectureEvaluator = new MetaArchitectureEvaluator();
