//! Unit Test: fractal-git Performance Benchmarks & TB-REGRESSION Ratchet
//! File Path: tests/rust/test_benchmarks.rs
//! Architecture Role: Automated regression tests ensuring core operators (TreeDiff, Myers Diff,
//!   DAG Cutoff, BufferPool, ByteLruCache) satisfy nanosecond/microsecond budgets.

use fractal_git::bench::{BenchmarkMetric, TaxisBenchmarkSuite};
use fractal_git::constants::metrics::*;

#[test]
fn test_benchmark_suite_execution_and_timings() {
    let suite = TaxisBenchmarkSuite::run_default(1);
    assert_eq!(suite.engine, "taxis");
    assert_eq!(suite.metrics.len(), 7);

    for m in &suite.metrics {
        assert!(
            m.iterations > 0,
            "Metric '{}' must have iterations > 0",
            m.name
        );
        assert!(
            m.ops_per_sec > 0.0,
            "Metric '{}' must have ops_per_sec > 0",
            m.name
        );
    }

    // 1. O(1) Subtree Short-circuiting TreeDiff budget:
    // avg latency must be sub-millisecond (< 500 us)
    let tree_metric = suite
        .metrics
        .iter()
        .find(|m| m.name == METRIC_TREE_DIFF_STREAMING)
        .unwrap();
    assert!(
        tree_metric.avg_latency_ns < 500_000,
        "Tree diff must execute in under 500us per op, got {}ns",
        tree_metric.avg_latency_ns
    );

    // 2. DAG generation cutoff: must execute under 50us per op
    let dag_metric = suite
        .metrics
        .iter()
        .find(|m| m.name == METRIC_DAG_GENERATION_CUTOFF)
        .unwrap();
    assert!(
        dag_metric.avg_latency_ns < 50_000,
        "DAG cutoff must execute in under 50us per op, got {}ns",
        dag_metric.avg_latency_ns
    );

    // 3. Buffer pool freelist: must be lightning fast (< 10us per acquire+release)
    let pool_metric = suite
        .metrics
        .iter()
        .find(|m| m.name == METRIC_BUFFER_POOL_FREELIST)
        .unwrap();
    assert!(
        pool_metric.avg_latency_ns < 10_000,
        "BufferPool freelist must execute in under 10us per op, got {}ns",
        pool_metric.avg_latency_ns
    );

    // 4. CCD v2 generation cutoff: must execute under 50us per op
    let ccd_metric = suite
        .metrics
        .iter()
        .find(|m| m.name == METRIC_CORRECTED_COMMIT_DATE)
        .unwrap();
    assert!(
        ccd_metric.avg_latency_ns < 50_000,
        "CCD cutoff must execute in under 50us per op, got {}ns",
        ccd_metric.avg_latency_ns
    );

    // 5. Bloom filter path query: must execute under 10us per op
    let bloom_metric = suite
        .metrics
        .iter()
        .find(|m| m.name == METRIC_BLOOM_PATH_QUERY)
        .unwrap();
    assert!(
        bloom_metric.avg_latency_ns < 10_000,
        "Bloom query must execute in under 10us per op, got {}ns",
        bloom_metric.avg_latency_ns
    );
}

#[test]
fn test_benchmark_baseline_comparison_and_tolerance() {
    let base_metric = BenchmarkMetric {
        name: METRIC_MYERS_DIFF_SWAR.to_string(),
        iterations: 100,
        total_duration_us: 1000,
        avg_latency_ns: 10_000,
        ops_per_sec: 100_000.0,
    };
    let baseline = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 1700000000000,
        metrics: vec![base_metric],
    };

    // Case 1: Identical metrics pass
    let current_same = baseline.clone();
    let verdict_same = current_same.compare_with_baseline(&baseline, 15.0);
    assert!(verdict_same.passed);
    assert!(verdict_same.regressions.is_empty());

    // Case 2: +10% slower passes within 15% tolerance
    let mut current_10pct = baseline.clone();
    current_10pct.metrics[0].avg_latency_ns = 11_000;
    let verdict_10pct = current_10pct.compare_with_baseline(&baseline, 15.0);
    assert!(
        verdict_10pct.passed,
        "10% variance must pass within 15% tolerance"
    );

    // Case 3: Significant slowdown fails with TB-REGRESSION
    let mut current_slow = baseline.clone();
    current_slow.metrics[0].avg_latency_ns = 20_000;
    let verdict_slow = current_slow.compare_with_baseline(&baseline, 15.0);
    assert!(!verdict_slow.passed, "Slowdown must fail baseline ratchet");
    assert_eq!(verdict_slow.regressions.len(), 1);
    assert!(verdict_slow.regressions[0].contains(METRIC_MYERS_DIFF_SWAR));
}

#[test]
fn test_benchmark_json_serialization_roundtrip() {
    let suite = TaxisBenchmarkSuite::run_default(1);
    let json_str = serde_json::to_string_pretty(&suite).expect("Serialize benchmark suite");
    assert!(json_str.contains("\"engine\": \"taxis\""));
    assert!(json_str.contains(METRIC_TREE_DIFF_STREAMING));

    let parsed: TaxisBenchmarkSuite =
        serde_json::from_str(&json_str).expect("Deserialize benchmark suite");
    assert_eq!(parsed.engine, suite.engine);
    assert_eq!(parsed.metrics.len(), suite.metrics.len());
}

#[test]
fn test_benchmark_suite_level2_and_level3() {
    use fractal_git::BenchmarkLevel;

    // Level 2 (Poset DAG scale & Dense Bloom pruning)
    let suite_l2 = TaxisBenchmarkSuite::run_suite(BenchmarkLevel::Level2Scale, 1);
    assert_eq!(suite_l2.metrics.len(), 2);
    assert!(suite_l2
        .metrics
        .iter()
        .any(|m| m.name == METRIC_DAG_POSET_SCALE));
    assert!(suite_l2
        .metrics
        .iter()
        .any(|m| m.name == METRIC_BLOOM_DENSE_HISTORY));

    // Level 3 (10K-file Monorepo tree diff & Concurrent Agent Transactions)
    let suite_l3 = TaxisBenchmarkSuite::run_suite(BenchmarkLevel::Level3Macro, 1);
    assert_eq!(suite_l3.metrics.len(), 2);
    assert!(suite_l3
        .metrics
        .iter()
        .any(|m| m.name == METRIC_MONOREPO_SPARSE_DIFF));
    assert!(suite_l3
        .metrics
        .iter()
        .any(|m| m.name == METRIC_CONCURRENT_TRANSACTIONS));

    // All levels combined: 7 (L1) + 2 (L2) + 2 (L3) = 11 metrics
    let suite_all = TaxisBenchmarkSuite::run_suite(BenchmarkLevel::All, 1);
    assert_eq!(suite_all.metrics.len(), 11);
    for m in &suite_all.metrics {
        assert!(m.iterations > 0);
        assert!(m.ops_per_sec > 0.0);
    }
}
