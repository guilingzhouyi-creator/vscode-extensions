//! Module: fg-storage — In-Place Forward Hole Puncher
//! File Path: crates/fg-storage/src/in_place/hole_puncher.rs
//! Architecture Role: Manages physical hole punching (deallocating file extents) for forward
//!   stream extraction (e.g. `.tar.gz`) without shifting logical file offsets.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-SAF-001.

use std::fs::{File, OpenOptions};
use std::path::Path;

use fg_core::{FractalError, FractalResult};

/// Cross-platform forward hole puncher for sparse in-place reclamation.
///
/// On Windows/NTFS, leverages `FSCTL_SET_SPARSE` and `FSCTL_SET_ZERO_DATA`.
/// On Linux, leverages `fallocate(FALLOC_FL_PUNCH_HOLE | FALLOC_FL_KEEP_SIZE)`.
/// On unsupported platforms or non-sparse filesystems, operations return
/// [`FractalError::UnsupportedFilesystemCapability`].
#[derive(Debug)]
pub struct HolePuncher {
    file: File,
    total_punched_bytes: u64,
}

impl HolePuncher {
    /// Opens an existing file for read-write access and prepares it for hole punching.
    pub fn open_read_write<P: AsRef<Path>>(path: P) -> FractalResult<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path.as_ref())
            .map_err(FractalError::Io)?;
        Self::from_file(file)
    }

    /// Constructs a [`HolePuncher`] from an already open file, marking it sparse if required.
    pub fn from_file(file: File) -> FractalResult<Self> {
        sys::mark_sparse(&file)?;
        Ok(Self {
            file,
            total_punched_bytes: 0,
        })
    }

    /// Punches a sparse hole in the byte range `[offset, offset + length)`.
    ///
    /// Reclaims physical volume clusters while leaving the logical file size intact.
    /// Bytes in the punched region will read back as zeroes (`0x00`).
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::UnsupportedFilesystemCapability`] if the volume or kernel
    /// rejects hole punching.
    /// Returns [`FractalError::PolicyViolation`] if the range overflows `u64`.
    pub fn punch_hole(&mut self, offset: u64, length: u64) -> FractalResult<()> {
        if length == 0 {
            return Ok(());
        }

        sys::punch_hole(&self.file, offset, length)?;
        self.total_punched_bytes = self.total_punched_bytes.saturating_add(length);
        Ok(())
    }

    /// Returns the cumulative byte count released via hole punching.
    #[inline]
    pub fn total_punched_bytes(&self) -> u64 {
        self.total_punched_bytes
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

    /// Explicitly flushes file buffers.
    pub fn sync(&self) -> FractalResult<()> {
        self.file.sync_all().map_err(FractalError::Io)
    }

    /// Consumes the puncher, returning the inner [`File`].
    pub fn into_inner(self) -> File {
        self.file
    }

    /// Returns true if the host operating system supports hole punching primitives.
    pub const fn is_platform_supported() -> bool {
        cfg!(any(windows, target_os = "linux"))
    }
}

#[cfg(windows)]
mod sys {
    use super::*;
    use std::os::windows::io::AsRawHandle;

    const FSCTL_SET_SPARSE: u32 = 0x0009_00C4;
    const FSCTL_SET_ZERO_DATA: u32 = 0x0009_80C8;

    #[repr(C)]
    struct FileZeroDataInformation {
        file_offset: i64,
        beyond_final_zero: i64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn DeviceIoControl(
            h_device: *mut core::ffi::c_void,
            dw_io_control_code: u32,
            lp_in_buffer: *const core::ffi::c_void,
            n_in_buffer_size: u32,
            lp_out_buffer: *mut core::ffi::c_void,
            n_out_buffer_size: u32,
            lp_bytes_returned: *mut u32,
            lp_overlapped: *mut core::ffi::c_void,
        ) -> i32;
    }

    /// Sets the sparse file attribute on the underlying file handle via Win32 `FSCTL_SET_SPARSE`.
    pub fn mark_sparse(file: &File) -> FractalResult<()> {
        let handle = file.as_raw_handle();
        let mut bytes_returned: u32 = 0;

        // SAFETY: `handle` is an active Win32 handle owned by `file`.
        // FSCTL_SET_SPARSE takes no input buffer and produces no output buffer.
        let success = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_SET_SPARSE,
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                0,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };

        if success == 0 {
            let err = std::io::Error::last_os_error();
            return Err(FractalError::UnsupportedFilesystemCapability(format!(
                "mark sparse file: FSCTL_SET_SPARSE failed on volume: {err}"
            )));
        }

        Ok(())
    }

    /// Punches a sparse hole on Windows using `FSCTL_SET_ZERO_DATA`.
    pub fn punch_hole(file: &File, offset: u64, length: u64) -> FractalResult<()> {
        let handle = file.as_raw_handle();
        let beyond_final_zero = offset.checked_add(length).ok_or_else(|| {
            FractalError::PolicyViolation(
                "punch sparse hole: range offset + length overflowed u64".to_string(),
            )
        })?;

        let info = FileZeroDataInformation {
            file_offset: offset as i64,
            beyond_final_zero: beyond_final_zero as i64,
        };

        let mut bytes_returned: u32 = 0;

        // SAFETY: `handle` is an active Win32 handle owned by `file`.
        // `info` is allocated on the stack and resides in valid memory for the duration of the call.
        let success = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_SET_ZERO_DATA,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<FileZeroDataInformation>() as u32,
                std::ptr::null_mut(),
                0,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };

        if success == 0 {
            let err = std::io::Error::last_os_error();
            return Err(FractalError::UnsupportedFilesystemCapability(format!(
                "punch sparse hole: FSCTL_SET_ZERO_DATA failed for range [{offset}..{beyond_final_zero}]: {err}"
            )));
        }

        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod sys {
    use super::*;
    use std::os::unix::io::AsRawFd;

    const FALLOC_FL_KEEP_SIZE: i32 = 0x01;
    const FALLOC_FL_PUNCH_HOLE: i32 = 0x02;

    extern "C" {
        fn fallocate(fd: i32, mode: i32, offset: i64, len: i64) -> i32;
    }

    /// No-op on Linux since `fallocate` handles sparse hole creation natively.
    pub fn mark_sparse(_file: &File) -> FractalResult<()> {
        Ok(())
    }

    /// Punches a sparse hole using Linux kernel `fallocate` with `FALLOC_FL_PUNCH_HOLE`.
    pub fn punch_hole(file: &File, offset: u64, length: u64) -> FractalResult<()> {
        let fd = file.as_raw_fd();

        // SAFETY: `fd` is a valid open file descriptor borrowed from `file`.
        // `FALLOC_FL_PUNCH_HOLE | FALLOC_FL_KEEP_SIZE` is the standard Linux kernel interface
        // for deallocating block ranges without altering inode file size.
        let fallocate_status = unsafe {
            fallocate(
                fd,
                FALLOC_FL_PUNCH_HOLE | FALLOC_FL_KEEP_SIZE,
                offset as i64,
                length as i64,
            )
        };

        if fallocate_status != 0 {
            let err = std::io::Error::last_os_error();
            let end_offset = offset.saturating_add(length);
            return Err(FractalError::UnsupportedFilesystemCapability(format!(
                "punch sparse hole: fallocate FALLOC_FL_PUNCH_HOLE failed for range [{offset}..{end_offset}]: {err}"
            )));
        }

        Ok(())
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
mod sys {
    use super::*;

    /// Fallback implementation for unsupported platforms.
    pub fn mark_sparse(_file: &File) -> FractalResult<()> {
        Err(FractalError::UnsupportedFilesystemCapability(
            "Sparse files are not supported on this operating system".to_string(),
        ))
    }

    /// Fallback implementation for unsupported platforms.
    pub fn punch_hole(_file: &File, _offset: u64, _length: u64) -> FractalResult<()> {
        Err(FractalError::UnsupportedFilesystemCapability(
            "Hole punching is not supported on this operating system".to_string(),
        ))
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
    fn test_hole_puncher_on_local_filesystem() {
        if !HolePuncher::is_platform_supported() {
            return;
        }

        let dir = test_temp_dir("hole_punch_");
        let path = dir.path().join("sparse_test.bin");

        // Create 64KB test file filled with 0xAA.
        let pattern = vec![0xAAu8; 64 * 1024];
        std::fs::write(&path, &pattern).expect("write initial data");

        let puncher_res = HolePuncher::open_read_write(&path);
        let mut puncher = match puncher_res {
            Ok(p) => p,
            Err(FractalError::UnsupportedFilesystemCapability(_)) => {
                // Filesystem does not support sparse files (e.g. some virtual/exFAT mounts); skip.
                return;
            }
            Err(e) => panic!("Unexpected error opening hole puncher: {:?}", e),
        };

        // Punch a 16KB hole at offset 4096.
        let punch_res = puncher.punch_hole(4096, 16384);
        if let Err(FractalError::UnsupportedFilesystemCapability(_)) = punch_res {
            return;
        }
        assert!(punch_res.is_ok());
        assert_eq!(puncher.total_punched_bytes(), 16384);

        // Verify that the punched region reads back as zeroes (0x00), while outer regions stay 0xAA.
        let mut verified = Vec::new();
        puncher.file_mut().seek(SeekFrom::Start(0)).expect("seek 0");
        puncher.file_mut().read_to_end(&mut verified).expect("read");

        assert_eq!(verified.len(), 64 * 1024);
        // Prefix before hole: 0xAA
        assert!(verified[..4096].iter().all(|&b| b == 0xAA));
        // Punched hole: 0x00
        assert!(verified[4096..4096 + 16384].iter().all(|&b| b == 0x00));
        // Suffix after hole: 0xAA
        assert!(verified[4096 + 16384..].iter().all(|&b| b == 0xAA));
    }
}
