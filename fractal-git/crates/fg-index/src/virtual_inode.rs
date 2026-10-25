//! Module: fg-index — Virtual Inode Table & Invariant Path Mapping
//! File Path: crates/fg-index/src/virtual_inode.rs
//! Architecture Role: Manages invariant FileUid mappings across file renames, directory moves,
//!   and asynchronous pre-declaration reservation lifecycles.
//! Dependencies & Triggers: Consumes FileUid, SliceAuthorization, and ReservedFileToken from fg-core;
//!   persisted to .taxis/index/virtual_inodes.json; integrated with staging transactions.
//! Responsibilities: Maintain two-way O(1) FileUid <-> Path indices, guarantee rename invariance,
//!   issue pre-declaration reservation tokens within permitted prefixes, and persist state atomically.
//! Exit Semantics & Design Rationale: Decouples permission checks from transient file paths,
//!   ensuring SubAgents cannot bypass file jail constraints via rename tactics.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot path queries

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileUid, Oid, ReservationStatus, ReservedFileToken, SliceAuthorization};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// In-memory and persisted virtual inode mapping table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirtualInodeTable {
    /// Mapping from invariant FileUid to current repository-relative path.
    pub uid_to_path: HashMap<FileUid, String>,
    /// Reverse mapping from repository-relative path to FileUid for fast query.
    pub path_to_uid: HashMap<String, FileUid>,
    /// Base commit OID from which this inode snapshot was derived.
    pub base_commit_oid: Oid,
    /// Active asynchronous file pre-declaration reservation tokens.
    pub active_reservations: HashMap<String, ReservedFileToken>,
}

impl VirtualInodeTable {
    /// Creates a new VirtualInodeTable anchored to a base commit.
    pub fn new(base_commit_oid: Oid) -> Self {
        Self {
            uid_to_path: HashMap::new(),
            path_to_uid: HashMap::new(),
            base_commit_oid,
            active_reservations: HashMap::new(),
        }
    }

    /// Normalizes path strings to canonical forward slashes without leading/trailing slashes.
    pub fn normalize_path(path: &str) -> String {
        let normalized = path.replace('\\', "/");
        normalized.trim_matches('/').to_string()
    }

    /// Registers an existing tracked file with a known or derived FileUid.
    pub fn insert(&mut self, uid: FileUid, rel_path: &str) -> FractalResult<()> {
        let clean_path = Self::normalize_path(rel_path);
        if let Some(existing_uid) = self.path_to_uid.get(&clean_path) {
            if *existing_uid != uid {
                return Err(FractalError::VirtualInodeConflict {
                    rel_path: clean_path,
                    existing_uid: existing_uid.to_hex(),
                    attempted_uid: uid.to_hex(),
                });
            }
        }

        self.uid_to_path.insert(uid, clean_path.clone());
        self.path_to_uid.insert(clean_path, uid);
        Ok(())
    }

    /// Looks up current relative path for a given FileUid.
    pub fn lookup_path_by_uid(&self, uid: &FileUid) -> Option<&str> {
        self.uid_to_path
            .get(uid)
            .map(|canonical_path| canonical_path.as_str())
    }

    /// Looks up invariant FileUid for a given repository-relative path.
    pub fn lookup_uid_by_path(&self, rel_path: &str) -> Option<FileUid> {
        let clean_path = Self::normalize_path(rel_path);
        self.path_to_uid.get(&clean_path).copied()
    }

    /// Executes a file rename or directory move while preserving the FileUid invariant.
    pub fn rename_path(&mut self, old_path: &str, new_path: &str) -> FractalResult<FileUid> {
        let clean_old = Self::normalize_path(old_path);
        let clean_new = Self::normalize_path(new_path);

        if clean_old == clean_new {
            return self.lookup_uid_by_path(&clean_old).ok_or_else(|| {
                FractalError::CorruptStore(format!("Path not tracked: {}", clean_old))
            });
        }

        let uid = self.path_to_uid.get(&clean_old).copied().ok_or_else(|| {
            FractalError::CorruptStore(format!(
                "Source path '{}' not tracked in inode table",
                clean_old
            ))
        })?;

        if let Some(target_uid) = self.path_to_uid.get(&clean_new) {
            if *target_uid != uid {
                return Err(FractalError::VirtualInodeConflict {
                    rel_path: clean_new,
                    existing_uid: target_uid.to_hex(),
                    attempted_uid: uid.to_hex(),
                });
            }
        }

        self.path_to_uid.remove(&clean_old);
        self.path_to_uid.insert(clean_new.clone(), uid);
        self.uid_to_path.insert(uid, clean_new);

        Ok(uid)
    }

    /// Pre-declares intent to create a new file asynchronously within a bounded slice.
    pub fn reserve_file_async(
        &mut self,
        rel_path: &str,
        slice_auth: &mut SliceAuthorization,
        current_time: u64,
        ttl_secs: u64,
        nonce: u64,
    ) -> FractalResult<ReservedFileToken> {
        let clean_path = Self::normalize_path(rel_path);

        // 1. Verify prefix whitelist scope
        if !slice_auth.is_path_permitted_for_new_file(&clean_path) {
            return Err(FractalError::UnauthorizedFileMutation {
                file_uid: "UNTRACKED".to_string(),
                rel_path: clean_path,
                reason: "Target path prefix outside permitted_new_file_prefixes".to_string(),
            });
        }

        // 2. Verify mutation budget limit
        slice_auth.check_mutation_budget_for_new_file()?;

        // 3. Ensure path is not already bound
        if let Some(existing_uid) = self.path_to_uid.get(&clean_path) {
            return Err(FractalError::VirtualInodeConflict {
                rel_path: clean_path,
                existing_uid: existing_uid.to_hex(),
                attempted_uid: "NEW_RESERVATION".to_string(),
            });
        }

        // 4. Derive invariant FileUid and generate token
        let file_uid = FileUid::derive(
            &slice_auth.project_id,
            &slice_auth.subagent_id,
            &clean_path,
            current_time,
            nonce,
        );

        let token_id = format!("resv-{}-{}", current_time, nonce);
        let token = ReservedFileToken {
            token_id: token_id.clone(),
            file_uid,
            rel_path: clean_path,
            created_at: current_time,
            expires_at: current_time.saturating_add(ttl_secs),
            nonce,
            status: ReservationStatus::Pending,
        };

        // 5. Consume budget and register reservation
        slice_auth.record_file_consumption()?;
        self.active_reservations.insert(token_id, token.clone());

        Ok(token)
    }

    /// Confirms a pending file reservation and commits it to the inode table.
    pub fn confirm_reservation(
        &mut self,
        token_id: &str,
        current_time: u64,
    ) -> FractalResult<FileUid> {
        let token = self.active_reservations.get_mut(token_id).ok_or_else(|| {
            FractalError::FileReservationExpired {
                token_id: token_id.to_string(),
                rel_path: "UNKNOWN".to_string(),
            }
        })?;

        if token.is_expired(current_time) {
            token.status = ReservationStatus::Expired;
            return Err(FractalError::FileReservationExpired {
                token_id: token_id.to_string(),
                rel_path: token.rel_path.clone(),
            });
        }

        let file_uid = token.file_uid;
        let rel_path = token.rel_path.clone();
        token.status = ReservationStatus::Confirmed;

        self.insert(file_uid, &rel_path)?;
        Ok(file_uid)
    }

    /// Verifies whether an attempted file mutation is authorized within a bounded slice.
    pub fn verify_file_mutation(
        &self,
        rel_path: &str,
        slice_auth: &SliceAuthorization,
    ) -> FractalResult<FileUid> {
        let clean_path = Self::normalize_path(rel_path);

        match self.lookup_uid_by_path(&clean_path) {
            Some(uid) => {
                if slice_auth.is_file_authorized(&uid) {
                    Ok(uid)
                } else {
                    Err(FractalError::UnauthorizedFileMutation {
                        file_uid: uid.to_hex(),
                        rel_path: clean_path,
                        reason: "FileUid not registered in slice authorization allowlist"
                            .to_string(),
                    })
                }
            }
            None => {
                // Check if there is an active confirmed reservation
                let mut found_confirmed = None;
                for token in self.active_reservations.values() {
                    if token.rel_path == clean_path && token.status == ReservationStatus::Confirmed
                    {
                        found_confirmed = Some(token.file_uid);
                        break;
                    }
                }

                if let Some(uid) = found_confirmed {
                    if slice_auth.is_file_authorized(&uid) {
                        return Ok(uid);
                    }
                }

                Err(FractalError::UnauthorizedFileMutation {
                    file_uid: "UNTRACKED".to_string(),
                    rel_path: clean_path,
                    reason: "File is not tracked in virtual inode table; must be pre-declared via reserve_file_async".to_string(),
                })
            }
        }
    }

    /// Atomically persists the virtual inode table to disk.
    pub fn save_to_path(&self, target_path: &Path) -> FractalResult<()> {
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let serialized_bytes = serde_json::to_vec_pretty(self)?;
        let staging_path = target_path.with_extension("tmp");
        fs::write(&staging_path, serialized_bytes)?;
        fs::rename(&staging_path, target_path)?;
        Ok(())
    }

    /// Loads a virtual inode table from disk.
    pub fn load_from_path(source_path: &Path) -> FractalResult<Self> {
        if !source_path.exists() {
            return Err(FractalError::CorruptStore(format!(
                "Inode table file not found: {}",
                source_path.display()
            )));
        }

        let file_bytes = fs::read(source_path)?;
        let table: Self = serde_json::from_slice(&file_bytes)?;
        Ok(table)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fg_core::models::MutationBudget;
    use std::collections::HashSet;

    #[test]
    fn test_rename_preserves_file_uid() {
        let mut table = VirtualInodeTable::new(Oid::ZERO);
        let uid = FileUid::derive("project", "agent", "src/foo.rs", 100, 1);

        table.insert(uid, "src/foo.rs").expect("insert succeeds");
        assert_eq!(table.lookup_uid_by_path("src/foo.rs"), Some(uid));
        assert_eq!(table.lookup_path_by_uid(&uid), Some("src/foo.rs"));

        // Rename src/foo.rs -> src/bar.rs
        let renamed_uid = table
            .rename_path("src/foo.rs", "src/bar.rs")
            .expect("rename succeeds");
        assert_eq!(renamed_uid, uid);

        // Old path is unmapped, new path has the exact same invariant FileUid
        assert_eq!(table.lookup_uid_by_path("src/foo.rs"), None);
        assert_eq!(table.lookup_uid_by_path("src/bar.rs"), Some(uid));
        assert_eq!(table.lookup_path_by_uid(&uid), Some("src/bar.rs"));
    }

    #[test]
    fn test_async_reservation_and_confirmation() {
        let mut table = VirtualInodeTable::new(Oid::ZERO);
        let mut slice = SliceAuthorization::new(
            "my-game",
            "agent-worker",
            HashSet::new(),
            vec!["src/features/".to_string()],
            MutationBudget::new(3, 300, 0),
        );

        // 1. Reserve new file
        let token = table
            .reserve_file_async("src/features/combat.rs", &mut slice, 1000, 3600, 99)
            .expect("reserve succeeds");
        assert_eq!(token.status, ReservationStatus::Pending);
        assert_eq!(slice.consumed_files, 1);

        // Authorize the derived uid in slice for subsequent mutations
        slice.authorize_file_uid(token.file_uid);

        // 2. Confirm reservation
        let confirmed_uid = table
            .confirm_reservation(&token.token_id, 1500)
            .expect("confirm succeeds");
        assert_eq!(confirmed_uid, token.file_uid);
        assert_eq!(
            table.lookup_uid_by_path("src/features/combat.rs"),
            Some(confirmed_uid)
        );

        // 3. Verify mutation is authorized
        let checked_uid = table
            .verify_file_mutation("src/features/combat.rs", &slice)
            .expect("mutation permitted");
        assert_eq!(checked_uid, confirmed_uid);
    }

    #[test]
    fn test_prefix_boundary_rejection() {
        let mut table = VirtualInodeTable::new(Oid::ZERO);
        let mut slice = SliceAuthorization::new(
            "my-game",
            "agent-worker",
            HashSet::new(),
            vec!["src/features/".to_string()],
            MutationBudget::default(),
        );

        // Disallowed prefix
        let reservation_error = table
            .reserve_file_async("src/illegal.rs", &mut slice, 1000, 3600, 1)
            .unwrap_err();
        match reservation_error {
            FractalError::UnauthorizedFileMutation { rel_path, .. } => {
                assert_eq!(rel_path, "src/illegal.rs");
            }
            _ => panic!("Expected UnauthorizedFileMutation"),
        }
    }
}
