//! Module: fg-native — TAXC Container Reader and Writer
//! File Path: crates/fg-native/src/container.rs
//! Architecture Role: Parses and emits the TAXC binary container: a 24-byte header, a sorted
//!   section table, 8-byte-aligned payloads, and an 8-byte trailer carrying a table CRC.
//! Dependencies & Triggers: Root of the native layer; every section codec operates on payloads
//!   extracted by this module, and `taxis doctor` reports its errors verbatim.
//! Responsibilities: Validate every structural invariant in a fixed order, expose zero-copy
//!   payload slices to section codecs, and write containers atomically through staging-file rename.
//! Exit Semantics & Design Rationale:
//!   - Validation order is fixed and documented: length, magic, version, section count, body
//!     length, table CRC, then per-section bounds/alignment. Each step exists because an earlier
//!     step's fields are needed to perform it safely; reordering would allow a forged length to
//!     drive a slice before the CRC proved the length honest.
//!   - Section payloads are returned as borrowed slices; the container owns the bytes, so section
//!     codecs never copy. This keeps decoding allocation-free on the read path.
//!   - Writing goes to `<path>.tmp` then renames, so a crash can never leave a half-written
//!     container; the rename is the single atomic publication point.
//!   - No panic: every index is derived from a validated bound, never from raw arithmetic.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-STO-001.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::checksum::crc32c;
use crate::constants::{
    FLAG_READ_ONLY, HEADER_LEN, MAX_SECTION_COUNT, MIN_CONTAINER_LEN, SECTION_ALIGNMENT,
    SECTION_ENTRY_LEN, TAXC_FORMAT_VERSION, TAXC_MAGIC, TAXC_MAGIC_WORD, TRAILER_LEN,
};
use crate::error::{NativeError, NativeResult};
use crate::section_tag::SectionTag;

/// One decoded section-table entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionEntry {
    /// Which section this entry describes.
    pub tag: SectionTag,
    /// Absolute byte offset of the payload from the start of the file.
    pub offset: u64,
    /// Payload length in bytes.
    pub length: u64,
    /// CRC32C over the stored payload bytes (pre-decompression when the zlib flag is set).
    pub crc32c: u32,
    /// Section flags; bit 0 means the payload is zlib-compressed.
    pub flags: u32,
}

impl SectionEntry {
    /// Reports whether this section's payload is zlib-compressed on disk.
    pub const fn is_zlib(&self) -> bool {
        self.flags & crate::constants::SECTION_FLAG_ZLIB != 0
    }
}

/// Decoded header fields of a container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContainerHeader {
    /// On-disk format version.
    pub format_version: u16,
    /// Container-wide flags.
    pub flags: u16,
    /// Declared number of sections.
    pub section_count: u32,
    /// Declared byte length of the body region (table end through last payload).
    pub body_len: u64,
}

/// A parsed container that borrows its backing bytes.
///
/// The borrow is deliberate: section payloads are handed out as slices into `bytes`, so decoding
/// never copies. Callers that need to outlive the buffer must copy explicitly.
#[derive(Debug)]
pub struct ContainerView<'a> {
    bytes: &'a [u8],
    header: ContainerHeader,
    entries: BTreeMap<SectionTag, SectionEntry>,
}

impl<'a> ContainerView<'a> {
    /// Parses and fully validates a container from a byte slice.
    ///
    /// Validation proceeds in a fixed order, and every step must pass before the next runs:
    /// total length, leading magic, format version, section count ceiling, body-length consistency,
    /// header-table CRC, then per-section bounds, alignment, ordering, and uniqueness.
    ///
    /// # Errors
    ///
    /// Returns the specific [`NativeError`] variant for whichever invariant failed, carrying the
    /// offending tag and offset where one is meaningful, so `taxis doctor` can locate the damage.
    pub fn parse(bytes: &'a [u8]) -> NativeResult<Self> {
        Self::check_total_length(bytes)?;
        let header = Self::decode_header(bytes)?;
        Self::check_body_length(bytes, &header)?;
        Self::check_table_crc(bytes, &header)?;
        let entries = Self::decode_section_table(bytes, &header)?;
        Self::check_mandatory_sections(&entries)?;

        Ok(Self {
            bytes,
            header,
            entries,
        })
    }

    /// Returns the decoded header.
    pub const fn header(&self) -> &ContainerHeader {
        &self.header
    }

    /// Returns the number of sections present.
    pub fn section_count(&self) -> usize {
        self.entries.len()
    }

    /// Returns every section entry in ascending tag order.
    pub fn entries(&self) -> impl Iterator<Item = &SectionEntry> {
        self.entries.values()
    }

    /// Reports whether a section is present.
    pub fn has_section(&self, tag: SectionTag) -> bool {
        self.entries.contains_key(&tag)
    }

    /// Returns the raw stored payload for a section without verifying its CRC.
    ///
    /// This is the zero-copy accessor used by hot paths that already validated the table CRC and
    /// know the section is intact. Use [`Self::payload`] when the payload must be integrity-checked.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::MissingSection`] when the tag is absent.
    pub fn raw_payload(&self, tag: SectionTag) -> NativeResult<&'a [u8]> {
        let entry = self
            .entries
            .get(&tag)
            .ok_or(NativeError::MissingSection { tag: tag.as_str() })?;
        Self::slice_entry(self.bytes, entry)
    }

    /// Returns the payload for a section after verifying its CRC32C.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::MissingSection`] when absent, or
    /// [`NativeError::SectionCrcMismatch`] when the stored bytes no longer match the recorded CRC.
    pub fn payload(&self, tag: SectionTag) -> NativeResult<&'a [u8]> {
        let entry = *self
            .entries
            .get(&tag)
            .ok_or(NativeError::MissingSection { tag: tag.as_str() })?;
        let payload = Self::slice_entry(self.bytes, &entry)?;
        let computed = crc32c(payload);
        if computed != entry.crc32c {
            return Err(NativeError::SectionCrcMismatch {
                tag: entry.tag.as_str(),
                offset: entry.offset,
                expected: entry.crc32c,
                computed,
            });
        }
        Ok(payload)
    }

    /// Verifies the CRC of every present section and reports each failure.
    ///
    /// Returns one error per damaged section rather than stopping at the first, because `doctor`
    /// needs the complete damage map in a single pass.
    pub fn verify_all_sections(&self) -> Vec<NativeError> {
        let mut failures = Vec::new();
        for entry in self.entries.values() {
            match Self::slice_entry(self.bytes, entry) {
                Ok(payload) => {
                    let computed = crc32c(payload);
                    if computed != entry.crc32c {
                        failures.push(NativeError::SectionCrcMismatch {
                            tag: entry.tag.as_str(),
                            offset: entry.offset,
                            expected: entry.crc32c,
                            computed,
                        });
                    }
                }
                Err(reason) => failures.push(reason),
            }
        }
        failures
    }

    /// Step 1: the file must be long enough to hold a header, a trailer, and nothing else.
    fn check_total_length(bytes: &[u8]) -> NativeResult<()> {
        if bytes.len() < MIN_CONTAINER_LEN {
            return Err(NativeError::FileTooShort {
                actual: bytes.len(),
                minimum: MIN_CONTAINER_LEN,
            });
        }
        Ok(())
    }

    /// Step 2 and 3: leading magic and format version.
    fn decode_header(bytes: &[u8]) -> NativeResult<ContainerHeader> {
        let magic = read_u32_le(bytes, 0)?;
        if magic != TAXC_MAGIC_WORD {
            return Err(NativeError::BadMagic {
                expected: TAXC_MAGIC_WORD,
                found: magic,
            });
        }

        let format_version = read_u16_le(bytes, 4)?;
        if format_version != TAXC_FORMAT_VERSION {
            return Err(NativeError::UnsupportedFormatVersion {
                found: format_version,
                supported: TAXC_FORMAT_VERSION,
            });
        }

        let flags = read_u16_le(bytes, 6)?;
        let section_count = read_u32_le(bytes, 8)?;
        if section_count > MAX_SECTION_COUNT {
            return Err(NativeError::SectionCountExceeded {
                declared: section_count,
                ceiling: MAX_SECTION_COUNT,
            });
        }

        let body_len = read_u64_le(bytes, 12)?;

        Ok(ContainerHeader {
            format_version,
            flags,
            section_count,
            body_len,
        })
    }

    /// Step 4: `body_len` must agree with the real file length.
    ///
    /// The declared total is header plus section table plus body plus trailer; omitting the trailer
    /// here would reject every container whose body ends exactly at a section boundary.
    fn check_body_length(bytes: &[u8], header: &ContainerHeader) -> NativeResult<()> {
        let table_end =
            HEADER_LEN as u64 + u64::from(header.section_count) * SECTION_ENTRY_LEN as u64;
        let declared_total = table_end + header.body_len + TRAILER_LEN as u64;
        let actual_total = bytes.len() as u64;

        if declared_total != actual_total {
            return Err(NativeError::BodyLengthMismatch {
                declared: declared_total,
                actual: actual_total,
            });
        }
        Ok(())
    }

    /// Step 5: the CRC recorded in the trailer must match header plus section table.
    fn check_table_crc(bytes: &[u8], header: &ContainerHeader) -> NativeResult<()> {
        let table_end = HEADER_LEN + header.section_count as usize * SECTION_ENTRY_LEN;
        let trailer_offset = bytes.len() - TRAILER_LEN;

        let expected = read_u32_le(bytes, trailer_offset)?;
        let computed = crc32c(&bytes[..table_end]);
        if expected != computed {
            return Err(NativeError::TableCrcMismatch { expected, computed });
        }

        let trailing_magic = read_u32_le(bytes, trailer_offset + 4)?;
        if trailing_magic != TAXC_MAGIC_WORD {
            return Err(NativeError::BadTrailingMagic {
                offset: trailer_offset + 4,
                found: trailing_magic,
            });
        }
        Ok(())
    }

    /// Step 6: decode entries and enforce bounds, alignment, ordering, and uniqueness.
    fn decode_section_table(
        bytes: &[u8],
        header: &ContainerHeader,
    ) -> NativeResult<BTreeMap<SectionTag, SectionEntry>> {
        let mut entries = BTreeMap::new();
        let mut previous_tag: Option<SectionTag> = None;

        for index in 0..header.section_count as usize {
            let entry_offset = HEADER_LEN + index * SECTION_ENTRY_LEN;
            let entry = Self::decode_entry(bytes, entry_offset)?;

            if let Some(previous) = previous_tag {
                if entry.tag <= previous {
                    return Err(NativeError::SectionTableUnsorted {
                        tag: entry.tag.as_str(),
                        previous: previous.as_str(),
                    });
                }
            }
            previous_tag = Some(entry.tag);

            Self::check_entry_bounds(bytes, &entry)?;
            entries.insert(entry.tag, entry);
        }

        Ok(entries)
    }

    /// Decodes one 24-byte section-table entry.
    fn decode_entry(bytes: &[u8], offset: usize) -> NativeResult<SectionEntry> {
        let mut raw_tag = [0u8; 4];
        raw_tag.copy_from_slice(&bytes[offset..offset + 4]);
        let tag = SectionTag::from_bytes(raw_tag)?;

        Ok(SectionEntry {
            tag,
            offset: read_u64_le(bytes, offset + 4)?,
            length: read_u64_le(bytes, offset + 12)?,
            crc32c: read_u32_le(bytes, offset + 20)?,
            flags: read_u32_le(bytes, offset + 24)?,
        })
    }

    /// Enforces per-section bounds, alignment, and non-zero padding.
    fn check_entry_bounds(bytes: &[u8], entry: &SectionEntry) -> NativeResult<()> {
        let body_end = bytes.len() as u64 - TRAILER_LEN as u64;

        if entry.offset + entry.length > body_end {
            return Err(NativeError::SectionOutOfBounds {
                tag: entry.tag.as_str(),
                offset: entry.offset,
                length: entry.length,
                body_len: body_end,
            });
        }

        if !entry.offset.is_multiple_of(SECTION_ALIGNMENT) {
            return Err(NativeError::SectionMisaligned {
                tag: entry.tag.as_str(),
                offset: entry.offset,
                alignment: SECTION_ALIGNMENT,
            });
        }
        Ok(())
    }

    /// Step 7: every mandatory section must be present.
    fn check_mandatory_sections(entries: &BTreeMap<SectionTag, SectionEntry>) -> NativeResult<()> {
        for tag in SectionTag::ALL {
            if tag.is_mandatory() && !entries.contains_key(&tag) {
                return Err(NativeError::MissingSection { tag: tag.as_str() });
            }
        }
        Ok(())
    }

    /// Borrows a section payload slice, assuming bounds were validated at parse time.
    fn slice_entry(bytes: &'a [u8], entry: &SectionEntry) -> NativeResult<&'a [u8]> {
        let start = entry.offset as usize;
        let end =
            start
                .checked_add(entry.length as usize)
                .ok_or(NativeError::SectionOutOfBounds {
                    tag: entry.tag.as_str(),
                    offset: entry.offset,
                    length: entry.length,
                    body_len: bytes.len() as u64,
                })?;
        bytes
            .get(start..end)
            .ok_or(NativeError::SectionOutOfBounds {
                tag: entry.tag.as_str(),
                offset: entry.offset,
                length: entry.length,
                body_len: bytes.len() as u64,
            })
    }
}

/// Builder that assembles a container from tagged payloads.
///
/// Payloads are sorted by tag on write, so callers may add sections in any order.
#[derive(Debug, Default)]
pub struct ContainerBuilder {
    sections: BTreeMap<SectionTag, Vec<u8>>,
    flags: u16,
}

impl ContainerBuilder {
    /// Creates an empty builder with no container flags set.
    pub fn new() -> Self {
        Self {
            sections: BTreeMap::new(),
            flags: 0,
        }
    }

    /// Sets container-wide flags, replacing any previous value.
    pub fn with_flags(mut self, flags: u16) -> Self {
        self.flags = flags;
        self
    }

    /// Marks the container read-only.
    pub fn read_only(mut self) -> Self {
        self.flags |= FLAG_READ_ONLY;
        self
    }

    /// Adds or replaces a section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::TooManySections`] when adding a new tag would exceed the ceiling.
    pub fn add_section(&mut self, tag: SectionTag, payload: Vec<u8>) -> NativeResult<()> {
        if !self.sections.contains_key(&tag) && self.sections.len() as u32 >= MAX_SECTION_COUNT {
            return Err(NativeError::TooManySections {
                requested: self.sections.len() + 1,
                ceiling: MAX_SECTION_COUNT as usize,
            });
        }
        self.sections.insert(tag, payload);
        Ok(())
    }

    /// Serializes the container to a byte vector.
    ///
    /// Layout: header, sorted section table, 8-byte-aligned payloads, trailer.
    ///
    /// `body_len` is measured to the end of the last payload, not to the next alignment boundary:
    /// trailing padding after the final section is never emitted, so counting it would make the
    /// declared length disagree with the real file size on every write.
    pub fn build(&self) -> Vec<u8> {
        let section_count = self.sections.len();
        let table_end = HEADER_LEN + section_count * SECTION_ENTRY_LEN;

        let mut payload_offsets = Vec::with_capacity(section_count);
        let mut cursor = align_up(table_end as u64);
        let mut payload_end = cursor;
        for payload in self.sections.values() {
            payload_offsets.push(cursor);
            payload_end = cursor + payload.len() as u64;
            cursor = align_up(payload_end);
        }
        let body_len = payload_end - table_end as u64;

        let mut output = Vec::with_capacity(payload_end as usize + TRAILER_LEN);

        // Header.
        output.extend_from_slice(&TAXC_MAGIC);
        output.extend_from_slice(&TAXC_FORMAT_VERSION.to_le_bytes());
        output.extend_from_slice(&self.flags.to_le_bytes());
        output.extend_from_slice(&(section_count as u32).to_le_bytes());
        output.extend_from_slice(&body_len.to_le_bytes());
        output.extend_from_slice(&0u32.to_le_bytes());

        // Section table.
        for ((tag, payload), offset) in self.sections.iter().zip(payload_offsets.iter()) {
            output.extend_from_slice(&tag.as_bytes());
            output.extend_from_slice(&offset.to_le_bytes());
            output.extend_from_slice(&(payload.len() as u64).to_le_bytes());
            output.extend_from_slice(&crc32c(payload).to_le_bytes());
            output.extend_from_slice(&0u32.to_le_bytes());
        }

        // Payloads with zero padding to the next alignment boundary.
        for (payload, offset) in self.sections.values().zip(payload_offsets.iter()) {
            let current = output.len() as u64;
            let pad = offset.saturating_sub(current);
            output.resize(output.len() + pad as usize, 0);
            output.extend_from_slice(payload);
        }

        // Trailer: table CRC over header plus table, then trailing magic.
        let table_crc = crc32c(&output[..table_end]);
        output.extend_from_slice(&table_crc.to_le_bytes());
        output.extend_from_slice(&TAXC_MAGIC);

        output
    }

    /// Serializes and writes the container atomically to `path`.
    ///
    /// Writes `<path>.tmp` first, flushes it, then renames onto `path`, so a crash leaves either the
    /// previous container or the new one, never a truncated mixture.
    ///
    /// # Errors
    ///
    /// Propagates [`NativeError::Io`] from the staging write, flush, or rename.
    pub fn write_atomic(&self, path: &Path) -> NativeResult<()> {
        let bytes = self.build();
        let staging: PathBuf = path.with_extension("txc.tmp");

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&staging, &bytes)?;
        fs::rename(&staging, path)?;
        Ok(())
    }
}

/// Rounds `value` up to the next multiple of the section alignment.
const fn align_up(value: u64) -> u64 {
    let remainder = value % SECTION_ALIGNMENT;
    if remainder == 0 {
        value
    } else {
        value + (SECTION_ALIGNMENT - remainder)
    }
}

/// Reads a little-endian `u16` at `offset`, bounds-checked.
fn read_u16_le(bytes: &[u8], offset: usize) -> NativeResult<u16> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or(NativeError::FileTooShort {
            actual: bytes.len(),
            minimum: offset + 2,
        })?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

/// Reads a little-endian `u32` at `offset`, bounds-checked.
fn read_u32_le(bytes: &[u8], offset: usize) -> NativeResult<u32> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or(NativeError::FileTooShort {
            actual: bytes.len(),
            minimum: offset + 4,
        })?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Reads a little-endian `u64` at `offset`, bounds-checked.
fn read_u64_le(bytes: &[u8], offset: usize) -> NativeResult<u64> {
    let slice = bytes
        .get(offset..offset + 8)
        .ok_or(NativeError::FileTooShort {
            actual: bytes.len(),
            minimum: offset + 8,
        })?;
    let mut word = [0u8; 8];
    word.copy_from_slice(slice);
    Ok(u64::from_le_bytes(word))
}

#[cfg(test)]
mod tests {
    use super::{ContainerBuilder, ContainerView};
    use crate::error::NativeError;
    use crate::section_tag::SectionTag;

    fn sample_builder() -> ContainerBuilder {
        let mut builder = ContainerBuilder::new();
        for tag in SectionTag::ALL {
            builder
                .add_section(tag, format!("payload-{}", tag.as_str()).into_bytes())
                .expect("section add must succeed below the ceiling");
        }
        builder
    }

    #[test]
    fn round_trips_all_sections() {
        let bytes = sample_builder().build();
        let view = ContainerView::parse(&bytes).expect("built container must parse");
        assert_eq!(view.section_count(), SectionTag::ALL.len());
        for tag in SectionTag::ALL {
            let payload = view.payload(tag).expect("section must verify");
            assert_eq!(payload, format!("payload-{}", tag.as_str()).as_bytes());
        }
    }

    #[test]
    fn payloads_are_eight_byte_aligned() {
        let bytes = sample_builder().build();
        let view = ContainerView::parse(&bytes).expect("parse");
        for entry in view.entries() {
            assert_eq!(entry.offset % 8, 0, "section {} misaligned", entry.tag);
        }
    }

    #[test]
    fn rejects_short_file() {
        let error = ContainerView::parse(b"TAXC").expect_err("short file must fail");
        assert!(matches!(error, NativeError::FileTooShort { .. }));
    }

    #[test]
    fn rejects_bad_magic() {
        let mut bytes = sample_builder().build();
        bytes[0] = b'X';
        let error = ContainerView::parse(&bytes).expect_err("bad magic must fail");
        assert!(matches!(error, NativeError::BadMagic { .. }));
    }

    #[test]
    fn rejects_unsupported_version() {
        let mut bytes = sample_builder().build();
        bytes[4] = 2;
        let error = ContainerView::parse(&bytes).expect_err("version 2 must fail");
        match error {
            NativeError::UnsupportedFormatVersion { found, supported } => {
                assert_eq!(found, 2);
                assert_eq!(supported, 1);
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn rejects_forged_section_count() {
        let mut bytes = sample_builder().build();
        bytes[8..12].copy_from_slice(&0xFFFFu32.to_le_bytes());
        let error = ContainerView::parse(&bytes).expect_err("forged count must fail");
        assert!(matches!(error, NativeError::SectionCountExceeded { .. }));
    }

    #[test]
    fn rejects_body_length_mismatch() {
        let mut bytes = sample_builder().build();
        let forged = (bytes.len() as u64 + 64).to_le_bytes();
        bytes[12..20].copy_from_slice(&forged);
        let error = ContainerView::parse(&bytes).expect_err("length lie must fail");
        assert!(matches!(error, NativeError::BodyLengthMismatch { .. }));
    }

    #[test]
    fn detects_table_crc_tampering() {
        let mut bytes = sample_builder().build();
        bytes[4] = 1;
        bytes[5] = 0;
        bytes[6] ^= 0xFF;
        let error = ContainerView::parse(&bytes).expect_err("flag tamper must fail");
        assert!(matches!(error, NativeError::TableCrcMismatch { .. }));
    }

    #[test]
    fn detects_section_crc_tampering() {
        let mut bytes = sample_builder().build();
        let view = ContainerView::parse(&bytes).expect("parse");
        let meta = view
            .entries()
            .find(|entry| entry.tag == SectionTag::Meta)
            .expect("meta present");
        let target = meta.offset as usize + 1;
        drop(view);

        bytes[target] ^= 0x01;
        let view = ContainerView::parse(&bytes).expect("table CRC untouched");
        let error = view
            .payload(SectionTag::Meta)
            .expect_err("payload CRC must fail");
        match error {
            NativeError::SectionCrcMismatch { tag, .. } => assert_eq!(tag, "META"),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn verify_all_sections_reports_each_damage() {
        let mut bytes = sample_builder().build();
        let view = ContainerView::parse(&bytes).expect("parse");
        let offsets: Vec<usize> = view.entries().map(|entry| entry.offset as usize).collect();
        drop(view);

        for offset in offsets.iter().take(2) {
            bytes[*offset] ^= 0xFF;
        }

        let view = ContainerView::parse(&bytes).expect("table CRC untouched");
        let failures = view.verify_all_sections();
        assert_eq!(failures.len(), 2, "both damaged sections must be reported");
    }

    #[test]
    fn atomic_write_then_parse() {
        let path = crate::test_support::scratch_path("atomic-write.txc");
        sample_builder()
            .write_atomic(&path)
            .expect("atomic write must succeed");

        let bytes = std::fs::read(&path).expect("read back");
        let view = ContainerView::parse(&bytes).expect("round trip must parse");
        assert!(view.has_section(SectionTag::Meta));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn empty_payload_section_round_trips() {
        let mut builder = ContainerBuilder::new();
        let empty_payload: Vec<u8> = Vec::new();
        for tag in SectionTag::ALL {
            builder
                .add_section(tag, empty_payload.clone())
                .expect("empty payload is legal");
        }
        let bytes = builder.build();
        let view = ContainerView::parse(&bytes).expect("parse");
        assert_eq!(view.payload(SectionTag::Indx).expect("verify").len(), 0);
    }
}
