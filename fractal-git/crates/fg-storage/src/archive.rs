//! Module: fg-storage::archive — Streaming Worktree Archive Generator (Tar / Tar.gz / Zip)
//! File Path: crates/fg-storage/src/archive.rs
//! Architecture Role: Streams unmaterialized git tree contents directly from ODB blobs into
//!   standard Tar, Tar.gz, or Zip archives without allocating intermediate disk files.
//! Dependencies & Triggers: Consumed by `taxis archive` CLI.
//! Responsibilities: UStar Tar header encoding, Deflate/Store Zip container generation,
//!   streaming ODB payload compression, and deterministic timestamp injection.
//! Exit Semantics & Design Rationale:
//!   - Zero worktree disk footprint: streams straight from storage memory/disk objects to target output.
//!   - Reuses IEEE 802.3 CRC32 from pack_writer for bit-exact Zip checksums.
//!   - Supports optional `--prefix <prefix>/` path prefixes.
//!
//! Domain Governance Rules: FGT-STO-001 (storage streaming), FGT-PRF-001 (zero transient disk alloc).

use std::io::Write;

use flate2::write::{DeflateEncoder, GzEncoder};
use flate2::Compression;

use fg_core::error::FractalResult;

use crate::backends::pack_writer::crc32_ieee;

/// Supported archive packaging formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveFormat {
    Tar,
    TarGz,
    Zip,
}

impl ArchiveFormat {
    /// Parses format from string option or file extension.
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "tar" => Some(Self::Tar),
            "tar.gz" | "tgz" => Some(Self::TarGz),
            "zip" => Some(Self::Zip),
            _ => None,
        }
    }
}

/// One entry to package in an archive.
#[derive(Debug, Clone)]
pub struct ArchiveEntry {
    /// Relative path inside the archive.
    pub path: String,
    /// POSIX file mode (e.g. 0o100644 or 0o100755).
    pub mode: u32,
    /// Modification timestamp in seconds since Unix epoch.
    pub mtime: i64,
    /// Raw uncompressed file payload.
    pub payload: Vec<u8>,
}

/// Writes POSIX UStar tar archives.
pub struct TarWriter<W: Write> {
    writer: W,
}

impl<W: Write> TarWriter<W> {
    /// Creates a new TarWriter wrapping the target byte stream.
    pub fn new(writer: W) -> Self {
        Self { writer }
    }

    /// Appends a file entry to the tar archive.
    pub fn append_file(
        &mut self,
        name: &str,
        mode: u32,
        mtime: i64,
        payload: &[u8],
    ) -> FractalResult<()> {
        let mut header = [0u8; 512];

        // Format name (truncate if > 100 bytes without prefix)
        let name_bytes = name.as_bytes();
        let name_len = name_bytes.len().min(100);
        header[..name_len].copy_from_slice(&name_bytes[..name_len]);

        // Mode: 8 bytes octal (e.g. "0000644\0")
        let octal_mode = format!("{:06o}\0 ", mode & 0o7777);
        header[100..108].copy_from_slice(octal_mode.as_bytes());

        // UID / GID: 8 bytes octal
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");

        // Size: 12 bytes octal (e.g. "00000000123 ")
        let octal_size = format!("{:011o} ", payload.len());
        header[124..136].copy_from_slice(octal_size.as_bytes());

        // Mtime: 12 bytes octal
        let octal_time = format!("{:011o} ", mtime.max(0));
        header[136..148].copy_from_slice(octal_time.as_bytes());

        // Checksum field reservation (8 spaces per POSIX tar specification)
        header[148..156].copy_from_slice(b"        ");

        // Typeflag: '0' for regular file
        header[156] = b'0';

        // Magic: "ustar\0"
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");

        // Uname / Gname
        header[265..270].copy_from_slice(b"taxis");
        header[297..302].copy_from_slice(b"taxis");

        // Calculate checksum: sum of unsigned bytes
        let mut chksum: u32 = 0;
        for &byte in &header {
            chksum += u32::from(byte);
        }

        let octal_chksum = format!("{:06o}\0 ", chksum);
        header[148..156].copy_from_slice(octal_chksum.as_bytes());

        // Write header
        self.writer.write_all(&header)?;

        // Write payload
        self.writer.write_all(payload)?;

        // Pad to 512-byte boundary
        let pad_len = (512 - (payload.len() % 512)) % 512;
        if pad_len > 0 {
            let padding = [0u8; 512];
            self.writer.write_all(&padding[..pad_len])?;
        }

        Ok(())
    }

    /// Writes the closing 1024-byte zero block to finish the tar archive.
    pub fn finish(mut self) -> FractalResult<W> {
        let trailer = [0u8; 1024];
        self.writer.write_all(&trailer)?;
        self.writer.flush()?;
        Ok(self.writer)
    }
}

/// Metadata stored for Zip Central Directory construction.
struct ZipDirectoryEntry {
    name: String,
    mode: u32,
    mtime: i64,
    crc32: u32,
    compressed_size: u32,
    uncompressed_size: u32,
    local_header_offset: u32,
}

/// Writes standard PKZip format archives.
pub struct ZipWriter<W: Write> {
    writer: W,
    current_offset: u32,
    entries: Vec<ZipDirectoryEntry>,
}

impl<W: Write> ZipWriter<W> {
    /// Creates a new ZipWriter wrapping the target byte stream.
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            current_offset: 0,
            entries: Vec::new(),
        }
    }

    /// Appends a deflated file entry to the zip archive.
    pub fn append_file(
        &mut self,
        name: &str,
        mode: u32,
        mtime: i64,
        payload: &[u8],
    ) -> FractalResult<()> {
        let local_offset = self.current_offset;
        let crc = crc32_ieee(payload);

        // Compress payload using Deflate
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(payload)?;
        let compressed_bytes = encoder.finish()?;

        let comp_size = compressed_bytes.len() as u32;
        let uncomp_size = payload.len() as u32;
        let name_bytes = name.as_bytes();
        let name_len = name_bytes.len() as u16;

        // DOS timestamp: (time, date)
        let (dos_time, dos_date) = unix_to_dos_time(mtime);

        // 1. Local File Header (30 bytes + name)
        let mut header = Vec::with_capacity(30 + name_bytes.len());
        header.extend_from_slice(&0x04034b50u32.to_le_bytes()); // Local file header signature
        header.extend_from_slice(&20u16.to_le_bytes()); // Version needed (2.0)
        header.extend_from_slice(&0u16.to_le_bytes()); // General purpose flag
        header.extend_from_slice(&8u16.to_le_bytes()); // Compression method (8 = Deflate)
        header.extend_from_slice(&dos_time.to_le_bytes());
        header.extend_from_slice(&dos_date.to_le_bytes());
        header.extend_from_slice(&crc.to_le_bytes());
        header.extend_from_slice(&comp_size.to_le_bytes());
        header.extend_from_slice(&uncomp_size.to_le_bytes());
        header.extend_from_slice(&name_len.to_le_bytes());
        header.extend_from_slice(&0u16.to_le_bytes()); // Extra field length
        header.extend_from_slice(name_bytes);

        self.writer.write_all(&header)?;
        self.writer.write_all(&compressed_bytes)?;

        let bytes_written = (header.len() + compressed_bytes.len()) as u32;
        self.current_offset += bytes_written;

        self.entries.push(ZipDirectoryEntry {
            name: name.to_string(),
            mode,
            mtime,
            crc32: crc,
            compressed_size: comp_size,
            uncompressed_size: uncomp_size,
            local_header_offset: local_offset,
        });

        Ok(())
    }

    /// Writes the Central Directory and End of Central Directory record.
    pub fn finish(mut self) -> FractalResult<W> {
        let cd_offset = self.current_offset;
        let mut cd_size: u32 = 0;

        for entry in &self.entries {
            let name_bytes = entry.name.as_bytes();
            let name_len = name_bytes.len() as u16;
            let (dos_time, dos_date) = unix_to_dos_time(entry.mtime);

            // POSIX permissions in top 16 bits of external attributes
            let external_attr = (entry.mode << 16) | 0o100000;

            let mut cd_record = Vec::with_capacity(46 + name_bytes.len());
            cd_record.extend_from_slice(&0x02014b50u32.to_le_bytes()); // Central directory signature
            cd_record.extend_from_slice(&0x0314u16.to_le_bytes()); // Version made by (Unix, 2.0)
            cd_record.extend_from_slice(&20u16.to_le_bytes()); // Version needed (2.0)
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Flags
            cd_record.extend_from_slice(&8u16.to_le_bytes()); // Deflate
            cd_record.extend_from_slice(&dos_time.to_le_bytes());
            cd_record.extend_from_slice(&dos_date.to_le_bytes());
            cd_record.extend_from_slice(&entry.crc32.to_le_bytes());
            cd_record.extend_from_slice(&entry.compressed_size.to_le_bytes());
            cd_record.extend_from_slice(&entry.uncompressed_size.to_le_bytes());
            cd_record.extend_from_slice(&name_len.to_le_bytes());
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Extra field length
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Comment length
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Disk number start
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Internal file attr
            cd_record.extend_from_slice(&external_attr.to_le_bytes()); // External file attr
            cd_record.extend_from_slice(&entry.local_header_offset.to_le_bytes());
            cd_record.extend_from_slice(name_bytes);

            self.writer.write_all(&cd_record)?;
            cd_size += cd_record.len() as u32;
        }

        let entry_count = self.entries.len() as u16;

        // End of Central Directory record (22 bytes)
        let mut eocd = Vec::with_capacity(22);
        eocd.extend_from_slice(&0x06054b50u32.to_le_bytes()); // EOCD signature
        eocd.extend_from_slice(&0u16.to_le_bytes()); // Disk number
        eocd.extend_from_slice(&0u16.to_le_bytes()); // Start disk
        eocd.extend_from_slice(&entry_count.to_le_bytes()); // Entries on this disk
        eocd.extend_from_slice(&entry_count.to_le_bytes()); // Total entries
        eocd.extend_from_slice(&cd_size.to_le_bytes()); // Size of CD
        eocd.extend_from_slice(&cd_offset.to_le_bytes()); // Offset of CD
        eocd.extend_from_slice(&0u16.to_le_bytes()); // Comment length

        self.writer.write_all(&eocd)?;
        self.writer.flush()?;

        Ok(self.writer)
    }
}

/// Converts Unix timestamp (seconds) into MS-DOS (time, date) tuple.
fn unix_to_dos_time(secs: i64) -> (u16, u16) {
    if secs <= 0 {
        return (0, 0x0021); // Jan 1, 1980
    }

    let dt = chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap_or_default());
    use chrono::Datelike;
    use chrono::Timelike;

    let year = dt.year().clamp(1980, 2107) as u16;
    let month = dt.month() as u16;
    let day = dt.day() as u16;
    let hour = dt.hour() as u16;
    let min = dt.minute() as u16;
    let sec = (dt.second() / 2) as u16;

    let dos_time = (hour << 11) | (min << 5) | sec;
    let dos_date = ((year - 1980) << 9) | (month << 5) | day;

    (dos_time, dos_date)
}

/// High-level archive packaging orchestrator.
pub struct ArchiveGenerator;

impl ArchiveGenerator {
    /// Streams entries into the requested archive format.
    pub fn write_archive<W: Write>(
        format: ArchiveFormat,
        prefix: Option<&str>,
        entries: &[ArchiveEntry],
        writer: W,
    ) -> FractalResult<()> {
        let pfx = prefix.unwrap_or("");

        match format {
            ArchiveFormat::Tar => {
                let mut tar = TarWriter::new(writer);
                for entry in entries {
                    let entry_name = format!("{}{}", pfx, entry.path);
                    tar.append_file(&entry_name, entry.mode, entry.mtime, &entry.payload)?;
                }
                tar.finish()?;
            }
            ArchiveFormat::TarGz => {
                let gz = GzEncoder::new(writer, Compression::default());
                let mut tar = TarWriter::new(gz);
                for entry in entries {
                    let entry_name = format!("{}{}", pfx, entry.path);
                    tar.append_file(&entry_name, entry.mode, entry.mtime, &entry.payload)?;
                }
                let gz_writer = tar.finish()?;
                gz_writer.finish()?;
            }
            ArchiveFormat::Zip => {
                let mut zip = ZipWriter::new(writer);
                for entry in entries {
                    let entry_name = format!("{}{}", pfx, entry.path);
                    zip.append_file(&entry_name, entry.mode, entry.mtime, &entry.payload)?;
                }
                zip.finish()?;
            }
        }

        Ok(())
    }
}
