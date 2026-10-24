/**
 * Module: Core Rules — Semantic Overlap Cluster Topology (single source of truth)
 * File Path: src/core/rules/overlap-clusters.ts
 * Architecture Role: Declarative owner of which rule ids are diagnostically redundant with which.
 *   Every consumer — the presentation-layer union-find aggregator, the doc metric that renders the
 *   cluster count, and the consistency guard that checks the documented list — derives from this
 *   table instead of restating it.
 * Dependencies & Triggers: Imports shared rule ids from ./entries/dimensionLiterals only as plain
 *   strings; consumed by praxis/presentation/semantic-correlation.ts, validate-rules-registry.js
 *   and sync-doc-metrics.js.
 * Responsibilities:
 *   1. Declare the overlap clusters with a stable cluster key and a human rationale.
 *   2. Expose adjacency lookups (clusterKeysOf, rulesSharingCluster, clusterSize).
 *   3. Expose the canonical declared-member list for count rendering and doc verification.
 * Exit Semantics & Design Rationale: Pure frozen data plus pure lookups, no I/O and no mutation.
 *   The table lives here rather than as an optional field on RuleDefinition because rule entries are
 *   built by positional-argument helpers in eight separate modules, and threading a ninth optional
 *   argument through all of them would cost more coupling than the field buys. Keeping it separate
 *   also preserves the distinction the catalog already makes: RuleDefinition answers "does this rule
 *   exist", while this table answers "which rules report the same underlying defect".
 *
 *   A rule may legitimately belong to several clusters: GOV-SAN-001 is redundant with both an empty
 *   stub and a leaked credential, and ARCH-FAC-001 with both an abstraction leak and a redundant
 *   wrapper. The union-find aggregator bridges those through the shared member, which is why
 *   "cluster count" is NOT "independent defect count" and the distinction is stated in
 *   `OVERLAP_CLUSTER_SEMANTICS`.
 */

/**
 * One declarative overlap cluster: a set of rule ids that describe one underlying defect from
 * different angles, plus the reason they are considered redundant.
 */
export interface OverlapClusterDefinition {
    /** Stable key used by docs, metrics and guards; kebab-case, never renamed silently. */
    readonly key: string;
    /** Member rule ids, sorted for stable output. */
    readonly members: readonly string[];
    /** Why these rules collide on the same defect. One imperative-free sentence. */
    readonly rationale: string;
}

/**
 * Declarative overlap topology.
 *
 * Order is historical and preserved so generated documentation diffs stay minimal; consumers that
 * need deterministic output sort by `key` instead of relying on this order.
 */
export const OVERLAP_CLUSTERS: readonly OverlapClusterDefinition[] = Object.freeze([
    {
        key: 'stub-and-sanitize',
        members: ['GOV-SAN-001', 'HYG-STB-002'],
        rationale: 'Both fire on transient scaffolding text left behind during construction.',
    },
    {
        key: 'file-naming-governance',
        members: ['GOV-FIL-001', 'NAM-FIL-001'],
        rationale: 'Both judge the same file name against governance and naming contracts.',
    },
    {
        key: 'facade-abstraction',
        members: ['ARCH-ABS-001', 'ARCH-FAC-001'],
        rationale: 'Both report an indirection that forwards without carrying behaviour.',
    },
    {
        key: 'nested-control-flow',
        members: ['CPX-NEST-001', 'CPX-NEST-002', 'SIM-FLAT-002', 'SIM-GUARD-001'],
        rationale: 'All four describe one deeply nested block that a guard clause would flatten.',
    },
    {
        key: 'redundant-wrapper',
        members: ['ARCH-FAC-001', 'HYG-WRAP-001'],
        rationale: 'Both report a wrapper layer that adds no behaviour over its target.',
    },
    {
        key: 'clone-and-dead-branch',
        members: ['CPX-RED-001', 'HYG-CLN-001'],
        rationale: 'Both report duplicated branches whose bodies resolve to one implementation.',
    },
    {
        key: 'credential-and-sanitize',
        members: ['GOV-SAN-001', 'SEC-LEAK-001'],
        rationale: 'Both report secret-shaped text reaching a persisted or rendered surface.',
    },
    {
        key: 'pool-transient-allocation',
        members: ['GDM-POOL-001', 'PRF-MEM-001', 'PRF-MEM-002'],
        rationale: 'All three report an allocation inside a loop that a pooled object avoids.',
    },
    {
        key: 'dispatch-contract',
        members: ['ARCH-DISP-001', 'ARCH-DSP-002'],
        rationale: 'Both report a dispatch site diverging from its declared routing contract.',
    },
    {
        key: 'directory-layering',
        members: ['ARCH-DIR-001', 'NAM-DIR-001'],
        rationale: 'Both judge the same directory name against layering and naming contracts.',
    },
    {
        key: 'ambiguous-abbreviation',
        members: ['NAM-ABR-001', 'NAM-VAG-001'],
        rationale: 'Both report an identifier whose name does not determine its meaning.',
    },
]);

/**
 * Statements a reader needs to interpret the topology correctly.
 *
 * These are carried as data rather than prose in one document because three surfaces render them
 * (runbook, handoff report, doc metric caption), and prose copies had already diverged.
 */
export const OVERLAP_CLUSTER_SEMANTICS = Object.freeze({
    /**
     * Cluster count is not independent-defect count: a rule may sit in several clusters, so the
     * union-find aggregator joins those clusters through the shared member.
     */
    mayShareMembers: true,
    /**
     * Aggregation is scoped to one source location. Two semantically identical findings on
     * different lines stay separate, because merging them would hide a second repair site.
     */
    aggregationScope: 'same-file-and-line',
    /** The aggregator selects the highest-severity member as the representative card. */
    primarySelection: 'highest-severity',
    /** Every non-selected member id is preserved on the representative under this field. */
    correlatedField: 'correlatedRules',
});

/** Cluster keys indexed by member rule id, built once from the frozen table. */
const CLUSTER_KEYS_BY_RULE: ReadonlyMap<string, readonly string[]> = (() => {
    const index = new Map<string, string[]>();
    for (const cluster of OVERLAP_CLUSTERS) {
        for (const member of cluster.members) {
            const existing = index.get(member);
            if (existing) {
                existing.push(cluster.key);
            } else {
                index.set(member, [cluster.key]);
            }
        }
    }
    return new Map([...index].map(([rule, keys]) => [rule, Object.freeze(keys.slice())]));
})();

/** Cluster lookup keyed by cluster key, for callers resolving one cluster by name. */
const CLUSTERS_BY_KEY: ReadonlyMap<string, OverlapClusterDefinition> = new Map(
    OVERLAP_CLUSTERS.map((cluster) => [cluster.key, cluster]),
);

/**
 * List the cluster keys a rule participates in.
 *
 * @param ruleId - Rule identifier to look up.
 * @returns Frozen cluster keys, or an empty array when the rule is not part of any cluster.
 */
export function clusterKeysOf(ruleId: string): readonly string[] {
    return CLUSTER_KEYS_BY_RULE.get(ruleId) ?? EMPTY_KEYS;
}

/** Shared empty result so a non-member lookup allocates nothing. */
const EMPTY_KEYS: readonly string[] = Object.freeze([]);

/**
 * Resolve one cluster by its key.
 *
 * @param key - Cluster key to resolve.
 * @returns The cluster definition, or undefined when the key is not declared.
 */
export function getOverlapCluster(key: string): OverlapClusterDefinition | undefined {
    return CLUSTERS_BY_KEY.get(key);
}

/**
 * Decide whether two distinct rules are diagnosed from the same defect.
 *
 * @param ruleA - First rule identifier.
 * @param ruleB - Second rule identifier.
 * @returns True when both belong to at least one shared cluster; false for the same rule.
 */
export function rulesShareCluster(ruleA: string, ruleB: string): boolean {
    if (ruleA === ruleB) return false;
    const keysA = CLUSTER_KEYS_BY_RULE.get(ruleA);
    if (!keysA) return false;
    const keysB = CLUSTER_KEYS_BY_RULE.get(ruleB);
    if (!keysB) return false;
    return keysA.some((key) => keysB.includes(key));
}

/**
 * Count the declared clusters.
 *
 * Consumed by the doc metric so the rendered number cannot be typed by hand.
 *
 * @returns Number of declared clusters.
 */
export function overlapClusterCount(): number {
    return OVERLAP_CLUSTERS.length;
}

/**
 * Count the distinct rule ids that participate in any cluster.
 *
 * Distinct rather than summed, because a rule in two clusters is still one rule.
 *
 * @returns Number of distinct member rules.
 */
export function overlapMemberCount(): number {
    return CLUSTER_KEYS_BY_RULE.size;
}

/**
 * List every cluster member as `key: [members]` rows sorted by key.
 *
 * Produced for the documentation table and for guards that compare a rendered list against the
 * declaration, so neither has to re-derive the shape.
 *
 * @returns Rows sorted by cluster key.
 */
export function overlapClusterRows(): ReadonlyArray<{ key: string; members: readonly string[] }> {
    return [...OVERLAP_CLUSTERS]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((cluster) => ({ key: cluster.key, members: cluster.members }));
}
