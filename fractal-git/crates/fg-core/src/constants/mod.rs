//! Module: fg-core — Central Constants & SSOT Facade
//! File Path: crates/fg-core/src/constants/mod.rs
//! Architecture Role: Central domain constants aggregator and compile-time validation helpers
//!   across Git protocols, fractal namespaces, SSOT gate rules, benchmark metrics, and policies.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and immutable error contract guard
//! - `FGT-FAC-001`: Facade substantial burden (ELOC >= 15) and validation invariant guard
//! - `RCFG-RULE-DRIFT`: 100% adherence to single source of truth rule catalog

pub mod cli;
pub mod errors;
pub mod git;
pub mod metrics;
pub mod policy;
pub mod refs;
pub mod rules;

pub use cli::*;
pub use errors::*;
pub use git::*;
pub use metrics::*;
pub use policy::*;
pub use refs::*;
pub use rules::*;

/// Validates whether a given rule identifier is a registered Fractal Git rule.
///
/// Ensures compliance with `RCFG-RULE-DRIFT` by verifying against the 17 authoritative rules.
#[inline]
pub fn is_registered_fgt_rule(rule_id: &str) -> bool {
    ALL_FGT_RULES.contains(&rule_id)
}

/// Validates whether a given string is a recognized benchmark metric key.
///
/// Prevents metric key drift between synthetic benches, baselines, and CI ratchets.
pub fn is_valid_benchmark_metric(metric_name: &str) -> bool {
    matches!(
        metric_name,
        METRIC_TREE_DIFF_STREAMING
            | METRIC_MYERS_DIFF_SWAR
            | METRIC_DAG_GENERATION_CUTOFF
            | METRIC_CORRECTED_COMMIT_DATE
            | METRIC_BLOOM_PATH_QUERY
            | METRIC_BUFFER_POOL_FREELIST
            | METRIC_BYTE_LRU_CACHE
            | METRIC_DAG_POSET_SCALE
            | METRIC_BLOOM_DENSE_HISTORY
            | METRIC_MONOREPO_SPARSE_DIFF
            | METRIC_CONCURRENT_TRANSACTIONS
    )
}

/// Validates whether a reference path belongs to the fractal namespace or standard system trunk.
#[inline]
pub fn is_recognized_ref_prefix(ref_path: &str) -> bool {
    ref_path.starts_with(REF_FRACTAL_PREFIX)
        || ref_path.starts_with(REF_HEADS_PREFIX)
        || ref_path == REF_HEAD
}

/// Formats a standardized UAC proposal summary report string.
pub fn format_uac_proposal_summary(card_id: &str, task_desc: &str) -> String {
    format!(
        "Auto-Refactor Quality Gate: zero debt verification for task card [{}] - {}.",
        card_id, task_desc
    )
}
