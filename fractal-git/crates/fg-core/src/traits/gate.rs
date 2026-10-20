//! Module: fg-core — Quality Gate Verifier Trait
//! File Path: crates/fg-core/src/traits/gate.rs
//! Architecture Role: Abstract contract for pre-commit / pre-receive automated
//!   quality verification.

use crate::error::FractalResult;

/// Staged file entry submitted for gate evaluation.
#[derive(Debug, Clone)]
pub struct StagedCandidate {
    pub path: String,
    pub payload: Vec<u8>,
}

/// Verdict returned by a gate verifier.
#[derive(Debug, Clone, PartialEq)]
pub struct GateVerdict {
    pub passed: bool,
    pub score: f64,
    pub violations: Vec<String>,
}

/// Abstract interface for pre-review quality gates.
pub trait GateVerifier: Send + Sync {
    /// Evaluates candidate staged files against domain rules.
    fn verify_candidates(&self, candidates: &[StagedCandidate]) -> FractalResult<GateVerdict>;
}
