//! Module: fg-storage — In-Place Tail Truncator
//! File Path: crates/fg-storage/src/in_place/tail_truncator.rs
//! Architecture Role: Manages safe physical file truncation from the tail end of an archive.
//!   Guarantees monotonically non-increasing file length and immediate durable sync.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-SAF-001.

use std::fs::{File, OpenOptions};
use std::path::Path;

use fg_core::{FractalError, FractalResult};

/// Cross-platform in-place file truncator for tail-reclamation workflows.
///
/// Wraps an open read-write [`File`], enforcing the invariant that truncations can only
/// reduce file length, never expand it. Every truncation flush is backed by [`File::sync_all`]
/// to commit metadata and volume extent table updates.
#[derive(Debug)]
pub struct TailTruncator {
    file: File,
    initial_len: u64,
    current_len: u64,
    total_truncated_bytes: u64,
}

impl TailTruncator {
    /// Opens an existing file for read-write access and initializes the truncator.
    pub fn open_read_write<P: AsRef<Path>>(path: P) -> FractalResult<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path.as_ref())
            .map_err(FractalError::Io)?;
        Self::from_file(file)
    }

    /// Constructs a truncator from an already open file descriptor.
    pub fn from_file(file: File) -> FractalResult<Self> {
        let metadata = file.metadata().map_err(FractalError::Io)?;
        let initial_len = metadata.len();
        Ok(Self {
            file,
            initial_len,
            current_len: initial_len,
            total_truncated_bytes: 0,
        })
    }

    /// Truncates the file to an absolute length `new_len`.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::PolicyViolation`] if `new_len > current_len` to prevent
    /// accidental file expansion.
    /// Returns [`FractalError::Io`] if `set_len` or `sync_all` fails.
    pub fn truncate_to(&mut self, new_len: u64) -> FractalResult<u64> {
        if new_len > self.current_len {
            let current_length = self.current_len;
            return Err(FractalError::PolicyViolation(format!(
                "truncate file: target cannot expand file length from current {current_length} bytes to requested {new_len} bytes"
            )));
        }

        if new_len == self.current_len {
            return Ok(0);
        }

        let freed_bytes = self.current_len - new_len;
        self.file.set_len(new_len).map_err(FractalError::Io)?;
        self.file.sync_all().map_err(FractalError::Io)?;

        self.current_len = new_len;
        self.total_truncated_bytes = self.total_truncated_bytes.saturating_add(freed_bytes);

        Ok(freed_bytes)
    }

    /// Truncates the file by shaving `delta_bytes` from the current tail end.
    pub fn truncate_by(&mut self, delta_bytes: u64) -> FractalResult<u64> {
        let target_len = self.current_len.saturating_sub(delta_bytes);
        self.truncate_to(target_len)
    }

    /// Returns the length of the file when the truncator was created.
    #[inline]
    pub fn initial_len(&self) -> u64 {
        self.initial_len
    }

    /// Returns the current length of the file after all applied truncations.
    #[inline]
    pub fn current_len(&self) -> u64 {
        self.current_len
    }

    /// Returns the cumulative byte count reclaimed through tail truncation.
    #[inline]
    pub fn total_truncated_bytes(&self) -> u64 {
        self.total_truncated_bytes
    }

    /// Borrows the underlying file handle.
    #[inline]
    pub fn file(&self) -> &File {
        &self.file
    }

    /// Mutably borrows the underlying file handle.
    #[inline]
    pub fn file_mut(&mut self) -> &mut File {
        &mut self.file
    }

    /// Explicitly flushes file buffers and OS metadata.
    pub fn sync(&self) -> FractalResult<()> {
        self.file.sync_all().map_err(FractalError::Io)
    }

    /// Consumes the truncator, returning the inner [`File`].
    pub fn into_inner(self) -> File {
        self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Seek, SeekFrom};

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
    fn test_tail_truncator_lifecycle() {
        let dir = test_temp_dir("tail_trunc_");
        let path = dir.path().join("test_archive.bin");

        // 1. Create a 1000-byte test file.
        let pattern: Vec<u8> = (0..1000).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &pattern).expect("write initial data");

        // 2. Open truncator.
        let mut truncator = TailTruncator::open_read_write(&path).expect("open truncator");
        assert_eq!(truncator.initial_len(), 1000);
        assert_eq!(truncator.current_len(), 1000);
        assert_eq!(truncator.total_truncated_bytes(), 0);

        // 3. Truncate to same length (no-op).
        let freed_noop = truncator.truncate_to(1000).expect("noop truncate");
        assert_eq!(freed_noop, 0);

        // 4. Truncate to 650 bytes.
        let freed = truncator.truncate_to(650).expect("truncate to 650");
        assert_eq!(freed, 350);
        assert_eq!(truncator.current_len(), 650);
        assert_eq!(truncator.total_truncated_bytes(), 350);

        // Verify remaining contents.
        let mut disk_content = Vec::new();
        truncator
            .file_mut()
            .seek(SeekFrom::Start(0))
            .expect("seek 0");
        truncator
            .file_mut()
            .read_to_end(&mut disk_content)
            .expect("read");
        assert_eq!(disk_content.len(), 650);
        assert_eq!(&disk_content[..], &pattern[..650]);

        // 5. Attempt expansion (must fail).
        let expand_err = truncator.truncate_to(700).unwrap_err();
        match expand_err {
            FractalError::PolicyViolation(msg) => {
                assert!(msg.contains("cannot expand file length"));
            }
            _ => panic!("Expected PolicyViolation on expansion"),
        }

        // 6. Truncate by delta (shave 150 bytes -> 500).
        let freed_delta = truncator.truncate_by(150).expect("truncate by 150");
        assert_eq!(freed_delta, 150);
        assert_eq!(truncator.current_len(), 500);
        assert_eq!(truncator.total_truncated_bytes(), 500);

        // 7. Truncate to zero.
        let freed_zero = truncator.truncate_to(0).expect("truncate to 0");
        assert_eq!(freed_zero, 500);
        assert_eq!(truncator.current_len(), 0);
        assert_eq!(truncator.total_truncated_bytes(), 1000);
    }
}
