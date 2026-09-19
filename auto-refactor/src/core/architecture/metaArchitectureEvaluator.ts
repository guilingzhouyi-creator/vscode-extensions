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
import { FORBIDDEN_HEADLESS_IMPORTS } from '../intelligence/semanticArchitecture';
import type { SemanticArchitectureGraph } from './semanticArchitectureGraph';
import type {
    ArchitectureAuditOptions,
    ArchitectureAuditResult,
    SemanticArchitectureEdge,
    SemanticArchitectureNode,
} from './types';
import { DEFAULT_ALLOWED_DEPENDENCIES } from './types';

/**
 * Standard rule identifiers for meta-architectural governance.
 */
export const META_ARCH_RULES = {
    HEADLESS: 'ARCH-HDL-001',
    LAYER_VIOLATION: 'clean-layer-violation',
    LAYER_INVERSION: 'ARCH-DIR-001',
    BOUNDARY_BYPASS: 'ARCH-BND-001',
    CONFIG_LEAKAGE: 'ARCH-CFG-001',
    GENERALIZATION_LEAK: 'ARCH-LEAK-001',
    GLOBAL_STATE: 'ARCH-GLB-001',
} as const;

/**
 * Evaluates headless architecture violations on a given node.
 */
function evaluateHeadlessPurity(
    node: SemanticArchitectureNode,
    issues: Issue[],
    isSelfRepo: boolean,
): void {
    const isDomainOrCore =
        node.role === 'headless_domain_core' ||
        node.filePath.includes('/core/') ||
        node.filePath.includes('/domain/');
    if (!isDomainOrCore) {
        return;
    }

    for (const imp of node.imports) {
        if (FORBIDDEN_HEADLESS_IMPORTS.has(imp)) {
            const isSelfViolation = isSelfRepo && node.filePath.includes('/core/');
            issues.push({
                id: `architecture:${META_ARCH_RULES.HEADLESS}:${node.filePath}:${imp}`,
                analyzer: 'architecture',
                rule: META_ARCH_RULES.HEADLESS,
                severity: 'error',
                message:
                    `Headless architecture violation: core module '${node.filePath}' ` +
                    `binds directly to presentation framework '${imp}'.` +
                    (isSelfViolation ? ' [RULE-META-SELF-VIOLATION: Engine Core Breach]' : ''),
                location: {
                    file: node.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 80 },
                },
                detail: {
                    role: node.role,
                    forbiddenImport: imp,
                    isHeadless: node.isHeadless,
                    isSelfViolation,
                },
                suggestion:
                    'Remove UI dependency from core logic; interact through headless data interfaces.',
            });
        }
    }
}

/**
 * Evaluates unidirectional clean architecture layering violations.
 */
function evaluateLayerInversion(
    edge: SemanticArchitectureEdge,
    fromNode: SemanticArchitectureNode,
    toNode: SemanticArchitectureNode,
    issues: Issue[],
    isSelfRepo: boolean,
): void {
    const isSelfViolation = isSelfRepo && fromNode.filePath.includes('/core/');
    issues.push({
        id: `architecture:${META_ARCH_RULES.LAYER_VIOLATION}:${edge.id}`,
        analyzer: 'architecture',
        rule: META_ARCH_RULES.LAYER_VIOLATION,
        severity: 'error',
        message:
            `Clean architecture boundary breach: '${fromNode.role}' in '${fromNode.filePath}' ` +
            `inappropriately depends on outer '${toNode.role}' in '${toNode.filePath}'.` +
            (isSelfViolation ? ' [RULE-META-SELF-VIOLATION: Layer Inversion]' : ''),
        location: {
            file: fromNode.filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 80 },
        },
        detail: {
            fromRole: fromNode.role,
            toRole: toNode.role,
            edgeKind: edge.edgeKind,
            isSelfViolation,
        },
        suggestion:
            'Invert dependency by declaring interfaces in the domain and implementing in outer layers.',
    });
}

/**
 * Evaluates private domain internal boundary bypasses.
 */
function evaluateBoundaryBypass(
    edge: SemanticArchitectureEdge,
    fromNode: SemanticArchitectureNode,
    toNode: SemanticArchitectureNode,
    issues: Issue[],
): void {
    issues.push({
        id: `architecture:${META_ARCH_RULES.BOUNDARY_BYPASS}:${edge.id}`,
        analyzer: 'architecture',
        rule: META_ARCH_RULES.BOUNDARY_BYPASS,
        severity: 'warning',
        message:
            `Cross-domain internal bypass: module '${fromNode.filePath}' ` +
            `bypasses domain facade to directly access internal private '${toNode.filePath}'.`,
        location: {
            file: fromNode.filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: 80 },
        },
        detail: {
            fromDomain: fromNode.domainName,
            toDomain: toNode.domainName,
            targetPath: toNode.filePath,
        },
        suggestion:
            'Depend on public domain facades or barrel interfaces rather than private internal paths.',
    });
}

/**
 * Evaluates environment configuration leakage into pure domain models.
 */
function evaluateConfigLeakage(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.role === 'headless_domain_core' && node.hasDirectConfigAccess) {
        issues.push({
            id: `architecture:${META_ARCH_RULES.CONFIG_LEAKAGE}:${node.filePath}`,
            analyzer: 'architecture',
            rule: META_ARCH_RULES.CONFIG_LEAKAGE,
            severity: 'warning',
            message:
                `Configuration leakage: core domain '${node.filePath}' ` +
                `accesses environment variables or disk config directly.`,
            location: {
                file: node.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: { role: node.role },
            suggestion:
                'Inject strongly-typed configuration parameters through constructor or options object.',
        });
    }
}

/**
 * Evaluates shared mutable global state coupling.
 */
function evaluateGlobalMutableState(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.hasGlobalMutableState && node.role !== 'configuration') {
        issues.push({
            id: `architecture:${META_ARCH_RULES.GLOBAL_STATE}:${node.filePath}`,
            analyzer: 'architecture',
            rule: META_ARCH_RULES.GLOBAL_STATE,
            severity: 'warning',
            message: `Implicit shared mutable state in '${node.filePath}'; couples modules across boundaries.`,
            location: {
                file: node.filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: { role: node.role },
            suggestion:
                'Encapsulate mutable state in scoped instances and pass via dependency injection.',
        });
    }
}

/**
 * Evaluates framework generalization leaks in pure core logic.
 */
function evaluateGeneralizationLeak(node: SemanticArchitectureNode, issues: Issue[]): void {
    if (node.role !== 'headless_domain_core') {
        return;
    }
    const forbiddenExternalTypes = ['express', 'koa', 'fastify', 'typeorm', 'prisma', 'godot'];
    for (const imp of node.imports) {
        if (forbiddenExternalTypes.includes(imp.toLowerCase())) {
            issues.push({
                id: `architecture:${META_ARCH_RULES.GENERALIZATION_LEAK}:${node.filePath}:${imp}`,
                analyzer: 'architecture',
                rule: META_ARCH_RULES.GENERALIZATION_LEAK,
                severity: 'warning',
                message:
                    `Generalization leak: domain core '${node.filePath}' ` +
                    `directly imports external framework or driver '${imp}'.`,
                location: {
                    file: node.filePath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 80 },
                },
                detail: { role: node.role, leakedImport: imp },
                suggestion:
                    'Isolate domain entities to pure native types; delegate frameworks to adapters.',
            });
        }
    }
}

/**
 * Evaluator engine for SemanticArchitectureGraph.
 */
export class MetaArchitectureEvaluator {
    /**
     * Executes comprehensive meta-architectural analysis on the graph.
     */
    public evaluate(
        graph: SemanticArchitectureGraph,
        options: ArchitectureAuditOptions = {},
    ): ArchitectureAuditResult {
        const issues: Issue[] = [];
        const enforceHeadless = options.enforceHeadless ?? true;
        const enforceCleanLayers = options.enforceCleanLayers ?? true;
        const flagBypass = options.flagCrossDomainBypass ?? true;
        const flagConfig = options.flagConfigHardcoding ?? true;
        const flagGeneralization = options.flagGeneralizationLeak ?? true;
        const flagGlobal = options.flagGlobalCoupling ?? true;
        const isSelfRepo = options.isSelfRepo ?? false;

        const nodes = graph.getAllNodes();
        const edges = graph.getAllEdges();

        // 1. Per-node audits
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

        // 2. Layer inversion check
        let inversionCount = 0;
        if (enforceCleanLayers) {
            const inversions = graph.findLayerInversions(DEFAULT_ALLOWED_DEPENDENCIES);
            inversionCount = inversions.length;
            for (const edge of inversions) {
                const from = graph.getNode(edge.fromNodeId);
                const to = graph.getNode(edge.toNodeId);
                if (from && to) {
                    evaluateLayerInversion(edge, from, to, issues, isSelfRepo);
                }
            }
        }

        // 3. Boundary bypass check
        let privateBypassCount = 0;
        if (flagBypass) {
            const bypasses = graph.findPrivateBypasses();
            privateBypassCount = bypasses.length;
            for (const edge of bypasses) {
                const from = graph.getNode(edge.fromNodeId);
                const to = graph.getNode(edge.toNodeId);
                if (from && to) {
                    evaluateBoundaryBypass(edge, from, to, issues);
                }
            }
        }

        const headlessBreachCount = graph.findHeadlessViolations().length;
        const layerDistribution = graph.computeDistribution();
        const nodeMap = new Map<string, SemanticArchitectureNode>();
        for (const n of nodes) {
            nodeMap.set(n.id, n);
        }

        const hasErrors = issues.some((i) => i.severity === 'error');

        return {
            nodes: nodeMap,
            edges,
            issues,
            layerDistribution,
            inversionCount,
            headlessBreachCount,
            privateBypassCount,
            passed: !hasErrors,
        };
    }
}

/** Singleton default meta-architecture evaluator */
export const defaultMetaArchitectureEvaluator = new MetaArchitectureEvaluator();
