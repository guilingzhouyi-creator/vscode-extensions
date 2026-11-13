//! Module: fg-gate — Protocol Gate & Policy Governance Facade
//! File Path: crates/fg-gate/src/lib.rs
//! Architecture Role: Protocol-level verification and resource governance subsystem,
//!   containing pre-receive authorization guards, conflict marker verifiers,
//!   and compile-time strictness commit message guards.
//! Dependencies & Triggers: Consumed by Taxis CLI pre-receive, promotion, and check commands.
//! Responsibilities: Commit message governance, conflict marker detection, and pre-receive policy.
//! Exit Semantics & Design Rationale: Fail-closed verification preventing policy-violating commits.
//!
//! Domain Governance Rules: FGT-GAT-001 (protocol gate facade), FGT-COR-001.

pub mod audit_engine;
pub mod authority;
pub mod auto_audit_hook;
pub mod branch_guard;
pub mod canary;
pub mod commit_guard;
pub mod conflict_guard;
pub mod credit;
pub mod diff_bounds;
pub mod git_hook;
pub mod hook;
pub mod policy_floor;
pub mod pre_receive;
pub mod quota_governor;
pub mod verifier;

pub use authority::{
    resolve_authority_secret, AuthorityClaims, AuthoritySecret, AUTHORITY_REMEDIATION,
    AUTHORITY_SECRET_ENV,
};
pub use auto_audit_hook::AutoAuditHook;
pub use branch_guard::{
    BranchBypassContext, BranchFloorSource, BranchGateOutcome, BranchGovernanceFloor, BranchGuard,
};
pub use canary::{
    CanaryConfig, CanaryReport, KernelCanaryEngine, MutationKind, ShadowCanaryEngine,
};
pub use commit_guard::CommitMessageGuard;
pub use conflict_guard::ConflictGuard;
pub use credit::{AgentCreditController, AgentCreditScore, QuarantineRequestParams};
pub use diff_bounds::{
    CommitBatchTotals, DiffBoundsGovernor, DiffBoundsVerdict, SingleFile5dBounds,
};
pub use git_hook::{
    hook_argument_path, read_core_authority_secret, GitHookOutcome, GitHookRunner, GitHookStatus,
    HookConfig,
};
pub use hook::{
    CommitGovernanceHook, DiffBoundsGovernanceHook, ElevationPromotionGateHook, FractalHook,
    HookContext, HookPipeline, HookTier, HookVerdict, HygieneConflictHook,
};
pub use policy_floor::{preset_for_tier, PolicyFloor, PolicyVaultHealth};
pub use pre_receive::{ActorIdentity, AgentPushContext, PreReceiveGuard};

pub use quota_governor::{
    QuotaGovernor, DEFAULT_MAX_CONCURRENT_WORKTREES, DEFAULT_MAX_WORKSPACE_DISK_BYTES,
};
pub use verifier::{KernelAstVerifier, VerifierConfig, VerifierViolation, ViolationSeverity};

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

    pub(crate) struct TempDir(PathBuf);

    impl TempDir {
        pub(crate) fn new() -> std::io::Result<Self> {
            let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("fg-gate-test-{}-{seq}", std::process::id()));
            std::fs::create_dir_all(&dir)?;
            Ok(Self(dir))
        }

        pub(crate) fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
