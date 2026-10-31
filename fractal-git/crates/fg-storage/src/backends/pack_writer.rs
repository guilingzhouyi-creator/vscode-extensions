//! Module: fg-storage::backends::pack_writer — Canonical Git Packfile Stream Writer
//! File Path: crates/fg-storage/src/backends/pack_writer.rs
//! Architecture Role: Encodes Git Packfile v2 streams: 12-byte header, variable-length LEB128 type/size,
//!   `OBJ_OFS_DELTA` negative distance varints, zlib deflated payloads, and trailing SHA-1.
//! Dependencies & Triggers: Consumed by RepackEngine and Bundle writer in fg-storage.
//! Responsibilities: Stream-serialize pack objects, compute CRC32 and running SHA-1, record entry offsets.
//! Exit Semantics & Design Rationale:
//!   - Git Packfile v2 specification requires big-endian words and zlib compressed payloads.
//!   - `OBJ_OFS_DELTA` uses Git's variable-length distance encoding to save space over `OBJ_REF_DELTA`.
//!   - IEEE 802.3 CRC32 is computed per object stream for subsequent Index v2 generation.
//!   - Zero-allocation buffer reuse: object and compression buffers are hoisted out of the write loop.
//!
//! Domain Governance Rules: FGT-STO-001 (pack writer stream), FGT-COR-001, FGT-PRF-001.

use flate2::write::ZlibEncoder;
use flate2::Compression;
use sha1::{Digest, Sha1};
use std::io::{BufWriter, Write};

use fg_algorithms::pack::{DeltaResolution, PackDeltaChain};
use fg_core::encode_git_offset_varint;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{ObjectKind, Oid};

/// Magic word at the head of a packfile: ASCII `PACK`.
const PACK_MAGIC: [u8; 4] = *b"PACK";

/// Git pack layout version 2.
const PACK_VERSION_2: u32 = 2;

/// Opcode for base objects.
const OBJ_COMMIT: u8 = 1;
const OBJ_TREE: u8 = 2;
const OBJ_BLOB: u8 = 3;
const OBJ_TAG: u8 = 4;
/// Opcode for offset-based delta objects.
const OBJ_OFS_DELTA: u8 = 6;

/// Precomputed IEEE 802.3 CRC32 lookup table (polynomial 0xEDB88320).
const fn make_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut j = 0;
        while j < 8 {
            if c & 1 != 0 {
                c = 0xEDB8_8320 ^ (c >> 1);
            } else {
                c >>= 1;
            }
            j += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

static CRC_TABLE: [u32; 256] = make_crc_table();

/// Computes the standard IEEE 802.3 CRC32 checksum of a byte slice.
pub fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = CRC_TABLE[((crc ^ u32::from(b)) & 0xFF) as usize] ^ (crc >> 8);
    }
    !crc
}

/// Metadata recorded for each object written into a packfile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackEntryMeta {
    pub oid: Oid,
    pub offset: u64,
    pub crc32: u32,
}

/// Serializes Git type and uncompressed size into variable-length MSB format.
fn encode_type_size(type_code: u8, mut size: usize, out: &mut Vec<u8>) {
    let mut byte = ((type_code & 0x07) << 4) | ((size & 0x0f) as u8);
    size >>= 4;
    while size > 0 {
        byte |= 0x80;
        out.push(byte);
        byte = (size & 0x7f) as u8;
        size >>= 7;
    }
    out.push(byte);
}

/// Encodes an OFS_DELTA negative distance into Git's bijective base-128 varint format.
fn encode_ofs_distance(distance: u64, out: &mut Vec<u8>) {
    let (buf, start) = encode_git_offset_varint(distance);
    out.extend_from_slice(&buf[start..]);
}

/// Resolves object header facts for full or delta representation.
fn resolve_object_facts(
    chain: &PackDeltaChain,
    entry_offset: u64,
    base_offset: Option<u64>,
) -> FractalResult<(u8, usize, &[u8], Option<u64>)> {
    match &chain.resolution {
        DeltaResolution::Full { payload } => {
            let code = match chain.kind {
                ObjectKind::Commit => OBJ_COMMIT,
                ObjectKind::Tree => OBJ_TREE,
                ObjectKind::Blob => OBJ_BLOB,
                ObjectKind::Tag => OBJ_TAG,
            };
            Ok((code, payload.len(), payload.as_slice(), None))
        }
        DeltaResolution::Delta { delta_payload, .. } => {
            let base_off = base_offset.ok_or_else(|| {
                FractalError::CorruptStore("Missing base offset for OFS_DELTA".into())
            })?;
            let distance = entry_offset.checked_sub(base_off).ok_or_else(|| {
                FractalError::CorruptStore(format!(
                    "Invalid OFS_DELTA base offset {base_off} ahead of current {entry_offset}"
                ))
            })?;
            Ok((
                OBJ_OFS_DELTA,
                delta_payload.len(),
                delta_payload.as_slice(),
                Some(distance),
            ))
        }
    }
}

/// Reusable compression state hoisted out of `PackWriter::write_pack` (`FGT-PRF-001`).
struct EntryEncodeScratch {
    object_bytes: Vec<u8>,
    spare_compressed: Vec<u8>,
    encoder: ZlibEncoder<Vec<u8>>,
}

impl EntryEncodeScratch {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            object_bytes: Vec::with_capacity(capacity),
            spare_compressed: Vec::with_capacity(capacity),
            encoder: ZlibEncoder::new(Vec::with_capacity(capacity), Compression::default()),
        }
    }
}

/// Compresses payload and packages object header into `scratch.object_bytes` without reallocating
/// the underlying LZ77 deflate state or vector capacities.
fn build_object_entry(
    chain: &PackDeltaChain,
    entry_offset: u64,
    base_offset: Option<u64>,
    scratch: &mut EntryEncodeScratch,
) -> FractalResult<()> {
    scratch.object_bytes.clear();
    scratch.spare_compressed.clear();

    let (type_code, uncompressed_size, payload, base_distance) =
        resolve_object_facts(chain, entry_offset, base_offset)?;

    encode_type_size(type_code, uncompressed_size, &mut scratch.object_bytes);
    if let Some(dist) = base_distance {
        encode_ofs_distance(dist, &mut scratch.object_bytes);
    }

    scratch.encoder.write_all(payload)?;
    let finished = scratch
        .encoder
        .reset(std::mem::take(&mut scratch.spare_compressed))?;
    scratch.object_bytes.extend_from_slice(&finished);
    scratch.spare_compressed = finished;

    Ok(())
}

/// Writes a complete Git Packfile v2 stream from resolved delta chains.
pub struct PackWriter;

impl PackWriter {
    /// Writes a complete pack stream to `writer` and returns the pack SHA-1 and per-object metadata.
    pub fn write_pack<W: Write>(
        chains: &[PackDeltaChain],
        writer: W,
    ) -> FractalResult<(Oid, Vec<PackEntryMeta>)> {
        let mut buffered = BufWriter::with_capacity(64 * 1024, writer);
        let mut hasher = Sha1::new();
        let mut current_offset: u64 = 0;

        // 1. Pack Header: "PACK" (4) + version 2 (4) + object count (4)
        let count = chains.len() as u32;
        let mut header = [0u8; 12];
        header[..4].copy_from_slice(&PACK_MAGIC);
        header[4..8].copy_from_slice(&PACK_VERSION_2.to_be_bytes());
        header[8..12].copy_from_slice(&count.to_be_bytes());

        buffered.write_all(&header)?;
        hasher.update(header);
        current_offset += 12;

        let mut entries = Vec::with_capacity(chains.len());
        let mut object_offsets: Vec<u64> = Vec::with_capacity(chains.len());

        // Reusable zero-alloc buffers + LZ77 state across iterations (FGT-PRF-001)
        let mut scratch = EntryEncodeScratch::with_capacity(65_536);

        // 2. Objects stream
        for chain in chains {
            let entry_offset = current_offset;
            object_offsets.push(entry_offset);

            let base_offset = match &chain.resolution {
                DeltaResolution::Full { .. } => None,
                DeltaResolution::Delta { base_index, .. } => Some(object_offsets[*base_index]),
            };

            build_object_entry(chain, entry_offset, base_offset, &mut scratch)?;

            // CRC32 covers all bytes of this object entry in the pack
            let entry_crc = crc32_ieee(&scratch.object_bytes);

            buffered.write_all(&scratch.object_bytes)?;
            hasher.update(&scratch.object_bytes);
            current_offset += scratch.object_bytes.len() as u64;

            entries.push(PackEntryMeta {
                oid: chain.oid,
                offset: entry_offset,
                crc32: entry_crc,
            });
        }

        // 3. Pack Trailer: 20-byte SHA-1 of pack stream
        let pack_sha1: [u8; 20] = hasher.finalize().into();
        buffered.write_all(&pack_sha1)?;
        buffered.flush()?;

        Ok((Oid::from_bytes(pack_sha1), entries))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crc32_ieee_standard_check_value() {
        assert_eq!(crc32_ieee(b"123456789"), 0xCBF43926);
    }

    #[test]
    fn test_encode_ofs_distance_roundtrip() {
        let dist = 130u64;
        let mut bytes = Vec::new();
        encode_ofs_distance(dist, &mut bytes);
        assert_eq!(bytes, vec![0x80, 0x02]);

        let small = 5u64;
        let mut small_bytes = Vec::new();
        encode_ofs_distance(small, &mut small_bytes);
        assert_eq!(small_bytes, vec![0x05]);
    }
}
