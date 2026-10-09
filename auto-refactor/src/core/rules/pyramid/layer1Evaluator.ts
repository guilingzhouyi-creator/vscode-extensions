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

/** Exact rule identifiers categorized as universal layer. */
const UNIVERSAL_EXACT_RULES = new Set([
    'import-cycle',
    'clean-layer-violation',
    'loop-transient-allocation',
    'high-algorithmic-complexity',
    'expensive-loop-operation',
    'GOV-AGN-001',
    'GOV-SLC-001',
    'GOV-TRJ-001',
]);

/** Prefix pattern for universal rules (HYG-WRAP-, ARCH-, RES-). */
const UNIVERSAL_PREFIX_RE = /^(?:HYG-WRAP-|ARCH-|RES-)/;

/** Exact rule identifiers categorized as family layer. */
const FAMILY_EXACT_RULES = new Set(['GOV-EXC-003']);

/** Pattern for family rules (TS-, PY-, GOV-TYP-, or containing python / typescript). */
const FAMILY_PATTERN_RE = /^(?:TS-|PY-|GOV-TYP-)|(?:python|typescript)/;

/**
 * Table-driven dispatch rules for classifying pyramid layers.
 */
const LAYER_DISPATCH_TABLE: ReadonlyArray<{
    matches: (id: string) => boolean;
    layer: RuleLayer;
}> = [
    {
        matches: (id) => UNIVERSAL_EXACT_RULES.has(id) || UNIVERSAL_PREFIX_RE.test(id),
        layer: RULE_LAYER_UNIVERSAL,
    },
    {
        matches: (id) => FAMILY_EXACT_RULES.has(id) || FAMILY_PATTERN_RE.test(id),
        layer: RULE_LAYER_FAMILY,
    },
];

/**
 * Classifies any rule identifier into its corresponding pyramid tier.
 *
 * @param ruleId - Unique rule identifier to inspect.
 * @returns The assigned RuleLayer hierarchy level.
 */
export function classifyRuleLayer(ruleId: string): RuleLayer {
    for (const entry of LAYER_DISPATCH_TABLE) {
        if (entry.matches(ruleId)) {
            return entry.layer;
        }
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

    /**
     * Count the findings this evaluator produced per pyramid tier.
     *
     * `classifyRuleLayer` was previously reachable only from validation scripts, so the
     * rule-layer contract existed on paper while a real scan never consulted it. Attaching
     * the classification to the findings this evaluator actually emits makes the tier
     * observable in production: a regression that pushed a Layer 1 defect down to a dialect
     * tier would change the reported split.
     *
     * @param issues - Findings produced by `evaluateAllLayer1`.
     * @returns Finding count per tier.
     */
    public summarizeByLayer(issues: readonly Issue[]): Record<RuleLayer, number> {
        const summary: Record<RuleLayer, number> = {
            [RULE_LAYER_UNIVERSAL]: 0,
            [RULE_LAYER_FAMILY]: 0,
            [RULE_LAYER_DIALECT]: 0,
        };
        for (const issue of issues) {
            const ruleId = issue.rule ?? '';
            summary[classifyRuleLayer(ruleId)] += 1;
        }
        return summary;
    }
}

/** Default singleton evaluator */
export const defaultPyramidEvaluator = new UniversalPyramidEvaluator();
