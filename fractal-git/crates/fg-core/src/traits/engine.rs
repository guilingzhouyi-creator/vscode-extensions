//! Module: fg-core — Generalized Engine & Bounded Worktree Contracts
//! File Path: crates/fg-core/src/traits/engine.rs
//! Architecture Role: Dependency-inversion trait abstractions exposing the Taxis version control
//!   kernel and bounded worktree handles directly to Praxis Rust callers.
//! Dependencies & Triggers: Consumed by taxis-engine, Praxis distributed kernel nodes, and integration tests.
//! Responsibilities: Define high-level lifecycle contracts for worktree derivation, asynchronous
//!   file declarations, and atomic commit transactions under strict authorization slices.
//! Exit Semantics & Design Rationale: Provides pure Rust zero-cost traits without coupling to CLI
//!   or foreign NAPI runtimes.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `PRF-LEAK-001`: Explicit symmetric handle disposal contract

use std::path::Path;

use crate::error::FractalResult;
use crate::models::{
    AgentCommitMeta, IntentLease, Oid, PraxisCardContext, ReservedFileToken, SliceAuthorization,
};

/// Generalized version control engine interface for Praxis kernel callers.
pub trait TaxisEngine: Send + Sync {
    /// Spawns a bounded agent worktree constrained to a specific task card and authorization slice.
    fn spawn_bounded_worktree(
        &self,
        card_context: &PraxisCardContext,
        auth_slice: SliceAuthorization,
    ) -> FractalResult<Box<dyn AgentWorktreeHandle>>;

    /// Acquires an intent lease on a specific symbol or path via blackboard synchronization.
    fn acquire_intent(&self, path: &str, intent: &str, ttl_secs: u64)
        -> FractalResult<IntentLease>;

    /// Releases a previously acquired intent lease.
    fn release_intent(&self, lease: &IntentLease) -> FractalResult<bool>;
}

/// Handle governing operations within an isolated, bounded SubAgent worktree.
pub trait AgentWorktreeHandle: Send + Sync {
    /// Returns the unique worktree identifier.
    fn worktree_id(&self) -> &str;

    /// Returns the isolated path jail filesystem directory.
    fn path_jail(&self) -> &Path;

    /// Borrows the active slice authorization contract.
    fn slice_authorization(&self) -> &SliceAuthorization;

    /// Asynchronously pre-declares intent to create a new file within permitted prefixes.
    fn reserve_file_async(
        &mut self,
        rel_path: &str,
        current_time: u64,
        ttl_secs: u64,
        nonce: u64,
    ) -> FractalResult<ReservedFileToken>;

    /// Stages in-memory bytes for a repository-relative path under slice authorization constraints.
    fn stage_bytes(
        &mut self,
        rel_path: &str,
        content: &[u8],
        executable: bool,
    ) -> FractalResult<()>;

    /// Unstages changes for a repository-relative path.
    fn unstage(&mut self, rel_path: &str) -> FractalResult<()>;

    /// Finalizes an atomic commit transaction embedding the originating Praxis card context.
    fn commit_transaction(
        &mut self,
        commit_message: &str,
        commit_metadata: Option<&AgentCommitMeta>,
    ) -> FractalResult<Oid>;

    /// Symmetrically releases resources and disposes of the worktree handle.
    fn dispose(self: Box<Self>) -> FractalResult<()>;
}
