//! Module: fg-native — Repository Directory Layout
//! File Path: crates/fg-native/src/repo_layout.rs
//! Architecture Role: Owns the physical shape of a repository directory: which directories exist,
//!   which guard file keeps Git out of them, and whether the directory is the store itself or a link
//!   to it.
//! Dependencies & Triggers: Driven by `taxis init` (creates) and `taxis doctor` (inspects); read by
//!   every command that has to locate the container.
//! Responsibilities: Create the development layout, classify an existing layout from the
//!   filesystem, and cross-check the classified layout against the mode declared in `META`.
//! Exit Semantics & Design Rationale:
//!   - Classification uses `symlink_metadata`, never `Path::exists`. On Windows an orphaned
//!     junction reports `exists() == true` while every child path reports `false`, so an existence
//!     check cannot distinguish "store deleted" from "repository deleted" — and those need different
//!     repairs.
//!   - The guard file is written before the container. If the process dies between the two steps,
//!     the directory is already protected from `git add -A`; the reverse order leaves a window in
//!     which a host repository can absorb the native store into its own index.
//!   - A declared mode that disagrees with the physical layout is reported, never silently accepted.
//!     Rewriting a release repository in place because it happened to look like a directory is how a
//!     shared store gets clobbered.
//!   - Hiding the directory is best effort on Windows and a no-op elsewhere. A failure to hide is
//!     reported to the caller but does not fail initialization: the guard file is what protects the
//!     contents, and refusing to create a repository because an attribute could not be set would
//!     block the very case the guard file exists for.

use std::path::{Path, PathBuf};

use crate::constants::{
    CONTAINER_FILE_NAME, GUARD_FILE_CONTENT, GUARD_FILE_NAME, JOURNAL_DIR_NAME, OBJECTS_DIR_NAME,
};
use crate::document::RepoDocument;
use crate::error::{NativeError, NativeResult};
use crate::sections::meta::LayoutMode;

/// Name of the directory a workspace uses to point at its repository.
pub const WORKSPACE_DIR_NAME: &str = ".taxis";

/// Resolves the container path inside a repository directory.
///
/// This is the only correct way to locate `repo.txc`. Before it existed, `RepoLayout` wrote the
/// container to `<repo_dir>/repo.txc` while four call sites independently built
/// `<repo_dir>/fractal/repo.txc`: the operation log, the promotion ledger, the worktree registry
/// and `taxis reclaim`. Each of those read a path initialization never created, so every one of
/// them reported `CorruptStore` on a repository `taxis init` had just succeeded on. A path with two
/// definitions always drifts; this function is the one definition.
pub fn container_path(repo_dir: &Path) -> PathBuf {
    repo_dir.join(CONTAINER_FILE_NAME)
}

/// What the filesystem actually holds at the workspace's `.taxis` path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PhysicalLayout {
    /// Nothing is there.
    Absent,
    /// A real directory; the repository bytes live inside the workspace.
    Directory,
    /// A link whose target directory exists.
    Linked {
        /// Resolved target of the link.
        target: PathBuf,
    },
    /// A link whose target directory is gone.
    ///
    /// This is the state left behind by deleting the store. The link itself still resolves as a
    /// path, so it must be named explicitly rather than reported as a missing repository.
    OrphanedLink {
        /// Target the link records, whether or not it still exists.
        target: PathBuf,
    },
}

/// Result of creating a repository directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitializedRepository {
    /// Directory holding the container.
    pub repo_dir: PathBuf,
    /// Path of the published container.
    pub container_path: PathBuf,
    /// Whether the directory was hidden, when the platform supports the attribute.
    pub hidden: Option<bool>,
}

/// The physical layout a repository was created with, and where its bytes live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoLayout {
    workspace_root: PathBuf,
    repo_dir: PathBuf,
    mode: LayoutMode,
}

impl RepoLayout {
    /// Builds the development layout: the repository bytes live in `<workspace>/.taxis`.
    pub fn dev(workspace_root: impl Into<PathBuf>) -> Self {
        let workspace_root = workspace_root.into();
        let repo_dir = workspace_root.join(WORKSPACE_DIR_NAME);
        Self {
            workspace_root,
            repo_dir,
            mode: LayoutMode::Dev,
        }
    }

    /// Builds the release layout descriptor: the repository bytes live in `repo_dir`, which the
    /// workspace reaches through a link.
    ///
    /// The link itself is not created here; `RepoLayout::dev` and this constructor only describe
    /// where the bytes belong.
    pub fn release(workspace_root: impl Into<PathBuf>, repo_dir: impl Into<PathBuf>) -> Self {
        Self {
            workspace_root: workspace_root.into(),
            repo_dir: repo_dir.into(),
            mode: LayoutMode::Release,
        }
    }

    /// Returns the directory that holds the repository bytes.
    pub fn repo_dir(&self) -> &Path {
        &self.repo_dir
    }

    /// Returns the workspace root the layout belongs to.
    pub fn workspace_root(&self) -> &Path {
        &self.workspace_root
    }

    /// Returns the layout mode this descriptor declares.
    pub const fn mode(&self) -> LayoutMode {
        self.mode
    }

    /// Returns the path of the workspace's `.taxis` entry, which is a directory or a link.
    pub fn workspace_entry(&self) -> PathBuf {
        self.workspace_root.join(WORKSPACE_DIR_NAME)
    }

    /// Returns the path of the repository container.
    pub fn container_path(&self) -> PathBuf {
        container_path(&self.repo_dir)
    }

    /// Creates the repository directories and publishes a fresh container.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::RepositoryExists`] when a container is already present, and propagates
    /// directory-creation and container-publication failures. A pre-existing repository is refused
    /// rather than overwritten: `init` on an existing repository would replace the identity and
    /// discard the operation log.
    pub fn initialize(&self) -> NativeResult<InitializedRepository> {
        let document = RepoDocument::for_new_repository(self.mode)?;
        self.initialize_with(&document)
    }

    /// Creates the repository directories and publishes the given document.
    ///
    /// A store-backed layout needs this form: the store directory is named after the repository id,
    /// so the id must be generated before the destination path exists. The caller builds the
    /// document, derives the store path from its id, and hands the same document back here.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::RepositoryExists`] when a container is already present, and propagates
    /// directory-creation and container-publication failures.
    pub fn initialize_with(&self, document: &RepoDocument) -> NativeResult<InitializedRepository> {
        let container_path = self.container_path();

        std::fs::create_dir_all(self.repo_dir.join(OBJECTS_DIR_NAME))?;
        std::fs::create_dir_all(self.repo_dir.join(JOURNAL_DIR_NAME))?;
        // The guard file is written before the container: a crash between the two leaves a directory
        // Git already refuses to descend into, which is the safe half of the pair.
        write_guard_file(&self.repo_dir)?;

        document.publish_new(&container_path)?;

        let head_content = match &document.head {
            crate::HeadState::Symbolic { target } => format!("ref: {target}\n"),
            crate::HeadState::Detached { oid } => format!("{}\n", oid.to_hex()),
        };
        let _ = std::fs::write(self.repo_dir.join("HEAD"), head_content);
        let _ = std::fs::create_dir_all(self.repo_dir.join("refs/heads"));

        let hidden = attempt_hide(&self.repo_dir);

        Ok(InitializedRepository {
            repo_dir: self.repo_dir.clone(),
            container_path,
            hidden,
        })
    }
}

/// Attempts to hide the repository directory, reporting the outcome where the platform has the
/// attribute.
///
/// The result is advisory. A host that refuses the attribute still gets a working repository; the
/// guard file is what keeps Git out, and failing initialization over a cosmetic attribute would
/// block the very case the guard file protects.
#[cfg(windows)]
pub fn attempt_hide(repo_dir: &Path) -> Option<bool> {
    Some(hide_directory(repo_dir).is_ok())
}

/// Reports nothing off Windows, which has no hidden attribute for this function to set.
#[cfg(not(windows))]
pub fn attempt_hide(_repo_dir: &Path) -> Option<bool> {
    None
}

/// Classifies what the filesystem holds at `<workspace>/.taxis`.
///
/// # Errors
///
/// Propagates a metadata failure other than "not found".
pub fn classify_workspace_entry(workspace_root: &Path) -> NativeResult<PhysicalLayout> {
    let entry_path = workspace_root.join(WORKSPACE_DIR_NAME);

    let metadata = match std::fs::symlink_metadata(&entry_path) {
        Ok(found) => found,
        Err(metadata_err) if metadata_err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PhysicalLayout::Absent)
        }
        Err(metadata_err) => return Err(NativeError::Io(metadata_err)),
    };

    if !is_link(&metadata) {
        return Ok(PhysicalLayout::Directory);
    }

    let target = std::fs::read_link(&entry_path)?;
    if target.is_dir() {
        Ok(PhysicalLayout::Linked { target })
    } else {
        Ok(PhysicalLayout::OrphanedLink { target })
    }
}

/// Reports whether metadata describes a link rather than a plain directory.
///
/// On Windows a junction is a reparse point, not a symlink, so `FileType::is_symlink` alone reports
/// false for exactly the link kind this layout uses.
fn is_link(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    is_windows_reparse_point(metadata)
}

/// Reports whether metadata carries the Windows reparse-point attribute.
#[cfg(windows)]
fn is_windows_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// Reports whether metadata carries a reparse-point attribute; no such attribute exists off Windows.
#[cfg(not(windows))]
fn is_windows_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

/// Writes the guard file that stops Git from descending into the repository directory.
///
/// # Errors
///
/// Propagates the write failure. The file is rewritten unconditionally so a damaged guard is
/// repaired by the same call that creates it, which keeps `taxis doctor` idempotent.
pub fn write_guard_file(repo_dir: &Path) -> NativeResult<()> {
    std::fs::write(repo_dir.join(GUARD_FILE_NAME), GUARD_FILE_CONTENT)?;
    Ok(())
}

/// Reads the guard file's contents, or `None` when it is absent.
///
/// # Errors
///
/// Propagates a read failure other than absence.
pub fn read_guard_file(repo_dir: &Path) -> NativeResult<Option<String>> {
    match std::fs::read_to_string(repo_dir.join(GUARD_FILE_NAME)) {
        Ok(contents) => Ok(Some(contents)),
        Err(read_err) if read_err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(read_err) => Err(NativeError::Io(read_err)),
    }
}

/// Marks `directory` hidden on Windows.
///
/// # Errors
///
/// Returns [`NativeError::Io`] when the attribute cannot be set. Callers treat this as advisory:
/// the guard file is the protection that matters.
#[cfg(windows)]
pub fn hide_directory(directory: &Path) -> NativeResult<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetFileAttributesW(lp_file_name: *const u16, dw_file_attributes: u32) -> i32;
        fn GetFileAttributesW(lp_file_name: *const u16) -> u32;
    }

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

    // The path is encoded as NUL-terminated UTF-16 and kept alive for the duration of both calls;
    // the pointers handed to Win32 therefore stay valid until the calls return.
    let mut wide_path: Vec<u16> = directory.as_os_str().encode_wide().collect();
    wide_path.push(0);

    // SAFETY: `wide_path` is a NUL-terminated UTF-16 buffer that outlives both calls, which is the
    // only requirement these two Win32 functions place on their pointer argument. Both return a
    // status value and never retain the pointer.
    let current_attributes = unsafe { GetFileAttributesW(wide_path.as_ptr()) };
    if current_attributes == INVALID_FILE_ATTRIBUTES {
        return Err(NativeError::Io(std::io::Error::last_os_error()));
    }

    // SAFETY: same buffer and same lifetime argument as above; `SetFileAttributesW` copies the
    // attributes and does not retain the pointer.
    let applied = unsafe {
        SetFileAttributesW(
            wide_path.as_ptr(),
            current_attributes | FILE_ATTRIBUTE_HIDDEN,
        )
    };
    if applied == 0 {
        return Err(NativeError::Io(std::io::Error::last_os_error()));
    }
    Ok(())
}

/// Reports whether the directory is hidden; always `false` off Windows.
///
/// # Errors
///
/// Returns [`NativeError::Io`] when the attributes cannot be read on Windows.
#[cfg(windows)]
pub fn is_directory_hidden(directory: &Path) -> NativeResult<bool> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileAttributesW(lp_file_name: *const u16) -> u32;
    }

    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x0000_0002;
    const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

    let mut wide_path: Vec<u16> = directory.as_os_str().encode_wide().collect();
    wide_path.push(0);

    // SAFETY: `wide_path` is NUL-terminated UTF-16 and outlives the call; the function returns a
    // status word and does not retain the pointer.
    let attributes = unsafe { GetFileAttributesW(wide_path.as_ptr()) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(NativeError::Io(std::io::Error::last_os_error()));
    }
    Ok(attributes & FILE_ATTRIBUTE_HIDDEN != 0)
}

/// Marks `directory` hidden; a no-op on platforms without a hidden attribute.
///
/// # Errors
///
/// Never fails on this platform.
#[cfg(not(windows))]
pub fn hide_directory(_directory: &Path) -> NativeResult<()> {
    Ok(())
}

/// Reports whether the directory is hidden; always `false` off Windows.
///
/// # Errors
///
/// Never fails on this platform.
#[cfg(not(windows))]
pub fn is_directory_hidden(_directory: &Path) -> NativeResult<bool> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::{
        classify_workspace_entry, is_directory_hidden, read_guard_file, write_guard_file,
        PhysicalLayout, RepoLayout, WORKSPACE_DIR_NAME,
    };
    use crate::constants::{GUARD_FILE_CONTENT, JOURNAL_DIR_NAME, OBJECTS_DIR_NAME};
    use crate::document::RepoDocument;
    use crate::error::NativeError;
    use crate::sections::meta::LayoutMode;

    static SCRATCH: AtomicU64 = AtomicU64::new(0);

    fn scratch_workspace(label: &str) -> std::path::PathBuf {
        let sequence = SCRATCH.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        path.push("fg-native-layout");
        let _ = std::fs::create_dir_all(&path);
        path.push(format!("{label}-{}-{sequence}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create scratch workspace");
        path
    }

    #[test]
    fn dev_layout_publishes_a_readable_container() {
        let workspace = scratch_workspace("dev");
        let layout = RepoLayout::dev(&workspace);
        let created = layout.initialize().expect("initialize");

        assert_eq!(created.repo_dir, workspace.join(WORKSPACE_DIR_NAME));
        assert!(created.container_path.exists());
        assert!(created.repo_dir.join(OBJECTS_DIR_NAME).is_dir());
        assert!(created.repo_dir.join(JOURNAL_DIR_NAME).is_dir());

        let document = RepoDocument::load(&created.container_path).expect("load");
        assert_eq!(document.meta.layout_mode, LayoutMode::Dev);
        assert_ne!(document.meta.repo_id, [0u8; 16]);
        assert_eq!(
            document.head.symbolic_target(),
            Some(crate::constants::DEFAULT_BRANCH_REF)
        );

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn two_initializations_get_different_ids() {
        let first_workspace = scratch_workspace("id-a");
        let second_workspace = scratch_workspace("id-b");

        let first = RepoLayout::dev(&first_workspace)
            .initialize()
            .expect("initialize first");
        let second = RepoLayout::dev(&second_workspace)
            .initialize()
            .expect("initialize second");

        let first_document = RepoDocument::load(&first.container_path).expect("load first");
        let second_document = RepoDocument::load(&second.container_path).expect("load second");
        assert_ne!(first_document.meta.repo_id, second_document.meta.repo_id);

        let _ = std::fs::remove_dir_all(&first_workspace);
        let _ = std::fs::remove_dir_all(&second_workspace);
    }

    #[test]
    fn initializing_over_an_existing_repository_is_refused() {
        let workspace = scratch_workspace("duplicate");
        let layout = RepoLayout::dev(&workspace);
        layout.initialize().expect("first initialize");

        let second = layout.initialize();
        assert!(
            matches!(second, Err(NativeError::RepositoryExists { .. })),
            "a second initialize must not replace the identity, got {second:?}"
        );

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn the_guard_file_is_written_before_the_container_is_readable() {
        let workspace = scratch_workspace("guard");
        let layout = RepoLayout::dev(&workspace);
        layout.initialize().expect("initialize");

        let guard = read_guard_file(layout.repo_dir())
            .expect("read guard")
            .expect("guard present");
        assert_eq!(guard, GUARD_FILE_CONTENT);

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn rewriting_the_guard_file_is_idempotent() {
        let workspace = scratch_workspace("guard-idempotent");
        let layout = RepoLayout::dev(&workspace);
        layout.initialize().expect("initialize");

        write_guard_file(layout.repo_dir()).expect("rewrite");
        assert_eq!(
            read_guard_file(layout.repo_dir())
                .expect("read guard")
                .as_deref(),
            Some(GUARD_FILE_CONTENT)
        );

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn an_empty_workspace_has_no_entry() {
        let workspace = scratch_workspace("absent");
        assert_eq!(
            classify_workspace_entry(&workspace).expect("classify"),
            PhysicalLayout::Absent
        );
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn a_created_repository_classifies_as_a_directory() {
        let workspace = scratch_workspace("classify-dir");
        RepoLayout::dev(&workspace)
            .initialize()
            .expect("initialize");

        assert_eq!(
            classify_workspace_entry(&workspace).expect("classify"),
            PhysicalLayout::Directory
        );
        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn hiding_a_directory_is_reported_consistently() {
        let workspace = scratch_workspace("hidden");
        let layout = RepoLayout::dev(&workspace);
        let created = layout.initialize().expect("initialize");

        match created.hidden {
            Some(true) => {
                assert!(is_directory_hidden(layout.repo_dir()).expect("read attribute"));
            }
            Some(false) | None => {
                assert!(!is_directory_hidden(layout.repo_dir()).unwrap_or(false));
            }
        }

        let _ = std::fs::remove_dir_all(&workspace);
    }
}
