//! Module: Benchmark Subcommand Handler
//! Architecture: Executes Taxis performance micro/macro benchmark suites and regression ratchets.

use std::env;
use std::path::{Path, PathBuf};

use fractal_git::bench::TaxisBenchmarkSuite;
use fractal_git::constants::cli::CliTag;
use fractal_git::BenchmarkLevel;

use super::common::{find_arg_value, print_json, CliContext};

/// Dispatches benchmark suite execution, baseline persistence, and regression verification.
pub fn handle_bench(ctx: &CliContext) {
    let multiplier = find_arg_value(&ctx.args, &["-m", "--multiplier"])
        .and_then(|val| val.parse::<usize>().ok())
        .unwrap_or(1);
    let level = parse_bench_level(&ctx.args);

    let save_path = find_arg_value(&ctx.args, &["--save-baseline"]).map(PathBuf::from);
    let verify_path = find_arg_value(&ctx.args, &["--verify-baseline"]).map(PathBuf::from);

    let suite = TaxisBenchmarkSuite::run_suite(level, multiplier);

    if let Some(save_file) = save_path {
        save_bench_baseline(&save_file, &suite);
    }

    if let Some(verify_arg) = verify_path {
        verify_bench_baseline(&verify_arg, &suite);
    }

    render_bench_results(ctx, &suite);
}

fn parse_bench_level(args: &[String]) -> BenchmarkLevel {
    if args.iter().any(|arg| arg == "--scion-parity") {
        return BenchmarkLevel::All;
    }
    match find_arg_value(args, &["--level"]) {
        Some("2" | "scale" | "poset") => BenchmarkLevel::Level2Scale,
        Some("3" | "macro" | "monorepo") => BenchmarkLevel::Level3Macro,
        Some("all" | "full") => BenchmarkLevel::All,
        _ => BenchmarkLevel::Level1Micro,
    }
}

fn save_bench_baseline(save_file: &Path, suite: &TaxisBenchmarkSuite) {
    if let Some(parent) = save_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(suite).unwrap_or_default();
    if let Err(io_err) = std::fs::write(save_file, json) {
        eprintln!(
            "Failed to save baseline to {}: {}",
            save_file.display(),
            io_err
        );
        std::process::exit(1);
    }
    println!("Saved performance baseline to {}", save_file.display());
}

fn resolve_baseline_file(verify_arg: &Path) -> Option<PathBuf> {
    let verify_str = verify_arg.to_string_lossy().to_string();
    let trimmed = verify_str
        .trim_matches(|char_val: char| char_val == '"' || char_val == '\'' || char_val.is_whitespace())
        .to_string();
    let normalized = trimmed.replace('/', std::path::MAIN_SEPARATOR_STR);
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

fn load_baseline(final_path: Option<&Path>) -> TaxisBenchmarkSuite {
    if let Some(path) = final_path {
        let content = std::fs::read_to_string(path).unwrap_or_default();
        match serde_json::from_str(&content) {
            Ok(parsed_baseline) => parsed_baseline,
            Err(parse_err) => {
                eprintln!(
                    "Failed to parse baseline {}: {}",
                    path.display(),
                    parse_err
                );
                std::process::exit(1);
            }
        }
    } else {
        const EMBEDDED_BASELINE: &str = include_str!("../../../baselines/taxis-perf.baseline.json");
        match serde_json::from_str(EMBEDDED_BASELINE) {
            Ok(parsed_baseline) => {
                println!(
                    "{} Resolved benchmark baseline via embedded compile-time freeze.",
                    CliTag::HERMETIC_BASELINE
                );
                parsed_baseline
            }
            Err(parse_err) => {
                eprintln!("Failed to parse embedded baseline: {}", parse_err);
                std::process::exit(1);
            }
        }
    }
}

fn verify_bench_baseline(verify_arg: &Path, suite: &TaxisBenchmarkSuite) {
    let resolved = resolve_baseline_file(verify_arg);
    let baseline = load_baseline(resolved.as_deref());

    let verdict = suite.compare_with_baseline(&baseline, 15.0);
    if !verdict.passed {
        eprintln!("TB-REGRESSION: Performance benchmark regressed beyond 15% tolerance!");
        for reg in verdict.regressions {
            eprintln!("  {} {}", CliTag::FAIL, reg);
        }
        std::process::exit(1);
    }

    println!("TB-REGRESSION: Performance ratchet passed (within 15% tolerance).");
    for imp in verdict.improvements {
        println!("  {} {}", CliTag::OPTIMIZED, imp);
    }
}

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
