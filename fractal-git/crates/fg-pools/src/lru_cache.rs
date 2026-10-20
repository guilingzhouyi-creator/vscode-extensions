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
use std::collections::HashMap;
use std::hash::Hash;

struct LruNode<K, V> {
    key: K,
    value: V,
    size_bytes: usize,
    prev_index: Option<usize>,
    next_index: Option<usize>,
}

struct LruInner<K, V> {
    max_bytes: usize,
    current_bytes: usize,
    entries: HashMap<K, usize>,
    nodes: Vec<Option<LruNode<K, V>>>,
    free_slots: Vec<usize>,
    head_index: Option<usize>,
    tail_index: Option<usize>,
}

impl<K: Hash + Eq + Clone, V> LruInner<K, V> {
    fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            current_bytes: 0,
            entries: HashMap::new(),
            nodes: Vec::new(),
            free_slots: Vec::new(),
            head_index: None,
            tail_index: None,
        }
    }

    fn detach_node(&mut self, slot_index: usize) {
        let (prev_opt, next_opt) = match self.nodes.get(slot_index).and_then(|slot| slot.as_ref()) {
            Some(node) => (node.prev_index, node.next_index),
            None => return,
        };

        if let Some(prev_idx) = prev_opt {
            if let Some(Some(ref mut prev_node)) = self.nodes.get_mut(prev_idx) {
                prev_node.next_index = next_opt;
            }
        } else {
            self.head_index = next_opt;
        }

        if let Some(next_idx) = next_opt {
            if let Some(Some(ref mut next_node)) = self.nodes.get_mut(next_idx) {
                next_node.prev_index = prev_opt;
            }
        } else {
            self.tail_index = prev_opt;
        }

        if let Some(Some(ref mut current_node)) = self.nodes.get_mut(slot_index) {
            current_node.prev_index = None;
            current_node.next_index = None;
        }
    }

    fn attach_to_tail(&mut self, slot_index: usize) {
        if let Some(old_tail) = self.tail_index {
            if let Some(Some(ref mut tail_node)) = self.nodes.get_mut(old_tail) {
                tail_node.next_index = Some(slot_index);
            }
            if let Some(Some(ref mut current_node)) = self.nodes.get_mut(slot_index) {
                current_node.prev_index = Some(old_tail);
                current_node.next_index = None;
            }
            self.tail_index = Some(slot_index);
        } else {
            self.head_index = Some(slot_index);
            self.tail_index = Some(slot_index);
            if let Some(Some(ref mut current_node)) = self.nodes.get_mut(slot_index) {
                current_node.prev_index = None;
                current_node.next_index = None;
            }
        }
    }

    fn promote_to_mru(&mut self, slot_index: usize) {
        if self.tail_index == Some(slot_index) {
            return;
        }
        self.detach_node(slot_index);
        self.attach_to_tail(slot_index);
    }

    fn pop_lru_node(&mut self) -> Option<(K, usize)> {
        let oldest_idx = self.head_index?;
        self.detach_node(oldest_idx);
        let node = self.nodes.get_mut(oldest_idx)?.take()?;
        self.free_slots.push(oldest_idx);
        Some((node.key, node.size_bytes))
    }

    fn allocate_slot(&mut self) -> usize {
        if let Some(recycled) = self.free_slots.pop() {
            recycled
        } else {
            let new_slot = self.nodes.len();
            self.nodes.push(None);
            new_slot
        }
    }

    fn get(&mut self, key: &K) -> Option<&V> {
        if let Some(&slot_index) = self.entries.get(key) {
            self.promote_to_mru(slot_index);
            self.nodes.get(slot_index)?.as_ref().map(|node| &node.value)
        } else {
            None
        }
    }

    fn insert(&mut self, key: K, value: V, size_bytes: usize) {
        if let Some(&slot_index) = self.entries.get(&key) {
            let old_size = if let Some(Some(ref mut node)) = self.nodes.get_mut(slot_index) {
                let previous = node.size_bytes;
                node.value = value;
                node.size_bytes = size_bytes;
                previous
            } else {
                0
            };
            self.current_bytes = self.current_bytes.saturating_sub(old_size);
            self.promote_to_mru(slot_index);
        } else {
            while self.current_bytes + size_bytes > self.max_bytes && self.head_index.is_some() {
                if let Some((lru_key, evicted_size)) = self.pop_lru_node() {
                    self.entries.remove(&lru_key);
                    self.current_bytes = self.current_bytes.saturating_sub(evicted_size);
                }
            }

            let slot = self.allocate_slot();
            self.nodes[slot] = Some(LruNode {
                key: key.clone(),
                value,
                size_bytes,
                prev_index: None,
                next_index: None,
            });
            self.attach_to_tail(slot);
            self.entries.insert(key, slot);
        }

        self.current_bytes += size_bytes;

        while self.current_bytes > self.max_bytes && self.head_index.is_some() {
            if let Some((lru_key, evicted_size)) = self.pop_lru_node() {
                self.entries.remove(&lru_key);
                self.current_bytes = self.current_bytes.saturating_sub(evicted_size);
            }
        }
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.nodes.clear();
        self.free_slots.clear();
        self.head_index = None;
        self.tail_index = None;
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
