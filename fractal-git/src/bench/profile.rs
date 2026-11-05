//! Module: fractal-git — Benchmark Build Profile & Level Specifications
//! File Path: src/bench/profile.rs
//! Architecture Role: Defines execution profile identity and benchmark tier classifications.
//! Dependencies & Triggers: Consumed by bench suite, taxis bench CLI, and regression gates.
//! Responsibilities: Classify debug vs release builds and define execution depth levels.
//! Exit Semantics & Design Rationale: Distinct tolerances avoid false regression reports on unoptimised builds.
//! Domain Governance Rules: FGT-PRF-001 (performance ratchets).
use serde::{Deserialize, Serialize};

/// Granularity of the benchmark run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BenchmarkLevel {
    Level1Micro,
    Level2Scale,
    Level3Macro,
    Level4E2E,
    All,
    AllWithE2E,
}

/// Build profile a measurement was taken in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BenchmarkProfile {
    Release,
    Debug,
    #[default]
    Unspecified,
}

impl BenchmarkProfile {
    /// Profile of the binary currently executing.
    pub fn current() -> Self {
        if cfg!(debug_assertions) { Self::Debug } else { Self::Release }
    }

    /// Stable lowercase identifier used in file names and JSON.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Release => "release",
            Self::Debug => "debug",
            Self::Unspecified => "unspecified",
        }
    }

    /// Parses a profile identifier, returning None for anything unrecognised.
    pub fn parse_str(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "release" => Some(Self::Release),
            "debug" => Some(Self::Debug),
            _ => None,
        }
    }

    /// Regression allowance for a run in this profile, as a percentage.
    pub fn tolerance_pct(self) -> f64 {
        match self {
            Self::Debug => 45.0,
            _ => 15.0,
        }
    }
}
