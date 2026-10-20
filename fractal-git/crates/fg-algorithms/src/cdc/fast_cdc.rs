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
//!     plus dual-mask normalization ($M_s, M_l$).
//!   - FastCdcIter provides zero-heap streaming chunk iteration over continuous byte buffers.
//!   - Cyclomatic Complexity CC <= 15 across all chunking routines.

use fg_core::models::Oid;
use sha1::{Digest, Sha1};

pub const DEFAULT_MIN_CHUNK: usize = 1024 * 4; // 4 KB
pub const DEFAULT_AVG_CHUNK: usize = 1024 * 16; // 16 KB
pub const DEFAULT_MAX_CHUNK: usize = 1024 * 64; // 64 KB

/// Compile-time generation of the 256-entry 64-bit Gear Hash lookup table using SplitMix64.
/// Produces ideal entropy diffusion across byte values without runtime initialization overhead.
const fn generate_gear_table() -> [u64; 256] {
    let mut table = [0u64; 256];
    let mut state = 0x9e3779b97f4a7c15u64;
    let mut i = 0;
    while i < 256 {
        state = state.wrapping_add(0x9e3779b97f4a7c15);
        let mut mixed_state = state;
        mixed_state = (mixed_state ^ (mixed_state >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        mixed_state = (mixed_state ^ (mixed_state >> 27)).wrapping_mul(0x94d049bb133111eb);
        mixed_state ^= mixed_state >> 31;
        table[i] = mixed_state;
        i += 1;
    }
    table
}

/// Static 256-entry Gear Hash lookup table in .rodata.
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

    /// Splits an input buffer into content-defined chunk descriptors (allocates a Vec).
    pub fn chunk(&self, input_bytes: &[u8]) -> Vec<ChunkDescriptor> {
        self.iter(input_bytes).collect()
    }

    /// Computes the next content-defined chunk from `input_bytes` starting at `*offset`.
    /// Advances `*offset` by the chunk length.
    pub fn next_chunk(&self, input_bytes: &[u8], offset: &mut usize) -> ChunkDescriptor {
        let len = input_bytes.len();
        let remaining = len - *offset;
        if remaining <= self.min_size {
            let chunk = Self::make_chunk(input_bytes, *offset, remaining);
            *offset = len;
            return chunk;
        }

        let max_cut = remaining.min(self.max_size);
        let mut cut = self.min_size;
        let mid = self.min_size + (max_cut - self.min_size) / 2;

        let mut fingerprint: u64 = 0;
        let mut found = false;

        while cut < max_cut {
            let byte = input_bytes[*offset + cut];
            fingerprint = (fingerprint << 1).wrapping_add(GEAR_TABLE[byte as usize]);
            let mask = if cut < mid { self.mask_s } else { self.mask_l };

            if (fingerprint & mask) == 0 {
                cut += 1;
                found = true;
                break;
            }
            cut += 1;
        }

        if !found {
            cut = max_cut;
        }

        let chunk = Self::make_chunk(input_bytes, *offset, cut);
        *offset += cut;
        chunk
    }

    fn make_chunk(input_bytes: &[u8], offset: usize, length: usize) -> ChunkDescriptor {
        let slice = &input_bytes[offset..offset + length];
        let mut hasher = Sha1::new();

        // Stack-allocated Git blob header to ensure loop zero-heap allocation (FGT-PRF-001)
        let mut header_buffer = [0u8; 32];
        let header_len = Self::write_blob_header(&mut header_buffer, length);
        hasher.update(&header_buffer[..header_len]);
        hasher.update(slice);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        ChunkDescriptor {
            offset,
            length,
            oid,
        }
    }

    #[inline]
    fn write_blob_header(buf: &mut [u8; 32], length: usize) -> usize {
        buf[..5].copy_from_slice(b"blob ");
        let mut cursor = 5;
        if length == 0 {
            buf[cursor] = b'0';
            cursor += 1;
        } else {
            let mut digits = [0u8; 20];
            let mut digit_count = 0;
            let mut remaining = length;
            while remaining > 0 {
                digits[digit_count] = b'0' + (remaining % 10) as u8;
                remaining /= 10;
                digit_count += 1;
            }
            for idx in (0..digit_count).rev() {
                buf[cursor] = digits[idx];
                cursor += 1;
            }
        }
        buf[cursor] = 0;
        cursor + 1
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
