//! Module: fg-storage — Pack Index (`.idx`) Reader
//! File Path: crates/fg-storage/src/backends/idx_file.rs
//! Architecture Role: Maps an object id to a byte offset inside one packfile, using only the
//!   index file. This is the lookup half of packed-object access; the pack reader owns the bytes.
//! Dependencies & Triggers: Built by the ODB router for every `*.idx` beside a `*.pack`, and by the
//!   MIDX reader to cross-check its own offsets.
//! Responsibilities: Parse v1 and v2 fanout tables, binary-search an id, and resolve 64-bit offsets
//!   without ever reading the pack.
//! Exit Semantics & Design Rationale:
//!   - The fanout table is used as the search hull, not as a sequential scan. Scanning 19,149 ids
//!     per lookup would make `ls-tree` quadratic; the fanout makes each lookup logarithmic.
//!   - A 64-bit offset is only consulted when the high bit of the 32-bit word is set. Treating that
//!     word as a plain offset would report offset `0x8000_0000 + n`, which lands in the middle of
//!     the pack and decodes as a plausible-looking object header — corruption that a reader cannot
//!     detect from the offset alone.
//!   - Version 1 has no CRC or offset tables and stores `(offset, oid)` inline. It is read because
//!     it still exists in old clones, but it is not written.
//!   - The trailing checksum is validated against the pack's own trailer by the caller, not here:
//!     this reader never opens the pack, and inventing a second opinion about pack contents would
//!     duplicate the pack reader's authority.
//!
//! Domain Governance Rules: FGT-STO-001 (pack index lookup), FGT-COR-001, FGT-PRF-001.

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

use crate::backends::fanout::{
    binary_search_oid_table, fanout_range, read_be_u32, read_be_u64, FANOUT_BUCKETS,
    FANOUT_ENTRY_LEN, OID_LEN,
};

/// Magic word at the head of a version 2 index file, `\xfftOc`.
const IDX_V2_MAGIC: [u8; 4] = [0xff, b't', b'O', b'c'];

/// Byte width of one CRC32 entry.
const CRC_ENTRY_LEN: usize = 4;

/// Byte width of one 32-bit offset entry.
const OFFSET_ENTRY_LEN: usize = 4;

/// Byte width of one 64-bit offset entry.
const LARGE_OFFSET_ENTRY_LEN: usize = 8;

/// High bit that marks a 32-bit offset word as an index into the 64-bit table.
const LARGE_OFFSET_FLAG: u32 = 0x8000_0000;

/// Byte length of the index version 2 header: magic plus version word.
const V2_HEADER_LEN: usize = 8;

/// Byte length of the trailing pack checksum shared by every index version.
const TRAILING_CHECKSUM_LEN: usize = 20;

/// A parsed pack index, held as its raw bytes plus the offsets of each region.
#[derive(Debug, Clone)]
pub struct PackIndex {
    path: PathBuf,
    bytes: Vec<u8>,
    version: u32,
    object_count: usize,
    oid_table_start: usize,
    offset_table_start: usize,
    large_offset_table_start: usize,
}

impl PackIndex {
    /// Loads and validates an index file.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the file is too short for its declared layout or
    /// carries an unknown magic, and [`FractalError::Io`] when it cannot be read.
    pub fn load(path: impl Into<PathBuf>) -> FractalResult<Self> {
        let path = path.into();
        let bytes = fs::read(&path)?;
        Self::parse(path, bytes)
    }

    /// Parses an index already held in memory.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] for a magic mismatch, an unsupported version, or a
    /// region that would extend past the file.
    pub fn parse(path: PathBuf, bytes: Vec<u8>) -> FractalResult<Self> {
        if bytes.len() < V2_HEADER_LEN + TRAILING_CHECKSUM_LEN {
            return Err(FractalError::CorruptStore(format!(
                "pack index '{}' is {} bytes, shorter than any valid index",
                path.display(),
                bytes.len()
            )));
        }
        if bytes[..4] != IDX_V2_MAGIC {
            return Self::parse_version_one(path, bytes);
        }
        let version = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        if version != 2 {
            return Err(FractalError::CorruptStore(format!(
                "pack index '{}' declares version {version}; this build reads 1 and 2",
                path.display()
            )));
        }
        let fanout_start = V2_HEADER_LEN;
        let object_count = read_fanout_last(&bytes, fanout_start, &path)?;
        let oid_table_start = fanout_start + FANOUT_BUCKETS * FANOUT_ENTRY_LEN;
        let crc_table_start = oid_table_start + object_count * OID_LEN;
        let offset_table_start = crc_table_start + object_count * CRC_ENTRY_LEN;
        let large_offset_table_start = offset_table_start + object_count * OFFSET_ENTRY_LEN;
        if large_offset_table_start + TRAILING_CHECKSUM_LEN > bytes.len() {
            return Err(FractalError::CorruptStore(format!(
                "pack index '{}' declares {object_count} objects but is only {} bytes",
                path.display(),
                bytes.len()
            )));
        }
        Ok(Self {
            path,
            bytes,
            version,
            object_count,
            oid_table_start,
            offset_table_start,
            large_offset_table_start,
        })
    }

    /// Parses the version 1 layout: a bare fanout table followed by `(offset, oid)` pairs.
    fn parse_version_one(path: PathBuf, bytes: Vec<u8>) -> FractalResult<Self> {
        let object_count = read_fanout_last(&bytes, 0, &path)?;
        // Each entry is a 4-byte offset before the 20-byte id.
        let oid_table_start = FANOUT_BUCKETS * FANOUT_ENTRY_LEN + OFFSET_ENTRY_LEN;
        let entry_len = OFFSET_ENTRY_LEN + OID_LEN;
        let end = FANOUT_BUCKETS * FANOUT_ENTRY_LEN + object_count * entry_len;
        if end + TRAILING_CHECKSUM_LEN > bytes.len() {
            return Err(FractalError::CorruptStore(format!(
                "version 1 pack index '{}' declares {object_count} objects but is only {} bytes",
                path.display(),
                bytes.len()
            )));
        }
        Ok(Self {
            path,
            bytes,
            version: 1,
            object_count,
            oid_table_start,
            offset_table_start: FANOUT_BUCKETS * FANOUT_ENTRY_LEN,
            large_offset_table_start: end,
        })
    }

    /// Path this index was loaded from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Index format version that was parsed.
    pub fn version(&self) -> u32 {
        self.version
    }

    /// Number of objects the index lists.
    pub fn object_count(&self) -> usize {
        self.object_count
    }

    /// Returns the byte offset of `oid` inside the pack, or `None` when the id is absent.
    pub fn lookup(&self, oid: &Oid) -> Option<u64> {
        let target = oid.as_bytes();
        let fanout_start = if self.version == 1 { 0 } else { V2_HEADER_LEN };
        let (low, high) = fanout_range(&self.bytes, fanout_start, target[0]);
        let stride = if self.version == 1 {
            OFFSET_ENTRY_LEN + OID_LEN
        } else {
            OID_LEN
        };
        let found =
            binary_search_oid_table(&self.bytes, self.oid_table_start, stride, low, high, target)?;
        Some(self.offset_at(found))
    }

    /// Returns the object id stored at `index`.
    pub fn oid_at(&self, index: usize) -> Option<Oid> {
        if index >= self.object_count {
            return None;
        }
        let start = self.oid_start(index)?;
        let slice = self.bytes.get(start..start + OID_LEN)?;
        let mut raw = [0u8; OID_LEN];
        raw.copy_from_slice(slice);
        Some(Oid::from_bytes(raw))
    }

    /// Returns the pack offset stored at `index`.
    pub fn offset_at(&self, index: usize) -> u64 {
        if self.version == 1 {
            let base = self.offset_table_start + index * (OFFSET_ENTRY_LEN + OID_LEN);
            return u64::from(read_be_u32(&self.bytes, base));
        }
        let base = self.offset_table_start + index * OFFSET_ENTRY_LEN;
        let word = read_be_u32(&self.bytes, base);
        if word & LARGE_OFFSET_FLAG == 0 {
            return u64::from(word);
        }
        let slot = (word & !LARGE_OFFSET_FLAG) as usize;
        let large_base = self.large_offset_table_start + slot * LARGE_OFFSET_ENTRY_LEN;
        read_be_u64(&self.bytes, large_base)
    }

    /// Byte offset of the object id stored at `index`, honouring the version 1 interleave.
    fn oid_start(&self, index: usize) -> Option<usize> {
        match self.version {
            1 => Some(
                self.offset_table_start + index * (OFFSET_ENTRY_LEN + OID_LEN) + OFFSET_ENTRY_LEN,
            ),
            _ => Some(self.oid_table_start + index * OID_LEN),
        }
    }

    /// Compiles all object offsets into an Elias-Fano quasi-succinct compressed structure.
    ///
    /// Offsets are extracted, sorted monotonically, and compressed to ~2.5-3.0 bits/offset.
    /// Enables O(1) random access and O(log N) successor queries to compute object byte spans
    /// without keeping uncompressed u64 arrays in RAM.
    pub fn build_compressed_offsets(&self) -> FractalResult<fg_algorithms::EliasFano> {
        let count = self.object_count;
        if count == 0 {
            return fg_algorithms::EliasFano::from_slice(&[]);
        }
        let mut sorted_offsets: Vec<u64> = (0..count)
            .map(|object_index| self.offset_at(object_index))
            .collect();
        sorted_offsets.sort_unstable();
        fg_algorithms::EliasFano::from_slice(&sorted_offsets)
    }
}

/// Reads the last fanout bucket, which equals the object count.
fn read_fanout_last(bytes: &[u8], fanout_start: usize, path: &Path) -> FractalResult<usize> {
    let base = fanout_start + (FANOUT_BUCKETS - 1) * FANOUT_ENTRY_LEN;
    let end = base + FANOUT_ENTRY_LEN;
    if end > bytes.len() {
        return Err(FractalError::CorruptStore(format!(
            "pack index '{}' is too short to hold a fanout table",
            path.display()
        )));
    }
    Ok(read_be_u32(bytes, base) as usize)
}

#[cfg(test)]
mod tests {
    use super::{PackIndex, FANOUT_BUCKETS, IDX_V2_MAGIC, LARGE_OFFSET_FLAG, OID_LEN};
    use fg_core::models::Oid;
    use std::path::PathBuf;

    /// Builds a two-object v2 index for ids that begin with `0x01` and `0x02`.
    fn sample_index() -> (PackIndex, Oid, Oid) {
        let first = Oid::from_bytes([0x01; OID_LEN]);
        let second = Oid::from_bytes([0x02; OID_LEN]);
        let count = 2usize;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&IDX_V2_MAGIC);
        bytes.extend_from_slice(&2u32.to_be_bytes());
        for bucket in 0..FANOUT_BUCKETS {
            let value = if bucket < 0x01 {
                0
            } else if bucket < 0x02 {
                1
            } else {
                2
            };
            bytes.extend_from_slice(&(value as u32).to_be_bytes());
        }
        bytes.extend_from_slice(first.as_bytes());
        bytes.extend_from_slice(second.as_bytes());
        bytes.extend_from_slice(&[0u8; 8]);
        bytes.extend_from_slice(&100u32.to_be_bytes());
        bytes.extend_from_slice(&LARGE_OFFSET_FLAG.to_be_bytes());
        bytes.extend_from_slice(&7000u64.to_be_bytes());
        bytes.extend_from_slice(&[0u8; 20]);
        let index = PackIndex::parse(PathBuf::from("sample.idx"), bytes).expect("parse");
        assert_eq!(index.object_count(), count);
        (index, first, second)
    }

    #[test]
    fn finds_an_object_by_its_fanout_bucket() {
        let (index, first, second) = sample_index();
        assert_eq!(index.lookup(&first), Some(100));
        assert_eq!(index.lookup(&second), Some(7000));
    }

    #[test]
    fn reports_absence_for_an_unlisted_id() {
        let (index, _, _) = sample_index();
        let missing = Oid::from_bytes([0x03; OID_LEN]);
        assert_eq!(index.lookup(&missing), None);
    }

    #[test]
    fn resolves_a_large_offset_through_the_64_bit_table() {
        let (index, _, second) = sample_index();
        assert_eq!(index.lookup(&second), Some(7000));
    }

    #[test]
    fn enumerates_ids_in_stored_order() {
        let (index, first, second) = sample_index();
        assert_eq!(index.oid_at(0), Some(first));
        assert_eq!(index.oid_at(1), Some(second));
        assert_eq!(index.oid_at(2), None);
    }

    #[test]
    fn rejects_a_truncated_index() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&IDX_V2_MAGIC);
        bytes.extend_from_slice(&2u32.to_be_bytes());
        assert!(PackIndex::parse(PathBuf::from("short.idx"), bytes).is_err());
    }

    #[test]
    fn builds_compressed_offsets_index() {
        let (index, _, _) = sample_index();
        let compressed_offsets = index
            .build_compressed_offsets()
            .expect("build compressed offsets");
        assert_eq!(compressed_offsets.len(), 2);
        assert_eq!(compressed_offsets.get(0), Some(100));
        assert_eq!(compressed_offsets.get(1), Some(7000));
    }
}
