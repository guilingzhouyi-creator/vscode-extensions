//! Module: fg-storage — In-Place TAR & TAR.GZ Extractor
//! File Path: crates/fg-storage/src/in_place/tar_extractor.rs
//! Architecture Role: Implements reverse tail-truncation for uncompressed Tar and forward
//!   stream hole-punching for Gzip-compressed Tar (.tar.gz).
//!   Also exposes non-destructive standard extraction for read-only callers.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-PRF-001, FGT-COR-001.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use fg_algorithms::space_plan::{
    simulate_space_plan, ExtractionUnit, SpacePlanConfig, SpacePlanReport,
};
use fg_core::error::{FractalError, FractalResult};
use flate2::read::GzDecoder;

use crate::in_place::hole_puncher::HolePuncher;
use crate::in_place::journal::{InPlaceJournal, InPlaceLogEntry};
use crate::in_place::tail_truncator::TailTruncator;
use crate::in_place::zip_extractor::{sanitize_relative_path, InPlaceExtractionReport};

/// Size of a fixed-layout UStar header block, in bytes.
const TAR_BLOCK_SIZE: usize = 512;

/// Gzip stream magic bytes (0x1f, 0x8b) used for suffix-independent format detection.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Description of an indexed Tar archive member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TarMember {
    /// Relative path inside the tar archive.
    pub name: String,
    /// Absolute byte offset of the 512-byte header block from file start.
    pub header_offset: u64,
    /// Payload byte size.
    pub size: u64,
    /// Total block size including 512-byte header and 512-byte alignment padding.
    pub total_span: u64,
    /// POSIX file mode.
    pub mode: u32,
    /// Modification timestamp.
    pub mtime: i64,
    /// Whether this entry is a directory.
    pub is_dir: bool,
}

/// Helper function to parse null/space-terminated octal numbers in tar headers.
pub fn parse_tar_octal(octal_bytes: &[u8]) -> Option<u64> {
    let raw_str = std::str::from_utf8(octal_bytes).ok()?;
    let trimmed = raw_str.trim_matches(|c: char| c == '\0' || c.is_whitespace());
    if trimmed.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(trimmed, 8).ok()
}

/// Fixed-layout UStar fields shared by on-disk indexing and in-memory stream extraction.
struct TarHeaderFields {
    /// Relative path inside the tar archive.
    name: String,
    /// POSIX file mode.
    mode: u32,
    /// Payload byte size.
    size: u64,
    /// Modification timestamp.
    mtime: i64,
    /// Whether this entry is a directory.
    is_dir: bool,
}

/// Parses the fixed-layout 512-byte UStar header block into its semantic fields.
fn parse_tar_header_block(header: &[u8; TAR_BLOCK_SIZE]) -> TarHeaderFields {
    let name_raw = &header[0..100];
    let name_len = name_raw
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(name_raw.len());
    let name = String::from_utf8_lossy(&name_raw[..name_len]).to_string();

    let mode = parse_tar_octal(&header[100..108]).unwrap_or(0o644) as u32;
    let size = parse_tar_octal(&header[124..136]).unwrap_or(0);
    let mtime = parse_tar_octal(&header[136..148]).unwrap_or(0) as i64;
    let typeflag = header[156];
    let is_dir = typeflag == b'5' || name.ends_with('/');

    TarHeaderFields {
        name,
        mode,
        size,
        mtime,
        is_dir,
    }
}

/// Indexes an uncompressed tar archive to prepare for reverse tail extraction.
pub fn index_tar_archive(file: &mut File) -> FractalResult<Vec<TarMember>> {
    file.seek(SeekFrom::Start(0)).map_err(FractalError::Io)?;
    let mut members = Vec::new();
    let file_len = file.metadata().map_err(FractalError::Io)?.len();

    let mut current_offset: u64 = 0;
    let mut header = [0u8; 512];

    while current_offset + 512 <= file_len {
        file.seek(SeekFrom::Start(current_offset))
            .map_err(FractalError::Io)?;
        file.read_exact(&mut header).map_err(FractalError::Io)?;

        // End of archive marker: two consecutive 512-byte blocks filled with zeros
        if header.iter().all(|&b| b == 0) {
            break;
        }

        let fields = parse_tar_header_block(&header);
        let padded_size = fields.size.div_ceil(TAR_BLOCK_SIZE as u64) * TAR_BLOCK_SIZE as u64;
        let total_span = TAR_BLOCK_SIZE as u64 + padded_size;

        if !fields.name.is_empty() {
            members.push(TarMember {
                name: fields.name,
                header_offset: current_offset,
                size: fields.size,
                total_span,
                mode: fields.mode,
                mtime: fields.mtime,
                is_dir: fields.is_dir,
            });
        }

        current_offset += total_span;
    }

    Ok(members)
}

/// Preflight planning for in-place uncompressed TAR extraction.
pub fn plan_tar_in_place(
    initial_free_space: u64,
    members: &[TarMember],
    config: &SpacePlanConfig,
) -> SpacePlanReport {
    let mut sorted_members: Vec<&TarMember> = members.iter().collect();
    sorted_members.sort_by_key(|member| std::cmp::Reverse(member.header_offset));

    let units: Vec<ExtractionUnit> = sorted_members
        .iter()
        .map(|member| {
            ExtractionUnit::new(
                &member.name,
                member.size,
                member.total_span,
                member.header_offset,
            )
        })
        .collect();

    simulate_space_plan(initial_free_space, &units, config)
}

/// Extracts an uncompressed Tar archive in reverse (tail-first) order with in-place tail truncation.
pub fn extract_tar_in_place<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    config: &SpacePlanConfig,
) -> FractalResult<InPlaceExtractionReport> {
    extract_tar_in_place_with_journal(archive_path, dest_dir, config, None, None)
}

/// Extracts an uncompressed Tar archive in reverse (tail-first) order with write-ahead logging (WAL),
/// tail truncation, and optional skip set for auto-resume.
pub fn extract_tar_in_place_with_journal<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    config: &SpacePlanConfig,
    mut journal: Option<&mut InPlaceJournal>,
    already_extracted: Option<&std::collections::HashSet<String>>,
) -> FractalResult<InPlaceExtractionReport> {
    let dest = dest_dir.as_ref();
    fs::create_dir_all(dest).map_err(FractalError::Io)?;

    let mut truncator = TailTruncator::open_read_write(archive_path.as_ref())?;
    let mut members = index_tar_archive(truncator.file_mut())?;

    // Sort descending by header offset (tail-first)
    members.sort_by_key(|a| std::cmp::Reverse(a.header_offset));

    let mut files_extracted = 0;
    let mut total_extracted_bytes: u64 = 0;
    let mut accumulated_reclaim: u64 = 0;
    let total_members = members.len();

    for (idx, member) in members.iter().enumerate() {
        if member.is_dir {
            let rel_path = sanitize_relative_path(&member.name)?;
            let target_path = dest.join(rel_path);
            fs::create_dir_all(&target_path).map_err(FractalError::Io)?;
            continue;
        }

        let rel_path = sanitize_relative_path(&member.name)?;
        let target_path = dest.join(&rel_path);

        let is_already_done = already_extracted
            .map(|set| set.contains(&member.name))
            .unwrap_or(false)
            && target_path.exists();

        let payload_len = if is_already_done {
            target_path
                .metadata()
                .map(|m| m.len())
                .unwrap_or(member.size)
        } else {
            // Read payload
            truncator
                .file_mut()
                .seek(SeekFrom::Start(member.header_offset + 512))
                .map_err(FractalError::Io)?;
            let mut payload = vec![0u8; member.size as usize];
            truncator
                .file_mut()
                .read_exact(&mut payload)
                .map_err(FractalError::Io)?;

            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(FractalError::Io)?;
            }
            fs::write(&target_path, &payload).map_err(FractalError::Io)?;

            if let Some(j) = journal.as_mut() {
                let _ = j.append_unbuffered(&InPlaceLogEntry::MemberExtracted {
                    name: member.name.clone(),
                    extracted_bytes: payload.len() as u64,
                    local_header_offset: member.header_offset,
                    crc32: 0,
                });
            }
            payload.len() as u64
        };

        files_extracted += 1;
        total_extracted_bytes = total_extracted_bytes.saturating_add(payload_len);

        accumulated_reclaim = accumulated_reclaim.saturating_add(member.total_span);

        let is_last = idx + 1 == total_members;
        if (accumulated_reclaim >= config.batch_window_bytes || is_last)
            && member.header_offset < truncator.current_len()
        {
            if let Some(j) = journal.as_mut() {
                let _ = j.append(&InPlaceLogEntry::BatchTruncated {
                    new_len: member.header_offset,
                    freed_bytes: accumulated_reclaim,
                });
            }
            truncator.truncate_to(member.header_offset)?;
            accumulated_reclaim = 0;
        }
    }

    if truncator.current_len() > 0 {
        truncator.truncate_to(0)?;
    }
    if let Some(j) = journal.as_mut() {
        let _ = j.append(&InPlaceLogEntry::SessionCompleted);
    }

    Ok(InPlaceExtractionReport {
        files_extracted,
        total_extracted_bytes,
        total_truncated_bytes: truncator.total_truncated_bytes(),
        final_archive_len: truncator.current_len(),
    })
}

/// Extracts a .tar or .tar.gz archive while leaving the source archive intact.
///
/// The archive is opened read-only and is never truncated or rewritten. Plain tar members are
/// streamed straight from disk, while gzip-compressed streams are inflated in memory and walked
/// in 512-byte tar blocks. The report therefore carries zero truncated bytes and the unmodified
/// source length in final_archive_len.
///
/// # Errors
///
/// Returns FractalError::Io for filesystem failures, FractalError::CorruptStore for malformed or
/// truncated tar/gzip streams, and FractalError::PolicyViolation for path traversal attempts.
pub fn extract_tar_standard<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
) -> FractalResult<InPlaceExtractionReport> {
    let archive_path = archive_path.as_ref();
    let dest = dest_dir.as_ref();
    fs::create_dir_all(dest).map_err(FractalError::Io)?;

    let mut file = File::open(archive_path).map_err(FractalError::Io)?;
    let source_len = file.metadata().map_err(FractalError::Io)?.len();

    let mut magic = [0u8; GZIP_MAGIC.len()];
    let magic_read = file.read(&mut magic).map_err(FractalError::Io)?;
    let is_gzip = is_gzip_tar(archive_path, &magic[..magic_read]);

    let (files_extracted, total_extracted_bytes) = if is_gzip {
        extract_gzip_tar_standard(&mut file, dest)?
    } else {
        extract_plain_tar_standard(&mut file, dest)?
    };

    Ok(InPlaceExtractionReport {
        files_extracted,
        total_extracted_bytes,
        total_truncated_bytes: 0,
        final_archive_len: source_len,
    })
}

/// Detects gzip compression by filename suffix or by gzip magic bytes.
fn is_gzip_tar(archive_path: &Path, magic: &[u8]) -> bool {
    let file_name = archive_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    file_name.ends_with(".tar.gz") || file_name.ends_with(".tgz") || magic.starts_with(&GZIP_MAGIC)
}

/// Extracts an uncompressed tar archive in archived order, streaming payloads from disk.
fn extract_plain_tar_standard(file: &mut File, dest: &Path) -> FractalResult<(usize, u64)> {
    let members = index_tar_archive(file)?;
    let mut files_extracted = 0usize;
    let mut total_extracted_bytes: u64 = 0;

    for member in &members {
        let rel_path = sanitize_relative_path(&member.name)?;
        let target_path = dest.join(rel_path);

        if member.is_dir {
            fs::create_dir_all(&target_path).map_err(FractalError::Io)?;
            continue;
        }

        file.seek(SeekFrom::Start(
            member.header_offset + TAR_BLOCK_SIZE as u64,
        ))
        .map_err(FractalError::Io)?;
        let payload_len = usize::try_from(member.size).map_err(|_| {
            FractalError::CorruptStore(format!(
                "extract tar: member '{}' declares a payload larger than the address space",
                member.name
            ))
        })?;
        let mut payload = vec![0u8; payload_len];
        file.read_exact(&mut payload).map_err(FractalError::Io)?;

        write_tar_member(&target_path, &payload, member.mode)?;
        files_extracted += 1;
        total_extracted_bytes = total_extracted_bytes.saturating_add(member.size);
    }

    Ok((files_extracted, total_extracted_bytes))
}

/// Extracts a gzip-compressed tar archive by inflating the whole stream in memory.
fn extract_gzip_tar_standard(file: &mut File, dest: &Path) -> FractalResult<(usize, u64)> {
    file.seek(SeekFrom::Start(0)).map_err(FractalError::Io)?;
    let mut compressed = Vec::new();
    file.read_to_end(&mut compressed)
        .map_err(FractalError::Io)?;

    let mut tar_bytes = Vec::new();
    let mut decoder = GzDecoder::new(&compressed[..]);
    decoder
        .read_to_end(&mut tar_bytes)
        .map_err(FractalError::Io)?;

    extract_tar_bytes_standard(&tar_bytes, dest)
}

/// Walks a decompressed tar byte stream in 512-byte blocks and writes each member to disk.
fn extract_tar_bytes_standard(tar_bytes: &[u8], dest: &Path) -> FractalResult<(usize, u64)> {
    let mut files_extracted = 0usize;
    let mut total_extracted_bytes: u64 = 0;
    let mut offset = 0usize;

    while offset + TAR_BLOCK_SIZE <= tar_bytes.len() {
        let block_end = offset + TAR_BLOCK_SIZE;
        let mut header = [0u8; TAR_BLOCK_SIZE];
        header.copy_from_slice(&tar_bytes[offset..block_end]);

        if header.iter().all(|&byte| byte == 0) {
            break;
        }

        let fields = parse_tar_header_block(&header);
        let payload_len = usize::try_from(fields.size).map_err(|_| {
            FractalError::CorruptStore(format!(
                "extract tar: member '{}' declares a payload larger than the address space",
                fields.name
            ))
        })?;
        let payload_start = block_end;
        let payload_end = payload_start.checked_add(payload_len).ok_or_else(|| {
            FractalError::CorruptStore(format!(
                "extract tar: member '{}' payload range overflowed",
                fields.name
            ))
        })?;

        if payload_end > tar_bytes.len() {
            return Err(FractalError::CorruptStore(format!(
                "extract tar: member '{}' payload extends past the end of the decompressed stream",
                fields.name
            )));
        }

        if !fields.name.is_empty() {
            let rel_path = sanitize_relative_path(&fields.name)?;
            let target_path = dest.join(rel_path);
            if fields.is_dir {
                fs::create_dir_all(&target_path).map_err(FractalError::Io)?;
            } else {
                write_tar_member(
                    &target_path,
                    &tar_bytes[payload_start..payload_end],
                    fields.mode,
                )?;
                files_extracted += 1;
                total_extracted_bytes = total_extracted_bytes.saturating_add(fields.size);
            }
        }

        let padded_size = fields
            .size
            .div_ceil(TAR_BLOCK_SIZE as u64)
            .checked_mul(TAR_BLOCK_SIZE as u64)
            .ok_or_else(|| {
                FractalError::CorruptStore(
                    "extract tar: member padding size overflowed".to_string(),
                )
            })?;
        let padded_len = usize::try_from(padded_size).map_err(|_| {
            FractalError::CorruptStore(
                "extract tar: member padding exceeds the address space".to_string(),
            )
        })?;
        let next_offset = payload_start.checked_add(padded_len).ok_or_else(|| {
            FractalError::CorruptStore("extract tar: member span overflowed".to_string())
        })?;

        if next_offset > tar_bytes.len() {
            break;
        }
        offset = next_offset;
    }

    Ok((files_extracted, total_extracted_bytes))
}

/// Writes tar member payload bytes and applies the executable bits from the archived mode.
fn write_tar_member(target_path: &Path, payload: &[u8], mode: u32) -> FractalResult<()> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(FractalError::Io)?;
    }
    fs::write(target_path, payload).map_err(FractalError::Io)?;
    apply_tar_executable_bits(target_path, mode)
}

/// Applies the archived executable bits on Unix targets; other platforms carry no POSIX mode.
#[cfg_attr(not(unix), allow(unused_variables))]
fn apply_tar_executable_bits(target_path: &Path, mode: u32) -> FractalResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permission_bits = 0o644 | (mode & 0o111);
        fs::set_permissions(target_path, fs::Permissions::from_mode(permission_bits))
            .map_err(FractalError::Io)?;
    }

    Ok(())
}

/// Helper wrapper tracking total bytes read from the underlying stream.
struct CountingReader<R> {
    inner: R,
    bytes_read: u64,
}

impl<R: Read> CountingReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            bytes_read: 0,
        }
    }

    fn bytes_read(&self) -> u64 {
        self.bytes_read
    }
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(buf)?;
        self.bytes_read = self.bytes_read.saturating_add(count as u64);
        Ok(count)
    }
}

/// Measured outcome of forward-streaming in-place `.tar.gz` extraction.
///
/// Hole punching and tail truncation are distinct primitives: punching converts already-consumed
/// archive regions into sparse extents while keeping the logical file length, tail truncation
/// physically removes bytes from the end. The forward `.tar.gz` path only punches, therefore
/// [`Self::total_truncated_bytes`] stays zero and [`Self::final_archive_len`] is the measured
/// on-disk length after the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TarGzInPlaceReport {
    /// Number of extracted members.
    pub files_extracted: usize,
    /// Total uncompressed payload bytes written for those members.
    pub total_extracted_bytes: u64,
    /// Bytes whose storage was released by hole punching (sparse extents).
    pub hole_punched_bytes: u64,
    /// Bytes physically removed via tail truncation (always zero: this path punches only).
    pub total_truncated_bytes: u64,
    /// Measured archive length in bytes after the extraction finished.
    pub final_archive_len: u64,
}

impl TarGzInPlaceReport {
    /// Projects this report onto the shared extraction report consumed by reporting callers.
    pub fn into_extraction_report(self) -> InPlaceExtractionReport {
        InPlaceExtractionReport {
            files_extracted: self.files_extracted,
            total_extracted_bytes: self.total_extracted_bytes,
            total_truncated_bytes: self.total_truncated_bytes,
            final_archive_len: self.final_archive_len,
        }
    }
}

/// Extracts a compressed `.tar.gz` archive using forward streaming and hole punching.
///
/// Because the whole archive is consumed front-to-back, the completed run releases the storage of
/// every consumed byte as a sparse hole instead of truncating the tail: the archive keeps its
/// logical length. Punching failures propagate to the caller and the returned report carries
/// measured counters rather than hardcoded zeroes.
pub fn extract_targz_forward_hole_punch<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    punch_batch_bytes: u64,
) -> FractalResult<TarGzInPlaceReport> {
    let dest = dest_dir.as_ref();
    fs::create_dir_all(dest).map_err(FractalError::Io)?;

    let mut hole_puncher = HolePuncher::open_read_write(archive_path.as_ref())?;
    let file = File::open(archive_path.as_ref()).map_err(FractalError::Io)?;
    let counting_reader = CountingReader::new(file);
    let mut gz = GzDecoder::new(counting_reader);

    let mut files_extracted = 0;
    let mut total_extracted_bytes: u64 = 0;
    let mut last_punched_offset: u64 = 0;
    let mut header_buf = [0u8; 512];

    loop {
        match gz.read_exact(&mut header_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(FractalError::Io(e)),
        }

        if header_buf.iter().all(|&b| b == 0) {
            break;
        }

        let name_raw = &header_buf[0..100];
        let name_len = name_raw
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(name_raw.len());
        let name = String::from_utf8_lossy(&name_raw[..name_len]).to_string();

        let size = parse_tar_octal(&header_buf[124..136]).unwrap_or(0);
        let typeflag = header_buf[156];
        let is_dir = typeflag == b'5' || name.ends_with('/');

        let padded_size = size.div_ceil(512) * 512;

        if is_dir {
            let rel_path = sanitize_relative_path(&name)?;
            fs::create_dir_all(dest.join(rel_path)).map_err(FractalError::Io)?;
            continue;
        }

        let mut payload = vec![0u8; size as usize];
        gz.read_exact(&mut payload).map_err(FractalError::Io)?;

        // Discard padding bytes
        let padding_bytes = (padded_size - size) as usize;
        if padding_bytes > 0 {
            let mut pad_buf = vec![0u8; padding_bytes];
            gz.read_exact(&mut pad_buf).map_err(FractalError::Io)?;
        }

        let rel_path = sanitize_relative_path(&name)?;
        let target_path = dest.join(rel_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(FractalError::Io)?;
        }
        fs::write(&target_path, &payload).map_err(FractalError::Io)?;

        files_extracted += 1;
        total_extracted_bytes = total_extracted_bytes.saturating_add(size);

        // Periodically punch holes in the consumed raw compressed file
        let current_consumed = gz.get_ref().bytes_read();
        if current_consumed.saturating_sub(last_punched_offset) >= punch_batch_bytes {
            let punch_len = current_consumed - last_punched_offset;
            hole_puncher.punch_hole(last_punched_offset, punch_len)?;
            last_punched_offset = current_consumed;
        }
    }

    drop(gz);

    // The gzip trailer (and any trailing padding) may remain unconsumed by the decoder, so punch
    // the whole remainder up to the real end of file before reporting. Punching folds the region
    // into sparse extents and leaves the logical length untouched.
    let archive_len = hole_puncher
        .file()
        .metadata()
        .map_err(FractalError::Io)?
        .len();
    if archive_len > last_punched_offset {
        hole_puncher.punch_hole(last_punched_offset, archive_len - last_punched_offset)?;
    }
    hole_puncher.sync()?;

    Ok(TarGzInPlaceReport {
        files_extracted,
        total_extracted_bytes,
        hole_punched_bytes: hole_puncher.total_punched_bytes(),
        total_truncated_bytes: 0,
        final_archive_len: archive_len,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::TarWriter;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

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
    fn test_tar_in_place_reverse_extraction() {
        let dir = test_temp_dir("tar_extract_");
        let tar_path = dir.path().join("test.tar");
        let dest_dir = dir.path().join("dest");

        // 1. Create a 2-file Tar archive
        let file = File::create(&tar_path).expect("create tar");
        let mut writer = TarWriter::new(file);

        let data1 = b"Contents of first tar entry. High efficiency.";
        let data2 = b"Contents of second tar entry. Zero allocation.";

        writer
            .append_file("entry1.txt", 0o644, 1000, data1)
            .expect("entry1");
        writer
            .append_file("nested/entry2.txt", 0o644, 1001, data2)
            .expect("entry2");
        writer.finish().expect("finish");

        // 2. Perform in-place extraction
        let config = SpacePlanConfig::new(512, 512);
        let report =
            extract_tar_in_place(&tar_path, &dest_dir, &config).expect("extract tar in place");

        assert_eq!(report.files_extracted, 2);
        assert_eq!(report.final_archive_len, 0);

        // 3. Verify extracted contents
        let read1 = fs::read(dest_dir.join("entry1.txt")).expect("read 1");
        assert_eq!(&read1[..], data1);

        let read2 = fs::read(dest_dir.join("nested/entry2.txt")).expect("read 2");
        assert_eq!(&read2[..], data2);
    }

    #[test]
    fn test_tar_standard_extraction_keeps_archive_intact() {
        let dir = test_temp_dir("tar_standard_");
        let tar_path = dir.path().join("stream.tar");
        let dest_dir = dir.path().join("standard_dest");

        let data1 = b"Plain tar member one kept intact.";
        let data2 = b"Plain tar member two inside a nested directory.";

        let file = File::create(&tar_path).expect("create tar");
        let mut writer = TarWriter::new(file);
        writer
            .append_file("one.txt", 0o755, 1000, data1)
            .expect("entry one");
        writer
            .append_file("nested/two.txt", 0o644, 1001, data2)
            .expect("entry two");
        writer.finish().expect("finish tar");

        let before = fs::read(&tar_path).expect("read tar before");
        let original_len = before.len() as u64;

        let report = extract_tar_standard(&tar_path, &dest_dir).expect("extract tar standard");

        assert_eq!(report.files_extracted, 2);
        assert_eq!(
            report.total_extracted_bytes,
            (data1.len() + data2.len()) as u64
        );
        assert_eq!(report.total_truncated_bytes, 0);
        assert_eq!(report.final_archive_len, original_len);

        let after = fs::read(&tar_path).expect("read tar after");
        assert_eq!(after, before, "source archive must stay byte-identical");

        let read1 = fs::read(dest_dir.join("one.txt")).expect("read one");
        assert_eq!(&read1[..], data1);
        let read2 = fs::read(dest_dir.join("nested/two.txt")).expect("read two");
        assert_eq!(&read2[..], data2);
    }

    #[test]
    fn test_tar_gz_standard_extraction_keeps_archive_intact() {
        let dir = test_temp_dir("targz_standard_");
        let gz_path = dir.path().join("stream.tar.gz");
        let dest_dir = dir.path().join("standard_dest");

        let data1 = b"Gzip tar member one served from the decompressed buffer.";
        let data2 = b"Gzip tar member two with executable bits requested.";

        let file = File::create(&gz_path).expect("create tar.gz");
        let encoder = GzEncoder::new(file, Compression::default());
        let mut writer = TarWriter::new(encoder);
        writer
            .append_file("alpha.txt", 0o644, 1000, data1)
            .expect("alpha");
        writer
            .append_file("beta.sh", 0o755, 1001, data2)
            .expect("beta");
        let encoder = writer.finish().expect("finish tar");
        let mut finished = encoder.finish().expect("finish gzip");
        finished.flush().expect("flush gzip");
        drop(finished);

        let before = fs::read(&gz_path).expect("read tar.gz before");
        let original_len = before.len() as u64;

        let report = extract_tar_standard(&gz_path, &dest_dir).expect("extract tar.gz standard");

        assert_eq!(report.files_extracted, 2);
        assert_eq!(
            report.total_extracted_bytes,
            (data1.len() + data2.len()) as u64
        );
        assert_eq!(report.total_truncated_bytes, 0);
        assert_eq!(report.final_archive_len, original_len);

        let after = fs::read(&gz_path).expect("read tar.gz after");
        assert_eq!(after, before, "source archive must stay byte-identical");

        let read1 = fs::read(dest_dir.join("alpha.txt")).expect("read alpha");
        assert_eq!(&read1[..], data1);
        let read2 = fs::read(dest_dir.join("beta.sh")).expect("read beta");
        assert_eq!(&read2[..], data2);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mode = fs::metadata(dest_dir.join("beta.sh"))
                .expect("beta metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111);
        }
    }

    #[test]
    fn test_targz_forward_hole_punch_reports_measured_reclamation() {
        let dir = test_temp_dir("targz_hole_");
        let gz_path = dir.path().join("punch.tar.gz");
        let dest_dir = dir.path().join("punch_dest");

        let payload = vec![0x33u8; 16 * 1024];
        let file = File::create(&gz_path).expect("create tar.gz");
        let encoder = GzEncoder::new(file, Compression::default());
        let mut writer = TarWriter::new(encoder);
        writer
            .append_file("payload.bin", 0o644, 1000, &payload)
            .expect("payload");
        let encoder = writer.finish().expect("finish tar");
        let mut finished = encoder.finish().expect("finish gzip");
        finished.flush().expect("flush gzip");
        drop(finished);

        let original_len = fs::metadata(&gz_path).expect("metadata").len();

        let report = match extract_targz_forward_hole_punch(&gz_path, &dest_dir, 64) {
            Ok(report) => report,
            Err(FractalError::UnsupportedFilesystemCapability(_)) => return,
            Err(error) => panic!("unexpected hole punch error: {error:?}"),
        };

        assert_eq!(report.files_extracted, 1);
        assert_eq!(report.total_extracted_bytes, payload.len() as u64);
        // Forward hole punching folds consumed regions into sparse extents and never shortens the
        // archive, so the reported length must be the measured value and truncation stays at zero.
        assert_eq!(report.final_archive_len, original_len);
        assert_eq!(
            report.total_truncated_bytes, 0,
            "forward hole punching must not claim tail truncation"
        );
        assert!(
            report.hole_punched_bytes > 0,
            "punched-byte counters must be measured, not hardcoded at zero"
        );
        assert!(report.hole_punched_bytes <= original_len);
        assert_eq!(
            report.hole_punched_bytes + report.total_truncated_bytes,
            original_len
        );

        let remaining_len = fs::metadata(&gz_path).expect("metadata after").len();
        assert_eq!(remaining_len, report.final_archive_len);

        let extracted = fs::read(dest_dir.join("payload.bin")).expect("read payload");
        assert_eq!(extracted.len(), payload.len());
        assert!(extracted.iter().all(|&byte| byte == 0x33));

        let projected = report.into_extraction_report();
        assert_eq!(projected.files_extracted, 1);
        assert_eq!(projected.total_truncated_bytes, 0);
        assert_eq!(projected.final_archive_len, original_len);
    }
}
