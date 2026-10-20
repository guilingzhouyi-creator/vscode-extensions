//! Module: fg-algorithms — Mathematical Modeling Facade
//! File Path: crates/fg-algorithms/src/math/mod.rs
//! Architecture Role: Facade for mathematical and statistical modeling algorithms.

pub mod posterior;

pub use posterior::{
    compute_jeffreys_credible_lower, evaluate_score_envelope, PosteriorScoreEstimate,
};
