//! Module: fg-object — Canonical Git Tree Codec
//! File Path: crates/fg-object/src/tree.rs
//! Architecture Role: Pure Git tree object primitives, encoding and sorting entries
//!   strictly according to Git's canonical binary specification (`<mode> <name>\0<20-byte-sha1>`).

use fg_core::models::Oid;
use sha1::{Digest, Sha1};

/// Git Tree file mode enumeration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileMode {
    RegularFile = 0o100644,
    ExecutableFile = 0o100755,
    Directory = 0o040000,
    Symlink = 0o120000,
}

impl FileMode {
    /// Formats mode as an octal string used in Git tree serialization.
    pub fn as_octal_str(&self) -> &'static str {
        use fg_core::constants::git::*;
        match self {
            Self::RegularFile => MODE_REGULAR_STR,
            Self::ExecutableFile => MODE_EXECUTABLE_STR,
            Self::Directory => MODE_DIRECTORY_STR,
            Self::Symlink => MODE_SYMLINK_STR,
        }
    }
}

/// A single entry within a Git Tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTreeEntry {
    pub mode: FileMode,
    pub name: String,
    pub oid_hex: String,
    pub oid: Oid,
}

impl GitTreeEntry {
    /// Creates a tree entry from mode, filename, and 40-character hex string or Oid.
    pub fn new(mode: FileMode, name: impl Into<String>, oid_hex: impl Into<String>) -> Self {
        let hex = oid_hex.into();
        let oid = Oid::from_hex(&hex).unwrap_or(Oid::ZERO);
        Self {
            mode,
            name: name.into(),
            oid_hex: hex,
            oid,
        }
    }

    /// Creates a tree entry from mode, filename, and typed Oid.
    pub fn from_oid(mode: FileMode, name: impl Into<String>, oid: Oid) -> Self {
        let oid_hex = oid.to_hex();
        Self {
            mode,
            name: name.into(),
            oid_hex,
            oid,
        }
    }

    /// Access raw 20-byte binary slice.
    pub fn binary_oid(&self) -> [u8; 20] {
        *self.oid.as_bytes()
    }
}

/// Pure Git Tree representation with canonical sorting rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTree {
    entries: Vec<GitTreeEntry>,
    oid: Oid,
    hex: String,
}

impl GitTree {
    /// Builds and sorts a canonical GitTree from entry collection.
    pub fn new(mut entries: Vec<GitTreeEntry>) -> Self {
        // Canonical Git tree sorting: sort by name, comparing directories as if ending with '/'
        entries.sort_by(|left_entry, right_entry| {
            let left_is_dir = left_entry.mode == FileMode::Directory;
            let right_is_dir = right_entry.mode == FileMode::Directory;
            let left_bytes = left_entry
                .name
                .as_bytes()
                .iter()
                .copied()
                .chain(if left_is_dir { Some(b'/') } else { None });
            let right_bytes = right_entry
                .name
                .as_bytes()
                .iter()
                .copied()
                .chain(if right_is_dir { Some(b'/') } else { None });
            left_bytes.cmp(right_bytes)
        });

        let raw_payload = Self::serialize_entries(&entries);
        let oid = Self::compute_tree_oid(&raw_payload);
        let hex = oid.to_hex();
        Self { entries, oid, hex }
    }

    /// Access the 40-character hexadecimal SHA-1 identifier of the tree.
    pub fn oid(&self) -> &str {
        &self.hex
    }

    /// Access the 40-character hexadecimal SHA-1 identifier of the tree (explicit getter).
    pub fn oid_hex(&self) -> &str {
        &self.hex
    }

    /// Access the typed 20-byte Oid.
    pub fn raw_oid(&self) -> &Oid {
        &self.oid
    }

    /// Access the ordered slice of entries.
    pub fn entries(&self) -> &[GitTreeEntry] {
        &self.entries
    }

    /// Returns the raw Git loose object format: `tree <size>\0<entries>`
    pub fn to_raw_object(&self) -> Vec<u8> {
        let payload = Self::serialize_entries(&self.entries);
        let header = format!("tree {}\0", payload.len());
        let mut raw = Vec::with_capacity(header.len() + payload.len());
        raw.extend_from_slice(header.as_bytes());
        raw.extend_from_slice(&payload);
        raw
    }

    fn serialize_entries(entries: &[GitTreeEntry]) -> Vec<u8> {
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

    fn compute_tree_oid(payload: &[u8]) -> Oid {
        let mut hasher = Sha1::new();
        hasher.update(format!("tree {}\0", payload.len()).as_bytes());
        hasher.update(payload);
        let hash: [u8; 20] = hasher.finalize().into();
        Oid::from_bytes(hash)
    }
}
