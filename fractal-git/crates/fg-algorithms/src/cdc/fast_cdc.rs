//! Module: fg-algorithms — FastCDC Variable-Length Chunker (USENIX ATC '16 Standard)
//! File Path: crates/fg-algorithms/src/cdc/fast_cdc.rs
//! Architecture Role: Implements fast content-defined chunking (FastCDC) based on USENIX ATC '16,
//!   splitting large blobs into deduplicated variable-length slices for CAS storage.
//! Dependencies & Triggers: Consumed by CAS materializers, loose object databases,
//!   and pack builders.
//! Responsibilities: Computes 64-bit Gear hash rolling cut-points with dual-mask
//!   normalized chunking and zero-allocation streaming iterators.
//! Exit Semantics & Design Rationale:
//!   - Complies with USENIX ATC '16 FastCDC: 256-entry SplitMix64 Gear Table
//!     plus dual-mask normalization (`mask_s`, `mask_l`).
//!   - `FastCdcIter` provides zero-heap streaming chunk iteration over continuous byte buffers.
//!   - Delegates Git blob digest framing to `fg_core::models::compute_object_oid`.
//!
//! Domain Governance Rules: FGT-ALG-001 (FastCDC chunking), FGT-COR-001, FGT-PRF-001.

use fg_core::models::{compute_object_oid, ObjectKind, Oid};

/// Default minimum chunk size threshold (4 KiB) below which no boundary check is performed.
pub const DEFAULT_MIN_CHUNK: usize = 1024 * 4;

/// Default target average chunk size (16 KiB) governing FastCDC boundary probability masks.
pub const DEFAULT_AVG_CHUNK: usize = 1024 * 16;

/// Default maximum chunk size boundary (64 KiB) enforcing hard cutoff to cap chunk latency.
pub const DEFAULT_MAX_CHUNK: usize = 1024 * 64;

/// Compile-time generation of the 256-entry 64-bit Gear Hash lookup table using SplitMix64.
/// Produces uniform entropy diffusion across byte values without runtime initialization overhead.
const fn generate_gear_table() -> [u64; 256] {
    let mut table = [0u64; 256];
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut table_index = 0;
    while table_index < 256 {
        state = state.wrapping_add(0x9e3779b97f4a7c15);
        let mut mixed_state = state;
        mixed_state = (mixed_state ^ (mixed_state >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        mixed_state = (mixed_state ^ (mixed_state >> 27)).wrapping_mul(0x94d049bb133111eb);
        mixed_state ^= mixed_state >> 31;
        table[table_index] = mixed_state;
        table_index += 1;
    }
    table
}

/// Static 256-entry Gear Hash lookup table in `.rodata`.
pub static GEAR_TABLE: [u64; 256] = generate_gear_table();

/// Descriptor of a content-defined chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDescriptor {
    pub offset: usize,
    pub length: usize,
    pub oid: Oid,
}

/// FastCDC chunking engine conforming to USENIX ATC '16 specifications.
#[derive(Debug, Clone)]
pub struct FastCdcChunker {
    pub min_size: usize,
    pub avg_size: usize,
    pub max_size: usize,
    pub mask_s: u64,
    pub mask_l: u64,
}

impl Default for FastCdcChunker {
    fn default() -> Self {
        Self::new(DEFAULT_MIN_CHUNK, DEFAULT_AVG_CHUNK, DEFAULT_MAX_CHUNK)
    }
}

impl FastCdcChunker {
    /// Constructs a chunker with custom window boundaries and normalized bit-masks.
    pub fn new(min_size: usize, avg_size: usize, max_size: usize) -> Self {
        let min_size = min_size.max(16);
        let avg_size = avg_size.max(min_size);
        let max_size = max_size.max(avg_size);

        let bits = (avg_size as f64).log2().round() as u32;
        let bits = bits.clamp(4, 62);
        let mask_s = (1u64 << (bits + 1)) - 1;
        let mask_l = (1u64 << (bits.saturating_sub(1))) - 1;

        Self {
            min_size,
            avg_size,
            max_size,
            mask_s,
            mask_l,
        }
    }

    /// Returns target average chunk size.
    pub fn avg_size(&self) -> usize {
        self.avg_size
    }

    /// Creates a zero-allocation streaming iterator over content-defined chunks in `input_bytes`.
    #[inline]
    pub fn iter<'a>(&'a self, input_bytes: &'a [u8]) -> FastCdcIter<'a> {
        FastCdcIter {
            chunker: self,
            input_bytes,
            offset: 0,
        }
    }

    /// Splits an input buffer into content-defined chunk descriptors (allocates a `Vec`).
    pub fn chunk(&self, input_bytes: &[u8]) -> Vec<ChunkDescriptor> {
        self.iter(input_bytes).collect()
    }

    /// Computes the next content-defined boundary without calculating the SHA-1 digest.
    /// Returns `(chunk_offset, chunk_length)` and advances `*offset`.
    #[inline]
    pub fn next_boundary(&self, input_bytes: &[u8], offset: &mut usize) -> (usize, usize) {
        let len = input_bytes.len();
        let current_offset = *offset;
        let remaining = len - current_offset;
        if remaining <= self.min_size {
            *offset = len;
            return (current_offset, remaining);
        }

        let max_cut = remaining.min(self.max_size);
        let mut cut_offset = self.min_size;
        let midpoint = self.min_size + (max_cut - self.min_size) / 2;
        let slice = &input_bytes[current_offset..current_offset + max_cut];

        let mut fingerprint: u64 = 0;
        let mut found = false;

        // Small-mask normalization window [min_size..midpoint)
        while cut_offset < midpoint {
            let byte = slice[cut_offset];
            fingerprint = (fingerprint << 1).wrapping_add(GEAR_TABLE[byte as usize]);
            cut_offset += 1;
            if (fingerprint & self.mask_s) == 0 {
                found = true;
                break;
            }
        }

        // Large-mask normalization window [midpoint..max_cut)
        if !found {
            while cut_offset < max_cut {
                let byte = slice[cut_offset];
                fingerprint = (fingerprint << 1).wrapping_add(GEAR_TABLE[byte as usize]);
                cut_offset += 1;
                if (fingerprint & self.mask_l) == 0 {
                    found = true;
                    break;
                }
            }
        }

        if !found {
            cut_offset = max_cut;
        }

        *offset = current_offset + cut_offset;
        (current_offset, cut_offset)
    }

    /// Computes the next content-defined chunk from `input_bytes` starting at `*offset`.
    /// Advances `*offset` by the chunk length.
    pub fn next_chunk(&self, input_bytes: &[u8], offset: &mut usize) -> ChunkDescriptor {
        let (chunk_offset, chunk_len) = self.next_boundary(input_bytes, offset);
        Self::make_chunk(input_bytes, chunk_offset, chunk_len)
    }

    /// Creates an iterator over content-defined chunk boundaries (offset, length) without SHA-1 hashing.
    #[inline]
    pub fn iter_boundaries<'a>(&'a self, input_bytes: &'a [u8]) -> FastCdcBoundaryIter<'a> {
        FastCdcBoundaryIter {
            chunker: self,
            input_bytes,
            offset: 0,
        }
    }

    pub(crate) fn make_chunk_from_slice(slice: &[u8], offset: usize) -> ChunkDescriptor {
        ChunkDescriptor {
            offset,
            length: slice.len(),
            oid: compute_object_oid(ObjectKind::Blob, slice),
        }
    }

    fn make_chunk(input_bytes: &[u8], offset: usize, length: usize) -> ChunkDescriptor {
        Self::make_chunk_from_slice(&input_bytes[offset..offset + length], offset)
    }
}

/// Zero-allocation streaming iterator over content-defined chunk descriptors.
#[derive(Debug, Clone)]
pub struct FastCdcIter<'a> {
    chunker: &'a FastCdcChunker,
    input_bytes: &'a [u8],
    offset: usize,
}

impl<'a> Iterator for FastCdcIter<'a> {
    type Item = ChunkDescriptor;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        if self.offset >= self.input_bytes.len() {
            return None;
        }
        Some(self.chunker.next_chunk(self.input_bytes, &mut self.offset))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.input_bytes.len().saturating_sub(self.offset);
        if remaining == 0 {
            (0, Some(0))
        } else {
            let min_chunks = remaining.div_ceil(self.chunker.max_size);
            let max_chunks = remaining.div_ceil(self.chunker.min_size);
            (min_chunks, Some(max_chunks))
        }
    }
}

/// Zero-allocation streaming iterator over content-defined chunk boundaries (offset, length).
#[derive(Debug, Clone)]
pub struct FastCdcBoundaryIter<'a> {
    chunker: &'a FastCdcChunker,
    input_bytes: &'a [u8],
    offset: usize,
}

impl<'a> Iterator for FastCdcBoundaryIter<'a> {
    type Item = (usize, usize);

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        if self.offset >= self.input_bytes.len() {
            return None;
        }
        Some(self.chunker.next_boundary(self.input_bytes, &mut self.offset))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = self.input_bytes.len().saturating_sub(self.offset);
        if remaining == 0 {
            (0, Some(0))
        } else {
            let min_chunks = remaining.div_ceil(self.chunker.max_size);
            let max_chunks = remaining.div_ceil(self.chunker.min_size);
            (min_chunks, Some(max_chunks))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gear_table_entropy() {
        assert_eq!(GEAR_TABLE.len(), 256);
        assert_ne!(GEAR_TABLE[0], 0);
        assert_ne!(GEAR_TABLE[1], GEAR_TABLE[2]);
    }

    #[test]
    fn test_fast_cdc_iter_and_chunk_equivalence() {
        let chunker = FastCdcChunker::new(32, 64, 128);
        let mut data = Vec::with_capacity(512);
        for i in 0..512 {
            data.push(((i * 7 + 13) % 256) as u8);
        }

        let from_chunk = chunker.chunk(&data);
        let from_iter: Vec<ChunkDescriptor> = chunker.iter(&data).collect();

        assert_eq!(from_chunk, from_iter);
        assert!(!from_chunk.is_empty());

        let mut total = 0;
        for chunk in from_chunk {
            assert!(chunk.length >= 32);
            assert!(chunk.length <= 128);
            total += chunk.length;
        }
        assert_eq!(total, 512);
    }

    #[test]
    fn test_fast_cdc_empty_input() {
        let chunker = FastCdcChunker::default();
        let chunks = chunker.chunk(&[]);
        assert!(chunks.is_empty());

        let mut iter = chunker.iter(&[]);
        assert_eq!(iter.next(), None);
    }
}
