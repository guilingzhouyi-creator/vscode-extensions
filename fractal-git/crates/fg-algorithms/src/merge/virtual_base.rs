//! Module: fg-algorithms — Recursive Virtual Merge Base Synthesizer
//! File Path: crates/fg-algorithms/src/merge/virtual_base.rs
//! Architecture Role: Pure algorithmic operator synthesizing in-memory virtual merge base trees
//!   in criss-cross DAG histories with multiple common ancestors
//!   (following Git's merge-ort strategy).
//! Dependencies & Triggers: Consumed by ThreeWayMerge, PreReceiveGuard, and Taxis merge commands.
//! Responsibilities: Recursively reconcile divergent ancestor trees in memory without disk I/O,
//!   producing a canonical virtual base tree for unambiguous 3-way branch reconciliation.
//! Exit Semantics & Design Rationale:
//!   - Completely avoids filesystem access or lock acquisition during virtual base construction.
//!   - Safely preserves unmerged conflict slots when synthesizing ancestor states.

use fg_core::models::Oid;
use std::collections::BTreeMap;

use super::three_way::{ThreeWayMerge, ThreeWayMergeResult};

/// Pure in-memory synthesizer for virtual merge base trees across multiple common ancestors.
pub struct VirtualMergeBaseSynthesizer;

impl VirtualMergeBaseSynthesizer {
    /// Synthesizes an in-memory virtual merge base tree from multiple common ancestors.
    ///
    /// In criss-cross branch histories where two branches diverge from multiple common ancestors,
    /// this merges ancestor trees in memory (following Git's merge-ort virtual base strategy).
    /// If an optional root base (`ancestor_base`) is provided, clean 3-way reconciliation occurs;
    /// otherwise, disjoint and non-conflicting entries are consolidated.
    pub fn synthesize_virtual_base(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
    ) -> BTreeMap<String, Oid> {
        if bases.is_empty() {
            return BTreeMap::new();
        }
        if bases.len() == 1 {
            return (*bases[0]).clone();
        }

        let empty = BTreeMap::new();
        let base_tree = ancestor_base.unwrap_or(&empty);

        let mut current_base = (*bases[0]).clone();
        for next_base in &bases[1..] {
            match ThreeWayMerge::merge(base_tree, &current_base, next_base) {
                ThreeWayMergeResult::FastForward => {
                    current_base = (*next_base).clone();
                }
                ThreeWayMergeResult::Clean { merged_tree } => {
                    current_base = merged_tree;
                }
                ThreeWayMergeResult::Conflicted {
                    mut merged_tree,
                    conflicts,
                } => {
                    // For virtual base synthesis, preserve either branch's entry
                    // for conflicted slots
                    for conflict in conflicts {
                        if let Some(oid) = conflict.ours_oid.or(conflict.theirs_oid) {
                            merged_tree.insert(conflict.path, oid);
                        }
                    }
                    current_base = merged_tree;
                }
            }
        }
        current_base
    }

    /// Evaluates a 3-way tree merge with multiple common ancestors, synthesizing
    /// an in-memory virtual base tree.
    pub fn merge_with_virtual_bases(
        ancestor_base: Option<&BTreeMap<String, Oid>>,
        bases: &[&BTreeMap<String, Oid>],
        ours: &BTreeMap<String, Oid>,
        theirs: &BTreeMap<String, Oid>,
    ) -> ThreeWayMergeResult {
        let virtual_base = Self::synthesize_virtual_base(ancestor_base, bases);
        ThreeWayMerge::merge(&virtual_base, ours, theirs)
    }
}
