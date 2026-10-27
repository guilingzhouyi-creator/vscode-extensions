//! Module: fg-storage — In-Place Reverse ZIP Extractor
//! File Path: crates/fg-storage/src/in_place/zip_extractor.rs
//! Architecture Role: Implements reverse (tail-first) ZIP decompression with in-place tail truncation.
//!   Reclaims disk space as extraction progresses, bounded by an adaptive batch window.
//!   Also exposes non-destructive standard extraction for read-only callers.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-PRF-001, FGT-COR-001, FGT-SAF-001.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

use fg_algorithms::space_plan::{
    simulate_space_plan, ExtractionUnit, SpacePlanConfig, SpacePlanReport,
};
use fg_core::error::{FractalError, FractalResult};
use flate2::read::DeflateDecoder;

use crate::backends::pack_writer::crc32_ieee;
use crate::in_place::journal::{InPlaceJournal, InPlaceLogEntry};
use crate::in_place::restorer::ArchiveRestorer;
use crate::in_place::tail_truncator::TailTruncator;

/// Signature for End of Central Directory record (`PK\x05\x06`).
pub const EOCD_SIGNATURE: u32 = 0x0605_4B50;

/// Signature for Central Directory Header (`PK\x01\x02`).
pub const CDH_SIGNATURE: u32 = 0x0201_4B50;

/// Signature for Local File Header (`PK\x03\x04`).
pub const LFH_SIGNATURE: u32 = 0x0403_4B50;

/// Parsed metadata for a single member inside a ZIP archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipMember {
    /// Relative path inside the archive.
    pub name: String,
    /// Offset of the Local File Header from the beginning of the file.
    pub local_header_offset: u64,
    /// Size of compressed payload in bytes.
    pub compressed_size: u64,
    /// Size of uncompressed payload in bytes.
    pub uncompressed_size: u64,
    /// Compression method (0 = Store, 8 = Deflate).
    pub compression_method: u16,
    /// IEEE 802.3 CRC32 checksum.
    pub crc32: u32,
    /// DOS modification time.
    pub mtime: u16,
    /// DOS modification date.
    pub mdate: u16,
    /// External file attributes (contains POSIX permissions in top 16 bits if set).
    pub external_attributes: u32,
    /// Whether this entry represents a directory.
    pub is_dir: bool,
}

/// End of Central Directory metadata parsed from the archive tail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipEocd {
    /// Total number of entries in the Central Directory.
    pub total_entries: u16,
    /// Byte size of the Central Directory.
    pub central_directory_size: u64,
    /// Byte offset of the Central Directory from file start.
    pub central_directory_offset: u64,
}

/// Locates and parses the End of Central Directory (EOCD) record by scanning backwards from EOF.
pub fn read_zip_eocd(file: &mut File) -> FractalResult<ZipEocd> {
    let file_len = file.metadata().map_err(FractalError::Io)?.len();
    if file_len < 22 {
        return Err(FractalError::CorruptStore(
            "File too small to contain a valid ZIP archive".into(),
        ));
    }

    // Maximum comment length is 65535; EOCD record is 22 bytes.
    let scan_size = (file_len as usize).min(22 + 65535);
    let seek_offset = file_len - (scan_size as u64);

    file.seek(SeekFrom::Start(seek_offset))
        .map_err(FractalError::Io)?;
    let mut buffer = vec![0u8; scan_size];
    file.read_exact(&mut buffer).map_err(FractalError::Io)?;

    // Scan backwards for signature 0x06054b50 (little endian: [0x50, 0x4b, 0x05, 0x06])
    let sig_bytes = EOCD_SIGNATURE.to_le_bytes();
    let mut eocd_pos = None;

    if scan_size >= 22 {
        for i in (0..=scan_size - 22).rev() {
            if buffer[i..i + 4] == sig_bytes {
                eocd_pos = Some(i);
                break;
            }
        }
    }

    let pos = eocd_pos.ok_or_else(|| {
        FractalError::CorruptStore("Could not find ZIP End of Central Directory record".into())
    })?;

    let eocd_slice = &buffer[pos..];
    let total_entries = u16::from_le_bytes([eocd_slice[10], eocd_slice[11]]);
    let cd_size = u32::from_le_bytes([
        eocd_slice[12],
        eocd_slice[13],
        eocd_slice[14],
        eocd_slice[15],
    ]) as u64;
    let cd_offset = u32::from_le_bytes([
        eocd_slice[16],
        eocd_slice[17],
        eocd_slice[18],
        eocd_slice[19],
    ]) as u64;

    Ok(ZipEocd {
        total_entries,
        central_directory_size: cd_size,
        central_directory_offset: cd_offset,
    })
}

/// Reads and parses all Central Directory entries from the archive.
pub fn read_zip_central_directory(
    file: &mut File,
    eocd: &ZipEocd,
) -> FractalResult<Vec<ZipMember>> {
    file.seek(SeekFrom::Start(eocd.central_directory_offset))
        .map_err(FractalError::Io)?;

    let mut members = Vec::with_capacity(eocd.total_entries as usize);

    for _ in 0..eocd.total_entries {
        let mut fixed_header = [0u8; 46];
        file.read_exact(&mut fixed_header)
            .map_err(FractalError::Io)?;

        let sig = u32::from_le_bytes([
            fixed_header[0],
            fixed_header[1],
            fixed_header[2],
            fixed_header[3],
        ]);
        if sig != CDH_SIGNATURE {
            return Err(FractalError::CorruptStore(format!(
                "read zip central directory: expected signature {CDH_SIGNATURE:#x}, actual {sig:#x}"
            )));
        }

        let compression_method = u16::from_le_bytes([fixed_header[10], fixed_header[11]]);
        let mtime = u16::from_le_bytes([fixed_header[12], fixed_header[13]]);
        let mdate = u16::from_le_bytes([fixed_header[14], fixed_header[15]]);
        let crc32 = u32::from_le_bytes([
            fixed_header[16],
            fixed_header[17],
            fixed_header[18],
            fixed_header[19],
        ]);
        let comp_size = u32::from_le_bytes([
            fixed_header[20],
            fixed_header[21],
            fixed_header[22],
            fixed_header[23],
        ]) as u64;
        let uncomp_size = u32::from_le_bytes([
            fixed_header[24],
            fixed_header[25],
            fixed_header[26],
            fixed_header[27],
        ]) as u64;

        let filename_len = u16::from_le_bytes([fixed_header[28], fixed_header[29]]) as usize;
        let extra_len = u16::from_le_bytes([fixed_header[30], fixed_header[31]]) as usize;
        let comment_len = u16::from_le_bytes([fixed_header[32], fixed_header[33]]) as usize;

        let external_attributes = u32::from_le_bytes([
            fixed_header[38],
            fixed_header[39],
            fixed_header[40],
            fixed_header[41],
        ]);
        let local_offset = u32::from_le_bytes([
            fixed_header[42],
            fixed_header[43],
            fixed_header[44],
            fixed_header[45],
        ]) as u64;

        let mut name_buf = vec![0u8; filename_len];
        file.read_exact(&mut name_buf).map_err(FractalError::Io)?;
        let name = String::from_utf8_lossy(&name_buf).to_string();

        // Skip extra and comment fields
        if extra_len + comment_len > 0 {
            file.seek(SeekFrom::Current((extra_len + comment_len) as i64))
                .map_err(FractalError::Io)?;
        }

        let is_dir = name.ends_with('/') || (external_attributes & 0o040000) != 0;

        members.push(ZipMember {
            name,
            local_header_offset: local_offset,
            compressed_size: comp_size,
            uncompressed_size: uncomp_size,
            compression_method,
            crc32,
            mtime,
            mdate,
            external_attributes,
            is_dir,
        });
    }

    Ok(members)
}

/// Reads the local file payload for a member and inflates it.
pub fn extract_member_payload(file: &mut File, member: &ZipMember) -> FractalResult<Vec<u8>> {
    file.seek(SeekFrom::Start(member.local_header_offset))
        .map_err(FractalError::Io)?;

    let mut lfh = [0u8; 30];
    file.read_exact(&mut lfh).map_err(FractalError::Io)?;

    let sig = u32::from_le_bytes([lfh[0], lfh[1], lfh[2], lfh[3]]);
    if sig != LFH_SIGNATURE {
        let local_offset = member.local_header_offset;
        return Err(FractalError::CorruptStore(format!(
            "read zip local file header: expected signature {LFH_SIGNATURE:#x} at offset {local_offset}, actual {sig:#x}"
        )));
    }

    let lfh_name_len = u16::from_le_bytes([lfh[26], lfh[27]]) as u64;
    let lfh_extra_len = u16::from_le_bytes([lfh[28], lfh[29]]) as u64;

    // Seek to actual compressed data
    file.seek(SeekFrom::Current((lfh_name_len + lfh_extra_len) as i64))
        .map_err(FractalError::Io)?;

    let mut compressed_buf = vec![0u8; member.compressed_size as usize];
    file.read_exact(&mut compressed_buf)
        .map_err(FractalError::Io)?;

    let uncompressed_buf = match member.compression_method {
        0 => compressed_buf,
        8 => {
            let mut decoder = DeflateDecoder::new(&compressed_buf[..]);
            let mut decompressed = Vec::with_capacity(member.uncompressed_size as usize);
            decoder
                .read_to_end(&mut decompressed)
                .map_err(FractalError::Io)?;
            decompressed
        }
        other_compression => {
            let member_name = &member.name;
            return Err(FractalError::PolicyViolation(format!(
                "extract zip member payload: compression method {other_compression} unsupported for member '{member_name}'"
            )));
        }
    };

    // Verify CRC32
    let actual_crc = crc32_ieee(&uncompressed_buf);
    if actual_crc != member.crc32 {
        let expected_hex = format!("{:08x}", member.crc32);
        let actual_hex = format!("{:08x}", actual_crc);
        return Err(FractalError::HashMismatch {
            expected: expected_hex,
            actual: actual_hex,
        });
    }

    Ok(uncompressed_buf)
}

/// Sanitizes relative archive paths to prevent path traversal attacks (Path Jail).
pub fn sanitize_relative_path(archive_name: &str) -> FractalResult<PathBuf> {
    let raw_path = Path::new(archive_name);
    let mut safe_path = PathBuf::new();

    for comp in raw_path.components() {
        match comp {
            Component::Normal(part) => safe_path.push(part),
            Component::CurDir => continue,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(FractalError::PolicyViolation(format!(
                    "sanitize relative archive path: path traversal component detected in member '{archive_name}'"
                )));
            }
        }
    }

    if safe_path.as_os_str().is_empty() {
        return Err(FractalError::PolicyViolation(
            "sanitize relative archive path: path inside archive is empty or invalid".into(),
        ));
    }

    Ok(safe_path)
}

/// Preflight planning for in-place ZIP extraction.
///
/// Converts ZIP members into discrete `ExtractionUnit`s and computes projected space trough.
pub fn plan_zip_in_place(
    initial_free_space: u64,
    members: &[ZipMember],
    config: &SpacePlanConfig,
) -> SpacePlanReport {
    // Sort members descending by local_header_offset (Tail-First Order)
    let mut sorted_members: Vec<&ZipMember> = members.iter().collect();
    sorted_members.sort_by_key(|member| std::cmp::Reverse(member.local_header_offset));

    let units: Vec<ExtractionUnit> = sorted_members
        .iter()
        .map(|member| {
            // Reclaimed bytes upon truncating this member is the span from this local header
            // to the end of its compressed block (approx header + name + comp_size)
            let reclaimed_estimate = member.compressed_size + 30 + (member.name.len() as u64);
            ExtractionUnit::new(
                &member.name,
                member.uncompressed_size,
                reclaimed_estimate,
                member.local_header_offset,
            )
        })
        .collect();

    simulate_space_plan(initial_free_space, &units, config)
}

/// Statistics and execution report of an in-place ZIP extraction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InPlaceExtractionReport {
    /// Number of files extracted.
    pub files_extracted: usize,
    /// Total uncompressed bytes written.
    pub total_extracted_bytes: u64,
    /// Total bytes physically truncated from the archive file.
    pub total_truncated_bytes: u64,
    /// Final length of the source archive (0 if completely truncated).
    pub final_archive_len: u64,
}

/// Executes in-place reverse ZIP extraction into a destination directory.
///
/// Follows strict reverse (tail-first) ordering. Files are decompressed, verified by CRC32,
/// and written to disk. The source file is monotonically truncated using [`TailTruncator`]
/// as batch thresholds are met.
pub fn extract_zip_in_place<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    config: &SpacePlanConfig,
) -> FractalResult<InPlaceExtractionReport> {
    extract_zip_in_place_with_journal(archive_path, dest_dir, config, None, None)
}

/// Executes in-place reverse ZIP extraction with optional write-ahead logging (WAL),
/// crash resilience, and skip set for auto-resuming aborted extractions.
pub fn extract_zip_in_place_with_journal<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
    config: &SpacePlanConfig,
    mut journal: Option<&mut InPlaceJournal>,
    already_extracted: Option<&std::collections::HashSet<String>>,
) -> FractalResult<InPlaceExtractionReport> {
    let dest = dest_dir.as_ref();
    fs::create_dir_all(dest).map_err(FractalError::Io)?;

    let mut truncator = TailTruncator::open_read_write(archive_path.as_ref())?;
    let eocd = read_zip_eocd(truncator.file_mut())?;
    let mut members = read_zip_central_directory(truncator.file_mut(), &eocd)?;

    // Sort descending by local_header_offset (tail-first order)
    members.sort_by_key(|a| std::cmp::Reverse(a.local_header_offset));

    let mut files_extracted = 0;
    let mut total_extracted_bytes: u64 = 0;
    let mut accumulated_reclaim: u64 = 0;
    let total_members = members.len();

    // The Central Directory itself can be immediately lopped off if it sits at the tail!
    if eocd.central_directory_offset < truncator.current_len() {
        if let Some(j) = journal.as_mut() {
            let _ = j.append(&InPlaceLogEntry::BatchTruncated {
                new_len: eocd.central_directory_offset,
                freed_bytes: truncator
                    .current_len()
                    .saturating_sub(eocd.central_directory_offset),
            });
        }
        truncator.truncate_to(eocd.central_directory_offset)?;
    }

    let mut current_extracted_idx = 0;
    let mut run_extraction = || -> FractalResult<()> {
        for (idx, member) in members.iter().enumerate() {
            current_extracted_idx = idx;
            if member.is_dir {
                let rel_path = sanitize_relative_path(&member.name)?;
                let target_path = dest.join(rel_path);
                fs::create_dir_all(&target_path).map_err(FractalError::Io)?;
                continue;
            }

            let rel_path = sanitize_relative_path(&member.name)?;
            let target_path = dest.join(&rel_path);

            // If resuming and member was already extracted, skip payload extraction if file exists
            let is_already_done = already_extracted
                .map(|set| set.contains(&member.name))
                .unwrap_or(false)
                && target_path.exists();

            let payload_len = if is_already_done {
                target_path
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(member.uncompressed_size)
            } else {
                // 1. Extract and verify payload
                let payload = extract_member_payload(truncator.file_mut(), member)?;
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent).map_err(FractalError::Io)?;
                }
                fs::write(&target_path, &payload).map_err(FractalError::Io)?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if member.external_attributes > 0 {
                        let mode = (member.external_attributes >> 16) & 0o7777;
                        if mode != 0 {
                            let _ =
                                fs::set_permissions(&target_path, fs::Permissions::from_mode(mode));
                        }
                    }
                }

                if let Some(j) = journal.as_mut() {
                    let _ = j.append_unbuffered(&InPlaceLogEntry::MemberExtracted {
                        name: member.name.clone(),
                        extracted_bytes: payload.len() as u64,
                        local_header_offset: member.local_header_offset,
                        crc32: member.crc32,
                    });
                }
                payload.len() as u64
            };

            files_extracted += 1;
            total_extracted_bytes = total_extracted_bytes.saturating_add(payload_len);

            let reclaimed_step = truncator
                .current_len()
                .saturating_sub(member.local_header_offset);
            accumulated_reclaim = accumulated_reclaim.saturating_add(reclaimed_step);

            // 2. Batch window evaluation
            let is_last = idx + 1 == total_members;
            if (accumulated_reclaim >= config.batch_window_bytes || is_last)
                && member.local_header_offset < truncator.current_len()
            {
                if let Some(j) = journal.as_mut() {
                    let _ = j.append(&InPlaceLogEntry::BatchTruncated {
                        new_len: member.local_header_offset,
                        freed_bytes: accumulated_reclaim,
                    });
                }
                truncator.truncate_to(member.local_header_offset)?;
                accumulated_reclaim = 0;
            }
        }
        current_extracted_idx = total_members;
        Ok(())
    };

    match run_extraction() {
        Ok(()) => {
            // If completely processed, truncate file to 0
            if truncator.current_len() > 0 {
                truncator.truncate_to(0)?;
            }
            if let Some(j) = journal.as_mut() {
                let _ = j.append(&InPlaceLogEntry::SessionCompleted);
            }
            let report = InPlaceExtractionReport {
                files_extracted,
                total_extracted_bytes,
                total_truncated_bytes: truncator.total_truncated_bytes(),
                final_archive_len: truncator.current_len(),
            };
            Ok(report)
        }
        Err(err) => {
            // ArchiveRestorer self-healing on failure:
            // Remaining members are those from current_extracted_idx onwards
            let remaining_members = &members[current_extracted_idx..];
            if !remaining_members.is_empty() && truncator.current_len() > 0 {
                let _ =
                    ArchiveRestorer::synthesize_zip_tail(truncator.file_mut(), remaining_members);
                let _ = ArchiveRestorer::verify_restored_zip(truncator.file_mut());
            }
            Err(err)
        }
    }
}

/// Extracts a ZIP archive into a destination directory while leaving the source archive intact.
///
/// Members are written in Central Directory order. The archive is opened read-only and is never
/// truncated, resized, or rewritten, so the reclamation counters stay at zero while
/// final_archive_len reports the untouched source length.
///
/// # Errors
///
/// Returns FractalError::Io for filesystem failures, FractalError::CorruptStore for malformed
/// archive structures, and FractalError::PolicyViolation for path traversal attempts or
/// unsupported compression methods.
pub fn extract_zip_standard<P: AsRef<Path>, D: AsRef<Path>>(
    archive_path: P,
    dest_dir: D,
) -> FractalResult<InPlaceExtractionReport> {
    let dest = dest_dir.as_ref();
    fs::create_dir_all(dest).map_err(FractalError::Io)?;

    let mut file = File::open(archive_path.as_ref()).map_err(FractalError::Io)?;
    let source_len = file.metadata().map_err(FractalError::Io)?.len();
    let eocd = read_zip_eocd(&mut file)?;
    let members = read_zip_central_directory(&mut file, &eocd)?;

    let mut files_extracted = 0usize;
    let mut total_extracted_bytes: u64 = 0;

    for member in &members {
        let rel_path = sanitize_relative_path(&member.name)?;
        let target_path = dest.join(rel_path);

        if member.is_dir {
            fs::create_dir_all(&target_path).map_err(FractalError::Io)?;
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(FractalError::Io)?;
        }

        let payload = extract_member_payload(&mut file, member)?;
        fs::write(&target_path, &payload).map_err(FractalError::Io)?;
        apply_zip_unix_permissions(&target_path, member.external_attributes)?;

        files_extracted += 1;
        total_extracted_bytes = total_extracted_bytes.saturating_add(payload.len() as u64);
    }

    Ok(InPlaceExtractionReport {
        files_extracted,
        total_extracted_bytes,
        total_truncated_bytes: 0,
        final_archive_len: source_len,
    })
}

/// Applies the POSIX mode stored in a ZIP member external attributes to an extracted file.
#[cfg_attr(not(unix), allow(unused_variables))]
fn apply_zip_unix_permissions(target_path: &Path, external_attributes: u32) -> FractalResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = (external_attributes >> 16) & 0o7777;
        if mode != 0 {
            fs::set_permissions(target_path, fs::Permissions::from_mode(mode))
                .map_err(FractalError::Io)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::ZipWriter;
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
    fn test_zip_in_place_extraction_roundtrip() {
        let dir = test_temp_dir("zip_extract_");
        let zip_path = dir.path().join("archive.zip");
        let extract_dir = dir.path().join("extracted");

        // 1. Build a synthetic multi-file Zip archive using ZipWriter
        let file = File::create(&zip_path).expect("create zip");
        let mut writer = ZipWriter::new(file);

        let data1 = b"Hello World from file 1. High compression repeated repeated repeated.";
        let data2 = b"Second payload in zip. Rust engineering rules FGT-STO-001.";
        let data3 = vec![0x42u8; 8192]; // 8KB block

        writer
            .append_file("dir/file1.txt", 0o644, 1600000000, data1)
            .expect("append 1");
        writer
            .append_file("file2.txt", 0o644, 1600000001, data2)
            .expect("append 2");
        writer
            .append_file("large.bin", 0o644, 1600000002, &data3)
            .expect("append 3");

        let mut finished_file = writer.finish().expect("finish zip");
        finished_file.flush().expect("flush");
        let original_size = finished_file.metadata().expect("meta").len();
        assert!(original_size > 0);

        // 2. Perform in-place extraction
        let config = SpacePlanConfig::new(1024, 1024); // Small batch window for test
        let report =
            extract_zip_in_place(&zip_path, &extract_dir, &config).expect("extract in place");

        assert_eq!(report.files_extracted, 3);
        assert_eq!(
            report.total_extracted_bytes,
            (data1.len() + data2.len() + data3.len()) as u64
        );
        assert_eq!(report.final_archive_len, 0);
        assert!(report.total_truncated_bytes >= original_size);

        // 3. Verify extracted contents match original bytes
        let ext1 = fs::read(extract_dir.join("dir/file1.txt")).expect("read file1");
        assert_eq!(&ext1[..], data1);

        let ext2 = fs::read(extract_dir.join("file2.txt")).expect("read file2");
        assert_eq!(&ext2[..], data2);

        let ext3 = fs::read(extract_dir.join("large.bin")).expect("read large");
        assert_eq!(&ext3[..], &data3[..]);
    }

    #[test]
    fn test_zip_path_traversal_rejection() {
        assert!(sanitize_relative_path("../evil.txt").is_err());
        assert!(sanitize_relative_path("/root/evil.txt").is_err());
        assert!(sanitize_relative_path("a/../../evil.txt").is_err());
        assert!(sanitize_relative_path("safe/path.txt").is_ok());
    }

    #[test]
    fn test_zip_standard_extraction_keeps_archive_intact() {
        let dir = test_temp_dir("zip_standard_");
        let zip_path = dir.path().join("archive.zip");
        let extract_dir = dir.path().join("extracted");

        let data1 = b"Standard extraction member one. The source archive must survive.";
        let data2 = vec![0x5Au8; 4096];

        let file = File::create(&zip_path).expect("create zip");
        let mut writer = ZipWriter::new(file);
        writer
            .append_file("alpha.txt", 0o644, 1600000000, data1)
            .expect("append alpha");
        writer
            .append_file("dir/beta.bin", 0o600, 1600000001, &data2)
            .expect("append beta");
        let mut finished = writer.finish().expect("finish zip");
        finished.flush().expect("flush");
        drop(finished);

        let before = fs::read(&zip_path).expect("read archive before");
        let original_len = before.len() as u64;

        let report = extract_zip_standard(&zip_path, &extract_dir).expect("extract standard");

        assert_eq!(report.files_extracted, 2);
        assert_eq!(
            report.total_extracted_bytes,
            (data1.len() + data2.len()) as u64
        );
        assert_eq!(report.total_truncated_bytes, 0);
        assert_eq!(report.final_archive_len, original_len);

        let after = fs::read(&zip_path).expect("read archive after");
        assert_eq!(after, before, "source archive must stay byte-identical");

        let extracted_alpha = fs::read(extract_dir.join("alpha.txt")).expect("read alpha");
        assert_eq!(&extracted_alpha[..], data1);
        let extracted_beta = fs::read(extract_dir.join("dir/beta.bin")).expect("read beta");
        assert_eq!(&extracted_beta[..], &data2[..]);
    }
}
