//! Module: fg-core — Fractal Git Core Domain Foundation
//! File Path: crates/fg-core/src/lib.rs
//! Architecture Role: Root foundation crate defining atomic models, global error types,
//!   and dependency-inversion trait abstractions (OdbStore, RefStore,
//!   GateVerifier, WorktreeReclaimer).
//! Dependencies & Triggers: Depended upon by all Taxis kernel subsystems and CLI binary.
//! Responsibilities: Core atomic domain models, zero-panic error classification,
//!   and trait contracts.
//! Exit Semantics & Design Rationale: Standardizes fundamental types with
//!   zero circular dependencies.
//!
//! Domain Governance Rules: FGT-COR-001 (core domain foundation), FGT-LCK-001, FGT-PRF-001.

pub mod constants;
pub mod crypto;
pub mod diagnostics;
pub mod error;
pub mod fs_atomic;
pub mod math;
pub mod models;
pub mod sanitizer;
pub mod traits;

pub use constants::{
    format_elevation_proposal_summary, is_recognized_ref_prefix, is_registered_fgt_rule,
    is_valid_benchmark_metric,
};

pub use crypto::{hmac_sm3, sm3_hash, Sm3Hasher};
pub use error::{FractalError, FractalResult};
pub use fs_atomic::write_file_atomic;
pub use math::{
    decode_git_offset_varint, encode_git_offset_varint, jeffreys_beta_from_counts,
    jeffreys_beta_trials, JeffreysPosterior,
};
pub use models::{ct_eq_bytes, path_matches_scope, safe_join, validate_repo_relative_path};
pub use models::{
    encode_seal_record, seal_policy_envelope, unseal_policy_envelope, verify_seal_record,
    ActorIdentity, AgentCommitMeta, AgentPushContext, AuthorityClaims, AuthoritySecret,
    AuthorityTier, AutoQualityScoreEnvelope, BlackboardCollision, BlockProvenanceEntry,
    BlockProvenanceParams, BranchEnforcementTier, BranchPolicySpec, CardBlackboard,
    ConflictPresentationMode, DiffCoherenceMode, ElevationAttestation, EnforcementTier,
    FastOidHasher, FastOidMap, FastOidSet, FileMode, FileUid, GitSignature, HashAlgorithm,
    IndexStage, IntentLease, MutationBudget, Oid, PatchHunkChoice, PatchPlan, PraxisCardContext,
    ProvenanceLedger, QuarantineRegistry, RebaseAction, RebaseItem, RebasePlan, RepoPath,
    ReservationStatus, ReservedFileToken, SealedPolicyPayload, SliceAuthorization,
    StagedPromotionRequest, StagedPromotionStatus, SubmoduleEntry, SubmoduleUpdateStrategy,
    SymbolClaim, TaxisPolicy, TypedOid, ValidatedCommitWitness, POLICY_REPO_ID_LEN,
    POLICY_SEAL_RECORD_LEN, POLICY_VAULT_HEADER_LEN,
};
pub use sanitizer::{
    format_violation_diagnostic, is_rule_id_candidate, sanitize_violation_for_user, split_rule_id,
};
pub use traits::{
    AgentWorktreeHandle, GateVerdict, GateVerifier, OdbStore, ReclamationAudit, RefStore,
    StagedCandidate, TaxisEngine, WorktreeReclaimer,
};
