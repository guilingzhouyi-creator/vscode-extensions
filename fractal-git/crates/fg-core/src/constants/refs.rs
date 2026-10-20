//! Module: fg-core — Fractal Reference Hierarchy & Path Constants
//! File Path: crates/fg-core/src/constants/refs.rs
//! Architecture Role: Central single source of truth for the self-similar fractal reference
//!   namespace paths, segment keywords, and tier descriptors.

/// Root namespace prefix for all fractal Git references (`refs/fractal/`).
pub const REF_FRACTAL_PREFIX: &str = "refs/fractal/";

/// Canonical path for the self-similar fractal integration trunk.
pub const REF_FRACTAL_TRUNK: &str = "refs/fractal/trunk";

/// Canonical path for the standard Git system trunk (Layer 0).
pub const REF_SYSTEM_TRUNK: &str = "refs/heads/main";

/// Alternative legacy integration trunk name.
pub const REF_FRACTAL_INTEGRATION: &str = "refs/fractal/integration";

/// Path segment identifying cell namespace.
pub const PATH_SEGMENT_CELL: &str = "cell";

/// Path segment identifying task card namespace.
pub const PATH_SEGMENT_CARD: &str = "card";

/// Path segment identifying ephemeral subagent namespace.
pub const PATH_SEGMENT_SUB: &str = "sub";

/// Path segment identifying integration main line.
pub const PATH_SEGMENT_MAIN: &str = "main";

/// Path segment identifying trunk line.
pub const PATH_SEGMENT_TRUNK: &str = "trunk";

/// Path segment identifying integration alias.
pub const PATH_SEGMENT_INTEGRATION: &str = "integration";

/// Tier descriptor for root fractal integration trunk.
pub const TIER_TRUNK: &str = "trunk";

/// Tier descriptor for cell integration main branch.
pub const TIER_CELL_MAIN: &str = "cell_main";

/// Tier descriptor for card-level worktree.
pub const TIER_CARD_WORKTREE: &str = "card_worktree";

/// Tier descriptor for ephemeral subagent worktree.
pub const TIER_SUBAGENT_WORKTREE: &str = "subagent_worktree";
