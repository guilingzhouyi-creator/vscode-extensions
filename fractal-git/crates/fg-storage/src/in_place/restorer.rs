//! Module: fg-storage — In-Place Archive Restorer & Reversibility Synthesizer
//! File Path: crates/fg-storage/src/in_place/restorer.rs
//! Architecture Role: Synthesizes valid directory headers for truncated archives upon abortion.
//!   Ensures partially extracted archives remain valid, compliant, and openable by standard tools.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-COR-001, FGT-PRF-001.

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};

use fg_core::error::{FractalError, FractalResult};

use crate::in_place::zip_extractor::{
    read_zip_central_directory, read_zip_eocd, ZipMember, CDH_SIGNATURE, EOCD_SIGNATURE,
};

/// Restores and synthesizes valid archive index headers upon aborted or cancelled extractions.
pub struct ArchiveRestorer;

impl ArchiveRestorer {
    /// Re-synthesizes a valid Central Directory and EOCD for the remaining members in a truncated ZIP.
    ///
    /// # Safety and Invariants
    ///
    /// Every member in `remaining_members` must have a `local_header_offset` that sits entirely
    /// within the retained prefix of `file`.
    pub fn synthesize_zip_tail(
        file: &mut File,
        remaining_members: &[ZipMember],
    ) -> FractalResult<u64> {
        let cd_offset = file.seek(SeekFrom::End(0)).map_err(FractalError::Io)?;
        let mut cd_size: u32 = 0;

        // 1. Write Central Directory Headers for all remaining members
        for member in remaining_members {
            let name_bytes = member.name.as_bytes();
            let name_len = name_bytes.len() as u16;

            let mut cd_record = Vec::with_capacity(46 + name_bytes.len());
            cd_record.extend_from_slice(&CDH_SIGNATURE.to_le_bytes()); // 0x02014b50
            cd_record.extend_from_slice(&0x0314u16.to_le_bytes()); // Version made by (Unix 2.0)
            cd_record.extend_from_slice(&20u16.to_le_bytes()); // Version needed (2.0)
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Flags
            cd_record.extend_from_slice(&member.compression_method.to_le_bytes());
            cd_record.extend_from_slice(&member.mtime.to_le_bytes());
            cd_record.extend_from_slice(&member.mdate.to_le_bytes());
            cd_record.extend_from_slice(&member.crc32.to_le_bytes());
            cd_record.extend_from_slice(&(member.compressed_size as u32).to_le_bytes());
            cd_record.extend_from_slice(&(member.uncompressed_size as u32).to_le_bytes());
            cd_record.extend_from_slice(&name_len.to_le_bytes());
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Extra field len
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Comment len
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Disk start
            cd_record.extend_from_slice(&0u16.to_le_bytes()); // Internal attr
            cd_record.extend_from_slice(&member.external_attributes.to_le_bytes());
            cd_record.extend_from_slice(&(member.local_header_offset as u32).to_le_bytes());
            cd_record.extend_from_slice(name_bytes);

            file.write_all(&cd_record).map_err(FractalError::Io)?;
            cd_size += cd_record.len() as u32;
        }

        // 2. Write End of Central Directory Record (22 bytes)
        let total_count = remaining_members.len() as u16;
        let mut eocd = Vec::with_capacity(22);
        eocd.extend_from_slice(&EOCD_SIGNATURE.to_le_bytes()); // 0x06054b50
        eocd.extend_from_slice(&0u16.to_le_bytes()); // Disk number
        eocd.extend_from_slice(&0u16.to_le_bytes()); // CD start disk
        eocd.extend_from_slice(&total_count.to_le_bytes()); // Entries on this disk
        eocd.extend_from_slice(&total_count.to_le_bytes()); // Total entries
        eocd.extend_from_slice(&cd_size.to_le_bytes()); // Size of CD
        eocd.extend_from_slice(&(cd_offset as u32).to_le_bytes()); // Offset of CD
        eocd.extend_from_slice(&0u16.to_le_bytes()); // Comment length

        file.write_all(&eocd).map_err(FractalError::Io)?;
        file.sync_all().map_err(FractalError::Io)?;

        let final_len = file.seek(SeekFrom::End(0)).map_err(FractalError::Io)?;
        Ok(final_len)
    }

    /// Verifies that a truncated archive has been restored into a self-consistent format.
    pub fn verify_restored_zip(file: &mut File) -> FractalResult<Vec<ZipMember>> {
        let eocd = read_zip_eocd(file)?;
        read_zip_central_directory(file, &eocd)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::ZipWriter;
    use crate::in_place::tail_truncator::TailTruncator;
    use crate::in_place::zip_extractor::{read_zip_central_directory, read_zip_eocd};
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
    fn test_zip_restoration_after_partial_truncation() {
        let dir = test_temp_dir("zip_restore_");
        let zip_path = dir.path().join("restore_test.zip");

        // 1. Create a 3-file Zip archive
        let file = File::create(&zip_path).expect("create zip");
        let mut writer = ZipWriter::new(file);
        writer
            .append_file("keep1.txt", 0o644, 1000, b"Payload of keep 1")
            .expect("file1");
        writer
            .append_file("keep2.txt", 0o644, 1001, b"Payload of keep 2")
            .expect("file2");
        writer
            .append_file("dropped.txt", 0o644, 1002, b"Payload dropped by truncation")
            .expect("file3");
        let mut finished = writer.finish().expect("finish");
        finished.flush().expect("flush");
        drop(finished);

        // 2. Open read-write truncator and read members
        let mut truncator = TailTruncator::open_read_write(&zip_path).expect("open truncator");
        let eocd = read_zip_eocd(truncator.file_mut()).expect("read eocd");
        let members = read_zip_central_directory(truncator.file_mut(), &eocd).expect("read cd");
        assert_eq!(members.len(), 3);

        let dropped_offset = members[2].local_header_offset;

        // 3. Simulate abort: truncate dropped.txt away
        truncator
            .truncate_to(dropped_offset)
            .expect("truncate dropped.txt");

        // 4. Synthesize valid zip tail for remaining 2 members
        let remaining = &members[..2];
        ArchiveRestorer::synthesize_zip_tail(truncator.file_mut(), remaining)
            .expect("synthesize tail");

        // 5. Verify that restored archive is 100% valid and contains exactly 2 members
        let verified = ArchiveRestorer::verify_restored_zip(truncator.file_mut())
            .expect("verify restored zip");
        assert_eq!(verified.len(), 2);
        assert_eq!(verified[0].name, "keep1.txt");
        assert_eq!(verified[1].name, "keep2.txt");
    }
}
