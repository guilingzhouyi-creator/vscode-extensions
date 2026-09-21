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
 * Metric descriptor for a function evaluated for mechanical decomposition.
 */
export interface FunctionDecompositionMetric {
    name: string;
    loc: number;
    cc: number;
    callDepth: number;
    isForwardingWrapper: boolean;
    delegatesTo?: string;
}

/**
 * Result of cognitive cost and anti-gaming evaluation.
 */
export interface CognitiveCostEvaluation {
    isGaming: boolean;
    netCognitiveGain: number;
    hopPenalty: number;
    wrapperCount: number;
    issues: Issue[];
    recommendation?: string;
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

    return {
        isGaming,
        netCognitiveGain,
        hopPenalty,
        wrapperCount,
        issues,
        recommendation: isGaming
            ? 'Reject superficial CC metric optimization; consolidate pass-through hops.'
            : undefined,
    };
}
