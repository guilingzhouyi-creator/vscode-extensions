//! Module: fg-object — Canonical Git Object Codecs Facade
//! File Path: crates/fg-object/src/lib.rs
//! Architecture Role: Pure Git object format codec engine (Blob, Tree, Commit) for Fractal Git.

pub mod blob;
pub mod commit;
pub mod tree;

pub use blob::GitBlob;
pub use commit::GitCommit;
pub use tree::{FileMode, GitTree, GitTreeEntry};
