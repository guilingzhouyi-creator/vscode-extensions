//! Module: fg-topology — Audit Tree Merkle Trie & Commit Payload Helpers
//! File Path: crates/fg-topology/src/audit_tree/trie.rs
//! Architecture Role: Pure-ODB trie builders, canonical Git tree key comparators, and signed
//!   audit commit payload formatters decoupled from upward rollup orchestration.
//! Dependencies & Triggers: Uses `fg_core::{OdbStore, GitSignature, Oid}`; called by `audit_tree`.
//! Responsibilities: Insert blobs into in-memory tries, write canonical Git trees, and format commits.
//! Exit Semantics & Design Rationale: Avoids cloning path strings inside tree serialization loops.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{GitSignature, Oid};
use fg_core::traits::OdbStore;

const OBJ_TREE: &str = "tree";
const MODE_FILE_STR: &str = "100644";
const MODE_DIR_STR: &str = "40000";

pub(crate) enum TreeNode {
    Blob(Oid),
    Dir(BTreeMap<String, TreeNode>),
}

pub(crate) fn sanitize_ref_component(raw: &str) -> String {
    raw.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn insert_trie_entry(
    node: &mut BTreeMap<String, TreeNode>,
    rel_path: &str,
    blob_oid: Oid,
) -> FractalResult<()> {
    let mut parts = rel_path.split('/').peekable();
    let mut current = node;
    while let Some(segment) = parts.next() {
        if segment.is_empty() {
            return Err(FractalError::PolicyViolation(format!(
                "empty segment in audit path '{rel_path}'"
            )));
        }
        if parts.peek().is_none() {
            current.insert(String::from(segment), TreeNode::Blob(blob_oid));
            return Ok(());
        }
        let entry = current
            .entry(String::from(segment))
            .or_insert_with(|| TreeNode::Dir(BTreeMap::new()));
        match entry {
            TreeNode::Dir(child_map) => current = child_map,
            TreeNode::Blob(_) => {
                return Err(FractalError::PolicyViolation(format!(
                    "audit tree file/dir collision on '{rel_path}'"
                )));
            }
        }
    }
    Ok(())
}

pub(crate) fn cmp_git_tree_key(a_name: &str, a_is_dir: bool, b_name: &str, b_is_dir: bool) -> Ordering {
    let mut a_bytes = a_name.as_bytes().iter().copied();
    let mut b_bytes = b_name.as_bytes().iter().copied();
    loop {
        match (a_bytes.next(), b_bytes.next()) {
            (Some(ac), Some(bc)) => match ac.cmp(&bc) {
                Ordering::Equal => continue,
                non_eq => return non_eq,
            },
            (None, None) => return a_is_dir.cmp(&b_is_dir),
            (None, Some(bc)) => {
                return if a_is_dir { b'/'.cmp(&bc) } else { Ordering::Less };
            }
            (Some(ac), None) => {
                return if b_is_dir { ac.cmp(&b'/') } else { Ordering::Greater };
            }
        }
    }
}

pub(crate) fn write_tree_node(
    odb: &impl OdbStore,
    entries: &BTreeMap<String, TreeNode>,
) -> FractalResult<Oid> {
    let mut resolved: Vec<(&str, bool, Oid)> = Vec::with_capacity(entries.len());
    for (name, child) in entries {
        match child {
            TreeNode::Blob(oid) => resolved.push((name.as_str(), false, *oid)),
            TreeNode::Dir(sub_map) => {
                let sub_oid = write_tree_node(odb, sub_map)?;
                resolved.push((name.as_str(), true, sub_oid));
            }
        }
    }
    resolved.sort_by(|left, right| cmp_git_tree_key(left.0, left.1, right.0, right.1));

    let mut payload = Vec::with_capacity(resolved.len() * 48);
    for (name, is_dir, oid) in &resolved {
        payload.extend_from_slice((if *is_dir { MODE_DIR_STR } else { MODE_FILE_STR }).as_bytes());
        payload.push(b' ');
        payload.extend_from_slice(name.as_bytes());
        payload.push(0);
        payload.extend_from_slice(oid.as_bytes());
    }
    odb.write_object(OBJ_TREE, &payload)
}

pub(crate) fn format_audit_commit_payload(
    tree_oid: Oid,
    prev_parent: Option<Oid>,
    extra_parents: &[Oid],
    author: &GitSignature,
    source_commit: Option<Oid>,
    message: &str,
) -> String {
    let mut payload = String::with_capacity(256 + message.len());
    payload.push_str(&format!("tree {}\n", tree_oid.to_hex()));

    let mut seen_parents: Vec<Oid> = Vec::with_capacity(1 + extra_parents.len());
    if let Some(prev) = prev_parent {
        seen_parents.push(prev);
        payload.push_str(&format!("parent {}\n", prev.to_hex()));
    }
    for &extra in extra_parents {
        if !seen_parents.contains(&extra) {
            seen_parents.push(extra);
            payload.push_str(&format!("parent {}\n", extra.to_hex()));
        }
    }

    let sig_line = author.to_git_line();
    payload.push_str(&format!("author {sig_line}\n"));
    payload.push_str(&format!("committer {sig_line}\n\n"));
    payload.push_str(message.trim_end());
    payload.push('\n');
    if let Some(source_oid) = source_commit {
        payload.push_str(&format!("\nAudit-Source-Commit: {}\n", source_oid.to_hex()));
    }
    payload
}
