//! Module: taxis_cmd::bench — Benchmark Subcommand Dispatcher
//! File Path: src/bin/taxis_cmd/bench.rs
//! Architecture Role: Executes Taxis performance micro/macro benchmark suites,
//!   persists results, and validates regression ratchets against frozen baselines.
//! Dependencies & Triggers: Invoked when `taxis bench` is dispatched.
//! Responsibilities: Benchmark execution, profile-scoped ratchet comparison, baseline persistence.
//! Exit Semantics & Design Rationale: Exits 0 on passing ratchet, exits 1 on regression. A baseline
//!   measured in the other build profile is a hard failure rather than a warning: debug and release
//!   differ by roughly an order of magnitude, so comparing across them reports a regression on every
//!   metric and trains the reader to ignore the gate.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on fast paths

use std::env;
use std::path::{Path, PathBuf};

use fractal_git::bench::{BenchmarkProfile, TaxisBenchmarkSuite};
use fractal_git::constants::cli::CliTag;
use fractal_git::BenchmarkLevel;

use super::common::{fail_io, find_arg_value, print_json, CliContext};

/// Directory holding the frozen baselines, relative to the crate root.
const BASELINE_DIR: &str = "baselines";

/// Dispatches benchmark suite execution, baseline persistence, and regression verification.
pub fn handle_bench(ctx: &CliContext) {
    let level = parse_bench_level(&ctx.args);
    let is_e2e = level == BenchmarkLevel::Level4E2E
        || ctx.args.iter().any(|arg| {
            arg == "--e2e" || arg == "--clone" || arg == "bench-clone" || arg == "--bench-clone"
        });

    if is_e2e {
        super::bench_e2e::handle_e2e_bench(ctx);
        return;
    }

    let multiplier = find_arg_value(&ctx.args, &["-m", "--multiplier"])
        .and_then(|val| val.parse::<usize>().ok())
        .unwrap_or(1);

    let save_path = find_arg_value(&ctx.args, &["--save-baseline"]).map(PathBuf::from);
    let verify_path = find_arg_value(&ctx.args, &["--verify-baseline"]).map(PathBuf::from);

    let suite = TaxisBenchmarkSuite::run_suite(level, multiplier);
    fg_core::diag_info!(
        "bench",
        "measured {} metric(s) in '{}' profile",
        suite.metrics.len(),
        suite.profile.as_str()
    );

    if let Some(save_file) = save_path {
        save_bench_baseline(&save_file, &suite);
    }

    if let Some(verify_arg) = verify_path {
        verify_bench_baseline(&verify_arg, &suite);
    }

    render_bench_results(ctx, &suite);
}

/// Parses CLI benchmark level from flags (--level 2, --scion-parity, etc.).
fn parse_bench_level(args: &[String]) -> BenchmarkLevel {
    if args.iter().any(|arg| arg == "--scion-parity") {
        return BenchmarkLevel::All;
    }
    if args.iter().any(|arg| {
        arg == "--e2e" || arg == "--clone" || arg == "bench-clone" || arg == "--bench-clone"
    }) {
        return BenchmarkLevel::Level4E2E;
    }
    match find_arg_value(args, &["--level"]) {
        Some("2" | "scale" | "poset") => BenchmarkLevel::Level2Scale,
        Some("3" | "macro" | "monorepo") => BenchmarkLevel::Level3Macro,
        Some("4" | "e2e" | "clone") => BenchmarkLevel::Level4E2E,
        Some("all" | "full") => BenchmarkLevel::All,
        Some("all-e2e") => BenchmarkLevel::AllWithE2E,
        _ => BenchmarkLevel::Level1Micro,
    }
}

/// Saves current benchmark metrics JSON into the designated target file.
fn save_bench_baseline(save_file: &Path, suite: &TaxisBenchmarkSuite) {
    if let Some(parent) = save_file.parent() {
        if let Err(create_err) = std::fs::create_dir_all(parent) {
            fail_io(
                format!("create baseline directory '{}'", parent.display()),
                create_err,
            );
        }
    }
    let json = match serde_json::to_string_pretty(suite) {
        Ok(serialized) => serialized,
        Err(json_err) => fail_io("serialize benchmark baseline", json_err),
    };
    if let Err(write_err) = std::fs::write(save_file, json) {
        fail_io(
            format!("save baseline to '{}'", save_file.display()),
            write_err,
        );
    }
    println!(
        "Saved '{}' profile performance baseline to {}",
        suite.profile.as_str(),
        save_file.display()
    );
}

/// File name a baseline of `profile` is expected to live under.
fn profile_baseline_name(profile: BenchmarkProfile) -> String {
    format!("taxis-perf.{}.baseline.json", profile.as_str())
}

/// Resolves baseline file path with fallback to workspace root paths.
///
/// The literal `auto` expands to the baseline matching this build profile, so one gate invocation
/// serves both `cargo test` and the release audit without the caller having to know which profile
/// it is running in.
pub(crate) fn resolve_baseline_file(verify_arg: &Path) -> Option<PathBuf> {
    let verify_str = verify_arg.to_string_lossy().to_string();
    let trimmed = verify_str
        .trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace())
        .to_string();
    let normalized = trimmed.replace('/', std::path::MAIN_SEPARATOR_STR);

    if trimmed.eq_ignore_ascii_case("auto") {
        let current = BenchmarkProfile::current();
        return Some(PathBuf::from(BASELINE_DIR).join(profile_baseline_name(current)));
    }

    let final_path = PathBuf::from(&trimmed);

    if final_path.exists() {
        return Some(final_path);
    }

    let norm_path = PathBuf::from(&normalized);
    if norm_path.exists() {
        return Some(norm_path);
    }

    if let Ok(cwd) = env::current_dir() {
        let candidates = [
            cwd.join(&trimmed),
            cwd.join(&normalized),
            cwd.join("fractal-git").join(&trimmed),
            cwd.join("fractal-git").join(&normalized),
        ];
        for cand in &candidates {
            if cand.exists() {
                return Some(cand.clone());
            }
        }
    }

    None
}

/// Loads a baseline suite from disk or falls back to the embedded freeze for this profile.
fn load_baseline(final_path: Option<&Path>) -> TaxisBenchmarkSuite {
    if let Some(path) = final_path {
        let content = match std::fs::read_to_string(path) {
            Ok(read_content) => read_content,
            Err(read_err) => fail_io(format!("read baseline '{}'", path.display()), read_err),
        };
        match serde_json::from_str(&content) {
            Ok(parsed_baseline) => parsed_baseline,
            Err(parse_err) => fail_io(format!("parse baseline '{}'", path.display()), parse_err),
        }
    } else {
        // Two freezes rather than one: a single table cannot be correct for both profiles, and
        // comparing a release freeze against a debug binary is the false regression this module
        // now refuses to report silently.
        const EMBEDDED_RELEASE: &str =
            include_str!("../../../baselines/taxis-perf.release.baseline.json");
        const EMBEDDED_DEBUG: &str =
            include_str!("../../../baselines/taxis-perf.debug.baseline.json");
        let profile = BenchmarkProfile::current();
        let embedded = match profile {
            BenchmarkProfile::Debug => EMBEDDED_DEBUG,
            _ => EMBEDDED_RELEASE,
        };
        match serde_json::from_str(embedded) {
            Ok(parsed_baseline) => {
                println!(
                    "{} Resolved embedded '{}' benchmark baseline via compile-time freeze.",
                    CliTag::HERMETIC_BASELINE,
                    profile.as_str()
                );
                parsed_baseline
            }
            Err(parse_err) => fail_io("parse embedded baseline", parse_err),
        }
    }
}

/// Verifies benchmark suite metrics against baseline within the 15% hardware tolerance allowance.
///
/// Every failure mode is printed before exiting so one run explains the whole verdict; stopping at
/// the first problem would send the reader back for a second run to find the rest.
fn verify_bench_baseline(verify_arg: &Path, suite: &TaxisBenchmarkSuite) {
    let resolved = resolve_baseline_file(verify_arg);
    let baseline = load_baseline(resolved.as_deref());
    fg_core::diag_debug!(
        "bench",
        "comparing against '{}' baseline holding {} metric(s)",
        baseline.profile.as_str(),
        baseline.metrics.len()
    );

    let verdict = suite.compare_with_baseline(&baseline, suite.profile.tolerance_pct());
    if verdict.passed {
        println!(
            "TB-REGRESSION: Performance ratchet passed (within {:.0}% tolerance for '{}' profile).",
            suite.profile.tolerance_pct(),
            suite.profile.as_str()
        );
        for imp in &verdict.improvements {
            println!("  {} {}", CliTag::OPTIMIZED, imp);
        }
        return;
    }

    if let Some(detail) = &verdict.profile_mismatch {
        eprintln!("TB-REGRESSION: Baseline profile mismatch — {detail}");
    }
    if !verdict.regressions.is_empty() {
        eprintln!(
            "TB-REGRESSION: Performance benchmark regressed beyond {:.0}% tolerance!",
            suite.profile.tolerance_pct()
        );
        for reg in &verdict.regressions {
            eprintln!("  {} {}", CliTag::FAIL, reg);
        }
    }
    if !verdict.unbaselined.is_empty() {
        eprintln!(
            "TB-REGRESSION: {} metric(s) have no baseline entry and cannot be ratcheted:",
            verdict.unbaselined.len()
        );
        for name in &verdict.unbaselined {
            let latency = suite
                .metrics
                .iter()
                .find(|metric| &metric.name == name)
                .map(|metric| metric.avg_latency_ns)
                .unwrap_or(0);
            eprintln!(
                "  {} {}: measured {} ns but the frozen baseline omits it",
                CliTag::FAIL,
                name,
                latency
            );
        }
    }
    std::process::exit(1);
}

/// Formats benchmark execution results as text table or JSON.
fn render_bench_results(ctx: &CliContext, suite: &TaxisBenchmarkSuite) {
    if ctx.json_mode {
        print_json(suite);
        return;
    }

    println!("=== Taxis Performance Micro-Benchmark Results ===");
    println!(
        "{:<36} {:>8} {:>14} {:>16}",
        "Benchmark Metric", "Iters", "Avg Latency", "Throughput"
    );
    println!("{}", "-".repeat(78));
    for metric in &suite.metrics {
        let latency_str = if metric.avg_latency_ns < 1000 {
            format!("{} ns", metric.avg_latency_ns)
        } else if metric.avg_latency_ns < 1_000_000 {
            format!("{:.2} us", metric.avg_latency_ns as f64 / 1000.0)
        } else {
            format!("{:.2} ms", metric.avg_latency_ns as f64 / 1_000_000.0)
        };
        println!(
            "{:<36} {:>8} {:>14} {:>14.0} op/s",
            metric.name, metric.iterations, latency_str, metric.ops_per_sec
        );
    }
    println!("{}", "-".repeat(78));
}
