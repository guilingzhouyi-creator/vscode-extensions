//! Module: fg-storage — Multi-Pack Index (MIDX) Reader
//! File Path: crates/fg-storage/src/backends/midx_file.rs
//! Architecture Role: Maps an object id to `(pack id, offset)` across every pack in the repository
//!   from a single file, so a lookup does not have to probe each `.idx` in turn.
//! Dependencies & Triggers: Loaded by the ODB router when `objects/pack/multi-pack-index` exists;
//!   absent files are a normal state, not an error.
//! Responsibilities: Parse the chunk directory, resolve pack names from `PNAM`, and index the
//!   `OOFF` table as 8-byte `(pack_id, offset)` pairs.
//! Exit Semantics & Design Rationale:
//!   - `OOFF` entries are 8 bytes: a 4-byte pack position followed by a 4-byte offset word. A reader
//!     that assumes a single 4-byte offset lands one object early on every entry after the first,
//!     which still produces decodable garbage. The width is asserted against the chunk span in
//!     [`MultiPackIndex::parse`] so that mistake fails loudly instead of silently.
//!   - The large-offset table (`LOFF`) is optional. When the chunk is absent, a 32-bit offset equal
//!     to or above `0x8000_0000` is an error rather than a wrapped value.
//!   - Only hash version 1 (SHA-1) is accepted. A SHA-256 multi-pack index would yield 32-byte ids
//!     that this build's 20-byte [`Oid`] cannot hold; refusing is the only honest outcome.

use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

/// Magic at the head of a multi-pack-index file, ASCII `MIDX`.
const MIDX_MAGIC: [u8; 4] = *b"MIDX";

/// Multi-pack-index layout version this build understands.
const MIDX_VERSION: u8 = 1;

/// Hash version that means SHA-1.
const MIDX_HASH_SHA1: u8 = 1;

/// Byte length of one chunk-directory entry: 4-byte id plus 8-byte offset.
const CHUNK_ENTRY_LEN: usize = 12;

/// Byte width of one object id.
const OID_LEN: usize = 20;

/// Number of fanout buckets in the `OIDF` chunk.
const FANOUT_BUCKETS: usize = 256;

/// Byte length of the fixed header before the chunk directory.
const MIDX_HEADER_LEN: usize = 12;

/// Byte width of one `OOFF` entry: pack position plus offset word.
const OOFF_ENTRY_LEN: usize = 8;

/// High bit marking an offset word as an index into `LOFF`.
const LARGE_OFFSET_FLAG: u32 = 0x8000_0000;

/// Chunk identifiers this reader depends on.
const CHUNK_PNAM: [u8; 4] = *b"PNAM";
const CHUNK_OIDF: [u8; 4] = *b"OIDF";
const CHUNK_OIDL: [u8; 4] = *b"OIDL";
const CHUNK_OOFF: [u8; 4] = *b"OOFF";
const CHUNK_LOFF: [u8; 4] = *b"LOFF";

/// Where one object lives: which pack, and at what offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PackLocation {
    /// Zero-based position of the pack inside the `PNAM` list.
    pub pack_id: u32,
    /// Byte offset of the object header inside that pack.
    pub offset: u64,
}

/// A parsed multi-pack index.
#[derive(Debug, Clone)]
pub struct MultiPackIndex {
    bytes: Vec<u8>,
    pack_names: Vec<String>,
    oid_fanout: usize,
    oid_lookup: usize,
    object_offset: usize,
    large_offset: Option<usize>,
    object_count: usize,
}

impl MultiPackIndex {
    /// Loads a multi-pack-index file.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when the file cannot be read and
    /// [`FractalError::CorruptStore`] when its structure is invalid.
    pub fn load(path: impl AsRef<Path>) -> FractalResult<Self> {
        let path = path.as_ref();
        let bytes = fs::read(path)?;
        Self::parse(bytes, path)
    }

    /// Parses a multi-pack-index already in memory.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] for a magic, version, or hash-version mismatch, a
    /// missing mandatory chunk, or an `OOFF` span that disagrees with the object count.
    pub fn parse(bytes: Vec<u8>, path: &Path) -> FractalResult<Self> {
        if bytes.len() < MIDX_HEADER_LEN {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' is {} bytes, shorter than its header",
                path.display(),
                bytes.len()
            )));
        }
        if bytes[..4] != MIDX_MAGIC {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' has magic {:02x?}, expected MIDX",
                path.display(),
                &bytes[..4]
            )));
        }
        let version = bytes[4];
        if version != MIDX_VERSION {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' declares version {version}; this build reads {MIDX_VERSION}",
                path.display()
            )));
        }
        if bytes[5] != MIDX_HASH_SHA1 {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' declares hash version {}; only SHA-1 (1) is supported",
                path.display(),
                bytes[5]
            )));
        }
        let chunk_count = usize::from(bytes[6]);
        let table_end = MIDX_HEADER_LEN + chunk_count * CHUNK_ENTRY_LEN;
        if table_end > bytes.len() {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' declares {chunk_count} chunks but is only {} bytes",
                path.display(),
                bytes.len()
            )));
        }

        let mut pnam = None;
        let mut oidf = None;
        let mut oidl = None;
        let mut ooff = None;
        let mut loff = None;
        for index in 0..chunk_count {
            let base = MIDX_HEADER_LEN + index * CHUNK_ENTRY_LEN;
            let id = [
                bytes[base],
                bytes[base + 1],
                bytes[base + 2],
                bytes[base + 3],
            ];
            let offset = read_u64(&bytes, base + 4) as usize;
            match id {
                CHUNK_PNAM => pnam = Some(offset),
                CHUNK_OIDF => oidf = Some(offset),
                CHUNK_OIDL => oidl = Some(offset),
                CHUNK_OOFF => ooff = Some(offset),
                CHUNK_LOFF => loff = Some(offset),
                _ => {}
            }
        }

        let (Some(pnam), Some(oidf), Some(oidl), Some(ooff)) = (pnam, oidf, oidl, ooff) else {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' is missing one of the PNAM/OIDF/OIDL/OOFF chunks",
                path.display()
            )));
        };

        let object_count = read_u32(&bytes, oidf + (FANOUT_BUCKETS - 1) * 4) as usize;
        let expected_span = object_count * OOFF_ENTRY_LEN;
        let actual_span = match loff {
            Some(loff_offset) if loff_offset > ooff => loff_offset - ooff,
            _ => bytes
                .len()
                .saturating_sub(ooff)
                .saturating_sub(TRAILING_HASH_LEN),
        };
        if actual_span != expected_span {
            return Err(FractalError::CorruptStore(format!(
                "multi-pack-index '{}' OOFF span is {actual_span} bytes for {object_count} objects; \
                 expected {expected_span} (8 bytes per entry)",
                path.display()
            )));
        }

        let pack_names = read_pack_names(&bytes, pnam);
        Ok(Self {
            bytes,
            pack_names,
            oid_fanout: oidf,
            oid_lookup: oidl,
            object_offset: ooff,
            large_offset: loff,
            object_count,
        })
    }

    /// Pack file names, in the order `OOFF` pack positions refer to.
    pub fn pack_names(&self) -> &[String] {
        &self.pack_names
    }

    /// Number of objects the index lists.
    pub fn object_count(&self) -> usize {
        self.object_count
    }

    /// Returns where `oid` lives, or `None` when the id is absent.
    pub fn lookup(&self, oid: &Oid) -> Option<PackLocation> {
        let target = oid.as_bytes();
        let low = if target[0] == 0 {
            0
        } else {
            self.fanout(usize::from(target[0]) - 1)
        };
        let high = self.fanout(usize::from(target[0]));
        let index = self.binary_search(low, high, target)?;
        let base = self.object_offset + index * OOFF_ENTRY_LEN;
        let pack_id = read_u32(&self.bytes, base);
        let word = read_u32(&self.bytes, base + 4);
        let offset = if word & LARGE_OFFSET_FLAG == 0 {
            u64::from(word)
        } else {
            let slot = (word & !LARGE_OFFSET_FLAG) as usize;
            let table = self.large_offset?;
            read_u64(&self.bytes, table + slot * 8)
        };
        Some(PackLocation { pack_id, offset })
    }

    /// Returns the object id stored at `index`.
    pub fn oid_at(&self, index: usize) -> Option<Oid> {
        if index >= self.object_count {
            return None;
        }
        let start = self.oid_lookup + index * OID_LEN;
        let slice = self.bytes.get(start..start + OID_LEN)?;
        let mut raw = [0u8; OID_LEN];
        raw.copy_from_slice(slice);
        Some(Oid::from_bytes(raw))
    }

    /// Cumulative count for fanout bucket `bucket`.
    fn fanout(&self, bucket: usize) -> usize {
        read_u32(&self.bytes, self.oid_fanout + bucket * 4) as usize
    }

    /// Binary-searches the `OIDL` table inside the fanout hull.
    fn binary_search(&self, low: usize, high: usize, target: &[u8; OID_LEN]) -> Option<usize> {
        let mut left = low;
        let mut right = high;
        while left < right {
            let mid = left + (right - left) / 2;
            let start = self.oid_lookup + mid * OID_LEN;
            let candidate = self.bytes.get(start..start + OID_LEN)?;
            match candidate.cmp(&target[..]) {
                std::cmp::Ordering::Less => left = mid + 1,
                std::cmp::Ordering::Greater => right = mid,
                std::cmp::Ordering::Equal => return Some(mid),
            }
        }
        None
    }
}

/// Byte length of the trailing hash after the last chunk.
const TRAILING_HASH_LEN: usize = 20;

/// Splits the NUL-terminated `PNAM` chunk into pack file names.
fn read_pack_names(bytes: &[u8], start: usize) -> Vec<String> {
    let mut names = Vec::new();
    let Some(region) = bytes.get(start..) else {
        return names;
    };
    let mut cursor = 0usize;
    while cursor < region.len() && region[cursor] != 0 {
        let Some(terminator) = region[cursor..].iter().position(|byte| *byte == 0) else {
            break;
        };
        let end = cursor + terminator;
        names.push(String::from_utf8_lossy(&region[cursor..end]).into_owned());
        cursor = end + 1;
    }
    names
}

/// Reads a big-endian `u32`, yielding zero when the slice is short.
fn read_u32(bytes: &[u8], start: usize) -> u32 {
    match bytes.get(start..start + 4) {
        Some(slice) => u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]),
        None => 0,
    }
}

/// Reads a big-endian `u64`, yielding zero when the slice is short.
fn read_u64(bytes: &[u8], start: usize) -> u64 {
    match bytes.get(start..start + 8) {
        Some(slice) => u64::from_be_bytes([
            slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
        ]),
        None => 0,
    }
}

/// Builds a synthetic multi-pack index holding two objects in one pack.
#[cfg(test)]
mod tests {
    use super::{MultiPackIndex, CHUNK_ENTRY_LEN, MIDX_HEADER_LEN, OID_LEN};
    use fg_core::models::Oid;
    use std::path::Path;

    fn build_midx(first: &Oid, second: &Oid) -> Vec<u8> {
        let mut pnam = Vec::new();
        pnam.extend_from_slice(b"pack-a.idx\0");
        let pnam_len = pnam.len();
        // Align OIDF to 8 bytes, then OIDL, then OOFF.
        let pnam_start = MIDX_HEADER_LEN + 4 * CHUNK_ENTRY_LEN;
        let oidf_start = pnam_start + pnam_len;
        let oidf_len = 256 * 4;
        let oidl_start = oidf_start + oidf_len;
        let oidl_len = 2 * OID_LEN;
        let ooff_start = oidl_start + oidl_len;

        let mut out = Vec::new();
        out.extend_from_slice(b"MIDX");
        out.push(1);
        out.push(1);
        out.push(4);
        out.push(0);
        out.extend_from_slice(&1u32.to_be_bytes());
        for (id, offset) in [
            (*b"PNAM", pnam_start as u64),
            (*b"OIDF", oidf_start as u64),
            (*b"OIDL", oidl_start as u64),
            (*b"OOFF", ooff_start as u64),
        ] {
            out.extend_from_slice(&id);
            out.extend_from_slice(&offset.to_be_bytes());
        }
        out.extend_from_slice(&pnam);
        for bucket in 0..256usize {
            let value = if bucket < 0x01 {
                0
            } else if bucket < 0x02 {
                1
            } else {
                2
            };
            out.extend_from_slice(&(value as u32).to_be_bytes());
        }
        out.extend_from_slice(first.as_bytes());
        out.extend_from_slice(second.as_bytes());
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(&1200u32.to_be_bytes());
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(&4096u32.to_be_bytes());
        out.extend_from_slice(&[0u8; 20]);
        out
    }

    #[test]
    fn resolves_both_objects_to_pack_and_offset() {
        let first = Oid::from_bytes([0x01; OID_LEN]);
        let second = Oid::from_bytes([0x02; OID_LEN]);
        let bytes = build_midx(&first, &second);
        let midx = MultiPackIndex::parse(bytes, Path::new("multi-pack-index")).expect("parse");
        assert_eq!(midx.object_count(), 2);
        assert_eq!(midx.pack_names(), &["pack-a.idx".to_string()]);
        let first_at = midx.lookup(&first).expect("first");
        assert_eq!((first_at.pack_id, first_at.offset), (0, 1200));
        let second_at = midx.lookup(&second).expect("second");
        assert_eq!((second_at.pack_id, second_at.offset), (0, 4096));
    }

    #[test]
    fn reports_absence_for_an_unlisted_id() {
        let bytes = build_midx(
            &Oid::from_bytes([0x01; OID_LEN]),
            &Oid::from_bytes([0x02; OID_LEN]),
        );
        let midx = MultiPackIndex::parse(bytes, Path::new("multi-pack-index")).expect("parse");
        assert_eq!(midx.lookup(&Oid::from_bytes([0x09; OID_LEN])), None);
    }

    #[test]
    fn rejects_a_wrong_magic() {
        let mut bytes = build_midx(
            &Oid::from_bytes([0x01; OID_LEN]),
            &Oid::from_bytes([0x02; OID_LEN]),
        );
        bytes[..4].copy_from_slice(b"NOPE");
        assert!(MultiPackIndex::parse(bytes, Path::new("multi-pack-index")).is_err());
    }

    #[test]
    fn rejects_a_sha256_hash_version() {
        let mut bytes = build_midx(
            &Oid::from_bytes([0x01; OID_LEN]),
            &Oid::from_bytes([0x02; OID_LEN]),
        );
        bytes[5] = 2;
        assert!(MultiPackIndex::parse(bytes, Path::new("multi-pack-index")).is_err());
    }
}
