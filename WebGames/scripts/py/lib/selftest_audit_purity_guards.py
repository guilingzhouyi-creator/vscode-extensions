#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 机器输出纯洁性自检支持库)
# 文件路径: WebGames/scripts/py/lib/selftest_audit_purity_guards.py
# 架构定位: 性能热点与重构度量 JSON/SARIF/Badge 机器输出对抗自检模块
# 依赖与触发: 触发方: selftest_adversarial_guards.py | 上游: audit_perf_hotspots.py, audit_refactor_metrics | 下游: 对抗自检结论 | 运行时: Python 3.10+
# 职责说明: 验证 audit_perf_hotspots --json 纯输出及 audit_refactor_metrics 全格式机器输出、--strict 仲裁与快照持久化
# 退出语义与设计依据: 返回失败断言字符串列表，由主自检脚本统一汇总结算 | 设计依据: constraint-driven-development 对抗性证伪原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.selftest_audit_purity_guards import run_perf_and_refactor_purity_guards
# ==============================================================================
"""性能热点与重构度量工具机器输出纯洁性对抗性自检模块。"""

from __future__ import annotations
from contextlib import redirect_stdout
from pathlib import Path
import io
import json
import subprocess
import sys
import tempfile

import audit_refactor_metrics


def _test_audit_perf_hotspots_json() -> list[str]:
    """对抗样本 8：验证 audit_perf_hotspots --json 输出纯净合法 JSON 载荷。"""
    failures: list[str] = []
    script_path = Path(__file__).resolve().parent.parent / "audit_perf_hotspots.py"
    proc = subprocess.run(
        [sys.executable, str(script_path), "--json"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if proc.returncode != 0:
        failures.append(f"audit_perf_hotspots --json 默认非严格模式返回非零码: {proc.returncode}")
    if not proc.stdout.lstrip().startswith("{"):
        failures.append(f"audit_perf_hotspots --json stdout 前缀非 JSON: {proc.stdout[:120]!r}")
        return failures
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        failures.append(f"audit_perf_hotspots --json 输出无法解析: {exc}")
        return failures
    for key in ("tool", "totals", "findings", "files_scanned"):
        if key not in payload:
            failures.append(f"audit_perf_hotspots --json 缺少字段 {key}")
    return failures


def _check_refactor_dispatch_formats(sample_report: dict[str, object]) -> list[str]:
    """验证 audit_refactor_metrics 全格式机器输出纯净性、快照持久化与 --strict 门禁阻断。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        orig_root = audit_refactor_metrics.ROOT
        audit_refactor_metrics.ROOT = Path(td)
        try:
            latest_path = Path(td) / "reports" / "auto-refactor-latest.json"
            for fmt in ("json", "sarif", "markdown", "badge"):
                if latest_path.exists():
                    latest_path.unlink()
                opts = audit_refactor_metrics.RefactorAuditOptions(strict=True, report_format=fmt)
                out_buf = io.StringIO()
                with redirect_stdout(out_buf):
                    rc = audit_refactor_metrics._dispatch_audit_output(
                        sample_report, opts, process_returncode=0
                    )
                text = out_buf.getvalue()
                if rc != 1:
                    failures.append(f"--format {fmt} 在 --strict + error>0 时未返回 1 (实得: {rc})")
                if "【提示】" in text or "======" in text:
                    failures.append(f"--format {fmt} stdout 夹带横幅或提示噪点: {text[:120]!r}")
                if not latest_path.exists():
                    failures.append(f"--format {fmt} 未持久化 reports/auto-refactor-latest.json")
                if fmt in ("json", "sarif", "badge"):
                    try:
                        json.loads(text)
                    except json.JSONDecodeError as exc:
                        failures.append(f"--format {fmt} 输出非合法 JSON: {exc}")
        finally:
            audit_refactor_metrics.ROOT = orig_root
    return failures


def _test_audit_refactor_metrics_machine_purity() -> list[str]:
    """对抗样本 9：验证 audit_refactor_metrics 机器输出模式、--strict 仲裁与跨格式持久化。"""
    failures: list[str] = []
    for fmt in ("json", "sarif", "markdown", "badge"):
        opts = audit_refactor_metrics.RefactorAuditOptions(report_format=fmt)
        if not audit_refactor_metrics._is_machine_output(opts):
            failures.append(f"_is_machine_output({fmt}) 误判为 False")
        if audit_refactor_metrics._resolve_output_format(opts) != fmt:
            failures.append(f"_resolve_output_format({fmt}) 未保留原格式")
    score_opts = audit_refactor_metrics.RefactorAuditOptions(score_only=True)
    if not audit_refactor_metrics._is_machine_output(score_opts):
        failures.append("_is_machine_output(--score) 误判为 False")

    blocked_opts = audit_refactor_metrics.RefactorAuditOptions(strict=True)
    blocked_report = {
        "summary": {
            "filesScanned": 3,
            "issuesTotal": 1,
            "bySeverity": {"error": 0, "warning": 1, "info": 0},
            "arbitration": {"gateVerdict": "blocked", "blockingCount": 1},
        }
    }
    if not audit_refactor_metrics._evaluate_strict_gate(blocked_report, blocked_opts, 0)[0]:
        failures.append("_evaluate_strict_gate 未阻断 gateVerdict=blocked")
    if not audit_refactor_metrics._evaluate_strict_gate({"summary": {}}, blocked_opts, 1)[0]:
        failures.append("_evaluate_strict_gate 未阻断子进程非零退出码")

    sample_report: dict[str, object] = {
        "tool": "auto-refactor",
        "version": "1.0.0",
        "summary": {
            "filesScanned": 2,
            "issuesTotal": 1,
            "bySeverity": {"error": 1, "warning": 0, "info": 0},
            "durationMs": 12,
            "suppressedCount": 0,
        },
        "qualityScore": {
            "compositeScore": 88.5,
            "grade": "B",
            "confidence": 1.0,
            "indices": {"complexity": 90.0},
        },
        "issues": [{
            "analyzer": "complexity",
            "rule": "max-cc",
            "severity": "error",
            "message": "cc too high",
            "location": {"file": "backend/sample.gd", "start": {"line": 10, "column": 1}},
        }],
    }
    failures.extend(_check_refactor_dispatch_formats(sample_report))
    return failures


def run_perf_and_refactor_purity_guards() -> list[str]:
    """执行性能热点与重构度量机器输出对抗性自检合集。"""
    failures: list[str] = []
    failures.extend(_test_audit_perf_hotspots_json())
    failures.extend(_test_audit_refactor_metrics_machine_purity())
    return failures
