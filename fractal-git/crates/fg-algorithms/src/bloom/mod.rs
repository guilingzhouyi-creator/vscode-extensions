//! Module: fg-algorithms::bloom — Kirsch-Mitzenmacher Bloom Filter Algorithms
//! File Path: crates/fg-algorithms/src/bloom/mod.rs
//! Architecture Role: Provides algorithmic operations for 256-bit Kirsch-Mitzenmacher double-hashing
//!   path bloom filters, enabling O(1) history traversal pruning and batch verification.
//! Dependencies & Triggers: Consumed by DAG walk path filtering and commit graph synthesis.
//! Responsibilities: Batch bloom filter population, multi-path query evaluation, and theoretical
//!   false positive rate estimation under standard Poisson approximation.
//! Exit Semantics & Design Rationale:
//!   - Constant time O(1) queries using pure CPU register bit operations.
//!   - Zero transient heap allocation for all batch query evaluations.
//!
//! Domain Governance Rules: FGT-ALG-001 (Kirsch-Mitzenmacher hashing), FGT-PRF-001 (zero transient alloc).

pub use fg_core::models::PathBloomFilter;

/// Constructs a new PathBloomFilter by batch-inserting an iterable slice of path strings.
///
/// # Arguments
/// * `paths` - Slice of path representations to insert into the filter.
///
/// # Examples
/// ```rust
/// use fg_algorithms::bloom::build_path_filter;
/// let filter = build_path_filter(&["src/main.rs", "Cargo.toml"]);
/// assert!(filter.may_contain("src/main.rs"));
/// assert!(!filter.may_contain("non_existent.txt"));
/// ```
pub fn build_path_filter<P: AsRef<str>>(paths: &[P]) -> PathBloomFilter {
    let mut filter = PathBloomFilter::empty();
    for path in paths {
        filter.insert(path.as_ref());
    }
    filter
}

/// Evaluates whether *all* candidate paths may potentially be present in the filter.
///
/// Returns `false` immediately upon encountering the first definitive non-member path,
/// guaranteeing true negatives without scanning the remainder of the slice.
pub fn contains_all_paths<P: AsRef<str>>(filter: &PathBloomFilter, paths: &[P]) -> bool {
    for path in paths {
        if !filter.may_contain(path.as_ref()) {
            return false;
        }
    }
    true
}

/// Evaluates whether *at least one* candidate path may potentially be present in the filter.
///
/// Returns `true` immediately upon encountering the first potential member, short-circuiting
/// traversal without allocating or evaluating additional paths.
pub fn contains_any_path<P: AsRef<str>>(filter: &PathBloomFilter, paths: &[P]) -> bool {
    for path in paths {
        if filter.may_contain(path.as_ref()) {
            return true;
        }
    }
    false
}

/// Calculates the theoretical false-positive probability p for a filter containing `n` elements.
///
/// Formula: p ≈ (1 - exp(-k * n / m))^k where m = 256 bits, k = 7 hashes.
pub fn estimate_false_positive_rate(element_count: usize) -> f64 {
    const M_BITS: f64 = 256.0;
    const K_HASHES: f64 = 7.0;
    let n = element_count as f64;
    let exponent = -K_HASHES * n / M_BITS;
    let base = 1.0 - exponent.exp();
    base.powf(K_HASHES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_path_filter_operations() {
        let paths = vec!["crates/fg-core/src/lib.rs", "Cargo.lock", "README.md"];
        let filter = build_path_filter(&paths);

        assert!(contains_all_paths(&filter, &paths));
        assert!(contains_any_path(&filter, &["README.md", "unknown.txt"]));
        assert!(!contains_all_paths(&filter, &["README.md", "unknown.txt"]));
        assert!(!contains_any_path(
            &filter,
            &["unknown1.txt", "unknown2.txt"]
        ));

        let fpr = estimate_false_positive_rate(3);
        assert!(
            fpr < 0.05,
            "False positive rate for 3 elements must be < 5%"
        );
    }
}
