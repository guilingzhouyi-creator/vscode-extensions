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

/** Context role for business workflow orchestration, which tolerates shallow nesting widest. */
export const ROLE_BUSINESS = 'business' as const;
/** Context role for grammar and format parsers, which legitimately branch on token classes. */
export const ROLE_PARSER = 'parser' as const;
/** Context role for explicit state machines, where transition branching is inherent. */
export const ROLE_STATE_MACHINE = 'state-machine' as const;
/** Context role for numerical and combinatorial algorithms with intrinsic loop nesting. */
export const ROLE_ALGORITHM = 'algorithm' as const;
/** Context role for adapters, storage, and transport plumbing around external systems. */
export const ROLE_INFRASTRUCTURE = 'infrastructure' as const;
/** Context role for single-rule analyzers, where each branch implements one predicate. */
export const ROLE_RULE = 'rule' as const;

const CFNI_MAX_SCORE = 100;
const CFNI_MIN_SCORE = 0;
const CFNI_PENALTY_MULTIPLIER = 4;
const CC_FACTOR_BASE = 1;
const CC_FACTOR_SCALE = 10;
const NESTING_BUDGET_COMPLEX = 5;
const NESTING_BUDGET_STANDARD = 3;
const TRIVIAL_WRAPPER_LINE_LIMIT = 4;
const TRIVIAL_WRAPPER_LOC_THRESHOLD = 3;
const HOP_PENALTY_PER_WRAPPER = 1.5;
const HOP_PENALTY_PER_TRAMPOLINE = 3.0;
const GAMING_WRAPPER_COUNT_THRESHOLD = 3;
const MAX_SAMPLE_WRAPPER_NAMES = 4;
const PRECISION_TWO_DECIMALS = 2;
const DEFAULT_LOCATION_COLUMN_END = 80;

const RECOMMENDATION_REJECT_GAMING =
    'Reject superficial CC metric optimization; consolidate pass-through hops.';
const SUGGESTION_DOMAIN_MODULARIZATION =
    'Avoid chopping cohesive logic into paper-thin pass-through helpers; focus on domain modularization.';

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
    'parser' | 'state-machine' | 'algorithm' | 'infrastructure' | 'rule' | 'business';

/**
 * Result of cognitive cost, CFNI, and anti-gaming evaluation.
 */
export interface CognitiveCostEvaluation {
    isGaming: boolean;
    netCognitiveGain: number;
    hopPenalty: number;
    wrapperCount: number;
    fileTrampolineHops?: number;
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
    role: NestingContextRole = ROLE_BUSINESS,
): { cfni: number; nestingPenalty: number } {
    if (metrics.length === 0) {
        return { cfni: CFNI_MAX_SCORE, nestingPenalty: 0 };
    }

    // Role correction factor kappa
    const kappaMap: Record<NestingContextRole, number> = {
        [ROLE_PARSER]: 0.4,
        [ROLE_STATE_MACHINE]: 0.4,
        [ROLE_ALGORITHM]: 0.6,
        [ROLE_INFRASTRUCTURE]: 0.8,
        [ROLE_RULE]: 1.2,
        [ROLE_BUSINESS]: 1.2,
    };
    const kappa = kappaMap[role] ?? 1.0;

    // Context-aware depth budget
    const budget =
        role === ROLE_PARSER || role === ROLE_STATE_MACHINE
            ? NESTING_BUDGET_COMPLEX
            : NESTING_BUDGET_STANDARD;

    let totalPenalty = 0;
    for (const fn of metrics) {
        const depth = fn.maxDepth ?? 1;
        const excessDepth = Math.max(0, depth - budget);
        if (excessDepth > 0) {
            const span = fn.nestingSpan ?? fn.loc;
            const spanRatio = fn.loc > 0 ? Math.min(1.0, span / fn.loc) : 1.0;
            const ccFactor = CC_FACTOR_BASE + (fn.cc || CC_FACTOR_BASE) / CC_FACTOR_SCALE;
            const fnPenalty = kappa * excessDepth * spanRatio * ccFactor;
            totalPenalty += fnPenalty;
        }
    }

    // CFNI starts at 100, smoothly damped by total penalty
    const cfni = Math.max(
        CFNI_MIN_SCORE,
        Math.min(
            CFNI_MAX_SCORE,
            Math.round(CFNI_MAX_SCORE - totalPenalty * CFNI_PENALTY_MULTIPLIER),
        ),
    );
    return {
        cfni,
        nestingPenalty: Number(totalPenalty.toFixed(PRECISION_TWO_DECIMALS)),
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
    if (lines.length > TRIVIAL_WRAPPER_LINE_LIMIT) return false;

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
 * @param fileTrampolineHops - Count of empty forwarding trampoline hops.
 * @returns Comprehensive cognitive cost evaluation.
 */
export function evaluateNetCognitiveCost(
    filePath: string,
    metrics: FunctionDecompositionMetric[],
    previousMaxCC?: number,
    fileTrampolineHops: number = 0,
): CognitiveCostEvaluation {
    const issues: Issue[] = [];
    const forwardingWrappers = metrics.filter(
        (m) =>
            m.isForwardingWrapper ||
            (m.loc <= TRIVIAL_WRAPPER_LOC_THRESHOLD && Boolean(m.delegatesTo)),
    );
    const wrapperCount = forwardingWrappers.length;

    // Call hop penalty: 1.5 cognitive units per trivial forwarding wrapper,
    // plus 3.0 units per file-level vacuous trampoline hop
    const fileHopPenalty = fileTrampolineHops * HOP_PENALTY_PER_TRAMPOLINE;
    const hopPenalty = wrapperCount * HOP_PENALTY_PER_WRAPPER + fileHopPenalty;

    // Current maximum and total CC
    const currentMaxCC = metrics.length > 0 ? Math.max(...metrics.map((m) => m.cc)) : 0;
    const rawCCReduction = previousMaxCC ? Math.max(0, previousMaxCC - currentMaxCC) : 0;

    // Net cognitive gain = CC reduction - hop penalty
    const netCognitiveGain = rawCCReduction - hopPenalty;

    // Flag mechanical decomposition gaming (CPX-HOP-001)
    // Triggered if there are 3 or more trivial forwarding wrappers created
    if (wrapperCount >= GAMING_WRAPPER_COUNT_THRESHOLD) {
        const names = forwardingWrappers.map((w) => w.name).slice(0, MAX_SAMPLE_WRAPPER_NAMES);
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
                end: { line: 1, column: DEFAULT_LOCATION_COLUMN_END },
            },
            detail: {
                wrapperCount,
                hopPenalty,
                netCognitiveGain,
                wrapperNames: names,
            },
            suggestion: SUGGESTION_DOMAIN_MODULARIZATION,
        });
    }

    const isGaming =
        wrapperCount >= GAMING_WRAPPER_COUNT_THRESHOLD &&
        (previousMaxCC !== undefined ? netCognitiveGain <= 0 : true);

    const { cfni, nestingPenalty } = calculateControlFlowNestingIndex(metrics);

    return {
        isGaming,
        netCognitiveGain,
        hopPenalty,
        wrapperCount,
        cfni,
        nestingPenalty,
        issues,
        recommendation: isGaming ? RECOMMENDATION_REJECT_GAMING : undefined,
    };
}
