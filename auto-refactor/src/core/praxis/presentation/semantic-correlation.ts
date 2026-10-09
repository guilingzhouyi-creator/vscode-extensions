/**
 * Module: Core Engine - Praxis Presentation Semantic Correlation
 * File Path: src/core/praxis/presentation/semantic-correlation.ts
 * Architecture Role: Presentation layer semantic deduplication and correlation aggregator
 *   clustering related diagnostics to reduce developer cognitive fatigue.
 * Dependencies & Triggers: Consumes PraxisDiagnosticCard and PraxisPresentationSeverity;
 *   triggered by PraxisPresentationAdapter during presentation payload assembly.
 * Responsibilities: Maintain SEMANTIC_OVERLAP_GROUPS rule taxonomy sets; identify overlapping
 *   diagnostic cards at identical file and line coordinates; elect primary cards by severity;
 *   aggregate secondary rule identifiers into correlatedRules metadata.
 * Exit Semantics & Design Rationale: Pure functional transformation with zero engine-level side
 *   effects; guarantees underlying AST scan completeness while presenting cohesive human UI cards.
 */

import type { PraxisDiagnosticCard, PraxisPresentationSeverity } from './presentation-types';

/**
 * 11 known semantic overlap rule families grouped by underlying root causes.
 */
export const SEMANTIC_OVERLAP_GROUPS: ReadonlyArray<ReadonlySet<string>> = Object.freeze([
    new Set(['HYG-STB-002', 'GOV-SAN-001']),
    new Set(['NAM-FIL-001', 'GOV-FIL-001']),
    new Set(['ARCH-FAC-001', 'ARCH-ABS-001']),
    new Set(['SIM-FLAT-002', 'SIM-GUARD-001', 'CPX-NEST-001', 'CPX-NEST-002']),
    new Set(['HYG-WRAP-001', 'ARCH-FAC-001']),
    new Set(['HYG-CLN-001', 'CPX-RED-001']),
    new Set(['SEC-LEAK-001', 'GOV-SAN-001']),
    new Set(['GDM-POOL-001', 'PRF-MEM-001', 'PRF-MEM-002']),
    new Set(['ARCH-DISP-001', 'ARCH-DSP-002']),
    new Set(['NAM-DIR-001', 'ARCH-DIR-001']),
    new Set(['NAM-ABR-001', 'NAM-VAG-001']),
]);

/**
 * Resolves numerical priority weight for presentation severities.
 * Priority order: block (4) > warn (3) > info (2) > pass (1).
 *
 * @param severity - Presentation severity level
 * @returns Numerical priority weight
 */
function getSeverityWeight(severity: PraxisPresentationSeverity): number {
    switch (severity) {
        case 'block':
            return 4;
        case 'warn':
            return 3;
        case 'info':
            return 2;
        case 'pass':
            return 1;
        default:
            return 0;
    }
}

/**
 * Checks whether two distinct rule identifiers share at least one semantic overlap family.
 *
 * @param ruleA - First rule identifier
 * @param ruleB - Second rule identifier
 * @returns True if rules share an overlap family, false otherwise
 */
function sharesOverlapFamily(ruleA: string, ruleB: string): boolean {
    if (ruleA === ruleB) {
        return false;
    }
    for (let i = 0; i < SEMANTIC_OVERLAP_GROUPS.length; i++) {
        const group = SEMANTIC_OVERLAP_GROUPS[i];
        if (group.has(ruleA) && group.has(ruleB)) {
            return true;
        }
    }
    return false;
}

/**
 * Traverses disjoint set parent pointers to resolve the cluster root identifier.
 *
 * @param parent - Disjoint set parent index mapping
 * @param idx - Current card index
 * @returns Cluster root index
 */
function findRoot(parent: number[], idx: number): number {
    let curr = idx;
    while (curr !== parent[curr]) {
        curr = parent[curr];
    }
    return curr;
}

/**
 * Initializes a disjoint set parent index array.
 *
 * @param count - Total number of elements
 * @returns Initialized parent array
 */
function initializeParentArray(count: number): number[] {
    const parent: number[] = new Array<number>(count);
    for (let i = 0; i < count; i++) {
        parent[i] = i;
    }
    return parent;
}

/**
 * Merges two disjoint sets if the corresponding cards share a semantic overlap family.
 *
 * @param parent - Disjoint set parent array
 * @param cardA - First card
 * @param cardB - Second card
 * @param i - Index of first card
 * @param j - Index of second card
 * @returns True if union was performed, false otherwise
 */
function unionIfOverlapping(
    parent: number[],
    cardA: PraxisDiagnosticCard,
    cardB: PraxisDiagnosticCard,
    i: number,
    j: number,
): boolean {
    if (!sharesOverlapFamily(cardA.ruleId, cardB.ruleId)) {
        return false;
    }
    const rootI = findRoot(parent, i);
    const rootJ = findRoot(parent, j);
    if (rootI !== rootJ) {
        parent[rootJ] = rootI;
        return true;
    }
    return false;
}

/**
 * Elects the primary diagnostic card within a cluster based on severity and original order.
 *
 * @param cluster - Non-empty array of overlapping diagnostic cards
 * @returns Elected primary diagnostic card
 */
function electPrimaryCard(cluster: PraxisDiagnosticCard[]): PraxisDiagnosticCard {
    let primary = cluster[0];
    let maxWeight = getSeverityWeight(primary.severity);

    for (let i = 1; i < cluster.length; i++) {
        const candidate = cluster[i];
        const weight = getSeverityWeight(candidate.severity);
        if (weight > maxWeight) {
            primary = candidate;
            maxWeight = weight;
        }
    }

    return primary;
}

/**
 * Merges a cluster of overlapping cards into a single primary card with correlated rules.
 *
 * @param cluster - Array of overlapping cards (length >= 2)
 * @returns Consolidated primary diagnostic card
 */
function mergeCluster(cluster: PraxisDiagnosticCard[]): PraxisDiagnosticCard {
    const primary = electPrimaryCard(cluster);
    const correlatedRules: string[] = [];

    for (let i = 0; i < cluster.length; i++) {
        const secondary = cluster[i];
        const rule = secondary.ruleId;
        if (secondary !== primary && rule !== primary.ruleId && !correlatedRules.includes(rule)) {
            correlatedRules.push(rule);
        }
    }

    return {
        ...primary,
        correlatedRules,
        correlationCount: correlatedRules.length,
    };
}

/**
 * Groups cards at the same location into disjoint clusters by connected overlap roots.
 *
 * @param parent - Disjoint set parent array
 * @param cards - Cards located at identical position
 * @returns Map of cluster root index to grouped cards
 */
function buildClusters(
    parent: number[],
    cards: PraxisDiagnosticCard[],
): Map<number, PraxisDiagnosticCard[]> {
    const clusters = new Map<number, PraxisDiagnosticCard[]>();
    for (let i = 0; i < cards.length; i++) {
        const root = findRoot(parent, i);
        const group = clusters.get(root);
        if (group) {
            group.push(cards[i]);
        } else {
            clusters.set(root, [cards[i]]);
        }
    }
    return clusters;
}

/**
 * Aggregates diagnostic cards residing at the exact same file and line location.
 *
 * @param cardsAtLoc - Diagnostic cards sharing identical file#line coordinates
 * @returns Deduplicated cards for this specific location
 */
function aggregateLocationCards(cardsAtLoc: PraxisDiagnosticCard[]): PraxisDiagnosticCard[] {
    const count = cardsAtLoc.length;
    if (count <= 1) {
        return cardsAtLoc;
    }

    const parent = initializeParentArray(count);
    let hasOverlap = false;

    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            if (unionIfOverlapping(parent, cardsAtLoc[i], cardsAtLoc[j], i, j)) {
                hasOverlap = true;
            }
        }
    }

    if (!hasOverlap) {
        return cardsAtLoc;
    }

    const clusters = buildClusters(parent, cardsAtLoc);
    const result: PraxisDiagnosticCard[] = [];
    for (const cluster of clusters.values()) {
        const card = cluster.length > 1 ? mergeCluster(cluster) : cluster[0];
        result.push(card);
    }
    return result;
}

/**
 * Pure function aggregating semantically overlapping diagnostic cards at identical locations.
 * Uncorrelated cards and locations with single cards remain strictly unmodified.
 *
 * @param cards - Input diagnostic cards array
 * @returns Deduplicated array of diagnostic cards
 */
export function aggregateSemanticOverlappingCards(
    cards: PraxisDiagnosticCard[],
): PraxisDiagnosticCard[] {
    if (!cards || cards.length <= 1) {
        return cards;
    }

    const locationMap = new Map<string, PraxisDiagnosticCard[]>();
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const key = `${card.file}#${card.line}`;
        const group = locationMap.get(key);
        if (group) {
            group.push(card);
        } else {
            locationMap.set(key, [card]);
        }
    }

    if (locationMap.size === cards.length) {
        return cards;
    }

    const result: PraxisDiagnosticCard[] = [];
    for (const group of locationMap.values()) {
        const aggregated = aggregateLocationCards(group);
        for (let j = 0; j < aggregated.length; j++) {
            result.push(aggregated[j]);
        }
    }

    return result;
}
