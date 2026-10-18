//! Module: fg-gate — Protocol Gate & Policy Governance Facade
//! File Path: crates/fg-gate/src/lib.rs
//! Architecture Role: Protocol-level verification and resource governance subsystem,
//!   containing pre-receive authorization guards, conflict marker verifiers, and quota governors.

pub mod conflict_guard;
pub mod pre_receive;
pub mod quota_governor;

pub use conflict_guard::ConflictGuard;
pub use pre_receive::{AgentPushContext, PreReceiveGuard};
pub use quota_governor::{QuotaGovernor, DEFAULT_MAX_CONCURRENT_WORKTREES, DEFAULT_MAX_WORKSPACE_DISK_BYTES};
