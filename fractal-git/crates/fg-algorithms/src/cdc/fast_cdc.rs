//! Module: fg-algorithms — FastCDC Variable-Length Chunker
//! File Path: crates/fg-algorithms/src/cdc/fast_cdc.rs
//! Architecture Role: Implements fast content-defined chunking (FastCDC), splitting large
//!   blobs into deduplicated variable-length slices for high-efficiency CAS storage.

use fg_core::models::Oid;
use sha1::{Digest, Sha1};

pub const DEFAULT_MIN_CHUNK: usize = 1024 * 4;   // 4 KB
pub const DEFAULT_AVG_CHUNK: usize = 1024 * 16;  // 16 KB
pub const DEFAULT_MAX_CHUNK: usize = 1024 * 64;  // 64 KB

/// Descriptor of a content-defined chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDescriptor {
    pub offset: usize,
    pub length: usize,
    pub oid: Oid,
}

/// FastCDC chunking engine.
#[derive(Debug, Clone)]
pub struct FastCdcChunker {
    min_size: usize,
    avg_size: usize,
    max_size: usize,
    mask_s: u32,
    mask_l: u32,
}

impl Default for FastCdcChunker {
    fn default() -> Self {
        Self::new(DEFAULT_MIN_CHUNK, DEFAULT_AVG_CHUNK, DEFAULT_MAX_CHUNK)
    }
}

impl FastCdcChunker {
    /// Constructs a chunker with custom window boundaries.
    pub fn new(min_size: usize, avg_size: usize, max_size: usize) -> Self {
        let bits = (avg_size as f64).log2().round() as u32;
        let mask_s = (1 << (bits + 1)) - 1;
        let mask_l = (1 << (bits - 1)) - 1;

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

    /// Splits an input buffer into content-defined chunk descriptors.
    pub fn chunk(&self, data: &[u8]) -> Vec<ChunkDescriptor> {
        let mut chunks = Vec::new();
        let mut offset = 0;
        let len = data.len();

        if len == 0 {
            return chunks;
        }

        while offset < len {
            let remaining = len - offset;
            if remaining <= self.min_size {
                chunks.push(Self::make_chunk(data, offset, remaining));
                break;
            }

            let max_cut = remaining.min(self.max_size);
            let mut cut = self.min_size;
            let mid = self.min_size + (max_cut - self.min_size) / 2;

            let mut fingerprint: u32 = 0;
            let mut found = false;

            while cut < max_cut {
                fingerprint = (fingerprint << 1).wrapping_add(data[offset + cut] as u32);
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

            chunks.push(Self::make_chunk(data, offset, cut));
            offset += cut;
        }

        chunks
    }

    fn make_chunk(data: &[u8], offset: usize, length: usize) -> ChunkDescriptor {
        let slice = &data[offset..offset + length];
        let mut hasher = Sha1::new();
        hasher.update(format!("blob {}\0", length).as_bytes());
        hasher.update(slice);
        let hash: [u8; 20] = hasher.finalize().into();
        let oid = Oid::from_bytes(hash);

        ChunkDescriptor {
            offset,
            length,
            oid,
        }
    }
}
