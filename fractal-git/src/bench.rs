//! Module: fractal-git — High-Precision Benchmark & Performance Ratchet Harness
//! File Path: src/bench.rs
//! Architecture Role: Evaluates microsecond-precision throughput, latency, and memory behavior
//!   across TreeDiff, Myers Diff, DAG Generation Cutoff, BufferPool, and ByteLruCache.
//! Dependencies & Triggers: `taxis bench`, `test_benchmarks.rs`, and performance regression gates.
//! Responsibilities: Execute synthetic performance benchmarks, serialize machine-readable metrics,
//!   and verify baseline monoticity within TB-REGRESSION tolerance bounds.
//! Exit Semantics & Design Rationale:
//!   - Pure deterministic in-memory execution; zero external network or sleep calls.

use serde::{Deserialize, Serialize};
use std::time::Instant;

use fg_algorithms::diff::{PatchGenerator, TreeDiff, TreeDiffState};
use fg_algorithms::synthetic::{
    generate_commit_chain, generate_diamond_dag, generate_monorepo_trees,
};
use fg_algorithms::traverse::DagWalker;
use fg_algorithms::{bit_parallel_diff, encode_fossil_git_delta, FastCdcChunker, RoaringBitmap};
use fg_core::constants::metrics::*;
use fg_core::models::{
    AutoQualityScoreEnvelope, CorrectedCommitDate, FileMode, Oid, PathBloomFilter, TaxisPolicy,
};
use fg_index::InMemoryIndexTree;
use fg_object::tree::{GitTree, GitTreeEntry};
use fg_pools::buffer_pool::{BufferSizeClass, PageBufferPool};
use fg_pools::lru_cache::ByteLruCache;
use fg_topology::PromotionStagingLedger;

pub mod e2e;
pub mod guard;
pub mod profile;

pub use e2e::{E2eBenchmarkOptions, E2eBenchmarkReport, E2eBenchmarkRunner, E2eWorkload};
pub use profile::{BenchmarkLevel, BenchmarkProfile};

/// Single benchmark metric record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BenchmarkMetric {
    pub name: String,
    pub iterations: usize,
    pub total_duration_us: u64,
    pub avg_latency_ns: u64,
    pub ops_per_sec: f64,
}

/// Comprehensive benchmark suite report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaxisBenchmarkSuite {
    pub engine: String,
    pub version: String,
    pub timestamp_ms: u64,
    /// Build profile the numbers were measured in; defaults to `unspecified` for older files.
    #[serde(default)]
    pub profile: BenchmarkProfile,
    pub metrics: Vec<BenchmarkMetric>,
}

/// Verdict of comparing benchmark run against frozen baseline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineComparisonVerdict {
    pub passed: bool,
    pub regressions: Vec<String>,
    pub improvements: Vec<String>,
    /// Metrics measured by this run that the baseline says nothing about.
    ///
    /// A missing entry used to be skipped, which meant a benchmark added after the baseline was
    /// frozen stayed unguarded forever while the gate reported a pass. Silence is the failure mode
    /// a ratchet must not have, so absence is now a violation.
    #[serde(default)]
    pub unbaselined: Vec<String>,
    /// Set when the baseline was recorded in a different build profile than this run.
    #[serde(default)]
    pub profile_mismatch: Option<String>,
}

impl TaxisBenchmarkSuite {
    /// Executes benchmark suite for the specified level.
    pub fn run_suite(level: BenchmarkLevel, multiplier: usize) -> Self {
        let mult = if multiplier == 0 { 1 } else { multiplier };
        let mut metrics = Vec::new();

        if matches!(
            level,
            BenchmarkLevel::Level1Micro | BenchmarkLevel::All | BenchmarkLevel::AllWithE2E
        ) {
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_canonical_tree_diff(100 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_myers_diff(100 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_dag_generation_cutoff(500 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_corrected_commit_date_cutoff(500 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_bloom_filter_path_query(1000 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_buffer_pool_freelists(1000 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_byte_lru_cache(500 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_bit_parallel_myers(1000 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_fossil_rolling_hash(100 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_fast_cdc_streaming(100 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_roaring_bitmap_ops(500 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_commit_message_guard(2000 * mult)
            }));
        }

        if matches!(
            level,
            BenchmarkLevel::Level2Scale | BenchmarkLevel::All | BenchmarkLevel::AllWithE2E
        ) {
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_dag_poset_scale_traversal(100 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_bloom_filter_dense_history_pruning(5 * mult)
            }));
        }

        if matches!(
            level,
            BenchmarkLevel::Level3Macro | BenchmarkLevel::All | BenchmarkLevel::AllWithE2E
        ) {
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_monorepo_10k_sparse_tree_diff(50 * mult)
            }));
            metrics.push(Self::fastest_of_samples(|| {
                Self::bench_concurrent_agent_worktree_transactions(100 * mult)
            }));
        }

        Self {
            engine: "taxis".to_string(),
            version: "0.1.0".to_string(),
            timestamp_ms: 1700000000000,
            profile: BenchmarkProfile::current(),
            metrics,
        }
    }

    /// Executes the single-threaded End-to-End clone & progressive projection benchmark.
    ///
    /// # Errors
    /// Returns `fg_core::error::FractalError` if benchmark trial fails.
    pub fn run_e2e_suite(
        options: &e2e::E2eBenchmarkOptions,
    ) -> fg_core::error::FractalResult<e2e::E2eBenchmarkReport> {
        e2e::E2eBenchmarkRunner::run_benchmark(options)
    }

    /// Number of independent timed runs folded into one reported metric.
    ///
    /// A single timed run occasionally absorbs a scheduler preemption or a cache eviction caused by
    /// an unrelated process, and when that run is also the one that froze the baseline the reference
    /// itself is inflated — which then hides that much real regression. Repeating the measurement and
    /// keeping the fastest sample removes the outlier without touching the tolerance, because
    /// widening the tolerance to cover noise would equally cover genuine slowdowns.
    const METRIC_SAMPLES: usize = 3;

    /// Measures `measure` several times and reports the fastest sample.
    ///
    /// Interference is one-directional: contention, migration and eviction only ever add time, so the
    /// minimum is the least-biased estimator of what the code actually costs. Both the frozen
    /// baseline and the verifying run are produced this way, which keeps the comparison like for
    /// like; a median would instead freeze whichever load happened to be present at freeze time.
    ///
    /// The whole record is returned rather than recombined, so iterations, duration and throughput
    /// stay mutually consistent instead of pairing one run's latency with another run's duration.
    fn fastest_of_samples<F>(mut measure: F) -> BenchmarkMetric
    where
        F: FnMut() -> BenchmarkMetric,
    {
        let mut best: Option<BenchmarkMetric> = None;
        for _ in 0..Self::METRIC_SAMPLES {
            let sample = measure();
            if best
                .as_ref()
                .is_none_or(|current| sample.avg_latency_ns < current.avg_latency_ns)
            {
                best = Some(sample);
            }
        }
        // `METRIC_SAMPLES` is a non-zero constant, so `best` is always populated; the fallback only
        // exists to keep the signature total without an unwrap that could never fire.
        best.unwrap_or_else(&mut measure)
    }

    /// Executes all seven micro-benchmarks with a given multiplier (1 = fast test, 10 = standard).
    pub fn run_default(multiplier: usize) -> Self {
        Self::run_suite(BenchmarkLevel::Level1Micro, multiplier)
    }

    /// Benchmarks hierarchical canonical tree diff with O(1) subtree short-circuiting.
    pub fn bench_canonical_tree_diff(iterations: usize) -> BenchmarkMetric {
        // Construct common subtree
        let common_entries: Vec<GitTreeEntry> = (0..50)
            .map(|i| {
                let mut hash = [0u8; 20];
                hash[0] = (i % 250) as u8;
                GitTreeEntry::new(
                    FileMode::RegularFile,
                    format!("file_{}.rs", i),
                    Oid::from_bytes(hash),
                )
            })
            .collect();
        let common_tree = GitTree::new(common_entries);
        let common_sub_oid = *common_tree.oid();

        // Modified subtree with 1 file changed
        let mut mod_entries: Vec<GitTreeEntry> = (0..50)
            .map(|i| {
                let mut hash = [0u8; 20];
                hash[0] = (i % 250) as u8;
                GitTreeEntry::new(
                    FileMode::RegularFile,
                    format!("file_{}.rs", i),
                    Oid::from_bytes(hash),
                )
            })
            .collect();
        mod_entries[0] = GitTreeEntry::new(
            FileMode::RegularFile,
            "file_0.rs",
            Oid::from_bytes([99u8; 20]),
        );
        let mod_tree = GitTree::new(mod_entries);
        let mod_sub_oid = *mod_tree.oid();

        // 10 subtrees in root: 9 identical, 1 modified
        let mut old_roots = Vec::new();
        let mut new_roots = Vec::new();
        for i in 0..9 {
            let name = format!("dir_{}", i);
            old_roots.push(GitTreeEntry::new(
                FileMode::Directory,
                &name,
                common_sub_oid,
            ));
            new_roots.push(GitTreeEntry::new(
                FileMode::Directory,
                &name,
                common_sub_oid,
            ));
        }
        old_roots.push(GitTreeEntry::new(
            FileMode::Directory,
            "dir_mod",
            common_sub_oid,
        ));
        new_roots.push(GitTreeEntry::new(
            FileMode::Directory,
            "dir_mod",
            mod_sub_oid,
        ));

        let old_root_tree = GitTree::new(old_roots);
        let new_root_tree = GitTree::new(new_roots);

        let mut state = TreeDiffState::new();
        let mut lookup = |_oid: &Oid| -> Option<GitTree> { Some(common_tree.clone()) };

        let start = Instant::now();
        for _ in 0..iterations {
            TreeDiff::compare_canonical_trees(
                Some(&old_root_tree),
                Some(&new_root_tree),
                &mut lookup,
                &mut state,
            );
            let _ = state.take_changes();
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_TREE_DIFF_STREAMING, iterations, elapsed)
    }

    /// Benchmarks Myers Diff with 64-bit SWAR line tokenization and linear space boundary.
    pub fn bench_myers_diff(iterations: usize) -> BenchmarkMetric {
        let text_a = concat!(
            "pub struct State {\n",
            "    pub id: u64,\n",
            "    pub active: bool,\n",
            "    pub counter: usize,\n",
            "    pub name: String,\n",
            "}\n\n",
            "impl State {\n",
            "    pub fn step(&mut self) {\n",
            "        self.counter += 1;\n",
            "        if self.counter > 100 {\n",
            "            self.active = false;\n",
            "        }\n",
            "    }\n",
            "}\n",
        );
        let text_b = concat!(
            "// Top License Header\n",
            "pub struct State {\n",
            "    pub id: u64,\n",
            "    pub active: bool,\n",
            "    pub counter: usize,\n",
            "    pub name: String,\n",
            "    pub description: Option<String>,\n",
            "}\n\n",
            "impl State {\n",
            "    pub fn step(&mut self) {\n",
            "        self.counter += 2;\n",
            "        if self.counter > 200 {\n",
            "            self.active = false;\n",
            "        }\n",
            "    }\n",
            "}\n",
        );

        let start = Instant::now();
        for _ in 0..iterations {
            let _patch = PatchGenerator::generate_patch("src/state.rs", text_a, text_b);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_MYERS_DIFF_SWAR, iterations, elapsed)
    }

    /// Benchmarks Generation-Number cutoff fast path in DAG ancestor evaluation.
    pub fn bench_dag_generation_cutoff(iterations: usize) -> BenchmarkMetric {
        let ancestor = Oid::from_bytes([1u8; 20]);
        let descendant = Oid::from_bytes([2u8; 20]);

        let start = Instant::now();
        for _ in 0..iterations {
            // Generation 500 >= 300: O(1) cutoff invariant
            let is_anc =
                DagWalker::is_ancestor_with_generation(&ancestor, &descendant, 500, 300, |_| None);
            assert!(!is_anc);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_DAG_GENERATION_CUTOFF, iterations, elapsed)
    }

    /// Benchmarks Corrected Commit Date (CCD v2) O(1) cutoff invariant and max-heap pruning.
    pub fn bench_corrected_commit_date_cutoff(iterations: usize) -> BenchmarkMetric {
        let ancestor = Oid::from_bytes([1u8; 20]);
        let descendant = Oid::from_bytes([2u8; 20]);
        let anc_ccd = CorrectedCommitDate(500);
        let desc_ccd = CorrectedCommitDate(300);

        let start = Instant::now();
        for _ in 0..iterations {
            let is_anc =
                DagWalker::is_ancestor_with_ccd(&ancestor, &descendant, anc_ccd, desc_ccd, |_| {
                    None
                });
            assert!(!is_anc);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_CORRECTED_COMMIT_DATE, iterations, elapsed)
    }

    /// Benchmarks PathBloomFilter Kirsch-Mitzenmacher 7-hash query throughput.
    pub fn bench_bloom_filter_path_query(iterations: usize) -> BenchmarkMetric {
        let mut bloom = PathBloomFilter::empty();
        bloom.insert("src/lib.rs");
        bloom.insert("Cargo.toml");
        bloom.insert("crates/fg-core/src/models/generation.rs");

        let test_paths = [
            "src/lib.rs",
            "Cargo.toml",
            "nonexistent/file.rs",
            "crates/fg-core/src/models/generation.rs",
            "other/path.txt",
        ];

        let start = Instant::now();
        let mut confirmed = 0usize;
        for i in 0..iterations {
            let path = test_paths[i % test_paths.len()];
            // The result must reach an observable sink. Discarding it lets the optimiser delete the
            // whole call, which is how this metric previously recorded 0 ns for 5,000 iterations:
            // a frozen baseline of zero can never be exceeded, so the ratchet was decorative.
            if std::hint::black_box(bloom.may_contain(path)) {
                confirmed += 1;
            }
        }
        let elapsed = start.elapsed();
        std::hint::black_box(confirmed);

        Self::calculate_metric(METRIC_BLOOM_PATH_QUERY, iterations, elapsed)
    }

    /// Benchmarks PageBufferPool thread-local freelist allocation and deallocation throughput.
    pub fn bench_buffer_pool_freelists(iterations: usize) -> BenchmarkMetric {
        let pool = PageBufferPool::default();

        let start = Instant::now();
        for _ in 0..iterations {
            let s_buf = pool.acquire_sized(BufferSizeClass::Small);
            pool.release_sized(s_buf, BufferSizeClass::Small);

            let p_buf = pool.acquire_sized(BufferSizeClass::Page);
            pool.release_sized(p_buf, BufferSizeClass::Page);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_BUFFER_POOL_FREELIST, iterations * 2, elapsed)
    }

    /// Benchmarks ByteLruCache dynamic byte quota tracking and LRU eviction.
    pub fn bench_byte_lru_cache(iterations: usize) -> BenchmarkMetric {
        let cache = ByteLruCache::new(32 * 1024); // 32 KB budget
        let test_payload = vec![42u8; 512]; // 512 bytes per entry (max 64 entries)

        let start = Instant::now();
        for i in 0..iterations {
            let key = (i % 128).to_string();
            cache.insert(key.clone(), test_payload.clone(), test_payload.len());
            let _ = cache.get(&key);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_BYTE_LRU_CACHE, iterations * 2, elapsed)
    }

    /// Benchmarks 64-line bit-parallel Myers diff.
    pub fn bench_bit_parallel_myers(iterations: usize) -> BenchmarkMetric {
        let hashes_a: Vec<u32> = (0..64).map(|i| i * 7 + 3).collect();
        let mut hashes_b = hashes_a.clone();
        hashes_b[10] = 999;
        hashes_b[25] = 888;
        hashes_b[40] = 777;

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = bit_parallel_diff(&hashes_a, &hashes_b);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_BIT_PARALLEL_MYERS, iterations, elapsed)
    }

    /// Benchmarks Fossil 16-byte rolling hash sliding window delta matching.
    pub fn bench_fossil_rolling_hash(iterations: usize) -> BenchmarkMetric {
        let base: Vec<u8> = (0..2048).map(|i| (i % 251) as u8).collect();
        let mut target = base.clone();
        for i in (100..200).step_by(2) {
            target[i] = 42;
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = encode_fossil_git_delta(&base, &target);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_FOSSIL_ROLLING_HASH, iterations, elapsed)
    }

    /// Benchmarks FastCDC Gear-table content-defined chunking throughput.
    pub fn bench_fast_cdc_streaming(iterations: usize) -> BenchmarkMetric {
        let payload: Vec<u8> = (0..16384).map(|i| (i * 31 % 256) as u8).collect();
        let chunker = FastCdcChunker::default();

        let start = Instant::now();
        for _ in 0..iterations {
            let mut count = 0;
            for _ in chunker.iter(&payload) {
                count += 1;
            }
            assert!(count > 0);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_FAST_CDC_STREAMING, iterations, elapsed)
    }

    /// Benchmarks Roaring Bitmap intersection and union throughput.
    pub fn bench_roaring_bitmap_ops(iterations: usize) -> BenchmarkMetric {
        let mut map_a = RoaringBitmap::new();
        let mut map_b = RoaringBitmap::new();
        for i in (0..5000).step_by(2) {
            map_a.insert(i);
        }
        for i in (1000..6000).step_by(3) {
            map_b.insert(i);
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let inter = &map_a & &map_b;
            let union = &map_a | &map_b;
            assert!(!inter.is_empty() && !union.is_empty());
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_ROARING_BITMAP_OPS, iterations, elapsed)
    }

    /// Benchmarks the commit-message governance guard on a fully populated workspace message.
    pub fn bench_commit_message_guard(iterations: usize) -> BenchmarkMetric {
        guard::bench_commit_message_guard(iterations)
    }

    /// Benchmarks Poset DAG Reachability and Cutoff across a 2,000-node commit DAG (Level 2 Scale).
    pub fn bench_dag_poset_scale_traversal(iterations: usize) -> BenchmarkMetric {
        let dag = generate_diamond_dag(500);

        let anc_ccd = dag
            .ccd_map
            .get(&dag.midway_ancestor_oid)
            .copied()
            .unwrap_or(CorrectedCommitDate(0));
        let desc_ccd = dag
            .ccd_map
            .get(&dag.leaf_oid)
            .copied()
            .unwrap_or(CorrectedCommitDate(u64::MAX));
        let non_anc_ccd = CorrectedCommitDate(u64::MAX);

        let start = Instant::now();
        let get_node = |oid: &Oid| -> Option<(CorrectedCommitDate, Vec<Oid>)> {
            let ccd = dag.ccd_map.get(oid).copied()?;
            let parent_oids = dag.parents_map.get(oid).cloned().unwrap_or_default();
            Some((ccd, parent_oids))
        };

        for i in 0..iterations {
            if i % 2 == 0 {
                let is_anc = DagWalker::is_ancestor_with_ccd(
                    &dag.disconnected_oid,
                    &dag.leaf_oid,
                    non_anc_ccd,
                    desc_ccd,
                    get_node,
                );
                assert!(!is_anc);
            } else {
                let is_anc = DagWalker::is_ancestor_with_ccd(
                    &dag.midway_ancestor_oid,
                    &dag.leaf_oid,
                    anc_ccd,
                    desc_ccd,
                    get_node,
                );
                assert!(is_anc);
            }
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_DAG_POSET_SCALE, iterations, elapsed)
    }

    /// Benchmarks Dense History Bloom Filter Path Pruning over a 500-commit chain (Level 2 Scale).
    pub fn bench_bloom_filter_dense_history_pruning(iterations: usize) -> BenchmarkMetric {
        let chain = generate_commit_chain(500);

        let start = Instant::now();
        let mut hits = 0usize;
        for i in 0..iterations {
            let path = chain.query_paths[i % chain.query_paths.len()];
            for filter in &chain.filters {
                // Observed sink, for the same reason as the single-filter query: an unused result
                // measures the loop overhead and reports a latency of zero.
                if std::hint::black_box(filter.may_contain(path)) {
                    hits += 1;
                }
            }
        }
        let elapsed = start.elapsed();
        std::hint::black_box(hits);

        Self::calculate_metric(
            METRIC_BLOOM_DENSE_HISTORY,
            iterations * chain.commit_count,
            elapsed,
        )
    }

    /// Benchmarks Enterprise Monorepo (10,000 files) streaming tree diff
    /// with O(1) subtree pruning (Level 3 Macro).
    pub fn bench_monorepo_10k_sparse_tree_diff(iterations: usize) -> BenchmarkMetric {
        let monorepo = generate_monorepo_trees(50, 200, 42, 3);

        let mut diff_state = TreeDiffState::new();
        let mut lookup = |oid: &Oid| -> Option<GitTree> { monorepo.lookup_tree(oid) };

        let start = Instant::now();
        for _ in 0..iterations {
            TreeDiff::compare_canonical_trees(
                Some(&monorepo.base_root),
                Some(&monorepo.mod_root),
                &mut lookup,
                &mut diff_state,
            );
            let changes = diff_state.take_changes();
            assert_eq!(changes.len(), 3);
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_MONOREPO_SPARSE_DIFF, iterations, elapsed)
    }

    /// Benchmarks Concurrent Multi-Agent Worktree Transactions & Staging Ledger Throughput
    /// (Level 3 Macro).
    pub fn bench_concurrent_agent_worktree_transactions(iterations: usize) -> BenchmarkMetric {
        let mut ledger = PromotionStagingLedger::in_memory();
        let policy = TaxisPolicy::rust_strict();
        let agent_count = 8;

        let start = Instant::now();
        for i in 0..iterations {
            let agent_id = format!("agent_{}", i % agent_count);
            let mut index = InMemoryIndexTree::new();
            for file_idx in 0..5 {
                let mut hash_bytes = [0u8; 20];
                hash_bytes[0] = (i % 255) as u8;
                hash_bytes[1] = file_idx as u8;
                let _ = index.stage_oid(
                    &format!("src/task_{}/file_{}.rs", i, file_idx),
                    FileMode::RegularFile,
                    Oid::from_bytes(hash_bytes),
                );
            }

            let candidate_oid = Oid::from_bytes([(i % 250) as u8; 20]);
            let auto_score = AutoQualityScoreEnvelope {
                composite_score: 98.0 + (i % 5) as f64 * 0.4,
                cai_index: 92.0,
                cyclomatic_complexity_delta: 0,
                eloc_delta: 12,
                credible_interval_lower: 95.0,
                anti_gaming_passed: true,
                summary_report: "Synthetic benchmark transaction".into(),
            };

            let _ = ledger.stage_promotion(
                candidate_oid,
                auto_score,
                format!("Agent checkpoint #{}", i),
                agent_id,
                &policy,
                1700000000000 + i as i64 * 1000,
            );
        }
        let elapsed = start.elapsed();

        Self::calculate_metric(METRIC_CONCURRENT_TRANSACTIONS, iterations, elapsed)
    }

    /// Compares this benchmark suite against a baseline, returning violations
    /// if regression > tolerance_pct.
    ///
    /// Three ways to fail, and all three are reported rather than short-circuited so one run tells
    /// the whole story:
    /// 1. a metric is slower than the baseline beyond tolerance *and* beyond the 3 µs noise floor;
    /// 2. a metric has no baseline entry at all, so the ratchet cannot speak about it;
    /// 3. the baseline came from a different build profile, which makes every ratio meaningless.
    pub fn compare_with_baseline(
        &self,
        baseline: &TaxisBenchmarkSuite,
        tolerance_pct: f64,
    ) -> BaselineComparisonVerdict {
        let mut passed = true;
        let mut regressions = Vec::new();
        let mut improvements = Vec::new();
        let mut unbaselined = Vec::new();
        let profile_mismatch = Self::describe_profile_mismatch(self.profile, baseline.profile);
        if profile_mismatch.is_some() {
            passed = false;
        }

        for current in &self.metrics {
            let Some(base) = baseline
                .metrics
                .iter()
                .find(|metric| metric.name == current.name)
            else {
                passed = false;
                unbaselined.push(current.name.clone());
                continue;
            };

            let max_allowed_ns =
                (base.avg_latency_ns as f64 * (1.0 + tolerance_pct / 100.0)) as u64;
            // Only flag if exceeds relative tolerance AND absolute difference >= 3000 ns (3 us)
            // to avoid OS scheduling noise in debug profile
            if current.avg_latency_ns > max_allowed_ns
                && current.avg_latency_ns.saturating_sub(base.avg_latency_ns) >= 3000
            {
                passed = false;
                regressions.push(format!(
                    "{}: current {} ns > baseline {} ns (max allowed: {} ns, +{:.1}%)",
                    current.name,
                    current.avg_latency_ns,
                    base.avg_latency_ns,
                    max_allowed_ns,
                    tolerance_pct
                ));
            } else if (current.avg_latency_ns as f64) < (base.avg_latency_ns as f64 * 0.8) {
                improvements.push(format!(
                    "{}: current {} ns improved vs baseline {} ns (-{:.1}%)",
                    current.name,
                    current.avg_latency_ns,
                    base.avg_latency_ns,
                    (1.0 - current.avg_latency_ns as f64 / base.avg_latency_ns as f64) * 100.0
                ));
            }
        }

        BaselineComparisonVerdict {
            passed,
            regressions,
            improvements,
            unbaselined,
            profile_mismatch,
        }
    }

    /// Explains why two profiles cannot be compared, or `None` when they can.
    ///
    /// An `unspecified` baseline is not treated as a mismatch: it is the format written before the
    /// profile was recorded, and rejecting it would invalidate every existing frozen file without
    /// proving anything. The two concrete profiles, however, are never interchangeable.
    fn describe_profile_mismatch(
        measured: BenchmarkProfile,
        recorded: BenchmarkProfile,
    ) -> Option<String> {
        if recorded == BenchmarkProfile::Unspecified || measured == recorded {
            return None;
        }
        Some(format!(
            "baseline recorded in '{}' profile but this run is '{}'; re-freeze with \
             `taxis bench --save-baseline` in the same profile before comparing",
            recorded.as_str(),
            measured.as_str()
        ))
    }

    fn calculate_metric(
        name: &str,
        iterations: usize,
        elapsed: std::time::Duration,
    ) -> BenchmarkMetric {
        let total_us = elapsed.as_micros() as u64;
        let total_ns = elapsed.as_nanos() as u64;
        let avg_ns = if iterations > 0 {
            total_ns / iterations as u64
        } else {
            0
        };
        let secs = elapsed.as_secs_f64();
        let ops_per_sec = if secs > 0.0 {
            iterations as f64 / secs
        } else {
            0.0
        };

        BenchmarkMetric {
            name: name.to_string(),
            iterations,
            total_duration_us: total_us,
            avg_latency_ns: avg_ns,
            ops_per_sec,
        }
    }
}
