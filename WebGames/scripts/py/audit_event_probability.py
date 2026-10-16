#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 概率平衡门禁)
# 文件路径: WebGames/scripts/py/audit_event_probability.py
# 架构定位: 动态概率校验器 (Probability DAG Validator)
# 依赖与触发: 触发方: audit_runner / CLI | 上游: config/domains/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验随机事件动态修正链与概率 DAG 编排无死锁、无循环依赖且在合法概率区间
# 退出语义与设计依据: 退出码: 0=合规, 1=存在逻辑环或越界 | 设计依据: 事件流关联动态概率系统契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_event_probability.py
#   python scripts/py/audit_event_probability.py --json
# ==============================================================================
"""事件流关联动态概率系统审查：校验概率配置值域、无死锁、无执行后门与 DAG 无环。"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Set

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"


def load_ast_kind_whitelist_from_code() -> Set[str]:
    """从 narrative_causality_orchestrator.gd 解析 AST 条件 kind 白名单（代码唯一事实源）。"""
    src_file = (
        ROOT
        / "backend"
        / "domains"
        / "narrative_orchestration"
        / "narrative_causality_orchestrator.gd"
    )
    if not src_file.exists():
        return {
            "AND",
            "OR",
            "NOT",
            "TOWN_EQUALS",
            "MIN_LEVEL",
            "HOUR_BETWEEN",
            "REPUTATION_GREATER",
        }
    src = src_file.read_text(encoding="utf-8")
    kinds = {"AND", "OR", "NOT"}
    for m in re.finditer(r'^\s*"([A-Z_]+)":', src, re.MULTILINE):
        kinds.add(m.group(1))
    return kinds


KIND_WHITELIST = load_ast_kind_whitelist_from_code()
FORBIDDEN_FIELDS = {
    "action",
    "dispatch",
    "lifecycle",
    "trigger_write",
    "spawn",
    "execute",
}


def check_kind(node: Any, violations: List[str], path: str) -> None:
    """递归校验条件 AST 节点：复合节点 type 与叶节点 kind 均在白名单内。"""
    if not isinstance(node, dict):
        return
    node_type = node.get("type", "")
    node_kind = node.get("kind", "")
    if node_type and node_type not in KIND_WHITELIST:
        violations.append(f"[条件kind] {path} 未知复合 type: {node_type}")
    if node_kind and node_kind not in KIND_WHITELIST:
        violations.append(f"[条件kind] {path} 未知叶节点 kind: {node_kind}")
    if not node_type and not node_kind:
        violations.append(f"[条件kind] {path} 节点缺少 type/kind")
    for cond in node.get("conditions", []):
        check_kind(cond, violations, f"{path}.conditions")
    if isinstance(node.get("condition"), dict):
        check_kind(node["condition"], violations, f"{path}.condition")


class CycleDetector:
    """事件关联 DAG 环路检测器，消除参数泥团并追踪回溯栈。"""

    def __init__(self, events: Dict[str, Any], violations: List[str]) -> None:
        """初始化环路检测器实例。"""
        self.events = events
        self.violations = violations
        self.visited: Set[str] = set()
        self.stack: List[str] = []

    def check(self, start: str) -> None:
        """从起始事件节点递归遍历检测是否存在有向循环链路。"""
        if start in self.stack:
            cycle_path = " -> ".join(self.stack + [start])
            self.violations.append(f"[关联无环] 事件关联图存在循环: {cycle_path}")
            return
        if start in self.visited:
            return
        self.visited.add(start)
        self.stack.append(start)
        links = self.events.get(start, {}).get("links", [])
        if isinstance(links, list):
            for link in links:
                if isinstance(link, dict):
                    target_id = str(link.get("linked_event_id", ""))
                    if target_id:
                        self.check(target_id)
        self.stack.pop()


def _validate_event_entry(eid: str, entry: Dict[str, Any], violations: List[str]) -> None:
    """校验单个事件配置的值域、执行字段禁入与条件 AST 合规性。"""
    base = entry.get("base_probability", None)
    if base is None or not isinstance(base, (int, float)) or not (0.0 <= float(base) <= 1.0):
        violations.append(f"[值域] {eid}.base_probability 非法（需 0~1 数值）: {base}")

    for f in FORBIDDEN_FIELDS:
        if f in entry:
            violations.append(f"[禁执行逻辑] {eid} 含执行字段 {f}（配置非后门）")

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


def _validate_event_links(
    eid: str,
    entry: Dict[str, Any],
    events: Dict[str, Any],
    violations: List[str],
) -> None:
    """校验单个事件的外部引用存在性与概率因数有效性。"""
    for link in entry.get("links", []):
        lid = str(link.get("linked_event_id", ""))
        if lid not in events:
            violations.append(f"[事件引用] {eid}.links 引用未配置事件: {lid}")
        f = link.get("factor", 1.0)
        if not isinstance(f, (int, float)) or float(f) <= 0:
            violations.append(f"[值域] {eid}.links.factor 需 > 0: {f}")


def run_event_probability_audit() -> int:
    """执行事件流关联动态概率系统深度审查入口主流程。"""
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：事件流关联动态概率系统深度审查报告")
    print("=" * 80)

    violations: List[str] = []
    path = CONFIG / "domains" / "event_probability" / "core.json"
    if not path.exists():
        path = CONFIG / "domains" / "event_probability.json"
    if not path.exists():
        print("【审查结论】未通过（config/domains/event_probability/core.json 缺失，已阻断！）")
        return 1

    data = json.loads(path.read_text(encoding="utf-8"))
    events = data.get("events", {})
    print(f"概率配置事件: {len(events)} 个")

    for eid, entry in events.items():
        if isinstance(entry, dict):
            _validate_event_entry(eid, entry, violations)
            _validate_event_links(eid, entry, events, violations)

    detector = CycleDetector(events, violations)
    for eid in events:
        detector.check(eid)

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
