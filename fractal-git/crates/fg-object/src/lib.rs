//! Module: fg-object — Canonical Git Object Codecs Facade
//! File Path: crates/fg-object/src/lib.rs
//! Architecture Role: Pure Git object format codec engine (Blob, Tree, Commit, annotated Tag) for
//!   Fractal Git.
//! Dependencies & Triggers: Upstream of fg-storage, fg-index, fg-topology, and Taxis CLI.
//! Responsibilities: Facade re-exporting owned and zero-copy borrowed Git object models.
//! Exit Semantics & Design Rationale: Centralizes object model exports with immutable facades.
//!
//! Domain Governance Rules: FGT-OBJ-001 (object model facade), FGT-COR-001, FGT-PRF-001.
//!
//! `FileMode` is deliberately *not* re-exported here: it lives in `fg_core::models` because the
//! index and the native container need it without depending on the object codec. Callers that
//! already depend on `fg-object` should import it from `fg_core::models::FileMode` so there is
//! exactly one path to the type.

pub mod blob;
pub mod borrowed;
pub mod commit;
pub mod tag;
pub mod tree;

pub use blob::GitBlob;
pub use borrowed::{GitCommitRef, GitTreeEntryRef, GitTreeIter, GitTreeRef, SmallParentList};
pub use commit::GitCommit;
pub use tag::{GitTag, TagCodecError};
pub use tree::{GitTree, GitTreeEntry};
