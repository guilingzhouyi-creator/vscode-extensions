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
use fg_core::models::{BlackboardCollision, CardBlackboard};
use fg_core::path_matches_scope;

/// Directory name under `.git` or `.taxis` storing active intent blackboards.
pub const BLACKBOARD_DIR: &str = "blackboard";

/// Disk storage driver for Card-scoped intent blackboards.
#[derive(Debug, Clone)]
pub struct DiskBlackboardStore {
    base_dir: PathBuf,
}

impl DiskBlackboardStore {
    /// Resolves the canonical blackboard directory from a `.git` or worktree path.
    pub fn resolve_dir(git_dir: impl AsRef<Path>) -> PathBuf {
        let root = git_dir.as_ref();
        if root.join(BLACKBOARD_DIR).is_dir() {
            return root.join(BLACKBOARD_DIR);
        }
        if root.join(".taxis").join(BLACKBOARD_DIR).is_dir() {
            return root.join(".taxis").join(BLACKBOARD_DIR);
        }
        if let Some(parent) = root.parent() {
            let parent_taxis = parent.join(".taxis").join(BLACKBOARD_DIR);
            if parent_taxis.is_dir() {
                return parent_taxis;
            }
        }
        root.join(BLACKBOARD_DIR)
    }

    /// Creates a store instance rooted at `git_dir`.
    pub fn new(git_dir: impl AsRef<Path>) -> Self {
        Self {
            base_dir: Self::resolve_dir(git_dir),
        }
    }

    /// Returns the resolved base directory for blackboards.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }

    /// Resolves the filesystem path for a specific Card blackboard.
    pub fn card_path(&self, card_id: &str) -> PathBuf {
        let safe_name = card_id.replace(['/', '\\', ':'], "_");
        self.base_dir.join(format!("{safe_name}.intent.json"))
    }

    /// Loads all active card blackboards from disk.
    pub fn load_all(&self) -> FractalResult<Vec<CardBlackboard>> {
        if !self.base_dir.is_dir() {
            return Ok(Vec::new());
        }
        let read_dir = match fs::read_dir(&self.base_dir) {
            Ok(iter) => iter,
            Err(_) => return Ok(Vec::new()),
        };
        let mut blackboards = Vec::new();
        for entry in read_dir.flatten() {
            let path = entry.path();
            let is_intent = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".intent.json"));
            if is_intent && path.is_file() {
                if let Ok(bytes) = fs::read(&path) {
                    if let Ok(board) = serde_json::from_slice::<CardBlackboard>(&bytes) {
                        blackboards.push(board);
                    }
                }
            }
        }
        Ok(blackboards)
    }

    /// Checks if writing to `target_path` is blocked by an active lease held by another Agent or Cell.
    ///
    /// Non-conflicting writes (no lease, same Cell, or same Agent) return `Ok(None)`.
    pub fn assert_write_permitted(
        &self,
        target_path: &str,
        current_agent: Option<&str>,
        current_cell: Option<&str>,
        now_ms: i64,
    ) -> FractalResult<Option<BlackboardCollision>> {
        if !self.base_dir.exists() {
            return Ok(None);
        }
        let boards = self.load_all()?;
        for board in &boards {
            if let Some(cell) = current_cell {
                if cell == board.cell_id {
                    continue;
                }
            }
            for lease in &board.active_leases {
                if lease.is_expired(now_ms) {
                    continue;
                }
                if let Some(agent) = current_agent {
                    if agent == lease.agent_uid {
                        continue;
                    }
                }
                let covers = lease.file_path == "*"
                    || lease.file_path == target_path
                    || path_matches_scope(target_path, &lease.file_path);
                if covers {
                    let expiry_ms = lease.acquired_at_ms + (lease.ttl_seconds as i64 * 1000);
                    let remaining_ttl = ((expiry_ms - now_ms).max(0) / 1000) as u64;
                    return Ok(Some(BlackboardCollision {
                        file_path: target_path.to_string(),
                        scope_id: lease.scope_id.clone(),
                        conflicting_agent: lease.agent_uid.clone(),
                        conflicting_lease_id: lease.lease_id.clone(),
                        remaining_ttl_seconds: remaining_ttl,
                    }));
                }
            }
        }
        Ok(None)
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
        let target_path = self.card_path(&board.card_id);
        let json_bytes = serde_json::to_vec_pretty(board).map_err(FractalError::Json)?;
        fg_core::write_file_atomic(&target_path, &json_bytes, false).map_err(FractalError::Io)
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
