//! Module: fg-core — Path Bloom Filter for Commit & Tree Path Acceleration
//! File Path: crates/fg-core/src/models/bloom.rs
//! Architecture Role: Encapsulates 256-bit Bloom filters for rapid O(1) negative membership tests
//!   on file paths modified within a Git commit or tree.
//! Dependencies & Triggers: Consumed by fg-topology, fg-algorithms DagWalker, and log path filters.
//! Responsibilities: Encodes changed paths using Kirsch-Mitzenmacher 7-hash double-hashing into a
//!   compact 256-bit bitset, enabling 99%+ path filtering bypass without unpacking trees.
//! Exit Semantics & Design Rationale:
//!   - Fixed 256-bit (32-byte) bitset layout fits in CPU registers, enabling
//!     zero-heap fast queries.
//!   - If may_contain(path) returns false, path was 100% NOT modified in the commit
//!     (true negative).
//!   - False positive rate < 0.25% for commits with <= 15 changed paths.

use serde::{Deserialize, Serialize};

/// 256-bit Bloom Filter for commit path filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PathBloomFilter {
    bits: [u64; 4],
}

impl Default for PathBloomFilter {
    #[inline(always)]
    fn default() -> Self {
        Self::empty()
    }
}

impl PathBloomFilter {
    /// Optimal number of hash rounds for 256-bit filter (Git commit-graph standard k=7).
    pub const HASH_ROUNDS: usize = 7;

    /// Constructs an empty Bloom filter.
    #[inline(always)]
    pub const fn empty() -> Self {
        Self { bits: [0u64; 4] }
    }

    /// Constructs a Bloom filter from an array of 4 u64 words.
    #[inline(always)]
    pub const fn from_words(words: [u64; 4]) -> Self {
        Self { bits: words }
    }

    /// Access the underlying 4 u64 words.
    #[inline(always)]
    pub const fn words(&self) -> &[u64; 4] {
        &self.bits
    }

    /// Inserts a normalized path into the Bloom filter.
    #[inline]
    pub fn insert(&mut self, path: &str) {
        let (h1, h2) = Self::hash_pair(path);
        let mut combined = h1;
        for _ in 0..Self::HASH_ROUNDS {
            let bit_index = (combined & 0xFF) as usize; // mod 256
            let word_idx = bit_index >> 6;
            let bit_in_word = bit_index & 0x3F;
            self.bits[word_idx] |= 1u64 << bit_in_word;
            combined = combined.wrapping_add(h2);
        }
    }

    /// Fast test for path membership.
    /// Returns false if path is definitely NOT present (100% certainty).
    /// Returns true if path MAY be present (with < 0.5% false positive probability).
    #[inline]
    pub fn may_contain(&self, path: &str) -> bool {
        let (h1, h2) = Self::hash_pair(path);
        let mut combined = h1;
        for _ in 0..Self::HASH_ROUNDS {
            let bit_index = (combined & 0xFF) as usize;
            let word_idx = bit_index >> 6;
            let bit_in_word = bit_index & 0x3F;
            if (self.bits[word_idx] & (1u64 << bit_in_word)) == 0 {
                return false;
            }
            combined = combined.wrapping_add(h2);
        }
        true
    }

    /// Constructs a Bloom filter from an iterator of paths.
    pub fn from_paths<I, S>(paths: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut filter = Self::empty();
        for path in paths {
            filter.insert(path.as_ref());
        }
        filter
    }

    /// Bitwise union of two Bloom filters.
    #[inline(always)]
    pub fn union(&self, other: &Self) -> Self {
        Self {
            bits: [
                self.bits[0] | other.bits[0],
                self.bits[1] | other.bits[1],
                self.bits[2] | other.bits[2],
                self.bits[3] | other.bits[3],
            ],
        }
    }

    /// Bitwise intersection of two Bloom filters.
    #[inline(always)]
    pub fn intersect(&self, other: &Self) -> Self {
        Self {
            bits: [
                self.bits[0] & other.bits[0],
                self.bits[1] & other.bits[1],
                self.bits[2] & other.bits[2],
                self.bits[3] & other.bits[3],
            ],
        }
    }

    /// Returns true if this filter has no bits set.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.bits == [0u64; 4]
    }

    /// Serializes the 256-bit filter into 32 little-endian bytes.
    #[inline]
    pub fn to_bytes(&self) -> [u8; 32] {
        let mut out = [0u8; 32];
        for (i, word) in self.bits.iter().enumerate() {
            out[i * 8..(i + 1) * 8].copy_from_slice(&word.to_le_bytes());
        }
        out
    }

    /// Deserializes from 32 little-endian bytes.
    #[inline]
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        let mut words = [0u64; 4];
        for i in 0..4 {
            let mut chunk = [0u8; 8];
            chunk.copy_from_slice(&bytes[i * 8..(i + 1) * 8]);
            words[i] = u64::from_le_bytes(chunk);
        }
        Self { bits: words }
    }

    /// Kirsch-Mitzenmacher dual-seed 64-bit FNV-1a & Murmur-style hash pair.
    #[inline]
    fn hash_pair(path: &str) -> (u64, u64) {
        let mut hash_primary = 0xcbf29ce484222325u64;
        let mut hash_secondary = 0x84222325cbf29ce4u64;

        for &byte_val in path.as_bytes() {
            hash_primary ^= byte_val as u64;
            hash_primary = hash_primary.wrapping_mul(0x100000001b3);

            hash_secondary ^= (byte_val as u64).rotate_left(3);
            hash_secondary = hash_secondary.wrapping_mul(0x517cc1b727220a95);
        }

        (hash_primary, hash_secondary)
    }
}
