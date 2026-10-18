//! Unit Test: fg-pools (RecyclePool, PageBufferPool, WorktreePool, SandboxPool) & fg-gate QuotaGovernor
//! File Path: tests/rust/test_pools.rs

use fractal_git::gate::quota_governor::QuotaGovernor;
use fractal_git::pools::buffer_pool::PageBufferPool;
use fractal_git::pools::object_pool::{RecyclePool, Resettable};
use fractal_git::pools::sandbox_pool::SandboxPool;
use fractal_git::pools::worktree_pool::WorktreePool;

#[derive(Default)]
struct MockAstNode {
    tokens: Vec<String>,
}

impl Resettable for MockAstNode {
    fn reset_state(&mut self) {
        self.tokens.clear();
    }
}

#[test]
fn test_object_recycle_pool() {
    let pool = RecyclePool::new(16, MockAstNode::default);
    let mut item = pool.acquire();
    item.tokens.push("ident".to_string());
    assert_eq!(item.tokens.len(), 1);

    pool.release(item);

    let reused = pool.acquire();
    // After release, state was reset to clean state
    assert!(reused.tokens.is_empty());
}

#[test]
fn test_page_buffer_pool() {
    let pool = PageBufferPool::new(1024, 8);
    let mut buf = pool.acquire();
    buf.extend_from_slice(b"sample binary payload");
    assert_eq!(buf.len(), 21);

    pool.release(buf);

    let reused = pool.acquire();
    assert!(reused.is_empty());
    assert!(reused.capacity() >= 1024);
}

#[test]
fn test_worktree_slot_pool() {
    let pool = WorktreePool::new(4);
    assert_eq!(pool.available_count(), 4);

    let slot0 = pool.acquire_slot("subagent").unwrap();
    assert_eq!(pool.available_count(), 3);
    assert!(slot0.token.contains("subagent-slot-0"));

    pool.release_slot(slot0);
    assert_eq!(pool.available_count(), 4);
}

#[test]
fn test_sandbox_slot_pool() {
    let pool = SandboxPool::new(8);
    assert_eq!(pool.available(), 8);

    let slot = pool.acquire().expect("Should acquire sandbox slot");
    assert_eq!(slot.id, 0);
    assert!(slot.in_use);
    assert_eq!(pool.available(), 7);

    pool.release(slot);
    assert_eq!(pool.available(), 8);
}

#[test]
fn test_quota_governor() {
    let governor = QuotaGovernor::new(2, 1024 * 1024);
    assert!(governor.assert_spawn_capacity(1).is_ok());
    assert!(governor.assert_spawn_capacity(2).is_err());

    assert!(governor.assert_storage_budget(500 * 1024).is_ok());
    assert!(governor.assert_storage_budget(2 * 1024 * 1024).is_err());
}
