//! Module: fg-index — Multi-Stage Conflict Slot
//! File Path: crates/fg-index/src/conflict_stage.rs
//! Architecture Role: Encapsulates unmerged conflict slots holding Base, Ours, and Theirs OIDs
//!   for a conflicting path until an Agent or Gate resolves them.

use fg_core::models::Oid;
use fg_object::FileMode;

use crate::entry::{IndexStage, VirtualIndexEntry};

/// Three-way conflict representation for an unmerged path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictStageSlot {
    pub path: String,
    pub base: Option<(FileMode, Oid)>,
    pub ours: Option<(FileMode, Oid)>,
    pub theirs: Option<(FileMode, Oid)>,
}

impl ConflictStageSlot {
    /// Creates an empty conflict slot for target path.
    pub fn new(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            base: None,
            ours: None,
            theirs: None,
        }
    }

    /// Records an entry into its respective conflict stage.
    pub fn record_stage(&mut self, entry: &VirtualIndexEntry) {
        let pair = Some((entry.mode, entry.oid));
        match entry.stage {
            IndexStage::Base => self.base = pair,
            IndexStage::Ours => self.ours = pair,
            IndexStage::Theirs => self.theirs = pair,
            IndexStage::Normal => {}
        }
    }

    /// Resolves the conflict in favor of Ours (target branch).
    pub fn resolve_ours(&self) -> Option<VirtualIndexEntry> {
        self.ours
            .map(|(mode, oid)| VirtualIndexEntry::new(self.path.clone(), mode, oid))
    }

    /// Resolves the conflict in favor of Theirs (incoming subagent branch).
    pub fn resolve_theirs(&self) -> Option<VirtualIndexEntry> {
        self.theirs
            .map(|(mode, oid)| VirtualIndexEntry::new(self.path.clone(), mode, oid))
    }

    /// Resolves with a newly synthesized content OID and mode.
    pub fn resolve_custom(&self, mode: FileMode, merged_oid: Oid) -> VirtualIndexEntry {
        VirtualIndexEntry::new(self.path.clone(), mode, merged_oid)
    }
}
