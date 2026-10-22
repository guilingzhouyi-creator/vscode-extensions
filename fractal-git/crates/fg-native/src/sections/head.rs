//! Module: fg-native — HEAD Section Codec
//! File Path: crates/fg-native/src/sections/head.rs
//! Architecture Role: Encodes whether the repository is on a symbolic branch or detached at a
//!   specific commit, which is the single fact every read command resolves first.
//! Dependencies & Triggers: Consumed by `Repo::open` and every command that needs the current
//!   revision; written by `commit`, `checkout`, and `init`.
//! Responsibilities: Round-trip the head state as a closed two-variant enum.
//! Exit Semantics & Design Rationale:
//!   - A detached head and a symbolic head are distinct states, not a nullable string: modelling
//!     them as an enum makes "detached with no object id" and "symbolic with an empty name"
//!     unrepresentable rather than merely discouraged.
//!   - An empty symbolic target is rejected on both encode and decode: it would resolve to the
//!     repository root and silently match nothing.

use crate::codec::{FieldReader, FieldWriter};
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "HEAD";

/// Discriminant for a symbolic head pointing at a branch.
const KIND_SYMBOLIC: u8 = 0;

/// Discriminant for a head detached at a specific commit.
const KIND_DETACHED: u8 = 1;

/// Current head state of the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeadState {
    /// The head is a symbolic reference to a branch name such as `refs/heads/main`.
    Symbolic {
        /// Fully qualified reference name the head points at.
        target: String,
    },
    /// The head is detached at a specific object id.
    Detached {
        /// Commit the head is checked out at.
        oid: fg_core::models::Oid,
    },
}

impl HeadState {
    /// Returns the symbolic target when the head is attached to a branch.
    pub fn symbolic_target(&self) -> Option<&str> {
        match self {
            Self::Symbolic { target } => Some(target.as_str()),
            Self::Detached { .. } => None,
        }
    }

    /// Returns the detached object id when the head is not on a branch.
    pub fn detached_oid(&self) -> Option<&fg_core::models::Oid> {
        match self {
            Self::Symbolic { .. } => None,
            Self::Detached { oid } => Some(oid),
        }
    }

    /// Serializes the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::InteriorNul`] or [`NativeError::FieldOverrun`] when the symbolic
    /// target cannot be encoded, and [`NativeError::FieldOverrun`] when it is empty.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        let mut writer = FieldWriter::with_capacity(32);
        match self {
            Self::Symbolic { target } => {
                if target.is_empty() {
                    return Err(NativeError::FieldOverrun {
                        field: "head_target",
                        needed: 1,
                        available: 0,
                    });
                }
                writer.write_u8(KIND_SYMBOLIC);
                writer.write_string("head_target", target)?;
            }
            Self::Detached { oid } => {
                writer.write_u8(KIND_DETACHED);
                writer.write_oid(oid);
            }
        }
        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] for an unrecognized kind, field-level errors for
    /// a short payload, and [`NativeError::TruncatedRecord`] when trailing bytes remain.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let kind = reader.read_u8("head_kind")?;

        let state = match kind {
            KIND_SYMBOLIC => {
                let target = reader.read_string("head_target")?;
                if target.is_empty() {
                    return Err(NativeError::FieldOverrun {
                        field: "head_target",
                        needed: 1,
                        available: 0,
                    });
                }
                Self::Symbolic { target }
            }
            KIND_DETACHED => Self::Detached {
                oid: reader.read_oid("head_oid")?,
            },
            other => {
                return Err(NativeError::UnknownDiscriminant {
                    field: "head_kind",
                    value: other,
                })
            }
        };

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::HeadState;
    use crate::error::NativeError;

    #[test]
    fn symbolic_round_trip() {
        let original = HeadState::Symbolic {
            target: "refs/heads/main".to_owned(),
        };
        let encoded = original.encode().expect("encode");
        let decoded = HeadState::decode(&encoded).expect("decode");
        assert_eq!(decoded, original);
        assert_eq!(decoded.symbolic_target(), Some("refs/heads/main"));
        assert_eq!(decoded.detached_oid(), None);
    }

    #[test]
    fn detached_round_trip() {
        let mut raw = [0u8; 20];
        raw[0] = 0xDE;
        raw[19] = 0xAD;
        let original = HeadState::Detached {
            oid: Oid::from_bytes(raw),
        };
        let encoded = original.encode().expect("encode");
        let decoded = HeadState::decode(&encoded).expect("decode");
        assert_eq!(decoded, original);
        assert_eq!(decoded.symbolic_target(), None);
        assert!(decoded.detached_oid().is_some());
    }

    #[test]
    fn rejects_empty_symbolic_target_on_encode() {
        let state = HeadState::Symbolic {
            target: String::new(),
        };
        let error = state.encode().expect_err("empty target must fail");
        assert!(matches!(error, NativeError::FieldOverrun { .. }));
    }

    #[test]
    fn rejects_unknown_kind() {
        let payload = [0x07u8];
        let error = HeadState::decode(&payload).expect_err("unknown kind must fail");
        assert!(matches!(
            error,
            NativeError::UnknownDiscriminant {
                field: "head_kind",
                value: 7
            }
        ));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut payload = HeadState::Symbolic {
            target: "refs/heads/main".to_owned(),
        }
        .encode()
        .expect("encode");
        payload.push(0xFF);
        let error = HeadState::decode(&payload).expect_err("trailing byte must fail");
        assert!(matches!(
            error,
            NativeError::TruncatedRecord {
                tag: "HEAD",
                remaining: 1
            }
        ));
    }
}
