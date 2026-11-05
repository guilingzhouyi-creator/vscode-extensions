//! Module: fg-storage — Multi-Pack Index (MIDX) Writer
//! File Path: crates/fg-storage/src/backends/midx_writer.rs
//! Architecture Role: Generates canonical Multi-Pack Index (`multi-pack-index`) files
//!   spanning multiple `.idx` and `.pack` files in a Git object directory.
//! Dependencies & Triggers: Consumed by `MultiPackIndex::write_midx`, `taxis multi-pack-index write`,
//!   and `taxis maintenance run`.
//! Responsibilities: Aggregate object offsets across all packfiles, format chunks (`PNAM`, `OIDF`,
//!   `OIDL`, `OOFF`), compute trailing SHA-1 checksum, and write atomically.
//! Exit Semantics & Design Rationale:
//!   - Accurately sorts pack stems and object IDs to ensure O(log N) fanout binary search.
//!   - Employs temporary file creation followed by atomic rename to guarantee crash consistency.
//!
//! Domain Governance Rules: FGT-STO-001 (multi-pack index write), FGT-COR-001, FGT-PRF-001.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use sha1::Digest;

use super::fanout::{FANOUT_BUCKETS, OID_LEN};

/// Magic header bytes for Git Multi-Pack Index: `MIDX`.
const MIDX_MAGIC: [u8; 4] = *b"MIDX";

/// MIDX format version 1.
const MIDX_VERSION: u8 = 1;

/// Hash version 1 (SHA-1).
const MIDX_HASH_SHA1: u8 = 1;

/// Byte length of one chunk-directory entry: 4-byte id plus 8-byte offset.
const CHUNK_ENTRY_LEN: usize = 12;

/// Byte length of the fixed header before the chunk directory.
const MIDX_HEADER_LEN: usize = 12;

/// Chunk identifiers written by this builder.
const CHUNK_PNAM: [u8; 4] = *b"PNAM";
const CHUNK_OIDF: [u8; 4] = *b"OIDF";
const CHUNK_OIDL: [u8; 4] = *b"OIDL";
const CHUNK_OOFF: [u8; 4] = *b"OOFF";

/// Multi-pack index writer.
pub struct MidxWriter;

impl MidxWriter {
    /// Generates and writes a multi-pack index file from all `pack-*.idx` files in `pack_dir`.
    pub fn write_midx(pack_dir: &Path) -> FractalResult<PathBuf> {
        let mut idx_stems = Vec::new();
        if let Ok(entries) = fs::read_dir(pack_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem.starts_with("pack-")
                        && path.extension().and_then(|ext| ext.to_str()) == Some("idx")
                    {
                        if pack_dir.join(format!("{stem}.pack")).is_file() {
                            idx_stems.push(stem.to_string());
                        }
                    }
                }
            }
        }
        idx_stems.sort();

        if idx_stems.is_empty() {
            return Err(FractalError::CorruptStore(format!(
                "no pack files found in '{}' to create multi-pack index",
                pack_dir.display()
            )));
        }

        let mut pnam_bytes = Vec::new();
        let mut object_map: BTreeMap<Oid, (u32, u64)> = BTreeMap::new();

        for (pack_idx, stem) in idx_stems.iter().enumerate() {
            let idx_filename = format!("{stem}.idx");
            pnam_bytes.extend_from_slice(idx_filename.as_bytes());
            pnam_bytes.push(0);

            let idx_path = pack_dir.join(&idx_filename);
            let idx_file = super::idx_file::PackIndex::load(&idx_path)?;
            for i in 0..idx_file.object_count() {
                if let Some(oid) = idx_file.oid_at(i) {
                    let offset = idx_file.offset_at(i);
                    object_map.entry(oid).or_insert((pack_idx as u32, offset));
                }
            }
        }

        let pack_count = idx_stems.len() as u32;
        let total_objects = object_map.len();

        let pnam_len = pnam_bytes.len();
        let pnam_start = MIDX_HEADER_LEN + 4 * CHUNK_ENTRY_LEN;

        let oidf_start = pnam_start + pnam_len;
        let oidf_len = FANOUT_BUCKETS * 4;

        let oidl_start = oidf_start + oidf_len;
        let oidl_len = total_objects * OID_LEN;

        let ooff_start = oidl_start + oidl_len;

        let mut header_and_chunks = Vec::new();
        header_and_chunks.extend_from_slice(&MIDX_MAGIC);
        header_and_chunks.push(MIDX_VERSION);
        header_and_chunks.push(MIDX_HASH_SHA1);
        header_and_chunks.push(4);
        header_and_chunks.push(0);
        header_and_chunks.extend_from_slice(&pack_count.to_be_bytes());

        for &(id, offset) in &[
            (CHUNK_PNAM, pnam_start as u64),
            (CHUNK_OIDF, oidf_start as u64),
            (CHUNK_OIDL, oidl_start as u64),
            (CHUNK_OOFF, ooff_start as u64),
        ] {
            header_and_chunks.extend_from_slice(&id);
            header_and_chunks.extend_from_slice(&offset.to_be_bytes());
        }

        header_and_chunks.extend_from_slice(&pnam_bytes);

        let mut fanout_counts = [0u32; FANOUT_BUCKETS];
        for oid in object_map.keys() {
            let bucket = oid.as_bytes()[0] as usize;
            fanout_counts[bucket] += 1;
        }
        let mut cumulative = 0u32;
        for count in &mut fanout_counts {
            cumulative += *count;
            *count = cumulative;
            header_and_chunks.extend_from_slice(&count.to_be_bytes());
        }

        for oid in object_map.keys() {
            header_and_chunks.extend_from_slice(oid.as_bytes());
        }

        for &(pack_id, offset) in object_map.values() {
            header_and_chunks.extend_from_slice(&pack_id.to_be_bytes());
            header_and_chunks.extend_from_slice(&(offset as u32).to_be_bytes());
        }

        let mut hasher = sha1::Sha1::new();
        hasher.update(&header_and_chunks);
        let checksum = hasher.finalize();
        header_and_chunks.extend_from_slice(&checksum);

        let midx_path = pack_dir.join("multi-pack-index");
        let temp_path = pack_dir.join(format!("tmp-midx-{}.tmp", std::process::id()));
        fs::write(&temp_path, &header_and_chunks)?;
        fs::rename(&temp_path, &midx_path)?;

        Ok(midx_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MultiPackIndex;

    fn test_temp_dir(prefix: &str) -> tempfile::TempDir {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        tempfile::Builder::new()
            .prefix(prefix)
            .tempdir_in(&base)
            .or_else(|_| tempfile::tempdir())
            .expect("create test tempdir")
    }

    #[test]
    fn test_write_midx_and_load() {
        let temp_dir = test_temp_dir("midx_test");
        let pack_dir = temp_dir.path();

        let oid1 = Oid::from_bytes([0x10; 20]);
        let oid2 = Oid::from_bytes([0x20; 20]);

        let entries = vec![
            crate::backends::pack_writer::PackEntryMeta {
                oid: oid1,
                crc32: 0,
                offset: 100,
            },
            crate::backends::pack_writer::PackEntryMeta {
                oid: oid2,
                crc32: 0,
                offset: 500,
            },
        ];
        let idx_path = pack_dir.join("pack-test1.idx");
        let pack_path = pack_dir.join("pack-test1.pack");
        std::fs::write(&pack_path, b"FAKE_PACK_CONTENT").expect("write pack");
        let idx_file = std::fs::File::create(&idx_path).expect("create idx");
        crate::backends::idx_writer::IdxWriter::write_idx(entries, &Oid::ZERO, idx_file)
            .expect("write_idx");

        let midx_path = MidxWriter::write_midx(pack_dir).expect("write_midx");
        assert!(midx_path.is_file());

        let midx = MultiPackIndex::load(&midx_path).expect("load midx");
        assert_eq!(midx.object_count(), 2);
        let loc1 = midx.lookup(&oid1).expect("lookup oid1");
        assert_eq!(loc1.offset, 100);
        let loc2 = midx.lookup(&oid2).expect("lookup oid2");
        assert_eq!(loc2.offset, 500);
    }
}
