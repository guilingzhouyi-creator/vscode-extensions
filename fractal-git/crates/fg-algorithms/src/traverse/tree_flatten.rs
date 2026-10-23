//! Module: fg-algorithms — Merkle Tree Flattening Traversal Operator
//! File Path: crates/fg-algorithms/src/traverse/tree_flatten.rs
//! Architecture Role: Pure algorithmic Merkle tree walking and flattening operator decoupled
//!   from repository views and filesystem abstractions. Recursively decodes tree nodes
//!   into flat hierarchical path-to-entry mappings with zero heap bloat.
//! Dependencies & Triggers: Consumed by diff, status, checkout, merge, and rebase operations.
//! Responsibilities: Decodes GitTree objects into canonical flattened mappings, parses commit
//!   tree root OIDs, and resolves nested subtree paths.
//! Exit Semantics & Design Rationale:
//!   - Uses generic callback `F: Fn(&Oid) -> FractalResult<P>` for payload retrieval, decoupling
//!     algorithmic traversal from storage/IO layers.
//!   - Maintains canonical Git sorting and hierarchical path concatenation.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git plumbing byte parity and tree sorting guard
//! - `FGT-PRF-001`: Pure algorithmic computation with minimal allocation

use std::collections::BTreeMap;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, Oid};
use fg_object::GitTreeRef;

/// One flattened tree entry: mode and object id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FlattenedTreeEntry {
    /// Mode recorded in the tree.
    pub mode: FileMode,
    /// Object the entry points at.
    pub oid: Oid,
}

/// Flattens one tree recursively into `flat` using an arbitrary payload reader.
pub fn flatten_tree_with<F, P>(
    tree_oid: &Oid,
    prefix: &str,
    read_payload: &F,
    flat: &mut BTreeMap<String, FlattenedTreeEntry>,
) -> FractalResult<()>
where
    F: Fn(&Oid) -> FractalResult<P>,
    P: AsRef<[u8]>,
{
    let payload = read_payload(tree_oid)?;
    for entry in GitTreeRef::from_bytes(payload.as_ref()).iter() {
        let entry = entry?;
        let path = if prefix.is_empty() {
            entry.name.to_string()
        } else {
            format!("{prefix}/{}", entry.name)
        };
        if entry.mode.is_tree() {
            flatten_tree_with(&entry.oid, &path, read_payload, flat)?;
            continue;
        }
        flat.insert(
            path,
            FlattenedTreeEntry {
                mode: entry.mode,
                oid: entry.oid,
            },
        );
    }
    Ok(())
}

/// Reads the `tree` header of a commit payload.
pub fn commit_tree_oid(payload: &[u8]) -> FractalResult<Oid> {
    let text = std::str::from_utf8(payload).map_err(|utf_err| {
        FractalError::ObjectCodec(format!("commit payload is not UTF-8: {utf_err}"))
    })?;
    for line in text.lines() {
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("tree ") {
            return Oid::from_hex(value.trim());
        }
    }
    Err(FractalError::ObjectCodec(
        "commit payload has no 'tree' header".to_string(),
    ))
}

/// Flattens the tree a commit names into a path-to-entry map using an arbitrary payload reader.
pub fn flatten_commit_tree_with<F, P>(
    commit: &Oid,
    read_payload: &F,
) -> FractalResult<BTreeMap<String, FlattenedTreeEntry>>
where
    F: Fn(&Oid) -> FractalResult<P>,
    P: AsRef<[u8]>,
{
    let commit_payload = read_payload(commit)?;
    let tree_oid = commit_tree_oid(commit_payload.as_ref())?;
    let mut flat = BTreeMap::new();
    flatten_tree_with(&tree_oid, "", read_payload, &mut flat)?;
    Ok(flat)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_object::GitTreeEntry;

    fn serialize_tree(entries: &[GitTreeEntry]) -> Vec<u8> {
        let mut buf = Vec::new();
        for entry in entries {
            buf.extend_from_slice(entry.mode.as_octal_str().as_bytes());
            buf.push(b' ');
            buf.extend_from_slice(entry.name.as_bytes());
            buf.push(0);
            buf.extend_from_slice(entry.oid.as_bytes());
        }
        buf
    }

    #[test]
    fn test_commit_tree_oid_parsing() {
        let commit_text = b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor Test <test@example.com> 0 +0000\n\nInitial commit\n";
        let tree_oid = commit_tree_oid(commit_text).unwrap();
        assert_eq!(
            tree_oid,
            Oid::from_hex("4b825dc642cb6eb9a060e54bf8d69288fbee4904").unwrap()
        );
    }

    #[test]
    fn test_flatten_tree_hierarchical() {
        let blob_oid = Oid::from_hex("1111111111111111111111111111111111111111").unwrap();
        let sub_entries = vec![GitTreeEntry::new(FileMode::RegularFile, "file.txt", blob_oid)];
        let sub_tree_bytes = serialize_tree(&sub_entries);
        let sub_tree_oid = Oid::from_hex("2222222222222222222222222222222222222222").unwrap();

        let root_entries = vec![GitTreeEntry::new(FileMode::Directory, "sub", sub_tree_oid)];
        let root_tree_bytes = serialize_tree(&root_entries);
        let root_tree_oid = Oid::from_hex("3333333333333333333333333333333333333333").unwrap();

        let reader = |oid: &Oid| -> FractalResult<Vec<u8>> {
            if *oid == root_tree_oid {
                Ok(root_tree_bytes.clone())
            } else if *oid == sub_tree_oid {
                Ok(sub_tree_bytes.clone())
            } else {
                Err(FractalError::ObjectCodec("not found".to_string()))
            }
        };

        let mut flat = BTreeMap::new();
        flatten_tree_with(&root_tree_oid, "", &reader, &mut flat).unwrap();

        assert_eq!(flat.len(), 1);
        let entry = flat.get("sub/file.txt").unwrap();
        assert_eq!(entry.mode, FileMode::RegularFile);
        assert_eq!(entry.oid, blob_oid);
    }
}
