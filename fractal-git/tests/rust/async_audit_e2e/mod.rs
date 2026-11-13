//! Integration Test: Taxis Persistent Async Audit Daemon Harness & Lifecycle
//! File Path: tests/rust/async_audit_e2e/mod.rs
//! Architecture Role: Groups persistent daemon async audit E2E test modules and shared
//!   test fixture constants and child-process RAII cleanup guards.
//! Dependencies & Triggers: Wired by `tests/integration_governance.rs`.
//! Responsibilities: Ensure daemon child processes terminate reliably on test exit or panic.
//! Exit Semantics & Design Rationale: Avoids orphaned background processes across CI runs.

mod fixtures;
mod harness;
mod lifecycle_test;
mod pause_cell_test;
mod recovery_test;

use std::process::{Child, ExitStatus};
use std::time::{Duration, Instant};

pub(super) const TEST_AUTHORITY_HEX: &str =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
pub(super) const WRONG_AUTHORITY_HEX: &str =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

pub(super) struct ChildGuard {
    child: Option<Child>,
}

impl ChildGuard {
    pub(super) fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    pub(super) fn wait_exit(&mut self, timeout: Duration) -> Option<ExitStatus> {
        let child = self.child.as_mut()?;
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Ok(Some(status)) = child.try_wait() {
                let _ = self.child.take();
                return Some(status);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        None
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
