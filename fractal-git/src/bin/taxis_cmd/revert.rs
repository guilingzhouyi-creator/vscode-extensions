//! Module: taxis_cmd::revert — Native 'revert' Command Dispatcher
//! File Path: src/bin/taxis_cmd/revert.rs
//! Architecture Role: Implements revert inverse delta by delegating to the shared commit delta
//!   transplant engine in `cherry_pick.rs` with inverted base/target roles (`invert_delta = true`).
//! Dependencies & Triggers: Dispatched by `taxis revert`.
//! Responsibilities: Configure inverse delta transplant and delegate execution to
//!   `execute_commit_delta_transplant`.
//! Exit Semantics & Design Rationale:
//!   - Produces standard 'Revert "<summary>"' commit messages, matching Git convention.
//!   - Atomic reference update guarantees zero half-reverted states.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Algorithmic three-way tree equivalence guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use super::cherry_pick::{execute_commit_delta_transplant, DeltaTransplantSpec};
use super::common::CliContext;

/// Dispatches the `revert` command.
pub fn handle_revert(ctx: &CliContext) {
    execute_commit_delta_transplant(
        ctx,
        &DeltaTransplantSpec {
            operation: "revert",
            json_commit_key: "reverted_commit",
            invert_delta: true,
        },
    );
}
