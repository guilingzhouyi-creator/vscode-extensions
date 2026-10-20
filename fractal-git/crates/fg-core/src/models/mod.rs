//! Module: fg-core — Domain Models Facade
//! File Path: crates/fg-core/src/models/mod.rs

pub mod bloom;
pub mod change_id;
pub mod commit_witness;
pub mod context;
pub mod generation;
pub mod identity;
pub mod oid;
pub mod policy;
pub mod signature;
pub mod uac;

pub use bloom::PathBloomFilter;
pub use change_id::ChangeId;
pub use commit_witness::ValidatedCommitWitness;
pub use context::{AgentCommitMeta, PraxisCardContext};
pub use generation::CorrectedCommitDate;
pub use identity::{ActorIdentity, AgentPushContext, AuthorityTier};
pub use oid::{FastOidHasher, FastOidMap, FastOidSet, Oid};
pub use policy::{DiffCoherenceMode, TaxisPolicy};
pub use signature::GitSignature;
pub use uac::{
    AutoQualityScoreEnvelope, HumanUacProof, StagedPromotionRequest, StagedPromotionStatus,
};
