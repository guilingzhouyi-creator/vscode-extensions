//! Module: fg-gate — Protocol Gate & Policy Governance Facade
//! File Path: crates/fg-gate/src/lib.rs
//! Architecture Role: Protocol-level verification and resource governance subsystem,
//!   containing pre-receive authorization guards, conflict marker verifiers,
//!   and compile-time strictness commit message guards.
//! Dependencies & Triggers: Consumed by Taxis CLI pre-receive, promotion, and check commands.
//! Responsibilities: Commit message governance, conflict marker detection, and pre-receive policy.
//! Exit Semantics & Design Rationale: Fail-closed verification preventing policy-violating commits.
//!
//! Domain Governance Rules: FGT-GAT-001 (protocol gate facade), FGT-COR-001, CMG-STY-001.

pub mod authority;
pub mod commit_guard;
pub mod conflict_guard;
pub mod git_hook;
pub mod hook;
pub mod pre_receive;
pub mod quota_governor;

pub use authority::{
    resolve_authority_secret, AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION,
    AUTHORITY_SECRET_ENV,
};
pub use commit_guard::CommitMessageGuard;
pub use conflict_guard::ConflictGuard;
pub use git_hook::{
    hook_argument_path, read_core_authority_secret, GitHookOutcome, GitHookRunner, GitHookStatus,
    HookConfig,
};
pub use hook::{
    CommitGovernanceHook, FractalHook, HookContext, HookPipeline, HookTier, HookVerdict,
    HygieneConflictHook, UacPromotionGateHook,
};
pub use pre_receive::{ActorIdentity, AgentPushContext, PreReceiveGuard};
pub use quota_governor::{
    QuotaGovernor, DEFAULT_MAX_CONCURRENT_WORKTREES, DEFAULT_MAX_WORKSPACE_DISK_BYTES,
};
