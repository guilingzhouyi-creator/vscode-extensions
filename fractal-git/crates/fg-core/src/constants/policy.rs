//! Module: fg-core — Governance Policy & Identity Constants
//! File Path: crates/fg-core/src/constants/policy.rs
//! Architecture Role: Canonical policy presets, default identities, and anti-gaming keywords.

/// Rust-grade strict governance policy preset name.
pub const POLICY_RUST_STRICT: &str = "rust-strict";

/// Conventional commits semantic policy preset name.
pub const POLICY_CONVENTIONAL: &str = "conventional-semantic";

/// Native Git permissive policy preset name.
pub const POLICY_GIT_NATIVE: &str = "git-native";

/// Default Cell identifier for single-cell operations.
pub const DEFAULT_CELL_ID: &str = "cell-default";

/// Default Task Card identifier for unassigned checkpoints.
pub const DEFAULT_CARD_ID: &str = "card-000";

/// Default Agent identifier for primary worker transactions.
pub const DEFAULT_AGENT_ID: &str = "agent-primary";

/// Default role name for worker agents.
pub const DEFAULT_ROLE_WORKER: &str = "worker";

/// Default human architect operator name.
pub const DEFAULT_OPERATOR_HUMAN: &str = "Human Architect";

/// Default GUI session proof token.
pub const DEFAULT_GUI_SESSION_TOKEN: &str = "GUI_SESSION_VERIFIED";

/// Staged promotion default TTL in seconds (1 hour).
pub const DEFAULT_STAGED_PROMOTION_TTL_SECONDS: u64 = 3600;

/// Default score delta required to supersede active promotion.
pub const DEFAULT_REPLACEMENT_SCORE_BASELINE_DELTA: f64 = 5.0;

/// Default minimum auto score required for staged promotion.
pub const DEFAULT_MINIMUM_PROMOTION_SCORE: f64 = 80.0;
