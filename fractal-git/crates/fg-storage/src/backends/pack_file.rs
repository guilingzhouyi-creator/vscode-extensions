//! Module: fg-storage — Packfile Object Reader
//! File Path: crates/fg-storage/src/backends/pack_file.rs
//! Architecture Role: Decodes one `*.pack` file: object headers, `OBJ_OFS_DELTA` and
//!   `OBJ_REF_DELTA` chains, and zlib payloads, yielding `(kind, payload)` pairs.
//! Dependencies & Triggers: Driven by the ODB router for every pack beside an `.idx`; resolves
//!   cross-pack bases through the [`DeltaBaseSource`] the router supplies.
//! Responsibilities: Parse the pack header, walk delta chains with a hard depth ceiling, and
//!   inflate only the bytes belonging to the object being read.
//! Exit Semantics & Design Rationale:
//!   - The whole pack is read into memory once per handle. Memory mapping would avoid the copy, but
//!     the mapping crate is not available in this build's offline dependency set, and a partial
//!     read per object turns a 19,149-object traversal into 19,149 open/seek/read cycles. One
//!     sequential read is the cheaper of the two available choices, and the caller controls how many
//!     handles live at once.
//!   - Chain depth is capped at [`MAX_CHAIN_DEPTH`]. A forged pack can otherwise encode a cycle
//!     through `REF_DELTA` and recurse until the stack dies, which looks like an engine crash rather
//!     than a corrupt pack.
//!   - The declared size of a delta object is the size of the *delta stream*, not of the
//!     reconstructed object. Comparing the inflated bytes against the reconstructed length would
//!     reject every valid delta; the check is applied to the stream only.
//!   - A type code outside the six the format defines is an error. Defaulting to `blob` would make
//!     a corrupt header read as a valid object with the wrong id.
//!
//! Domain Governance Rules: FGT-STO-001 (pack reader and delta chain recursion guard), FGT-COR-001, FGT-PRF-001.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use flate2::read::ZlibDecoder;

use fg_core::decode_git_offset_varint;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, ObjectKind, Oid};

use crate::backends::pack_window::{PackWindowReader, PackWindowStream, DEFAULT_PACK_WINDOW_SIZE};
use crate::backends::pack_writer::{crc32_ieee, PackEntryMeta};
use crate::delta_git::apply_git_delta;

/// Magic at the head of a packfile, ASCII `PACK`.
const PACK_MAGIC: [u8; 4] = *b"PACK";

/// Lowest pack layout version this build reads.
const PACK_VERSION_MIN: u32 = 2;

/// Highest pack layout version this build reads.
const PACK_VERSION_MAX: u32 = 3;

/// Byte length of the pack header: magic, version, object count.
const PACK_HEADER_LEN: usize = 12;

/// Byte length of the trailing checksum.
const PACK_TRAILER_LEN: usize = 20;

/// Default threshold (512 KiB) above which PackFile uses on-demand sliding window instead of whole heap allocation.
pub const PACK_WINDOW_THRESHOLD: u64 = 512 * 1024;

/// Underlying packfile storage: contiguous in-memory or sliding window on-demand.
#[derive(Debug)]
pub enum PackBuffer {
    Memory(Vec<u8>),
    Windowed(PackWindowReader),
}

impl PackBuffer {
    pub fn len(&self) -> usize {
        match self {
            Self::Memory(bytes) => bytes.len(),
            Self::Windowed(reader) => reader.total_len() as usize,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn read_slice(&self, offset: usize, len: usize) -> FractalResult<Vec<u8>> {
        match self {
            Self::Memory(bytes) => {
                let end = offset.checked_add(len).ok_or_else(|| {
                    FractalError::CorruptStore(format!("Slice offset overflow: {offset} + {len}"))
                })?;
                let slice = bytes.get(offset..end).ok_or_else(|| {
                    FractalError::CorruptStore(format!("Slice out of bounds: {offset}..{end}"))
                })?;
                Ok(slice.to_vec())
            }
            Self::Windowed(reader) => reader.read_exact_at(offset as u64, len),
        }
    }

    pub fn get_byte(&self, offset: usize) -> FractalResult<u8> {
        match self {
            Self::Memory(bytes) => bytes
                .get(offset)
                .copied()
                .ok_or_else(|| FractalError::CorruptStore(format!("Offset out of bounds: {offset}"))),
            Self::Windowed(reader) => reader.read_byte_at(offset as u64),
        }
    }
}

/// Ceiling on how many delta links may be followed for one object.
///
/// The deepest chain measured in this repository is 47; 64 leaves headroom without allowing an
/// unbounded walk.
pub const MAX_CHAIN_DEPTH: usize = 64;

/// Type code for a delta whose base sits earlier in the same pack.
const TYPE_OFS_DELTA: u8 = 6;

/// Type code for a delta whose base is named by object id.
const TYPE_REF_DELTA: u8 = 7;

/// Bit marking that another header byte follows.
const SIZE_CONTINUE: u8 = 0x80;

/// Bits of the low header byte that hold the type code.
const TYPE_MASK: u8 = 0x70;

/// Shift that moves the type code down to its own value.
const TYPE_SHIFT: u32 = 4;

/// Low nibble of the first header byte: the first four size bits.
const SIZE_LOW_MASK: u8 = 0x0f;

/// Bits of continuation payload contributed by each byte after the first continuation.
const SIZE_CONTINUATION_BITS: u32 = 7;

/// Shift applied to the *first* continuation byte.
///
/// The low nibble of the type byte already carries four size bits, so the first continuation
/// contributes bits 4..10, not bits 7..13. Starting at seven shifts the whole size upward and yields
/// a declared size that is plausible but wrong; inflation then disagrees with it and the error
/// points at the payload instead of at the header decoding that produced it.
const SIZE_FIRST_CONTINUATION_SHIFT: u32 = 4;

/// Payload bits carried by one continuation byte.
const SIZE_CONTINUATION_MASK: u8 = 0x7f;

/// Supplies the base object for a `REF_DELTA` whose base lives elsewhere.
pub trait DeltaBaseSource {
    /// Returns the kind and payload of `oid`.
    ///
    /// # Errors
    ///
    /// Returns an error when the id is unknown or unreadable; returning a synthetic fallback base would
    /// reconstruct the wrong bytes.
    fn read_base(&self, oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)>;
}

/// One resolved object: its kind and its payload, without the `"<type> <len>\0"` header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedObject {
    /// Object type recorded in the pack.
    pub kind: ObjectKind,
    /// Uncompressed payload.
    pub payload: Vec<u8>,
}

/// A packfile held in memory or windowed on-demand together with its header facts.
#[derive(Debug)]
pub struct PackFile {
    path: PathBuf,
    buffer: PackBuffer,
    object_count: u32,
}

impl PackFile {
    /// Loads and validates a packfile, routing to windowed reader when exceeding threshold.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] when the file cannot be read and
    /// [`FractalError::CorruptStore`] for a bad magic, an unsupported version, or a truncated file.
    pub fn load(path: impl Into<PathBuf>) -> FractalResult<Self> {
        let path = path.into();
        let file_len = fs::metadata(&path)?.len();
        if file_len > PACK_WINDOW_THRESHOLD {
            Self::load_windowed(path, DEFAULT_PACK_WINDOW_SIZE)
        } else {
            let bytes = fs::read(&path)?;
            Self::parse(path, bytes)
        }
    }

    /// Loads a packfile using an explicit on-demand sliding window reader.
    pub fn load_windowed(path: impl Into<PathBuf>, window_size: usize) -> FractalResult<Self> {
        let path = path.into();
        let reader = PackWindowReader::open(&path, window_size)?;
        if reader.total_len() < (PACK_HEADER_LEN + PACK_TRAILER_LEN) as u64 {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' is {} bytes, shorter than a pack header plus trailer",
                path.display(),
                reader.total_len()
            )));
        }
        let header = reader.read_exact_at(0, PACK_HEADER_LEN)?;
        if header[..4] != PACK_MAGIC {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' has magic {:02x?}, expected PACK",
                path.display(),
                &header[..4]
            )));
        }
        let version = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);
        if !(PACK_VERSION_MIN..=PACK_VERSION_MAX).contains(&version) {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' declares version {version}; this build reads {PACK_VERSION_MIN}..={PACK_VERSION_MAX}",
                path.display()
            )));
        }
        let object_count = u32::from_be_bytes([header[8], header[9], header[10], header[11]]);
        Ok(Self {
            path,
            buffer: PackBuffer::Windowed(reader),
            object_count,
        })
    }

    /// Validates a pack already held in memory.
    pub fn parse(path: PathBuf, bytes: Vec<u8>) -> FractalResult<Self> {
        if bytes.len() < PACK_HEADER_LEN + PACK_TRAILER_LEN {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' is {} bytes, shorter than a pack header plus trailer",
                path.display(),
                bytes.len()
            )));
        }
        if bytes[..4] != PACK_MAGIC {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' has magic {:02x?}, expected PACK",
                path.display(),
                &bytes[..4]
            )));
        }
        let version = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
        if !(PACK_VERSION_MIN..=PACK_VERSION_MAX).contains(&version) {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' declares version {version}; this build reads {PACK_VERSION_MIN}..={PACK_VERSION_MAX}",
                path.display()
            )));
        }
        let object_count = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]);
        Ok(Self {
            path,
            buffer: PackBuffer::Memory(bytes),
            object_count,
        })
    }

    /// Whether this pack is accessed via on-demand windowed buffering.
    pub fn is_windowed(&self) -> bool {
        matches!(self.buffer, PackBuffer::Windowed(_))
    }

    /// Path this pack was loaded from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Number of objects the header declares.
    pub fn object_count(&self) -> u32 {
        self.object_count
    }

    /// Reads the object whose header starts at `offset`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] for a malformed header, a chain deeper than
    /// [`MAX_CHAIN_DEPTH`], a zlib stream that will not inflate to its declared size, or a base that
    /// the resolver cannot supply.
    pub fn read_at(
        &self,
        offset: u64,
        resolver: &dyn DeltaBaseSource,
    ) -> FractalResult<PackedObject> {
        let mut budget = MAX_CHAIN_DEPTH;
        self.read_at_depth(offset, resolver, &mut budget)
    }

    /// Scans and indexes every object in the packfile, returning the pack SHA-1 trailer and entry metadata.
    ///
    /// Inflates each object stream once (capturing `total_in` simultaneously) and caches resolved
    /// entries by byte offset and `Oid` so `OFS_DELTA` and intra-pack `REF_DELTA` chains resolve in
    /// $O(1)$ without re-inflating base streams.
    pub fn index_objects(
        &self,
        resolver: &dyn DeltaBaseSource,
    ) -> FractalResult<(Oid, Vec<PackEntryMeta>)> {
        let trailer_start = self.buffer.len().saturating_sub(PACK_TRAILER_LEN);
        let trailer_slice = self.buffer.read_slice(trailer_start, PACK_TRAILER_LEN)?;
        let mut pack_sha_bytes = [0u8; 20];
        pack_sha_bytes.copy_from_slice(&trailer_slice);
        let pack_oid = Oid::from_bytes(pack_sha_bytes);

        let capacity = self.object_count as usize;
        let mut entries = Vec::with_capacity(capacity);
        let mut by_offset: HashMap<u64, (ObjectKind, Arc<[u8]>)> = HashMap::with_capacity(capacity);
        let mut by_oid: HashMap<Oid, (ObjectKind, Arc<[u8]>)> = HashMap::with_capacity(capacity);
        let mut cursor = PACK_HEADER_LEN;

        for _ in 0..self.object_count {
            let start_offset = cursor as u64;
            let (kind, payload, end_offset) =
                self.decode_indexed_entry(cursor, resolver, &by_offset, &by_oid)?;
            let oid = compute_object_oid(kind, payload.as_ref());
            let entry_slice = self.buffer.read_slice(cursor, end_offset - cursor)?;
            let crc = crc32_ieee(&entry_slice);

            by_offset.insert(start_offset, (kind, Arc::clone(&payload)));
            by_oid.insert(oid, (kind, payload));
            entries.push(PackEntryMeta {
                oid,
                offset: start_offset,
                crc32: crc,
            });
            cursor = end_offset;
        }

        Ok((pack_oid, entries))
    }

    /// Decodes and inflates one sequential entry during `index_objects`, returning `(kind, payload, end_offset)`.
    fn decode_indexed_entry(
        &self,
        cursor: usize,
        resolver: &dyn DeltaBaseSource,
        by_offset: &HashMap<u64, (ObjectKind, Arc<[u8]>)>,
        by_oid: &HashMap<Oid, (ObjectKind, Arc<[u8]>)>,
    ) -> FractalResult<(ObjectKind, Arc<[u8]>, usize)> {
        let start_offset = cursor as u64;
        self.check_offset(start_offset)?;
        let (type_code, declared_size, post_header) = self.decode_header(cursor)?;

        match type_code {
            TYPE_OFS_DELTA => {
                let (base_offset, slice_start) =
                    self.decode_ofs_offset(post_header, start_offset)?;
                let (delta, consumed) =
                    self.inflate_with_consumed(slice_start, declared_size, start_offset)?;
                let (kind, reconstructed) = if let Some((base_kind, base_bytes)) =
                    by_offset.get(&base_offset)
                {
                    let applied = apply_git_delta(base_bytes.as_ref(), &delta).map_err(|err| {
                        FractalError::CorruptStore(format!(
                            "delta at offset {start_offset} could not be applied: {err}"
                        ))
                    })?;
                    (*base_kind, applied)
                } else {
                    let base = self.read_at(base_offset, resolver)?;
                    let resolved = reconstruct(base, &delta, start_offset)?;
                    (resolved.kind, resolved.payload)
                };
                Ok((kind, Arc::from(reconstructed), slice_start + consumed))
            }
            TYPE_REF_DELTA => {
                let base_oid = self.read_base_oid(post_header, start_offset)?;
                let slice_start = post_header + base_oid.as_bytes().len();
                let (delta, consumed) =
                    self.inflate_with_consumed(slice_start, declared_size, start_offset)?;
                let (kind, reconstructed) = if let Some((base_kind, base_bytes)) =
                    by_oid.get(&base_oid)
                {
                    let applied = apply_git_delta(base_bytes.as_ref(), &delta).map_err(|err| {
                        FractalError::CorruptStore(format!(
                            "delta at offset {start_offset} could not be applied: {err}"
                        ))
                    })?;
                    (*base_kind, applied)
                } else {
                    let (base_kind, base_payload) = resolver.read_base(&base_oid)?;
                    let resolved = reconstruct(
                        PackedObject {
                            kind: base_kind,
                            payload: base_payload,
                        },
                        &delta,
                        start_offset,
                    )?;
                    (resolved.kind, resolved.payload)
                };
                Ok((kind, Arc::from(reconstructed), slice_start + consumed))
            }
            other => {
                let kind = type_from_code(other).ok_or_else(|| {
                    FractalError::CorruptStore(format!(
                        "packfile '{}' object at offset {start_offset} declares unknown type {other}",
                        self.path.display()
                    ))
                })?;
                let (payload, consumed) =
                    self.inflate_with_consumed(post_header, declared_size, start_offset)?;
                Ok((kind, Arc::from(payload), post_header + consumed))
            }
        }
    }

    /// Reads one object, decrementing the shared chain budget for every delta followed.
    fn read_at_depth(
        &self,
        offset: u64,
        resolver: &dyn DeltaBaseSource,
        budget: &mut usize,
    ) -> FractalResult<PackedObject> {
        let start = self.check_offset(offset)?;
        let (type_code, declared_size, mut cursor) = self.decode_header(start)?;
        match type_code {
            TYPE_OFS_DELTA => {
                self.consume_budget(budget, offset)?;
                let (base_offset, after_offset) = self.decode_ofs_offset(cursor, offset)?;
                cursor = after_offset;
                let delta = self.inflate(cursor, declared_size, offset)?;
                let base = self.read_at_depth(base_offset, resolver, budget)?;
                reconstruct(base, &delta, offset)
            }
            TYPE_REF_DELTA => {
                self.consume_budget(budget, offset)?;
                let base_oid = self.read_base_oid(cursor, offset)?;
                cursor += base_oid.as_bytes().len();
                let delta = self.inflate(cursor, declared_size, offset)?;
                let (kind, payload) = resolver.read_base(&base_oid)?;
                reconstruct(PackedObject { kind, payload }, &delta, offset)
            }
            other => {
                let kind = type_from_code(other).ok_or_else(|| {
                    FractalError::CorruptStore(format!(
                        "packfile '{}' object at offset {offset} declares unknown type {other}",
                        self.path.display()
                    ))
                })?;
                let payload = self.inflate(cursor, declared_size, offset)?;
                Ok(PackedObject { kind, payload })
            }
        }
    }

    /// Decodes the backward offset of an `OFS_DELTA` from either memory or window reader.
    fn decode_ofs_offset(&self, start: usize, offset: u64) -> FractalResult<(u64, usize)> {
        match &self.buffer {
            PackBuffer::Memory(bytes) => decode_ofs_offset(bytes, start, offset),
            PackBuffer::Windowed(reader) => {
                let avail = (reader.total_len() as usize).saturating_sub(start).min(32);
                let slice = reader.read_exact_at(start as u64, avail)?;
                let (distance, consumed) = decode_git_offset_varint(&slice).ok_or_else(|| {
                    FractalError::CorruptStore(format!(
                        "OFS_DELTA at offset {offset} has a truncated or overflowing base offset"
                    ))
                })?;
                let base = offset.checked_sub(distance).ok_or_else(|| {
                    FractalError::CorruptStore(format!(
                        "OFS_DELTA at offset {offset} points {distance} bytes back, past the pack start"
                    ))
                })?;
                Ok((base, start + consumed))
            }
        }
    }

    /// Converts an offset into a slice index, refusing offsets inside the header or trailer.
    fn check_offset(&self, offset: u64) -> FractalResult<usize> {
        let index = usize::try_from(offset).map_err(|_| {
            FractalError::CorruptStore(format!(
                "packfile '{}' offset {offset} does not fit this platform's usize",
                self.path.display()
            ))
        })?;
        let upper = self.buffer.len().saturating_sub(PACK_TRAILER_LEN);
        if index < PACK_HEADER_LEN || index >= upper {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' offset {offset} lies outside the object region {PACK_HEADER_LEN}..{upper}",
                self.path.display()
            )));
        }
        Ok(index)
    }

    /// Charges one link against the chain budget.
    fn consume_budget(&self, budget: &mut usize, offset: u64) -> FractalResult<()> {
        if *budget == 0 {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' delta chain at offset {offset} exceeds {MAX_CHAIN_DEPTH} links",
                self.path.display()
            )));
        }
        *budget -= 1;
        Ok(())
    }

    /// Decodes a type/size header, returning the type code, size, and post-header cursor.
    fn decode_header(&self, start: usize) -> FractalResult<(u8, usize, usize)> {
        let first = self.buffer.get_byte(start)?;
        let type_code = (first & TYPE_MASK) >> TYPE_SHIFT;
        let mut size = usize::from(first & SIZE_LOW_MASK);
        let mut shift = SIZE_FIRST_CONTINUATION_SHIFT;
        let mut cursor = start + 1;
        let mut byte = first;
        while byte & SIZE_CONTINUE != 0 {
            byte = self.buffer.get_byte(cursor)?;
            size |= usize::from(byte & SIZE_CONTINUATION_MASK) << shift;
            shift += SIZE_CONTINUATION_BITS;
            cursor += 1;
        }
        Ok((type_code, size, cursor))
    }

    /// Reads the 20-byte base id of a `REF_DELTA`.
    fn read_base_oid(&self, cursor: usize, _offset: u64) -> FractalResult<Oid> {
        let slice = self.buffer.read_slice(cursor, 20)?;
        let mut raw = [0u8; 20];
        raw.copy_from_slice(&slice);
        Ok(Oid::from_bytes(raw))
    }

    /// Inflates a zlib stream that must decode to exactly `declared_size` bytes.
    fn inflate(&self, start: usize, declared_size: usize, offset: u64) -> FractalResult<Vec<u8>> {
        self.inflate_with_consumed(start, declared_size, offset)
            .map(|(out, _)| out)
    }

    /// Inflates a single zlib stream at `start`, returning `(decompressed_bytes, compressed_bytes_consumed)`.
    fn inflate_with_consumed(
        &self,
        start: usize,
        declared_size: usize,
        offset: u64,
    ) -> FractalResult<(Vec<u8>, usize)> {
        let mut out = Vec::with_capacity(declared_size);
        let consumed = match &self.buffer {
            PackBuffer::Memory(bytes) => {
                let slice = bytes.get(start..).ok_or_else(|| {
                    FractalError::CorruptStore(format!(
                        "packfile '{}' object at offset {offset} has no payload region",
                        self.path.display()
                    ))
                })?;
                let mut decoder = ZlibDecoder::new(slice);
                decoder.read_to_end(&mut out).map_err(|io_err| {
                    FractalError::CorruptStore(format!(
                        "packfile '{}' object at offset {offset} failed to inflate: {io_err}",
                        self.path.display()
                    ))
                })?;
                decoder.total_in() as usize
            }
            PackBuffer::Windowed(reader) => {
                let stream = PackWindowStream::new(reader, start as u64, reader.total_len());
                let mut decoder = ZlibDecoder::new(stream);
                decoder.read_to_end(&mut out).map_err(|io_err| {
                    FractalError::CorruptStore(format!(
                        "packfile '{}' object at offset {offset} failed to inflate: {io_err}",
                        self.path.display()
                    ))
                })?;
                decoder.total_in() as usize
            }
        };
        if out.len() != declared_size {
            return Err(FractalError::CorruptStore(format!(
                "packfile '{}' object at offset {offset} inflated to {} bytes but declared {declared_size}",
                self.path.display(),
                out.len()
            )));
        }
        Ok((out, consumed))
    }
}

/// Maps a base-object type code to its kind.
fn type_from_code(code: u8) -> Option<ObjectKind> {
    match code {
        1 => Some(ObjectKind::Commit),
        2 => Some(ObjectKind::Tree),
        3 => Some(ObjectKind::Blob),
        4 => Some(ObjectKind::Tag),
        _ => None,
    }
}

/// Decodes the backward offset of an `OFS_DELTA`, returning the absolute base offset.
///
/// The encoding is Git's bijective base-128 varint with an implicit +1 per continuation, so the
/// result is the distance *behind* the current object, not an absolute offset.
fn decode_ofs_offset(bytes: &[u8], start: usize, offset: u64) -> FractalResult<(u64, usize)> {
    let slice = bytes.get(start..).ok_or_else(|| {
        FractalError::CorruptStore(format!(
            "OFS_DELTA at offset {offset} has no base-offset byte"
        ))
    })?;
    let (distance, consumed) = decode_git_offset_varint(slice).ok_or_else(|| {
        FractalError::CorruptStore(format!(
            "OFS_DELTA at offset {offset} has a truncated or overflowing base offset"
        ))
    })?;
    let base = offset.checked_sub(distance).ok_or_else(|| {
        FractalError::CorruptStore(format!(
            "OFS_DELTA at offset {offset} points {distance} bytes back, past the pack start"
        ))
    })?;
    Ok((base, start + consumed))
}

/// Applies a delta stream to its base and reports the base's kind for the result.
fn reconstruct(base: PackedObject, delta: &[u8], offset: u64) -> FractalResult<PackedObject> {
    let payload = apply_git_delta(&base.payload, delta).map_err(|delta_err| {
        FractalError::CorruptStore(format!(
            "delta at offset {offset} could not be applied: {delta_err}"
        ))
    })?;
    Ok(PackedObject {
        kind: base.kind,
        payload,
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_ofs_offset, PackBuffer, PackFile, PackedObject, MAX_CHAIN_DEPTH};
    use crate::backends::pack_file::DeltaBaseSource;
    use fg_core::error::FractalResult;
    use fg_core::models::{ObjectKind, Oid};
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;
    use std::path::PathBuf;

    /// Collects zlib-compressed `payload` into `out`.
    fn deflate_into(out: &mut Vec<u8>, payload: &[u8]) {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(payload).expect("write payload");
        out.extend_from_slice(&encoder.finish().expect("finish"));
    }

    /// Writes a one-byte type/size header; sizes below 16 fit in the low nibble.
    fn header_into(out: &mut Vec<u8>, type_code: u8, size: usize) {
        assert!(size < 16, "this helper only encodes sizes below 16");
        out.push((type_code << 4) | size as u8);
    }

    /// Builds a pack holding one base blob and one `OFS_DELTA` derived from it.
    ///
    /// Returns the pack, the base object's offset, and the delta object's offset.
    fn pack_with_ofs_delta() -> (PackFile, u64, u64) {
        const PACK_HEADER: usize = 12;
        let base_payload = b"hello world\n";
        let mut body = Vec::new();
        header_into(&mut body, 3, base_payload.len());
        deflate_into(&mut body, base_payload);

        // Copy base[0..6] then insert "there\n": 12 bytes out of a 12-byte base.
        let delta_stream: [u8; 12] = [
            12, 12, // base size, target size
            0x91, 0x00, 0x06, // copy offset 0, length 6
            0x06, b't', b'h', b'e', b'r', b'e', b'\n', // insert 6 literal bytes
        ];
        let delta_offset = PACK_HEADER + body.len();
        let distance = delta_offset - PACK_HEADER;
        header_into(&mut body, 6, delta_stream.len());
        body.push(distance as u8);
        deflate_into(&mut body, &delta_stream);

        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"PACK");
        bytes.extend_from_slice(&2u32.to_be_bytes());
        bytes.extend_from_slice(&2u32.to_be_bytes());
        bytes.extend_from_slice(&body);
        bytes.extend_from_slice(&[0u8; 20]);
        let pack = PackFile::parse(PathBuf::from("sample.pack"), bytes).expect("parse");
        (pack, PACK_HEADER as u64, delta_offset as u64)
    }

    struct NoBase;
    impl DeltaBaseSource for NoBase {
        fn read_base(&self, _oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
            Err(fg_core::error::FractalError::CorruptStore(
                "no base".to_string(),
            ))
        }
    }

    #[test]
    fn reads_a_plain_blob() {
        let (pack, base_offset, _) = pack_with_ofs_delta();
        let object = pack.read_at(base_offset, &NoBase).expect("read base");
        assert_eq!(object.kind, ObjectKind::Blob);
        assert_eq!(object.payload, b"hello world\n");
    }

    #[test]
    fn follows_an_ofs_delta_to_its_base() {
        let (pack, base_offset, delta_offset) = pack_with_ofs_delta();
        let object = pack.read_at(delta_offset, &NoBase).expect("read delta");
        assert_eq!(object.kind, ObjectKind::Blob);
        assert_eq!(object.payload, b"hello there\n");

        let (_, indexed) = pack.index_objects(&NoBase).expect("index pack once");
        assert_eq!(indexed.len(), 2);
        assert_eq!(indexed[0].offset, base_offset);
        assert_eq!(indexed[1].offset, delta_offset);
        assert_eq!(
            indexed[0].oid,
            fg_core::models::compute_object_oid(ObjectKind::Blob, b"hello world\n")
        );
        assert_eq!(
            indexed[1].oid,
            fg_core::models::compute_object_oid(ObjectKind::Blob, b"hello there\n")
        );
    }

    #[test]
    fn rejects_a_ref_delta_without_a_resolvable_base() {
        let mut body = Vec::new();
        header_into(&mut body, 7, 4);
        body.extend_from_slice(&[0x11u8; 20]);
        deflate_into(&mut body, &[0u8, 0u8]);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"PACK");
        bytes.extend_from_slice(&2u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&body);
        bytes.extend_from_slice(&[0u8; 20]);
        let pack = PackFile::parse(PathBuf::from("ref.pack"), bytes).expect("parse");
        assert!(pack.read_at(12, &NoBase).is_err());
    }

    #[test]
    fn rejects_a_pack_with_the_wrong_magic() {
        let mut bytes = vec![0u8; 64];
        bytes[..4].copy_from_slice(b"NOPE");
        assert!(PackFile::parse(PathBuf::from("bad.pack"), bytes).is_err());
    }

    #[test]
    fn rejects_an_offset_inside_the_header() {
        let (pack, _, _) = pack_with_ofs_delta();
        assert!(pack.read_at(0, &NoBase).is_err());
    }

    #[test]
    fn decodes_a_single_byte_offset() {
        // No continuation bit: the distance is the low seven bits, here 5.
        let bytes = [0x05u8];
        let (base, cursor) = decode_ofs_offset(&bytes, 0, 1000).expect("decode");
        assert_eq!(base, 995);
        assert_eq!(cursor, 1);
    }

    #[test]
    fn decodes_a_two_byte_offset() {
        // 0x80 then 0x00 => ((0+1) << 7) | 0 = 128.
        let bytes = [0x80u8, 0x00u8];
        let (base, cursor) = decode_ofs_offset(&bytes, 0, 500).expect("decode");
        assert_eq!(base, 372);
        assert_eq!(cursor, 2);
    }

    #[test]
    fn rejects_an_offset_that_points_before_the_pack() {
        let bytes = [0xffu8, 0x7fu8];
        assert!(decode_ofs_offset(&bytes, 0, 10).is_err());
    }

    #[test]
    fn exposes_the_chain_ceiling() {
        assert_eq!(MAX_CHAIN_DEPTH, 64);
    }

    #[test]
    fn a_packed_object_compares_by_value() {
        let left = PackedObject {
            kind: ObjectKind::Blob,
            payload: b"x".to_vec(),
        };
        assert_eq!(left.clone(), left);
    }

    #[test]
    fn test_windowed_pack_reading_and_parity() {
        let (pack_mem, base_offset, delta_offset) = pack_with_ofs_delta();
        assert!(!pack_mem.is_windowed());

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let pack_path = temp_dir.path().join("window_test.pack");
        if let PackBuffer::Memory(ref bytes) = pack_mem.buffer {
            std::fs::write(&pack_path, bytes).expect("write pack");
        }

        let pack_win = PackFile::load_windowed(&pack_path, 64).expect("load windowed");
        assert!(pack_win.is_windowed());
        assert_eq!(pack_win.object_count(), pack_mem.object_count());

        let base_obj_mem = pack_mem.read_at(base_offset, &NoBase).expect("read mem base");
        let base_obj_win = pack_win.read_at(base_offset, &NoBase).expect("read win base");
        assert_eq!(base_obj_win, base_obj_mem);

        let delta_obj_mem = pack_mem.read_at(delta_offset, &NoBase).expect("read mem delta");
        let delta_obj_win = pack_win.read_at(delta_offset, &NoBase).expect("read win delta");
        assert_eq!(delta_obj_win, delta_obj_mem);
    }

    #[test]
    fn test_pack_buffer_read_slice_overflow_and_bounds() {
        let buf = PackBuffer::Memory(vec![10, 20, 30, 40]);
        assert_eq!(buf.len(), 4);
        assert_eq!(buf.get_byte(0).unwrap(), 10);
        assert_eq!(buf.get_byte(3).unwrap(), 40);
        assert!(buf.get_byte(4).is_err());
        assert!(buf.read_slice(usize::MAX, 1).is_err());
        assert!(buf.read_slice(2, usize::MAX).is_err());
        assert!(buf.read_slice(0, 5).is_err());
        let slice = buf.read_slice(1, 2).expect("valid slice");
        assert_eq!(slice, vec![20, 30]);
    }
}
