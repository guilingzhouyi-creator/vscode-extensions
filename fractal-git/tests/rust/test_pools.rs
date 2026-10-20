//! Unit Test: fg-pools (RecyclePool, PageBufferPool, WorktreePool, SandboxPool)
//!   & fg-gate QuotaGovernor
//! File Path: tests/rust/test_pools.rs

use fractal_git::gate::quota_governor::QuotaGovernor;
use fractal_git::pools::buffer_pool::{BufferSizeClass, PageBufferPool};
use fractal_git::pools::lru_cache::ByteLruCache;
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

#[test]
fn test_buffer_pool_size_classes_and_thread_local() {
    let pool = PageBufferPool::new(64 * 1024, 16);

    // 1. Acquire small (4KB)
    let mut small_buf = pool.acquire_sized(BufferSizeClass::Small);
    assert!(small_buf.capacity() >= 4096);
    small_buf.extend_from_slice(b"small tree entry");
    pool.release_sized(small_buf, BufferSizeClass::Small);

    // 2. Re-acquire from thread-local cache: zero lock contention!
    let reused_small = pool.acquire_sized(BufferSizeClass::Small);
    assert!(reused_small.is_empty());
    assert!(reused_small.capacity() >= 4096);

    // 3. Acquire large (1MB)
    let large_buf = pool.acquire_sized(BufferSizeClass::Large);
    assert!(large_buf.capacity() >= 1024 * 1024);
    pool.release_sized(large_buf, BufferSizeClass::Large);
}

#[test]
fn test_byte_lru_cache_budget_eviction() {
    // 1000 bytes budget
    let cache = ByteLruCache::new(1000);

    // Insert item 1: 400 bytes
    cache.insert("key1".to_string(), vec![1u8; 400], 400);
    assert_eq!(cache.current_bytes(), 400);
    assert_eq!(cache.len(), 1);

    // Insert item 2: 400 bytes (total 800 <= 1000)
    cache.insert("key2".to_string(), vec![2u8; 400], 400);
    assert_eq!(cache.current_bytes(), 800);
    assert_eq!(cache.len(), 2);

    // Access key1 to make it MRU
    assert!(cache.get(&"key1".to_string()).is_some());

    // Insert item 3: 300 bytes (800 + 300 = 1100 > 1000)
    // LRU item was key2 (since key1 was accessed). Key2 must be evicted!
    cache.insert("key3".to_string(), vec![3u8; 300], 300);

    assert!(cache.current_bytes() <= 1000);
    assert!(
        cache.get(&"key1".to_string()).is_some(),
        "key1 was MRU, should remain"
    );
    assert!(
        cache.get(&"key2".to_string()).is_none(),
        "key2 was LRU, should be evicted"
    );
    assert!(
        cache.get(&"key3".to_string()).is_some(),
        "key3 newly inserted, should exist"
    );
}
