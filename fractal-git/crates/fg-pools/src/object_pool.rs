//! Module: fg-pools — Zero-Allocation Object Recycle Pool
//! File Path: crates/fg-pools/src/object_pool.rs
//! Architecture Role: Implements high-throughput object recycling for AST and Tree entries,
//!   eliminating loop-internal heap allocations (ADV-PRF-002) via pre-warmed capacity slots.

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
        // SAFETY: item ownership is transferred to caller; mem::forget prevents drop
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
        // SAFETY: item is extracted exactly once on drop to be recycled into pool
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
