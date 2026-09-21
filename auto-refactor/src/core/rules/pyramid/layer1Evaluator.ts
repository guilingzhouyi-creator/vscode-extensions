/**
 * Module: Core Engine — Layer 1 Universal Rule Evaluator
 * File Path: src/core/rules/pyramid/layer1Evaluator.ts
 * Architecture Role: Evaluates language-agnostic Layer 1 rules directly against the unified
 *   SemanticGraph topology, detecting architecture boundary breaches, circular dependencies,
 *   and resource lifecycle imbalances across any source language.
 * Dependencies & Triggers: Consumes SemanticGraph, Issue from core/types, and types from ./types.
 * Responsibilities: Perform cycle graph traversal, check unidirectional clean-architecture
 *   constraints, and emit standardized Issue objects.
 * Exit Semantics & Design Rationale: Deterministic and stateless evaluation produces stable
 *   issue ordering without side-effects.
 */

import type { Issue } from '../../types';
import type { SemanticGraph } from '../../semantic/semanticGraph';
import {
    RULE_LAYER_DIALECT,
    RULE_LAYER_FAMILY,
    RULE_LAYER_UNIVERSAL,
    type RuleLayer,
    type UniversalEvaluationContext,
    type UniversalSemanticRule,
} from './types';
import {
    ExpensiveLoopOperationRule,
    HighAlgorithmicComplexityRule,
    LoopTransientAllocationRule,
} from './performanceRules';
import { inferSystemTopologyRole } from '../../architecture/roleInference';
import { DEFAULT_ALLOWED_DEPENDENCIES } from '../../architecture/types';

/**
 * Layer 1 Rule: Universal Circular Dependency Detection.
 */
export class UniversalCycleRule implements UniversalSemanticRule {
    public readonly id = 'import-cycle';
    public readonly name = 'Universal Circular Dependency';
    public readonly layer: RuleLayer = RULE_LAYER_UNIVERSAL;
    public readonly defaultSeverity = 'error' as const;
    public readonly description =
        'Detects circular dependency topologies across modules, classes, and packages.';

    public evaluate(graph: SemanticGraph, _context: UniversalEvaluationContext): Issue[] {
        const issues: Issue[] = [];
        const cycles = graph.findCycles();

        for (const cycle of cycles) {
            const cyclePath = cycle.join(' -> ');
            issues.push({
                id: `cycle:${cycle.sort().join('|')}`,
                analyzer: 'architecture',
                rule: this.id,
                severity: this.defaultSeverity,
                message: `Circular dependency detected in graph: ${cyclePath}`,
                location: {
                    file: cycle[0],
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: {
                    cycle,
                    length: cycle.length,
                },
            });
        }

        return issues;
    }
}

/**
 * Layer 1 Rule: Universal Clean Architecture Directional Constraint.
 */
export class UniversalCleanArchitectureRule implements UniversalSemanticRule {
    public readonly id = 'clean-layer-violation';
    public readonly name = 'Universal Clean Architecture Boundary Violation';
    public readonly layer: RuleLayer = RULE_LAYER_UNIVERSAL;
    public readonly defaultSeverity = 'error' as const;
    public readonly description =
        'Enforces unidirectional dependency flow from volatile outer layers to stable core.';

    public evaluate(graph: SemanticGraph, _context: UniversalEvaluationContext): Issue[] {
        const issues: Issue[] = [];
        const allEdges = graph.getAllEdges();

        for (const edge of allEdges) {
            if (edge.kind !== 'calls' && edge.kind !== 'depends_on') {
                continue;
            }

            const fromNode = graph.getNode(edge.fromNodeId);
            const toNode = graph.getNode(edge.toNodeId);

            if (!fromNode || !toNode) {
                continue;
            }

            const fromRole = inferSystemTopologyRole(fromNode.location.file, []).role;
            const toRole = inferSystemTopologyRole(toNode.location.file, []).role;

            if (fromRole !== toRole) {
                const allowed = DEFAULT_ALLOWED_DEPENDENCIES[fromRole];
                if (allowed && !allowed.has(toRole)) {
                    issues.push({
                        id: `architecture:clean-layer-violation:${edge.id}`,
                        analyzer: 'architecture',
                        rule: 'clean-layer-violation',
                        severity: 'error',
                        message:
                            `Architecture boundary breach: core layer '${fromNode.name}' ` +
                            `depends on outer layer '${toNode.name}'`,
                        location: fromNode.location,
                        detail: {
                            fromSymbol: fromNode.id,
                            toSymbol: toNode.id,
                            edgeKind: edge.kind,
                            fromRole,
                            toRole,
                        },
                    });
                }
            }
        }

        return issues;
    }
}

/**
 * Classifies any rule identifier into its corresponding pyramid tier.
 *
 * @param ruleId - Unique rule identifier to inspect.
 * @returns The assigned RuleLayer hierarchy level.
 */
export function classifyRuleLayer(ruleId: string): RuleLayer {
    if (
        ruleId === 'import-cycle' ||
        ruleId === 'clean-layer-violation' ||
        ruleId === 'loop-transient-allocation' ||
        ruleId === 'high-algorithmic-complexity' ||
        ruleId === 'expensive-loop-operation' ||
        ruleId === 'HYG-WRAP-001' ||
        ruleId === 'GOV-AGN-001' ||
        ruleId === 'GOV-SLC-001' ||
        ruleId === 'GOV-TRJ-001' ||
        ruleId.startsWith('ARCH-') ||
        ruleId.startsWith('RES-')
    ) {
        return RULE_LAYER_UNIVERSAL;
    }
    if (
        ruleId.includes('python') ||
        ruleId.includes('typescript') ||
        ruleId.startsWith('TS-') ||
        ruleId.startsWith('PY-') ||
        ruleId === 'GOV-EXC-003'
    ) {
        return RULE_LAYER_FAMILY;
    }
    return RULE_LAYER_DIALECT;
}

/**
 * High-level evaluator that runs all Layer 1 universal rules across a SemanticGraph.
 */
export class UniversalPyramidEvaluator {
    private readonly rules: UniversalSemanticRule[] = [
        new UniversalCycleRule(),
        new UniversalCleanArchitectureRule(),
        new LoopTransientAllocationRule(),
        new HighAlgorithmicComplexityRule(),
        new ExpensiveLoopOperationRule(),
    ];

    /**
     * Executes all registered universal rules and returns aggregate issues.
     */
    public evaluateAllLayer1(
        graph: SemanticGraph,
        context: UniversalEvaluationContext = {},
    ): Issue[] {
        const issues: Issue[] = [];
        for (const rule of this.rules) {
            const ruleIssues = rule.evaluate(graph, context);
            issues.push(...ruleIssues);
        }
        return issues;
    }
}

/** Default singleton evaluator */
export const defaultPyramidEvaluator = new UniversalPyramidEvaluator();
