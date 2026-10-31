//! Module: fg-native — Windows Directory Junction
//! File Path: crates/fg-native/src/junction.rs
//! Architecture Role: Creates the reparse-point link that a release-mode workspace uses to reach its
//!   store directory, without requiring an elevated token.
//! Dependencies & Triggers: Called by `taxis init --release`; consumed indirectly by
//!   `classify_workspace_entry`, which detects the same reparse point.
//! Responsibilities: Encode the mount-point reparse buffer and hand it to the filesystem.
//! Exit Semantics & Design Rationale:
//!   - A junction is used rather than a symbolic link because creating a symbolic link requires
//!     `SeCreateSymbolicLinkPrivilege`, which a normal user token does not hold; the first attempt at
//!     `--release` failed with `os error 1314` for exactly that reason. A junction needs no
//!     privilege, which is what makes the store layout usable without administrator rights.
//!   - The buffer is built by hand rather than through a shell command. Shelling out to `mklink`
//!     would add a process dependency to the one operation whose whole purpose is to remove
//!     dependencies.
//!   - The substitute name is the `\??\`-prefixed form the object manager resolves; the print name is
//!     the ordinary path shown by `dir` and Explorer. Writing only one of them yields a link that
//!     either resolves or displays, never both.
//!   - Every pointer handed to Win32 is derived from a buffer that outlives the call, and every
//!     `unsafe` block states that invariant. No pointer is retained by the callee.

use std::path::Path;

use crate::error::{NativeError, NativeResult};

/// Maximum size the filesystem accepts for one reparse buffer.
const MAX_REPARSE_BUFFER_LEN: usize = 16 * 1024;

/// `FSCTL_SET_REPARSE_POINT`: attaches a reparse point to an existing directory handle.
const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;

/// `IO_REPARSE_TAG_MOUNT_POINT`: the tag that makes a reparse point a junction.
const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;

/// Byte length of the reparse buffer header: tag (4) + data length (2) + reserved (2).
const REPARSE_HEADER_LEN: usize = 8;

/// Byte length of the mount-point field block: four offsets and lengths.
const MOUNT_POINT_FIELDS_LEN: usize = 8;

/// Reports whether the platform can create a junction.
pub const fn is_supported() -> bool {
    cfg!(windows)
}

/// Creates a directory junction at `link_path` pointing at `target`.
///
/// The link path must not exist, and the target must already be a directory.
///
/// # Errors
///
/// Returns [`NativeError::Io`] when the target is missing, the link path already exists, or the
/// filesystem rejects the reparse buffer.
#[cfg(windows)]
pub fn create_junction(link_path: &Path, target: &Path) -> NativeResult<()> {
    if !target.is_dir() {
        return Err(NativeError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("junction target '{}' is not a directory", target.display()),
        )));
    }
    if link_path.exists() {
        return Err(NativeError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("junction path '{}' already exists", link_path.display()),
        )));
    }

    let buffer = encode_mount_point_buffer(target)?;
    set_reparse_point(link_path, &buffer)
}

/// Reports that junctions are a Windows concept and are refused elsewhere.
///
/// # Errors
///
/// Always returns [`NativeError::Io`] with `Unsupported`. Refusing is deliberate: silently creating a
/// real directory instead would give the caller a layout that looks like a link and behaves like a
/// copy, so the store would stop being the single source of truth without anyone noticing.
#[cfg(not(windows))]
pub fn create_junction(link_path: &Path, _target: &Path) -> NativeResult<()> {
    Err(NativeError::Io(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        format!(
            "directory junctions are not available on this platform; cannot link '{}'",
            link_path.display()
        ),
    )))
}

/// Builds the `REPARSE_DATA_BUFFER` payload for a mount point.
#[cfg(windows)]
fn encode_mount_point_buffer(target: &Path) -> NativeResult<Vec<u8>> {
    // Strip extended-length verbatim `\\?\` prefix before prepending `\??\` so canonicalized
    // paths never produce an invalid `\??\\\?\` NT object-manager target.
    let raw_target_text = target.display().to_string();
    let clean_target = raw_target_text
        .strip_prefix(r"\\?\")
        .unwrap_or(raw_target_text.as_str());
    let substitute = format!(r"\??\{clean_target}");

    let substitute_units: Vec<u16> = substitute.encode_utf16().collect();
    let print_units: Vec<u16> = clean_target.encode_utf16().collect();

    let substitute_bytes = substitute_units.len() * 2;
    let print_bytes = print_units.len() * 2;
    // Each name is followed by a NUL terminator, which is not counted in the recorded lengths.
    let path_bytes = substitute_bytes + 2 + print_bytes + 2;
    let total_len = REPARSE_HEADER_LEN + MOUNT_POINT_FIELDS_LEN + path_bytes;

    if total_len > MAX_REPARSE_BUFFER_LEN {
        return Err(NativeError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "junction target path is too long: {total_len} bytes exceeds {MAX_REPARSE_BUFFER_LEN}"
            ),
        )));
    }

    let mut buffer = Vec::with_capacity(total_len);
    buffer.extend_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    let data_len = (MOUNT_POINT_FIELDS_LEN + path_bytes) as u16;
    buffer.extend_from_slice(&data_len.to_le_bytes());
    buffer.extend_from_slice(&0u16.to_le_bytes());

    buffer.extend_from_slice(&0u16.to_le_bytes());
    buffer.extend_from_slice(&(substitute_bytes as u16).to_le_bytes());
    buffer.extend_from_slice(&((substitute_bytes + 2) as u16).to_le_bytes());
    buffer.extend_from_slice(&(print_bytes as u16).to_le_bytes());

    for unit in substitute_units {
        buffer.extend_from_slice(&unit.to_le_bytes());
    }
    buffer.extend_from_slice(&0u16.to_le_bytes());
    for unit in print_units {
        buffer.extend_from_slice(&unit.to_le_bytes());
    }
    buffer.extend_from_slice(&0u16.to_le_bytes());

    Ok(buffer)
}

/// Opens `link_path` and attaches `buffer` as its reparse point.
#[cfg(windows)]
fn set_reparse_point(link_path: &Path, buffer: &[u8]) -> NativeResult<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            lp_file_name: *const u16,
            dw_desired_access: u32,
            dw_share_mode: u32,
            lp_security_attributes: *const core::ffi::c_void,
            dw_creation_disposition: u32,
            dw_flags_and_attributes: u32,
            h_template_file: *mut core::ffi::c_void,
        ) -> *mut core::ffi::c_void;
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
        fn CloseHandle(h_object: *mut core::ffi::c_void) -> i32;
    }

    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_READ_WRITE_DELETE: u32 = 0x0000_0007;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const INVALID_HANDLE_VALUE: *mut core::ffi::c_void = -1isize as *mut core::ffi::c_void;

    let mut wide_path: Vec<u16> = link_path.as_os_str().encode_wide().collect();
    wide_path.push(0);

    // SAFETY: `wide_path` is a NUL-terminated UTF-16 buffer that outlives the call. The remaining
    // arguments are scalars or nulls documented as optional; `CreateFileW` copies the name and does
    // not retain the pointer.
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ_WRITE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        return Err(NativeError::Io(std::io::Error::last_os_error()));
    }

    let mut bytes_returned: u32 = 0;
    // SAFETY: `handle` is a live handle to the directory opened above; `buffer` is a live slice of
    // exactly `buffer.len()` bytes, and its length is passed alongside it. The output buffer is null
    // with a zero size because this control code produces no output, and the callee does not retain
    // any pointer.
    let applied = unsafe {
        DeviceIoControl(
            handle,
            FSCTL_SET_REPARSE_POINT,
            buffer.as_ptr().cast(),
            buffer.len() as u32,
            std::ptr::null_mut(),
            0,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };
    let control_error = if applied == 0 {
        Some(std::io::Error::last_os_error())
    } else {
        None
    };

    // SAFETY: `handle` came from `CreateFileW` and has not been closed yet; closing it exactly once
    // is the only requirement `CloseHandle` places on its argument.
    unsafe {
        CloseHandle(handle);
    }

    match control_error {
        Some(error) => Err(NativeError::Io(error)),
        None => Ok(()),
    }
}
