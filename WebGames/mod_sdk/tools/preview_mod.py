#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/preview_mod.py
# 架构定位: MOD无头剧情演习推演器 (Headless Mod Narrative Preview & Simulator)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录、DAG 图元与语言包 | 下游: 纯文本剧情演习日志 | 运行时: Python 3.10+
# 职责说明: 无头遍历 MOD 因果 DAG 叙事分支，注入模拟角色上下文并水化占位符文本
# 退出语义与设计依据: 退出码: 0=推演成功, 1=模组缺陷/文件错误, 2=参数错误 | 设计依据: Phase 114 DevKit 契约与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/preview_mod.py ./my_mod
#   python mod_sdk/tools/preview_mod.py ./my_mod --simulate
#   python mod_sdk/tools/preview_mod.py ./my_mod --simulate --race ELF --name "伊兰迪尔"
# ==============================================================================
"""MOD 无头演习器：离线模拟剧情流转、分支推演与占位符水化日志输出。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def _load_json_file(file_path: Path) -> Any:
    """安全读取 JSON 文件，失败返回 None。"""
    if not file_path.is_file():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _load_i18n_catalog(i18n_dir: Path) -> dict[str, str]:
    """汇总 i18n 目录下的所有文案。"""
    catalog: dict[str, str] = {}
    if not i18n_dir.is_dir():
        return catalog
    for f in sorted(i18n_dir.glob("*.json")):
        data = _load_json_file(f)
        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, str):
                    catalog[k] = v
    return catalog


def _extract_routing_rules(routing_rules_data: Any) -> list[dict[str, Any]]:
    """从配置数据中提取扁平规则列表。"""
    if isinstance(routing_rules_data, list):
        return [r for r in routing_rules_data if isinstance(r, dict)]
    if not isinstance(routing_rules_data, dict):
        return []
    for key in ("routing_rules", "rules", "prologue_routing_rules"):
        val = routing_rules_data.get(key)
        if isinstance(val, list):
            return [r for r in val if isinstance(r, dict)]
    return []


def _match_target_dag(routing_rules_data: Any, race_id: str) -> str | None:
    """根据角色种族与默认规则匹配目标 DAG 标识符。"""
    rules = _extract_routing_rules(routing_rules_data)
    race_upper = race_id.upper()

    # 1. 精确匹配 race_id
    for r in rules:
        cond = r.get("match_condition", {})
        if isinstance(cond, dict) and cond.get("race_id", "").upper() == race_upper:
            target = r.get("target_dag_id")
            if target and isinstance(target, str):
                return target

    # 2. 默认兜底 is_default
    for r in rules:
        cond = r.get("match_condition", {})
        if isinstance(cond, dict) and cond.get("is_default") is True:
            target = r.get("target_dag_id")
            if target and isinstance(target, str):
                return target

    # 3. 首条规则兜底
    if rules:
        target = rules[0].get("target_dag_id")
        if target and isinstance(target, str):
            return target
    return None


def _build_simulation_graph(dag_data: dict[str, Any]) -> tuple[str | None, set[str], dict[str, list[str]]]:
    """构建用于演习路径遍历的图结构。"""
    nodes: dict[str, Any] = dag_data.get("nodes", {})
    edges: list[Any] = dag_data.get("edges", [])

    entry_id: str | None = None
    terminals: set[str] = set()
    adj: dict[str, list[str]] = {nid: [] for nid in nodes}

    for nid, nd in nodes.items():
        if not isinstance(nd, dict):
            continue
        ntype = nd.get("node_type")
        if ntype == "START_ENTRY":
            entry_id = nid
        elif ntype == "TERMINAL_EXIT":
            terminals.add(nid)

    for e in edges:
        if isinstance(e, dict):
            u = e.get("from") or e.get("from_node_id")
            v = e.get("to") or e.get("to_node_id")
            if u in adj and v in nodes:
                adj[u].append(v)

    return entry_id, terminals, adj


def _find_all_paths(
    current: str,
    terminals: set[str],
    adj: dict[str, list[str]],
    path: list[str],
    visited: set[str],
    all_paths: list[list[str]],
) -> None:
    """深度优先搜索枚举所有从入口到终态的合规无环路径。"""
    path.append(current)
    visited.add(current)

    if current in terminals:
        all_paths.append(list(path))
    else:
        for nxt in adj.get(current, []):
            if nxt not in visited:
                _find_all_paths(nxt, terminals, adj, path, visited, all_paths)

    path.pop()
    visited.remove(current)


def _hydrate_text(template: str, context: dict[str, Any]) -> str:
    """水化文案中的占位符参数。"""
    def _repl(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(context.get(key, f"{{{key}}}"))
    return PARAM_REGEX.sub(_repl, template)


def _simulate_dag_branch(
    branch_idx: int,
    total_branches: int,
    path_nodes: list[str],
    nodes_data: dict[str, Any],
    i18n_catalog: dict[str, str],
    context: dict[str, Any],
) -> None:
    """打印单条叙事路径演习详情。"""
    print(f"\n🎬 ----------------- [分支 {branch_idx}/{total_branches}] -----------------")
    for step_num, nid in enumerate(path_nodes, start=1):
        nd = nodes_data.get(nid, {})
        ntype = nd.get("node_type", "UNKNOWN")
        nkey = nd.get("narrative_key", "")
        raw_text = i18n_catalog.get(nkey, f"<缺失文案: {nkey}>")
        hydrated_text = _hydrate_text(raw_text, context)

        print(f"  [{step_num}] 节点: {nid} ({ntype})")
        print(f"      叙事键 : {nkey}")
        print(f"      水化台词: \"{hydrated_text}\"")

        mutations = nd.get("mutations_on_complete", [])
        if mutations:
            print(f"      状态变更: {json.dumps(mutations, ensure_ascii=False)}")
    print("  🏁 分支终态: 剧情顺利达成 TERMINAL_EXIT。")


def _build_simulation_context(race_id: str, player_name: str) -> dict[str, Any]:
    """生成演习用模拟玩家状态上下文。"""
    return {
        "player_name": player_name,
        "race": race_id.upper(),
        "gender": "FEMALE",
        "level": 1,
        "world_id": "WORLD_SIMULATE_01",
        "town": "卡拉尔圣城",
        "gold": 500,
        "cur": 100,
        "max": 100,
        "name": player_name,
        "status": "NORMAL",
        "desc": "新晋冒险者",
    }


def simulate_mod(
    mod_dir: Path,
    race_id: str,
    player_name: str,
) -> int:
    """执行剧情模组无头分支演习。"""
    manifest_data = _load_json_file(mod_dir / "pack.json")
    if not isinstance(manifest_data, dict):
        print("❌ 错误: pack.json 不存在或格式非法", file=sys.stderr)
        return 1

    routing_data = _load_json_file(mod_dir / "routing_rules.json")
    target_dag_id = _match_target_dag(routing_data, race_id)
    if not target_dag_id:
        print("❌ 错误: 未能通过 routing_rules.json 匹配到目标 DAG", file=sys.stderr)
        return 1

    dag_path = mod_dir / "dag_graphs" / f"{target_dag_id}.json"
    dag_data = _load_json_file(dag_path)
    if not isinstance(dag_data, dict):
        print(f"❌ 错误: 目标 DAG 图元文件不存在: {dag_path}", file=sys.stderr)
        return 1

    entry_id, terminals, adj = _build_simulation_graph(dag_data)
    if not entry_id:
        print("❌ 错误: DAG 缺少 START_ENTRY 入口节点", file=sys.stderr)
        return 1

    i18n_catalog = _load_i18n_catalog(mod_dir / "i18n")
    all_paths: list[list[str]] = []
    _find_all_paths(entry_id, terminals, adj, [], set(), all_paths)

    context = _build_simulation_context(race_id, player_name)

    print("==============================================================================")
    print("🎭 卡拉尔 MOD 剧情无头演习推演引擎")
    print(f"  • MOD 名称   : {manifest_data.get('pack_name')} ({manifest_data.get('pack_id')})")
    print(f"  • 激活图元   : {target_dag_id}")
    print(f"  • 模拟角色   : {player_name} (种族: {race_id.upper()}, 等级: {context['level']})")
    print(f"  • 可达分支总数: {len(all_paths)} 条")
    print("==============================================================================")

    nodes = dag_data.get("nodes", {})
    for idx, path_nodes in enumerate(all_paths, start=1):
        _simulate_dag_branch(idx, len(all_paths), path_nodes, nodes, i18n_catalog, context)

    print("\n==============================================================================")
    print("🎉 无头推演演习圆满完成！所有分支均可通畅闭环。")
    print("==============================================================================")
    return 0


def preview_overview(mod_dir: Path) -> int:
    """输出 MOD 结构静态预览概览。"""
    manifest_data = _load_json_file(mod_dir / "pack.json")
    if not isinstance(manifest_data, dict):
        print("❌ 错误: 无法读取 pack.json", file=sys.stderr)
        return 1

    dag_dir = mod_dir / "dag_graphs"
    dag_files = sorted(dag_dir.glob("*.json")) if dag_dir.is_dir() else []
    i18n_catalog = _load_i18n_catalog(mod_dir / "i18n")

    print("==============================================================================")
    print(f"📖 MOD 静态概览预览: {manifest_data.get('pack_name', '未知模组')}")
    print("------------------------------------------------------------------------------")
    print(f"  • 标识符     : {manifest_data.get('pack_id')}")
    print(f"  • 版本       : {manifest_data.get('version')}")
    print(f"  • 作者       : {manifest_data.get('author')}")
    print(f"  • API 版本   : {manifest_data.get('engine_api_version')}")
    print(f"  • 加载优先级 : {manifest_data.get('priority')}")
    print(f"  • 语义标签   : {manifest_data.get('semantic_tags')}")
    print(f"  • 包含图元数 : {len(dag_files)} 份 ({', '.join(f.stem for f in dag_files)})")
    print(f"  • 本地化词条 : {len(i18n_catalog)} 条")
    print("------------------------------------------------------------------------------")
    print("💡 提示: 传入 '--simulate' 参数可启动无头剧情推演与占位符动态水化。")
    print("==============================================================================")
    return 0


def main() -> None:
    """命令行入口。"""
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 剧情演习与预览器 (Mod Narrative Previewer)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", help="待演习的 MOD 根目录路径")
    parser.add_argument("--simulate", action="store_true", dest="simulate", help="启动全分支剧情推演与文本占位符水化")
    parser.add_argument("--race", default="HUMAN", dest="race_id", help="模拟角色的种族 (默认: HUMAN)")
    parser.add_argument("--name", default="阿尔温", dest="player_name", help="模拟角色的名称 (默认: 阿尔温)")

    args = parser.parse_args()
    target_dir = Path(args.mod_dir)

    if not target_dir.is_dir():
        print(f"❌ 错误: 目标目录不存在: {target_dir}", file=sys.stderr)
        sys.exit(1)

    if args.simulate:
        code = simulate_mod(target_dir, args.race_id, args.player_name)
    else:
        code = preview_overview(target_dir)

    sys.exit(code)


if __name__ == "__main__":
    main()
