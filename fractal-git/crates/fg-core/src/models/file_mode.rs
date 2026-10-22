//! Module: fg-core — Canonical File Mode Value Object
//! File Path: crates/fg-core/src/models/file_mode.rs
//! Architecture Role: Single source of truth for the closed set of file kinds that may appear in a
//!   Git tree, a staging index, or a worktree projection. Lives in fg-core because every layer
//!   (object codec, index, native container, storage) must agree on the same five values.
//! Dependencies & Triggers: Consumed by fg-object tree codecs, fg-index staging entries, fg-native
//!   INDX section, and the worktree materializer.
//! Responsibilities: Map between the typed kind, the on-disk octal word used by Git, and the ASCII
//!   spelling used inside tree objects.
//! Exit Semantics & Design Rationale:
//!   - The set is closed and exhaustive. An unrecognized word is rejected with the numeric value
//!     attached, never coerced into `RegularFile`: coercion would silently rewrite a submodule as a
//!     plain file, or a directory as a blob.
//!   - `Gitlink` is a first-class variant, not an afterthought. Git trees legitimately carry
//!     `160000` entries for submodules, so omitting it makes every repository with a submodule
//!     unreadable — a correctness failure, not a missing feature.
//!   - Sparse-checkout directories are *not* a distinct mode: Git records them as `040000`, and the
//!     collapsed state is carried by a trailing `/` in the path. Modelling them as a sixth variant
//!     would create two spellings for one on-disk fact.
//!   - The tree-object spelling of a directory is `40000` (five digits, no leading zero) while the
//!     index and the numeric word use `040000`. Both spellings are accepted on read; only the
//!     canonical one is emitted.

use crate::constants::git::{
    MODE_DIRECTORY_STR, MODE_EXECUTABLE_STR, MODE_GITLINK_STR, MODE_REGULAR_STR, MODE_SYMLINK_STR,
};
use crate::error::{FractalError, FractalResult};

/// The kind of filesystem object a Git entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FileMode {
    /// Ordinary non-executable regular file, octal `100644`.
    RegularFile,
    /// Executable regular file, octal `100755`.
    ExecutableFile,
    /// Subdirectory (tree object), octal `040000`.
    Directory,
    /// Symbolic link whose blob payload is the link target, octal `120000`.
    Symlink,
    /// Submodule commit binding, octal `160000`.
    Gitlink,
}

impl FileMode {
    /// Every mode this build understands, ordered from least to most privileged.
    pub const ALL: [Self; 5] = [
        Self::RegularFile,
        Self::ExecutableFile,
        Self::Directory,
        Self::Symlink,
        Self::Gitlink,
    ];

    /// Returns the numeric octal word stored in a Git index entry.
    pub const fn to_u32(self) -> u32 {
        match self {
            Self::RegularFile => 0o100_644,
            Self::ExecutableFile => 0o100_755,
            Self::Directory => 0o040_000,
            Self::Symlink => 0o120_000,
            Self::Gitlink => 0o160_000,
        }
    }

    /// Decodes the numeric octal word stored in a Git index entry.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::UnknownFileMode`] carrying the offending word for any value outside
    /// the five defined modes.
    pub const fn from_u32(mode: u32) -> FractalResult<Self> {
        match mode {
            0o100_644 => Ok(Self::RegularFile),
            0o100_755 => Ok(Self::ExecutableFile),
            0o040_000 => Ok(Self::Directory),
            0o120_000 => Ok(Self::Symlink),
            0o160_000 => Ok(Self::Gitlink),
            other => Err(FractalError::UnknownFileMode { mode: other }),
        }
    }

    /// Returns the canonical ASCII spelling used inside a Git tree object.
    ///
    /// A directory is spelled `40000`, without the leading zero, because that is what Git writes;
    /// emitting `040000` would produce a tree whose object id differs from Git's for identical
    /// content.
    pub const fn as_octal_str(self) -> &'static str {
        match self {
            Self::RegularFile => MODE_REGULAR_STR,
            Self::ExecutableFile => MODE_EXECUTABLE_STR,
            Self::Directory => MODE_DIRECTORY_STR,
            Self::Symlink => MODE_SYMLINK_STR,
            Self::Gitlink => MODE_GITLINK_STR,
        }
    }

    /// Decodes the ASCII mode spelling found at the head of a tree entry.
    ///
    /// Both the canonical `40000` and the zero-padded `040000` are accepted for directories,
    /// because historical writers emitted either.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the bytes match no defined mode.
    pub fn from_octal_bytes(raw: &[u8]) -> FractalResult<Self> {
        match raw {
            b"100644" => Ok(Self::RegularFile),
            b"100755" => Ok(Self::ExecutableFile),
            b"40000" | b"040000" => Ok(Self::Directory),
            b"120000" => Ok(Self::Symlink),
            b"160000" => Ok(Self::Gitlink),
            other => {
                let mut rendered = String::with_capacity(other.len());
                for byte in other {
                    rendered.push(char::from(*byte));
                }
                Err(FractalError::ObjectCodec(format!(
                    "Unsupported file mode in tree entry: {rendered}"
                )))
            }
        }
    }

    /// Reports whether this kind resolves to a tree object rather than a blob.
    pub const fn is_tree(self) -> bool {
        matches!(self, Self::Directory)
    }

    /// Reports whether this kind stores its content as a blob in the object database.
    ///
    /// A gitlink names a commit in another repository, so it has no blob of its own.
    pub const fn has_blob(self) -> bool {
        !matches!(self, Self::Directory | Self::Gitlink)
    }
}

#[cfg(test)]
mod tests {
    use super::FileMode;
    use crate::error::FractalError;

    #[test]
    fn numeric_word_round_trips_for_every_mode() {
        for mode in FileMode::ALL {
            assert_eq!(FileMode::from_u32(mode.to_u32()).expect("decode"), mode);
        }
    }

    #[test]
    fn numeric_words_match_git_constants() {
        assert_eq!(FileMode::RegularFile.to_u32(), 0o100_644);
        assert_eq!(FileMode::ExecutableFile.to_u32(), 0o100_755);
        assert_eq!(FileMode::Directory.to_u32(), 0o040_000);
        assert_eq!(FileMode::Symlink.to_u32(), 0o120_000);
        assert_eq!(FileMode::Gitlink.to_u32(), 0o160_000);
    }

    #[test]
    fn octal_spelling_round_trips_for_every_mode() {
        for mode in FileMode::ALL {
            let spelling = mode.as_octal_str();
            assert_eq!(
                FileMode::from_octal_bytes(spelling.as_bytes()).expect("decode"),
                mode
            );
        }
    }

    #[test]
    fn directory_accepts_both_spellings_but_emits_canonical() {
        assert_eq!(
            FileMode::from_octal_bytes(b"40000").expect("canonical"),
            FileMode::Directory
        );
        assert_eq!(
            FileMode::from_octal_bytes(b"040000").expect("padded"),
            FileMode::Directory
        );
        assert_eq!(FileMode::Directory.as_octal_str(), "40000");
    }

    #[test]
    fn gitlink_is_a_first_class_mode() {
        // A tree carrying a submodule entry must parse; rejecting 160000 makes every repository
        // with a submodule unreadable.
        assert_eq!(
            FileMode::from_octal_bytes(b"160000").expect("gitlink"),
            FileMode::Gitlink
        );
        assert_eq!(FileMode::Gitlink.to_u32(), 0o160_000);
        assert!(!FileMode::Gitlink.has_blob());
    }

    #[test]
    fn rejects_unknown_numeric_word() {
        let error = FileMode::from_u32(0o100_600).expect_err("unknown word must fail");
        match error {
            FractalError::UnknownFileMode { mode } => assert_eq!(mode, 0o100_600),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn rejects_unknown_octal_spelling() {
        assert!(FileMode::from_octal_bytes(b"100600").is_err());
        assert!(FileMode::from_octal_bytes(b"").is_err());
    }

    #[test]
    fn tree_and_blob_classification_partitions_the_mode_set() {
        // A gitlink is neither a tree nor a blob: it names a commit in another repository. The two
        // predicates therefore partition the four local kinds and both reject a gitlink.
        for mode in [
            FileMode::RegularFile,
            FileMode::ExecutableFile,
            FileMode::Directory,
            FileMode::Symlink,
        ] {
            assert_ne!(
                mode.is_tree(),
                mode.has_blob(),
                "mode {mode:?} must be exactly one of tree or blob"
            );
        }
        assert!(!FileMode::Gitlink.is_tree());
        assert!(!FileMode::Gitlink.has_blob());
    }
}
