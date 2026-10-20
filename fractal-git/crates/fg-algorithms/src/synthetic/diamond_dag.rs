//! Module: fg-algorithms — Synthetic Diamond DAG Data Factory
//! File Path: crates/fg-algorithms/src/synthetic/diamond_dag.rs
//! Architecture Role: Pure in-memory generator for deterministic,
//!   high-depth diamond DAG topologies.
//! Dependencies & Triggers: Consumed by benchmarks, scale testing, and poset reachability proofs.
//! Responsibilities: Construct multi-step branching/merging DAGs with monotonic CCD v2 timestamps
//!   to benchmark O(1) negative cutoff invariants and positive reachability traversals.
//! Exit Semantics & Design Rationale:
//!   - Deterministic seed generation; zero randomness or external network dependencies.
//!   - O(N) generation complexity, directly producing adjacency and CCD lookup tables.

use fg_core::models::{CorrectedCommitDate, Oid};
use std::collections::HashMap;

/// Result of generating a synthetic diamond DAG.
#[derive(Debug, Clone)]
pub struct SyntheticDag {
    /// Root commit OID (earliest ancestor).
    pub root_oid: Oid,
    /// Leaf commit OID (latest descendant).
    pub leaf_oid: Oid,
    /// Total nodes generated in the DAG.
    pub node_count: usize,
    /// Midpoint ancestor OID for reachable ancestry assertions.
    pub midway_ancestor_oid: Oid,
    /// Disconnected OID for negative reachability assertions.
    pub disconnected_oid: Oid,
    /// Direct adjacency lookup: node OID -> list of parent OIDs.
    pub parents_map: HashMap<Oid, Vec<Oid>>,
    /// Monotonic Corrected Commit Date (CCD v2) lookup table.
    pub ccd_map: HashMap<Oid, CorrectedCommitDate>,
}

/// Generates a synthetic diamond DAG with the specified number of diamond steps.
///
/// Each step k branches from previous node C_k into Left (L_k) and Right (R_k),
/// which both merge into Merge (M_k) = C_{k+1}.
/// Total nodes = 1 + steps * 3 (e.g. steps = 500 produces 1,501 nodes, ~2,000 entities).
pub fn generate_diamond_dag(steps: usize) -> SyntheticDag {
    let steps = steps.max(1);
    let total_nodes = 1 + steps * 3;
    let mut parents_map: HashMap<Oid, Vec<Oid>> = HashMap::with_capacity(total_nodes);
    let mut ccd_map: HashMap<Oid, CorrectedCommitDate> = HashMap::with_capacity(total_nodes);

    let make_oid = |idx: usize| -> Oid {
        let mut oid_bytes = [0u8; 20];
        oid_bytes[0..4].copy_from_slice(&(idx as u32).to_le_bytes());
        Oid::from_bytes(oid_bytes)
    };

    let root_oid = make_oid(0);
    ccd_map.insert(root_oid, CorrectedCommitDate(100));

    let mut prev_commit = root_oid;
    for i in 0..steps {
        let left_oid = make_oid(1 + i * 3);
        let right_oid = make_oid(2 + i * 3);
        let merge_oid = make_oid(3 + i * 3);

        let ccd_base = (i as u64 + 1) * 100;
        parents_map.insert(left_oid, vec![prev_commit]);
        parents_map.insert(right_oid, vec![prev_commit]);
        parents_map.insert(merge_oid, vec![left_oid, right_oid]);

        ccd_map.insert(left_oid, CorrectedCommitDate(ccd_base + 10));
        ccd_map.insert(right_oid, CorrectedCommitDate(ccd_base + 10));
        ccd_map.insert(merge_oid, CorrectedCommitDate(ccd_base + 20));

        prev_commit = merge_oid;
    }

    let leaf_oid = prev_commit;
    let midway_ancestor_oid = make_oid(steps / 2 * 3);
    let disconnected_oid = make_oid(steps * 3 + 99);

    SyntheticDag {
        root_oid,
        leaf_oid,
        node_count: total_nodes,
        midway_ancestor_oid,
        disconnected_oid,
        parents_map,
        ccd_map,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_diamond_dag_monotonicity() {
        let dag = generate_diamond_dag(10);
        assert_eq!(dag.node_count, 31);
        assert!(dag.ccd_map[&dag.root_oid] < dag.ccd_map[&dag.leaf_oid]);
        assert_eq!(dag.parents_map[&dag.leaf_oid].len(), 2);
    }
}
