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
//! - `FGT-SAF-001`: Unsafe block proof and raw pointer isolation guard

use std::fs;
use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::write_file_atomic;

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
    let mut perms = fs::metadata(path).map_err(FractalError::Io)?.permissions();
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
        // Read contents before detaching the shared hardlink, then stage and replace atomically.
        let contents = fs::read(path)?;
        let _ = set_readonly(path, false);
        fs::remove_file(path)?;
        write_file_atomic(path, &contents, false)?;
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
        fn SetFilePointerEx(
            hFile: *mut core::ffi::c_void,
            liDistanceToMove: i64,
            lpNewFilePointer: *mut i64,
            dwMoveMethod: u32,
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
    const FILE_BEGIN: u32 = 0;
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
    let src_len = i64::try_from(src_meta.len()).map_err(|_| {
        FractalError::CorruptStore(format!(
            "source path '{}' length {} exceeds i64 extent range",
            src.display(),
            src_meta.len()
        ))
    })?;
    if src_len == 0 {
        // Zero-length files do not need extent cloning; a simple create suffices.
        fs::write(dst, [])?;
        return Ok(());
    }

    let mut src_wide: Vec<u16> = src.as_os_str().encode_wide().collect();
    src_wide.push(0);
    let mut dst_wide: Vec<u16> = dst.as_os_str().encode_wide().collect();
    dst_wide.push(0);

    // SAFETY: Invariant: `CreateFileW` reads a NUL-terminated UTF-16 path without retaining pointers.
    // Precondition: `src_wide` ends with `0u16` and stays alive across the FFI call.
    // Postcondition: Returns either `INVALID_HANDLE_VALUE` (checked immediately) or an owned handle.
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

    // SAFETY: Invariant: `CreateFileW` creates/truncates the UTF-16 path without retaining pointers.
    // Precondition: `dst_wide` ends with `0u16` and stays alive across the FFI call.
    // Postcondition: Returns either `INVALID_HANDLE_VALUE` (checked immediately) or an owned handle.
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
        let os_err = std::io::Error::last_os_error();
        // SAFETY: Invariant: `CloseHandle` releases an open Win32 kernel handle once.
        // Precondition: `h_src != INVALID_HANDLE_VALUE` was verified above and is not used afterwards.
        // Postcondition: `h_src` is closed before returning the `CreateFileW` error.
        unsafe {
            CloseHandle(h_src);
        }
        return Err(FractalError::Io(os_err));
    }

    // Advance the destination file pointer to `src_len` and commit EOF so ReFS extent duplication
    // sees a destination range `[0, src_len)` within target EOF (`FGT-SAF-001`).
    // SAFETY: Invariant: `SetFilePointerEx` and `SetEndOfFile` operate on an open writable file handle.
    // Precondition: `h_dst` is valid and `src_len > 0` fits in non-negative `i64`; `lpNewFilePointer` is null.
    // Postcondition: Non-zero status confirms `h_dst` logical length equals `src_len`.
    let resize_ok = unsafe {
        SetFilePointerEx(h_dst, src_len, std::ptr::null_mut(), FILE_BEGIN) != 0
            && SetEndOfFile(h_dst) != 0
    };
    if !resize_ok {
        let os_err = std::io::Error::last_os_error();
        // SAFETY: Invariant: Both handles are open and exclusively owned by this stack frame.
        // Precondition: `h_dst` and `h_src` were validated against `INVALID_HANDLE_VALUE`.
        // Postcondition: Both handles are closed prior to unlinking the partial destination file.
        unsafe {
            CloseHandle(h_dst);
            CloseHandle(h_src);
        }
        let _ = fs::remove_file(dst);
        return Err(FractalError::Io(os_err));
    }

    let clone_params = DuplicateExtentsData {
        file_handle: h_src,
        source_file_offset: 0,
        target_file_offset: 0,
        byte_count: src_len,
    };

    let mut bytes_returned: u32 = 0;
    // SAFETY: Invariant: Synchronous `FSCTL_DUPLICATE_EXTENTS_TO_FILE` reads `DuplicateExtentsData` in-place.
    // Precondition: `h_dst` and `h_src` are open handles, `clone_params` is `#[repr(C)]`, and `bytes_returned` is valid.
    // Postcondition: Kernel either clones extents (non-zero return) or leaves an error retrievable via `last_os_error`.
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
    let ioctl_err = if success == 0 {
        Some(std::io::Error::last_os_error())
    } else {
        None
    };

    // SAFETY: Invariant: Both Win32 handles were opened in this function and have not been closed yet.
    // Precondition: `DeviceIoControl` has completed synchronously (`lpOverlapped` was null).
    // Postcondition: Both handles are released without handle leaks on either success or fallback paths.
    unsafe {
        CloseHandle(h_dst);
        CloseHandle(h_src);
    }

    if let Some(err) = ioctl_err {
        // If block cloning failed (e.g. partition is standard NTFS), remove half-created target
        let _ = fs::remove_file(dst);
        return Err(FractalError::Io(err));
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

    // SAFETY: Invariant: `FICLONE` ioctl clones file extents between two open Linux file descriptors.
    // Precondition: Both `src_file` and `dst_file` are open descriptors outliving the `ioctl` syscall.
    // Postcondition: Returns `0` on success or `-1` (leaving `errno` set) without invalidating either fd.
    let ioctl_status = unsafe { libc::ioctl(dst_file.as_raw_fd(), FICLONE, src_file.as_raw_fd()) };

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
