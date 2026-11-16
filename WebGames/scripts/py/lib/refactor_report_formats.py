#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 复杂度度量报告格式化)
# 文件路径: WebGames/scripts/py/lib/refactor_report_formats.py
# 架构定位: 静态质量评估多格式渲染与快照持久化模块 (Metrics Report Formatter)
# 依赖与触发: 触发方: audit_refactor_metrics.py | 上游: ScanReport dict | 下游: SARIF/Markdown/Badge/快照 | 运行时: Python 3.10+
# 职责说明: 提供 reports/auto-refactor-latest.json 快照持久化及 OASIS SARIF 2.1.0 / Markdown / Shields.io Badge 导出
# 退出语义与设计依据: 纯格式化与快照辅助模块，无独立退出码 | 设计依据: OASIS SARIF 2.1.0 标准与机器可读门禁纯洁性契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.refactor_report_formats import persist_latest_snapshot, build_sarif_report
# ==============================================================================
"""auto-refactor 报告快照持久化与 SARIF / Markdown / Badge 多格式构建器。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json
import sys


def persist_latest_snapshot(report: dict[str, Any], root_dir: Path) -> None:
    """持久化 reports/auto-refactor-latest.json 快照供工作区门禁读取。"""
    try:
        latest_dir = root_dir / "reports"
        latest_dir.mkdir(parents=True, exist_ok=True)
        latest_path = latest_dir / "auto-refactor-latest.json"
        latest_path.write_text(
            json.dumps(
                {
                    "tool": report.get("tool", "auto-refactor"),
                    "version": report.get("version", ""),
                    "generatedAt": report.get("createdAt", ""),
                    "summary": report.get("summary", {}),
                    "qualityScore": report.get("qualityScore", {}),
                    "triPlaneQuality": report.get("triPlaneQuality", {}),
                    "governance": report.get("governance"),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
    except OSError as exc:
        print(f"【WARN】写入 auto-refactor-latest.json 失败: {exc}", file=sys.stderr)


def build_sarif_report(report: dict[str, Any]) -> dict[str, Any]:
    """将 auto-refactor ScanReport 转换为 OASIS SARIF 2.1.0 文档。"""
    sev_map = {"info": "note", "warning": "warning", "error": "error"}
    issues = report.get("issues") or []
    seen_rules: set[str] = set()
    rules: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    for iss in issues:
        rule_id = f"{iss.get('analyzer', 'unknown')}.{iss.get('rule', 'unknown')}"
        if rule_id not in seen_rules:
            seen_rules.add(rule_id)
            rules.append({
                "id": rule_id,
                "name": rule_id,
                "shortDescription": {"text": rule_id},
            })
        loc = iss.get("location") or {}
        start = loc.get("start") or {}
        end = loc.get("end") or {}
        sugg = iss.get("suggestion", "")
        msg = str(iss.get("message", "")) + (f" Suggestion: {sugg}" if sugg else "")
        results.append({
            "ruleId": rule_id,
            "level": sev_map.get(str(iss.get("severity", "warning")), "warning"),
            "message": {"text": msg},
            "properties": {
                "analyzer": iss.get("analyzer", ""),
                "detail": iss.get("detail", {}),
            },
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {"uri": str(loc.get("file", ""))},
                    "region": {
                        "startLine": int(start.get("line", 1) or 1),
                        "startColumn": int(start.get("column", 1) or 1),
                        "endLine": int(end.get("line", start.get("line", 1)) or 1),
                        "endColumn": int(end.get("column", start.get("column", 1)) or 1),
                    },
                }
            }],
        })
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "auto-refactor",
                    "version": str(report.get("version", "")),
                    "informationUri": "https://github.com/guilingzhouyi-creator/vscode-extensions",
                    "rules": rules,
                }
            },
            "results": results,
        }],
    }


def render_markdown_report(
    report: dict[str, Any], strict_failed: bool, fail_reason: str
) -> str:
    """渲染干净的 Markdown 结构化质量评估报告。"""
    summary = report.get("summary") or {}
    by_sev = summary.get("bySeverity") or {}
    qs = report.get("qualityScore") or {}
    lines = [
        "# auto-refactor 静态质量评估报告",
        "",
        f"- 扫描文件数: {summary.get('filesScanned', 0)}",
        f"- 问题总数: {summary.get('issuesTotal', 0)} (ERROR {by_sev.get('error', 0)} / WARN {by_sev.get('warning', 0)} / INFO {by_sev.get('info', 0)})",
        f"- 引擎耗时: {summary.get('durationMs', 0)} ms | 规则抑制: {summary.get('suppressedCount', 0)}",
    ]
    if qs:
        lines.append(
            f"- 综合评分: **{qs.get('compositeScore', 0)}/100** (等级 `{qs.get('grade', 'N/A')}`, 置信度 `{qs.get('confidence', 1.0):.2f}`)"
        )
        indices = qs.get("indices") or {}
        if indices:
            lines.extend(["", "| 评估维度 | 得分 |", "|---|---:|"])
            for k, v in sorted(indices.items()):
                lines.append(f"| {k} | {v}/100 |")
    verdict = f"BLOCK ({fail_reason})" if strict_failed else "PASS"
    lines.extend(["", f"**门禁结论**: {verdict}"])
    return "\n".join(lines)


def build_badge_payload(report: dict[str, Any], strict_failed: bool) -> dict[str, Any]:
    """构建 Shields.io Endpoint JSON 徽章载荷。"""
    qs = report.get("qualityScore") or {}
    summary = report.get("summary") or {}
    if qs and isinstance(qs.get("compositeScore"), (int, float)):
        score = float(qs["compositeScore"])
        grade = qs.get("grade", "N/A")
        message = f"{score:.1f}/100 ({grade})"
        if strict_failed:
            color = "red"
        elif score >= 90:
            color = "brightgreen"
        elif score >= 80:
            color = "green"
        elif score >= 70:
            color = "yellowgreen"
        elif score >= 60:
            color = "yellow"
        else:
            color = "red"
    else:
        issues_total = int(summary.get("issuesTotal", 0) or 0)
        errors = int((summary.get("bySeverity") or {}).get("error", 0) or 0)
        message = f"{issues_total} issues"
        color = "red" if (strict_failed or errors > 0) else "green"
    return {
        "schemaVersion": 1,
        "label": "auto-refactor",
        "message": message,
        "color": color,
    }
