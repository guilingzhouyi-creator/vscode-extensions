//! Module: fg-index — Elastic Quarantine & Violation Isolation Stash
//! File Path: crates/fg-index/src/quarantine.rs
//! Architecture Role: Implements the 1+3 hybrid violation governance model: strict commit fail-closed
//!   interception paired with elastic quarantine stashing (.taxis/quarantine/) and structured escalation.
//! Dependencies & Triggers: Consumes FileUid from fg-core; operates within the .taxis/quarantine/ directory;
//!   invoked whenever an unauthorized FileUid or MutationBudget overflow is intercepted.
//! Responsibilities: Preserve untracked or unauthorized agent modifications in atomic patch files,
//!   maintain an audit ledger of quarantined records, and emit structured escalation diagnostics.
//! Exit Semantics & Design Rationale: Guarantees zero agent work loss during permission violations
//!   while maintaining an uncompromised formal commit DAG.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-GAT-001`: Gate and violation boundary isolation guard

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::FileUid;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Status of an isolated modification in quarantine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QuarantineStatus {
    /// Modification is safely preserved in quarantine and excluded from commit tree.
    Isolated,
    /// Modification was approved, re-applied, or incorporated into worktree.
    Restored,
    /// Modification was explicitly discarded by supervisor or rollback action.
    Discarded,
}

/// Structured record describing a quarantined modification and reason for interception.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuarantineRecord {
    /// Unique identifier for this quarantine entry (e.g. "quar-1729000-001").
    pub quarantine_id: String,
    /// Project identifier where violation occurred.
    pub project_id: String,
    /// SubAgent identifier that attempted the unauthorized mutation.
    pub agent_id: String,
    /// Target repository-relative file path.
    pub rel_path: String,
    /// Invariant FileUid if known or tracked.
    pub file_uid: Option<FileUid>,
    /// Relative path to stored unified patch or raw payload.
    pub patch_file: String,
    /// Human-readable and machine-scannable root reason for interception.
    pub reason: String,
    /// Unix timestamp when isolation took place.
    pub quarantined_at: u64,
    /// Current lifecycle status.
    pub status: QuarantineStatus,
}

/// Quarantine ledger index stored in `.taxis/quarantine/quarantine_index.json`.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct QuarantineLedger {
    /// Recorded quarantine entries.
    pub records: Vec<QuarantineRecord>,
}

/// Parameters for isolating an unauthorized mutation into quarantine.
#[derive(Debug, Clone)]
pub struct IsolateMutationRequest<'a> {
    pub quarantine_dir: &'a Path,
    pub project_id: &'a str,
    pub agent_id: &'a str,
    pub rel_path: &'a str,
    pub file_uid: Option<FileUid>,
    pub patch_or_content: &'a str,
    pub reason: &'a str,
    pub current_time: u64,
    pub nonce: u64,
}

impl QuarantineLedger {
    /// Index filename under the quarantine root.
    pub const INDEX_FILENAME: &'static str = "quarantine_index.json";

    /// Loads the quarantine ledger from a given directory.
    pub fn load_from_dir(quarantine_dir: &Path) -> FractalResult<Self> {
        let index_file = quarantine_dir.join(Self::INDEX_FILENAME);
        if !index_file.exists() {
            return Ok(Self::default());
        }

        let index_bytes = fs::read(&index_file)?;
        let ledger: Self = serde_json::from_slice(&index_bytes)?;
        Ok(ledger)
    }

    /// Atomically persists the quarantine ledger into the directory.
    pub fn save_to_dir(&self, quarantine_dir: &Path) -> FractalResult<()> {
        fs::create_dir_all(quarantine_dir)?;
        let index_file = quarantine_dir.join(Self::INDEX_FILENAME);
        let staging_file = quarantine_dir.join(format!("{}.tmp", Self::INDEX_FILENAME));

        let serialized_bytes = serde_json::to_vec_pretty(self)?;
        fs::write(&staging_file, serialized_bytes)?;
        fs::rename(&staging_file, &index_file)?;
        Ok(())
    }

    /// Isolates an unauthorized or overflow mutation into the quarantine stash.
    pub fn isolate_mutation(req: IsolateMutationRequest<'_>) -> FractalResult<QuarantineRecord> {
        fs::create_dir_all(req.quarantine_dir)?;

        let quarantine_id = format!("quar-{}-{}", req.current_time, req.nonce);
        let patch_filename = format!("{}.patch", quarantine_id);
        let patch_path = req.quarantine_dir.join(&patch_filename);

        fs::write(&patch_path, req.patch_or_content)?;

        let record = QuarantineRecord {
            quarantine_id,
            project_id: req.project_id.to_string(),
            agent_id: req.agent_id.to_string(),
            rel_path: req.rel_path.to_string(),
            file_uid: req.file_uid,
            patch_file: patch_filename,
            reason: req.reason.to_string(),
            quarantined_at: req.current_time,
            status: QuarantineStatus::Isolated,
        };

        let mut ledger = Self::load_from_dir(req.quarantine_dir)?;
        ledger.records.push(record.clone());
        ledger.save_to_dir(req.quarantine_dir)?;

        Ok(record)
    }

    /// Lists all quarantine records currently in `Isolated` status.
    pub fn list_active_isolated(quarantine_dir: &Path) -> FractalResult<Vec<QuarantineRecord>> {
        let ledger = Self::load_from_dir(quarantine_dir)?;
        let active = ledger
            .records
            .into_iter()
            .filter(|record| record.status == QuarantineStatus::Isolated)
            .collect();
        Ok(active)
    }

    /// Finds a quarantine record by identifier.
    pub fn find_by_id(
        quarantine_dir: &Path,
        quarantine_id: &str,
    ) -> FractalResult<Option<QuarantineRecord>> {
        let ledger = Self::load_from_dir(quarantine_dir)?;
        let found = ledger
            .records
            .into_iter()
            .find(|record| record.quarantine_id == quarantine_id);
        Ok(found)
    }

    /// Reads the raw patch content for a quarantine record.
    pub fn read_patch_content(
        quarantine_dir: &Path,
        record: &QuarantineRecord,
    ) -> FractalResult<String> {
        let patch_path = quarantine_dir.join(&record.patch_file);
        if !patch_path.exists() {
            return Err(FractalError::CorruptStore(format!(
                "Quarantine patch file missing: {}",
                patch_path.display()
            )));
        }
        let content = fs::read_to_string(&patch_path)?;
        Ok(content)
    }

    /// Marks a quarantine record as restored.
    pub fn mark_restored(quarantine_dir: &Path, quarantine_id: &str) -> FractalResult<()> {
        let mut ledger = Self::load_from_dir(quarantine_dir)?;
        let record = ledger
            .records
            .iter_mut()
            .find(|record| record.quarantine_id == quarantine_id)
            .ok_or_else(|| {
                FractalError::CorruptStore(format!(
                    "Quarantine record not found: {}",
                    quarantine_id
                ))
            })?;

        record.status = QuarantineStatus::Restored;
        ledger.save_to_dir(quarantine_dir)?;
        Ok(())
    }

    /// Marks a quarantine record as discarded.
    pub fn mark_discarded(quarantine_dir: &Path, quarantine_id: &str) -> FractalResult<()> {
        let mut ledger = Self::load_from_dir(quarantine_dir)?;
        let record = ledger
            .records
            .iter_mut()
            .find(|record| record.quarantine_id == quarantine_id)
            .ok_or_else(|| {
                FractalError::CorruptStore(format!(
                    "Quarantine record not found: {}",
                    quarantine_id
                ))
            })?;

        record.status = QuarantineStatus::Discarded;
        ledger.save_to_dir(quarantine_dir)?;
        Ok(())
    }
}

/// Helper function to resolve default repository quarantine directory (.taxis/quarantine).
pub fn default_quarantine_dir(git_dir: &Path) -> PathBuf {
    git_dir.join("quarantine")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quarantine_isolation_and_lifecycle() {
        let scratch_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let test_dir = std::env::current_dir()
            .expect("cwd")
            .join("target/test_tmp")
            .join(format!("quarantine-test-{}", scratch_id));
        let _ = fs::remove_dir_all(&test_dir);

        let uid = FileUid::derive("my-game", "agent-x", "src/secret.rs", 100, 1);
        let patch_payload = "--- a/src/secret.rs\n+++ b/src/secret.rs\n@@ -1 +1 @@\n-old\n+new\n";

        // 1. Isolate mutation
        let record = QuarantineLedger::isolate_mutation(IsolateMutationRequest {
            quarantine_dir: &test_dir,
            project_id: "my-game",
            agent_id: "agent-x",
            rel_path: "src/secret.rs",
            file_uid: Some(uid),
            patch_or_content: patch_payload,
            reason: "FileUid not in authorization slice allowlist",
            current_time: 2000,
            nonce: 1,
        })
        .expect("isolation succeeds");

        assert_eq!(record.status, QuarantineStatus::Isolated);
        assert_eq!(record.project_id, "my-game");

        // 2. Read patch back
        let retrieved_patch =
            QuarantineLedger::read_patch_content(&test_dir, &record).expect("read patch");
        assert_eq!(retrieved_patch, patch_payload);

        // 3. List active
        let active = QuarantineLedger::list_active_isolated(&test_dir).expect("list active");
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].quarantine_id, record.quarantine_id);

        // 4. Mark restored
        QuarantineLedger::mark_restored(&test_dir, &record.quarantine_id).expect("mark restored");
        let active_after =
            QuarantineLedger::list_active_isolated(&test_dir).expect("list active after");
        assert_eq!(active_after.len(), 0);

        let _ = fs::remove_dir_all(&test_dir);
    }
}
