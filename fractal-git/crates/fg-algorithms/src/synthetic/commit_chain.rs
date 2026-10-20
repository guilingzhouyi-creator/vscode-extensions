//! Module: fg-algorithms — Synthetic Commit Chain Generator
//! File Path: crates/fg-algorithms/src/synthetic/commit_chain.rs
//! Architecture Role: Pure in-memory generator for dense commit histories with PathBloomFilters.
//! Dependencies & Triggers: Consumed by history pruning benchmarks,
//!   path-scoped log walkers, and bloom evaluation.
//! Responsibilities: Construct sequential commit chains containing multi-path
//!   Bloom filters and representative query sets.
//! Exit Semantics & Design Rationale:
//!   - Deterministic generation simulating typical code repo modifications (code, docs, manifests).
//!   - Supplies standard hit and miss query paths for reproducible pruning benchmarks.

use fg_core::models::PathBloomFilter;

/// Standard query paths covering high-frequency hits and negative misses.
pub const STANDARD_QUERY_PATHS: [&str; 4] = [
    "src/module_3/file_1.rs",
    "nonexistent/untracked.rs",
    "docs/spec_7.md",
    "crates/unknown/mod.rs",
];

/// Result of generating a synthetic commit chain with path bloom filters.
#[derive(Debug, Clone)]
pub struct SyntheticCommitChain {
    /// List of PathBloomFilter for each commit in sequential order.
    pub filters: Vec<PathBloomFilter>,
    /// Number of commits in the chain.
    pub commit_count: usize,
    /// Standard benchmark query paths (mix of high-frequency hits and known misses).
    pub query_paths: &'static [&'static str],
}

/// Generates a synthetic commit chain of length `commit_count`
/// with deterministic path bloom filters.
pub fn generate_commit_chain(commit_count: usize) -> SyntheticCommitChain {
    let commit_count = commit_count.max(1);
    let mut filters = Vec::with_capacity(commit_count);

    for i in 0..commit_count {
        let mut filter = PathBloomFilter::empty();
        let path_code = format!("src/module_{}/file_{}.rs", i % 20, i % 5);
        let path_doc = format!("docs/spec_{}.md", i % 10);
        filter.insert(&path_code);
        filter.insert(&path_doc);
        filter.insert("Cargo.toml");
        filters.push(filter);
    }

    SyntheticCommitChain {
        filters,
        commit_count,
        query_paths: &STANDARD_QUERY_PATHS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_commit_chain_bloom_hit_miss() {
        let chain = generate_commit_chain(50);
        assert_eq!(chain.filters.len(), 50);

        // Every commit should match Cargo.toml
        for f in &chain.filters {
            assert!(f.may_contain("Cargo.toml"));
        }

        // Nonexistent path should be mostly filtered out
        let mut misses = 0;
        for f in &chain.filters {
            if !f.may_contain("nonexistent/untracked.rs") {
                misses += 1;
            }
        }
        assert!(
            misses > 45,
            "Bloom filter should filter out vast majority of negative paths"
        );
    }
}
