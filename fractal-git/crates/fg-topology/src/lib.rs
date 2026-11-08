//! Module: fg-topology — Fractal Topology and State Machine Facade
//! File Path: crates/fg-topology/src/lib.rs
//! Architecture Role: Manages self-similar fractal reference spaces, topological
//!   merge assertions, worktree lifecycle state machine transitions, Path Jail
//!   sandboxes, anti-inflation commit telemetry, and staged promotion UAC
//!   authorization ledgers.
//! Dependencies & Triggers: Upstream of Taxis CLI and test suites.
//! Responsibilities: Central facade for refs, promotion ledger, worktrees, and operation DAG.
//! Exit Semantics & Design Rationale: Exposes high-level state machine interfaces cleanly.
//!
//! Domain Governance Rules: FGT-TOP-001 (topology state machine facade), FGT-COR-001, FGT-LCK-001.

pub mod acceptance;
pub mod authorizer;
pub mod bisect;
pub mod blackboard;
pub mod conflict_tree;
pub mod fanout;
pub mod history_rollup;
pub mod manifold;
pub mod operation;
pub mod project_store;
pub mod promotion_ledger;
pub mod provenance;
pub mod refs;
pub mod state_machine;
pub mod submodule;
pub mod telemetry;
pub mod verifier;
pub mod worktree;

pub use acceptance::{read_commit_header, write_acceptance};
pub use authorizer::{ElevationAuthorizer, StandardNonceAuthorizer};
pub use bisect::{BisectEngine, BisectState, BisectStep};
pub use blackboard::{DiskBlackboardStore, BLACKBOARD_DIR};
pub use conflict_tree::{AgentConflictSliceReport, ConflictSlice, ConflictTreeManager};
pub use fanout::{assert_fanout_available, assert_fanout_available_in};
pub use history_rollup::{
    CardMilestoneRecord, HierarchicalHistoryRollup, HierarchicalRollupFolder, MilestoneRollupEntry,
    PyramidFolder,
};
pub use manifold::{Riemann5DPhaseVector, TrinityManifoldEvaluator, TrinityManifoldSnapshot};
pub use operation::{Operation, OperationGraph, OperationMetadata, RepoViewSnapshot};
pub use project_store::{DiskProjectStore, PROJECTS_CACHE_FILE, PROJECTS_DIR};
pub use promotion_ledger::{PromotionLedgerData, PromotionStagingLedger};
pub use provenance::{DiskProvenanceStore, PROVENANCE_FILE};
pub use refs::{DiskRefStore, FractalRef, HeadState};
pub use state_machine::{FractalWorkspaceNode, WorktreeState};
pub use submodule::{SubmoduleController, SubmoduleStatus};
pub use telemetry::{
    CommitCountVerdict, CommitCounter, CommitTelemetryConfig, TelemetryCommitNode,
};
pub use verifier::TopologyVerifier;
pub use worktree::{FractalWorktree, PathJail, ScopeProjection};
