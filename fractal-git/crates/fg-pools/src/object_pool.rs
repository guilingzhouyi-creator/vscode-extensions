//! Module: fg-pools — Zero-Allocation Object Recycle Pool
//! File Path: crates/fg-pools/src/object_pool.rs
//! Architecture Role: Implements high-throughput object recycling for tree entries and buffers,
//!   eliminating loop-internal heap allocations via pre-warmed capacity slots.
//! Dependencies & Triggers: Consumed by tree builders, diff engines, and index parsing pipelines.
//! Responsibilities: Pool pre-warmed capacity slots, reset state on reclaim, and guard life cycles via RAII.
//! Exit Semantics & Design Rationale: Returns cleanly reset instances without reallocating underlying buffers.
//!
//! Domain Governance Rules: FGT-PRF-001 (zero heap loop allocation), FGT-COR-001, FGT-POL-001.

use parking_lot::Mutex;
use std::mem::ManuallyDrop;
use std::ops::{Deref, DerefMut};

/// Trait for items that can be reset to clean state for reuse.
pub trait Resettable {
    fn reset_state(&mut self);
}

/// RAII guard providing automatic recycling of pooled objects on drop.
pub struct RecycledGuard<'a, T: Resettable> {
    pool: &'a RecyclePool<T>,
    item: ManuallyDrop<T>,
}

impl<'a, T: Resettable> RecycledGuard<'a, T> {
    /// Detaches the item from the pool, preventing automatic return on drop.
    pub fn take(mut self) -> T {
        // SAFETY:
        // - Preconditions: `self.item` wraps an initialized value of type `T`.
        // - Invariants: `std::mem::forget(self)` immediately suppresses `Drop::drop`, preventing double extraction.
        // - Postconditions: Complete ownership of the inner `T` is transferred to the caller without recycling.
        let extracted_element = unsafe { ManuallyDrop::take(&mut self.item) };
        std::mem::forget(self);
        extracted_element
    }
}

impl<'a, T: Resettable> Deref for RecycledGuard<'a, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.item
    }
}

impl<'a, T: Resettable> DerefMut for RecycledGuard<'a, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.item
    }
}

impl<'a, T: Resettable> Drop for RecycledGuard<'a, T> {
    fn drop(&mut self) {
        // SAFETY:
        // - Preconditions: `self.item` wraps a live, initialized instance of `T` that was not taken via `take()`.
        // - Invariants: `Drop::drop` runs exactly once at the end of the guard's lifetime.
        // - Postconditions: The extracted item is delivered to `self.pool.release()` which resets state and returns it to storage.
        let extracted = unsafe { ManuallyDrop::take(&mut self.item) };
        self.pool.release(extracted);
    }
}

/// Thread-safe generic object recycling pool.
pub struct RecyclePool<T: Resettable> {
    storage: Mutex<Vec<T>>,
    factory: Box<dyn Fn() -> T + Send + Sync>,
    capacity: usize,
}

impl<T: Resettable> RecyclePool<T> {
    /// Constructs a pool with designated maximum cached item capacity and element factory.
    pub fn new(capacity: usize, factory: impl Fn() -> T + Send + Sync + 'static) -> Self {
        Self {
            storage: Mutex::new(Vec::with_capacity(capacity)),
            factory: Box::new(factory),
            capacity,
        }
    }

    /// Acquires an item from the pool or constructs a new one if pool is empty.
    pub fn acquire(&self) -> T {
        let mut guard = self.storage.lock();
        guard.pop().unwrap_or_else(|| (self.factory)())
    }

    /// Acquires an item from the pool wrapped in an RAII recycling guard.
    pub fn acquire_guard(&self) -> RecycledGuard<'_, T> {
        RecycledGuard {
            pool: self,
            item: ManuallyDrop::new(self.acquire()),
        }
    }

    /// Releases an item back to the pool, resetting its internal state.
    pub fn release(&self, mut recycled_element: T) {
        recycled_element.reset_state();
        let mut guard = self.storage.lock();
        if guard.len() < self.capacity {
            guard.push(recycled_element);
        }
    }
}
