//! Module: fg-core — CLI Terminal Display, Tags, and Command Constants
//! File Path: crates/fg-core/src/constants/cli.rs
//! Architecture Role: Standardized constants for CLI status badges, subcommands,
//!   and options flags, unifying terminal reporting and machine integration.
//! Dependencies & Triggers: Utilized by Taxis CLI binary and integration test suites.
//! Responsibilities: Centralizes strongly-typed CLI tags and string constants.
//! Exit Semantics & Design Rationale: Eliminates magic strings and enforces single-source tags.

/// Strongly-typed terminal status badge constants.
pub struct CliTag;

impl CliTag {
    /// Badge emitted when worktree operations complete successfully.
    pub const WORKTREE_OK: &'static str = "[WORKTREE_OK]";
    /// Badge emitted upon successful Git commit persistence.
    pub const COMMIT_OK: &'static str = "[COMMIT_OK]";
    /// Badge emitted when branch governance verification passes.
    pub const VERIFY_PASS: &'static str = "[VERIFY_PASS]";
    /// Badge emitted when branch governance verification fails.
    pub const VERIFY_FAIL: &'static str = "[VERIFY_FAIL]";
    /// Badge emitted when a human operator verifies UAC credentials.
    pub const HUMAN_UAC_VERIFIED: &'static str = "[HUMAN_UAC_VERIFIED]";
    /// Badge emitted when a promotion request is staged for human review.
    pub const UAC_PROMOTION_STAGED: &'static str = "[UAC_PROMOTION_STAGED]";
    /// Badge emitted when a staged promotion is rejected by human or gate.
    pub const UAC_PROMOTION_REJECTED: &'static str = "[UAC_PROMOTION_REJECTED]";
    /// Badge emitted when UAC approval processing encounters an error.
    pub const UAC_APPROVAL_FAILED: &'static str = "[UAC_APPROVAL_FAILED]";
    /// Badge emitted when UAC rejection processing encounters an error.
    pub const UAC_REJECT_FAILED: &'static str = "[UAC_REJECT_FAILED]";
    /// Badge emitted when an automated promotion is rejected by policy.
    pub const PROMOTION_REJECTED: &'static str = "[PROMOTION_REJECTED]";
    /// Badge emitted when an authority breach or boundary violation occurs.
    pub const AUTHORITY_BREACH: &'static str = "[AUTHORITY_BREACH]";
    /// Badge emitted when commit message or metadata fails governance rules.
    pub const COMMIT_GOVERNANCE_FAIL: &'static str = "[COMMIT_GOVERNANCE_FAIL]";
    /// Badge emitted during worktree slot checkout operations.
    pub const TAXIS_CHECKOUT: &'static str = "[TAXIS_CHECKOUT]";
    /// Badge emitted when hermetic benchmark baselines are resolved.
    pub const HERMETIC_BASELINE: &'static str = "[HERMETIC_BASELINE]";
    /// Badge emitted during workspace slot reclamation.
    pub const RECLAIM: &'static str = "[RECLAIM]";
    /// Badge emitted when benchmark results improve upon baseline.
    pub const OPTIMIZED: &'static str = "[OPTIMIZED]";
    /// Generic failure badge for CLI commands.
    pub const FAIL: &'static str = "[FAIL]";
    /// Error condition badge for CLI commands.
    pub const ERROR: &'static str = "[ERROR]";
    /// Informational output badge for CLI reporting.
    pub const INFO: &'static str = "[INFO]";
    /// Badge emitted upon successful operation graph undo.
    pub const UNDO_OK: &'static str = "[UNDO_OK]";
}

/// Canonical subcommand names.
pub struct Subcommand;

impl Subcommand {
    /// Subcommand inspecting repository and worktree status.
    pub const STATUS: &'static str = "status";
    /// Subcommand persisting validated commits into Git history.
    pub const COMMIT: &'static str = "commit";
    /// Subcommand managing fractal branch references.
    pub const BRANCH: &'static str = "branch";
    /// Subcommand computing hierarchical differences between revisions.
    pub const DIFF: &'static str = "diff";
    /// Subcommand checking out specific branches or commits into slots.
    pub const CHECKOUT: &'static str = "checkout";
    /// Subcommand validating topological invariants and governance rules.
    pub const VERIFY: &'static str = "verify";
    /// Subcommand reclaiming inactive or stale workspace slots.
    pub const RECLAIM: &'static str = "reclaim";
    /// Subcommand managing concurrent agent worktree pools.
    pub const WORKTREE: &'static str = "worktree";
    /// Subcommand managing staged candidate promotions into trunk.
    pub const PROMOTION: &'static str = "promotion";
    /// Subcommand executing regression benchmarks and perf baselines.
    pub const BENCH: &'static str = "bench";
    /// Subcommand launching the background IPC daemon.
    pub const DAEMON: &'static str = "daemon";
    /// Subcommand reverting recent operations via the operation graph.
    pub const UNDO: &'static str = "undo";
    /// Subcommand inspecting recorded operation journal entries.
    pub const OPERATION: &'static str = "operation";
    /// Subcommand listing commit revisions in topological order.
    pub const REV_LIST: &'static str = "rev-list";
    /// Subcommand displaying binary version and build metadata.
    pub const VERSION: &'static str = "version";
    /// Subcommand displaying usage and help information.
    pub const HELP: &'static str = "help";
}

/// Canonical CLI option flags.
pub struct CliFlag;

impl CliFlag {
    /// Option flag requesting structured JSON output format.
    pub const JSON: &'static str = "--json";
    /// Option flag designating explicit Git repository root path.
    pub const GIT_DIR: &'static str = "--git-dir";
    /// Option flag requesting full unbounded history traversal.
    pub const FULL: &'static str = "--full";
    /// Option flag scoping operations to a specific cell or card.
    pub const SCOPE: &'static str = "--scope";
    /// Option flag selecting execution or verification mode.
    pub const MODE: &'static str = "--mode";
    /// Option flag specifying originating agent identifier.
    pub const AGENT: &'static str = "--agent";
    /// Option flag specifying target cell identifier.
    pub const CELL: &'static str = "--cell";
    /// Option flag specifying parent task card identifier.
    pub const CARD: &'static str = "--card";
    /// Option flag providing authentication or session token.
    pub const TOKEN: &'static str = "--token";
    /// Option flag indicating human physical presence or approval.
    pub const HUMAN: &'static str = "--human";
    /// Option flag selecting governance policy preset.
    pub const POLICY: &'static str = "--policy";
    /// Option flag specifying target branch or candidate reference.
    pub const TARGET: &'static str = "--target";
    /// Option flag supplying automated refactor composite score.
    pub const SCORE: &'static str = "--score";
    /// Option flag supplying Code Autonomy Index (CAI) percentage.
    pub const CAI: &'static str = "--cai";
    /// Option flag supplying cyclomatic complexity delta.
    pub const CC_DELTA: &'static str = "--cc-delta";
    /// Option flag supplying effective lines of code delta.
    pub const ELOC_DELTA: &'static str = "--eloc-delta";
    /// Option flag asserting anti-gaming verification status.
    pub const ANTI_GAMING: &'static str = "--anti-gaming";
    /// Option flag specifying audit report output file path.
    pub const REPORT: &'static str = "--report";
    /// Option flag setting benchmark iteration count multiplier.
    pub const MULTIPLIER: &'static str = "--multiplier";
    /// Option flag setting benchmark rigor level.
    pub const LEVEL: &'static str = "--level";
    /// Option flag enabling Anthropic Scion differential parity verification.
    pub const SCION_PARITY: &'static str = "--scion-parity";
    /// Option flag saving executed benchmark timings as new baseline.
    pub const SAVE_BASELINE: &'static str = "--save-baseline";
    /// Option flag verifying performance against recorded baseline JSON.
    pub const VERIFY_BASELINE: &'static str = "--verify-baseline";
}
