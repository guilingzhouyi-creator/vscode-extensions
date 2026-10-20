//! Module: fg-gate — Worktree Quota & Storage Governor
//! File Path: crates/fg-gate/src/quota_governor.rs
//! Architecture Role: Monitors active worktree concurrency and aggregate storage budgets,
//!   preventing runaway subagent loops from exhausting local disk or file descriptors.

use fg_core::error::{FractalError, FractalResult};

pub const DEFAULT_MAX_CONCURRENT_WORKTREES: usize = 64;
pub const DEFAULT_MAX_WORKSPACE_DISK_BYTES: u64 = 10 * 1024 * 1024 * 1024; // 10 GB

/// Policy governor enforcing active worktree concurrency and disk consumption budgets.
#[derive(Debug, Clone)]
pub struct QuotaGovernor {
    max_worktrees: usize,
    max_disk_bytes: u64,
}

impl Default for QuotaGovernor {
    fn default() -> Self {
        Self {
            max_worktrees: DEFAULT_MAX_CONCURRENT_WORKTREES,
            max_disk_bytes: DEFAULT_MAX_WORKSPACE_DISK_BYTES,
        }
    }
}

impl QuotaGovernor {
    /// Constructs a custom quota governor.
    pub fn new(max_worktrees: usize, max_disk_bytes: u64) -> Self {
        Self {
            max_worktrees,
            max_disk_bytes,
        }
    }

    /// Asserts that spawning a new worktree will not exceed concurrency capacity.
    pub fn assert_spawn_capacity(&self, current_active_count: usize) -> FractalResult<()> {
        if current_active_count >= self.max_worktrees {
            Err(FractalError::ReclamationFailure {
                workspace_id: "global".into(),
                reason: format!(
                    "Active worktree quota exceeded (limit: {}, current: {})",
                    self.max_worktrees, current_active_count
                ),
            })
        } else {
            Ok(())
        }
    }

    /// Asserts that total estimated storage does not breach physical ceiling.
    pub fn assert_storage_budget(&self, current_total_bytes: u64) -> FractalResult<()> {
        if current_total_bytes >= self.max_disk_bytes {
            Err(FractalError::ReclamationFailure {
                workspace_id: "global".into(),
                reason: format!(
                    "Worktree disk storage budget exhausted (limit: {} bytes, current: {})",
                    self.max_disk_bytes, current_total_bytes
                ),
            })
        } else {
            Ok(())
        }
    }

    /// Returns the maximum allowed concurrent worktrees.
    pub fn max_concurrent_worktrees(&self) -> usize {
        self.max_worktrees
    }

    /// Returns the maximum disk budget in bytes.
    pub fn max_disk_bytes(&self) -> u64 {
        self.max_disk_bytes
    }

    /// Returns the maximum disk budget in megabytes.
    pub fn max_disk_megabytes(&self) -> u64 {
        self.max_disk_bytes / (1024 * 1024)
    }
}
