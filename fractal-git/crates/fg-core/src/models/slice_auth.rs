//! Module: fg-core — Bounded Slice Authorization & Mutation Budget
//! File Path: crates/fg-core/src/models/slice_auth.rs
//! Architecture Role: Domain models governing SubAgent slice authorization, immutable FileUid
//!   allowlists, async reservation tokens, and strict mutation budgets.
//! Dependencies & Triggers: Consumed by VirtualInodeTable, bounded worktree transaction managers,
//!   and commit authorization validation gates.
//! Responsibilities: Enforce fail-closed file mutations, track consumption against hard limits,
//!   and validate prefix scopes for asynchronous new file declarations.
//! Exit Semantics & Design Rationale: Guarantees that execution-tier SubAgents operate strictly
//!   within their allocated blast radius, preventing accidental drift or intentional evasion.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `SIM-ARGS-001`: Parameter and payload object convergence

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use super::file_uid::FileUid;
use crate::error::{FractalError, FractalResult};

/// Hard mutation envelope governing an agent's maximum permissible change volume.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationBudget {
    /// Maximum allowed number of modified or newly created files.
    pub max_files: usize,
    /// Maximum allowed net semantic ELOC increase.
    pub max_eloc_delta: usize,
    /// Maximum allowed single-function cyclomatic complexity increase.
    pub max_cc_increase: i32,
}

impl Default for MutationBudget {
    fn default() -> Self {
        Self {
            max_files: 5,
            max_eloc_delta: 300,
            max_cc_increase: 0,
        }
    }
}

impl MutationBudget {
    /// Creates a custom MutationBudget.
    pub const fn new(max_files: usize, max_eloc_delta: usize, max_cc_increase: i32) -> Self {
        Self {
            max_files,
            max_eloc_delta,
            max_cc_increase,
        }
    }
}

/// Lifecycle state for an asynchronously pre-declared file reservation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReservationStatus {
    /// Reservation token issued and awaiting formal staging.
    Pending,
    /// Reservation successfully staged and bound to virtual inode table.
    Confirmed,
    /// Reservation expired before staging took place.
    Expired,
    /// Explicitly revoked by supervisor or transaction rollback.
    Revoked,
}

/// Token proving pre-authorization for a newly created file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReservedFileToken {
    /// Unique reservation token identifier (e.g. "resv-1729000-001").
    pub token_id: String,
    /// Pre-allocated FileUid guaranteed to remain invariant upon commit.
    pub file_uid: FileUid,
    /// Target repository-relative path.
    pub rel_path: String,
    /// Unix timestamp when token was created.
    pub created_at: u64,
    /// Unix timestamp when token expires.
    pub expires_at: u64,
    /// Nonce for replay prevention.
    pub nonce: u64,
    /// Current lifecycle status.
    pub status: ReservationStatus,
}

impl ReservedFileToken {
    /// Returns true if the token is currently expired against the provided epoch timestamp.
    pub fn is_expired(&self, current_time: u64) -> bool {
        self.status == ReservationStatus::Expired || current_time > self.expires_at
    }
}

/// Bounded slice authorization contract for an agent worktree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SliceAuthorization {
    /// Project identifier owning the worktree.
    pub project_id: String,
    /// SubAgent identifier operating within this bounded slice.
    pub subagent_id: String,
    /// Set of authorized invariant FileUids permitted for mutation.
    pub authorized_file_uids: HashSet<FileUid>,
    /// Permitted path prefix glob/prefixes for declaring new files.
    pub permitted_new_file_prefixes: Vec<String>,
    /// Hard mutation budget envelope.
    pub budget: MutationBudget,
    /// Current count of consumed files (mutated + reserved).
    pub consumed_files: usize,
    /// Current net semantic ELOC consumed.
    pub consumed_eloc_delta: usize,
}

impl SliceAuthorization {
    /// Creates a new SliceAuthorization instance.
    pub fn new(
        project_id: impl Into<String>,
        subagent_id: impl Into<String>,
        authorized_file_uids: HashSet<FileUid>,
        permitted_new_file_prefixes: Vec<String>,
        budget: MutationBudget,
    ) -> Self {
        Self {
            project_id: project_id.into(),
            subagent_id: subagent_id.into(),
            authorized_file_uids,
            permitted_new_file_prefixes,
            budget,
            consumed_files: 0,
            consumed_eloc_delta: 0,
        }
    }

    /// Verifies if a given invariant FileUid is explicitly authorized.
    pub fn is_file_authorized(&self, uid: &FileUid) -> bool {
        self.authorized_file_uids.contains(uid)
    }

    /// Verifies whether a new file path is within the allowed prefix whitelist.
    pub fn is_path_permitted_for_new_file(&self, rel_path: &str) -> bool {
        if self.permitted_new_file_prefixes.is_empty() {
            return false;
        }

        let normalized_path = rel_path.replace('\\', "/");
        for prefix in &self.permitted_new_file_prefixes {
            if prefix == "*" {
                return true;
            }
            let normalized_prefix = prefix.replace('\\', "/");
            let clean_prefix = normalized_prefix.trim_end_matches('/');
            if normalized_path.starts_with(clean_prefix) {
                // Ensure boundary matches either exact prefix or a path segment delimiter
                if normalized_path.len() == clean_prefix.len()
                    || normalized_path.as_bytes().get(clean_prefix.len()) == Some(&b'/')
                {
                    return true;
                }
            }
        }
        false
    }

    /// Checks if adding one more file exceeds the configured budget limit.
    pub fn check_mutation_budget_for_new_file(&self) -> FractalResult<()> {
        let requested = self.consumed_files + 1;
        if requested > self.budget.max_files {
            return Err(FractalError::MutationBudgetExceeded {
                budget_type: "max_files".to_string(),
                requested,
                limit: self.budget.max_files,
            });
        }
        Ok(())
    }

    /// Records consumption of one file mutation against the budget.
    pub fn record_file_consumption(&mut self) -> FractalResult<()> {
        self.check_mutation_budget_for_new_file()?;
        self.consumed_files += 1;
        Ok(())
    }

    /// Adds an authorized FileUid into the active allowlist.
    pub fn authorize_file_uid(&mut self, uid: FileUid) {
        self.authorized_file_uids.insert(uid);
    }

    /// Revokes an authorized FileUid from the active allowlist.
    pub fn revoke_file_uid(&mut self, uid: &FileUid) -> bool {
        self.authorized_file_uids.remove(uid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slice_authorization_file_checks() {
        let uid1 = FileUid::derive("prj", "ag", "a.rs", 1, 1);
        let uid2 = FileUid::derive("prj", "ag", "b.rs", 2, 2);

        let mut authorized_set = HashSet::new();
        authorized_set.insert(uid1);

        let slice = SliceAuthorization::new(
            "prj",
            "ag",
            authorized_set,
            vec!["src/tests/".to_string(), "crates/".to_string()],
            MutationBudget::default(),
        );

        assert!(slice.is_file_authorized(&uid1));
        assert!(!slice.is_file_authorized(&uid2));

        assert!(slice.is_path_permitted_for_new_file("src/tests/mod.rs"));
        assert!(slice.is_path_permitted_for_new_file("crates/fg-core/src/lib.rs"));
        assert!(!slice.is_path_permitted_for_new_file("src/other.rs"));
        assert!(!slice.is_path_permitted_for_new_file("Cargo.toml"));
    }

    #[test]
    fn test_mutation_budget_exhaustion() {
        let mut slice = SliceAuthorization::new(
            "prj",
            "ag",
            HashSet::new(),
            vec!["*".to_string()],
            MutationBudget::new(2, 100, 0),
        );

        assert!(slice.record_file_consumption().is_ok());
        assert_eq!(slice.consumed_files, 1);

        assert!(slice.record_file_consumption().is_ok());
        assert_eq!(slice.consumed_files, 2);

        // Third file exceeds budget
        let budget_error = slice.record_file_consumption().unwrap_err();
        match budget_error {
            FractalError::MutationBudgetExceeded {
                budget_type,
                requested,
                limit,
            } => {
                assert_eq!(budget_type, "max_files");
                assert_eq!(requested, 3);
                assert_eq!(limit, 2);
            }
            _ => panic!("Expected MutationBudgetExceeded"),
        }
    }

    #[test]
    fn test_reserved_file_token_expiry() {
        let uid = FileUid::derive("prj", "ag", "new.rs", 10, 10);
        let token = ReservedFileToken {
            token_id: "resv-1".to_string(),
            file_uid: uid,
            rel_path: "new.rs".to_string(),
            created_at: 100,
            expires_at: 200,
            nonce: 42,
            status: ReservationStatus::Pending,
        };

        assert!(!token.is_expired(150));
        assert!(token.is_expired(201));
    }
}
