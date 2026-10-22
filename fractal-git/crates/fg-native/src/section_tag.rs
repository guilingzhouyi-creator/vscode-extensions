//! Module: fg-native — TAXC Section Tag Registry
//! File Path: crates/fg-native/src/section_tag.rs
//! Architecture Role: Closed enumeration of the eight defined TAXC section tags.
//! Dependencies & Triggers: Consumed by container.rs, every section codec, and `taxis doctor`.
//! Responsibilities: Map between the four-byte on-disk tag and a typed enum, and state which
//!   sections a well-formed container must carry.
//! Exit Semantics & Design Rationale:
//!   - The tag set is closed: an unrecognized four-byte tag is reported as `UnknownDiscriminant`
//!     rather than being skipped, because silently ignoring a section would hide data loss.
//!   - `Order` is derived from the declaration order, which is *not* the on-disk sort order; the
//!     on-disk order is defined by the raw tag bytes and is validated separately.

use std::fmt;

use crate::error::{NativeError, NativeResult};

/// Closed enumeration of TAXC section tags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum SectionTag {
    /// Repository metadata: identity, creation time, object format, layout mode.
    Meta,
    /// Current reference: either a symbolic target or a detached object id.
    Head,
    /// Reference table: ordered name to object-id mappings with optional peeled targets.
    Refs,
    /// Staging index: ordered path to (mode, object id, stage) records.
    Indx,
    /// Operation log DAG: immutable operation records with parent links.
    OpLog,
    /// Promotion ledger: staged promotion requests and their verdicts.
    Prom,
    /// Worktree registry: allocated worktrees with their projection scopes.
    Wktr,
    /// Change-id to commit-id mapping table.
    Idmp,
}

impl SectionTag {
    /// Every tag this build understands, in ascending on-disk byte order.
    pub const ALL: [Self; 8] = [
        Self::Head,
        Self::Idmp,
        Self::Indx,
        Self::Meta,
        Self::OpLog,
        Self::Prom,
        Self::Refs,
        Self::Wktr,
    ];

    /// Returns the four raw on-disk bytes for this tag.
    pub const fn as_bytes(self) -> [u8; 4] {
        match self {
            Self::Meta => *b"META",
            Self::Head => *b"HEAD",
            Self::Refs => *b"REFS",
            Self::Indx => *b"INDX",
            Self::OpLog => *b"OPLG",
            Self::Prom => *b"PROM",
            Self::Wktr => *b"WKTR",
            Self::Idmp => *b"IDMP",
        }
    }

    /// Returns the human-facing name used in diagnostics.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Meta => "META",
            Self::Head => "HEAD",
            Self::Refs => "REFS",
            Self::Indx => "INDX",
            Self::OpLog => "OPLG",
            Self::Prom => "PROM",
            Self::Wktr => "WKTR",
            Self::Idmp => "IDMP",
        }
    }

    /// Decodes a raw four-byte tag.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] when the bytes match no defined tag; an
    /// unrecognized section is never skipped silently.
    pub fn from_bytes(raw: [u8; 4]) -> NativeResult<Self> {
        match &raw {
            b"META" => Ok(Self::Meta),
            b"HEAD" => Ok(Self::Head),
            b"REFS" => Ok(Self::Refs),
            b"INDX" => Ok(Self::Indx),
            b"OPLG" => Ok(Self::OpLog),
            b"PROM" => Ok(Self::Prom),
            b"WKTR" => Ok(Self::Wktr),
            b"IDMP" => Ok(Self::Idmp),
            _ => Err(NativeError::UnknownDiscriminant {
                field: "section tag",
                value: raw[0],
            }),
        }
    }

    /// Reports whether a well-formed container must carry this section.
    ///
    /// `IDMP` is optional: it only materializes once change-id tracking is populated.
    pub const fn is_mandatory(self) -> bool {
        !matches!(self, Self::Idmp)
    }
}

impl fmt::Display for SectionTag {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::SectionTag;

    #[test]
    fn round_trips_every_tag() {
        for tag in SectionTag::ALL {
            let decoded = SectionTag::from_bytes(tag.as_bytes()).expect("defined tag must decode");
            assert_eq!(decoded, tag);
        }
    }

    #[test]
    fn rejects_unknown_tag() {
        assert!(SectionTag::from_bytes(*b"ZZZZ").is_err());
    }

    #[test]
    fn all_is_sorted_by_raw_bytes() {
        let mut previous = SectionTag::ALL[0].as_bytes();
        for tag in SectionTag::ALL.iter().skip(1) {
            let current = tag.as_bytes();
            assert!(previous < current, "tag order must ascend by raw bytes");
            previous = current;
        }
    }

    #[test]
    fn only_idmp_is_optional() {
        let optional: Vec<SectionTag> = SectionTag::ALL
            .into_iter()
            .filter(|tag| !tag.is_mandatory())
            .collect();
        assert_eq!(optional, vec![SectionTag::Idmp]);
    }
}
