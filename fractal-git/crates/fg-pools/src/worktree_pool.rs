//! Module: fg-pools — Pre-Warmed Virtual Worktree Pool
//! File Path: crates/fg-pools/src/worktree_pool.rs
//! Architecture Role: Pre-allocates and recycles ephemeral worktree identifiers and scratch spaces,
//!   reducing initialization latency for dynamic subagent swarms.

use parking_lot::Mutex;
use std::collections::VecDeque;

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
}

/// Pool managing active and idle worktree slots.
pub struct WorktreePool {
    available_slots: Mutex<VecDeque<usize>>,
    max_slots: usize,
}

impl WorktreePool {
    /// Constructs a worktree slot pool with fixed maximum concurrency.
    pub fn new(max_slots: usize) -> Self {
        let mut slots = VecDeque::with_capacity(max_slots);
        for i in 0..max_slots {
            slots.push_back(i);
        }
        Self {
            available_slots: Mutex::new(slots),
            max_slots,
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
        guard.pop_front().map(|slot_id| WorktreeDescriptor {
            slot_id,
            token: format!("{}-slot-{}", prefix, slot_id),
            is_active: true,
            mode,
            epoch: 0,
            scopes,
        })
    }

    /// Releases a slot back to the available pool.
    pub fn release_slot(&self, slot: WorktreeDescriptor) {
        let mut guard = self.available_slots.lock();
        if guard.len() < self.max_slots && !guard.contains(&slot.slot_id) {
            guard.push_back(slot.slot_id);
        }
    }

    /// Number of currently idle slots.
    pub fn available_count(&self) -> usize {
        self.available_slots.lock().len()
    }
}
