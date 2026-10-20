//! Module: fg-core — Trait Abstractions Facade
//! File Path: crates/fg-core/src/traits/mod.rs

pub mod gate;
pub mod odb;
pub mod reclaimer;
pub mod refs;

pub use gate::{GateVerdict, GateVerifier, StagedCandidate};
pub use odb::OdbStore;
pub use reclaimer::{ReclamationAudit, WorktreeReclaimer};
pub use refs::RefStore;
