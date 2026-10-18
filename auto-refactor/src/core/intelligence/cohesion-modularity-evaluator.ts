/**
 * Module: Core Intelligence — Cohesion (LCOM*) & Modularity (Q) Evaluator
 * File Path: src/core/intelligence/cohesion-modularity-evaluator.ts
 * Architecture Role: Evaluates Henderson-Sellers normalized Lack of Cohesion in Methods
 *   (LCOM*) and Newman-Girvan network Modularity (Q) to diagnose God-classes and inverted
 *   physical directory structures.
 * Dependencies & Triggers: Consumed by ArchitectureAnalyzer, DataArchitectureAnalyzer,
 *   and CI quality gates.
 * Responsibilities:
 *   1. Calculate Henderson-Sellers LCOM* in normalized range [0.0, 1.0];
 *   2. Identify God-class candidates where methods and fields are disconnected (LCOM* >= 0.85);
 *   3. Compute Newman-Girvan Modularity Q comparing intra-community edge densities;
 *   4. Diagnose architectural organization inversion where cross-directory edges dominate.
 * Exit Semantics & Design Rationale: Deterministic in-memory calculations; O(N^2) modularity
 *   summation; graceful no-op on trivial single-method routines or empty graphs.
 */

/**
 * Class/module method-attribute access descriptor for Henderson-Sellers LCOM* evaluation.
 */
export interface ClassCohesionInput {
    /** Total number of methods (m >= 1) */
    readonly methodsCount: number;
    /** Total number of fields/attributes (a >= 0) */
    readonly attributesCount: number;
    /** Array where item j is the count of methods accessing attribute j: mu(A_j) */
    readonly attributeAccessCounts: readonly number[];
}

/**
 * Henderson-Sellers LCOM* evaluation outcome.
 */
export interface ClassCohesionEvaluation {
    readonly methodsCount: number;
    readonly attributesCount: number;
    /** Mean number of methods accessing an attribute (\bar{\mu}) */
    readonly meanAccessPerAttribute: number;
    /** Normalized Lack of Cohesion in Methods LCOM* in [0.0, 1.0] */
    readonly lcomStar: number;
    /** Whether class/module qualifies as a disconnected God class (LCOM* >= 0.85 && m >= 8) */
    readonly isGodClassCandidate: boolean;
    /** Actionable refactoring guidance */
    readonly recommendation?: string;
}

/**
 * Network descriptor for evaluating Newman-Girvan Modularity Q.
 */
export interface ModularityNetworkInput {
    readonly nodeCount: number;
    /** Adjacency matrix where A[i][j] > 0 indicates an edge between node i and node j */
    readonly adjacencyMatrix: readonly (readonly number[])[];
    /** Community assignment ID for each node (e.g. directory cluster index) */
    readonly nodeCommunities: readonly number[];
}

/**
 * Newman-Girvan Modularity Q evaluation outcome.
 */
export interface ModularityEvaluation {
    readonly nodeCount: number;
    readonly totalEdges: number;
    /** Modularity score Q in [-0.5, 1.0] */
    readonly modularityQ: number;
    /** Whether network demonstrates cohesive architectural clustering (Q >= 0.30) */
    readonly isWellModularized: boolean;
    /** Whether directory structure is inverted relative to actual dependencies (Q < 0.10) */
    readonly isOrganizationInverted: boolean;
    /** Actionable guidance message */
    readonly recommendation?: string;
}

const LCOM_STAR_GOD_CLASS_THRESHOLD = 0.85;
const MIN_METHODS_FOR_GOD_CLASS = 8;
const MODULARITY_WELL_STRUCTURED_THRESHOLD = 0.30;
const MODULARITY_INVERTED_THRESHOLD = 0.10;
const MIN_EDGES_FOR_INVERSION_WARN = 10;

/**
 * Computes Henderson-Sellers normalized Lack of Cohesion in Methods (LCOM*).
 * Formula: LCOM* = (m - \bar{\mu}) / (m - 1)
 *
 * @param input - Class methods and attribute access counts.
 * @returns Evaluated class cohesion outcome.
 */
export function computeHendersonSellersLcom(input: ClassCohesionInput): ClassCohesionEvaluation {
    const m = input.methodsCount;
    const a = input.attributesCount;

    // Classes with 0 or 1 method or 0 attributes are trivially cohesive
    if (m <= 1 || a <= 0 || !input.attributeAccessCounts || input.attributeAccessCounts.length === 0) {
        return Object.freeze({
            methodsCount: m,
            attributesCount: a,
            meanAccessPerAttribute: a > 0 ? 1.0 : 0.0,
            lcomStar: 0.0,
            isGodClassCandidate: false,
        });
    }

    let accessSum = 0;
    for (let i = 0; i < input.attributeAccessCounts.length; i++) {
        accessSum += Math.max(0, input.attributeAccessCounts[i]);
    }

    const meanAccess = +(accessSum / a).toFixed(4);
    // Formula: (m - meanAccess) / (m - 1)
    const rawLcom = (m - meanAccess) / (m - 1);
    const lcomStar = +Math.max(0.0, Math.min(1.0, rawLcom)).toFixed(4);
    const isGodClassCandidate = lcomStar >= LCOM_STAR_GOD_CLASS_THRESHOLD && m >= MIN_METHODS_FOR_GOD_CLASS;

    let recommendation: string | undefined;
    if (isGodClassCandidate) {
        recommendation =
            `High Lack of Cohesion detected (LCOM*=${lcomStar}, methods=${m}, fields=${a}). ` +
            `Methods operate on disparate subsets of state. Decompose this God class into smaller, ` +
            `highly cohesive components focused on distinct data subsets.`;
    }

    return Object.freeze({
        methodsCount: m,
        attributesCount: a,
        meanAccessPerAttribute: meanAccess,
        lcomStar,
        isGodClassCandidate,
        recommendation,
    });
}

function computeNodeDegreesAndWeight(
    matrix: readonly (readonly number[])[],
    n: number,
): { degrees: Float64Array; twoM: number } {
    const degrees = new Float64Array(n);
    let totalEdgeWeight = 0;
    for (let i = 0; i < n; i++) {
        const row = matrix[i];
        if (!row) {
            continue;
        }
        for (let j = 0; j < n; j++) {
            const weight = row[j] || 0;
            if (weight > 0) {
                degrees[i] += weight;
                totalEdgeWeight += weight;
            }
        }
    }
    return { degrees, twoM: totalEdgeWeight };
}

interface ModularitySumContext {
    readonly matrix: readonly (readonly number[])[];
    readonly degrees: Float64Array;
    readonly communities: readonly number[];
    readonly twoM: number;
    readonly nodeCount: number;
}

function calculateModularityAccumulation(context: ModularitySumContext): number {
    let qSum = 0;
    const { matrix, degrees, communities, twoM, nodeCount } = context;
    for (let i = 0; i < nodeCount; i++) {
        const communityId = communities[i];
        const degreeI = degrees[i];
        const row = matrix[i];
        if (!row) {
            continue;
        }
        for (let j = 0; j < nodeCount; j++) {
            if (communities[j] === communityId) {
                const aIJ = row[j] || 0;
                const expectedWeight = (degreeI * degrees[j]) / twoM;
                qSum += aIJ - expectedWeight;
            }
        }
    }
    return qSum;
}

/**
 * Computes Newman-Girvan Modularity Q for a network partitioned into communities.
 * Formula: Q = (1 / 2m) * sum_{i,j} [ A_ij - (k_i * k_j) / (2m) ] * delta(c_i, c_j)
 *
 * @param input - Graph adjacency matrix and community partitioning.
 * @returns Evaluated modularity outcome.
 */
export function computeNewmanGirvanModularity(input: ModularityNetworkInput): ModularityEvaluation {
    const n = input.nodeCount;
    if (n <= 1 || !input.adjacencyMatrix || input.adjacencyMatrix.length === 0) {
        return Object.freeze({
            nodeCount: n,
            totalEdges: 0,
            modularityQ: 0.0,
            isWellModularized: true,
            isOrganizationInverted: false,
        });
    }

    const { degrees, twoM } = computeNodeDegreesAndWeight(input.adjacencyMatrix, n);
    if (twoM <= 0) {
        return Object.freeze({
            nodeCount: n,
            totalEdges: 0,
            modularityQ: 0.0,
            isWellModularized: true,
            isOrganizationInverted: false,
        });
    }

    const qSum = calculateModularityAccumulation({
        matrix: input.adjacencyMatrix,
        degrees,
        communities: input.nodeCommunities,
        twoM,
        nodeCount: n,
    });
    const modularityQ = +(qSum / twoM).toFixed(4);
    const totalEdges = Math.round(twoM / 2);
    const isWellModularized = modularityQ >= MODULARITY_WELL_STRUCTURED_THRESHOLD;
    const isOrganizationInverted =
        modularityQ < MODULARITY_INVERTED_THRESHOLD && totalEdges >= MIN_EDGES_FOR_INVERSION_WARN;

    let recommendation: string | undefined;
    if (isOrganizationInverted) {
        recommendation =
            `Architectural modularity inversion detected (Q=${modularityQ}, edges=${totalEdges}). ` +
            `Cross-directory dependencies heavily outnumber intra-directory couplings. ` +
            `Reorganize file directories to align with functional domain dependency boundaries.`;
    }

    return Object.freeze({
        nodeCount: n,
        totalEdges,
        modularityQ,
        isWellModularized,
        isOrganizationInverted,
        recommendation,
    });
}
