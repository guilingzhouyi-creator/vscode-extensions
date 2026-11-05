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

/// Rename-aware 3-way tree merge operator.
pub struct RenameMergeEngine;

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

        let mut ours_sources: Vec<(&String, &Oid)> = Vec::new();
        let mut ours_dests: Vec<(&String, &Oid)> = Vec::new();
        for (path, oid) in base {
            if !ours.contains_key(path) {
                ours_sources.push((path, oid));
            }
        }
        for (path, oid) in ours {
            if !base.contains_key(path) {
                ours_dests.push((path, oid));
            }
        }

        let mut theirs_sources: Vec<(&String, &Oid)> = Vec::new();
        let mut theirs_dests: Vec<(&String, &Oid)> = Vec::new();
        for (path, oid) in base {
            if !theirs.contains_key(path) {
                theirs_sources.push((path, oid));
            }
        }
        for (path, oid) in theirs {
            if !base.contains_key(path) {
                theirs_dests.push((path, oid));
            }
        }

        if (ours_sources.is_empty() || ours_dests.is_empty())
            && (theirs_sources.is_empty() || theirs_dests.is_empty())
        {
            return ThreeWayMerge::merge(base, ours, theirs);
        }

        let ours_renames = Self::collect_renames_for_side(&ours_sources, &ours_dests, &mut get_payload);
        let theirs_renames =
            Self::collect_renames_for_side(&theirs_sources, &theirs_dests, &mut get_payload);

        if ours_renames.is_empty() && theirs_renames.is_empty() {
            return ThreeWayMerge::merge(base, ours, theirs);
        }

        let mut eff_base = base.clone();
        let mut eff_ours = ours.clone();
        let mut eff_theirs = theirs.clone();
        let mut rename_conflicts = Vec::new();

        let mut all_sources: BTreeSet<String> = BTreeSet::new();
        for k in ours_renames.keys() {
            all_sources.insert(k.clone());
        }
        for k in theirs_renames.keys() {
            all_sources.insert(k.clone());
        }

        for src in all_sources {
            let b_oid = base.get(&src).copied();
            let o_dest = ours_renames.get(&src);
            let t_dest = theirs_renames.get(&src);

            match (o_dest, t_dest) {
                (Some(o_dst), Some(t_dst)) if o_dst == t_dst => {
                    eff_base.remove(&src);
                    eff_ours.remove(&src);
                    eff_theirs.remove(&src);
                    if let Some(oid) = b_oid {
                        eff_base.insert(o_dst.clone(), oid);
                    }
                }
                (Some(o_dst), Some(t_dst)) => {
                    eff_base.remove(&src);
                    eff_ours.remove(o_dst);
                    eff_theirs.remove(t_dst);
                    rename_conflicts.push(ConflictEntry {
                        path: format!("{o_dst} (rename/rename conflict: {src} -> {o_dst} vs {t_dst})"),
                        base_oid: b_oid,
                        ours_oid: ours.get(o_dst).copied(),
                        theirs_oid: theirs.get(t_dst).copied(),
                    });
                }
                (Some(o_dst), None) => {
                    eff_base.remove(&src);
                    if theirs.contains_key(o_dst) {
                        eff_ours.remove(o_dst);
                        rename_conflicts.push(ConflictEntry {
                            path: format!("{o_dst} (rename/add collision: {src} -> {o_dst})"),
                            base_oid: b_oid,
                            ours_oid: ours.get(o_dst).copied(),
                            theirs_oid: theirs.get(o_dst).copied(),
                        });
                    } else {
                        if let Some(oid) = b_oid {
                            eff_base.insert(o_dst.clone(), oid);
                        }
                        if let Some(&t_oid) = theirs.get(&src) {
                            eff_theirs.remove(&src);
                            eff_theirs.insert(o_dst.clone(), t_oid);
                        } else {
                            rename_conflicts.push(ConflictEntry {
                                path: o_dst.clone(),
                                base_oid: b_oid,
                                ours_oid: ours.get(o_dst).copied(),
                                theirs_oid: None,
                            });
                        }
                    }
                }
                (None, Some(t_dst)) => {
                    eff_base.remove(&src);
                    if ours.contains_key(t_dst) {
                        eff_theirs.remove(t_dst);
                        rename_conflicts.push(ConflictEntry {
                            path: format!("{t_dst} (rename/add collision: {src} -> {t_dst})"),
                            base_oid: b_oid,
                            ours_oid: ours.get(t_dst).copied(),
                            theirs_oid: theirs.get(t_dst).copied(),
                        });
                    } else {
                        if let Some(oid) = b_oid {
                            eff_base.insert(t_dst.clone(), oid);
                        }
                        if let Some(&o_oid) = ours.get(&src) {
                            eff_ours.remove(&src);
                            eff_ours.insert(t_dst.clone(), o_oid);
                        } else {
                            rename_conflicts.push(ConflictEntry {
                                path: t_dst.clone(),
                                base_oid: b_oid,
                                ours_oid: None,
                                theirs_oid: theirs.get(t_dst).copied(),
                            });
                        }
                    }
                }
                (None, None) => {}
            }
        }

        let mut merge_result = ThreeWayMerge::merge(&eff_base, &eff_ours, &eff_theirs);
        if let ThreeWayMergeResult::FastForward = merge_result {
            merge_result = ThreeWayMergeResult::Clean {
                merged_tree: eff_theirs,
            };
        }

        if !rename_conflicts.is_empty() {
            match &mut merge_result {
                ThreeWayMergeResult::Clean { merged_tree } => {
                    merge_result = ThreeWayMergeResult::Conflicted {
                        merged_tree: std::mem::take(merged_tree),
                        conflicts: rename_conflicts,
                    };
                }
                ThreeWayMergeResult::Conflicted { conflicts, .. } => {
                    conflicts.extend(rename_conflicts);
                }
                ThreeWayMergeResult::FastForward => {
                    merge_result = ThreeWayMergeResult::Conflicted {
                        merged_tree: BTreeMap::new(),
                        conflicts: rename_conflicts,
                    };
                }
            }
        }
        merge_result
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
