#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 性能基线与基准测试 (Performance · 扫频数据分析)
# 文件路径: WebGames/scripts/py/report_sweep.py
# 架构定位: 性能调优分析器 (Sweep Report Analyzer)
# 依赖与触发: 触发方: bench-sweep.sh/ps1 | 上游: 基准测试日志 | 下游: 调优报告 | 运行时: Python 3.10+
# 职责说明: 解析参数扫描的多轮压力指标，生成吞吐拐点、极值与稳定性对比报告
# 退出语义与设计依据: 退出码: 0=分析完成 | 设计依据: 高承压性能治理契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/report_sweep.py -n 3
# ==============================================================================
"""多份基准报告按指标取中位数聚合为稳定基线（结构兼容聚合/门禁脚本）。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import argparse
import datetime
import json
import statistics
import sys

from audit_common import ensure_utf8_stdout, load_json
ensure_utf8_stdout()


def load(path: Path) -> dict:
    """读取指定路径的 JSON 报告。"""
    try:
        return load_json(path)
    except Exception as exc:
        print(f"【report-sweep】无法读取报告 {path}: {exc}", file=sys.stderr)
        sys.exit(1)


def _aggregate_runs(
    runs: list[dict],
) -> tuple[dict[str, dict[str, list[float]]], dict[str, str], list[str]]:
    """汇聚多轮运行中的指标样本数据。"""
    data: dict[str, dict[str, list[float]]] = {}
    cat_of: dict[str, str] = {}
    cat_order: list[str] = []
    for rep in runs:
        for cat in rep.get("categories", []):
            cname = cat.get("category", "?")
            if cname not in cat_order:
                cat_order.append(cname)
            for m in cat.get("metrics", []):
                name = m["name"]
                bucket = data.setdefault(name, {"iters": [], "us": [], "ops": []})
                bucket["iters"].append(m["iterations"])
                bucket["us"].append(m["elapsed_us"])
                bucket["ops"].append(m["ops_per_sec"])
                cat_of.setdefault(name, cname)
    return data, cat_of, cat_order


def _build_merged_categories(
    data: dict[str, dict[str, list[float]]],
    cat_of: dict[str, str],
    cat_order: list[str],
) -> list[dict[str, Any]]:
    """计算各分类指标中位数并构造聚合分类列表。"""
    merged_cats: list[dict[str, Any]] = []
    for cname in cat_order:
        metrics = []
        for name, bucket in data.items():
            if cat_of[name] != cname:
                continue
            metrics.append({
                "name": name,
                "iterations": int(statistics.median(bucket["iters"])),
                "elapsed_us": statistics.median(bucket["us"]),
                "ops_per_sec": statistics.median(bucket["ops"]),
                "runs": bucket["ops"],
            })
        if metrics:
            merged_cats.append({"category": cname, "metrics": metrics})
    return merged_cats


def _build_markdown_summary(
    runs: list[dict],
    data: dict[str, dict[str, list[float]]],
) -> list[str]:
    """生成中位数聚合 Markdown 表格行列表。"""
    rows = sorted(
        ((name, statistics.median(data[name]["ops"])) for name in data),
        key=lambda t: t[1],
        reverse=True,
    )
    md = [
        f"# 基准 Sweep 中位数（{len(runs)} 次运行）",
        "",
        "| 指标 | 中位数 ops/s | 各次运行 |",
        "|---|---:|---|",
    ]
    for name, ops in rows:
        vals = ", ".join(f"{v:,.0f}" for v in sorted(data[name]["ops"]))
        md.append(f"| {name} | {ops:,.1f} | {vals} |")
    return md


def main() -> int:
    """CLI 入口：多轮基准压测横向聚合与中位数评估。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("reports", nargs="+", help="两份或以上的基准报告路径")
    ap.add_argument("--out", help="合并 JSON 输出路径")
    ap.add_argument("--md", help="Markdown 中位数表输出路径（缺省打印到 stdout）")
    args = ap.parse_args()

    runs = [load(Path(r)) for r in args.reports]
    if len(runs) < 2:
        print("【report-sweep】至少需要两份报告", file=sys.stderr)
        return 1

    data, cat_of, cat_order = _aggregate_runs(runs)
    merged_cats = _build_merged_categories(data, cat_of, cat_order)

    merged = {
        "engine": runs[0].get("engine", "?"),
        "tool": f"report_sweep.py (median of {len(runs)} runs)",
        "source_runs": [Path(r).name for r in args.reports],
        "godot_version": runs[0].get("godot_version", "?"),
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "categories": merged_cats,
        "summary": {"total_metrics": len(data), "runs": len(runs)},
    }

    md = _build_markdown_summary(runs, data)
    text = "\n".join(md)
    if args.md:
        Path(args.md).parent.mkdir(parents=True, exist_ok=True)
        Path(args.md).write_text(text + "\n", encoding="utf-8")
        print(f"【report-sweep】中位数表已写入: {args.md}")
    else:
        print(text)

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"【report-sweep】合并报告已写入: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
