//! Module: fractal-git — Benchmark Profile and Baseline Ratchet Tests
//! File Path: tests/rust/test_benchmark_profile.rs
//! Architecture Role: Regression tests validating profile matching, tolerance spreads,
//!   and baseline metric coverage.
//! Dependencies & Triggers: Consumed by `cargo test --test test_benchmark_profile`.
//! Responsibilities: Assert that release and debug profiles maintain expected tolerances,
//!   reject cross-profile comparisons, and detect unbaselined metrics.
//! Exit Semantics & Design Rationale: Exits with standard test harness assertions.

use fractal_git::bench::{BenchmarkMetric, BenchmarkProfile, TaxisBenchmarkSuite};
use fractal_git::constants::metrics::*;
use fractal_git::BenchmarkLevel;

#[test]
fn test_release_tolerance_stays_strict_and_debug_is_wider() {
    assert_eq!(
        BenchmarkProfile::Release.tolerance_pct(),
        15.0,
        "release tolerance is the contract the TB-REGRESSION budget advertises"
    );
    assert!(
        BenchmarkProfile::Debug.tolerance_pct() > BenchmarkProfile::Release.tolerance_pct(),
        "debug spread is wider than release, so its allowance must be too"
    );
}

#[test]
fn test_metric_missing_from_baseline_is_a_violation() {
    let measured = BenchmarkMetric {
        name: METRIC_COMMIT_GUARD.to_string(),
        iterations: 10,
        total_duration_us: 100,
        avg_latency_ns: 10_000,
        ops_per_sec: 100_000.0,
    };
    let current = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 1,
        profile: BenchmarkProfile::Release,
        metrics: vec![measured],
    };
    let baseline = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 1,
        profile: BenchmarkProfile::Release,
        metrics: vec![BenchmarkMetric {
            name: METRIC_MYERS_DIFF_SWAR.to_string(),
            iterations: 10,
            total_duration_us: 100,
            avg_latency_ns: 10_000,
            ops_per_sec: 100_000.0,
        }],
    };

    let verdict = current.compare_with_baseline(&baseline, 15.0);
    assert!(
        !verdict.passed,
        "a metric the baseline never measured must fail the ratchet"
    );
    assert_eq!(verdict.unbaselined, vec![METRIC_COMMIT_GUARD.to_string()]);
}

#[test]
fn test_cross_profile_comparison_is_refused() {
    let metric = BenchmarkMetric {
        name: METRIC_MYERS_DIFF_SWAR.to_string(),
        iterations: 10,
        total_duration_us: 100,
        avg_latency_ns: 10_000,
        ops_per_sec: 100_000.0,
    };
    let baseline = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 1,
        profile: BenchmarkProfile::Release,
        metrics: vec![metric.clone()],
    };
    let debug_run = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 2,
        profile: BenchmarkProfile::Debug,
        metrics: vec![metric],
    };

    let verdict = debug_run.compare_with_baseline(&baseline, 15.0);
    assert!(
        !verdict.passed,
        "identical numbers must still fail across profiles"
    );
    assert!(verdict.profile_mismatch.is_some());
}

#[test]
fn test_unspecified_profile_baseline_still_comparable() {
    let metric = BenchmarkMetric {
        name: METRIC_MYERS_DIFF_SWAR.to_string(),
        iterations: 10,
        total_duration_us: 100,
        avg_latency_ns: 10_000,
        ops_per_sec: 100_000.0,
    };
    let legacy_baseline = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 1,
        profile: BenchmarkProfile::Unspecified,
        metrics: vec![metric.clone()],
    };
    let current = TaxisBenchmarkSuite {
        engine: "taxis".to_string(),
        version: "0.1.0".to_string(),
        timestamp_ms: 2,
        profile: BenchmarkProfile::Release,
        metrics: vec![metric],
    };

    let verdict = current.compare_with_baseline(&legacy_baseline, 15.0);
    assert!(
        verdict.passed,
        "a baseline written before profiles existed must stay usable"
    );
    assert!(verdict.profile_mismatch.is_none());
}

#[test]
fn test_committed_baselines_cover_every_metric_per_profile() {
    let release: TaxisBenchmarkSuite = serde_json::from_str(include_str!(
        "../../baselines/taxis-perf.release.baseline.json"
    ))
    .expect("release baseline must parse");
    let debug: TaxisBenchmarkSuite = serde_json::from_str(include_str!(
        "../../baselines/taxis-perf.debug.baseline.json"
    ))
    .expect("debug baseline must parse");
    let expected: Vec<String> = TaxisBenchmarkSuite::run_suite(BenchmarkLevel::All, 1)
        .metrics
        .into_iter()
        .map(|metric| metric.name)
        .collect();

    for (profile, suite) in [
        (BenchmarkProfile::Release, &release),
        (BenchmarkProfile::Debug, &debug),
    ] {
        assert_eq!(
            suite.profile, profile,
            "baseline must declare its own profile"
        );
        for name in &expected {
            assert!(
                suite.metrics.iter().any(|metric| &metric.name == name),
                "baseline omits metric"
            );
        }
    }
}
