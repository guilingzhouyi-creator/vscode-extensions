//! Module: fg-core — High-Precision Performance Benchmark Metric Constants
//! File Path: crates/fg-core/src/constants/metrics.rs
//! Architecture Role: Single source of truth for all micro-benchmark metric keys,
//!   ensuring 100% strict matching between `src/bench.rs`, `tests/rust/test_benchmarks.rs`,
//!   and `baselines/taxis-perf.baseline.json`.

/// Canonical Tree Diff streaming with O(1) subtree short-circuiting.
pub const METRIC_TREE_DIFF_STREAMING: &str = "canonical_tree_diff_streaming";

/// Myers Diff with 64-bit SWAR line tokenization and linear space boundary.
pub const METRIC_MYERS_DIFF_SWAR: &str = "myers_diff_swar_tokens";

/// Generation-Number cutoff fast path in DAG ancestor evaluation.
pub const METRIC_DAG_GENERATION_CUTOFF: &str = "dag_generation_cutoff_o1";

/// Corrected Commit Date (CCD v2) O(1) cutoff invariant and max-heap pruning.
pub const METRIC_CORRECTED_COMMIT_DATE: &str = "corrected_commit_date_cutoff_o1";

/// PathBloomFilter Kirsch-Mitzenmacher 7-hash query throughput.
pub const METRIC_BLOOM_PATH_QUERY: &str = "bloom_filter_path_query";

/// Buffer pool thread-local freelist allocation and deallocation throughput.
pub const METRIC_BUFFER_POOL_FREELIST: &str = "buffer_pool_thread_local_freelist";

/// Byte-bounded LRU cache zero-disk evictions under budget pressure.
pub const METRIC_BYTE_LRU_CACHE: &str = "byte_lru_cache_budget_eviction";

/// Poset DAG scale traversal with 2,000 synthetic commits and diamond branches.
pub const METRIC_DAG_POSET_SCALE: &str = "dag_poset_scale_traversal_2000_nodes";

/// Path-Bloom negative history pruning across dense commit chains.
pub const METRIC_BLOOM_DENSE_HISTORY: &str = "bloom_filter_dense_history_500_commits";

/// Monorepo 10,000 files sparse tree diff across simulated agent touches.
pub const METRIC_MONOREPO_SPARSE_DIFF: &str = "monorepo_10k_sparse_tree_diff";

/// Concurrent agent worktree allocation, commit, and sweep transactions.
pub const METRIC_CONCURRENT_TRANSACTIONS: &str = "concurrent_agent_worktree_transactions";
