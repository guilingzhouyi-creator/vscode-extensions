//! Module: fg-pools — Reusable Virtual Sandbox Slot Pool
//! File Path: crates/fg-pools/src/sandbox_pool.rs
//! Architecture Role: Manages pre-warmed, reusable virtual scratch sandbox slots,
//!   eliminating directory allocation churn during high-frequency SubAgent spawning.

use parking_lot::Mutex;
use std::collections::VecDeque;

/// A reusable scratch sandbox slot descriptor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSlot {
    pub id: usize,
    pub path_tag: String,
    pub in_use: bool,
}

/// Thread-safe pool of sandbox workspace slots.
pub struct SandboxPool {
    free_slots: Mutex<VecDeque<SandboxSlot>>,
    max_slots: usize,
}

impl SandboxPool {
    /// Creates a pool with `max_slots` capacity.
    pub fn new(max_slots: usize) -> Self {
        let mut slots = VecDeque::with_capacity(max_slots);
        for i in 0..max_slots {
            slots.push_back(SandboxSlot {
                id: i,
                path_tag: format!("sandbox-slot-{:03}", i),
                in_use: false,
            });
        }
        Self {
            free_slots: Mutex::new(slots),
            max_slots,
        }
    }

    /// Acquires an idle sandbox slot.
    pub fn acquire(&self) -> Option<SandboxSlot> {
        let mut guard = self.free_slots.lock();
        guard.pop_front().map(|mut s| {
            s.in_use = true;
            s
        })
    }

    /// Releases a slot back to the idle queue.
    pub fn release(&self, mut slot: SandboxSlot) {
        slot.in_use = false;
        let mut guard = self.free_slots.lock();
        if guard.len() < self.max_slots {
            guard.push_back(slot);
        }
    }

    /// Count of currently available idle slots.
    pub fn available(&self) -> usize {
        self.free_slots.lock().len()
    }
}
