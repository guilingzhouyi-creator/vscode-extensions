/**
 * Module: Core Scoring — Net Cognitive Cost & Anti-Gaming Model
 * File Path: src/core/scoring/cognitive-cost-model.ts
 * Architecture Role: Evaluates refactoring authenticity, penalizing mechanical function
 *   splitting (CPX-HOP-001), thin forwarding wrappers, and gratuitous indirection hops.
 * Dependencies & Triggers: Consumes Issue schema, dimensionLiterals, and antiGaming rules;
 *   called by qualityScorer, patchQuality, and antiGaming.
 * Responsibilities: Quantify net cognitive gain (NetCognitiveGain = DeltaCC - IndirectionPenalty);
 *   disqualify superficial refactoring that inflates call graph depth without reduction of load.
 * Exit Semantics & Design Rationale: Deterministic mathematical model ensuring that refactoring
 *   only boosts quality scores when it authentically simplifies system comprehension.
 */

import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import { ANALYZER_COMPLEXITY, RULE_CPX_HOP_001 } from './dimensionLiterals';

/**
 * Metric descriptor for a function evaluated for mechanical decomposition and control-flow nesting.
 */
export interface FunctionDecompositionMetric {
    name: string;
    loc: number;
    cc: number;
    callDepth: number;
    isForwardingWrapper: boolean;
    delegatesTo?: string;
    maxDepth?: number;
    nestingSpan?: number;
}

/**
 * Context role for control-flow nesting elasticity.
 */
export type NestingContextRole =
    | 'parser'
    | 'state-machine'
    | 'algorithm'
    | 'infrastructure'
    | 'rule'
    | 'business';

/**
 * Result of cognitive cost, CFNI, and anti-gaming evaluation.
 */
export interface CognitiveCostEvaluation {
    isGaming: boolean;
    netCognitiveGain: number;
    hopPenalty: number;
    wrapperCount: number;
    cfni: number;
    nestingPenalty: number;
    issues: Issue[];
    recommendation?: string;
}

/**
 * Calculates the Control Flow Nesting Index (CFNI) and continuous weighted penalty.
 *
 * @param metrics - Function metrics including depth and span.
 * @param role - Contextual role of the file or routine.
 * @returns Object with CFNI (0..100) and continuous weighted nesting penalty.
 */
export function calculateControlFlowNestingIndex(
    metrics: Array<FunctionDecompositionMetric>,
    role: NestingContextRole = 'business',
): { cfni: number; nestingPenalty: number } {
    if (metrics.length === 0) {
        return { cfni: 100, nestingPenalty: 0 };
    }

    // Role correction factor kappa
    const kappaMap: Record<NestingContextRole, number> = {
        parser: 0.4,
        'state-machine': 0.4,
        algorithm: 0.6,
        infrastructure: 0.8,
        rule: 1.2,
        business: 1.2,
    };
    const kappa = kappaMap[role] ?? 1.0;

    // Context-aware depth budget
    const budget = role === 'parser' || role === 'state-machine' ? 5 : 3;

    let totalPenalty = 0;
    for (const fn of metrics) {
        const depth = fn.maxDepth ?? 1;
        const excessDepth = Math.max(0, depth - budget);
        if (excessDepth > 0) {
            const span = fn.nestingSpan ?? fn.loc;
            const spanRatio = fn.loc > 0 ? Math.min(1.0, span / fn.loc) : 1.0;
            const ccFactor = 1 + (fn.cc || 1) / 10;
            const fnPenalty = kappa * excessDepth * spanRatio * ccFactor;
            totalPenalty += fnPenalty;
        }
    }

    // CFNI starts at 100, smoothly damped by total penalty
    const cfni = Math.max(0, Math.min(100, Math.round(100 - totalPenalty * 4)));
    return {
        cfni,
        nestingPenalty: Number(totalPenalty.toFixed(2)),
    };
}

/**
 * Detects if a function is a trivial single-line or two-line forwarding wrapper.
 *
 * @param content - Source text of the function body.
 * @returns True if the function only passes arguments through to another routine.
 */
export function isTrivialForwardingWrapper(content: string): boolean {
    const trimmed = content.trim();
    const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length > 4) return false;

    // Pattern: return (this.)?method(args) or just (this.)?method(args)
    const forwardPattern = /^(?:return\s+)?(?:[a-zA-Z0-9_$.]+)\([^)]*\);?$/;
    return lines.some((l) => forwardPattern.test(l));
}

/**
 * Evaluates net cognitive cost reduction across a set of functions or refactoring diff.
 *
 * @param filePath - Physical file path.
 * @param metrics - Metrics for all functions in the file.
 * @param previousMaxCC - Previous maximum CC before refactoring (if known).
 * @returns Comprehensive cognitive cost evaluation.
 */
export function evaluateNetCognitiveCost(
    filePath: string,
    metrics: FunctionDecompositionMetric[],
    previousMaxCC?: number,
): CognitiveCostEvaluation {
    const issues: Issue[] = [];
    const forwardingWrappers = metrics.filter(
        (m) => m.isForwardingWrapper || (m.loc <= 3 && Boolean(m.delegatesTo)),
    );
    const wrapperCount = forwardingWrappers.length;

    // Call hop penalty: 1.5 cognitive units per trivial forwarding wrapper
    const hopPenalty = wrapperCount * 1.5;

    // Current maximum and total CC
    const currentMaxCC = metrics.length > 0 ? Math.max(...metrics.map((m) => m.cc)) : 0;
    const rawCCReduction = previousMaxCC ? Math.max(0, previousMaxCC - currentMaxCC) : 0;

    // Net cognitive gain = CC reduction - hop penalty
    const netCognitiveGain = rawCCReduction - hopPenalty;

    // Flag mechanical decomposition gaming (CPX-HOP-001)
    // Triggered if there are 3 or more trivial forwarding wrappers created
    if (wrapperCount >= 3) {
        const names = forwardingWrappers.map((w) => w.name).slice(0, 4);
        issues.push({
            id: `complexity:${RULE_CPX_HOP_001}:${filePath}:1`,
            analyzer: ANALYZER_COMPLEXITY,
            rule: RULE_CPX_HOP_001,
            severity: SEVERITY_WARNING,
            message:
                `Mechanical decomposition detected: "${filePath}" created ${wrapperCount} ` +
                `trivial forwarding wrappers (e.g. ${names.join(', ')}), inflating call-graph ` +
                `hop depth without authentic cognitive simplification.`,
            location: {
                file: filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: {
                wrapperCount,
                hopPenalty,
                netCognitiveGain,
                wrapperNames: names,
            },
            suggestion:
                'Avoid chopping cohesive logic into paper-thin pass-through helpers; focus on domain modularization.',
        });
    }

    const isGaming =
        wrapperCount >= 3 && (previousMaxCC !== undefined ? netCognitiveGain <= 0 : true);

    const { cfni, nestingPenalty } = calculateControlFlowNestingIndex(metrics);

    return {
        isGaming,
        netCognitiveGain,
        hopPenalty,
        wrapperCount,
        cfni,
        nestingPenalty,
        issues,
        recommendation: isGaming
            ? 'Reject superficial CC metric optimization; consolidate pass-through hops.'
            : undefined,
    };
}
