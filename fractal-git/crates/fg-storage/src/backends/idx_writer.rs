//! Module: fg-storage::backends::idx_writer — Canonical Git Pack Index (v2) Writer
//! File Path: crates/fg-storage/src/backends/idx_writer.rs
//! Architecture Role: Encodes Git Pack Index v2 files: magic \xfftOc, version 2,
//!   256-bucket fan-out table, sorted 20-byte OID table, CRC32 table, offset tables, and double SHA-1 trailer.
//! Dependencies & Triggers: Consumed by RepackEngine and Bundle writer in fg-storage.
//! Responsibilities: Generate canonical .idx file binary layout matching git-verify-pack v2.
//! Exit Semantics & Design Rationale:
//!   - Entries must be sorted lexicographically by 20-byte OID.
//!   - Large offsets (>= 2GB) use the secondary 64-bit table with high bit flagged in the 32-bit table.
//!   - Two trailing SHA-1 checksums: packfile SHA-1 followed by index file SHA-1.
//!
//! Domain Governance Rules: FGT-STO-001 (pack index generation), FGT-COR-001, FGT-PRF-001.

use sha1::{Digest, Sha1};
use std::io::Write;

use super::pack_writer::PackEntryMeta;
use fg_core::error::FractalResult;
use fg_core::models::Oid;

/// Magic header bytes for Git Pack Index version 2: `\xfftOc`.
const IDX_V2_MAGIC: [u8; 4] = [0xff, b't', b'O', b'c'];

/// Index version 2.
const IDX_VERSION_2: u32 = 2;

/// Number of fanout buckets (0x00 through 0xFF).
const FANOUT_BUCKETS: usize = 256;

/// High bit in the 32-bit offset table indicating an entry into the 64-bit large offset table.
const LARGE_OFFSET_FLAG: u32 = 0x8000_0000;

/// Writes a Git Pack Index v2 stream from collected pack entry metadata.
pub struct IdxWriter;

impl IdxWriter {
    /// Writes a complete `.idx` file matching Git Index v2 specification.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] on write failure.
    pub fn write_idx<W: Write>(
        mut entries: Vec<PackEntryMeta>,
        pack_sha1: &Oid,
        mut writer: W,
    ) -> FractalResult<Oid> {
        // Sort entries strictly in ascending lexicographical order by 20-byte OID
        entries.sort_by(|a, b| a.oid.as_bytes().cmp(b.oid.as_bytes()));

        let mut hasher = Sha1::new();

        // 1. Header: \xfftOc + version 2 (8 bytes)
        let mut header = [0u8; 8];
        header[..4].copy_from_slice(&IDX_V2_MAGIC);
        header[4..8].copy_from_slice(&IDX_VERSION_2.to_be_bytes());
        writer.write_all(&header)?;
        hasher.update(header);

        // 2. Fan-out table (256 * 4 bytes = 1024 bytes)
        let mut fanout_counts = [0u32; FANOUT_BUCKETS];
        let mut running_count = 0u32;
        let mut entry_iter = entries.iter().peekable();

        for (bucket, count_slot) in fanout_counts.iter_mut().enumerate() {
            while let Some(entry) = entry_iter.peek() {
                if (entry.oid.as_bytes()[0] as usize) <= bucket {
                    running_count += 1;
                    entry_iter.next();
                } else {
                    break;
                }
            }
            *count_slot = running_count;
        }

        for &count in &fanout_counts {
            let bytes = count.to_be_bytes();
            writer.write_all(&bytes)?;
            hasher.update(bytes);
        }

        // 3. OID table (N * 20 bytes)
        for entry in &entries {
            let oid_bytes = entry.oid.as_bytes();
            writer.write_all(oid_bytes)?;
            hasher.update(oid_bytes);
        }

        // 4. CRC32 table (N * 4 bytes)
        for entry in &entries {
            let crc_bytes = entry.crc32.to_be_bytes();
            writer.write_all(&crc_bytes)?;
            hasher.update(crc_bytes);
        }

        // 5. 32-bit Offsets table (N * 4 bytes) and optional 64-bit large offsets
        let mut large_offsets: Vec<u64> = Vec::new();
        for entry in &entries {
            if entry.offset >= (LARGE_OFFSET_FLAG as u64) {
                let slot = large_offsets.len() as u32;
                large_offsets.push(entry.offset);
                let flag_word = (LARGE_OFFSET_FLAG | slot).to_be_bytes();
                writer.write_all(&flag_word)?;
                hasher.update(flag_word);
            } else {
                let offset_bytes = (entry.offset as u32).to_be_bytes();
                writer.write_all(&offset_bytes)?;
                hasher.update(offset_bytes);
            }
        }

        // 6. 64-bit Large offsets table (if any, M * 8 bytes)
        for &large_off in &large_offsets {
            let bytes = large_off.to_be_bytes();
            writer.write_all(&bytes)?;
            hasher.update(bytes);
        }

        // 7. Trailer: Pack SHA-1 (20 bytes)
        let pack_bytes = pack_sha1.as_bytes();
        writer.write_all(pack_bytes)?;
        hasher.update(pack_bytes);

        // 8. Trailer: Index SHA-1 (20 bytes)
        let idx_sha1: [u8; 20] = hasher.finalize().into();
        writer.write_all(&idx_sha1)?;

        Ok(Oid::from_bytes(idx_sha1))
    }
}
