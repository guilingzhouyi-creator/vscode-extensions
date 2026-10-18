//! Module: fg-core — Trait Abstractions Facade
//! File Path: crates/fg-core/src/traits/mod.rs

pub mod gate;
pub mod odb;
pub mod refs;
pub mod reclaimer;

pub use gate::{GateVerdict, GateVerifier, StagedCandidate};
pub use odb::OdbStore;
pub use refs::RefStore;
pub use reclaimer::{ReclamationAudit, WorktreeReclaimer};
