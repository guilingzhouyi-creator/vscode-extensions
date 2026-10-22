//! Module: fg-native — META Section Codec
//! File Path: crates/fg-native/src/sections/meta.rs
//! Architecture Role: Encodes and decodes the repository identity and layout metadata that the
//!   store path derivation and `taxis doctor` both depend on.
//! Dependencies & Triggers: Consumed by `taxis init` (writes), `Repo::open` (reads), and
//!   `taxis doctor` (cross-checks layout mode against the physical filesystem).
//! Responsibilities: Round-trip the immutable repository id, creation timestamp, object format,
//!   native format version, and layout mode.
//! Exit Semantics & Design Rationale:
//!   - `repo_id` is generated once and never derived from a path: deriving from a path would make
//!     the store location change when the workspace moves, orphaning the real data.
//!   - `layout_mode` is stored so `doctor` can detect a mismatch between the declared mode and the
//!     actual physical layout, which is exactly the state left behind when a store is deleted.
//!   - Unknown discriminants are rejected rather than defaulted: silently treating an unknown
//!     layout as `Dev` would let a release repository be rewritten in place.

use crate::codec::{FieldReader, FieldWriter};
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "META";

/// Size of the immutable repository identifier in bytes.
pub const REPO_ID_LEN: usize = 16;

/// Where the repository's authoritative bytes physically live.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutMode {
    /// Development layout: the native store is a real directory inside the workspace.
    Dev,
    /// Release layout: the workspace holds a link whose target is the shared store.
    Release,
}

impl LayoutMode {
    /// Returns the on-disk discriminant.
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::Dev => 0,
            Self::Release => 1,
        }
    }

    /// Decodes the on-disk discriminant.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] for any value outside `{0, 1}`.
    pub fn from_u8(value: u8) -> NativeResult<Self> {
        match value {
            0 => Ok(Self::Dev),
            1 => Ok(Self::Release),
            other => Err(NativeError::UnknownDiscriminant {
                field: "layout_mode",
                value: other,
            }),
        }
    }
}

/// Object identity algorithm the repository uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectFormat {
    /// SHA-1 object identity, the only format this build supports.
    Sha1,
}

impl ObjectFormat {
    /// Returns the on-disk discriminant.
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::Sha1 => 0,
        }
    }

    /// Decodes the on-disk discriminant.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] for any value other than `0`; a SHA-256
    /// repository must be rejected outright rather than misread through twenty-byte assumptions.
    pub fn from_u8(value: u8) -> NativeResult<Self> {
        match value {
            0 => Ok(Self::Sha1),
            other => Err(NativeError::UnknownDiscriminant {
                field: "object_format",
                value: other,
            }),
        }
    }
}

/// Immutable repository identity and layout metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaSection {
    /// Immutable repository identifier; the store directory name is its lowercase hex form.
    pub repo_id: [u8; REPO_ID_LEN],
    /// Creation timestamp in milliseconds since the Unix epoch.
    pub created_at_ms: i64,
    /// Object identity algorithm.
    pub object_format: ObjectFormat,
    /// Native container format version that wrote this metadata.
    pub native_version: u16,
    /// Declared physical layout mode.
    pub layout_mode: LayoutMode,
}

impl MetaSection {
    /// Creates metadata for a freshly initialized repository.
    pub const fn new(
        repo_id: [u8; REPO_ID_LEN],
        created_at_ms: i64,
        layout_mode: LayoutMode,
    ) -> Self {
        Self {
            repo_id,
            created_at_ms,
            object_format: ObjectFormat::Sha1,
            native_version: crate::constants::TAXC_FORMAT_VERSION,
            layout_mode,
        }
    }

    /// Returns the lowercase hexadecimal repository identifier used as the store directory name.
    pub fn repo_id_hex(&self) -> String {
        let mut hex = String::with_capacity(REPO_ID_LEN * 2);
        for byte in self.repo_id {
            use std::fmt::Write;
            let _ = write!(&mut hex, "{byte:02x}");
        }
        hex
    }

    /// Serializes the section payload.
    ///
    /// # Errors
    ///
    /// Propagates field-write failures; the current field set cannot fail, so this is a
    /// forward-compatibility signature rather than an active failure path.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        let mut writer = FieldWriter::with_capacity(REPO_ID_LEN + 4 + 8 + 1 + 2 + 1);
        writer.write_bytes(&self.repo_id);
        writer.write_i64(self.created_at_ms);
        writer.write_u8(self.object_format.as_u8());
        writer.write_u16(self.native_version);
        writer.write_u8(self.layout_mode.as_u8());
        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns a field-level [`NativeError`] when the payload is short, carries an unknown
    /// discriminant, or has trailing bytes that no field accounts for.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);

        let raw_id = reader.take("repo_id", REPO_ID_LEN)?;
        let mut repo_id = [0u8; REPO_ID_LEN];
        repo_id.copy_from_slice(raw_id);

        let created_at_ms = reader.read_i64("created_at_ms")?;
        let object_format = ObjectFormat::from_u8(reader.read_u8("object_format")?)?;
        let native_version = reader.read_u16("native_version")?;
        let layout_mode = LayoutMode::from_u8(reader.read_u8("layout_mode")?)?;

        reader.expect_exhausted(SECTION_TAG)?;

        Ok(Self {
            repo_id,
            created_at_ms,
            object_format,
            native_version,
            layout_mode,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{LayoutMode, MetaSection, ObjectFormat};
    use crate::error::NativeError;

    fn sample() -> MetaSection {
        let mut repo_id = [0u8; 16];
        repo_id[0] = 0xA1;
        repo_id[15] = 0x5E;
        MetaSection::new(repo_id, 1_700_000_000_000, LayoutMode::Release)
    }

    #[test]
    fn round_trip_preserves_every_field() {
        let original = sample();
        let encoded = original.encode().expect("encode");
        let decoded = MetaSection::decode(&encoded).expect("decode");
        assert_eq!(decoded, original);
    }

    #[test]
    fn repo_id_hex_is_lowercase_and_zero_padded() {
        let mut repo_id = [0u8; 16];
        repo_id[0] = 0x0A;
        repo_id[15] = 0xFF;
        let meta = MetaSection::new(repo_id, 0, LayoutMode::Dev);
        let hex = meta.repo_id_hex();
        assert_eq!(hex.len(), 32);
        assert!(hex.starts_with("0a"));
        assert!(hex.ends_with("ff"));
        assert_eq!(hex, hex.to_lowercase());
    }

    #[test]
    fn layout_mode_round_trips() {
        for mode in [LayoutMode::Dev, LayoutMode::Release] {
            assert_eq!(LayoutMode::from_u8(mode.as_u8()).expect("decode"), mode);
        }
    }

    #[test]
    fn rejects_unknown_layout_mode() {
        let error = LayoutMode::from_u8(9).expect_err("unknown mode must fail");
        assert!(matches!(
            error,
            NativeError::UnknownDiscriminant {
                field: "layout_mode",
                value: 9
            }
        ));
    }

    #[test]
    fn rejects_unknown_object_format() {
        let error = ObjectFormat::from_u8(1).expect_err("sha256 must be rejected");
        assert!(matches!(
            error,
            NativeError::UnknownDiscriminant {
                field: "object_format",
                ..
            }
        ));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut payload = sample().encode().expect("encode");
        payload.push(0x00);
        let error = MetaSection::decode(&payload).expect_err("trailing byte must fail");
        assert!(matches!(
            error,
            NativeError::TruncatedRecord {
                tag: "META",
                remaining: 1
            }
        ));
    }

    #[test]
    fn rejects_short_payload() {
        let payload = [0u8; 8];
        let error = MetaSection::decode(&payload).expect_err("short payload must fail");
        assert!(matches!(error, NativeError::FieldOverrun { .. }));
    }
}
