#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 对抗性自检支持库)
# 文件路径: WebGames/scripts/py/lib/selftest_reporting_guards.py
# 架构定位: 报告聚合器与性能基线门禁对抗性自检模块 (Reporting Adversarial Probes)
# 依赖与触发: 触发方: selftest_adversarial_guards.py | 上游: lib.runner_reporter, report_aggregate | 下游: 对抗自检结论 | 运行时: Python 3.10+
# 职责说明: 在隔离临时目录中校验 stdout/stderr 告警采集去重、零告警误报防御及 report_aggregate fail-closed / --strict 守卫
# 退出语义与设计依据: 返回失败断言字符串列表，由主自检脚本统一汇总结算 | 设计依据: constraint-driven-development 对抗性证伪原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.selftest_reporting_guards import run_reporting_and_aggregate_guards
# ==============================================================================
"""runner_reporter 与 report_aggregate 对抗性自检探测模块。"""

from __future__ import annotations
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import io
import json
import tempfile

import report_aggregate
from lib.runner_reporter import (
    PipelineExecutionSummary,
    _evaluate_result_sarif_finding,
    render_console_summary,
    warning_slice,
)
from lib.runner_scheduler import AuditTask, TaskResult


def _test_runner_reporter_stdout_warnings() -> list[str]:
    """对抗样本 6：验证 runner_reporter 同时采集 stdout/stderr 告警并拒绝误报 (0 Error / 0 Warn)。"""
    failures: list[str] = []
    sample_stdout = (
        "\033[33m【WARN】perf loop alloc at backend/a.gd:12\033[0m\n"
        "\033[33m【WARN】perf loop alloc at backend/a.gd:12\033[0m\n"
        "【结论】通过 (0 Error / 0 Warn)\n"
        "Total: 0 warnings\n"
        "警告: 0\n"
        "含热点候选: 0 个（提示级）\n"
        "【审查结论】通过（提示级）\n"
        "✔ zero_alloc check push_warning clean\n"
    )
    sliced = warning_slice(stdout=sample_stdout, stderr="")
    if sliced.splitlines() != ["【WARN】perf loop alloc at backend/a.gd:12"]:
        failures.append(f"warning_slice 未能正确去重并过滤零告警行: {sliced!r}")

    task = AuditTask(task_id="perf", name="热点检查", script_name="audit_perf_hotspots.py")
    warn_res = TaskResult(
        task=task,
        returncode=0,
        stdout="WARN: hotspot in backend/foo.gd:42\n",
        stderr="",
        elapsed_sec=0.1,
    )
    finding = _evaluate_result_sarif_finding(warn_res)
    if not finding or finding.get("level") != "warning":
        failures.append(f"stdout 告警未生成 warning 级 SARIF finding: {finding!r}")

    clean_res = TaskResult(
        task=task,
        returncode=0,
        stdout="【审查结论】通过 (0 Error / 0 Warn)\n",
        stderr="",
        elapsed_sec=0.1,
    )
    if _evaluate_result_sarif_finding(clean_res) is not None:
        failures.append("零告警汇总行被误判为 SARIF warning")

    summary = PipelineExecutionSummary(
        results=[warn_res],
        wall_elapsed=0.1,
        sum_elapsed=0.1,
        speedup=1.0,
        workers=1,
        registry_issues=[],
        all_passed=True,
        is_quiet_mode=False,
        version="1.0.0",
    )
    out_buf = io.StringIO()
    with redirect_stdout(out_buf):
        rc = render_console_summary(summary)
    rendered = out_buf.getvalue()
    if rc != 0 or "(0 Error / 1 Warn)" not in rendered or "(0 Error / 0 Warn)" in rendered:
        failures.append(f"render_console_summary 汇总文案或退出码异常 (rc={rc}): {rendered!r}")
    return failures


def _test_report_aggregate_fail_closed_and_strict() -> list[str]:
    """对抗样本 7：验证 report_aggregate --gate 基线缺失/损坏时 fail-closed 且 --strict 拦截失踪指标。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        base_dir = Path(td)
        cur_path = base_dir / "cur.json"
        cur_path.write_text(
            json.dumps({
                "categories": [{
                    "name": "core",
                    "metrics": [
                        {"name": "bench_a", "ops_per_sec": 10000.0},
                        {"name": "bench_b", "ops_per_sec": 10000.0},
                    ],
                }]
            }),
            encoding="utf-8",
        )
        sink_out, sink_err = io.StringIO(), io.StringIO()
        with redirect_stdout(sink_out), redirect_stderr(sink_err):
            if report_aggregate.run_gate(base_dir / "missing.json", cur_path, 10.0) != 1:
                failures.append("report_aggregate 缺失 baseline.json 未触发 fail-closed (exit 1)")
            empty_base = base_dir / "empty.json"
            empty_base.write_text("{}", encoding="utf-8")
            if report_aggregate.run_gate(empty_base, cur_path, 10.0) != 1:
                failures.append("report_aggregate 空 baseline.json 未触发 fail-closed (exit 1)")
            bad_base = base_dir / "corrupt.json"
            bad_base.write_text("{broken json", encoding="utf-8")
            if report_aggregate.run_gate(bad_base, cur_path, 10.0) != 1:
                failures.append("report_aggregate 损坏 baseline.json 未触发 fail-closed (exit 1)")

            renamed_base = base_dir / "renamed.json"
            renamed_base.write_text(
                json.dumps({
                    "categories": [{
                        "name": "core",
                        "metrics": [
                            {"name": "bench_a", "ops_per_sec": 10000.0},
                            {"name": "bench_legacy", "ops_per_sec": 5000.0},
                        ],
                    }]
                }),
                encoding="utf-8",
            )
            if report_aggregate.run_gate(renamed_base, cur_path, 10.0, strict=False) != 0:
                failures.append("report_aggregate 非严格模式共享指标无回退却误拦截")
            if report_aggregate.run_gate(renamed_base, cur_path, 10.0, strict=True) != 1:
                failures.append("report_aggregate --strict 未拦截基线指标消失/重命名")
    return failures


def run_reporting_and_aggregate_guards() -> list[str]:
    """执行报告聚合与性能基线门禁对抗性自检合集。"""
    failures: list[str] = []
    failures.extend(_test_runner_reporter_stdout_warnings())
    failures.extend(_test_report_aggregate_fail_closed_and_strict())
    return failures
