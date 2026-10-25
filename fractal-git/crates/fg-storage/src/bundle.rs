//! Module: fg-storage::bundle — Canonical Git Bundle v2/v3 Serialization Engine
//! File Path: crates/fg-storage/src/bundle.rs
//! Architecture Role: Encodes and verifies Git Bundle v2 transport containers:
//!   `# v2 git bundle` magic, prerequisite lines, reference dictionary, and embedded Packfile v2 stream.
//! Dependencies & Triggers: Consumed by `taxis bundle` CLI and cross-system sync routines.
//! Responsibilities: Bundle header serialization, reference table formatting, packfile stream embedding,
//!   and bundle structural verification.
//! Exit Semantics & Design Rationale:
//!   - Git Bundle v2 Specification compliance: compatible with standard `git bundle verify` and `git clone <bundle>`.
//!   - Zero-allocation streaming: streams embedded packfile directly into target writer.
//!
//! Domain Governance Rules: FGT-STO-001 (storage containers), FGT-TRN-001 (bundle transport parity).

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

use fg_algorithms::pack::PackDeltaChain;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use sha1::{Digest, Sha1};

use crate::backends::pack_writer::PackWriter;

/// Header magic for Git Bundle version 2.
pub const BUNDLE_V2_MAGIC: &str = "# v2 git bundle";

/// Parsed metadata from a Git Bundle header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleHeader {
    /// Bundle format version (typically 2).
    pub version: u32,
    /// Commits required in the destination repository before bundle can be applied.
    ///
    /// Git writes an informational subject after each prerequisite id; it is not part of the
    /// bundle contract, so parsing keeps only the object ids.
    pub prerequisites: Vec<Oid>,
    /// Reference table: (Commit OID, reference name).
    pub references: Vec<(Oid, String)>,
    /// Number of objects contained in the embedded packfile.
    pub pack_object_count: u32,
    /// Byte offset where the packfile payload begins.
    pub pack_offset: u64,
}

/// Statistics from creating a bundle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleReport {
    pub ref_count: usize,
    pub prereq_count: usize,
    pub object_count: usize,
    pub pack_checksum: Oid,
}

/// Git bundle creation and inspection engine.
pub struct BundleEngine;

impl BundleEngine {
    /// Creates a Git Bundle v2 file stream.
    ///
    /// A prerequisite entry carries the informational subject Git itself writes after the object
    /// id (`-<oid> <subject>`). Git accepts a bare `-<oid>` line too, so an empty subject is
    /// written without a trailing separator instead of as a dangling space.
    pub fn write_bundle<W: Write>(
        writer: &mut W,
        prerequisites: &[(Oid, String)],
        references: &[(Oid, String)],
        objects: &[PackDeltaChain],
    ) -> FractalResult<BundleReport> {
        if references.is_empty() {
            return Err(FractalError::PolicyViolation(
                "Cannot create a bundle with zero references".into(),
            ));
        }

        // 1. Write Header Magic
        writeln!(writer, "{BUNDLE_V2_MAGIC}")?;

        // 2. Write Prerequisites: "-<OID> [<subject>]\n"
        for (prereq_oid, subject) in prerequisites {
            let prereq_hex = prereq_oid.to_hex();
            if subject.is_empty() {
                writeln!(writer, "-{prereq_hex}")?;
            } else {
                writeln!(writer, "-{prereq_hex} {subject}")?;
            }
        }

        // 3. Write References: "<OID> <refname>\n"
        for (oid, ref_name) in references {
            writeln!(writer, "{} {}", oid.to_hex(), ref_name)?;
        }

        // 4. Header Terminator (blank line)
        writeln!(writer)?;

        // 5. Embedded Packfile v2 Stream
        let (pack_checksum, _entries) = PackWriter::write_pack(objects, writer)?;

        Ok(BundleReport {
            ref_count: references.len(),
            prereq_count: prerequisites.len(),
            object_count: objects.len(),
            pack_checksum,
        })
    }

    /// Parses and verifies a Git Bundle header from a readable/seekable stream.
    pub fn read_header<R: Read + Seek>(reader: &mut R) -> FractalResult<BundleHeader> {
        reader.seek(SeekFrom::Start(0))?;

        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();

        // 1. Verify First Line
        buf_reader.read_line(&mut line)?;
        let trimmed_first = line.trim_end();
        if trimmed_first != BUNDLE_V2_MAGIC {
            return Err(FractalError::CorruptStore(format!(
                "Invalid bundle magic: expected '{BUNDLE_V2_MAGIC}', got '{trimmed_first}'"
            )));
        }

        let mut prerequisites = Vec::new();
        let mut references = Vec::new();

        let mut pack_offset = line.len() as u64;

        // 2. Read prerequisites and references until empty line
        loop {
            line.clear();
            let bytes_read = buf_reader.read_line(&mut line)?;
            if bytes_read == 0 {
                return Err(FractalError::CorruptStore(
                    "Unexpected EOF reading bundle header".into(),
                ));
            }
            pack_offset += bytes_read as u64;

            let trimmed = line.trim();
            if trimmed.is_empty() {
                // Header finished
                break;
            }

            if let Some(prereq_hex) = trimmed.strip_prefix('-') {
                let oid_hex = prereq_hex.split_whitespace().next().unwrap_or(prereq_hex);
                let oid = Oid::from_hex(oid_hex).map_err(|e| {
                    FractalError::CorruptStore(format!("Invalid prerequisite OID '{oid_hex}': {e}"))
                })?;
                prerequisites.push(oid);
            } else {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() < 2 {
                    return Err(FractalError::CorruptStore(format!(
                        "Invalid bundle reference entry '{trimmed}'"
                    )));
                }
                let oid = Oid::from_hex(parts[0]).map_err(|e| {
                    FractalError::CorruptStore(format!("Invalid ref OID '{}': {e}", parts[0]))
                })?;
                let ref_name = parts[1].to_string();
                references.push((oid, ref_name));
            }
        }

        // 3. Inspect Embedded Packfile Header (12 bytes)
        let underlying = buf_reader.into_inner();
        underlying.seek(SeekFrom::Start(pack_offset))?;

        let mut pack_hdr = [0u8; 12];
        underlying.read_exact(&mut pack_hdr)?;

        if &pack_hdr[..4] != b"PACK" {
            return Err(FractalError::CorruptStore(
                "Missing 'PACK' signature in embedded bundle packfile".into(),
            ));
        }

        let pack_version = u32::from_be_bytes(pack_hdr[4..8].try_into().unwrap_or_default());
        if pack_version != 2 {
            return Err(FractalError::CorruptStore(format!(
                "Unsupported pack version {pack_version} in bundle"
            )));
        }

        let pack_object_count = u32::from_be_bytes(pack_hdr[8..12].try_into().unwrap_or_default());

        Ok(BundleHeader {
            version: 2,
            prerequisites,
            references,
            pack_object_count,
            pack_offset,
        })
    }

    /// Verifies the embedded packfile checksum in a bundle stream.
    pub fn verify_pack_checksum<R: Read + Seek>(
        reader: &mut R,
        pack_offset: u64,
    ) -> FractalResult<Oid> {
        let file_len = reader.seek(SeekFrom::End(0))?;
        if file_len < pack_offset + 32 {
            return Err(FractalError::CorruptStore(
                "Bundle file too short for valid packfile payload".into(),
            ));
        }

        let pack_len = file_len - pack_offset;
        let pack_data_len = pack_len - 20; // Excluding trailing 20-byte SHA-1

        reader.seek(SeekFrom::Start(pack_offset))?;

        let mut hasher = Sha1::new();
        let mut buffer = [0u8; 65536];
        let mut remaining = pack_data_len;

        while remaining > 0 {
            let to_read = (remaining as usize).min(buffer.len());
            reader.read_exact(&mut buffer[..to_read])?;
            hasher.update(&buffer[..to_read]);
            remaining -= to_read as u64;
        }

        let calculated_hash = hasher.finalize();
        let mut calc_bytes = [0u8; 20];
        calc_bytes.copy_from_slice(&calculated_hash);

        let mut recorded_hash = [0u8; 20];
        reader.read_exact(&mut recorded_hash)?;

        if calc_bytes != recorded_hash {
            return Err(FractalError::HashMismatch {
                expected: Oid::from_bytes(recorded_hash).to_hex(),
                actual: Oid::from_bytes(calc_bytes).to_hex(),
            });
        }

        Ok(Oid::from_bytes(recorded_hash))
    }
}
