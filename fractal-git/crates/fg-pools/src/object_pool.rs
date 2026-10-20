//! Module: fg-pools — Zero-Allocation Object Recycle Pool
//! File Path: crates/fg-pools/src/object_pool.rs
//! Architecture Role: Implements high-throughput object recycling for AST and Tree entries,
//!   eliminating loop-internal heap allocations (ADV-PRF-002) via pre-warmed capacity slots.

use parking_lot::Mutex;

/// Trait for items that can be reset to clean state for reuse.
pub trait Resettable {
    fn reset_state(&mut self);
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

    /// Releases an item back to the pool, resetting its internal state.
    pub fn release(&self, mut recycled_element: T) {
        recycled_element.reset_state();
        let mut guard = self.storage.lock();
        if guard.len() < self.capacity {
            guard.push(recycled_element);
        }
    }
}
