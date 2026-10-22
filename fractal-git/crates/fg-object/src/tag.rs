//! Module: fg-object — Canonical Git Annotated Tag Codec
//! File Path: crates/fg-object/src/tag.rs
//! Architecture Role: Encodes and decodes the `tag` object: the record an annotated tag writes,
//!   distinct from the lightweight `refs/tags/<name>` file that only holds an object id.
//! Dependencies & Triggers: Consumed by history traversal and by the projection layer that must
//!   reproduce a tag object byte for byte. An annotated tag in a pack cannot be peeled without it.
//! Responsibilities: Parse and serialize the four header fields, the optional signature block, and
//!   the message, in the order Git writes them.
//! Exit Semantics & Design Rationale:
//!   - The header order is part of the object id, so serialization follows Git's fixed order:
//!     `object`, `type`, `tag`, `tagger`, blank line, message. Reordering fields changes the id even
//!     though every parsed value stays the same.
//!   - The target type is parsed through [`ObjectKind`] instead of kept as raw text. A tag may point
//!     at any of the four object types, and a caller that walks `type` as a string has to re-derive
//!     that closed set at every call site.
//!   - A tag without a `tagger` line is legal: Git omits it for tags created with an empty identity.
//!     Treating it as malformed would reject real repository history.
//!   - A signature block is captured verbatim rather than verified. Verifying needs the signer's key,
//!     which this layer does not have; dropping the block instead would silently change the id.

use fg_core::models::{compute_object_oid, raw_object, GitSignature, ObjectKind, Oid};

/// Prefix that begins a signature block inside a tag payload.
const SIGNATURE_PREFIX: &str = "-----BEGIN ";

/// Field label that names the tagged object id.
const FIELD_OBJECT: &str = "object ";

/// Field label that names the tagged object's type.
const FIELD_TYPE: &str = "type ";

/// Field label that records the tag name.
const FIELD_TAG: &str = "tag ";

/// Field label that records the tagger identity.
const FIELD_TAGGER: &str = "tagger ";

/// A parsed annotated tag object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitTag {
    /// Object id of the tagged object.
    pub target_oid: Oid,
    /// Type of the tagged object.
    pub target_kind: ObjectKind,
    /// Tag name as recorded inside the object, which may differ from the reference name.
    pub name: String,
    /// Tagger identity, absent when Git wrote the tag without one.
    pub tagger: Option<GitSignature>,
    /// Message body exactly as it appears after the blank line.
    pub message: String,
    /// Signature block including its `-----BEGIN` line, when the tag is signed.
    pub signature: Option<String>,
}

impl GitTag {
    /// Builds the payload bytes Git hashes for this tag.
    ///
    /// The message is written verbatim, so a message that already ends in a newline keeps exactly
    /// one. Appending an unconditional newline would give a tagged message two trailing newlines and
    /// a different object id than Git computed for the same content.
    pub fn to_payload(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(FIELD_OBJECT.as_bytes());
        bytes.extend_from_slice(self.target_oid.to_hex().as_bytes());
        bytes.push(b'\n');
        bytes.extend_from_slice(FIELD_TYPE.as_bytes());
        bytes.extend_from_slice(self.target_kind.as_str().as_bytes());
        bytes.push(b'\n');
        bytes.extend_from_slice(FIELD_TAG.as_bytes());
        bytes.extend_from_slice(self.name.as_bytes());
        bytes.push(b'\n');
        if let Some(tagger) = &self.tagger {
            bytes.extend_from_slice(FIELD_TAGGER.as_bytes());
            bytes.extend_from_slice(tagger.to_git_line().as_bytes());
            bytes.push(b'\n');
        }
        bytes.push(b'\n');
        bytes.extend_from_slice(self.message.as_bytes());
        if let Some(signature) = &self.signature {
            bytes.extend_from_slice(signature.as_bytes());
        }
        bytes
    }

    /// Computes the object id of this tag.
    pub fn oid(&self) -> Oid {
        compute_object_oid(ObjectKind::Tag, &self.to_payload())
    }

    /// Returns the raw loose object bytes: `tag <size>\0<payload>`.
    pub fn to_raw_object(&self) -> Vec<u8> {
        raw_object(ObjectKind::Tag, &self.to_payload())
    }

    /// Parses a tag payload.
    ///
    /// Returns an error when a required field is missing, when the recorded target type is not one of
    /// the four Git object types, or when the tagged id is not a 40-character hex string.
    pub fn parse(payload: &[u8]) -> Result<Self, TagCodecError> {
        let text = std::str::from_utf8(payload).map_err(|_| TagCodecError::NotUtf8)?;
        let (header_block, body) = match text.split_once("\n\n") {
            Some(parts) => parts,
            None => (text, ""),
        };

        let mut target_oid = None;
        let mut target_kind = None;
        let mut name = None;
        let mut tagger = None;

        for line in header_block.lines() {
            if let Some(value) = line.strip_prefix(FIELD_OBJECT) {
                target_oid = Some(Oid::from_hex(value).map_err(|_| TagCodecError::BadObjectId)?);
            } else if let Some(value) = line.strip_prefix(FIELD_TYPE) {
                target_kind = Some(parse_object_kind(value)?);
            } else if let Some(value) = line.strip_prefix(FIELD_TAG) {
                name = Some(value.to_string());
            } else if let Some(value) = line.strip_prefix(FIELD_TAGGER) {
                tagger = Some(parse_signature(value));
            }
        }

        let (message, signature) = split_signature(body);
        Ok(Self {
            target_oid: target_oid.ok_or(TagCodecError::MissingObjectId)?,
            target_kind: target_kind.ok_or(TagCodecError::MissingTargetType)?,
            name: name.ok_or(TagCodecError::MissingName)?,
            tagger,
            message,
            signature,
        })
    }
}

/// Failure modes for tag decoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagCodecError {
    /// The payload is not valid UTF-8, which Git requires for tag headers and messages.
    NotUtf8,
    /// The `object` field is absent.
    MissingObjectId,
    /// The `type` field is absent.
    MissingTargetType,
    /// The `tag` field is absent.
    MissingName,
    /// The `object` field does not hold a 40-character hexadecimal id.
    BadObjectId,
    /// The `type` field names something other than blob, tree, commit, or tag.
    UnknownTargetType,
}

impl std::fmt::Display for TagCodecError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let detail = match self {
            Self::NotUtf8 => "tag payload is not valid UTF-8",
            Self::MissingObjectId => "tag payload has no 'object' field",
            Self::MissingTargetType => "tag payload has no 'type' field",
            Self::MissingName => "tag payload has no 'tag' field",
            Self::BadObjectId => "tag 'object' field is not a 40-character hexadecimal id",
            Self::UnknownTargetType => "tag 'type' field is not blob, tree, commit, or tag",
        };
        formatter.write_str(detail)
    }
}

impl std::error::Error for TagCodecError {}

/// Maps a `type` field value onto the closed object-kind set.
fn parse_object_kind(value: &str) -> Result<ObjectKind, TagCodecError> {
    match value.trim() {
        "blob" => Ok(ObjectKind::Blob),
        "tree" => Ok(ObjectKind::Tree),
        "commit" => Ok(ObjectKind::Commit),
        "tag" => Ok(ObjectKind::Tag),
        _ => Err(TagCodecError::UnknownTargetType),
    }
}

/// Parses a `tagger` line of the form `name <email> <seconds> <tz>`.
///
/// A line whose shape does not match is still recorded: the identity text is preserved as the name
/// and the timestamp is zero, which round-trips the bytes instead of discarding an unusual but
/// present field.
fn parse_signature(value: &str) -> GitSignature {
    let Some((identity, timestamp_text)) = value.rsplit_once('>') else {
        return GitSignature::new(value.trim(), "", 0);
    };
    let Some((name, email)) = identity.rsplit_once(" <") else {
        return GitSignature::new(value.trim(), "", 0);
    };
    let mut parts = timestamp_text.split_whitespace();
    let timestamp_sec = parts
        .next()
        .and_then(|seconds| seconds.parse::<i64>().ok())
        .unwrap_or(0);
    let tz_offset = parts.next().unwrap_or("+0000").to_string();
    GitSignature {
        name: name.to_string(),
        email: email.to_string(),
        timestamp_sec,
        tz_offset,
    }
}

/// Separates the message from a trailing signature block, when one is present.
///
/// Both halves are returned verbatim. Trimming the message would drop a newline that belongs to the
/// object id, and rewriting the signature block would break it.
fn split_signature(body: &str) -> (String, Option<String>) {
    let Some(start) = body.find(SIGNATURE_PREFIX) else {
        return (body.to_string(), None);
    };
    let message = body[..start].to_string();
    let signature = body[start..].to_string();
    (message, Some(signature))
}
