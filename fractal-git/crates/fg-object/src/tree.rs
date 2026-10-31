//! Module: fg-object — Canonical Git Tree Codec
//! File Path: crates/fg-object/src/tree.rs
//! Architecture Role: Pure Git tree object primitives, encoding and sorting entries
//!   strictly according to Git's canonical binary specification (`<mode> <name>\0<20-byte-sha1>`).
//! Dependencies & Triggers: Consumed by fg-index tree assembly, fg-storage materialization, and
//!   every command that resolves a revision to a directory listing.
//! Responsibilities: Canonical tree sorting, binary serialization, and object-id computation.
//! Exit Semantics & Design Rationale:
//!   - The file mode is [`fg_core::models::FileMode`], not a local copy: the index, the native
//!     container, and the tree codec must agree on the same five values, and a second enum would
//!     let one layer accept a mode the others reject.
//!   - Entries are sorted with a directory treated as if its name ended in `/`, which is Git's
//!     documented rule; sorting by plain name produces a different object id for the same content.
//!
//! Domain Governance Rules: FGT-OBJ-001 (tree object codec & canonical sorting), FGT-COR-001, FGT-PRF-001.

use fg_core::models::{compute_object_oid, raw_object, FileMode, ObjectKind, Oid};

/// A single entry within a Git Tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTreeEntry {
    /// Kind of object this entry names.
    pub mode: FileMode,
    /// Entry name relative to the containing tree; never contains a separator.
    pub name: String,
    /// Object this entry points at.
    pub oid: Oid,
}

impl GitTreeEntry {
    /// Creates a tree entry from a mode, name, and typed object id.
    pub fn new(mode: FileMode, name: impl Into<String>, oid: Oid) -> Self {
        Self {
            mode,
            name: name.into(),
            oid,
        }
    }

    /// Creates a tree entry from a mode, name, and 40-character hexadecimal object id.
    ///
    /// # Errors
    ///
    /// Returns [`fg_core::error::FractalError::ObjectCodec`] when the hex text is not a valid
    /// 40-character object id. The previous signature silently substituted the all-zero id, which
    /// turned a typo into a dangling tree entry that no integrity check could detect.
    pub fn from_hex(
        mode: FileMode,
        name: impl Into<String>,
        oid_hex: &str,
    ) -> fg_core::error::FractalResult<Self> {
        Ok(Self {
            mode,
            name: name.into(),
            oid: Oid::from_hex(oid_hex)?,
        })
    }

    /// Returns the 40-character lowercase hexadecimal object id.
    pub fn oid_hex(&self) -> String {
        self.oid.to_hex()
    }

    /// Compares two tree entries according to Git's canonical binary sorting rule:
    /// directory entries are compared as if their names ended with a trailing slash (`/`).
    pub fn cmp_canonical(&self, other: &Self) -> std::cmp::Ordering {
        let self_is_dir = self.mode.is_tree();
        let other_is_dir = other.mode.is_tree();
        if !self_is_dir && !other_is_dir {
            return self.name.cmp(&other.name);
        }
        let self_bytes =
            self.name
                .as_bytes()
                .iter()
                .copied()
                .chain(if self_is_dir { Some(b'/') } else { None });
        let other_bytes = other
            .name
            .as_bytes()
            .iter()
            .copied()
            .chain(if other_is_dir { Some(b'/') } else { None });
        self_bytes.cmp(other_bytes)
    }
}

/// Pure Git Tree representation with canonical sorting rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTree {
    entries: Vec<GitTreeEntry>,
    oid: Oid,
}

impl GitTree {
    /// Sorts `entries` in-place using Git's canonical tree comparator and returns the raw tree
    /// payload bytes (`<octal-mode> <name>\0<20B-oid>`, without the loose `tree <size>\0` header).
    #[must_use]
    pub fn serialize_sorted_entries(entries: &mut [GitTreeEntry]) -> Vec<u8> {
        entries.sort_by(GitTreeEntry::cmp_canonical);
        Self::serialize_entries(entries)
    }

    /// Builds and sorts a canonical GitTree from an entry collection.
    pub fn new(mut entries: Vec<GitTreeEntry>) -> Self {
        let raw_payload = Self::serialize_sorted_entries(&mut entries);
        let oid = Self::compute_tree_oid(&raw_payload);
        Self { entries, oid }
    }

    /// Returns the typed 20-byte object id of this tree.
    pub const fn oid(&self) -> &Oid {
        &self.oid
    }

    /// Returns the 40-character lowercase hexadecimal object id of this tree.
    pub fn oid_hex(&self) -> String {
        self.oid.to_hex()
    }

    /// Returns the ordered slice of entries.
    pub fn entries(&self) -> &[GitTreeEntry] {
        &self.entries
    }

    /// Returns the canonical tree payload bytes without the loose `tree <size>\0` header.
    #[must_use]
    pub fn to_payload(&self) -> Vec<u8> {
        Self::serialize_entries(&self.entries)
    }

    /// Returns the raw Git loose object format: `tree <size>\0<entries>`
    pub fn to_raw_object(&self) -> Vec<u8> {
        raw_object(ObjectKind::Tree, &self.to_payload())
    }

    fn serialize_entries(entries: &[GitTreeEntry]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(entries.len() * 40);
        for entry in entries {
            buf.extend_from_slice(entry.mode.as_octal_str().as_bytes());
            buf.push(b' ');
            buf.extend_from_slice(entry.name.as_bytes());
            buf.push(0);
            buf.extend_from_slice(entry.oid.as_bytes());
        }
        buf
    }

    fn compute_tree_oid(payload: &[u8]) -> Oid {
        compute_object_oid(ObjectKind::Tree, payload)
    }
}
