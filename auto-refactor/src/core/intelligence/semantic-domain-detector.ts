/**
 * Module: Core Intelligence — Cross-File Semantic Domain & Distributed Redundancy Detector
 * File Path: src/core/intelligence/semantic-domain-detector.ts
 * Architecture Role: Multi-dimensional semantic fingerprinting engine that detects cross-file
 *   distributed redundancy and clusters similar algorithmic/validation domains without relying
 *   on fragile lexical or name matching.
 * Dependencies & Triggers: Consumes Issue schema and dimensionLiterals; invoked during
 *   project-level complexity audit and semantic post-scan passes.
 * Responsibilities: Compute 9-dimensional semantic fingerprints (symbols, call topology, CFG
 *   skeleton, data flow stages, I/O shape, algorithmic steps, side effects, state ownership,
 *   call frequency); discriminate domain divergence from incidental redundancy; enforce
 *   project-scale elastic file and redundancy budgets (CPX-RED-001).
 * Exit Semantics & Design Rationale: Deterministic graph and AST analysis without external I/O.
 *   Prevents forced coupling of distinct domain models while eliminating hidden copy-paste debt.
 */

import type { Issue } from '../types';
import { SEVERITY_WARNING } from '../types';
import { ANALYZER_COMPLEXITY, RULE_CPX_RED_001 } from '../scoring/dimensionLiterals';
import type { RoutineSemanticDescriptor } from './semantic-similarity';
import { computeSemanticSimilarity, evaluateDomainDivergence } from './semantic-similarity';

export type {
    PurityLevel,
    StateOwnership,
    CallFrequencyHotness,
    ReturnKind,
    SemanticFingerprint,
    RoutineSemanticDescriptor,
    DomainDivergenceResult,
} from './semantic-similarity';
export {
    computeSetJaccard,
    computeSequenceSimilarity,
    computeSemanticSimilarity,
    evaluateDomainDivergence,
} from './semantic-similarity';

/**
 * Clustered cross-file semantic code domain.
 */
export interface SemanticCodeDomain {
    domainId: string;
    primaryCategory:
        'validation' | 'transformation' | 'calculation' | 'rule_evaluation' | 'algorithm';
    routines: RoutineSemanticDescriptor[];
    similarityScore: number;
    isLegitimateDomainDivergence: boolean;
    divergenceReason?: string;
    sharedAbstractionSuggestion?: string;
}

/**
 * Result of project-scale distributed redundancy evaluation.
 */
export interface DistributedRedundancyResult {
    totalProjectCC: number;
    distributedRedundancyScore: number;
    redundancyBudget: number;
    isBudgetExceeded: boolean;
    domains: SemanticCodeDomain[];
    issues: Issue[];
}

const DEFAULT_SIM_THRESHOLD = 0.7;
const MIN_DRC_ISSUE_THRESHOLD = 8;
const BASE_BUDGET_MIN_CC = 25;
const BASE_BUDGET_LOC_DIVISOR = 1000;
const BASE_BUDGET_LOC_MULTIPLIER = 30;

/**
 * Finds homologous routines matching the anchor routine above the similarity threshold.
 *
 * @param anchor - Anchor routine descriptor.
 * @param candidates - Potential candidate routines.
 * @param visited - Set of already grouped routine IDs.
 * @param threshold - Minimum similarity threshold.
 * @returns Matched routines and total similarity sum.
 */
function findHomologousCandidates(
    anchor: RoutineSemanticDescriptor,
    candidates: RoutineSemanticDescriptor[],
    visited: Set<string>,
    threshold: number,
): { matched: RoutineSemanticDescriptor[]; totalSim: number } {
    const matched: RoutineSemanticDescriptor[] = [anchor];
    let totalSim = 0;

    for (const candidate of candidates) {
        if (visited.has(candidate.id)) {
            continue;
        }

        const sim = computeSemanticSimilarity(anchor, candidate);
        if (sim >= threshold) {
            matched.push(candidate);
            totalSim += sim;
        }
    }

    return { matched, totalSim };
}

/**
 * Infers primary category for a semantic domain cluster.
 *
 * @param cluster - Homologous routines in the cluster.
 * @returns Inferred primary category.
 */
function inferPrimaryCategory(
    cluster: RoutineSemanticDescriptor[],
): SemanticCodeDomain['primaryCategory'] {
    const firstAlgo = cluster[0].fingerprint.algorithmicSteps.join(' ').toLowerCase();
    if (firstAlgo.includes('validate') || firstAlgo.includes('check')) {
        return 'validation';
    }
    if (firstAlgo.includes('transform') || firstAlgo.includes('map')) {
        return 'transformation';
    }
    if (firstAlgo.includes('rule') || firstAlgo.includes('evaluate')) {
        return 'rule_evaluation';
    }
    return 'calculation';
}

/**
 * Constructs a SemanticCodeDomain from a cluster of homologous routines.
 *
 * @param cluster - Homologous routines.
 * @param avgSim - Average pairwise similarity.
 * @param domainIndex - Sequential domain index.
 * @returns Complete domain structure.
 */
function createDomainCluster(
    cluster: RoutineSemanticDescriptor[],
    avgSim: number,
    domainIndex: number,
): SemanticCodeDomain {
    const divergenceCheck = evaluateDomainDivergence(cluster);
    return {
        domainId: `domain-cluster-${domainIndex}`,
        primaryCategory: inferPrimaryCategory(cluster),
        routines: cluster,
        similarityScore: avgSim,
        isLegitimateDomainDivergence: divergenceCheck.isDivergence,
        divergenceReason: divergenceCheck.reason,
        sharedAbstractionSuggestion: divergenceCheck.suggestion,
    };
}

function registerCluster(
    matched: RoutineSemanticDescriptor[],
    totalSim: number,
    visited: Set<string>,
    domains: SemanticCodeDomain[],
): void {
    for (const r of matched) {
        visited.add(r.id);
    }
    const avgSim = totalSim / (matched.length - 1);
    domains.push(createDomainCluster(matched, avgSim, domains.length + 1));
}

/**
 * Clusters routines into cross-file semantic code domains.
 *
 * @param descriptors - Collection of routines across files.
 * @param similarityThreshold - Minimum threshold to cluster routines (default 0.70).
 * @returns Array of identified semantic code domains.
 */
export function clusterSemanticDomains(
    descriptors: RoutineSemanticDescriptor[],
    similarityThreshold = DEFAULT_SIM_THRESHOLD,
): SemanticCodeDomain[] {
    const domains: SemanticCodeDomain[] = [];
    const visited = new Set<string>();

    for (let i = 0; i < descriptors.length; i++) {
        const routineA = descriptors[i];
        if (visited.has(routineA.id)) {
            continue;
        }

        const { matched, totalSim } = findHomologousCandidates(
            routineA,
            descriptors.slice(i + 1),
            visited,
            similarityThreshold,
        );

        if (matched.length >= 2) {
            registerCluster(matched, totalSim, visited, domains);
        }
    }

    return domains;
}

/**
 * Calculates Distributed Redundant Complexity (DRC) for a single domain.
 *
 * @param domain - Semantic domain under review.
 * @returns Calculated redundant complexity score.
 */
function computeDomainDRC(domain: SemanticCodeDomain): number {
    const excessCount = domain.routines.length - 1;
    const avgCC = domain.routines.reduce((acc, r) => acc + r.cc, 0) / domain.routines.length;
    return Math.round(excessCount * avgCC * domain.similarityScore);
}

/**
 * Builds an Issue for excessive distributed redundant complexity.
 *
 * @param domain - Semantic domain exceeding redundancy tolerance.
 * @param domainDRC - Calculated domain DRC score.
 * @returns Configured Issue object.
 */
function buildDistributedRedundancyIssue(domain: SemanticCodeDomain, domainDRC: number): Issue {
    const sample = domain.routines[0];
    const locations = domain.routines
        .map((r) => `${r.filePath}:${r.startLine} (${r.name})`)
        .join(', ');
    const simPct = (domain.similarityScore * 100).toFixed(0);

    return {
        id: `complexity:${RULE_CPX_RED_001}:${sample.filePath}:${sample.startLine}:${domain.domainId}`,
        analyzer: ANALYZER_COMPLEXITY,
        rule: RULE_CPX_RED_001,
        severity: SEVERITY_WARNING,
        message:
            `Distributed redundant complexity detected: ${domain.routines.length} routines ` +
            `across files duplicate ${domain.primaryCategory} logic (similarity: ${simPct}%, ` +
            `accumulated DRC: ${domainDRC}). Locations: [${locations}].`,
        location: {
            file: sample.filePath,
            start: { line: sample.startLine, column: 1 },
            end: { line: sample.startLine, column: 80 },
        },
        detail: {
            domainId: domain.domainId,
            category: domain.primaryCategory,
            similarity: domain.similarityScore,
            domainDRC,
            routineCount: domain.routines.length,
            routines: domain.routines.map((r) => ({
                name: r.name,
                file: r.filePath,
                line: r.startLine,
                cc: r.cc,
            })),
        },
        suggestion:
            domain.sharedAbstractionSuggestion ??
            'Extract common calculation or validation routine into an authoritative shared library module.',
    };
}

/**
 * Evaluates project-scale distributed redundant complexity across all routines and files.
 *
 * @param descriptors - All routines extracted across the repository.
 * @param totalProjectLOC - Total lines of code in the project.
 * @param options - Configurable threshold overrides.
 * @param options.similarityThreshold - Similarity threshold for clustering.
 * @param options.redundancyBudgetCC - Redundancy budget override.
 * @returns Comprehensive distributed redundancy assessment.
 */
export function evaluateDistributedRedundancy(
    descriptors: RoutineSemanticDescriptor[],
    totalProjectLOC: number,
    options?: { similarityThreshold?: number; redundancyBudgetCC?: number },
): DistributedRedundancyResult {
    const simThreshold = options?.similarityThreshold ?? DEFAULT_SIM_THRESHOLD;
    const domains = clusterSemanticDomains(descriptors, simThreshold);
    const totalProjectCC = descriptors.reduce((sum, d) => sum + d.cc, 0);

    const baseBudget =
        options?.redundancyBudgetCC ??
        Math.max(
            BASE_BUDGET_MIN_CC,
            Math.round((totalProjectLOC / BASE_BUDGET_LOC_DIVISOR) * BASE_BUDGET_LOC_MULTIPLIER),
        );

    let distributedRedundancyScore = 0;
    const issues: Issue[] = [];

    for (const domain of domains) {
        if (domain.isLegitimateDomainDivergence) continue;

        const domainDRC = computeDomainDRC(domain);
        distributedRedundancyScore += domainDRC;

        if (domainDRC >= MIN_DRC_ISSUE_THRESHOLD && domain.routines.length >= 2) {
            issues.push(buildDistributedRedundancyIssue(domain, domainDRC));
        }
    }

    return {
        totalProjectCC,
        distributedRedundancyScore,
        redundancyBudget: baseBudget,
        isBudgetExceeded: distributedRedundancyScore > baseBudget,
        domains,
        issues,
    };
}
