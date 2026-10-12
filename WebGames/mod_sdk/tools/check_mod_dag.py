#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod_dag.py
# 架构定位: MOD因果剧情DAG拓扑连通性与Kahn环检测校验子模块 (Mod DAG Topology Validator)
# 依赖与触发: 触发方: check_mod.py | 上游: DAG JSON 文件 | 下游: DiagnosticItem 诊断列表 | 运行时: Python 3.10+
# 职责说明: 校验单份 DAG 图元文件的入口/终态基数、Kahn 算法死锁环检测、前向/反向全可达性及 inline_text 语法糖
# 退出语义与设计依据: 纯计算与诊断登记函数，无外部副作用 | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""MOD 因果剧情 DAG 拓扑连通性、Kahn 环检测与节点文案完整性校验器。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from check_mod_common import (
    PARAM_REGEX,
    WHITELISTED_PLACEHOLDERS,
    DiagnosticItem,
    safe_load_json as _safe_load_json,
)


def check_dag_entries_and_terminals(
    nodes: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> tuple[str | None, list[str]]:
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


def build_dag_graph_structure(
    nodes: dict[str, Any],
    edges: list[Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, int]]:
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


def detect_dag_cycle_kahn(
    nodes: dict[str, Any],
    adj: dict[str, list[str]],
    in_degree: dict[str, int],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
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
            fix_suggestion="断开循环环路中的边（移除导致依赖闭环的边，使拓扑保持严格单向）",
        ))


def check_reachability(
    nodes: dict[str, Any],
    entry_id: str | None,
    terminals: list[str],
    adj: dict[str, list[str]],
    rev_adj: dict[str, list[str]],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
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


def flatten_i18n_dict(data: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """递归展平多层嵌套的 i18n 字典为以点号分隔的单层字典。"""
    flat: dict[str, str] = {}
    for k, v in data.items():
        full_key = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, str):
            flat[full_key] = v
        elif isinstance(v, dict):
            flat.update(flatten_i18n_dict(v, full_key))
    return flat


def check_dag_file(
    dag_path: Path,
    rel_name: str,
    required_keys: set[str],
    declared_dag_ids: set[str],
    diags: list[DiagnosticItem],
) -> None:
    """校验单份 DAG 图元文件，支持 inline_text 语法糖与节点文案完整性。"""
    data = _safe_load_json(dag_path, rel_name, diags)
    if not isinstance(data, dict):
        return

    for id_field in ("dag_id", "graph_id"):
        did = data.get(id_field)
        if isinstance(did, str) and did.strip():
            declared_dag_ids.add(did.strip())

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

    # 收集待本地化的叙事键或校验 inline_text 语法糖
    for nid, node_data in nodes.items():
        if not isinstance(node_data, dict):
            continue
        inline_val = node_data.get("inline_text")
        inline_texts: list[str] = []
        if isinstance(inline_val, str) and inline_val.strip():
            inline_texts.append(inline_val)
        elif isinstance(inline_val, dict):
            inline_texts.extend([v for v in inline_val.values() if isinstance(v, str) and v.strip()])

        if inline_texts:
            for txt in inline_texts:
                for param in PARAM_REGEX.findall(txt):
                    if param not in WHITELISTED_PLACEHOLDERS:
                        diags.append(DiagnosticItem(
                            code="ERR_UNKNOWN_PLACEHOLDER",
                            file_path=rel_name,
                            detail=f"节点 '{nid}' inline_text 包含非法/未知占位符 '{{{param}}}'",
                            fix_suggestion=f"请替换为白名单参数，如: {', '.join(sorted(list(WHITELISTED_PLACEHOLDERS)[:6]))}",
                        ))
        else:
            nkey = node_data.get("narrative_key")
            if isinstance(nkey, str) and nkey.strip():
                required_keys.add(nkey.strip())
            else:
                diags.append(DiagnosticItem(
                    code="ERR_DAG_NODE_TEXT_MISSING",
                    file_path=rel_name,
                    detail=f"节点 '{nid}' 既无有效 narrative_key 亦无非空 inline_text",
                    fix_suggestion=f"请为节点 '{nid}' 指定 narrative_key 或直接写入 inline_text",
                ))

    entry_id, terminals = check_dag_entries_and_terminals(nodes, rel_name, diags)
    adj, rev_adj, in_deg = build_dag_graph_structure(nodes, edges, rel_name, diags)
    detect_dag_cycle_kahn(nodes, adj, in_deg, rel_name, diags)
    check_reachability(nodes, entry_id, terminals, adj, rev_adj, rel_name, diags)
