//! Module: fractal-git — Commit Message Guard Micro-Benchmark
//! File Path: src/bench/guard.rs
//! Architecture Role: Measures sub-microsecond latency of commit message governance verification.
//! Dependencies & Triggers: Consumed by `TaxisBenchmarkSuite::bench_commit_message_guard`.
//! Responsibilities: Execute repeated runs of `CommitMessageGuard::parse_and_verify_with_symbols`
//!   on workspace-strict policies, measure component-level breakdown, and assert full fixture acceptance.
//! Exit Semantics & Design Rationale: Panic if fixture does not satisfy contract at every iteration.
//!
//! Domain Governance Rules: FGT-PRF-001 (performance ratchets).

use fg_core::models::TaxisPolicy;
use fg_gate::commit_guard::declaration::CandidateSymbol;
use std::time::Instant;

use super::{BenchmarkMetric, METRIC_COMMIT_GUARD};

/// Benchmarks the commit-message governance guard on a fully populated workspace message.
pub fn bench_commit_message_guard(iterations: usize) -> BenchmarkMetric {
    let policy = TaxisPolicy::workspace_strict();
    let message = concat!(
        "feat(gate): 新增提交信息区块槽位解析与双语别名\n\n",
        "[Project / 项目归属]\n- fractal-git\n\n",
        "[Why / 动机背景]\n- 门禁按字面量比较区块名导致模板推荐写法被误判为缺失。\n\n",
        "[Added / 新增内容]\n- 新增语义槽位解析与双语别名表。\n",
        "- 新增双向闭包断言。\n\n",
        "[Verification / 验证结论]\n- 断言 resolve_slot 对双名区块返回同一槽位。"
    );
    let candidates = [
        CandidateSymbol {
            name: "resolve_slot".to_string(),
            kind: "function",
        },
        CandidateSymbol {
            name: "SectionScan".to_string(),
            kind: "type",
        },
    ];

    let start = Instant::now();
    let mut accepted = 0usize;
    for _ in 0..iterations {
        let verdict = fg_gate::commit_guard::CommitMessageGuard::parse_and_verify_with_symbols(
            message,
            &policy,
            None,
            &candidates,
        );
        if verdict.is_ok() {
            accepted += 1;
        }
    }
    let elapsed = start.elapsed();

    if std::env::var_os("TAXIS_BENCH_PROFILE").is_some() {
        let lines: Vec<&str> = message.lines().collect();
        profile_component("lexicon", iterations, || {
            std::hint::black_box(fg_gate::commit_guard::lexicon::scan(message));
        });
        profile_component("typography", iterations, || {
            std::hint::black_box(fg_gate::commit_guard::typography::scan(message));
        });
        profile_component("style", iterations, || {
            std::hint::black_box(fg_gate::commit_guard::style::scan_body_lines(&lines));
        });
        profile_component("sections", iterations, || {
            std::hint::black_box(fg_gate::commit_guard::sections::SectionScan::parse(&lines));
        });
        profile_component("verification", iterations, || {
            std::hint::black_box(
                fg_gate::commit_guard::verification::has_falsifiable_assertion(
                    "- 断言 resolve_slot 对双名区块返回同一槽位。",
                ),
            );
        });
    }

    assert_eq!(
        accepted, iterations,
        "benchmark fixture must satisfy the workspace contract at every iteration"
    );

    super::TaxisBenchmarkSuite::calculate_metric(METRIC_COMMIT_GUARD, iterations, elapsed)
}

/// Times one guard component and prints its per-call cost.
fn profile_component(label: &str, iterations: usize, mut run: impl FnMut()) {
    for _ in 0..200 {
        run();
    }
    let start = Instant::now();
    for _ in 0..iterations {
        run();
    }
    let elapsed = start.elapsed();
    let per_call_ns = elapsed.as_nanos() as f64 / iterations as f64;
    println!("  [profile] {label:<14} {per_call_ns:>10.1} ns/call");
}
