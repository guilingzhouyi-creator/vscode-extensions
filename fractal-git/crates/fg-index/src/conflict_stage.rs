//! Module: fg-index — Multi-Stage Conflict Slot
//! File Path: crates/fg-index/src/conflict_stage.rs
//! Architecture Role: Encapsulates an unmerged path's Base, Ours, and Theirs entries until an
//!   Agent or gate resolves it.
//! Dependencies & Triggers: Populated by the merge engine and the staging index; consumed by
//!   conflict-resolution commands.
//! Responsibilities: Record per-stage entries, report which stages are present, and hand back a
//!   resolved entry under a chosen strategy.
//! Exit Semantics & Design Rationale:
//!   - Each stage slot holds the full [`StagingEntry`], not a `(mode, oid)` pair. A pair loses the
//!     path and the stage, forcing every consumer to reconstruct them and inviting a mismatch.
//!   - Resolution returns `Option`, never a synthesized placeholder: a conflict with no "ours" side
//!     must be reported as unresolvable rather than silently resolved to an empty entry.

use fg_core::models::{FileMode, IndexStage, Oid};

use crate::entry::StagingEntry;

/// Three-way conflict representation for one unmerged path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictStageSlot {
    /// Path the conflict applies to.
    pub path: String,
    /// Merge-base entry, present when the path existed on both sides' common ancestor.
    pub base: Option<StagingEntry>,
    /// Current-branch entry.
    pub ours: Option<StagingEntry>,
    /// Incoming-branch entry.
    pub theirs: Option<StagingEntry>,
}

impl ConflictStageSlot {
    /// Creates an empty conflict slot for a path.
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            base: None,
            ours: None,
            theirs: None,
        }
    }

    /// Records an entry into its corresponding stage slot.
    ///
    /// A resolved (stage 0) entry is ignored: it belongs in the index's resolved map, not in a
    /// conflict slot, and accepting it here would leave a slot that can never be cleared.
    pub fn record_stage(&mut self, entry: &StagingEntry) {
        match entry.stage {
            IndexStage::Base => self.base = Some(entry.clone()),
            IndexStage::Ours => self.ours = Some(entry.clone()),
            IndexStage::Theirs => self.theirs = Some(entry.clone()),
            IndexStage::Normal => {}
        }
    }

    /// Reports whether every stage slot is empty.
    pub fn is_empty(&self) -> bool {
        self.base.is_none() && self.ours.is_none() && self.theirs.is_none()
    }

    /// Reports whether both sides of the conflict are present.
    ///
    /// A slot with only one side is a delete/modify conflict: it is still a conflict, but it cannot
    /// be resolved by choosing a side that does not exist.
    pub fn is_two_sided(&self) -> bool {
        self.ours.is_some() && self.theirs.is_some()
    }

    /// Resolves the conflict in favor of the current branch.
    pub fn resolve_ours(&self) -> Option<StagingEntry> {
        self.ours.clone()
    }

    /// Resolves the conflict in favor of the incoming branch.
    pub fn resolve_theirs(&self) -> Option<StagingEntry> {
        self.theirs.clone()
    }

    /// Resolves the conflict with a newly synthesized object id and mode.
    pub fn resolve_custom(&self, mode: FileMode, merged_oid: Oid) -> StagingEntry {
        StagingEntry::new(self.path.clone(), mode, merged_oid)
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::{FileMode, IndexStage, Oid};

    use super::ConflictStageSlot;
    use crate::entry::StagingEntry;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    fn staged(seed: u8, stage: IndexStage) -> StagingEntry {
        StagingEntry::with_stage("a.txt", FileMode::RegularFile, oid_from(seed), stage)
    }

    #[test]
    fn new_slot_is_empty() {
        let slot = ConflictStageSlot::new("a.txt");
        assert!(slot.is_empty());
        assert!(!slot.is_two_sided());
    }

    #[test]
    fn records_each_stage_into_its_own_slot() {
        let mut slot = ConflictStageSlot::new("a.txt");
        slot.record_stage(&staged(1, IndexStage::Base));
        slot.record_stage(&staged(2, IndexStage::Ours));
        slot.record_stage(&staged(3, IndexStage::Theirs));

        assert_eq!(slot.base.as_ref().map(|e| e.oid), Some(oid_from(1)));
        assert_eq!(slot.ours.as_ref().map(|e| e.oid), Some(oid_from(2)));
        assert_eq!(slot.theirs.as_ref().map(|e| e.oid), Some(oid_from(3)));
        assert!(slot.is_two_sided());
    }

    #[test]
    fn resolved_entry_is_not_recorded() {
        let mut slot = ConflictStageSlot::new("a.txt");
        slot.record_stage(&staged(1, IndexStage::Normal));
        assert!(slot.is_empty());
    }

    #[test]
    fn delete_modify_conflict_is_one_sided() {
        let mut slot = ConflictStageSlot::new("a.txt");
        slot.record_stage(&staged(2, IndexStage::Ours));
        assert!(!slot.is_empty());
        assert!(!slot.is_two_sided());
        assert!(slot.resolve_theirs().is_none());
        assert!(slot.resolve_ours().is_some());
    }

    #[test]
    fn custom_resolution_carries_the_path() {
        let slot = ConflictStageSlot::new("a.txt");
        let resolved = slot.resolve_custom(FileMode::ExecutableFile, oid_from(7));
        assert_eq!(resolved.path, "a.txt");
        assert_eq!(resolved.mode, FileMode::ExecutableFile);
        assert!(resolved.is_resolved());
    }
}
