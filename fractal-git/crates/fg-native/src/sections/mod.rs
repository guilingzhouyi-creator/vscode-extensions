//! Module: fg-native — Section Codec Facade
//! File Path: crates/fg-native/src/sections/mod.rs
//! Architecture Role: Aggregates the TAXC section codecs behind one import surface.
//! Dependencies & Triggers: Consumed by fg-repo and the Taxis CLI.
//! Responsibilities: Re-export the metadata, head, reference, and index codecs plus their record
//!   types.
//! Exit Semantics & Design Rationale: Pure re-export module; it holds no logic and therefore has
//!   no failure paths of its own.
//!
//! `FileMode` and `IndexStage` are re-exported from `fg_core` rather than defined here: the
//! in-memory index writes the same bytes through the same types, so a second definition would let
//! one layer accept a value the other rejects.

pub mod head;
pub mod indx;
pub mod meta;
pub mod oplog;
pub mod prom;
pub mod refs;
pub mod worktree_registry;

pub use head::HeadState;
pub use indx::{IndexEntry, IndxSection, StatCache};
pub use meta::{LayoutMode, MetaSection, ObjectFormat, REPO_ID_LEN};
pub use oplog::{OpLogEntry, OpLogParts, OpLogSection};
pub use prom::{PromSection, PromotionRecord, PromotionStatus, CHALLENGE_NONCE_LEN};
pub use refs::{RefRecord, RefsSection};
pub use worktree_registry::{WktrSection, WorktreeMode, WorktreeRecord, WorktreeTier};

pub use fg_core::models::{FileMode, IndexStage};
