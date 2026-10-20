//! Module: fg-object — Canonical Git Object Codecs Facade
//! File Path: crates/fg-object/src/lib.rs
//! Architecture Role: Pure Git object format codec engine (Blob, Tree, Commit) for Fractal Git.
//! Dependencies & Triggers: Upstream of fg-storage, fg-index, fg-topology, and Taxis CLI.
//! Responsibilities: Facade re-exporting owned and zero-copy borrowed Git object models.
//! Exit Semantics & Design Rationale: Centralizes object model exports with immutable facades.

pub mod blob;
pub mod borrowed;
pub mod commit;
pub mod tree;

pub use blob::GitBlob;
pub use borrowed::{GitCommitRef, GitTreeEntryRef, GitTreeIter, GitTreeRef, SmallParentList};
pub use commit::GitCommit;
pub use tree::{FileMode, GitTree, GitTreeEntry};
