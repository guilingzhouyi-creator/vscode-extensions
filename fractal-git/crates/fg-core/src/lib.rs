//! Crate: fg-core (Fractal Git Core Domain)
//! File Path: crates/fg-core/src/lib.rs
//! Architecture Role: Root foundation crate defining atomic models, global error types,
//!   and dependency-inversion trait abstractions (OdbStore, RefStore, GateVerifier, WorktreeReclaimer).

pub mod error;
pub mod models;
pub mod traits;

pub use error::{FractalError, FractalResult};
pub use models::{AgentCommitMeta, GitSignature, Oid, PraxisCardContext};
pub use traits::{
    GateVerdict, GateVerifier, OdbStore, ReclamationAudit, RefStore, StagedCandidate,
    WorktreeReclaimer,
};
