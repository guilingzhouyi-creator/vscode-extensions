//! Module: taxis_cmd::daemon_scheduler — Inter-Revision Semantic ELOC Delta Calculator
//! File Path: src/bin/taxis_cmd/daemon_scheduler/eloc_diff.rs
//! Architecture Role: Computes exact semantic changed ELOC between two immutable ODB snapshot
//!   trees while ignoring pure comment/blank line additions for delta anti-gaming conjunction.
//! Dependencies & Triggers: Invoked by `materialize.rs` and scheduler unit tests.
//! Responsibilities: Measure modified, added, and deleted blob semantic line counts without I/O.
//! Exit Semantics & Design Rationale: Uses front/back trim cursor passes with zero heap loops.

use std::collections::BTreeMap;

use fg_core::models::{parse_loose_header, ObjectKind, Oid};
use fg_core::traits::OdbStore;
use fractal_git::LooseOdb;

use super::eloc_scan::{count_semantic_lines, next_semantic_line_fwd, prev_semantic_line_bwd};
use super::AuditedSnapshotBaseline;

pub(super) fn compute_changed_eloc_against_baseline(
    odb: &LooseOdb,
    baseline_opt: Option<&AuditedSnapshotBaseline>,
    curr_ordered: &BTreeMap<String, Oid>,
    curr_files: &[(String, Vec<u8>)],
) -> usize {
    let Some(baseline) = baseline_opt else {
        let mut initial_eloc = 0usize;
        for (_rel_path, content) in curr_files {
            initial_eloc += count_semantic_lines(content);
        }
        return initial_eloc;
    };

    let mut total_delta = 0usize;
    for (rel_path, curr_bytes) in curr_files {
        let curr_oid = curr_ordered.get(rel_path);
        match baseline.blobs.get(rel_path) {
            Some(old_oid) if curr_oid == Some(old_oid) => {}
            Some(old_oid) => {
                total_delta += diff_blob_against_new_bytes(odb, old_oid, curr_bytes);
            }
            None => {
                total_delta += count_semantic_lines(curr_bytes);
            }
        }
    }
    for (old_path, old_oid) in &baseline.blobs {
        if !curr_ordered.contains_key(old_path) {
            total_delta += count_blob_semantic_lines(odb, old_oid);
        }
    }
    total_delta
}

fn diff_blob_against_new_bytes(odb: &LooseOdb, old_oid: &Oid, new_bytes: &[u8]) -> usize {
    let Ok(raw_old) = odb.read_object(old_oid) else {
        return count_semantic_lines(new_bytes);
    };
    let Ok((ObjectKind::Blob, old_bytes)) = parse_loose_header(&raw_old) else {
        return count_semantic_lines(new_bytes);
    };
    diff_file_semantic_eloc(old_bytes, new_bytes)
}

fn count_blob_semantic_lines(odb: &LooseOdb, blob_oid: &Oid) -> usize {
    let Ok(raw_blob) = odb.read_object(blob_oid) else {
        return 0;
    };
    let Ok((ObjectKind::Blob, content)) = parse_loose_header(&raw_blob) else {
        return 0;
    };
    if content.contains(&0) || content.len() > 512 * 1024 {
        return 0;
    }
    count_semantic_lines(content)
}

pub(super) fn diff_file_semantic_eloc(old_bytes: &[u8], new_bytes: &[u8]) -> usize {
    if old_bytes == new_bytes {
        return 0;
    }
    let old_eloc = count_semantic_lines(old_bytes);
    let new_eloc = count_semantic_lines(new_bytes);
    let mut old_fwd = 0usize;
    let mut new_fwd = 0usize;
    let mut matched = 0usize;

    loop {
        let saved_old = old_fwd;
        let saved_new = new_fwd;
        match (
            next_semantic_line_fwd(old_bytes, &mut old_fwd, old_bytes.len()),
            next_semantic_line_fwd(new_bytes, &mut new_fwd, new_bytes.len()),
        ) {
            (Some(old_line), Some(new_line)) if old_line == new_line => {
                matched += 1;
            }
            _ => {
                old_fwd = saved_old;
                new_fwd = saved_new;
                break;
            }
        }
    }

    let mut old_bwd = old_bytes.len();
    let mut new_bwd = new_bytes.len();
    while matched < old_eloc.min(new_eloc) {
        match (
            prev_semantic_line_bwd(old_bytes, &mut old_bwd, old_fwd),
            prev_semantic_line_bwd(new_bytes, &mut new_bwd, new_fwd),
        ) {
            (Some(old_line), Some(new_line)) if old_line == new_line => {
                matched += 1;
            }
            _ => break,
        }
    }

    old_eloc
        .saturating_sub(matched)
        .max(new_eloc.saturating_sub(matched))
}
