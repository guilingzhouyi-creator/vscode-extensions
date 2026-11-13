//! Module: fg-object — Canonical Git Object Codecs Facade
//! File Path: crates/fg-object/src/lib.rs
//! Architecture Role: Pure Git object format codec engine (Blob, Tree, Commit, annotated Tag) for
//!   Fractal Git.
//! Dependencies & Triggers: Upstream of fg-storage, fg-index, fg-topology, and Taxis CLI.
//! Responsibilities: Facade re-exporting owned and zero-copy borrowed Git object models, exposing
//!   codec capabilities and loose-object header boundary validation.
//! Exit Semantics & Design Rationale: Centralizes object model exports with immutable facades and
//!   deterministic header bounds checks (`ARCH-FAC-001`, `FGT-OBJ-001`).
//!
//! Domain Governance Rules: FGT-OBJ-001 (object model facade), FGT-COR-001, FGT-PRF-001.
//!
//! `FileMode` is deliberately *not* re-exported here: it lives in `fg_core::models` because the
//! index and the native container need it without depending on the object codec. Callers that
//! already depend on `fg-object` should import it from `fg_core::models::FileMode` so there is
//! exactly one path to the type.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::ObjectKind;

pub mod blob;
pub mod borrowed;
pub mod commit;
pub mod tag;
pub mod tree;

pub use blob::GitBlob;
pub use borrowed::{GitCommitRef, GitTreeEntryRef, GitTreeIter, GitTreeRef, SmallParentList};
pub use commit::GitCommit;
pub use tag::{GitTag, TagCodecError};
pub use tree::{GitTree, GitTreeEntry};

/// Canonical schema version of the `fg-object` codec facade.
pub const OBJECT_CODEC_SCHEMA_VERSION: u16 = 1;

/// Maximum valid byte length of a canonical Git loose header (`"<kind> <decimal-len>\0"`).
pub const MAX_OBJECT_HEADER_LEN: usize = 64;

/// Immutable capability manifest describing the supported Git object codecs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObjectCodecCapabilities {
    /// Facade contract schema version.
    pub schema_version: u16,
    /// Whether zero-copy borrowed tree and commit views are enabled.
    pub supports_borrowed_zero_copy: bool,
    /// Whether annotated Git tag encoding/decoding is enabled.
    pub supports_canonical_tags: bool,
    /// Hard ceiling in bytes accepted for a canonical Git loose header.
    pub max_header_bytes: usize,
}

/// Returns the compile-time immutable capability descriptor for `fg-object`.
pub const fn object_codec_capabilities() -> ObjectCodecCapabilities {
    ObjectCodecCapabilities {
        schema_version: OBJECT_CODEC_SCHEMA_VERSION,
        supports_borrowed_zero_copy: true,
        supports_canonical_tags: true,
        max_header_bytes: MAX_OBJECT_HEADER_LEN,
    }
}

/// Reports whether `fg-object` provides a zero-copy borrowed parser for `kind`.
pub const fn supports_zero_copy_codec(kind: ObjectKind) -> bool {
    matches!(kind, ObjectKind::Tree | ObjectKind::Commit)
}

/// Validates and decodes the canonical Git loose header (`"<kind> <size>\0"`) without heap allocation.
///
/// Returns `(ObjectKind, payload_size, header_end_offset)` where `header_end_offset` is the
/// byte index immediately after the NUL terminator.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] if the header lacks a NUL byte within
/// [`MAX_OBJECT_HEADER_LEN`], has an unknown object kind, or has an invalid decimal size.
pub fn validate_loose_header_bounds(raw: &[u8]) -> FractalResult<(ObjectKind, usize, usize)> {
    let scan_limit = raw.len().min(MAX_OBJECT_HEADER_LEN);
    let Some(nul_pos) = raw[..scan_limit].iter().position(|&b| b == 0) else {
        return Err(FractalError::ObjectCodec(
            "loose object header missing NUL terminator within bound".to_owned(),
        ));
    };

    let header_str = std::str::from_utf8(&raw[..nul_pos]).map_err(|_| {
        FractalError::ObjectCodec("loose object header is not valid UTF-8".to_owned())
    })?;
    let Some((kind_str, size_str)) = header_str.split_once(' ') else {
        return Err(FractalError::ObjectCodec(
            "loose object header missing space separator".to_owned(),
        ));
    };

    let kind = match kind_str {
        "blob" => ObjectKind::Blob,
        "tree" => ObjectKind::Tree,
        "commit" => ObjectKind::Commit,
        "tag" => ObjectKind::Tag,
        _ => {
            return Err(FractalError::ObjectCodec(format!(
                "unsupported loose object kind: {kind_str}"
            )));
        }
    };

    let payload_size = size_str.parse::<usize>().map_err(|_| {
        FractalError::ObjectCodec(format!("invalid loose object size: {size_str}"))
    })?;

    Ok((kind, payload_size, nul_pos + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facade_capabilities_and_header_validation_work() {
        let caps = object_codec_capabilities();
        assert_eq!(caps.schema_version, OBJECT_CODEC_SCHEMA_VERSION);
        assert!(caps.supports_borrowed_zero_copy);
        assert!(supports_zero_copy_codec(ObjectKind::Tree));
        assert!(supports_zero_copy_codec(ObjectKind::Commit));
        assert!(!supports_zero_copy_codec(ObjectKind::Blob));

        let parsed = validate_loose_header_bounds(b"blob 12\0hello world!");
        assert_eq!(parsed.ok(), Some((ObjectKind::Blob, 12, 8)));

        assert!(validate_loose_header_bounds(b"unknown 5\0abcde").is_err());
        assert!(validate_loose_header_bounds(b"blob notanumber\0").is_err());
        assert!(validate_loose_header_bounds(b"blob 12 without nul").is_err());
    }
}
