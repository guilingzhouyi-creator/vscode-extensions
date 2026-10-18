//! Module: fg-core — Domain Models Facade
//! File Path: crates/fg-core/src/models/mod.rs

pub mod context;
pub mod oid;
pub mod signature;

pub use context::{AgentCommitMeta, PraxisCardContext};
pub use oid::Oid;
pub use signature::GitSignature;
