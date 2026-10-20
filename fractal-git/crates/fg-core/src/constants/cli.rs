//! Module: fg-core — CLI Terminal Display, Tags, and Command Constants
//! File Path: crates/fg-core/src/constants/cli.rs
//! Architecture Role: Standardized constants for CLI status badges, subcommands,
//!   and options flags, unifying terminal reporting and machine integration.

/// Strongly-typed terminal status badge constants.
pub struct CliTag;

impl CliTag {
    pub const WORKTREE_OK: &'static str = "[WORKTREE_OK]";
    pub const COMMIT_OK: &'static str = "[COMMIT_OK]";
    pub const VERIFY_PASS: &'static str = "[VERIFY_PASS]";
    pub const VERIFY_FAIL: &'static str = "[VERIFY_FAIL]";
    pub const HUMAN_UAC_VERIFIED: &'static str = "[HUMAN_UAC_VERIFIED]";
    pub const UAC_PROMOTION_STAGED: &'static str = "[UAC_PROMOTION_STAGED]";
    pub const UAC_PROMOTION_REJECTED: &'static str = "[UAC_PROMOTION_REJECTED]";
    pub const UAC_APPROVAL_FAILED: &'static str = "[UAC_APPROVAL_FAILED]";
    pub const UAC_REJECT_FAILED: &'static str = "[UAC_REJECT_FAILED]";
    pub const PROMOTION_REJECTED: &'static str = "[PROMOTION_REJECTED]";
    pub const AUTHORITY_BREACH: &'static str = "[AUTHORITY_BREACH]";
    pub const COMMIT_GOVERNANCE_FAIL: &'static str = "[COMMIT_GOVERNANCE_FAIL]";
    pub const TAXIS_CHECKOUT: &'static str = "[TAXIS_CHECKOUT]";
    pub const HERMETIC_BASELINE: &'static str = "[HERMETIC_BASELINE]";
    pub const RECLAIM: &'static str = "[RECLAIM]";
    pub const OPTIMIZED: &'static str = "[OPTIMIZED]";
    pub const FAIL: &'static str = "[FAIL]";
    pub const ERROR: &'static str = "[ERROR]";
}

/// Canonical subcommand names.
pub struct Subcommand;

impl Subcommand {
    pub const STATUS: &'static str = "status";
    pub const COMMIT: &'static str = "commit";
    pub const BRANCH: &'static str = "branch";
    pub const DIFF: &'static str = "diff";
    pub const CHECKOUT: &'static str = "checkout";
    pub const VERIFY: &'static str = "verify";
    pub const RECLAIM: &'static str = "reclaim";
    pub const WORKTREE: &'static str = "worktree";
    pub const PROMOTION: &'static str = "promotion";
    pub const BENCH: &'static str = "bench";
    pub const DAEMON: &'static str = "daemon";
    pub const REV_LIST: &'static str = "rev-list";
    pub const VERSION: &'static str = "version";
    pub const HELP: &'static str = "help";
}

/// Canonical CLI option flags.
pub struct CliFlag;

impl CliFlag {
    pub const JSON: &'static str = "--json";
    pub const GIT_DIR: &'static str = "--git-dir";
    pub const FULL: &'static str = "--full";
    pub const SCOPE: &'static str = "--scope";
    pub const MODE: &'static str = "--mode";
    pub const AGENT: &'static str = "--agent";
    pub const CELL: &'static str = "--cell";
    pub const CARD: &'static str = "--card";
    pub const TOKEN: &'static str = "--token";
    pub const HUMAN: &'static str = "--human";
    pub const POLICY: &'static str = "--policy";
    pub const TARGET: &'static str = "--target";
    pub const SCORE: &'static str = "--score";
    pub const CAI: &'static str = "--cai";
    pub const CC_DELTA: &'static str = "--cc-delta";
    pub const ELOC_DELTA: &'static str = "--eloc-delta";
    pub const ANTI_GAMING: &'static str = "--anti-gaming";
    pub const REPORT: &'static str = "--report";
    pub const MULTIPLIER: &'static str = "--multiplier";
    pub const LEVEL: &'static str = "--level";
    pub const SCION_PARITY: &'static str = "--scion-parity";
    pub const SAVE_BASELINE: &'static str = "--save-baseline";
    pub const VERIFY_BASELINE: &'static str = "--verify-baseline";
}
