//! Module: fg-core — Global Domain Error Definitions
//! File Path: crates/fg-core/src/error.rs
//! Architecture Role: Central domain error enumeration across all decoupled fractal git crates.
//!
//! Variants are partitioned by failure domain so that a diagnostic prefix always names the
//! subsystem that actually rejected the operation. Reusing one variant for unrelated causes
//! makes machine triage impossible and misleads human readers, so index conflicts are reserved
//! for genuine concurrent index mutation and never for policy, lease, or state-machine verdicts.

use thiserror::Error;

/// Unified Result alias for fallible domain operations across Fractal Git micro-crates.
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
}
