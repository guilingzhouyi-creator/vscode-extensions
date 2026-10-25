//! Module: fg-core — Domain Models Facade
//! File Path: crates/fg-core/src/models/mod.rs
//! Architecture Role: Domain entities, invariants, and fundamental value objects for Taxis.
//! Dependencies & Triggers: Depended upon across all Taxis micro-crates and CLI binary.
//! Responsibilities: Central re-export point for OID, ChangeId, generation numbers, and policy.
//! Exit Semantics & Design Rationale: Exposes core immutable domain abstractions without cycles.

pub mod authority;
pub mod blackboard;
pub mod bloom;
pub mod change_id;
pub mod commit_witness;
pub mod context;
pub mod file_mode;
pub mod generation;
pub mod git_object_id;
pub mod identity;
pub mod index_stage;
pub mod interactive;
pub mod oid;
pub mod policy;
pub mod provenance;
pub mod repo_path;
pub mod signature;
pub mod submodule;
pub mod uac;

pub use authority::{
    current_unix_seconds, AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION,
    AUTHORITY_SECRET_ENV,
};
pub use blackboard::{BlackboardCollision, CardBlackboard, IntentLease, SymbolClaim};
pub use bloom::PathBloomFilter;
pub use change_id::ChangeId;
pub use commit_witness::ValidatedCommitWitness;
pub use context::{AgentCommitMeta, PraxisCardContext};
pub use file_mode::FileMode;
pub use generation::CorrectedCommitDate;
pub use git_object_id::{compute_object_oid, raw_object, ObjectKind};
pub use identity::{ActorIdentity, AgentPushContext, AuthorityTier};
pub use index_stage::IndexStage;
pub use interactive::{PatchHunkChoice, PatchPlan, RebaseAction, RebaseItem, RebasePlan};
pub use oid::{FastOidHasher, FastOidMap, FastOidSet, Oid};
pub use policy::{ConflictPresentationMode, DiffCoherenceMode, TaxisPolicy};
pub use provenance::{BlockProvenanceEntry, BlockProvenanceParams, ProvenanceLedger};
pub use repo_path::{safe_join, validate_repo_relative_path, RepoPath};
pub use signature::GitSignature;
pub use submodule::{SubmoduleEntry, SubmoduleUpdateStrategy};
pub use uac::{
    AutoQualityScoreEnvelope, HumanUacProof, StagedPromotionRequest, StagedPromotionStatus,
};
