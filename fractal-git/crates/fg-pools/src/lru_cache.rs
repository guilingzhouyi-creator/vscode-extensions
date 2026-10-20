//! Module: fg-pools — Bounded Byte-Size LRU Cache
//! File Path: crates/fg-pools/src/lru_cache.rs
//! Architecture Role: Dynamic byte-budgeted LRU cache mirroring
//!   gitoxide's `pack-cache-lru-dynamic`.
//!   Guarantees that decompressed tree objects, commit descriptors, and CAS blocks
//!   never exceed physical memory ceilings.
//! Dependencies & Triggers: Consumed by storage backends, ODB loose decoders,
//!   and DAG walking caches.
//! Responsibilities: Tracks exact byte footprint and evicts least-recently-used items
//!   when exceeding memory budgets.
//! Exit Semantics & Design Rationale:
//!   - Unlike item-count LRUs, byte-size caps accurately prevent OOM when caching
//!     heterogeneous objects (2KB tree vs 50MB blob).
//!   - Thread-safe interior mutability powered by parking_lot Mutex.

use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

struct LruInner<K, V> {
    max_bytes: usize,
    current_bytes: usize,
    entries: HashMap<K, (V, usize)>,
    order: VecDeque<K>,
}

impl<K: Hash + Eq + Clone, V> LruInner<K, V> {
    fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            current_bytes: 0,
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &K) -> Option<&V> {
        if self.entries.contains_key(key) {
            // Move key to back (MRU)
            if let Some(pos) = self.order.iter().position(|cached_key| cached_key == key) {
                self.order.remove(pos);
                self.order.push_back(key.clone());
            }
            self.entries.get(key).map(|(value_ref, _)| value_ref)
        } else {
            None
        }
    }

    fn insert(&mut self, key: K, value: V, size_bytes: usize) {
        // If key already exists, deduct its previous size
        if let Some((_, old_size)) = self.entries.remove(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(old_size);
            if let Some(pos) = self.order.iter().position(|cached_key| cached_key == &key) {
                self.order.remove(pos);
            }
        }

        // Evict LRU items while over budget
        while self.current_bytes + size_bytes > self.max_bytes && !self.order.is_empty() {
            if let Some(lru_key) = self.order.pop_front() {
                if let Some((_, evicted_size)) = self.entries.remove(&lru_key) {
                    self.current_bytes = self.current_bytes.saturating_sub(evicted_size);
                }
            }
        }

        self.current_bytes += size_bytes;
        self.entries.insert(key.clone(), (value, size_bytes));
        self.order.push_back(key);
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.current_bytes = 0;
    }
}

/// Thread-safe byte-bounded LRU cache for high-throughput object databases.
pub struct ByteLruCache<K, V> {
    inner: Mutex<LruInner<K, V>>,
}

impl<K: Hash + Eq + Clone, V: Clone> ByteLruCache<K, V> {
    /// Constructs a cache with maximum byte budget (e.g. 128 MB = 128 * 1024 * 1024).
    pub fn new(max_bytes: usize) -> Self {
        Self {
            inner: Mutex::new(LruInner::new(max_bytes)),
        }
    }

    /// Retrieves an entry if present, marking it as most-recently-used.
    pub fn get(&self, key: &K) -> Option<V> {
        self.inner.lock().get(key).cloned()
    }

    /// Inserts an entry along with its physical byte footprint.
    pub fn insert(&self, key: K, value: V, size_bytes: usize) {
        self.inner.lock().insert(key, value, size_bytes);
    }

    /// Current allocated memory footprint in bytes.
    pub fn current_bytes(&self) -> usize {
        self.inner.lock().current_bytes
    }

    /// Maximum memory capacity in bytes.
    pub fn max_bytes(&self) -> usize {
        self.inner.lock().max_bytes
    }

    /// Number of cached items currently residing in memory.
    pub fn len(&self) -> usize {
        self.inner.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Clears all cached items and resets byte footprint to zero.
    pub fn clear(&self) {
        self.inner.lock().clear();
    }
}
