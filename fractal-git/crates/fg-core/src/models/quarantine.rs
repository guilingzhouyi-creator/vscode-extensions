//! Module: fg-core — Unified Elastic Quarantine Registry & Isolation Stash
//! File Path: crates/fg-core/src/models/quarantine.rs
//! Architecture Role: Single-source domain model and crash-safe persistence registry for isolated
//!   agent mutations across `fg-index` (MutationBudget / SliceAuthorization breaches) and
//!   `fg-gate` (`BLOCK_GAMING_DETECTED` Bayesian credit circuit breaker).
//! Dependencies & Triggers: Consumed by `fg-index::quarantine`, `fg-gate::credit`, and Taxis CLI
//!   quarantine inspection/restoration commands.
//! Responsibilities: Atomically persist unauthorized or gaming-flagged patches under
//!   `.taxis/quarantine/`, assign collision-free quarantine identifiers, and track lifecycle
//!   transitions (`Isolated` -> `Restored` / `Discarded`).
//! Exit Semantics & Design Rationale:
//!   - Single-source `QuarantineRegistry` definition shared across subsystems.
//!   - Uses [`crate::fs_atomic::write_file_atomic`] and a monotonic fallback nonce so two
//!     circuit-breaker triggers within the same Unix second never overwrite one another.
//!   - Automatically migrates prior `quarantine_index.json` to `quarantine_registry.json`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-QRN-001`: Pre-Review Zone quarantine isolation and Bayesian credit circuit-breaker guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::file_uid::FileUid;
use crate::error::{FractalError, FractalResult};
use crate::fs_atomic::write_file_atomic;

static QUARANTINE_NONCE_SEQ: AtomicU64 = AtomicU64::new(1);

/// Lifecycle status of an isolated modification in quarantine.
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
    /// Unique identifier for this quarantine entry (e.g. `"quar-1729000-1"`).
    pub quarantine_id: String,
    /// Project identifier where violation occurred.
    pub project_id: String,
    /// SubAgent identifier that attempted the unauthorized mutation.
    pub agent_id: String,
    /// Target repository-relative file path.
    pub rel_path: String,
    /// Invariant `FileUid` if known or tracked (`#[serde(default)]` preserves backward compat).
    #[serde(default, skip_serializing_if = "Option::is_none")]
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

/// Quarantine registry index stored in `.taxis/quarantine/quarantine_registry.json`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuarantineRegistry {
    /// Recorded quarantine entries.
    pub records: Vec<QuarantineRecord>,
}

/// Parameters for isolating an unauthorized or gaming-flagged mutation into quarantine.
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
    /// Explicit caller nonce; when `0`, a process-monotonic atomic sequence is assigned.
    pub nonce: u64,
}

impl QuarantineRegistry {
    /// Registry filename under the quarantine root.
    pub const REGISTRY_FILENAME: &'static str = "quarantine_registry.json";
    /// Prior index filename supported for automatic migration.
    pub const HISTORICAL_INDEX_FILENAME: &'static str = "quarantine_index.json";

    /// Loads the quarantine registry from a given directory, automatically migrating prior files.
    pub fn load_from_dir(quarantine_dir: &Path) -> FractalResult<Self> {
        let registry_file = quarantine_dir.join(Self::REGISTRY_FILENAME);
        let prior_file = quarantine_dir.join(Self::HISTORICAL_INDEX_FILENAME);
        let target_file = if registry_file.exists() {
            registry_file
        } else if prior_file.exists() {
            prior_file
        } else {
            return Ok(Self::default());
        };

        let index_bytes = fs::read(&target_file)?;
        let registry: Self = serde_json::from_slice(&index_bytes)?;
        Ok(registry)
    }

    /// Atomically persists the quarantine registry into `quarantine_dir` and purges prior file if present.
    pub fn save_to_dir(&self, quarantine_dir: &Path) -> FractalResult<()> {
        fs::create_dir_all(quarantine_dir)?;
        let registry_file = quarantine_dir.join(Self::REGISTRY_FILENAME);
        let serialized_bytes = serde_json::to_vec_pretty(self)?;
        write_file_atomic(&registry_file, &serialized_bytes, true)?;

        let prior_file = quarantine_dir.join(Self::HISTORICAL_INDEX_FILENAME);
        if prior_file.exists() {
            let _ = fs::remove_file(prior_file);
        }
        Ok(())
    }

    /// Isolates an unauthorized or circuit-broken mutation into the quarantine stash.
    pub fn isolate_mutation(req: IsolateMutationRequest<'_>) -> FractalResult<QuarantineRecord> {
        fs::create_dir_all(req.quarantine_dir)?;

        let effective_nonce = if req.nonce == 0 {
            QUARANTINE_NONCE_SEQ.fetch_add(1, Ordering::Relaxed)
        } else {
            req.nonce
        };
        let mut ledger = Self::load_from_dir(req.quarantine_dir)?;
        let candidate_id = format!("quar-{}-{effective_nonce}", req.current_time);
        let quarantine_id = if ledger
            .records
            .iter()
            .any(|existing| existing.quarantine_id == candidate_id)
        {
            let extra = QUARANTINE_NONCE_SEQ.fetch_add(1, Ordering::Relaxed);
            format!("{candidate_id}-{extra}")
        } else {
            candidate_id
        };

        let patch_filename = format!("{quarantine_id}.patch");
        let patch_path = req.quarantine_dir.join(&patch_filename);
        write_file_atomic(&patch_path, req.patch_or_content.as_bytes(), true)?;

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

        ledger.records.push(record.clone());
        ledger.save_to_dir(req.quarantine_dir)?;

        Ok(record)
    }

    /// Lists all quarantine records currently in [`QuarantineStatus::Isolated`] status.
    pub fn list_active_isolated(quarantine_dir: &Path) -> FractalResult<Vec<QuarantineRecord>> {
        let ledger = Self::load_from_dir(quarantine_dir)?;
        Ok(ledger
            .records
            .into_iter()
            .filter(|record| record.status == QuarantineStatus::Isolated)
            .collect())
    }

    /// Finds a quarantine record by identifier.
    pub fn find_by_id(
        quarantine_dir: &Path,
        quarantine_id: &str,
    ) -> FractalResult<Option<QuarantineRecord>> {
        let ledger = Self::load_from_dir(quarantine_dir)?;
        Ok(ledger
            .records
            .into_iter()
            .find(|record| record.quarantine_id == quarantine_id))
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
        Ok(fs::read_to_string(&patch_path)?)
    }

    /// Marks a quarantine record as restored.
    pub fn mark_restored(quarantine_dir: &Path, quarantine_id: &str) -> FractalResult<()> {
        Self::update_status(quarantine_dir, quarantine_id, QuarantineStatus::Restored)
    }

    /// Restores a quarantined modification back to the working tree with path safety validation.
    pub fn restore_to_workspace(
        quarantine_dir: &Path,
        quarantine_id: &str,
        work_root: &Path,
    ) -> FractalResult<QuarantineRecord> {
        let record = Self::find_by_id(quarantine_dir, quarantine_id)?.ok_or_else(|| {
            FractalError::CorruptStore(format!("Quarantine record not found: {quarantine_id}"))
        })?;
        let patch_content = Self::read_patch_content(quarantine_dir, &record)?;
        let target_path = validate_safe_rel_path(work_root, &record.rel_path)?;

        let original_text = if target_path.is_file() {
            fs::read_to_string(&target_path).unwrap_or_default()
        } else {
            String::new()
        };

        let restored_content = apply_patch_payload(&original_text, &patch_content);

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_file_atomic(&target_path, restored_content.as_bytes(), true)?;

        Self::mark_restored(quarantine_dir, quarantine_id)?;

        let mut updated = record;
        updated.status = QuarantineStatus::Restored;
        Ok(updated)
    }

    /// Marks a quarantine record as discarded.
    pub fn mark_discarded(quarantine_dir: &Path, quarantine_id: &str) -> FractalResult<()> {
        Self::update_status(quarantine_dir, quarantine_id, QuarantineStatus::Discarded)
    }

    fn update_status(
        quarantine_dir: &Path,
        quarantine_id: &str,
        next_status: QuarantineStatus,
    ) -> FractalResult<()> {
        let mut ledger = Self::load_from_dir(quarantine_dir)?;
        let record = ledger
            .records
            .iter_mut()
            .find(|record| record.quarantine_id == quarantine_id)
            .ok_or_else(|| {
                FractalError::CorruptStore(format!("Quarantine record not found: {quarantine_id}"))
            })?;
        record.status = next_status;
        ledger.save_to_dir(quarantine_dir)
    }
}

/// Resolves the default repository quarantine directory (`<git_dir>/quarantine`).
#[must_use]
pub fn default_quarantine_dir(git_dir: &Path) -> PathBuf {
    git_dir.join("quarantine")
}

/// Validates that a relative path does not escape the repository work root.
pub fn validate_safe_rel_path(work_root: &Path, rel_path: &str) -> FractalResult<PathBuf> {
    if rel_path.is_empty() {
        return Err(FractalError::PolicyViolation("Empty file path".into()));
    }
    let p = Path::new(rel_path);
    if p.is_absolute() {
        return Err(FractalError::PolicyViolation(format!(
            "Absolute path forbidden in quarantine: {rel_path}"
        )));
    }
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => {
                return Err(FractalError::PolicyViolation(format!(
                    "Path traversal '..' forbidden: {rel_path}"
                )));
            }
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            _ => {
                return Err(FractalError::PolicyViolation(format!(
                    "Invalid path component: {rel_path}"
                )));
            }
        }
    }
    Ok(work_root.join(p))
}

/// Applies a unified diff patch or full-content payload to original text.
pub fn apply_patch_payload(original_text: &str, patch_payload: &str) -> String {
    let is_unified = patch_payload.contains("@@ -")
        && (patch_payload.starts_with("--- ") || patch_payload.contains("\n--- "));
    if !is_unified {
        return patch_payload.to_string();
    }

    let orig_lines: Vec<&str> = original_text.split('\n').collect();
    let mut clean_orig: Vec<String> = orig_lines
        .iter()
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if clean_orig.last().map(|s| s.as_str()) == Some("") && clean_orig.len() > 1 {
        clean_orig.pop();
    }

    let patch_lines: Vec<&str> = patch_payload.split('\n').collect();
    let mut output: Vec<String> = Vec::new();
    let mut orig_idx = 0usize;
    let mut cursor = 0usize;

    while cursor < patch_lines.len() {
        let line = patch_lines[cursor]
            .strip_suffix('\r')
            .unwrap_or(patch_lines[cursor]);
        if let Some(hunk_header) = line.strip_prefix("@@ -") {
            let old_part = hunk_header.split('+').next().unwrap_or("").trim();
            let old_start_str = old_part.split(',').next().unwrap_or("1");
            let target_start = old_start_str
                .parse::<usize>()
                .unwrap_or(1)
                .saturating_sub(1);

            while orig_idx < target_start && orig_idx < clean_orig.len() {
                output.push(clean_orig[orig_idx].clone());
                orig_idx += 1;
            }

            cursor += 1;
            while cursor < patch_lines.len() {
                let h_line = patch_lines[cursor]
                    .strip_suffix('\r')
                    .unwrap_or(patch_lines[cursor]);
                if h_line.starts_with("@@ -") || h_line.starts_with("diff --git") {
                    break;
                }
                if let Some(rest) = h_line.strip_prefix('+') {
                    output.push(rest.to_string());
                } else if let Some(_rest) = h_line.strip_prefix('-') {
                    orig_idx += 1;
                } else if let Some(rest) = h_line.strip_prefix(' ') {
                    output.push(rest.to_string());
                    orig_idx += 1;
                }
                cursor += 1;
            }
        } else {
            cursor += 1;
        }
    }

    while orig_idx < clean_orig.len() {
        output.push(clean_orig[orig_idx].clone());
        orig_idx += 1;
    }

    let mut result = output.join("\n");
    if original_text.ends_with('\n') || patch_payload.ends_with('\n') {
        result.push('\n');
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_temp_dir(prefix: &str) -> PathBuf {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = fs::create_dir_all(&base);
        base.join(format!("{prefix}_{}", std::process::id()))
    }

    #[test]
    fn duplicate_same_second_isolations_never_collide() {
        let test_dir = test_temp_dir("fg_core_quarantine");
        let _ = fs::remove_dir_all(&test_dir);

        let first = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
            quarantine_dir: &test_dir,
            project_id: "proj",
            agent_id: "a1",
            rel_path: "src/a.rs",
            file_uid: None,
            patch_or_content: "patch-a",
            reason: "reason-a",
            current_time: 5000,
            nonce: 0,
        })
        .expect("first isolate");

        let second = QuarantineRegistry::isolate_mutation(IsolateMutationRequest {
            quarantine_dir: &test_dir,
            project_id: "proj",
            agent_id: "a2",
            rel_path: "src/b.rs",
            file_uid: None,
            patch_or_content: "patch-b",
            reason: "reason-b",
            current_time: 5000,
            nonce: 0,
        })
        .expect("second isolate");

        assert_ne!(first.quarantine_id, second.quarantine_id);
        let active = QuarantineRegistry::list_active_isolated(&test_dir).expect("list");
        assert_eq!(active.len(), 2);

        let _ = fs::remove_dir_all(&test_dir);
    }
}
