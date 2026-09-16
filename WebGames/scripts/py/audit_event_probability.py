#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 概率平衡门禁)
# 文件路径: WebGames/scripts/py/audit_event_probability.py
# 架构定位: 动态概率校验器 (Probability DAG Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/domains/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验随机事件动态修正链与概率 DAG 编排无死锁、无循环依赖且在合法概率区间
# 退出语义与设计依据: 退出码: 0=合规, 1=存在逻辑环或越界 | 设计依据: 事件流关联动态概率系统契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_event_probability.py
#   python scripts/py/audit_event_probability.py --json
# ==============================================================================
import json
import sys
from pathlib import Path
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

import re

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"


def load_ast_kind_whitelist_from_code() -> set:
    """从 narrative_causality_orchestrator.gd 解析 AST 条件 kind 白名单（代码唯一事实源）"""
    src_file = ROOT / "backend" / "domains" / "narrative_orchestration" / "narrative_causality_orchestrator.gd"
    if not src_file.exists():
        return {"AND", "OR", "NOT", "TOWN_EQUALS", "MIN_LEVEL", "HOUR_BETWEEN", "REPUTATION_GREATER"}
    src = src_file.read_text(encoding="utf-8")
    kinds = {"AND", "OR", "NOT"}
    for m in re.finditer(r'^\s*"([A-Z_]+)":', src, re.MULTILINE):
        kinds.add(m.group(1))
    return kinds


# 事件 AST 条件 kind 白名单（单一事实源：动态直读 GDScript 编排器实现）
KIND_WHITELIST = load_ast_kind_whitelist_from_code()
# 概率配置禁含执行逻辑字段（配置不得成为后门）
FORBIDDEN_FIELDS = {"action", "dispatch", "lifecycle", "trigger_write", "spawn", "execute"}


def check_kind(node: Any, violations: list[str], path: str) -> None:
    """递归校验条件 AST 节点：复合节点 type（AND/OR/NOT）与叶节点 kind 均在白名单"""
    if not isinstance(node, dict):
        return
    t = node.get("type", "")
    k = node.get("kind", "")
    if t and t not in KIND_WHITELIST:
        violations.append(f"[条件kind] {path} 未知复合 type: {t}")
    if k and k not in KIND_WHITELIST:
        violations.append(f"[条件kind] {path} 未知叶节点 kind: {k}")
    if not t and not k:
        violations.append(f"[条件kind] {path} 节点缺少 type/kind")
    for cond in node.get("conditions", []):
        check_kind(cond, violations, path + ".conditions")
    if isinstance(node.get("condition"), dict):
        check_kind(node["condition"], violations, path + ".condition")


def detect_cycle(events: dict[str, Any], start: str, visited: set[str], stack: list[str], violations: list[str]) -> None:
    if start in stack:
        violations.append(f"[关联无环] 事件关联图存在循环: {' -> '.join(stack + [start])}")
        return
    if start in visited:
        return
    visited.add(start)
    stack.append(start)
    for link in events.get(start, {}).get("links", []):
        detect_cycle(events, str(link.get("linked_event_id", "")), visited, stack, violations)
    stack.pop()


def run_event_probability_audit() -> int:
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：事件流关联动态概率系统深度审查报告 (Phase 22)")
    print("=" * 80)

    violations = []
    path = CONFIG / "domains" / "event_probability.json"
    if not path.exists():
        print("【审查结论】未通过（config/domains/event_probability.json 缺失，已阻断！）")
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    events = data.get("events", {})
    print(f"概率配置事件: {len(events)} 个")

    for eid, entry in events.items():
        # 1. 概率值域
        base = entry.get("base_probability", None)
        if base is None or not isinstance(base, (int, float)) or not (0.0 <= float(base) <= 1.0):
            violations.append(f"[值域] {eid}.base_probability 非法（需 0~1 数值）: {base}")
        # 2. 禁执行逻辑
        for f in FORBIDDEN_FIELDS:
            if f in entry:
                violations.append(f"[禁执行逻辑] {eid} 含执行字段 {f}（配置非后门）")
        # 条件/调整 factor/delta 数值校验 + kind 白名单
        for cond in entry.get("conditions", []):
            factor = cond.get("factor", 1.0)
            if not isinstance(factor, (int, float)) or float(factor) <= 0:
                violations.append(f"[值域] {eid}.conditions.factor 需 > 0: {factor}")
            check_kind(cond.get("when", {}), violations, f"{eid}.conditions.when")
        for adj in entry.get("adjustments", []):
            delta = adj.get("delta", 0.0)
            if not isinstance(delta, (int, float)):
                violations.append(f"[值域] {eid}.adjustments.delta 需数值: {delta}")
            check_kind(adj.get("when", {}), violations, f"{eid}.adjustments.when")

    # 3. 事件引用自洽：links.linked_event_id ⊆ events 键
    for eid, entry in events.items():
        for link in entry.get("links", []):
            lid = str(link.get("linked_event_id", ""))
            if lid not in events:
                violations.append(f"[事件引用] {eid}.links 引用未配置事件: {lid}")
            f = link.get("factor", 1.0)
            if not isinstance(f, (int, float)) or float(f) <= 0:
                violations.append(f"[值域] {eid}.links.factor 需 > 0: {f}")

    # 4. 关联无环
    visited = set()
    for eid in events:
        detect_cycle(events, eid, visited, [], violations)

    print(f"违规总数: {len(violations)}")
    for v in violations:
        print(f"  ✗ {v}")

    print("-" * 80)
    if violations:
        print("【审查结论】未通过（存在概率配置违规，已阻断！）")
        return 1
    print("【审查结论】通过（概率配置合规、值域正确、关联无环）")
    return 0


if __name__ == "__main__":
    sys.exit(run_event_probability_audit())
