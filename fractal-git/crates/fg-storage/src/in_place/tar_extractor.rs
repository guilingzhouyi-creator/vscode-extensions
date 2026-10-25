//! Module: fg-storage — In-Place TAR & TAR.GZ Extractor
//! File Path: crates/fg-storage/src/in_place/tar_extractor.rs
//! Architecture Role: Implements reverse tail-truncation for uncompressed Tar and forward
//!   stream hole-punching for Gzip-compressed Tar (.tar.gz).
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
use crate::in_place::tail_truncator::TailTruncator;
use crate::in_place::zip_extractor::{sanitize_relative_path, InPlaceExtractionReport};

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

        let padded_size = size.div_ceil(512) * 512;
        let total_span = 512 + padded_size;

        if !name.is_empty() {
            members.push(TarMember {
                name,
                header_offset: current_offset,
                size,
                total_span,
                mode,
                mtime,
                is_dir,
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

        let rel_path = sanitize_relative_path(&member.name)?;
        let target_path = dest.join(&rel_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(FractalError::Io)?;
        }

        fs::write(&target_path, &payload).map_err(FractalError::Io)?;

        files_extracted += 1;
        total_extracted_bytes = total_extracted_bytes.saturating_add(payload.len() as u64);

        accumulated_reclaim = accumulated_reclaim.saturating_add(member.total_span);

        let is_last = idx + 1 == total_members;
        if (accumulated_reclaim >= config.batch_window_bytes || is_last)
            && member.header_offset < truncator.current_len()
        {
            truncator.truncate_to(member.header_offset)?;
            accumulated_reclaim = 0;
        }
    }

    if truncator.current_len() > 0 {
        truncator.truncate_to(0)?;
    }

    Ok(InPlaceExtractionReport {
        files_extracted,
        total_extracted_bytes,
        total_truncated_bytes: truncator.total_truncated_bytes(),
        final_archive_len: truncator.current_len(),
    })
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

/// Extracts a compressed `.tar.gz` archive using forward streaming and hole punching.
pub fn extract_targz_forward_hole_punch<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    punch_batch_bytes: u64,
) -> FractalResult<InPlaceExtractionReport> {
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
            let _ = hole_puncher.punch_hole(last_punched_offset, punch_len);
            last_punched_offset = current_consumed;
        }
    }

    Ok(InPlaceExtractionReport {
        files_extracted,
        total_extracted_bytes,
        total_truncated_bytes: hole_puncher.total_punched_bytes(),
        final_archive_len: 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::TarWriter;

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
}
