//! Module: fg-topology — Fractal Topology and State Machine Facade
//! File Path: crates/fg-topology/src/lib.rs
//! Architecture Role: Manages self-similar fractal reference spaces, topological
//!   merge assertions, worktree lifecycle state machine transitions, Path Jail
//!   sandboxes, anti-inflation commit telemetry, and staged promotion UAC
//!   authorization ledgers.

pub mod authorizer;
pub mod operation;
pub mod promotion_ledger;
pub mod refs;
pub mod state_machine;
pub mod telemetry;
pub mod verifier;
pub mod worktree;

pub use authorizer::{HumanUacAuthorizer, StandardNonceAuthorizer};
pub use operation::{Operation, OperationGraph, OperationMetadata, RepoViewSnapshot};
pub use promotion_ledger::{PromotionLedgerData, PromotionStagingLedger};
pub use refs::{DiskRefStore, FractalRef};
pub use state_machine::{FractalWorkspaceNode, WorktreeState};
pub use telemetry::{
    CommitCountVerdict, CommitCounter, CommitTelemetryConfig, TelemetryCommitNode,
};
pub use verifier::TopologyVerifier;
pub use worktree::{FractalWorktree, PathJail, ScopeProjection};
