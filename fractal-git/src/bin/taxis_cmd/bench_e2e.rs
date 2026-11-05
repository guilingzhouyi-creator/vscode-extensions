//! Module: taxis_cmd::bench_e2e — End-to-End Benchmark CLI Subcommand Dispatcher
//! File Path: src/bin/taxis_cmd/bench_e2e.rs
//! Architecture Role: Dispatches single-threaded E2E clone vs progressive projection benchmarks,
//!   persists JSON baselines, and validates monotonic performance ratchets.
//! Dependencies & Triggers: Dispatched by `taxis bench --e2e` or `taxis bench --level 4`.
//! Responsibilities: E2E benchmark execution, CLI argument parsing, baseline verification and persistence.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on fast paths
//! - `TB-REGRESSION`: Monotonic 15% tolerance performance ratchet with noise floor guards

use std::env;
use std::path::{Path, PathBuf};

use fractal_git::bench::{
    BenchmarkProfile, E2eBenchmarkOptions, E2eBenchmarkReport, TaxisBenchmarkSuite,
};
use fractal_git::constants::cli::CliTag;

use super::bench::resolve_baseline_file;
use super::common::{fail_fatal, fail_io, find_arg_value, print_json, CliContext};

/// Directory holding the frozen baselines, relative to the crate root.
const BASELINE_DIR: &str = "baselines";

/// Dispatches End-to-End single-threaded clone & progressive projection benchmark execution.
pub fn handle_e2e_bench(ctx: &CliContext) {
    let workload_path = find_arg_value(&ctx.args, &["-w", "--workload"]).map(PathBuf::from);
    let iterations = find_arg_value(&ctx.args, &["-i", "--iterations", "-m", "--multiplier"])
        .and_then(|val| val.parse::<usize>().ok())
        .unwrap_or(3);
    let target_file = find_arg_value(&ctx.args, &["--target-file"])
        .unwrap_or("crates/core/src/lib.rs")
        .to_string();
    let scoped_path = find_arg_value(&ctx.args, &["--scope"])
        .unwrap_or("crates/core")
        .to_string();

    let options = E2eBenchmarkOptions {
        workload_path,
        iterations,
        target_file,
        scoped_path,
        single_threaded: true,
    };

    let report = match TaxisBenchmarkSuite::run_e2e_suite(&options) {
        Ok(rep) => rep,
        Err(err) => fail_fatal(format!("E2E benchmark execution failed: {err}")),
    };

    let save_path = find_arg_value(&ctx.args, &["--save-baseline"]).map(PathBuf::from);
    let verify_path = find_arg_value(&ctx.args, &["--verify-baseline"]).map(PathBuf::from);

    if let Some(save_file) = save_path {
        save_e2e_baseline(&save_file, &report);
    }

    if let Some(verify_arg) = verify_path {
        verify_e2e_baseline(&verify_arg, &report);
    }

    if ctx.json_mode {
        print_json(&report);
    } else {
        print!("{}", report.render_table());
    }
}

/// Saves current E2E benchmark metrics JSON into the designated target file.
pub fn save_e2e_baseline(save_file: &Path, report: &E2eBenchmarkReport) {
    let resolved_save = if save_file.is_absolute() || save_file.exists() {
        save_file.to_path_buf()
    } else if let Ok(cwd) = env::current_dir() {
        let fg_path = cwd.join("fractal-git").join(save_file);
        if fg_path.exists() || fg_path.parent().map_or(false, |p| p.is_dir()) {
            fg_path
        } else {
            save_file.to_path_buf()
        }
    } else {
        save_file.to_path_buf()
    };

    if let Some(parent) = resolved_save.parent() {
        if let Err(create_err) = std::fs::create_dir_all(parent) {
            fail_io(
                format!("create baseline directory '{}'", parent.display()),
                create_err,
            );
        }
    }
    let mut json = match serde_json::to_string_pretty(report) {
        Ok(serialized) => serialized,
        Err(json_err) => fail_io("serialize e2e benchmark baseline", json_err),
    };
    if !json.ends_with('\n') {
        json.push('\n');
    }
    if let Err(write_err) = std::fs::write(&resolved_save, json) {
        fail_io(
            format!("save e2e baseline to '{}'", resolved_save.display()),
            write_err,
        );
    }
    println!(
        "Saved '{}' profile E2E benchmark baseline to {}",
        report.profile.as_str(),
        resolved_save.display()
    );
}

/// Resolves E2E baseline file path with fallback to workspace root paths.
pub fn resolve_e2e_baseline_file(verify_arg: &Path) -> Option<PathBuf> {
    let verify_str = verify_arg.to_string_lossy().to_string();
    let trimmed = verify_str
        .trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace())
        .to_string();

    if trimmed.eq_ignore_ascii_case("auto") {
        let current = BenchmarkProfile::current();
        let candidate = PathBuf::from(BASELINE_DIR).join(format!("taxis-e2e.{}.baseline.json", current.as_str()));
        if candidate.exists() {
            return Some(candidate);
        }
        if let Ok(cwd) = env::current_dir() {
            let direct = cwd.join(BASELINE_DIR).join(format!("taxis-e2e.{}.baseline.json", current.as_str()));
            if direct.exists() {
                return Some(direct);
            }
            let fg_dir = cwd.join("fractal-git").join(BASELINE_DIR).join(format!("taxis-e2e.{}.baseline.json", current.as_str()));
            if fg_dir.exists() {
                return Some(fg_dir);
            }
        }
    }

    resolve_baseline_file(verify_arg)
}

/// Verifies E2E benchmark metrics against baseline within the hardware tolerance allowance.
pub fn verify_e2e_baseline(verify_arg: &Path, report: &E2eBenchmarkReport) {
    let resolved = resolve_e2e_baseline_file(verify_arg);
    let Some(path) = resolved else {
        eprintln!(
            "TB-REGRESSION: E2E baseline file '{}' could not be found",
            verify_arg.display()
        );
        std::process::exit(1);
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => fail_io(format!("read e2e baseline '{}'", path.display()), e),
    };
    let baseline: E2eBenchmarkReport = match serde_json::from_str(&content) {
        Ok(b) => b,
        Err(e) => fail_io(format!("parse e2e baseline '{}'", path.display()), e),
    };

    let verdict = report.compare_with_baseline(&baseline, report.profile.tolerance_pct());
    if verdict.passed {
        println!(
            "TB-REGRESSION: E2E Performance ratchet passed (within {:.0}% tolerance for '{}' profile).",
            report.profile.tolerance_pct(),
            report.profile.as_str()
        );
        for imp in &verdict.improvements {
            println!("  {} {}", CliTag::OPTIMIZED, imp);
        }
        return;
    }

    if let Some(detail) = &verdict.profile_mismatch {
        eprintln!("TB-REGRESSION: E2E baseline profile mismatch — {detail}");
    }
    if !verdict.regressions.is_empty() {
        eprintln!(
            "TB-REGRESSION: E2E benchmark regressed beyond {:.0}% tolerance!",
            report.profile.tolerance_pct()
        );
        for reg in &verdict.regressions {
            eprintln!("  {} {}", CliTag::FAIL, reg);
        }
    }
    std::process::exit(1);
}
