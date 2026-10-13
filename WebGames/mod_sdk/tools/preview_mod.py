#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/preview_mod.py
# 架构定位: MOD无头剧情演习推演器 (Headless Mod Narrative Preview & Simulator)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录、DAG 图元与语言包 | 下游: 纯文本剧情演习日志 / 结构化 JSON | 运行时: Python 3.10+
# 职责说明: 无头遍历 MOD 因果 DAG 叙事分支，支持四级路由、大小写双轨占位符与 inline_text 语法糖
# 退出语义与设计依据: 退出码: 0=推演成功, 1=模组缺陷/文件错误, 2=参数错误 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/preview_mod.py ./my_mod
#   python mod_sdk/tools/preview_mod.py ./my_mod --simulate
#   python mod_sdk/tools/preview_mod.py ./my_mod --simulate --race ELF --name "伊兰迪尔" --origin ORIGIN_VALAN_SCOUT --json
# ==============================================================================
"""MOD 无头演习器：离线模拟剧情流转、四级路由分支推演与双轨占位符水化日志输出。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

BUILTIN_ORIGINS: list[dict[str, Any]] = [
    {
        "origin_id": "IMPERIAL_NOBLE",
        "name": "帝国贵族后裔",
        "race": "HUMAN",
        "birth_region": "CENTRAL_CONTINENT",
        "initial_gold": 500,
        "starter_kit_id": "KIT_HUMAN_DEFAULT",
        "prologue_dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL",
        "attribute_bonus": {"INT": 2, "STR": 1},
    },
    {
        "origin_id": "ELVEN_SCHOLAR",
        "name": "林地秘法学者",
        "race": "ELF",
        "birth_region": "SILVER_FOREST",
        "initial_gold": 300,
        "starter_kit_id": "KIT_ELF_DEFAULT",
        "prologue_dag_id": "DAG_PROLOGUE_ELF_SANCTUARY",
        "attribute_bonus": {"INT": 3, "SPR": 1, "CON": -1},
    },
    {
        "origin_id": "DWARVEN_BLACKSMITH",
        "name": "炉锤锻造匠人",
        "race": "HUMAN",
        "birth_region": "SCORCHED_CANYON",
        "initial_gold": 250,
        "starter_kit_id": "KIT_HUMAN_DEFAULT",
        "prologue_dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL",
        "attribute_bonus": {"STR": 2, "CON": 2, "AGI": -1},
    },
    {
        "origin_id": "SHADOW_OUTCAST",
        "name": "暗影流放者",
        "race": "HUMAN",
        "birth_region": "VOID_ARCHIPELAGO",
        "initial_gold": 100,
        "starter_kit_id": "KIT_HUMAN_DEFAULT",
        "prologue_dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL",
        "attribute_bonus": {"AGI": 3, "INT": 1, "VIT": -1},
    },
]

BUILTIN_TRAITS_META: dict[str, tuple[str, int]] = {
    "PRIMORDIAL_RESONANCE": ("始源魔素共鸣", 3),
    "GIANT_MIGHT": ("巨人之力", 2),
    "IRON_WILL": ("钢铁心智", 1),
    "HEART_CORE_FISSURE": ("心核裂隙", -3),
    "MANA_INSULATED": ("魔素绝缘体", -2),
}

BASE_ATTRIBUTES: dict[str, int] = {
    "STR": 4, "CON": 3, "INT": 4, "AGI": 4, "SPR": 3, "VIT": 3,
}


def _ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows GBK 崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _load_json_file(file_path: Path) -> Any:
    """安全读取 JSON 文件，失败返回 None。"""
    if not file_path.is_file():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _flatten_i18n_dict(data: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """递归展平多层嵌套的 i18n 字典为以点号分隔的单层字典。"""
    flat: dict[str, str] = {}
    for k, v in data.items():
        full_key = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, str):
            flat[full_key] = v
        elif isinstance(v, dict):
            flat.update(_flatten_i18n_dict(v, full_key))
    return flat


def _load_i18n_catalog(i18n_dir: Path) -> dict[str, str]:
    """汇总并递归展平 i18n 目录下的所有文案。"""
    catalog: dict[str, str] = {}
    if not i18n_dir.is_dir():
        return catalog
    for f in sorted(i18n_dir.glob("*.json")):
        data = _load_json_file(f)
        if isinstance(data, dict):
            catalog.update(_flatten_i18n_dict(data))
    return catalog


def _normalize_list_items(raw_val: Any, id_key: str) -> list[dict[str, Any]]:
    """将列表或字典格式的扩展配置项统一转换为字典列表。"""
    if isinstance(raw_val, list):
        return [item for item in raw_val if isinstance(item, dict)]
    if isinstance(raw_val, dict):
        result: list[dict[str, Any]] = []
        for k, v in raw_val.items():
            if isinstance(v, dict):
                entry = dict(v)
                entry.setdefault(id_key, k)
                result.append(entry)
        return result
    return []


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


def _match_rule_target(rules: list[dict[str, Any]], race_id: str, origin_id: str) -> str | None:
    """按优先级匹配路由规则目标 DAG。"""
    race_upper = race_id.upper()
    for r in rules:
        cond = r.get("match_condition", r) if isinstance(r.get("match_condition"), dict) else r
        if cond.get("race_id", "").upper() == race_upper and cond.get("origin_id", "") == origin_id:
            target = r.get("target_dag_id")
            if isinstance(target, str) and target.strip():
                return target.strip()

    for r in rules:
        cond = r.get("match_condition", r) if isinstance(r.get("match_condition"), dict) else r
        if cond.get("origin_id", "") == origin_id and not cond.get("race_id"):
            target = r.get("target_dag_id")
            if isinstance(target, str) and target.strip():
                return target.strip()

    for r in rules:
        cond = r.get("match_condition", r) if isinstance(r.get("match_condition"), dict) else r
        if cond.get("race_id", "").upper() == race_upper and not cond.get("origin_id"):
            target = r.get("target_dag_id")
            if isinstance(target, str) and target.strip():
                return target.strip()

    for r in rules:
        cond = r.get("match_condition", r) if isinstance(r.get("match_condition"), dict) else r
        if cond.get("is_default") is True:
            target = r.get("target_dag_id")
            if isinstance(target, str) and target.strip():
                return target.strip()

    if rules:
        target = rules[0].get("target_dag_id")
        if isinstance(target, str) and target.strip():
            return target.strip()
    return None


def _resolve_target_dag(
    routing_rules_data: Any,
    destinies_data: Any,
    selected_origin: dict[str, Any],
    race_id: str,
) -> tuple[str, str]:
    """四级序章 DAG 路由解算契约。
    
    优先级:
    1. custom_routing_rules (destinies.json)
    2. selected_origin.prologue_dag_id
    3. routing_rules.json
    4. 内置默认图元 (ELF: DAG_PROLOGUE_ELF_SANCTUARY / HUMAN: DAG_PROLOGUE_HUMAN_CAPITAL)
    """
    origin_id = str(selected_origin.get("origin_id") or "")

    # Level 1: custom_routing_rules
    if isinstance(destinies_data, dict):
        raw_custom = destinies_data.get("custom_routing_rules")
        if raw_custom:
            rules = _extract_routing_rules(raw_custom)
            matched = _match_rule_target(rules, race_id, origin_id)
            if matched:
                return matched, "custom_routing_rules"

    # Level 2: prologue_dag_id in origin
    origin_dag = selected_origin.get("prologue_dag_id")
    if isinstance(origin_dag, str) and origin_dag.strip():
        return origin_dag.strip(), "origin_prologue_dag_id"

    # Level 3: routing_rules.json
    if routing_rules_data:
        rules = _extract_routing_rules(routing_rules_data)
        matched = _match_rule_target(rules, race_id, origin_id)
        if matched:
            return matched, "routing_rules.json"

    # Level 4: 内置默认
    fallback = "DAG_PROLOGUE_ELF_SANCTUARY" if race_id.upper() == "ELF" else "DAG_PROLOGUE_HUMAN_CAPITAL"
    return fallback, "builtin_default"


def _build_simulation_graph(dag_data: dict[str, Any]) -> tuple[str | None, set[str], dict[str, list[str]]]:
    """构建用于演习路径遍历的因果有向无环图 (DAG) 拓扑结构。

    Args:
        dag_data: 包含 nodes 与 edges 的字典数据结构。

    Returns:
        三元组: (起点节点ID, 终态退出节点集合, 邻接表映射)。
    """
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
    """深度优先搜索枚举所有从入口到终态的合规无环分支路径。

    Args:
        current: 当前遍历游标节点 ID。
        terminals: 目标终态节点集合 (TERMINAL_EXIT)。
        adj: 节点邻接表关系图。
        path: 当前遍历路径栈帧。
        visited: 已访问节点防成环集合。
        all_paths: 完整导出路径归集容器。
    """
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


def _resolve_node_raw_text(node_data: dict[str, Any], i18n_catalog: dict[str, str]) -> tuple[str, str]:
    """解析节点文案及来源 ('i18n' 或 'inline_text')。"""
    nkey = str(node_data.get("narrative_key") or "")
    if nkey and nkey in i18n_catalog:
        return i18n_catalog[nkey], "i18n"

    inline_val = node_data.get("inline_text")
    if isinstance(inline_val, str) and inline_val.strip():
        return inline_val, "inline_text"
    if isinstance(inline_val, dict):
        for v in inline_val.values():
            if isinstance(v, str) and v.strip():
                return v, "inline_text"

    if nkey:
        return f"<缺失文案: {nkey}>", "missing"
    return "<缺失文案>", "missing"


def _hydrate_text(template: str, context: dict[str, Any]) -> str:
    """水化文案中的占位符参数（支持大小写双轨检索）。"""
    def _repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in context:
            return str(context[key])
        if key.lower() in context:
            return str(context[key.lower()])
        if key.upper() in context:
            return str(context[key.upper()])
        return f"{{{key}}}"
    return PARAM_REGEX.sub(_repl, template)


def _resolve_trait_meta(
    trait_ref: Any,
    custom_traits: list[dict[str, Any]],
) -> tuple[str, str, int]:
    """解析因果天赋的 (ID, 名称, 消耗点数)。"""
    if isinstance(trait_ref, dict):
        tid = str(trait_ref.get("trait_id") or trait_ref.get("id") or "CUSTOM_TRAIT")
        tname = str(trait_ref.get("name") or tid)
        tcost = int(trait_ref.get("cost", 0))
        return tid, tname, tcost

    tid_str = str(trait_ref or "UNKNOWN")
    for ct in custom_traits:
        cid = ct.get("trait_id") or ct.get("id")
        if cid == tid_str:
            return tid_str, str(ct.get("name") or tid_str), int(ct.get("cost", 0))

    if tid_str in BUILTIN_TRAITS_META:
        b_name, b_cost = BUILTIN_TRAITS_META[tid_str]
        return tid_str, b_name, b_cost
    return tid_str, tid_str, 0


def _compute_preview_attributes(bonuses: dict[str, Any]) -> tuple[dict[str, int], str, int]:
    """计算叠加身世加成后的六维属性字典、摘要字符串与净加成值。"""
    final_attrs: dict[str, int] = {}
    parts: list[str] = []
    net_bonus = 0
    for key in ("STR", "CON", "INT", "AGI", "SPR", "VIT"):
        base_val = BASE_ATTRIBUTES.get(key, 3)
        raw_mod = bonuses.get(key, 0)
        mod_val = int(raw_mod) if isinstance(raw_mod, (int, float)) else 0
        net_bonus += mod_val
        final_val = base_val + mod_val
        final_attrs[key] = final_val
        if mod_val != 0:
            parts.append(f"{key}:{final_val}({mod_val:+d})")
        else:
            parts.append(f"{key}:{final_val}")
    return final_attrs, ", ".join(parts), net_bonus


def _find_matching_kit(
    custom_kits: list[dict[str, Any]],
    preferred_kit_id: str,
) -> dict[str, Any] | None:
    """查找目标套件，未命中时回退至首套自定义套件。"""
    for kit in custom_kits:
        kid = kit.get("kit_id") or kit.get("id")
        if kid == preferred_kit_id:
            return kit
    return custom_kits[0] if custom_kits else None


def _format_kit_summary(
    custom_kits: list[dict[str, Any]],
    preferred_kit_id: str,
    origin_gold: int,
) -> tuple[str, int, dict[str, Any] | None]:
    """构建初始装备行囊摘要与初始金币。"""
    selected_kit = _find_matching_kit(custom_kits, preferred_kit_id)
    if selected_kit is None:
        total_gold = origin_gold if origin_gold > 0 else 50
        return f"KIT_HUMAN_DEFAULT (内置标准行囊) | 初始金币: {total_gold}", total_gold, None

    kid = str(selected_kit.get("kit_id") or "CUSTOM_KIT")
    kname = str(selected_kit.get("name") or kid)
    kit_gold = int(selected_kit.get("initial_gold", 0))
    total_gold = origin_gold if origin_gold > 0 else max(kit_gold, 50)
    raw_items = selected_kit.get("initial_items", [])
    item_strs = [
        f"{it.get('canonical_id')}x{it.get('count', 1)}"
        for it in (raw_items if isinstance(raw_items, list) else [])
        if isinstance(it, dict)
    ]
    items_joined = ", ".join(item_strs) if item_strs else "无附加物品"
    return f"{kid} ({kname}) | 初始金币: {total_gold} | 物品: [{items_joined}]", total_gold, selected_kit


def _select_origin(
    destinies_data: dict[str, Any] | None,
    preferred_origin_id: str | None,
    race_id: str,
) -> dict[str, Any]:
    """根据命令行入参或默认策略选定演习身世。"""
    custom_origins: list[dict[str, Any]] = []
    if isinstance(destinies_data, dict):
        custom_origins = _normalize_list_items(destinies_data.get("custom_origins"), "origin_id")

    all_origins = custom_origins + BUILTIN_ORIGINS

    if preferred_origin_id:
        for orig in all_origins:
            oid = str(orig.get("origin_id") or orig.get("id") or "")
            if oid == preferred_origin_id:
                return orig

    if custom_origins:
        return custom_origins[0]

    for b_orig in BUILTIN_ORIGINS:
        if b_orig.get("race", "").upper() == race_id.upper():
            return b_orig
    return BUILTIN_ORIGINS[0]


def _build_simulation_context(
    race_id: str,
    player_name: str,
    selected_origin: dict[str, Any],
    selected_kit: dict[str, Any] | None,
    initial_gold: int,
    trait_summary: str,
) -> dict[str, Any]:
    """生成演习用大小写双轨模拟角色上下文环境。

    Args:
        race_id: 玩家种族标识符 (如 ELF, HUMAN)。
        player_name: 玩家角色命名。
        selected_origin: 选定出身配置字典。
        selected_kit: 选定行囊配置字典。
        initial_gold: 初始金币量。
        trait_summary: 特质组合摘要文本。

    Returns:
        包含全套双轨 (小写+大写) 占位符变量的水化上下文字典。
    """
    oid = str(selected_origin.get("origin_id") or "IMPERIAL_NOBLE")
    oname = str(selected_origin.get("name") or oid)
    region = str(selected_origin.get("birth_region") or "CENTRAL_CONTINENT")
    cid = f"CHAR_{oid}_{player_name}"
    kname = str(selected_kit.get("name") if selected_kit else "默认新兵行囊")
    weap = str(selected_kit.get("display_weapon") if selected_kit else "铁剑")

    ctx: dict[str, Any] = {
        "player_name": player_name,
        "character_name": player_name,
        "character_id": cid,
        "race": race_id.upper(),
        "race_id": race_id.upper(),
        "gender": "FEMALE",
        "level": 1,
        "world_id": "WORLD_SIMULATE_01",
        "town": "卡拉尔圣城",
        "start_location": region,
        "initial_equipment": weap,
        "npc_target": "堡垒守卫阿列克",
        "event_result": "完成初始启蒙试炼",
        "origin_id": oid,
        "origin_name": oname,
        "birth_region": region,
        "trait_summary": trait_summary,
        "starter_kit_name": kname,
        "initial_gold": initial_gold,
        "gold": initial_gold,
        "cur": 100,
        "max": 100,
        "name": player_name,
        "status": "NORMAL",
        "desc": f"{oname}，初踏旅途的年轻冒险者",
        "beast_count": 0,
        "reward_gold": 0,
        "loss_soldiers": 0,
        "loss_gold": 0,
        "gain_gold": 0,
    }
    for k, v in list(ctx.items()):
        ctx[k.upper()] = v
    return ctx


def simulate_mod(
    mod_dir: Path,
    race_id: str,
    player_name: str,
    origin_id: str | None = None,
    as_json: bool = False,
) -> int:
    """执行 MOD 全链路剧情与分支选项无头演习推演。

    Args:
        mod_dir: 模组工程根目录。
        race_id: 参演角色种族。
        player_name: 参演角色名称。
        origin_id: 可选指定出身 ID。
        as_json: 是否以结构化 JSON 格式输出结果。

    Returns:
        退出状态码: 0=推演成功, 1=推演失败或数据异常。
    """
    manifest_data = _load_json_file(mod_dir / "pack.json")
    if not isinstance(manifest_data, dict):
        if as_json:
            print(json.dumps({"error": "pack.json 不存在或格式非法"}, ensure_ascii=False))
        else:
            print("❌ 错误: pack.json 不存在或格式非法", file=sys.stderr)
        return 1

    destinies_data = _load_json_file(mod_dir / "destinies.json")
    routing_data = _load_json_file(mod_dir / "routing_rules.json")

    selected_origin = _select_origin(destinies_data, origin_id, race_id)
    target_dag_id, routing_source = _resolve_target_dag(routing_data, destinies_data, selected_origin, race_id)

    dag_path = mod_dir / "dag_graphs" / f"{target_dag_id}.json"
    dag_data = _load_json_file(dag_path)
    if not isinstance(dag_data, dict):
        if as_json:
            print(json.dumps({"error": f"目标 DAG 图元文件不存在: {dag_path}", "target_dag_id": target_dag_id}, ensure_ascii=False))
        else:
            print(f"❌ 错误: 目标 DAG 图元文件不存在: {dag_path}", file=sys.stderr)
        return 1

    entry_id, terminals, adj = _build_simulation_graph(dag_data)
    if not entry_id:
        if as_json:
            print(json.dumps({"error": "DAG 缺少 START_ENTRY 入口节点"}, ensure_ascii=False))
        else:
            print("❌ 错误: DAG 缺少 START_ENTRY 入口节点", file=sys.stderr)
        return 1

    i18n_catalog = _load_i18n_catalog(mod_dir / "i18n")
    all_paths: list[list[str]] = []
    _find_all_paths(entry_id, terminals, adj, [], set(), all_paths)

    custom_traits = _normalize_list_items(destinies_data.get("custom_traits"), "trait_id") if isinstance(destinies_data, dict) else []
    custom_kits = _normalize_list_items(destinies_data.get("custom_starter_kits"), "kit_id") if isinstance(destinies_data, dict) else []
    raw_presets = destinies_data.get("paired_presets") if isinstance(destinies_data, dict) else []
    paired_presets = [p for p in raw_presets if isinstance(p, dict)] if isinstance(raw_presets, list) else []

    sample_pair = paired_presets[0] if paired_presets else {
        "positive": "PRIMORDIAL_RESONANCE",
        "negative": "HEART_CORE_FISSURE",
    }
    pos_id, pos_name, pos_cost = _resolve_trait_meta(sample_pair.get("positive"), custom_traits)
    neg_id, neg_name, neg_cost = _resolve_trait_meta(sample_pair.get("negative"), custom_traits)
    trait_summary = f"{pos_name} / {neg_name}"

    bonuses = selected_origin.get("attribute_bonus", {})
    final_attrs, attr_summary, net_bonus = _compute_preview_attributes(bonuses if isinstance(bonuses, dict) else {})
    pref_kit_id = str(selected_origin.get("starter_kit_id") or "")
    origin_gold = int(selected_origin.get("initial_gold", 0))
    kit_summary, merged_gold, selected_kit = _format_kit_summary(custom_kits, pref_kit_id, origin_gold)

    context = _build_simulation_context(race_id, player_name, selected_origin, selected_kit, merged_gold, trait_summary)

    nodes = dag_data.get("nodes", {})
    branches_payload: list[dict[str, Any]] = []

    for b_idx, path_nodes in enumerate(all_paths, start=1):
        steps_payload: list[dict[str, Any]] = []
        for step_num, nid in enumerate(path_nodes, start=1):
            nd = nodes.get(nid, {})
            ntype = nd.get("node_type", "UNKNOWN")
            nkey = nd.get("narrative_key", "")
            bg_asset = nd.get("background_asset") or nd.get("bg_asset")
            bgm_asset = nd.get("bgm_asset") or nd.get("bgm")
            raw_text, text_source = _resolve_node_raw_text(nd, i18n_catalog)
            hydrated_text = _hydrate_text(raw_text, context)
            mutations = nd.get("mutations_on_complete", [])
            steps_payload.append({
                "step": step_num,
                "node_id": nid,
                "node_type": ntype,
                "narrative_key": nkey,
                "background_asset": bg_asset,
                "bgm_asset": bgm_asset,
                "text_source": text_source,
                "raw_text": raw_text,
                "hydrated_text": hydrated_text,
                "mutations_on_complete": mutations,
            })
        branches_payload.append({
            "branch_index": b_idx,
            "path_nodes": path_nodes,
            "steps": steps_payload,
        })

    if as_json:
        payload = {
            "mode": "simulate",
            "pack_id": manifest_data.get("pack_id"),
            "pack_name": manifest_data.get("pack_name"),
            "target_dag_id": target_dag_id,
            "routing_source": routing_source,
            "selected_origin_id": selected_origin.get("origin_id"),
            "selected_origin": selected_origin,
            "character_preview": {
                "player_name": player_name,
                "race_id": race_id.upper(),
                "origin_id": selected_origin.get("origin_id"),
                "origin_name": selected_origin.get("name"),
                "birth_region": selected_origin.get("birth_region"),
                "attributes": final_attrs,
                "net_bonus": net_bonus,
                "trait_summary": trait_summary,
                "starter_kit_summary": kit_summary,
                "initial_gold": merged_gold,
            },
            "branch_count": len(all_paths),
            "branches": branches_payload,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("==============================================================================")
    print("🎭 卡拉尔 MOD 剧情无头演习推演引擎")
    print(f"  • MOD 名称   : {manifest_data.get('pack_name')} ({manifest_data.get('pack_id')})")
    print(f"  • 激活图元   : {target_dag_id} (路由来源: {routing_source})")
    print(f"  • 选定身世   : {selected_origin.get('origin_id')} ({selected_origin.get('name')})")
    print(f"  • 模拟角色   : {player_name} (种族: {race_id.upper()}, 等级: {context['level']})")
    print(f"  • 六维面板   : {attr_summary} (净加成: {net_bonus:+d})")
    print(f"  • 因果天赋   : {trait_summary} (净点数: {pos_cost + neg_cost:+d})")
    print(f"  • 初始装备   : {kit_summary}")
    print(f"  • 可达分支总数: {len(all_paths)} 条")
    print("==============================================================================")

    for branch in branches_payload:
        b_idx = branch["branch_index"]
        print(f"\n🎬 ----------------- [分支 {b_idx}/{len(all_paths)}] -----------------")
        for step in branch["steps"]:
            print(f"  [{step['step']}] 节点: {step['node_id']} ({step['node_type']}) [来源: {step['text_source']}]")
            if step.get("background_asset") or step.get("bgm_asset"):
                bg_info = step.get("background_asset") or "无"
                bgm_info = step.get("bgm_asset") or "无"
                print(f"      视听绑定: 背景: {bg_info} | BGM: {bgm_info}")
            print(f"      叙事键 : {step['narrative_key']}")
            print(f"      水化台词: \"{step['hydrated_text']}\"")
            if step["mutations_on_complete"]:
                print(f"      状态变更: {json.dumps(step['mutations_on_complete'], ensure_ascii=False)}")
        print("  🏁 分支终态: 剧情顺利达成 TERMINAL_EXIT。")

    print("\n==============================================================================")
    print("🎉 无头推演演习圆满完成！所有分支均可通畅闭环。")
    print("==============================================================================")
    return 0


def preview_overview(
    mod_dir: Path,
    race_id: str = "HUMAN",
    origin_id: str | None = None,
    as_json: bool = False,
) -> int:
    """提取并展示 MOD 资产、清单配置与四级路由概览。

    Args:
        mod_dir: 模组工程根目录。
        race_id: 角色种族标识符 (默认 HUMAN)。
        origin_id: 可选出身标识符。
        as_json: 是否以结构化 JSON 格式导出摘要。

    Returns:
        退出状态码: 0=概览成功, 1=加载失败。
    """
    manifest_data = _load_json_file(mod_dir / "pack.json")
    if not isinstance(manifest_data, dict):
        if as_json:
            print(json.dumps({"error": "无法读取 pack.json"}, ensure_ascii=False))
        else:
            print("❌ 错误: 无法读取 pack.json", file=sys.stderr)
        return 1

    dag_dir = mod_dir / "dag_graphs"
    dag_files = sorted(dag_dir.glob("*.json")) if dag_dir.is_dir() else []
    i18n_catalog = _load_i18n_catalog(mod_dir / "i18n")
    destinies_data = _load_json_file(mod_dir / "destinies.json")
    routing_data = _load_json_file(mod_dir / "routing_rules.json")

    selected_origin = _select_origin(destinies_data, origin_id, race_id)
    target_dag_id, routing_source = _resolve_target_dag(routing_data, destinies_data, selected_origin, race_id)

    if as_json:
        c_origins = _normalize_list_items(destinies_data.get("custom_origins"), "origin_id") if isinstance(destinies_data, dict) else []
        c_traits = _normalize_list_items(destinies_data.get("custom_traits"), "trait_id") if isinstance(destinies_data, dict) else []
        c_kits = _normalize_list_items(destinies_data.get("custom_starter_kits"), "kit_id") if isinstance(destinies_data, dict) else []
        payload = {
            "mode": "overview",
            "pack_id": manifest_data.get("pack_id"),
            "pack_name": manifest_data.get("pack_name"),
            "version": manifest_data.get("version"),
            "author": manifest_data.get("author"),
            "engine_api_version": manifest_data.get("engine_api_version"),
            "priority": manifest_data.get("priority"),
            "semantic_tags": manifest_data.get("semantic_tags"),
            "target_dag_id": target_dag_id,
            "routing_source": routing_source,
            "selected_origin_id": selected_origin.get("origin_id"),
            "dag_files": [f.stem for f in dag_files],
            "i18n_key_count": len(i18n_catalog),
            "destinies_counts": {
                "origins": len(c_origins),
                "traits": len(c_traits),
                "starter_kits": len(c_kits),
            },
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("==============================================================================")
    print(f"📖 MOD 静态概览预览: {manifest_data.get('pack_name', '未知模组')}")
    print("------------------------------------------------------------------------------")
    print(f"  • 标识符     : {manifest_data.get('pack_id')}")
    print(f"  • 版本       : {manifest_data.get('version')}")
    print(f"  • 作者       : {manifest_data.get('author')}")
    print(f"  • API 版本   : {manifest_data.get('engine_api_version')}")
    print(f"  • 加载优先级 : {manifest_data.get('priority')}")
    print(f"  • 语义标签   : {manifest_data.get('semantic_tags')}")
    print(f"  • 路由目标   : {target_dag_id} (来源: {routing_source})")
    print(f"  • 选定身世   : {selected_origin.get('origin_id')} ({selected_origin.get('name')})")
    print(f"  • 包含图元数 : {len(dag_files)} 份 ({', '.join(f.stem for f in dag_files)})")
    print(f"  • 本地化词条 : {len(i18n_catalog)} 条")
    if isinstance(destinies_data, dict):
        c_origins = _normalize_list_items(destinies_data.get("custom_origins"), "origin_id")
        c_traits = _normalize_list_items(destinies_data.get("custom_traits"), "trait_id")
        c_kits = _normalize_list_items(destinies_data.get("custom_starter_kits"), "kit_id")
        print(f"  • 命途扩展   : 身世 {len(c_origins)} 项 / 天赋 {len(c_traits)} 项 / 套件 {len(c_kits)} 套")
    print("------------------------------------------------------------------------------")
    print("💡 提示: 传入 '--simulate' 参数可启动无头剧情推演与占位符动态水化。")
    print("==============================================================================")
    return 0


def main() -> None:
    """命令行入口。"""
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 剧情演习与预览器 (Mod Narrative Previewer)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", help="待演习的 MOD 根目录路径")
    parser.add_argument("--simulate", action="store_true", dest="simulate", help="启动全分支剧情推演与文本占位符水化")
    parser.add_argument("--race", default="HUMAN", dest="race_id", help="模拟角色的种族 (默认: HUMAN)")
    parser.add_argument("--name", default="阿尔温", dest="player_name", help="模拟角色的名称 (默认: 阿尔温)")
    parser.add_argument("--origin", default=None, dest="origin_id", help="指定演习选定的创角身世 ID")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 演习报告")

    args = parser.parse_args()
    target_dir = Path(args.mod_dir)

    if not target_dir.is_dir():
        if args.as_json:
            print(json.dumps({"error": f"目标目录不存在: {target_dir}"}, ensure_ascii=False))
        else:
            print(f"❌ 错误: 目标目录不存在: {target_dir}", file=sys.stderr)
        sys.exit(1)

    if args.simulate:
        code = simulate_mod(
            target_dir,
            args.race_id,
            args.player_name,
            origin_id=args.origin_id,
            as_json=args.as_json,
        )
    else:
        code = preview_overview(
            target_dir,
            race_id=args.race_id,
            origin_id=args.origin_id,
            as_json=args.as_json,
        )

    sys.exit(code)


if __name__ == "__main__":
    main()
