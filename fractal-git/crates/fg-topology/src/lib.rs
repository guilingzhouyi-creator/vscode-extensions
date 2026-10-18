//! Module: fg-topology — Fractal Topology and State Machine Facade
//! File Path: crates/fg-topology/src/lib.rs
//! Architecture Role: Manages self-similar fractal reference spaces, topological merge assertions,
//!   worktree lifecycle state machine transitions, and Path Jail sandboxes.

pub mod refs;
pub mod state_machine;
pub mod verifier;
pub mod worktree;

pub use refs::{DiskRefStore, FractalRef};
pub use state_machine::{FractalWorkspaceNode, WorktreeState};
pub use verifier::TopologyVerifier;
pub use worktree::{FractalWorktree, PathJail};
