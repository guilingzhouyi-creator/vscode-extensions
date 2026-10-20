//! Module: fg-core — Fractal Git Core Domain Foundation
//! File Path: crates/fg-core/src/lib.rs
//! Architecture Role: Root foundation crate defining atomic models, global error types,
//!   and dependency-inversion trait abstractions (OdbStore, RefStore,
//!   GateVerifier, WorktreeReclaimer).
//! Dependencies & Triggers: Depended upon by all Taxis micro-crates and CLI binary.
//! Responsibilities: Core atomic domain models, zero-panic error classification, and trait contracts.
//! Exit Semantics & Design Rationale: Standardizes fundamental types with zero circular dependencies.

pub mod constants;
pub mod error;
pub mod models;
pub mod traits;

pub use constants::{
    format_uac_proposal_summary, is_recognized_ref_prefix, is_registered_fgt_rule,
    is_valid_benchmark_metric,
};

pub use error::{FractalError, FractalResult};
pub use models::{
    ActorIdentity, AgentCommitMeta, AgentPushContext, AuthorityTier, AutoQualityScoreEnvelope,
    DiffCoherenceMode, FastOidHasher, FastOidMap, FastOidSet, GitSignature, HumanUacProof, Oid,
    PraxisCardContext, StagedPromotionRequest, StagedPromotionStatus, TaxisPolicy,
    ValidatedCommitWitness,
};
pub use traits::{
    GateVerdict, GateVerifier, OdbStore, ReclamationAudit, RefStore, StagedCandidate,
    WorktreeReclaimer,
};
