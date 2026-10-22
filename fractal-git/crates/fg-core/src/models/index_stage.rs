//! Module: fg-core — Canonical Index Merge Stage
//! File Path: crates/fg-core/src/models/index_stage.rs
//! Architecture Role: Single source of truth for the four merge stages a staging entry may occupy.
//!   Lives in fg-core because the in-memory index and the on-disk INDX section must agree on the
//!   numeric encoding; two parallel enums would let one layer accept a value the other rejects.
//! Dependencies & Triggers: Consumed by fg-index staging entries, fg-native INDX section, and the
//!   three-way merge engine.
//! Responsibilities: Map between the typed stage and the single byte stored on disk.
//! Exit Semantics & Design Rationale:
//!   - The set is closed and ordered by ascending stage byte. Sorting entries by `(path, stage)`
//!     therefore groups stage 0 before the three conflict stages, which is exactly the order Git
//!     uses and the order binary search depends on.
//!   - An out-of-range byte is rejected with its value attached rather than clamped: clamping would
//!     turn a corrupt index into a silent conflict resolution.

use crate::error::{FractalError, FractalResult};

/// The merge stage a staging entry belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum IndexStage {
    /// Stage 0: resolved content, the only stage a clean entry occupies.
    Normal = 0,
    /// Stage 1: merge base, present only while a conflict is unresolved.
    Base = 1,
    /// Stage 2: current branch side of a conflict.
    Ours = 2,
    /// Stage 3: incoming branch side of a conflict.
    Theirs = 3,
}

impl IndexStage {
    /// Every stage this build understands, in ascending on-disk order.
    pub const ALL: [Self; 4] = [Self::Normal, Self::Base, Self::Ours, Self::Theirs];

    /// Returns the single on-disk stage byte.
    pub const fn to_u8(self) -> u8 {
        self as u8
    }

    /// Decodes the single on-disk stage byte.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::UnknownIndexStage`] carrying the offending byte for any value above
    /// three.
    pub const fn from_u8(value: u8) -> FractalResult<Self> {
        match value {
            0 => Ok(Self::Normal),
            1 => Ok(Self::Base),
            2 => Ok(Self::Ours),
            3 => Ok(Self::Theirs),
            other => Err(FractalError::UnknownIndexStage { stage: other }),
        }
    }

    /// Reports whether this stage represents resolved, non-conflicting content.
    pub const fn is_resolved(self) -> bool {
        matches!(self, Self::Normal)
    }
}

#[cfg(test)]
mod tests {
    use super::IndexStage;
    use crate::error::FractalError;

    #[test]
    fn byte_round_trips_for_every_stage() {
        for stage in IndexStage::ALL {
            assert_eq!(IndexStage::from_u8(stage.to_u8()).expect("decode"), stage);
        }
    }

    #[test]
    fn ordering_places_resolved_first_then_conflict_stages() {
        let mut shuffled = [
            IndexStage::Theirs,
            IndexStage::Normal,
            IndexStage::Ours,
            IndexStage::Base,
        ];
        shuffled.sort();
        assert_eq!(shuffled, IndexStage::ALL);
    }

    #[test]
    fn rejects_out_of_range_byte() {
        let error = IndexStage::from_u8(4).expect_err("out of range must fail");
        match error {
            FractalError::UnknownIndexStage { stage } => assert_eq!(stage, 4),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn only_normal_is_resolved() {
        for stage in IndexStage::ALL {
            assert_eq!(stage.is_resolved(), stage == IndexStage::Normal);
        }
    }
}
