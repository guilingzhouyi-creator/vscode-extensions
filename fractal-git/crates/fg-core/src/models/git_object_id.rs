//! Module: fg-core — Git Object Identity
//! File Path: crates/fg-core/src/models/git_object_id.rs
//! Architecture Role: The one place that defines how a Git object id is derived from its type and
//!   payload. Every layer that stores, verifies, or projects an object id calls this function
//!   instead of hashing payload bytes on its own.
//! Dependencies & Triggers: Consumed by the object codecs (`fg-object`), the content-addressed
//!   block store (`fg-storage`), and the projection layer that writes a `.git` snapshot.
//! Responsibilities: Frame a payload with `<type> <decimal length>\0`, parse loose headers back into
//!   `(ObjectKind, payload)`, and hash the frame with SHA-1.
//! Exit Semantics & Design Rationale:
//!   - The type is part of the identity. Hashing the payload alone would give a blob and a tree
//!     with identical bytes the same id, which makes a projection table unavoidable and lets a
//!     mislabelled object pass verification.
//!   - The header is written into a fixed stack buffer. `format!` would allocate once per object,
//!     and object id computation sits inside per-file loops.
//!   - `ObjectKind` is a closed enum rather than a string parameter: a typo in a type name would
//!     produce a valid-looking but wrong id, which no later check can detect.
//!   - The decimal length is the payload length in bytes, not characters and not the framed length;
//!     Git writes the payload length and this must match byte for byte or no id is portable.

use sha1::{Digest, Sha1};

use crate::error::{FractalError, FractalResult};
use crate::models::oid::Oid;

/// Width of the stack buffer that holds `<type> <length>\0`.
///
/// The longest type name is `commit` (6 bytes), the longest `usize` decimal is 20 digits, plus one
/// space and one NUL: 28 bytes. The buffer is 32 to keep the bound obvious rather than exact.
const HEADER_BUFFER_LEN: usize = 32;

/// The four object types a Git repository can contain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ObjectKind {
    /// File content.
    Blob,
    /// One directory level: mode, name, and id per entry.
    Tree,
    /// A snapshot: tree, parents, author, committer, message.
    Commit,
    /// An annotated tag pointing at another object.
    Tag,
}

impl ObjectKind {
    /// Returns the lowercase type name Git writes into the object header.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Blob => "blob",
            Self::Tree => "tree",
            Self::Commit => "commit",
            Self::Tag => "tag",
        }
    }

    /// Returns the one-byte discriminant persisted alongside a stored block.
    ///
    /// The values are stable on disk: changing one silently invalidates every stored object id,
    /// because verification re-derives the id from the recorded kind.
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::Blob => 1,
            Self::Tree => 2,
            Self::Commit => 3,
            Self::Tag => 4,
        }
    }

    /// Decodes the one-byte discriminant.
    ///
    /// Returns `None` for any value outside `1..=4`. Callers turn that into their own error type
    /// rather than receiving a defaulted kind, because a defaulted kind would verify the wrong id.
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::Blob),
            2 => Some(Self::Tree),
            3 => Some(Self::Commit),
            4 => Some(Self::Tag),
            _ => None,
        }
    }

    /// Decodes the canonical lowercase Git header type name (`blob`, `tree`, `commit`, `tag`).
    pub fn from_header_name(name: &str) -> Option<Self> {
        match name {
            "blob" => Some(Self::Blob),
            "tree" => Some(Self::Tree),
            "commit" => Some(Self::Commit),
            "tag" => Some(Self::Tag),
            _ => None,
        }
    }
}

/// Writes the object header for `kind` and `payload_len` into `buffer`.
///
/// Returns the number of bytes written. The header is `<type> <decimal length>\0`.
fn write_header(
    kind: ObjectKind,
    payload_len: usize,
    buffer: &mut [u8; HEADER_BUFFER_LEN],
) -> usize {
    use std::io::Write;

    let mut cursor = std::io::Cursor::new(&mut buffer[..]);
    // Writing into a fixed in-memory buffer cannot fail; the length is bounded by the buffer size.
    let _ = write!(cursor, "{} {}\0", kind.as_str(), payload_len);
    cursor.position() as usize
}

/// Computes the canonical Git object id for `payload` as an object of type `kind`.
pub fn compute_object_oid(kind: ObjectKind, payload: &[u8]) -> Oid {
    let mut header_buffer = [0u8; HEADER_BUFFER_LEN];
    let header_len = write_header(kind, payload.len(), &mut header_buffer);

    let mut hasher = Sha1::new();
    hasher.update(&header_buffer[..header_len]);
    hasher.update(payload);
    let hash: [u8; 20] = hasher.finalize().into();
    Oid::from_bytes(hash)
}

/// Builds the raw object Git stores in its object database: header followed by payload.
pub fn raw_object(kind: ObjectKind, payload: &[u8]) -> Vec<u8> {
    let mut header_buffer = [0u8; HEADER_BUFFER_LEN];
    let header_len = write_header(kind, payload.len(), &mut header_buffer);

    let mut raw = Vec::with_capacity(header_len + payload.len());
    raw.extend_from_slice(&header_buffer[..header_len]);
    raw.extend_from_slice(payload);
    raw
}

/// Parses a raw Git loose object frame (`<type> <decimal length>\0<payload>`) into its typed kind
/// and borrowed payload slice, verifying that the declared decimal size matches `payload.len()`.
///
/// # Errors
/// Returns [`FractalError::ObjectCodec`] if the NUL delimiter is absent, the header is malformed,
/// the type name is unknown, or the declared byte count disagrees with the trailing payload slice.
pub fn parse_loose_header(raw: &[u8]) -> FractalResult<(ObjectKind, &[u8])> {
    let nul_pos = raw.iter().position(|&byte| byte == 0).ok_or_else(|| {
        FractalError::ObjectCodec("missing NUL delimiter in loose object header".into())
    })?;
    let header = std::str::from_utf8(&raw[..nul_pos])
        .map_err(|_| FractalError::ObjectCodec("invalid UTF-8 in loose object header".into()))?;
    let (type_str, len_str) = header.split_once(' ').ok_or_else(|| {
        FractalError::ObjectCodec("missing space separator in loose object header".into())
    })?;
    let kind = ObjectKind::from_header_name(type_str).ok_or_else(|| {
        FractalError::ObjectCodec(format!("unknown loose object type '{type_str}'"))
    })?;
    let declared_len = len_str.parse::<usize>().map_err(|_| {
        FractalError::ObjectCodec(format!("invalid loose object length '{len_str}'"))
    })?;
    let payload = &raw[nul_pos + 1..];
    if payload.len() != declared_len {
        return Err(FractalError::ObjectCodec(format!(
            "loose object length mismatch: header declared {declared_len} bytes, actual {}",
            payload.len()
        )));
    }
    Ok((kind, payload))
}

#[cfg(test)]
mod tests {
    use super::{compute_object_oid, parse_loose_header, raw_object, ObjectKind};

    #[test]
    fn empty_blob_matches_the_well_known_id() {
        // `git hash-object -t blob /dev/null`
        assert_eq!(
            compute_object_oid(ObjectKind::Blob, b"").to_hex(),
            "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
        );
    }

    #[test]
    fn known_blob_matches_git() {
        // `printf 'hello\n' | git hash-object -t blob --stdin`
        assert_eq!(
            compute_object_oid(ObjectKind::Blob, b"hello\n").to_hex(),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn empty_tree_matches_the_well_known_id() {
        // `git mktree </dev/null`
        assert_eq!(
            compute_object_oid(ObjectKind::Tree, b"").to_hex(),
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
        );
    }

    #[test]
    fn the_type_is_part_of_the_identity() {
        let payload = b"identical bytes";
        assert_ne!(
            compute_object_oid(ObjectKind::Blob, payload),
            compute_object_oid(ObjectKind::Tree, payload),
            "the same payload under two types must not collide"
        );
    }

    #[test]
    fn raw_object_frames_and_parses_back() {
        let raw = raw_object(ObjectKind::Blob, b"abc");
        assert_eq!(raw, b"blob 3\0abc");
        let (kind, payload) = parse_loose_header(&raw).expect("parse loose frame");
        assert_eq!(kind, ObjectKind::Blob);
        assert_eq!(payload, b"abc");
        assert!(parse_loose_header(b"blob 9\0abc").is_err());
    }

    #[test]
    fn kind_discriminants_round_trip() {
        for kind in [
            ObjectKind::Blob,
            ObjectKind::Tree,
            ObjectKind::Commit,
            ObjectKind::Tag,
        ] {
            assert_eq!(ObjectKind::from_u8(kind.as_u8()), Some(kind));
            assert_eq!(ObjectKind::from_header_name(kind.as_str()), Some(kind));
        }
        assert_eq!(ObjectKind::from_u8(0), None);
        assert_eq!(ObjectKind::from_u8(5), None);
    }
}
