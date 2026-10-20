//! Module: fg-core — Global Domain Error Definitions
//! File Path: crates/fg-core/src/error.rs
//! Architecture Role: Central domain error enumeration across all decoupled fractal git crates.

use thiserror::Error;

pub type FractalResult<T> = Result<T, FractalError>;

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
}
