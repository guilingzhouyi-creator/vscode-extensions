/**
 * Module: Core Intelligence — Main Sequence Distance & Propagation Cost Evaluator
 * File Path: src/core/intelligence/main-sequence-evaluator.ts
 * Architecture Role: Evaluates Uncle Bob's Abstractness-Instability Main Sequence
 *   and MacCormack's architectural Propagation Cost (transitive closure model).
 * Dependencies & Triggers: Consumed by ArchitectureAnalyzer, CodeQualityScorer, and CI gates.
 * Responsibilities:
 *   1. Calculate Afferent Coupling (Ca), Efferent Coupling (Ce), and Instability (I);
 *   2. Calculate Abstractness (A) and normalized Distance from Main Sequence (D = |A + I - 1|);
 *   3. Classify modules into balanced, Zone of Pain, or Zone of Uselessness;
 *   4. Compute system-wide and node-level transitive closure propagation cost (PC).
 * Exit Semantics & Design Rationale: Pure in-memory calculations; deterministic Warshall
 *   transitive closure; zero transient allocations in hot loops.
 */

/**
 * Architectural classification zone along Uncle Bob's Main Sequence.
 */
export type MainSequenceZone = 'balanced' | 'zone_of_pain' | 'zone_of_uselessness';

/**
 * Metric outcomes for a single module evaluated on the Main Sequence.
 */
export interface ModuleMainSequenceMetric {
    /** Afferent coupling (incoming dependencies from outside) */
    readonly afferentCoupling: number;
    /** Efferent coupling (outgoing dependencies to outside) */
    readonly efferentCoupling: number;
    /** Instability ratio I = Ce / (Ca + Ce) in [0.0, 1.0] */
    readonly instability: number;
    /** Abstractness ratio A = Na / Nc in [0.0, 1.0] */
    readonly abstractness: number;
    /** Normalized distance from main sequence D = |A + I - 1| in [0.0, 1.0] */
    readonly distance: number;
    /** Classification zone based on distance and quadrant */
    readonly zone: MainSequenceZone;
    /** Actionable refactoring guidance */
    readonly recommendation?: string;
}

/**
 * Input node descriptor for evaluating Main Sequence balance.
 */
export interface ModuleCouplingInput {
    readonly afferentCoupling: number;
    readonly efferentCoupling: number;
    readonly abstractTypesCount: number;
    readonly concreteTypesCount: number;
}

/**
 * Propagation Cost outcome across an architectural dependency network.
 */
export interface PropagationCostOutcome {
    /** Total number of nodes evaluated */
    readonly nodeCount: number;
    /** Global propagation cost PC in [1/N, 1.0] */
    readonly propagationCost: number;
    /** Average transitive fan-in across nodes */
    readonly averageBlastRadius: number;
    /** Whether network exhibits architectural hyper-coupling (PC > 0.40) */
    readonly isHyperCoupled: boolean;
    /** Per-node blast radius ratio indexed by node index */
    readonly nodeBlastRadii: readonly number[];
}

const MAIN_SEQUENCE_DISTANCE_THRESHOLD = 0.5;
const HYPER_COUPLED_THRESHOLD = 0.4;
const SAFE_MODULAR_THRESHOLD = 0.15;

/**
 * Calculates Uncle Bob's Main Sequence metrics for a single module.
 *
 * @param input - Module coupling and type counts.
 * @returns Evaluated Main Sequence outcome.
 */
export function evaluateModuleMainSequence(input: ModuleCouplingInput): ModuleMainSequenceMetric {
    const totalCoupling = input.afferentCoupling + input.efferentCoupling;
    const instability = totalCoupling > 0
        ? +(input.efferentCoupling / totalCoupling).toFixed(4)
        : 0.0;

    const totalTypes = input.abstractTypesCount + input.concreteTypesCount;
    const abstractness = totalTypes > 0
        ? +(input.abstractTypesCount / totalTypes).toFixed(4)
        : 0.0;

    const rawDistance = Math.abs(abstractness + instability - 1.0);
    const distance = +rawDistance.toFixed(4);

    const zone = classifyMainSequenceZone(abstractness, instability, distance);
    const recommendation = generateZoneRecommendation(zone, abstractness, instability, distance);

    return Object.freeze({
        afferentCoupling: input.afferentCoupling,
        efferentCoupling: input.efferentCoupling,
        instability,
        abstractness,
        distance,
        zone,
        recommendation,
    });
}

/**
 * Classifies the quadrant zone along the Main Sequence.
 *
 * @param abstractness - A ratio [0.0, 1.0].
 * @param instability - I ratio [0.0, 1.0].
 * @param distance - D ratio [0.0, 1.0].
 * @returns Zone classification.
 */
export function classifyMainSequenceZone(
    abstractness: number,
    instability: number,
    distance: number,
): MainSequenceZone {
    if (distance <= MAIN_SEQUENCE_DISTANCE_THRESHOLD) {
        return 'balanced';
    }
    if (abstractness < 0.5 && instability < 0.5) {
        return 'zone_of_pain';
    }
    if (abstractness > 0.5 && instability > 0.5) {
        return 'zone_of_uselessness';
    }
    return 'balanced';
}

/**
 * Generates an actionable guidance message based on zone classification.
 *
 * @param zone - Architectural zone.
 * @param abstractness - A ratio.
 * @param instability - I ratio.
 * @param distance - D ratio.
 * @returns Optional recommendation string.
 */
export function generateZoneRecommendation(
    zone: MainSequenceZone,
    abstractness: number,
    instability: number,
    distance: number,
): string | undefined {
    if (zone === 'zone_of_pain') {
        return (
            `Module is in the Zone of Pain (D=${distance}, A=${abstractness}, I=${instability}). ` +
            `It is concrete and heavily depended upon, making changes rigid and volatile. ` +
            `Introduce abstract interfaces or facade boundaries to invert dependencies.`
        );
    }
    if (zone === 'zone_of_uselessness') {
        return (
            `Module is in the Zone of Uselessness (D=${distance}, A=${abstractness}, I=${instability}). ` +
            `It is overly abstract with few external dependents, indicating speculative generality. ` +
            `Collapse unnecessary interfaces or merge with concrete implementations.`
        );
    }
    return undefined;
}

/**
 * Computes MacCormack's Propagation Cost (PC) from a directed adjacency matrix.
 * Uses Warshall's algorithm on a flat Uint8Array to minimize heap allocations.
 *
 * @param adjacencyMatrix - Flat row-major NxN matrix (1 = direct dependency from i to j).
 * @param nodeCount - Number of nodes N.
 * @returns Propagation Cost outcome.
 */
function applyTransitiveStep(closure: Uint8Array, iRow: number, kRow: number, n: number): void {
    for (let j = 0; j < n; j++) {
        closure[iRow + j] = closure[iRow + j] | closure[kRow + j];
    }
}

function computeTransitiveClosure(closure: Uint8Array, n: number): void {
    for (let k = 0; k < n; k++) {
        const kRow = k * n;
        for (let i = 0; i < n; i++) {
            const iRow = i * n;
            if (closure[iRow + k] === 1) {
                applyTransitiveStep(closure, iRow, kRow, n);
            }
        }
    }
}

function computeNodeBlastRadii(closure: Uint8Array, n: number): number[] {
    const nodeBlastRadii = new Array<number>(n);
    for (let target = 0; target < n; target++) {
        let dependentsCount = 0;
        for (let source = 0; source < n; source++) {
            if (closure[source * n + target] === 1) {
                dependentsCount++;
            }
        }
        nodeBlastRadii[target] = +(dependentsCount / n).toFixed(4);
    }
    return nodeBlastRadii;
}

/**
 * Evaluates MacCormack (2006) Propagation Cost (PC) from an architectural dependency matrix.
 *
 * @param adjacencyMatrix - Flat row-major NxN matrix (1 = direct dependency from i to j).
 * @param nodeCount - Number of nodes N.
 * @returns Propagation Cost outcome.
 */
export function computePropagationCost(
    adjacencyMatrix: readonly (readonly number[])[],
    nodeCount: number,
): PropagationCostOutcome {
    if (nodeCount <= 0 || adjacencyMatrix.length === 0) {
        return Object.freeze({
            nodeCount: 0,
            propagationCost: 0.0,
            averageBlastRadius: 0.0,
            isHyperCoupled: false,
            nodeBlastRadii: Object.freeze([]),
        });
    }

    const n = nodeCount;
    const closure = new Uint8Array(n * n);

    // Initialize closure with identity and direct edges
    for (let i = 0; i < n; i++) {
        closure[i * n + i] = 1;
        const row = adjacencyMatrix[i];
        if (!row) {
            continue;
        }
        for (let j = 0; j < n; j++) {
            if (row[j]) {
                closure[i * n + j] = 1;
            }
        }
    }

    // Warshall's algorithm for transitive reachability
    computeTransitiveClosure(closure, n);

    const nodeBlastRadii = computeNodeBlastRadii(closure, n);

    let totalReachablePairs = 0;
    for (let idx = 0; idx < n * n; idx++) {
        totalReachablePairs += closure[idx];
    }

    const totalPossiblePairs = n * n;
    const propagationCost = +(totalReachablePairs / totalPossiblePairs).toFixed(4);
    const averageBlastRadius = +(totalReachablePairs / (n * n)).toFixed(4);
    const isHyperCoupled = propagationCost > HYPER_COUPLED_THRESHOLD;

    return Object.freeze({
        nodeCount: n,
        propagationCost,
        averageBlastRadius,
        isHyperCoupled,
        nodeBlastRadii: Object.freeze(nodeBlastRadii),
    });
}
