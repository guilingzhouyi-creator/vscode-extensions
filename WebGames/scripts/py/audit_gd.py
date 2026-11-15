#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 代码规范门禁)
# 文件路径: WebGames/scripts/py/audit_gd.py
# 架构定位: 静态语法与性能审查器统一门面 (GDScript Linter & Guard Facade)
# 依赖与触发: 触发方: CI / audit-all / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 统一编排并调度 Style（风格/题头）、Advanced（架构/强类型）与 Simplification（防过度设计/循环瞬态分配）三大门禁
# 退出语义与设计依据: 退出码: 0=合规, 1=存在阻断违规 | 设计依据: ADV-PRF-002/SIM-INH-001 与后端注释统一规范
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_gd.py
#   python scripts/py/audit_gd.py --json
#   python scripts/py/audit_gd.py --strict
# ==============================================================================
"""审查 GDScript 编码规范、高级质量治理与简化防过度工程化（三节统一聚合门面）。"""

from __future__ import annotations
from pathlib import Path
import argparse
import json
import re
import sys

from audit_common import ensure_utf8_stdout
from gd.advanced_rules import AdvancedCodeAuditor, Finding, run_advanced_audit
from gd.gd_common import CONFIG_RULES_FILE, GDFileCache, get_gd_files, get_rules_config
from gd.simplification_rules import (
    SimplificationAuditor,
    SimplificationFinding,
    run_simplification_audit,
)
from gd.style_rules import audit_file, run_style_audit
ensure_utf8_stdout()

__all__ = [
    "AdvancedCodeAuditor",
    "Finding",
    "GDFileCache",
    "SimplificationAuditor",
    "SimplificationFinding",
    "audit_file",
    "get_gd_files",
    "get_rules_config",
    "main",
    "run_advanced_audit",
    "run_simplification_audit",
    "run_style_audit",
    "verify_rule_config_coverage",
]

RULE_GET_CALL_RE = re.compile(r'(?:\.get\(|"rule_id":\s*)"((?:ADV|SIM)-[A-Z0-9-]+)"')


def _collect_consumed_rules(gd_dir: Path) -> set[str]:
    """扫描 GD 与事件信道审查模块源码中实际消费的规则 ID 集合。"""
    consumed: set[str] = set()
    event_audit_file = Path(__file__).resolve().parent / "audit_event_channels.py"
    scan_targets = [Path(__file__).resolve(), *gd_dir.glob("*.py")]
    if event_audit_file.exists():
        scan_targets.append(event_audit_file)
    for py_file in scan_targets:
        try:
            src = py_file.read_text(encoding="utf-8")
            consumed.update(m.group(1) for m in RULE_GET_CALL_RE.finditer(src))
        except OSError:
            continue
    return consumed


def _collect_declared_rules(config_path: Path) -> set[str]:
    """从 code_governance_rules.json 读取声明的规则 ID 集合。"""
    declared: set[str] = set()
    if not config_path.exists():
        return declared
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        return declared
    if isinstance(data, dict):
        adv = data.get("advanced_rules")
        if isinstance(adv, dict):
            declared.update(str(k) for k in adv.keys())
        simp = data.get("simplification_rules")
        if isinstance(simp, dict):
            declared.update(str(k) for k in simp.keys())
    return declared


def verify_rule_config_coverage() -> int:
    """规则配置覆盖率自检：悬空引用返回 1（阻断），声明未实施仅提示（返回 0）。"""
    gd_dir = Path(__file__).resolve().parent / "gd"
    consumed = _collect_consumed_rules(gd_dir)
    if not consumed:
        return 0

    declared = _collect_declared_rules(CONFIG_RULES_FILE)
    dangling = sorted(consumed - declared)
    unimplemented = sorted(declared - consumed)
    if not dangling and not unimplemented:
        return 0

    print("=" * 80)
    print("🧩 规则配置覆盖率自检（H1：code_governance_rules.json 键 ↔ 代码消费点）")
    if dangling:
        print(
            f"  ❌ 悬空引用 {len(dangling)} 项（config 缺失该键，规则将静默失效并放行）: {', '.join(dangling)}"
        )
    if unimplemented:
        print(
            f"  ⚠️ 声明未实施 {len(unimplemented)} 项（config 已声明但代码无消费点）: {', '.join(unimplemented)}"
        )
    print("-" * 80)
    return 1 if dangling else 0


def main() -> int:
    """CLI 聚合入口。"""
    ap = argparse.ArgumentParser(
        description="GDScript 质量治理统一审查（Style + Advanced + Simplification）"
    )
    ap.add_argument("--all", action="store_true", help="Style 节包含 tests/ 目录")
    ap.add_argument("--strict", action="store_true", help="将警告视为错误并阻断")
    ap.add_argument(
        "--json",
        action="store_true",
        help="输出 JSON 格式聚合报告（Advanced/Simplification 节）",
    )
    ap.add_argument("--slice", type=str, default="", help="仅审查匹配特定域名的文件")
    args = ap.parse_args()

    exit_codes: list[int] = []
    exit_codes.append(verify_rule_config_coverage())
    exit_codes.append(run_style_audit(include_tests=args.all))
    exit_codes.append(
        run_advanced_audit(
            strict=args.strict, json_output=args.json, slice_name=args.slice
        )
    )
    exit_codes.append(
        run_simplification_audit(
            strict=args.strict, json_output=args.json, slice_name=args.slice
        )
    )
    return 1 if any(c != 0 for c in exit_codes) else 0


if __name__ == "__main__":
    sys.exit(main())
