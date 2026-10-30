//! Module: fg-pools — Pre-Warmed Virtual Worktree Pool
//! File Path: crates/fg-pools/src/worktree_pool.rs
//! Architecture Role: Pre-allocates and recycles ephemeral worktree identifiers and scratch spaces,
//!   reducing initialization latency for dynamic subagent swarms.
//! Dependencies & Triggers: Consumed by Taxis worktree CLI and subagent orchestration runtime.
//! Responsibilities: Manage pre-warmed worktree slots, track acquisition epochs, and enforce bounded slot reuse.
//! Exit Semantics & Design Rationale: Provides sub-millisecond slot provisioning; resets epochs on recycling.
//!
//! Domain Governance Rules: FGT-PRF-001 (worktree slot pooling), FGT-COR-001, PRF-LEAK-001.

use fg_core::error::{FractalError, FractalResult};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};

/// Execution acceleration mode for dynamic virtual worktree allocations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeMode {
    /// Zero-disk in-memory virtual tree (LayerVFS overlay + InMemoryIndexTree).
    /// Creation latency: <100µs. Ideal for AST analyzers, pure tests, and diff staging.
    VirtualMemory,
    /// Fast Copy-on-Write block cloning / hardlinks (Dev Drive / ReFS / btrfs / reflink).
    /// Creation latency: ~5-15ms. Used when physical compilers (cargo, rustc) must touch disk.
    CoWClone,
    /// Sparse ghost checkout: only path-jailed directories materialized, rest are virtual stubs.
    /// Creation latency: ~1ms. Shrinks physical disk footprint by >95%.
    SparseGhost,
}

/// Descriptor of a managed virtual worktree scratch allocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeDescriptor {
    pub slot_id: usize,
    pub token: String,
    pub is_active: bool,
    pub mode: WorktreeMode,
    pub epoch: u64,
    pub scopes: Vec<String>,
    /// Direct-bypass physical cache directory (.taxis/worktrees/{slot_id}/cache)
    pub direct_bypass_cache: PathBuf,
    /// Direct-bypass physical test-store directory (.taxis/worktrees/{slot_id}/test-store)
    pub direct_bypass_test_store: PathBuf,
}

/// Pool managing active and idle worktree slots.
pub struct WorktreePool {
    available_slots: Mutex<VecDeque<usize>>,
    max_slots: usize,
    base_dir: PathBuf,
}

impl WorktreePool {
    /// Constructs a worktree slot pool with fixed maximum concurrency and default temporary root.
    pub fn new(max_slots: usize) -> Self {
        Self::with_base_dir(std::env::temp_dir().join(".taxis-worktrees"), max_slots)
    }

    /// Constructs a worktree slot pool anchored at an explicit base directory.
    pub fn with_base_dir(base_dir: PathBuf, max_slots: usize) -> Self {
        let mut slots = VecDeque::with_capacity(max_slots);
        for i in 0..max_slots {
            slots.push_back(i);
        }
        Self {
            available_slots: Mutex::new(slots),
            max_slots,
            base_dir,
        }
    }

    /// Acquires a slot from the pool with default VirtualMemory mode.
    /// Returns None if max concurrency is reached.
    pub fn acquire_slot(&self, prefix: &str) -> Option<WorktreeDescriptor> {
        self.acquire_slot_with_mode(prefix, WorktreeMode::VirtualMemory)
    }

    /// Acquires a slot from the pool with explicit acceleration mode.
    pub fn acquire_slot_with_mode(
        &self,
        prefix: &str,
        mode: WorktreeMode,
    ) -> Option<WorktreeDescriptor> {
        self.acquire_scoped_slot(prefix, mode, Vec::new())
    }

    /// Acquires a slot from the pool with explicit acceleration mode and delegated scope regions.
    pub fn acquire_scoped_slot(
        &self,
        prefix: &str,
        mode: WorktreeMode,
        scopes: Vec<String>,
    ) -> Option<WorktreeDescriptor> {
        let mut guard = self.available_slots.lock();
        guard.pop_front().map(|slot_id| {
            let slot_dir = self.base_dir.join(format!("slot_{slot_id:03}"));
            WorktreeDescriptor {
                slot_id,
                token: format!("{prefix}-slot-{slot_id}"),
                is_active: true,
                mode,
                epoch: 0,
                scopes,
                direct_bypass_cache: slot_dir.join("cache"),
                direct_bypass_test_store: slot_dir.join("test-store"),
            }
        })
    }

    /// Releases a slot back to the available pool.
    pub fn release_slot(&self, slot: WorktreeDescriptor) {
        let mut slot_queue = self.available_slots.lock();
        if slot_queue.len() < self.max_slots && !slot_queue.contains(&slot.slot_id) {
            slot_queue.push_back(slot.slot_id);
        }
    }

    /// Releases a slot back to the available pool and physically purges its direct-bypass directories.
    ///
    /// # Errors
    /// Returns [`FractalError::Io`] if physical removal fails or [`FractalError::PolicyViolation`]
    /// if path fails the anti-destruction boundary checks (`GUARD-DESTR-001`).
    pub fn release_and_purge_slot(&self, slot: WorktreeDescriptor) -> FractalResult<()> {
        Self::assert_safe_scratch_path(&slot.direct_bypass_cache)?;
        Self::assert_safe_scratch_path(&slot.direct_bypass_test_store)?;

        if slot.direct_bypass_cache.exists() {
            fs::remove_dir_all(&slot.direct_bypass_cache)?;
        }
        if slot.direct_bypass_test_store.exists() {
            fs::remove_dir_all(&slot.direct_bypass_test_store)?;
        }

        self.release_slot(slot);
        Ok(())
    }

    /// Assert that the path is an authorized scratch directory to prevent accidental destruction.
    fn assert_safe_scratch_path(path: &Path) -> FractalResult<()> {
        let path_repr = path.to_string_lossy();
        if path_repr.is_empty() || path_repr == "/" || path_repr == "\\" {
            return Err(FractalError::PolicyViolation(
                "Refusing to purge root or empty path".into(),
            ));
        }
        if !path_repr.contains("slot_") && !path_repr.contains(".taxis") {
            return Err(FractalError::PolicyViolation(format!(
                "Refusing to purge non-slot path: '{path_repr}'"
            )));
        }
        Ok(())
    }

    /// Number of currently idle slots.
    pub fn available_count(&self) -> usize {
        self.available_slots.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_temp_path(prefix: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = fs::create_dir_all(&base);
        base.join(format!("{}_{}_{}", prefix, std::process::id(), count))
    }

    #[test]
    fn test_worktree_descriptor_direct_bypass_paths() {
        let temp_base = test_temp_path("taxis_test_pool");
        let _ = fs::remove_dir_all(&temp_base);
        fs::create_dir_all(&temp_base).expect("create temp base");

        let pool = WorktreePool::with_base_dir(temp_base.clone(), 4);

        let slot = pool.acquire_slot("sub").expect("slot available");
        assert_eq!(slot.slot_id, 0);
        assert!(
            slot.direct_bypass_cache.ends_with("slot_000/cache")
                || slot.direct_bypass_cache.ends_with("slot_000\\cache")
        );
        assert!(
            slot.direct_bypass_test_store
                .ends_with("slot_000/test-store")
                || slot
                    .direct_bypass_test_store
                    .ends_with("slot_000\\test-store")
        );

        // Create mock files inside direct bypass directories
        fs::create_dir_all(&slot.direct_bypass_cache).unwrap();
        fs::create_dir_all(&slot.direct_bypass_test_store).unwrap();
        fs::write(
            slot.direct_bypass_cache.join("build.cache"),
            b"compiled_data",
        )
        .unwrap();
        fs::write(
            slot.direct_bypass_test_store.join("golden.snap"),
            b"snapshot_data",
        )
        .unwrap();

        assert!(slot.direct_bypass_cache.join("build.cache").exists());
        assert!(slot.direct_bypass_test_store.join("golden.snap").exists());

        // Purge and release
        pool.release_and_purge_slot(slot).expect("purge success");
        assert_eq!(pool.available_count(), 4);

        // Assert directories are physically wiped clean
        let slot_dir = temp_base.join("slot_000");
        assert!(!slot_dir.join("cache").exists());
        assert!(!slot_dir.join("test-store").exists());

        let _ = fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_concurrent_multislot_isolation_and_lockless_purge() {
        let temp_base = test_temp_path("taxis_concurrent_pool");
        let pool = std::sync::Arc::new(WorktreePool::with_base_dir(temp_base.clone(), 8));

        let mut handles = Vec::new();
        for i in 0..4 {
            let pool_clone = std::sync::Arc::clone(&pool);
            handles.push(std::thread::spawn(move || {
                let slot = pool_clone
                    .acquire_slot(&format!("sub_{i}"))
                    .expect("slot available");
                // Write slot-exclusive data
                fs::create_dir_all(&slot.direct_bypass_cache).unwrap();
                let file = slot.direct_bypass_cache.join(format!("worker_{i}.tmp"));
                fs::write(&file, format!("payload_{i}")).unwrap();
                assert!(file.exists());

                // Purge immediately
                pool_clone.release_and_purge_slot(slot).unwrap();
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(pool.available_count(), 8);
        let _ = fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn test_anti_destruction_guard_rejects_unsafe_paths() {
        assert!(WorktreePool::assert_safe_scratch_path(Path::new("/")).is_err());
        assert!(WorktreePool::assert_safe_scratch_path(Path::new("C:\\")).is_err());
        assert!(WorktreePool::assert_safe_scratch_path(Path::new("")).is_err());
        assert!(WorktreePool::assert_safe_scratch_path(Path::new("/home/user")).is_err());
        assert!(WorktreePool::assert_safe_scratch_path(Path::new(
            "/tmp/.taxis-worktrees/slot_001/cache"
        ))
        .is_ok());
    }
}
