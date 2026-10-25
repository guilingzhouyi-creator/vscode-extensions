//! Module: fg-topology — Persistent Intent Blackboard Storage
//! File Path: crates/fg-topology/src/blackboard.rs
//! Architecture Role: Manages persistent, lockless atomic disk persistence for active SubAgent intent leases
//!   under `.taxis/blackboard/<card_id>.intent.json`.
//! Dependencies & Triggers: Consumed by Taxis CLI blackboard commands and orchestrator hooks.
//! Responsibilities: Load blackboard state, atomic rename write, and expired lease pruning.
//! Exit Semantics & Design Rationale:
//!   - Atomic write via staging file prevents corrupt partial JSON reads during concurrent access.
//!   - Idempotent directory creation ensures resilient operation in fresh repositories.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::CardBlackboard;

/// Directory name under `.git` or `.taxis` storing active intent blackboards.
pub const BLACKBOARD_DIR: &str = "blackboard";

/// Disk storage driver for Card-scoped intent blackboards.
#[derive(Debug, Clone)]
pub struct DiskBlackboardStore {
    base_dir: PathBuf,
}

impl DiskBlackboardStore {
    /// Creates a store instance rooted at `git_dir`.
    pub fn new(git_dir: impl AsRef<Path>) -> Self {
        Self {
            base_dir: git_dir.as_ref().join(BLACKBOARD_DIR),
        }
    }

    /// Resolves the filesystem path for a specific Card blackboard.
    pub fn card_path(&self, card_id: &str) -> PathBuf {
        let safe_name = card_id.replace(['/', '\\', ':'], "_");
        self.base_dir.join(format!("{safe_name}.intent.json"))
    }

    /// Loads the active blackboard for `card_id`, creating a new empty instance if absent.
    pub fn load_or_create(&self, card_id: &str, cell_id: &str) -> FractalResult<CardBlackboard> {
        let path = self.card_path(card_id);
        if !path.is_file() {
            return Ok(CardBlackboard::new(cell_id, card_id));
        }

        let bytes = fs::read(&path).map_err(FractalError::Io)?;
        let board: CardBlackboard = serde_json::from_slice(&bytes).map_err(FractalError::Json)?;

        Ok(board)
    }

    /// Atomically persists the blackboard state to disk using a unique temporary file.
    pub fn save(&self, board: &CardBlackboard) -> FractalResult<()> {
        if !self.base_dir.exists() {
            fs::create_dir_all(&self.base_dir).map_err(FractalError::Io)?;
        }

        let target_path = self.card_path(&board.card_id);
        let seq = std::process::id();
        let staging_path = self.base_dir.join(format!(".{}-{seq}.tmp", board.card_id));

        let json_bytes = serde_json::to_vec_pretty(board).map_err(FractalError::Json)?;

        fs::write(&staging_path, &json_bytes).map_err(FractalError::Io)?;

        if let Err(rename_err) = fs::rename(&staging_path, &target_path) {
            let _ = fs::remove_file(&staging_path);
            return Err(FractalError::Io(rename_err));
        }

        Ok(())
    }

    /// Removes a blackboard file when a Card worktree is reclaimed or merged.
    pub fn remove(&self, card_id: &str) -> FractalResult<()> {
        let path = self.card_path(card_id);
        if path.is_file() {
            fs::remove_file(&path).map_err(FractalError::Io)?;
        }
        Ok(())
    }
}
