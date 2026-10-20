//! Crate: fg-core (Fractal Git Core Domain)
//! File Path: crates/fg-core/src/lib.rs
//! Architecture Role: Root foundation crate defining atomic models, global error types,
//!   and dependency-inversion trait abstractions (OdbStore, RefStore,
//!   GateVerifier, WorktreeReclaimer).

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
