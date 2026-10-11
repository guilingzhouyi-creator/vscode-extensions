#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod.py
# 架构定位: MOD纯静态轻量自愈诊断器 (Pure Static Mod Validator & Diagnostic Tool)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录与文件 | 下游: 控制台输出与结构化 JSON 自愈指引 | 运行时: Python 3.10+
# 职责说明: 纯静态校验 MOD 清单格式、因果 DAG 拓扑连通性与文案占位符白名单，输出自愈诊断
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现违规错误, 2=参数/IO错误 | 设计依据: Phase 114 DevKit 契约与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/check_mod.py ./my_mod
#   python mod_sdk/tools/check_mod.py ./my_mod --json
# ==============================================================================
"""纯静态轻量 MOD 检查器与自愈诊断器：专为外部开发者与自主 Agent 打造的门禁工具。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# 系统级允许的剧情文本参数占位符白名单
WHITELISTED_PLACEHOLDERS: frozenset[str] = frozenset({
    "player_name",
    "race",
    "gender",
    "level",
    "world_id",
    "town",
    "gold",
    "cur",
    "max",
    "name",
    "status",
    "desc",
    "beast_count",
    "reward_gold",
    "loss_soldiers",
    "loss_gold",
    "gain_gold",
})

PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

REQUIRED_MANIFEST_FIELDS: tuple[str, ...] = (
    "pack_id",
    "pack_name",
    "version",
    "author",
    "engine_api_version",
    "priority",
    "dependencies",
    "incompatible_packs",
    "semantic_tags",
    "is_active",
)


class DiagnosticItem:
    """结构化诊断发现项。"""

    def __init__(self, code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
        self.code = code
        self.file = file_path
        self.detail = detail
        self.fix_suggestion = fix_suggestion

    def to_dict(self) -> dict[str, str]:
        return {
            "code": self.code,
            "file": self.file,
            "detail": self.detail,
            "fix_suggestion": self.fix_suggestion,
        }


def _safe_load_json(file_path: Path, rel_name: str, diags: list[DiagnosticItem]) -> Any:
    """安全读取并解析 JSON 文件。"""
    if not file_path.is_file():
        diags.append(DiagnosticItem(
            code="ERR_FILE_MISSING",
            file_path=rel_name,
            detail=f"必备文件不存在: {rel_name}",
            fix_suggestion=f"请通过 scaffold_mod.py 或手动创建 {rel_name}",
        ))
        return None

    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except (json.JSONDecodeError, OSError) as err:
        diags.append(DiagnosticItem(
            code="ERR_JSON_INVALID",
            file_path=rel_name,
            detail=f"JSON 解析失败: {err}",
            fix_suggestion=f"请检查 {rel_name} 的 JSON 语法正确性与逗号/引号匹配",
        ))
        return None


def _check_manifest(mod_dir: Path, diags: list[DiagnosticItem]) -> dict[str, Any] | None:
    """校验 pack.json 清单。"""
    manifest_path = mod_dir / "pack.json"
    data = _safe_load_json(manifest_path, "pack.json", diags)
    if not isinstance(data, dict):
        if data is not None:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_NOT_OBJECT",
                file_path="pack.json",
                detail="pack.json 顶层必须为 JSON 对象",
                fix_suggestion="请将 pack.json 根节点修改为 JSON 对象格式 {}",
            ))
        return None

    for field in REQUIRED_MANIFEST_FIELDS:
        if field not in data:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_FIELD_MISSING",
                file_path="pack.json",
                detail=f"清单缺失必备字段: '{field}'",
                fix_suggestion=f"在 pack.json 中补充 '{field}' 字段声明",
            ))

    if not isinstance(data.get("priority", 0), int):
        diags.append(DiagnosticItem(
            code="ERR_MANIFEST_FIELD_TYPE",
            file_path="pack.json",
            detail="字段 'priority' 必须为整数",
            fix_suggestion="将 'priority' 字段修改为正整数（如 100）",
        ))

    return data


def _extract_rules_list(rules_data: Any) -> list[dict[str, Any]]:
    """提取路由规则列表。"""
    if isinstance(rules_data, list):
        return [r for r in rules_data if isinstance(r, dict)]
    if isinstance(rules_data, dict):
        for key in ("routing_rules", "rules", "prologue_routing_rules"):
            val = rules_data.get(key)
            if isinstance(val, list):
                return [r for r in val if isinstance(r, dict)]
    return []


def _check_routing_rules(mod_dir: Path, declared_dag_ids: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 routing_rules.json。"""
    routing_path = mod_dir / "routing_rules.json"
    data = _safe_load_json(routing_path, "routing_rules.json", diags)
    if data is None:
        return

    rules = _extract_rules_list(data)
    if not rules:
        diags.append(DiagnosticItem(
            code="ERR_ROUTING_EMPTY",
            file_path="routing_rules.json",
            detail="routing_rules.json 中未解析到有效的路由规则列表",
            fix_suggestion="请在 routing_rules.json 中提供 'routing_rules' 数组并配置匹配规则",
        ))
        return

    for idx, rule in enumerate(rules):
        target = rule.get("target_dag_id")
        if not target or not isinstance(target, str):
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_MISSING",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条路由规则缺少 'target_dag_id'",
                fix_suggestion="为该规则指定目标 DAG 图标识符 target_dag_id",
            ))
            continue

        if declared_dag_ids and target not in declared_dag_ids:
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_UNKNOWN",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条规则引用的 target_dag_id '{target}' 在 dag_graphs/ 中未找到",
                fix_suggestion=f"请确保 dag_graphs/{target}.json 存在或修改目标 ID",
            ))


def _check_dag_entries_and_terminals(nodes: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> tuple[str | None, list[str]]:
    """校验 DAG 入口与终态节点基数。"""
    entry_nodes: list[str] = []
    terminal_nodes: list[str] = []

    for nid, node_data in nodes.items():
        if not isinstance(node_data, dict):
            continue
        ntype = str(node_data.get("node_type", ""))
        if ntype == "START_ENTRY":
            entry_nodes.append(nid)
        elif ntype == "TERMINAL_EXIT":
            terminal_nodes.append(nid)

    if len(entry_nodes) != 1:
        diags.append(DiagnosticItem(
            code="ERR_DAG_ENTRY_COUNT",
            file_path=rel_name,
            detail=f"DAG 必须有且仅有一个 START_ENTRY 节点，实际找到: {len(entry_nodes)} 个 ({entry_nodes})",
            fix_suggestion="请调整节点定义，保留且仅保留一个 node_type 为 'START_ENTRY' 的入口节点",
        ))

    if not terminal_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_TERMINAL_COUNT",
            file_path=rel_name,
            detail="DAG 至少需要一个 TERMINAL_EXIT 终态退出节点",
            fix_suggestion="在 nodes 中添加一个 node_type 为 'TERMINAL_EXIT' 的完成节点",
        ))

    entry_id = entry_nodes[0] if len(entry_nodes) == 1 else None
    return entry_id, terminal_nodes


def _build_dag_graph_structure(nodes: dict[str, Any], edges: list[Any], rel_name: str, diags: list[DiagnosticItem]) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, int]]:
    """构建邻接表、反向邻接表与入度表，并拦截悬挂边与前置缺失。"""
    adj: dict[str, list[str]] = {nid: [] for nid in nodes}
    rev_adj: dict[str, list[str]] = {nid: [] for nid in nodes}
    in_degree: dict[str, int] = {nid: 0 for nid in nodes}

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        u = edge.get("from") or edge.get("from_node_id")
        v = edge.get("to") or edge.get("to_node_id")
        if u not in nodes or v not in nodes:
            diags.append(DiagnosticItem(
                code="ERR_DAG_DANGLING_EDGE",
                file_path=rel_name,
                detail=f"边连接了不存在的节点: '{u}' -> '{v}'",
                fix_suggestion="检查边的两端节点 ID 是否均已在 nodes 字典中正确声明",
            ))
            continue

        adj[u].append(v)
        rev_adj[v].append(u)
        in_degree[v] += 1

    for nid, node_data in nodes.items():
        if not isinstance(node_data, dict):
            continue
        prereqs = node_data.get("required_prerequisites", [])
        if isinstance(prereqs, list):
            for pre in prereqs:
                if pre not in nodes:
                    diags.append(DiagnosticItem(
                        code="ERR_DAG_MISSING_PREREQUISITE",
                        file_path=rel_name,
                        detail=f"节点 '{nid}' 的前置依赖 '{pre}' 不存在",
                        fix_suggestion=f"在 nodes 中补充声明 '{pre}' 或从 '{nid}' 的 required_prerequisites 中移除",
                    ))

    return adj, rev_adj, in_degree


def _detect_dag_cycle_kahn(nodes: dict[str, Any], adj: dict[str, list[str]], in_degree: dict[str, int], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """使用 Kahn 拓扑排序算法检测死锁有向环。"""
    deg_copy = dict(in_degree)
    zero_queue = [nid for nid, d in deg_copy.items() if d == 0]
    visited_count = 0

    while zero_queue:
        curr = zero_queue.pop(0)
        visited_count += 1
        for nbr in adj.get(curr, []):
            deg_copy[nbr] -= 1
            if deg_copy[nbr] == 0:
                zero_queue.append(nbr)

    if visited_count < len(nodes):
        cyclic_nodes = [nid for nid, d in deg_copy.items() if d > 0]
        diags.append(DiagnosticItem(
            code="ERR_DAG_CYCLE",
            file_path=rel_name,
            detail=f"DAG 存在死锁循环依赖环 (Cycle)！涉及节点: {cyclic_nodes}",
            fix_suggestion=f"断开循环环路中的边（移除导致依赖闭环的边，使拓扑保持严格单向）",
        ))


def _check_reachability(nodes: dict[str, Any], entry_id: str | None, terminals: list[str], adj: dict[str, list[str]], rev_adj: dict[str, list[str]], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """检查连通性与可达性：所有节点自入口可达，且所有路径均可到达终点。"""
    if not entry_id:
        return

    # 1. 前向可达性 (从入口出发)
    fwd_reachable: set[str] = set()
    frontier = [entry_id]
    while frontier:
        cur = frontier.pop(0)
        if cur in fwd_reachable:
            continue
        fwd_reachable.add(cur)
        for nxt in adj.get(cur, []):
            if nxt not in fwd_reachable:
                frontier.append(nxt)

    unreachable_nodes = set(nodes.keys()) - fwd_reachable
    if unreachable_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_ORPHAN_NODE",
            file_path=rel_name,
            detail=f"存在无法从入口 '{entry_id}' 到达的孤儿断链节点: {sorted(unreachable_nodes)}",
            fix_suggestion="请为孤儿节点添加来自上游节点的边，或者从图元中移除未引用的节点",
        ))

    # 2. 反向可达性 (能到达任意终态节点)
    if not terminals:
        return

    bwd_reachable: set[str] = set()
    bwd_frontier = list(terminals)
    while bwd_frontier:
        cur = bwd_frontier.pop(0)
        if cur in bwd_reachable:
            continue
        bwd_reachable.add(cur)
        for prev in rev_adj.get(cur, []):
            if prev not in bwd_reachable:
                bwd_frontier.append(prev)

    dead_end_nodes = fwd_reachable - bwd_reachable
    if dead_end_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_UNREACHABLE_TERMINAL",
            file_path=rel_name,
            detail=f"存在无法沿路径到达任何 TERMINAL_EXIT 的死胡同节点: {sorted(dead_end_nodes)}",
            fix_suggestion="请为这些节点添加指向终态节点的出边，确保所有分支都能顺利完结",
        ))


def _check_dag_file(dag_path: Path, rel_name: str, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验单份 DAG 图元文件。"""
    data = _safe_load_json(dag_path, rel_name, diags)
    if not isinstance(data, dict):
        return

    nodes = data.get("nodes")
    edges = data.get("edges")
    if not isinstance(nodes, dict) or not nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_NO_NODES",
            file_path=rel_name,
            detail="DAG 图元 nodes 字段必须为非空字典",
            fix_suggestion="在 DAG JSON 中声明 'nodes' 对象，并至少包含起始与终态节点",
        ))
        return

    if not isinstance(edges, list):
        edges = []

    # 收集待本地化的叙事键
    for nid, node_data in nodes.items():
        if isinstance(node_data, dict):
            nkey = node_data.get("narrative_key")
            if nkey and isinstance(nkey, str):
                required_keys.add(nkey)

    entry_id, terminals = _check_dag_entries_and_terminals(nodes, rel_name, diags)
    adj, rev_adj, in_deg = _build_dag_graph_structure(nodes, edges, rel_name, diags)
    _detect_dag_cycle_kahn(nodes, adj, in_deg, rel_name, diags)
    _check_reachability(nodes, entry_id, terminals, adj, rev_adj, rel_name, diags)


def _check_i18n(mod_dir: Path, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 i18n 语言包与占位符白名单。"""
    i18n_dir = mod_dir / "i18n"
    if not i18n_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_I18N_DIR_MISSING",
            file_path="i18n",
            detail="缺少 i18n 本地化目录",
            fix_suggestion="创建 i18n 目录并在其中放置 zh-CN.json",
        ))
        return

    i18n_files = sorted(i18n_dir.glob("*.json"))
    if not i18n_files:
        diags.append(DiagnosticItem(
            code="ERR_I18N_EMPTY",
            file_path="i18n",
            detail="i18n 目录下未找到任何语言 JSON 文件",
            fix_suggestion="在 i18n 目录创建 zh-CN.json 提供多语言文案字典",
        ))
        return

    for ifile in i18n_files:
        rel_path = f"i18n/{ifile.name}"
        data = _safe_load_json(ifile, rel_path, diags)
        if not isinstance(data, dict):
            continue

        # 1. 检查 DAG 引用的叙事键在语言包中是否存在
        for rkey in sorted(required_keys):
            if rkey not in data:
                diags.append(DiagnosticItem(
                    code="ERR_I18N_MISSING_KEY",
                    file_path=rel_path,
                    detail=f"语言包缺少 DAG 所需的文案键: '{rkey}'",
                    fix_suggestion=f"在 {rel_path} 中添加键 '{rkey}' 的本地化翻译文本",
                ))

        # 2. 占位符白名单校验
        for k, text in data.items():
            if not isinstance(text, str):
                continue
            matches = PARAM_REGEX.findall(text)
            for param in matches:
                if param not in WHITELISTED_PLACEHOLDERS:
                    diags.append(DiagnosticItem(
                        code="ERR_UNKNOWN_PLACEHOLDER",
                        file_path=rel_path,
                        detail=f"键 '{k}' 包含非法/未知占位符 '{{{param}}}'",
                        fix_suggestion=f"请替换为白名单参数，如: {', '.join(sorted(list(WHITELISTED_PLACEHOLDERS)[:6]))}",
                    ))


def validate_mod(mod_dir: Path) -> tuple[bool, list[DiagnosticItem]]:
    """核心诊断校验流水线。"""
    diags: list[DiagnosticItem] = []
    if not mod_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_MOD_DIR_NOT_FOUND",
            file_path=str(mod_dir),
            detail=f"MOD 目标目录不存在: {mod_dir}",
            fix_suggestion="请确认命令行指定的 MOD 根目录路径存在",
        ))
        return False, diags

    _check_manifest(mod_dir, diags)

    dag_dir = mod_dir / "dag_graphs"
    declared_dag_ids: set[str] = set()
    required_keys: set[str] = set()

    if not dag_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_DAG_DIR_MISSING",
            file_path="dag_graphs",
            detail="缺少 dag_graphs 目录",
            fix_suggestion="创建 dag_graphs 目录并在其中放置因果 DAG 图元 JSON",
        ))
    else:
        dag_files = sorted(dag_dir.glob("*.json"))
        if not dag_files:
            diags.append(DiagnosticItem(
                code="ERR_DAG_NO_FILES",
                file_path="dag_graphs",
                detail="dag_graphs 目录下未找到任何因果图元 JSON 文件",
                fix_suggestion="在 dag_graphs 下至少创建一个 DAG_<ID>.json 图元文件",
            ))
        for df in dag_files:
            dag_stem = df.stem
            declared_dag_ids.add(dag_stem)
            _check_dag_file(df, f"dag_graphs/{df.name}", required_keys, diags)

    _check_routing_rules(mod_dir, declared_dag_ids, diags)
    _check_i18n(mod_dir, required_keys, diags)

    valid = len(diags) == 0
    return valid, diags


def print_cli_report(valid: bool, diags: list[DiagnosticItem], mod_dir: Path) -> None:
    """输出人类可读的控制台审查报告。"""
    print("==============================================================================")
    print(f"🔍 卡拉尔 MOD 静态诊断报告: {mod_dir.resolve().name}")
    print("------------------------------------------------------------------------------")
    if valid:
        print("  🎉 诊断结论: 100% 合规通过！")
        print("  • 清单格式   : 合规")
        print("  • DAG 拓扑   : 连通性良好，无环，无孤儿，单入口全路径可达")
        print("  • 占位符白名单: 100% 遵从")
        print("==============================================================================")
        return

    print(f"  ❌ 发现 {len(diags)} 处违规或拓扑缺陷:\n")
    for idx, d in enumerate(diags, start=1):
        print(f"  [{idx}] [{d.code}] 文件: {d.file}")
        print(f"      • 详情: {d.detail}")
        print(f"      • 建议: {d.fix_suggestion}\n")
    print("==============================================================================")


def main() -> None:
    """命令行入口。"""
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 纯静态自愈诊断器 (Static Mod Checker)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", help="待诊断的 MOD 根目录路径")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 诊断信息")

    args = parser.parse_args()
    target_dir = Path(args.mod_dir)
    valid, diags = validate_mod(target_dir)

    if args.as_json:
        payload = {
            "valid": valid,
            "error_count": len(diags),
            "diagnostics": [d.to_dict() for d in diags],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cli_report(valid, diags, target_dir)

    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
