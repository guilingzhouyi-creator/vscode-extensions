//! Module: fg-storage — Copy-on-Write Block Cloning & Ghost Link Engine
//! File Path: crates/fg-storage/src/reflink.rs
//! Architecture Role: Provides zero-copy physical workspace instantiation via OS-level block
//!   reflink (Windows ReFS/Dev Drive FSCTL_DUPLICATE_EXTENTS_TO_FILE, Linux FICLONE) and
//!   read-only hardlink pools with user-space Copy-on-Write detachment.
//! Dependencies & Triggers: Consumed by worktree materializers, quarantine managers, and CAS bridges.
//! Responsibilities: Instant file projection, block extent duplication, and write-time isolation.
//! Exit Semantics & Design Rationale:
//!   - Tier 1: Attempts true filesystem extent duplication (0 bytes delta, OS-managed block CoW).
//!   - Tier 2: Falls back to read-only hardlink projection (`GhostHardlink`), preventing accidental
//!     in-place mutation while preserving 0-byte initial allocation.
//!   - Tier 3: Falls back to full deep copy across volume/filesystem boundaries.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot path queries

use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};

/// Classification of physical file instantiation strategy used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReflinkKind {
    /// Operating-system level block extent clone (0 bytes delta, hardware/FS-level CoW).
    BlockCloned,
    /// Read-only hardlink to backing store with CoW detach protection (0 bytes delta).
    GhostHardlink,
    /// Independent full byte copy (used across volume boundaries or unsupported FS).
    DeepCopied,
}

/// Sets or unsets the read-only flag on target path.
pub fn set_readonly(path: &Path, readonly: bool) -> FractalResult<()> {
    let mut perms = fs::metadata(path)
        .map_err(FractalError::Io)?
        .permissions();
    perms.set_readonly(readonly);
    fs::set_permissions(path, perms).map_err(FractalError::Io)
}

/// Reports whether target path has read-only protection.
pub fn is_readonly(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.permissions().readonly())
        .unwrap_or(false)
}

/// Projects `src` to `dst` using the most efficient CoW strategy available on the host filesystem.
pub fn clone_file_cow(src: &Path, dst: &Path) -> FractalResult<ReflinkKind> {
    if !src.is_file() {
        return Err(FractalError::CorruptStore(format!(
            "source path '{}' does not exist or is not a regular file",
            src.display()
        )));
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }

    // Tier 1: Try OS-level block cloning (ReFS / Dev Drive / Btrfs / XFS)
    #[cfg(windows)]
    {
        if let Ok(()) = win_block_clone(src, dst) {
            return Ok(ReflinkKind::BlockCloned);
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(()) = linux_block_clone(src, dst) {
            return Ok(ReflinkKind::BlockCloned);
        }
    }

    // Tier 2: Ghost Linking — read-only hardlink to backing file
    if let Ok(()) = fs::hard_link(src, dst) {
        let _ = set_readonly(dst, true);
        return Ok(ReflinkKind::GhostHardlink);
    }

    // Tier 3: Deep copy fallback across filesystem boundaries
    fs::copy(src, dst)?;
    Ok(ReflinkKind::DeepCopied)
}

/// Detaches a ghost-hardlinked or read-only file into an independent mutable private copy.
///
/// If target is read-only or shared, breaks the hardlink via atomic staged copy and enables writes.
/// Returns true if detachment occurred, false if file was already independent and writable.
pub fn detach_for_write(path: &Path) -> FractalResult<bool> {
    if !path.exists() {
        return Ok(false);
    }

    if is_readonly(path) {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let temp_path = parent.join(format!(
            ".detach_{}_{}.tmp",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));

        // Read contents before removing hardlink
        let contents = fs::read(path)?;
        fs::write(&temp_path, contents)?;

        // Ensure target is removable on Windows even if readonly
        let _ = set_readonly(path, false);
        fs::remove_file(path)?;
        fs::rename(&temp_path, path)?;
        set_readonly(path, false)?;
        return Ok(true);
    }

    Ok(false)
}

#[cfg(windows)]
fn win_block_clone(src: &Path, dst: &Path) -> FractalResult<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            lpFileName: *const u16,
            dwDesiredAccess: u32,
            dwShareMode: u32,
            lpSecurityAttributes: *const core::ffi::c_void,
            dwCreationDisposition: u32,
            dwFlagsAndAttributes: u32,
            hTemplateFile: *mut core::ffi::c_void,
        ) -> *mut core::ffi::c_void;
        fn DeviceIoControl(
            hDevice: *mut core::ffi::c_void,
            dwIoControlCode: u32,
            lpInBuffer: *const core::ffi::c_void,
            nInBufferSize: u32,
            lpOutBuffer: *mut core::ffi::c_void,
            nOutBufferSize: u32,
            lpBytesReturned: *mut u32,
            lpOverlapped: *mut core::ffi::c_void,
        ) -> i32;
        fn SetEndOfFile(hFile: *mut core::ffi::c_void) -> i32;
        fn CloseHandle(hObject: *mut core::ffi::c_void) -> i32;
    }

    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const OPEN_EXISTING: u32 = 3;
    const CREATE_ALWAYS: u32 = 2;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;
    const INVALID_HANDLE_VALUE: *mut core::ffi::c_void = -1isize as *mut core::ffi::c_void;
    const FSCTL_DUPLICATE_EXTENTS_TO_FILE: u32 = 0x0009_8344;

    #[repr(C)]
    struct DuplicateExtentsData {
        file_handle: *mut core::ffi::c_void,
        source_file_offset: i64,
        target_file_offset: i64,
        byte_count: i64,
    }

    let src_meta = fs::metadata(src)?;
    let src_len = src_meta.len() as i64;
    if src_len == 0 {
        // Zero-length files do not need extent cloning; a simple create suffices.
        fs::write(dst, [])?;
        return Ok(());
    }

    let mut src_wide: Vec<u16> = src.as_os_str().encode_wide().collect();
    src_wide.push(0);
    let mut dst_wide: Vec<u16> = dst.as_os_str().encode_wide().collect();
    dst_wide.push(0);

    // SAFETY: `src_wide` is a valid NUL-terminated UTF-16 buffer outliving CreateFileW.
    let h_src = unsafe {
        CreateFileW(
            src_wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if h_src == INVALID_HANDLE_VALUE {
        return Err(FractalError::Io(std::io::Error::last_os_error()));
    }

    // SAFETY: `dst_wide` is a valid NUL-terminated UTF-16 buffer outliving CreateFileW.
    let h_dst = unsafe {
        CreateFileW(
            dst_wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ,
            std::ptr::null(),
            CREATE_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if h_dst == INVALID_HANDLE_VALUE {
        // SAFETY: `h_src` was validated as non-invalid above.
        unsafe { CloseHandle(h_src) };
        return Err(FractalError::Io(std::io::Error::last_os_error()));
    }

    // Set target file size to match source file before cloning extents
    // SAFETY: `h_dst` is an open writable handle.
    let _ = unsafe { SetEndOfFile(h_dst) };

    let clone_params = DuplicateExtentsData {
        file_handle: h_src,
        source_file_offset: 0,
        target_file_offset: 0,
        byte_count: src_len,
    };

    let mut bytes_returned: u32 = 0;
    // SAFETY: `h_dst` is target handle; `clone_params` contains open `h_src` handle and valid offsets.
    let success = unsafe {
        DeviceIoControl(
            h_dst,
            FSCTL_DUPLICATE_EXTENTS_TO_FILE,
            (&clone_params as *const DuplicateExtentsData).cast(),
            std::mem::size_of::<DuplicateExtentsData>() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    // SAFETY: Closing both handles cleanly to avoid leaks.
    unsafe {
        CloseHandle(h_dst);
        CloseHandle(h_src);
    }

    if success == 0 {
        // If block cloning failed (e.g. partition is standard NTFS), remove half-created target
        let _ = fs::remove_file(dst);
        return Err(FractalError::Io(std::io::Error::last_os_error()));
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_block_clone(src: &Path, dst: &Path) -> FractalResult<()> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::io::AsRawFd;

    // FICLONE ioctl code: _IOW(0x94, 9, int) = 0x40049409
    const FICLONE: libc::c_ulong = 0x4004_9409;

    let src_file = fs::File::open(src)?;
    let dst_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o644)
        .open(dst)?;

    // SAFETY: `src_file` and `dst_file` are valid open file descriptors.
    let ioctl_status = unsafe {
        libc::ioctl(dst_file.as_raw_fd(), FICLONE, src_file.as_raw_fd())
    };

    if ioctl_status != 0 {
        let _ = fs::remove_file(dst);
        return Err(FractalError::Io(std::io::Error::last_os_error()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(label: &str) -> std::path::PathBuf {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = fs::create_dir_all(&base);
        let path = base.join(format!(
            "taxis_reflink_{}_{}_{}",
            label,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create scratch directory");
        path
    }

    #[test]
    fn test_clone_file_cow_and_detach_lifecycle() {
        let temp_dir = scratch_dir("lifecycle");
        let src = temp_dir.join("source.txt");
        let dst = temp_dir.join("clone.txt");

        fs::write(&src, "initial content for cow test\n").expect("write source");

        let kind = clone_file_cow(&src, &dst).expect("cow clone must succeed");
        assert!(dst.exists());
        assert_eq!(
            fs::read_to_string(&dst).expect("read clone"),
            "initial content for cow test\n"
        );

        match kind {
            ReflinkKind::BlockCloned => {
                // OS CoW: directly write to dst without error, verify independence
                fs::write(&dst, "updated in block clone\n").expect("write to cloned block");
                assert_eq!(
                    fs::read_to_string(&src).expect("read src"),
                    "initial content for cow test\n"
                );
                assert_eq!(
                    fs::read_to_string(&dst).expect("read dst"),
                    "updated in block clone\n"
                );
            }
            ReflinkKind::GhostHardlink => {
                // Hardlink CoW: should be readonly initially
                assert!(is_readonly(&dst));
                // Detach for write
                let detached = detach_for_write(&dst).expect("detach must succeed");
                assert!(detached);
                assert!(!is_readonly(&dst));
                // Write to dst and assert src is unchanged
                fs::write(&dst, "mutated after detach\n").expect("write after detach");
                assert_eq!(
                    fs::read_to_string(&src).expect("read src"),
                    "initial content for cow test\n"
                );
                assert_eq!(
                    fs::read_to_string(&dst).expect("read dst"),
                    "mutated after detach\n"
                );
            }
            ReflinkKind::DeepCopied => {
                // Deep copy: verify independence
                fs::write(&dst, "mutated deep copy\n").expect("write deep copy");
                assert_eq!(
                    fs::read_to_string(&src).expect("read src"),
                    "initial content for cow test\n"
                );
            }
        }

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
