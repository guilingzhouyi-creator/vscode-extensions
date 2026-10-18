//! Module: fg-pools — Pre-Warmed Virtual Worktree Pool
//! File Path: crates/fg-pools/src/worktree_pool.rs
//! Architecture Role: Pre-allocates and recycles ephemeral worktree identifiers and scratch spaces,
//!   reducing initialization latency for dynamic subagent swarms.

use parking_lot::Mutex;
use std::collections::VecDeque;

/// Descriptor of a managed virtual worktree scratch allocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeDescriptor {
    pub slot_id: usize,
    pub token: String,
    pub is_active: bool,
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

    /// Acquires a slot from the pool. Returns None if max concurrency is reached.
    pub fn acquire_slot(&self, prefix: &str) -> Option<WorktreeDescriptor> {
        let mut guard = self.available_slots.lock();
        guard.pop_front().map(|slot_id| WorktreeDescriptor {
            slot_id,
            token: format!("{}-slot-{}", prefix, slot_id),
            is_active: true,
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
