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


BUILTIN_TRAITS_META: dict[str, tuple[str, int]] = {
    "PRIMORDIAL_RESONANCE": ("始源魔素共鸣", 3),
    "GIANT_MIGHT": ("巨人之力", 2),
    "IRON_WILL": ("钢铁心智", 1),
    "HEART_CORE_FISSURE": ("心核裂隙", -3),
    "MANA_INSULATED": ("魔素绝缘体", -2),
}

BASE_ATTRIBUTES: dict[str, int] = {
    "STR": 4,
    "CON": 3,
    "INT": 4,
    "AGI": 4,
    "SPR": 3,
    "VIT": 3,
}


def _ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows GBK 崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


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


def _format_ui_mode_desc(mode: str) -> str:
    """格式化 UI 解锁策略的人类可读状态描述。"""
    if mode == "ALLOW_MANUAL":
        return "ALLOW_MANUAL (已解锁前端手动自选控件)"
    if mode == "FORCE_RANDOM":
        return "FORCE_RANDOM (强制随机盲盒抽取，锁定自选)"
    return f"{mode} (继承引擎默认创角策略)"


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


def _compute_preview_attributes(bonuses: dict[str, Any]) -> tuple[str, int]:
    """计算叠加身世加成后的六维属性摘要字符串与净加成值。"""
    parts: list[str] = []
    net_bonus = 0
    for key in ("STR", "CON", "INT", "AGI", "SPR", "VIT"):
        base_val = BASE_ATTRIBUTES.get(key, 3)
        raw_mod = bonuses.get(key, 0)
        mod_val = int(raw_mod) if isinstance(raw_mod, (int, float)) else 0
        net_bonus += mod_val
        final_val = base_val + mod_val
        if mod_val != 0:
            parts.append(f"{key}:{final_val}({mod_val:+d})")
        else:
            parts.append(f"{key}:{final_val}")
    return ", ".join(parts), net_bonus


def _find_matching_kit(
    custom_kits: list[dict[str, Any]],
    preferred_kit_id: str,
) -> dict[str, Any] | None:
    """在自定义套件列表中查找目标套件，未命中时回退至首套自定义套件。"""
    for kit in custom_kits:
        kid = kit.get("kit_id") or kit.get("id")
        if kid == preferred_kit_id:
            return kit
    return custom_kits[0] if custom_kits else None


def _format_kit_summary(
    custom_kits: list[dict[str, Any]],
    preferred_kit_id: str,
    origin_gold: int,
) -> tuple[str, int]:
    """构建初始装备行囊摘要与合并后的初始金币总额。"""
    selected_kit = _find_matching_kit(custom_kits, preferred_kit_id)
    if selected_kit is None:
        total_gold = origin_gold if origin_gold > 0 else 50
        return f"KIT_HUMAN_DEFAULT (内置标准行囊) | 初始金币: {total_gold}", total_gold

    kid = str(selected_kit.get("kit_id") or "CUSTOM_KIT")
    kname = str(selected_kit.get("name") or kid)
    kit_gold = int(selected_kit.get("initial_gold", 0))
    total_gold = origin_gold + kit_gold if origin_gold > 0 else max(kit_gold, 50)
    raw_items = selected_kit.get("initial_items", [])
    item_strs = [
        f"{it.get('canonical_id')}x{it.get('count', 1)}"
        for it in (raw_items if isinstance(raw_items, list) else [])
        if isinstance(it, dict)
    ]
    items_joined = ", ".join(item_strs) if item_strs else "无附加物品"
    return f"{kid} ({kname}) | 初始总金币: {total_gold} | 物品: [{items_joined}]", total_gold


def _simulate_destiny_preview(destinies_data: dict[str, Any], context: dict[str, Any]) -> None:
    """在序章演习前输出命途池合并摘要、UI 解锁状态与确定性抽卡/自选角色预览。"""
    ui_cap = destinies_data.get("ui_capabilities", {})
    if not isinstance(ui_cap, dict):
        ui_cap = {}

    custom_origins = _normalize_list_items(destinies_data.get("custom_origins"), "origin_id")
    custom_traits = _normalize_list_items(destinies_data.get("custom_traits"), "trait_id")
    raw_presets = destinies_data.get("paired_presets")
    paired_presets = [p for p in raw_presets if isinstance(p, dict)] if isinstance(raw_presets, list) else []
    custom_kits = _normalize_list_items(destinies_data.get("custom_starter_kits"), "kit_id")

    origin_mode = str(ui_cap.get("origin_selection_mode", "INHERIT"))
    trait_mode = str(ui_cap.get("trait_selection_mode", "INHERIT"))
    reroll_enabled = bool(ui_cap.get("allow_attribute_reroll", False))

    print("\n🔮 ----------------- [命途扩展与创角演习预览 (destinies.json)] -----------------")
    print("  [1] 命途池列表合并摘要 (Destiny Pool Merge Summary):")
    print(f"      • 身世池 (Origins)       : 内置 4 项 + MOD 扩展 {len(custom_origins)} 项 => 合并后共 {4 + len(custom_origins)} 项")
    print(f"      • 天赋池 (Traits)        : 内置 5 项 + MOD 扩展 {len(custom_traits)} 项 => 合并后共 {5 + len(custom_traits)} 项")
    print(f"      • 因果配对池 (Presets)   : 内置 2 组 + MOD 扩展 {len(paired_presets)} 组 => 合并后共 {2 + len(paired_presets)} 组")
    print(f"      • 初始行囊池 (Kits)      : 内置 2 套 + MOD 扩展 {len(custom_kits)} 套 => 合并后共 {2 + len(custom_kits)} 套")

    print("  [2] 前端 UI 控件解锁状态 (Frontend UI Unlock State):")
    print(f"      • 身世选择策略           : {_format_ui_mode_desc(origin_mode)}")
    print(f"      • 因果天赋策略           : {_format_ui_mode_desc(trait_mode)}")
    reroll_desc = "已开放 (允许重掷/自由分配六维)" if reroll_enabled else "已锁定 (仅使用权威随机六维)"
    print(f"      • 六维重掷开关           : {reroll_enabled} ({reroll_desc})")

    sample_origin = custom_origins[0] if custom_origins else {
        "origin_id": "IMPERIAL_NOBLE",
        "name": "帝国贵族后裔",
        "birth_region": "CENTRAL_CONTINENT",
        "initial_gold": 500,
        "starter_kit_id": "KIT_HUMAN_DEFAULT",
        "attribute_bonus": {"INT": 2, "STR": 1},
    }
    oid = str(sample_origin.get("origin_id") or sample_origin.get("id") or "CUSTOM_ORIGIN")
    oname = str(sample_origin.get("name") or oid)
    region = str(sample_origin.get("birth_region") or "CENTRAL_CONTINENT")
    bonuses = sample_origin.get("attribute_bonus", {})
    attr_summary, net_bonus = _compute_preview_attributes(bonuses if isinstance(bonuses, dict) else {})

    sample_pair = paired_presets[0] if paired_presets else {
        "positive": "PRIMORDIAL_RESONANCE",
        "negative": "HEART_CORE_FISSURE",
    }
    pos_id, pos_name, pos_cost = _resolve_trait_meta(sample_pair.get("positive"), custom_traits)
    neg_id, neg_name, neg_cost = _resolve_trait_meta(sample_pair.get("negative"), custom_traits)

    pref_kit_id = str(sample_origin.get("starter_kit_id") or "")
    origin_gold = int(sample_origin.get("initial_gold", 0))
    kit_summary, merged_gold = _format_kit_summary(custom_kits, pref_kit_id, origin_gold)
    context["gold"] = merged_gold

    print("  [3] 确定性抽卡/自选角色预览 (Deterministic Character Preview):")
    print(f"      • 选定身世 : {oid} ({oname}) [降临地域: {region}]")
    print(f"      • 六维面板 : {attr_summary} (基准21点, 身世净加成: {net_bonus:+d})")
    print(
        f"      • 因果天赋 : 正向[{pos_id}:{pos_name} ({pos_cost:+d})] + "
        f"负向[{neg_id}:{neg_name} ({neg_cost:+d})] => 净代数和: {pos_cost + neg_cost:+d}"
    )
    print(f"      • 初始装备 : {kit_summary}")


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
    destinies_data = _load_json_file(mod_dir / "destinies.json")

    print("==============================================================================")
    print("🎭 卡拉尔 MOD 剧情无头演习推演引擎")
    print(f"  • MOD 名称   : {manifest_data.get('pack_name')} ({manifest_data.get('pack_id')})")
    print(f"  • 激活图元   : {target_dag_id}")
    print(f"  • 模拟角色   : {player_name} (种族: {race_id.upper()}, 等级: {context['level']})")
    print(f"  • 命途扩展   : {'已启用 (destinies.json)' if isinstance(destinies_data, dict) else '未配置 (使用内置默认池)'}")
    print(f"  • 可达分支总数: {len(all_paths)} 条")
    print("==============================================================================")

    if isinstance(destinies_data, dict):
        _simulate_destiny_preview(destinies_data, context)

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
    destinies_data = _load_json_file(mod_dir / "destinies.json")

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
