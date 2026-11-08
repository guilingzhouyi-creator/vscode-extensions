//! Module: fg-core — Domain Models Facade
//! File Path: crates/fg-core/src/models/mod.rs
//! Architecture Role: Domain entities, invariants, and fundamental value objects for Taxis.
//! Dependencies & Triggers: Depended upon across all Taxis kernel subsystems and CLI binary.
//! Responsibilities: Central re-export point for OID, ChangeId, generation numbers, and policy.
//! Exit Semantics & Design Rationale: Exposes core immutable domain abstractions without cycles.

pub mod audit_chain;
pub mod authority;
pub mod blackboard;
pub mod bloom;
pub mod change_id;
pub mod commit_witness;
pub mod context;
pub mod elevation;
pub mod file_mode;
pub mod file_uid;
pub mod generation;
pub mod git_object_id;
pub mod hex;
pub mod identity;
pub mod index_stage;
pub mod interactive;
pub mod oid;
pub mod policy;
pub mod project;
pub mod projection_tier;
pub mod projection_patterns;
pub mod provenance;
pub mod quarantine;
pub mod repo_path;
pub mod signature;
pub mod slice_auth;
pub mod submodule;

pub use audit_chain::{
    AuditHashChain, AuditIkceVerdict, AuditRecord, AuditScore, AuditTkcvVerdict,
    UnsignedAuditRecordParams, AUDIT_RECORD_BYTE_BUDGET, GENESIS_PREV_HASH,
};
pub use authority::{
    ct_eq_bytes, current_unix_seconds, AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION,
    AUTHORITY_SECRET_ENV,
};
pub use blackboard::{BlackboardCollision, CardBlackboard, IntentLease, SymbolClaim};
pub use bloom::PathBloomFilter;
pub use change_id::ChangeId;
pub use commit_witness::ValidatedCommitWitness;
pub use context::{AgentCommitMeta, PraxisCardContext};
pub use elevation::{
    AutoQualityScoreEnvelope, ElevationAttestation, StagedPromotionRequest, StagedPromotionStatus,
};
pub use file_mode::FileMode;
pub use file_uid::FileUid;
pub use generation::CorrectedCommitDate;
pub use git_object_id::{compute_object_oid, parse_loose_header, raw_object, ObjectKind};
pub use identity::{ActorIdentity, AgentPushContext, AuthorityTier};
pub use index_stage::IndexStage;
pub use interactive::{PatchHunkChoice, PatchPlan, RebaseAction, RebaseItem, RebasePlan};
pub use oid::{FastOidHasher, FastOidMap, FastOidSet, HashAlgorithm, Oid, TypedOid};
pub use policy::{ConflictPresentationMode, DiffCoherenceMode, EnforcementTier, TaxisPolicy};
pub use project::{
    FractalSubLease, LeaseStatus, ProjectLease, ProjectLeaseCache, RegistrationOrigin,
    SubAuthorizationZone, DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD,
    DEFAULT_PROJECT_MASTER_TTL_SECONDS, DEFAULT_SUBAGENT_TTL_SECONDS,
};
pub use provenance::{BlockProvenanceEntry, BlockProvenanceParams, ProvenanceLedger};
pub use quarantine::{
    default_quarantine_dir, IsolateMutationRequest, QuarantineRecord, QuarantineRegistry,
    QuarantineStatus,
};
pub use repo_path::{path_matches_scope, safe_join, validate_repo_relative_path, RepoPath};
pub use signature::GitSignature;
pub use slice_auth::{MutationBudget, ReservationStatus, ReservedFileToken, SliceAuthorization};
pub use submodule::{SubmoduleEntry, SubmoduleUpdateStrategy};
