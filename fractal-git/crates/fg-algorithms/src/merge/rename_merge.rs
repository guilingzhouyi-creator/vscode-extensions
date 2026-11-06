//! Module: fg-algorithms — Rename-Aware Three-Way Tree Merge Operator
//! File Path: crates/fg-algorithms/src/merge/rename_merge.rs
//! Architecture Role: Reconciles three-way differences across Base, Ours, and Theirs trees
//!   with similarity-based rename detection (merge-ort rename resolution).
//! Dependencies & Triggers: Dispatched by `ThreeWayMerge::merge_with_renames` in `three_way.rs`
//!   and invoked by `taxis merge`.
//! Responsibilities: Detects file renames between `base` and `ours`, as well as between `base` and
//!   `theirs`, remapping divergent modifications onto renamed target paths to eliminate false
//!   delete-modify conflicts.
//! Exit Semantics & Design Rationale:
//!   - Uses `fg_algorithms::diff::rename::detect_renames` to compute similarity matrix and exact matches.
//!   - Accurately reports rename/rename and rename/add conflicts without data corruption.
//!
//! Domain Governance Rules: FGT-ALG-001 (merge engine), FGT-COR-001, FGT-PRF-001.

use std::collections::{BTreeMap, BTreeSet};

use fg_core::models::{FileMode, Oid};

use super::three_way::{ConflictEntry, ThreeWayMerge, ThreeWayMergeResult};

struct RenameRemapState<'a> {
    base: &'a BTreeMap<String, Oid>,
    ours: &'a BTreeMap<String, Oid>,
    theirs: &'a BTreeMap<String, Oid>,
    eff_base: BTreeMap<String, Oid>,
    eff_ours: BTreeMap<String, Oid>,
    eff_theirs: BTreeMap<String, Oid>,
    rename_conflicts: Vec<ConflictEntry>,
}

/// Rename-aware 3-way tree merge operator.
pub struct RenameMergeEngine;

type DiffEndpoints<'a> = (Vec<(&'a String, &'a Oid)>, Vec<(&'a String, &'a Oid)>);

impl RenameMergeEngine {
    /// Evaluates a 3-way tree merge incorporating similarity-based rename detection.
    ///
    /// Detects file renames between `base` and `ours`, as well as between `base` and `theirs`.
    /// When a file is renamed on one branch and edited on the other, the modifications are
    /// reconciled onto the renamed target path, avoiding false delete-modify conflicts.
    pub fn merge_with_renames<F>(
        base: &BTreeMap<String, Oid>,
        ours: &BTreeMap<String, Oid>,
        theirs: &BTreeMap<String, Oid>,
        mut get_payload: F,
    ) -> ThreeWayMergeResult
    where
        F: FnMut(&Oid) -> Option<Vec<u8>>,
    {
        if ours == base {
            return ThreeWayMergeResult::FastForward;
        }

        let (ours_sources, ours_dests) = Self::collect_diff_endpoints(base, ours);
        let (theirs_sources, theirs_dests) = Self::collect_diff_endpoints(base, theirs);

        if (ours_sources.is_empty() || ours_dests.is_empty())
            && (theirs_sources.is_empty() || theirs_dests.is_empty())
        {
            return ThreeWayMerge::merge(base, ours, theirs);
        }

        let ours_renames =
            Self::collect_renames_for_side(&ours_sources, &ours_dests, &mut get_payload);
        let theirs_renames =
            Self::collect_renames_for_side(&theirs_sources, &theirs_dests, &mut get_payload);

        if ours_renames.is_empty() && theirs_renames.is_empty() {
            return ThreeWayMerge::merge(base, ours, theirs);
        }

        let mut state = RenameRemapState {
            base,
            ours,
            theirs,
            eff_base: base.clone(),
            eff_ours: ours.clone(),
            eff_theirs: theirs.clone(),
            rename_conflicts: Vec::new(),
        };

        let all_sources: BTreeSet<String> = ours_renames
            .keys()
            .chain(theirs_renames.keys())
            .cloned()
            .collect();

        for src in all_sources {
            Self::remap_renamed_source(
                &mut state,
                &src,
                (ours_renames.get(&src), theirs_renames.get(&src)),
            );
        }

        Self::finalize_rename_merge(state)
    }

    fn collect_diff_endpoints<'a>(
        base: &'a BTreeMap<String, Oid>,
        side: &'a BTreeMap<String, Oid>,
    ) -> DiffEndpoints<'a> {
        let sources = base
            .iter()
            .filter(|(path, _)| !side.contains_key(*path))
            .collect();
        let dests = side
            .iter()
            .filter(|(path, _)| !base.contains_key(*path))
            .collect();
        (sources, dests)
    }

    fn remap_renamed_source(
        state: &mut RenameRemapState<'_>,
        src: &str,
        dests: (Option<&String>, Option<&String>),
    ) {
        let (o_dest, t_dest) = dests;
        let b_oid = state.base.get(src).copied();
        match (o_dest, t_dest) {
            (Some(o_dst), Some(t_dst)) if o_dst == t_dst => {
                state.eff_base.remove(src);
                state.eff_ours.remove(src);
                state.eff_theirs.remove(src);
                if let Some(oid) = b_oid {
                    state.eff_base.insert(o_dst.clone(), oid);
                }
            }
            (Some(o_dst), Some(t_dst)) => {
                state.eff_base.remove(src);
                state.eff_ours.remove(o_dst);
                state.eff_theirs.remove(t_dst);
                state.rename_conflicts.push(ConflictEntry {
                    path: format!("{o_dst} (rename/rename conflict: {src} -> {o_dst} vs {t_dst})"),
                    base_oid: b_oid,
                    ours_oid: state.ours.get(o_dst).copied(),
                    theirs_oid: state.theirs.get(t_dst).copied(),
                });
            }
            (Some(o_dst), None) => Self::remap_ours_only_rename(state, src, o_dst, b_oid),
            (None, Some(t_dst)) => Self::remap_theirs_only_rename(state, src, t_dst, b_oid),
            (None, None) => {}
        }
    }

    fn remap_ours_only_rename(
        state: &mut RenameRemapState<'_>,
        src: &str,
        o_dst: &String,
        b_oid: Option<Oid>,
    ) {
        state.eff_base.remove(src);
        if state.theirs.contains_key(o_dst) {
            state.eff_ours.remove(o_dst);
            state.rename_conflicts.push(ConflictEntry {
                path: format!("{o_dst} (rename/add collision: {src} -> {o_dst})"),
                base_oid: b_oid,
                ours_oid: state.ours.get(o_dst).copied(),
                theirs_oid: state.theirs.get(o_dst).copied(),
            });
            return;
        }
        if let Some(oid) = b_oid {
            state.eff_base.insert(o_dst.clone(), oid);
        }
        if let Some(&t_oid) = state.theirs.get(src) {
            state.eff_theirs.remove(src);
            state.eff_theirs.insert(o_dst.clone(), t_oid);
        } else {
            state.rename_conflicts.push(ConflictEntry {
                path: o_dst.clone(),
                base_oid: b_oid,
                ours_oid: state.ours.get(o_dst).copied(),
                theirs_oid: None,
            });
        }
    }

    fn remap_theirs_only_rename(
        state: &mut RenameRemapState<'_>,
        src: &str,
        t_dst: &String,
        b_oid: Option<Oid>,
    ) {
        state.eff_base.remove(src);
        if state.ours.contains_key(t_dst) {
            state.eff_theirs.remove(t_dst);
            state.rename_conflicts.push(ConflictEntry {
                path: format!("{t_dst} (rename/add collision: {src} -> {t_dst})"),
                base_oid: b_oid,
                ours_oid: state.ours.get(t_dst).copied(),
                theirs_oid: state.theirs.get(t_dst).copied(),
            });
            return;
        }
        if let Some(oid) = b_oid {
            state.eff_base.insert(t_dst.clone(), oid);
        }
        if let Some(&o_oid) = state.ours.get(src) {
            state.eff_ours.remove(src);
            state.eff_ours.insert(t_dst.clone(), o_oid);
        } else {
            state.rename_conflicts.push(ConflictEntry {
                path: t_dst.clone(),
                base_oid: b_oid,
                ours_oid: None,
                theirs_oid: state.theirs.get(t_dst).copied(),
            });
        }
    }

    fn finalize_rename_merge(state: RenameRemapState<'_>) -> ThreeWayMergeResult {
        let mut merge_result =
            ThreeWayMerge::merge(&state.eff_base, &state.eff_ours, &state.eff_theirs);
        if let ThreeWayMergeResult::FastForward = merge_result {
            merge_result = ThreeWayMergeResult::Clean {
                merged_tree: state.eff_theirs,
            };
        }
        if state.rename_conflicts.is_empty() {
            return merge_result;
        }
        match merge_result {
            ThreeWayMergeResult::Clean { merged_tree } => ThreeWayMergeResult::Conflicted {
                merged_tree,
                conflicts: state.rename_conflicts,
            },
            ThreeWayMergeResult::Conflicted {
                merged_tree,
                mut conflicts,
            } => {
                conflicts.extend(state.rename_conflicts);
                ThreeWayMergeResult::Conflicted {
                    merged_tree,
                    conflicts,
                }
            }
            ThreeWayMergeResult::FastForward => ThreeWayMergeResult::Conflicted {
                merged_tree: BTreeMap::new(),
                conflicts: state.rename_conflicts,
            },
        }
    }

    fn collect_renames_for_side<F>(
        sources: &[(&String, &Oid)],
        dests: &[(&String, &Oid)],
        get_payload: &mut F,
    ) -> BTreeMap<String, String>
    where
        F: FnMut(&Oid) -> Option<Vec<u8>>,
    {
        let mut renames = BTreeMap::new();
        if sources.is_empty() || dests.is_empty() {
            return renames;
        }

        let src_payloads: Vec<Vec<u8>> = sources
            .iter()
            .map(|(_, oid)| get_payload(oid).unwrap_or_default())
            .collect();
        let dst_payloads: Vec<Vec<u8>> = dests
            .iter()
            .map(|(_, oid)| get_payload(oid).unwrap_or_default())
            .collect();

        let src_refs: Vec<crate::diff::BlobRef<'_>> = sources
            .iter()
            .enumerate()
            .map(|(i, (p, oid))| crate::diff::BlobRef {
                path: p.as_str(),
                mode: FileMode::RegularFile,
                oid: **oid,
                payload: &src_payloads[i],
            })
            .collect();
        let dst_refs: Vec<crate::diff::BlobRef<'_>> = dests
            .iter()
            .enumerate()
            .map(|(i, (p, oid))| crate::diff::BlobRef {
                path: p.as_str(),
                mode: FileMode::RegularFile,
                oid: **oid,
                payload: &dst_payloads[i],
            })
            .collect();

        let hits = crate::diff::detect_renames(&src_refs, &dst_refs);
        for (dst_idx, hit_opt) in hits.iter().enumerate() {
            if let Some(hit) = hit_opt {
                let src_path = (*sources[hit.source].0).clone();
                let dst_path = (*dests[dst_idx].0).clone();
                renames.insert(src_path, dst_path);
            }
        }
        renames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_with_renames_ours_renamed_theirs_modified() {
        let oid_base = Oid::from_bytes([1u8; 20]);
        let oid_mod = Oid::from_bytes([2u8; 20]);

        let mut base = BTreeMap::new();
        base.insert("hello.txt".to_string(), oid_base);

        let mut ours = BTreeMap::new();
        ours.insert("greeting.txt".to_string(), oid_base);

        let mut theirs = BTreeMap::new();
        theirs.insert("hello.txt".to_string(), oid_mod);

        let res = RenameMergeEngine::merge_with_renames(&base, &ours, &theirs, |_| None);
        match res {
            ThreeWayMergeResult::Clean { merged_tree } => {
                assert_eq!(merged_tree.len(), 1);
                assert_eq!(merged_tree.get("greeting.txt"), Some(&oid_mod));
                assert!(!merged_tree.contains_key("hello.txt"));
            }
            other => panic!("Expected clean merge with rename remapping, got {other:?}"),
        }
    }

    #[test]
    fn test_merge_with_renames_theirs_renamed_ours_modified() {
        let oid_base = Oid::from_bytes([1u8; 20]);
        let oid_mod = Oid::from_bytes([3u8; 20]);

        let mut base = BTreeMap::new();
        base.insert("hello.txt".to_string(), oid_base);

        let mut ours = BTreeMap::new();
        ours.insert("hello.txt".to_string(), oid_mod);

        let mut theirs = BTreeMap::new();
        theirs.insert("salute.txt".to_string(), oid_base);

        let res = RenameMergeEngine::merge_with_renames(&base, &ours, &theirs, |_| None);
        match res {
            ThreeWayMergeResult::Clean { merged_tree } => {
                assert_eq!(merged_tree.len(), 1);
                assert_eq!(merged_tree.get("salute.txt"), Some(&oid_mod));
                assert!(!merged_tree.contains_key("hello.txt"));
            }
            other => panic!("Expected clean merge with rename remapping, got {other:?}"),
        }
    }

    #[test]
    fn test_merge_with_renames_divergent() {
        let oid_base = Oid::from_bytes([1u8; 20]);

        let mut base = BTreeMap::new();
        base.insert("hello.txt".to_string(), oid_base);

        let mut ours = BTreeMap::new();
        ours.insert("a.txt".to_string(), oid_base);

        let mut theirs = BTreeMap::new();
        theirs.insert("b.txt".to_string(), oid_base);

        let res = RenameMergeEngine::merge_with_renames(&base, &ours, &theirs, |_| None);
        match res {
            ThreeWayMergeResult::Conflicted { conflicts, .. } => {
                assert_eq!(conflicts.len(), 1);
                assert!(conflicts[0].path.contains("rename/rename conflict"));
            }
            other => panic!("Expected conflicted merge for divergent renames, got {other:?}"),
        }
    }
}
