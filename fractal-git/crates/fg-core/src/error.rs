//! Module: fg-core — Global Domain Error Definitions
//! File Path: crates/fg-core/src/error.rs
//! Architecture Role: Central domain error enumeration across all decoupled fractal git crates.
//!
//! Variants are partitioned by failure domain so that a diagnostic prefix always names the
//! subsystem that actually rejected the operation. Reusing one variant for unrelated causes
//! makes machine triage impossible and misleads human readers, so index conflicts are reserved
//! for genuine concurrent index mutation and never for policy, lease, or state-machine verdicts.

use thiserror::Error;

/// Unified Result alias for fallible domain operations across Fractal Git kernel subsystems.
pub type FractalResult<T> = Result<T, FractalError>;

/// Strongly-typed domain error enumeration representing all recoverable failure modes.
#[derive(Debug, Error)]
pub enum FractalError {
    #[error("I/O failure: {0}")]
    Io(#[from] std::io::Error),

    #[error("Git object codec error: {0}")]
    ObjectCodec(String),

    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },

    #[error("In-memory index conflict: {0}")]
    IndexConflict(String),

    #[error("Topology breach: illegal merge from {source_ref} to {target_ref} ({reason})")]
    TopologyBreach {
        source_ref: String,
        target_ref: String,
        reason: String,
    },

    #[error("Gate rejection: score={score}, violations={violations:?}")]
    GateRejection { score: f64, violations: Vec<String> },

    #[error("Workspace reclamation failure for {workspace_id}: {reason}")]
    ReclamationFailure {
        workspace_id: String,
        reason: String,
    },

    #[error("Resource pool exhausted: {pool_name} (capacity: {capacity})")]
    PoolExhausted { pool_name: String, capacity: usize },

    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),

    /// A governance policy declined the request (quality score, ratchet delta, anti-gaming).
    #[error("Policy violation: {0}")]
    PolicyViolation(String),

    /// A lifecycle state machine rejected an illegal transition.
    #[error("Illegal state transition: {0}")]
    StateTransition(String),

    /// A human authority proof was absent, malformed, or cryptographically inconsistent.
    #[error("Authority proof invalid: {0}")]
    AuthProofInvalid(String),

    /// A staged lease window elapsed before the request could be consumed.
    #[error("Lease expired: {0}")]
    LeaseExpired(String),

    /// A project's master TTL lease or a subagent's fractal TTL expired, freezing commit privileges.
    #[error(
        "Commit authorization locked: TTL lease expired for project '{project_id}' ({reason})"
    )]
    CommitLockedTtlExpired { project_id: String, reason: String },

    /// On-disk durable state was unreadable or internally inconsistent.
    #[error("Corrupt durable state: {0}")]
    CorruptStore(String),

    /// A compare-and-swap reference update lost against a concurrent writer.
    #[error("Reference CAS conflict: {0}")]
    RefConflict(String),

    /// A file mode word is not one of the modes a Git tree or index entry may record.
    ///
    /// The offending word is carried so triage can distinguish a corrupt record from an
    /// unsupported-but-legal mode this build has not learned yet.
    #[error("Unsupported file mode: {mode:#o}")]
    UnknownFileMode { mode: u32 },

    /// A staging entry carried a merge stage byte outside the closed set `{0, 1, 2, 3}`.
    #[error("Unsupported index stage: {stage}")]
    UnknownIndexStage { stage: u8 },

    /// A mutation was attempted on a file whose invariant FileUid is not in the authorized slice.
    #[error("Unauthorized file mutation: FileUid '{file_uid}' for path '{rel_path}' is not permitted ({reason})")]
    UnauthorizedFileMutation {
        file_uid: String,
        rel_path: String,
        reason: String,
    },

    /// The mutation budget for the current worktree authorization slice has been exceeded.
    #[error("Mutation budget exceeded: budget '{budget_type}' reached limit (requested: {requested}, limit: {limit})")]
    MutationBudgetExceeded {
        budget_type: String,
        requested: usize,
        limit: usize,
    },

    /// An asynchronous pre-declaration reservation token has expired or is invalid.
    #[error("File reservation invalid or expired: token '{token_id}' for path '{rel_path}'")]
    FileReservationExpired { token_id: String, rel_path: String },

    /// A path collision occurred in the virtual inode table where another FileUid is already bound.
    #[error("Virtual inode conflict: path '{rel_path}' is already bound to UID '{existing_uid}', attempted '{attempted_uid}'")]
    VirtualInodeConflict {
        rel_path: String,
        existing_uid: String,
        attempted_uid: String,
    },

    /// In-place storage or workspace operation failed due to insufficient disk space headroom.
    #[error("Insufficient disk space: required {required_bytes} bytes, simulation trough is {trough_bytes} bytes, initial free space was {initial_free_bytes} bytes")]
    InsufficientDiskSpace {
        required_bytes: u64,
        trough_bytes: u64,
        initial_free_bytes: u64,
    },

    /// The host filesystem does not support a required capability (e.g. hole punching / sparse files).
    #[error("Unsupported filesystem capability: {0}")]
    UnsupportedFilesystemCapability(String),

    /// A cryptographic audit hash-chain or telemetry signature check failed.
    #[error("Audit log integrity violation: {0}")]
    AuditIntegrityViolation(String),

    /// An operation was denied due to namespace protection or permission constraints.
    #[error("Access denied: {0}")]
    AccessDenied(String),

    /// A commit exists but lies outside the horizon the caller declared for itself.
    ///
    /// Distinct from [`FractalError::CorruptStore`] on purpose: the bytes are absent because the
    /// node never claimed to hold them, not because they were lost. Reporting both as corruption
    /// would send an operator to repair a healthy store, and reporting both as "beyond the
    /// horizon" would let a genuine loss hide behind a window.
    #[error("Commit {oid} is beyond the declared horizon ({span}); the node holds only its recent history")]
    BeyondHorizon { oid: String, span: String },
}

impl FractalError {
    /// Formats the error for end-user terminal display.
    ///
    /// # Architecture Rationale & Commercial Surface Contract:
    /// - In commercial production mode (`diagnostic == false`), internal rule names (e.g. `FGT-MSG-001`,
    ///   `GUARD-MSG-001`, `FGT-GAT-001`) and internal telemetry scores (`score=...`) are completely
    ///   sanitized and omitted from user output. Clean, actionable, and human-friendly guidance is
    ///   emitted instead.
    /// - In diagnostic / debug mode (`diagnostic == true`), rule identifiers and triage metadata
    ///   are preserved to aid developer inspection.
    pub fn user_display(&self, diagnostic: bool) -> String {
        match self {
            Self::GateRejection { score, violations } => {
                if violations.is_empty() {
                    return if diagnostic {
                        format!("gate rejection (score={score:.2})")
                    } else {
                        "operation rejected by governance policy".to_string()
                    };
                }

                if diagnostic {
                    if violations.len() == 1 {
                        crate::sanitizer::format_violation_diagnostic(&violations[0])
                    } else {
                        let items = violations
                            .iter()
                            .map(|v| {
                                format!("  - {}", crate::sanitizer::format_violation_diagnostic(v))
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        format!("governance policy violations (score={score:.2}):\n{items}")
                    }
                } else {
                    let sanitized: Vec<String> = violations
                        .iter()
                        .map(|v| crate::sanitizer::sanitize_violation_for_user(v))
                        .collect();
                    if sanitized.len() == 1 {
                        sanitized[0].clone()
                    } else {
                        let items = sanitized
                            .iter()
                            .map(|v| format!("  - {v}"))
                            .collect::<Vec<_>>()
                            .join("\n");
                        format!("commit message does not meet repository conventions:\n{items}")
                    }
                }
            }
            Self::AuthProofInvalid(detail) => {
                if diagnostic {
                    format!("authority proof invalid: {detail}")
                } else {
                    format!(
                        "authority proof invalid: {}",
                        crate::sanitizer::sanitize_violation_for_user(detail)
                    )
                }
            }
            Self::PolicyViolation(detail) => {
                if diagnostic {
                    format!("policy violation: {detail}")
                } else {
                    format!(
                        "policy violation: {}",
                        crate::sanitizer::sanitize_violation_for_user(detail)
                    )
                }
            }
            other => {
                let text = other.to_string();
                if diagnostic {
                    text
                } else {
                    crate::sanitizer::sanitize_violation_for_user(&text)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_user_display_modes() {
        let err = FractalError::GateRejection {
            score: 0.0,
            violations: vec![
                "FGT-MSG-001: Header length too short".to_string(),
                "FGT-MSG-002: Missing required section '[Why]'".to_string(),
            ],
        };

        // Commercial mode: no rule codes, clean list
        let user_view = err.user_display(false);
        assert!(!user_view.contains("FGT-MSG"));
        assert!(!user_view.contains("score="));
        assert!(user_view.contains("Header length too short"));
        assert!(user_view.contains("Missing required section '[Why]'"));

        // Diagnostic mode: includes rule codes and score
        let diag_view = err.user_display(true);
        assert!(diag_view.contains("[FGT-MSG-001]"));
        assert!(diag_view.contains("[FGT-MSG-002]"));
        assert!(diag_view.contains("score="));
    }
}
