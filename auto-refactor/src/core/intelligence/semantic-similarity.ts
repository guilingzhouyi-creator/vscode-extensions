/**
 * Module: Core Intelligence — Multi-Dimensional Semantic Routine Similarity
 * File Path: src/core/intelligence/semantic-similarity.ts
 * Architecture Role: Pure metric calculation engine measuring behavioral similarity across
 *   9 dimensions and discriminating domain divergence from copy-paste redundancy.
 * Dependencies & Triggers: Consumed by semantic-domain-detector during cross-file clustering.
 * Responsibilities: Compute Jaccard symbol similarity, sequence alignments, weighted composite
 *   semantic similarity, and state/purity domain divergence checks.
 * Exit Semantics & Design Rationale: Pure, deterministic calculations with no external I/O.
 */

/**
 * Purity and side-effect boundary classification.
 */
export type PurityLevel = 'pure' | 'mutates_arg' | 'stateful' | 'io_async';

/**
 * State lifecycle and ownership classification.
 */
export type StateOwnership = 'transient' | 'scoped' | 'global_singleton';

/**
 * Execution frequency hotness classification.
 */
export type CallFrequencyHotness = 'hot_loop' | 'request_path' | 'cold_batch';

/**
 * Return shape semantics.
 */
export type ReturnKind = 'scalar' | 'composite' | 'collection' | 'result_optional' | 'void';

/**
 * 9-dimensional semantic fingerprint representing a routine's deep behavioral identity.
 */
export interface SemanticFingerprint {
    symbolTokens: Set<string>;
    domainName: string;
    callInDegree: number;
    callOutDegree: number;
    cfgSkeletonHash: string;
    dataFlowStages: string[];
    ioShape: {
        arity: number;
        paramTypes: string[];
        returnKind: ReturnKind;
    };
    algorithmicSteps: string[];
    sideEffectBoundary: PurityLevel;
    stateOwnership: StateOwnership;
    callFrequencyHotness: CallFrequencyHotness;
}

/**
 * Routine descriptor submitted for cross-file semantic domain analysis.
 */
export interface RoutineSemanticDescriptor {
    id: string;
    name: string;
    filePath: string;
    startLine: number;
    endLine: number;
    cc: number;
    loc: number;
    fingerprint: SemanticFingerprint;
}

/**
 * Result of domain divergence discrimination.
 */
export interface DomainDivergenceResult {
    isDivergence: boolean;
    reason?: string;
    suggestion?: string;
}

/**
 * Computes Jaccard similarity index between two string sets.
 *
 * @param setA - First token set.
 * @param setB - Second token set.
 * @returns Jaccard similarity index between 0.0 and 1.0.
 */
export function computeSetJaccard(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 1.0 : intersection / union;
}

/**
 * Compares ordered sequence similarity using Normalized LCS ratio.
 *
 * @param seqA - First sequence of tokens or step names.
 * @param seqB - Second sequence of tokens or step names.
 * @returns Sequence similarity ratio between 0.0 and 1.0.
 */
export function computeSequenceSimilarity(seqA: string[], seqB: string[]): number {
    if (seqA.length === 0 && seqB.length === 0) return 1.0;
    if (seqA.length === 0 || seqB.length === 0) return 0.0;
    let matches = 0;
    const minLen = Math.min(seqA.length, seqB.length);
    for (let i = 0; i < minLen; i++) {
        if (seqA[i] === seqB[i]) matches++;
    }
    return (2.0 * matches) / (seqA.length + seqB.length);
}

/**
 * Computes multi-dimensional behavioral similarity between two routines.
 *
 * @param a - First routine descriptor.
 * @param b - Second routine descriptor.
 * @returns Similarity score in range [0.0, 1.0].
 */
export function computeSemanticSimilarity(
    a: RoutineSemanticDescriptor,
    b: RoutineSemanticDescriptor,
): number {
    const fpA = a.fingerprint;
    const fpB = b.fingerprint;

    // 1. CFG Skeleton Match (Weight: 0.25)
    const cfgScore = fpA.cfgSkeletonHash === fpB.cfgSkeletonHash ? 1.0 : 0.2;

    // 2. Algorithmic Steps Match (Weight: 0.25)
    const algoScore = computeSequenceSimilarity(fpA.algorithmicSteps, fpB.algorithmicSteps);

    // 3. I/O Shape Match (Weight: 0.15)
    const arityMatch = fpA.ioShape.arity === fpB.ioShape.arity ? 1.0 : 0.0;
    const returnMatch = fpA.ioShape.returnKind === fpB.ioShape.returnKind ? 1.0 : 0.3;
    const ioScore = arityMatch * 0.6 + returnMatch * 0.4;

    // 4. Data Flow Stages Match (Weight: 0.15)
    const dataFlowScore = computeSequenceSimilarity(fpA.dataFlowStages, fpB.dataFlowStages);

    // 5. Purity & Side Effect Match (Weight: 0.10)
    const purityScore = fpA.sideEffectBoundary === fpB.sideEffectBoundary ? 1.0 : 0.0;

    // 6. Symbol Overlap (Weight: 0.10)
    const symbolScore = computeSetJaccard(fpA.symbolTokens, fpB.symbolTokens);

    return (
        cfgScore * 0.25 +
        algoScore * 0.25 +
        ioScore * 0.15 +
        dataFlowScore * 0.15 +
        purityScore * 0.1 +
        symbolScore * 0.1
    );
}

/**
 * Evaluates state ownership and lifecycle mismatches across domains.
 */
function evaluateCrossDomainDivergence(
    routines: RoutineSemanticDescriptor[],
    allPure: boolean,
): DomainDivergenceResult | null {
    if (allPure) {
        return {
            isDivergence: false,
            suggestion:
                'Extract neutral mathematical, transformation, or validation logic into a shared algorithm/operator library.',
        };
    }

    const stateOwnerships = new Set(routines.map((r) => r.fingerprint.stateOwnership));
    const hasMutations = routines.some((r) => r.fingerprint.sideEffectBoundary === 'mutates_arg');
    const hasIoOrAsync = routines.some((r) => r.fingerprint.sideEffectBoundary === 'io_async');

    if (stateOwnerships.size > 1 || hasMutations || hasIoOrAsync) {
        return {
            isDivergence: true,
            reason:
                'Routines possess distinct lifecycle state ownership or side-effect boundaries; ' +
                'merging would introduce artificial cross-domain coupling.',
        };
    }
    return null;
}

/**
 * Determines whether similarity between routines represents legitimate domain divergence
 * or incidental distributed redundancy.
 *
 * @param routines - Clustered routines to discriminate.
 * @returns Divergence evaluation with rationale and shared component recommendation.
 */
export function evaluateDomainDivergence(
    routines: RoutineSemanticDescriptor[],
): DomainDivergenceResult {
    const domains = new Set(routines.map((r) => r.fingerprint.domainName));
    const allPure = routines.every((r) => r.fingerprint.sideEffectBoundary === 'pure');

    if (domains.size > 1) {
        const crossCheck = evaluateCrossDomainDivergence(routines, allPure);
        if (crossCheck) return crossCheck;
    }

    if (domains.size === 1) {
        return {
            isDivergence: false,
            suggestion:
                'Consolidate duplicate routines within domain module into a single authoritative internal helper.',
        };
    }

    return {
        isDivergence: false,
        suggestion:
            'Consolidate distributed routine implementations into an authoritative shared component.',
    };
}
