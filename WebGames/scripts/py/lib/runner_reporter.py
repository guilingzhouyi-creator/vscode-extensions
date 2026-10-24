#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 门禁报告聚合)
# 文件路径: WebGames/scripts/py/lib/runner_reporter.py
# 架构定位: 门禁聚合格式化器与 SARIF/JSON 导出引擎 (Audit Reporter Engine)
# 依赖与触发: 触发方: audit_runner.py | 上游: TaskResult 列表 | 下游: 控制台/SARIF/JSON | 运行时: Python 3.10+
# 职责说明: 提供 OASIS SARIF 2.1.0 标准结果生成、稳定指纹、警告行切片及终端富文本着色看板渲染
# 退出语义与设计依据: 纯报告模块，无退出码（部分导出函数按原逻辑 sys.exit） | 设计依据: OASIS SARIF 2.1.0 标准
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.runner_reporter import finalize_audit_outputs, PipelineExecutionSummary
# ==============================================================================
"""门禁结果报告聚合、终端着色看板与 SARIF/JSON 导出支持模块。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# ANSI 颜色定义
C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_RED = "\033[31m"
C_GREEN = "\033[32m"
C_YELLOW = "\033[33m"
C_BLUE = "\033[34m"
C_CYAN = "\033[36m"
C_GRAY = "\033[90m"

_WARN_PATTERN_RE = re.compile(r"WARN|Warning|warning|警告|提示级|⚠")
_LOCATION_LINE_RE = re.compile(r"([A-Za-z0-9_./\\-]+\.(?:gd|md|json|py)):(\d+)")


@dataclass(slots=True)
class PipelineExecutionSummary:
    """门禁流水线执行全量指标上下文封装（消除 Data Clumps）。"""

    results: list[Any]
    wall_elapsed: float
    sum_elapsed: float
    speedup: float
    workers: int
    registry_issues: list[str]
    all_passed: bool
    is_quiet_mode: bool
    version: str


def warning_slice(stderr: str, max_chars: int = 2000) -> str:
    """从通过任务 stderr 中抽取 warning 级行，供 JSON 报告透出。"""
    if not stderr:
        return ""
    keep = [ln for ln in stderr.splitlines() if _WARN_PATTERN_RE.search(ln)]
    if not keep:
        return ""
    text = "\n".join(keep)
    return text[-max_chars:] if len(text) > max_chars else text


def _extract_region(message: str) -> dict[str, Any]:
    """从消息中解析首处 文件:行号，返回 SARIF region。"""
    m = _LOCATION_LINE_RE.search(message)
    if not m:
        return {}
    return {
        "startLine": int(m.group(2)),
        "artifactLocation": {"uri": m.group(1).replace("\\", "/")},
    }


def _stable_fingerprint(content: str) -> str:
    """SARIF 稳定指纹：SHA-256 截断取 12 位十六进制。"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]


def _build_sarif_finding(task: Any, level: str, text: str) -> dict[str, Any]:
    """构建单个 SARIF finding 字典项。"""
    region = _extract_region(text)
    loc = {
        "physicalLocation": {
            "artifactLocation": {
                "uri": region.get("artifactLocation", {}).get(
                    "uri", f"scripts/py/{task.script_name}"
                )
            }
        }
    }
    if "startLine" in region:
        loc["physicalLocation"]["region"] = {"startLine": region["startLine"]}
    return {
        "ruleId": task.task_id,
        "level": level,
        "message": {"text": text[:4000]},
        "locations": [loc],
        "partialFingerprints": {
            "primaryLocationLineHash": _stable_fingerprint(
                f"{task.task_id}:{text[:200]}"
            )
        },
    }


def _evaluate_result_sarif_finding(r: Any) -> dict[str, Any] | None:
    """提取单个任务执行结果的 SARIF 缺陷条目。"""
    if r.returncode != 0:
        err = r.stderr.strip()
        out = r.stdout.strip()
        msg = err if err else (out if out else f"Task {r.task.name} failed with returncode {r.returncode}")
        return _build_sarif_finding(r.task, "error", msg)
    w = warning_slice(r.stderr)
    return _build_sarif_finding(r.task, "warning", w) if w else None


def generate_sarif(results: list[Any], version: str) -> dict[str, Any]:
    """将任务结果聚合为 OASIS SARIF 2.1.0 工业标准静态分析结果格式。"""
    sarif_rules: list[dict[str, Any]] = []
    seen_rules: set[str] = set()
    for r in results:
        tid = r.task.task_id
        if tid not in seen_rules:
            seen_rules.add(tid)
            sarif_rules.append(
                {
                    "id": tid,
                    "name": r.task.name,
                    "shortDescription": {"text": r.task.name},
                    "fullDescription": {"text": r.task.name},
                    "defaultConfiguration": {"level": "error"},
                    "helpUri": f"scripts/py/{r.task.script_name}",
                }
            )

    sarif_results: list[dict[str, Any]] = [
        finding
        for r in results
        if (finding := _evaluate_result_sarif_finding(r)) is not None
    ]

    return {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "WebGames-AuditRunner",
                        "informationUri": "https://github.com/guilingzhouyi-creator/vscode-extensions",
                        "version": version,
                        "rules": sarif_rules,
                    }
                },
                "invocations": [
                    {
                        "executionSuccessful": all(
                            r.returncode == 0 for r in results
                        ),
                        "toolExecutionNotifications": [],
                        "endTimeUtc": time.strftime(
                            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                        ),
                    }
                ],
                "results": sarif_results,
            }
        ],
    }


def export_sarif_report(args: argparse.Namespace, summary: PipelineExecutionSummary) -> None:
    """生成并导出 SARIF 报告。"""
    sarif_doc = generate_sarif(summary.results, summary.version)
    if args.sarif_out:
        out_p = Path(args.sarif_out)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(
            json.dumps(sarif_doc, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if not summary.is_quiet_mode:
            print(f"【SARIF】已成功导出行业标准分析报告至: {out_p}")
    if args.format == "sarif":
        print(json.dumps(sarif_doc, ensure_ascii=False, indent=2))
        sys.exit(0 if summary.all_passed else 1)


def export_json_report(summary: PipelineExecutionSummary) -> None:
    """输出 JSON 格式聚合报告。"""
    report = {
        "all_passed": summary.all_passed,
        "wall_elapsed_sec": round(summary.wall_elapsed, 3),
        "sum_cpu_sec": round(summary.sum_elapsed, 3),
        "speedup_ratio": round(summary.speedup, 2),
        "workers": summary.workers,
        "registry_issues": summary.registry_issues,
        "tasks": [
            {
                "task_id": r.task.task_id,
                "group": r.task.group,
                "name": r.task.name,
                "script": r.task.script_name,
                "passed": r.returncode == 0,
                "returncode": r.returncode,
                "elapsed_sec": round(r.elapsed_sec, 3),
                "stderr": (
                    r.stderr if r.returncode != 0 else warning_slice(r.stderr)
                ),
            }
            for r in summary.results
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if summary.all_passed else 1)


def _print_failed_task_diagnostics(failed_tasks: list[Any]) -> None:
    """输出未通过任务的标准错误与输出诊断。"""
    if not failed_tasks:
        return
    print(f"\n{C_RED}{C_BOLD}❌ 未通过任务诊断详情:{C_RESET}")
    for ft in failed_tasks:
        print(f"\n--- [{ft.task.name}] ({ft.task.script_name}) ---")
        out = ft.stdout.strip()
        err = ft.stderr.strip()
        if out:
            print(out)
        if err:
            print(f"{C_RED}{err}{C_RESET}")


def render_console_summary(summary: PipelineExecutionSummary) -> int:
    """渲染控制台汇总看板并返回退出码。"""
    failed_tasks = [r for r in summary.results if r.returncode != 0]
    print("\n" + "=" * 75)
    print(f"📊 {C_BOLD}门禁调度汇总报告 (Quality Gates Aggregation){C_RESET}")
    print("=" * 75)
    pass_cnt = len(summary.results) - len(failed_tasks)
    print(
        f"  • 任务通过率: {C_GREEN if summary.all_passed else C_RED}{pass_cnt} / {len(summary.results)} PASS{C_RESET}"
    )
    print(
        f"  • 并行实际耗时 (Wall Clock): {C_GREEN}{summary.wall_elapsed:5.2f}s{C_RESET} (串行等效累计: {summary.sum_elapsed:5.2f}s | 加速比: {C_CYAN}{summary.speedup:.2f}x{C_RESET})"
    )

    if failed_tasks or summary.registry_issues:
        _print_failed_task_diagnostics(failed_tasks)
        print(f"\n{C_RED}【门禁结论】审查未通过，已阻断！{C_RESET}")
        return 1

    print(
        f"\n{C_GREEN}{C_BOLD}🎉 恭喜！全域门禁审查 100% 全部通过 (0 Error / 0 Warn)！{C_RESET}"
    )
    return 0


def finalize_audit_outputs(args: argparse.Namespace, summary: PipelineExecutionSummary) -> int:
    """统一输出 SARIF、JSON 报告或终端汇总面板。"""
    if args.sarif_out or args.format == "sarif":
        export_sarif_report(args, summary)
    if args.format == "json":
        export_json_report(summary)
    return render_console_summary(summary)
