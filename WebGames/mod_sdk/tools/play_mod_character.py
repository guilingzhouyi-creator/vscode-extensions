#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Playtester)
# 文件路径: WebGames/mod_sdk/tools/play_mod_character.py
# 架构定位: 创角六维属性、因果天赋与初始行囊解算器
# 依赖与触发: 触发方: play_mod / play_mod_interactive | 上游: destinies.json / 默认配置 | 运行时: Python 3.10+
# 职责说明: 提供确定性六维属性生成 (总和 21)、身世与因果天赋筛选、角色全量面板与水化上下文构建
# 退出语义与设计依据: 纯计算与数据配置模块，无独立退出码 | 符合《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""创角六维属性、因果天赋与初始行囊解算器。"""

from __future__ import annotations

import hashlib
from typing import Any

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
        "desc": "自幼生长于帝国核心行省的贵胄子弟，兼修政理与礼仪剑术。",
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
        "desc": "巡礼于银林静谧古木之下的学士，熟稔古代魔素脉络与林地秘仪。",
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
        "desc": "在赤炎峡谷的深坑冶炼所历经淬火磨砺的精工巧匠，体魄敦实坚固。",
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
        "desc": "穿梭于虚空群岛迷雾与边缘街巷的无名游侠，机敏冷冽。",
    },
]

BUILTIN_TRAITS: list[dict[str, Any]] = [
    {
        "trait_id": "PRIMORDIAL_RESONANCE",
        "name": "始源魔素共鸣",
        "cost": 3,
        "type": "POSITIVE",
        "modifiers": {"INT": 2, "SPR": 1},
        "desc": "先天与世界始源魔网产生微弱共振，冥想施法效率大幅攀升。",
    },
    {
        "trait_id": "GIANT_MIGHT",
        "name": "巨人之力",
        "cost": 2,
        "type": "POSITIVE",
        "modifiers": {"STR": 2, "CON": 1},
        "desc": "骨骼与筋络天生强韧，具备超乎常人的负重与劈斩力道。",
    },
    {
        "trait_id": "IRON_WILL",
        "name": "钢铁心智",
        "cost": 1,
        "type": "POSITIVE",
        "modifiers": {"SPR": 1, "VIT": 1},
        "desc": "心如精钢坚韧不拔，对心灵震慑与创伤痛感具有卓越抗性。",
    },
    {
        "trait_id": "HEART_CORE_FISSURE",
        "name": "心核裂隙",
        "cost": -3,
        "type": "NEGATIVE",
        "modifiers": {"CON": -2, "VIT": -1},
        "desc": "胸口伴生微小虚空伤痕，肉体耐受力与生命恢复力受到压制。",
    },
    {
        "trait_id": "MANA_INSULATED",
        "name": "魔素绝缘体",
        "cost": -2,
        "type": "NEGATIVE",
        "modifiers": {"INT": -1, "SPR": -1},
        "desc": "躯壳肌理对游离魔素呈现绝缘钝化，精神感知与奥术理解受限。",
    },
]

BUILTIN_PAIRED_PRESETS: list[dict[str, Any]] = [
    {
        "preset_id": "PAIR_BUILTIN_RESONANCE",
        "positive": "PRIMORDIAL_RESONANCE",
        "negative": "HEART_CORE_FISSURE",
        "weight": 50,
    },
    {
        "preset_id": "PAIR_BUILTIN_MIGHT",
        "positive": "GIANT_MIGHT",
        "negative": "MANA_INSULATED",
        "weight": 50,
    },
]

BUILTIN_STARTER_KITS: list[dict[str, Any]] = [
    {
        "kit_id": "KIT_HUMAN_DEFAULT",
        "name": "王国制式新兵行囊",
        "initial_gold": 50,
        "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
        "initial_items": [
            {"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", "count": 1},
            {"canonical_id": "KALAR:CONSUM:FOOD:HEARTY_STEW", "count": 2},
        ],
    },
    {
        "kit_id": "KIT_ELF_DEFAULT",
        "name": "银林巡林者行囊",
        "initial_gold": 50,
        "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:ELVEN_BOW",
        "initial_items": [
            {"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:ELVEN_BOW", "count": 1},
            {"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "count": 2},
        ],
    },
]

BUILTIN_DAG_TEMPLATES: dict[str, dict[str, Any]] = {
    "DAG_PROLOGUE_HUMAN_CAPITAL": {
        "dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL",
        "entry_node_id": "NODE_CAPITAL_WAKE",
        "terminal_node_id": "NODE_CAPITAL_EXIT",
        "nodes": {
            "NODE_CAPITAL_WAKE": {
                "node_type": "START_ENTRY",
                "narrative_key": "prologue.capital.wake",
                "inline_text": "{PLAYER_NAME} 在王都卫戍营房的晨钟声中醒来，晨曦穿透铁窗。",
                "required_prerequisites": [],
            },
            "NODE_CAPITAL_GATE": {
                "node_type": "STANDARD_STEP",
                "narrative_key": "prologue.capital.gate",
                "inline_text": "在城防执勤官处检验军备，{PLAYER_NAME} 确认行囊佩剑无误。",
                "required_prerequisites": ["NODE_CAPITAL_WAKE"],
            },
            "NODE_CAPITAL_EXIT": {
                "node_type": "TERMINAL_EXIT",
                "narrative_key": "prologue.capital.exit",
                "inline_text": "城门徐徐拉起，{PLAYER_NAME} 迈入卡拉尔世界广袤大舞台。",
                "required_prerequisites": ["NODE_CAPITAL_GATE"],
                "mutations_on_complete": [
                    {"type": "PrologueCompleted", "dag_id": "DAG_PROLOGUE_HUMAN_CAPITAL"}
                ],
            },
        },
        "edges": [
            {"from": "NODE_CAPITAL_WAKE", "to": "NODE_CAPITAL_GATE"},
            {"from": "NODE_CAPITAL_GATE", "to": "NODE_CAPITAL_EXIT"},
        ],
    },
    "DAG_PROLOGUE_ELF_SANCTUARY": {
        "dag_id": "DAG_PROLOGUE_ELF_SANCTUARY",
        "entry_node_id": "NODE_SANCTUARY_WAKE",
        "terminal_node_id": "NODE_SANCTUARY_EXIT",
        "nodes": {
            "NODE_SANCTUARY_WAKE": {
                "node_type": "START_ENTRY",
                "narrative_key": "prologue.sanctuary.wake",
                "inline_text": "古树微光婆娑，{PLAYER_NAME} 在圣泉洗礼台上睁开眼眸。",
                "required_prerequisites": [],
            },
            "NODE_SANCTUARY_STEP": {
                "node_type": "STANDARD_STEP",
                "narrative_key": "prologue.sanctuary.step",
                "inline_text": "握紧佩弓，{PLAYER_NAME} 倾听风中传来的林地秘语。",
                "required_prerequisites": ["NODE_SANCTUARY_WAKE"],
            },
            "NODE_SANCTUARY_EXIT": {
                "node_type": "TERMINAL_EXIT",
                "narrative_key": "prologue.sanctuary.exit",
                "inline_text": "走出林冠结界，{PLAYER_NAME} 踏入大千凡尘。",
                "required_prerequisites": ["NODE_SANCTUARY_STEP"],
                "mutations_on_complete": [
                    {"type": "PrologueCompleted", "dag_id": "DAG_PROLOGUE_ELF_SANCTUARY"}
                ],
            },
        },
        "edges": [
            {"from": "NODE_SANCTUARY_WAKE", "to": "NODE_SANCTUARY_STEP"},
            {"from": "NODE_SANCTUARY_STEP", "to": "NODE_SANCTUARY_EXIT"},
        ],
    },
}


def generate_base_attributes(seed: str, reroll_nonce: int) -> dict[str, int]:
    """依据 seed 与 reroll_nonce 确定性生成和为 21 且单项在 [3, 5] 的六维基础属性。"""
    token = f"{seed}:{reroll_nonce}".encode("utf-8")
    digest = hashlib.sha256(token).digest()

    vals = [3, 3, 3, 3, 3, 3]
    for b in digest[:3]:
        idx = b % 6
        attempts = 0
        while vals[idx] >= 5 and attempts < 6:
            idx = (idx + 1) % 6
            attempts += 1
        vals[idx] += 1

    for step in range(4):
        b1 = digest[3 + step * 2]
        b2 = digest[3 + step * 2 + 1]
        i = b1 % 6
        j = b2 % 6
        if i != j and vals[i] < 5 and vals[j] > 3:
            vals[i] += 1
            vals[j] -= 1

    keys = ("STR", "CON", "INT", "AGI", "SPR", "VIT")
    return {k: vals[idx] for idx, k in enumerate(keys)}


def pick_origin(all_origins: list[dict[str, Any]], origin_id_param: str | None) -> dict[str, Any]:
    """从身世列表中选取目标身世配置。"""
    if not origin_id_param:
        return all_origins[0]
    for orig in all_origins:
        oid = str(orig.get("origin_id") or orig.get("id") or "")
        if oid == origin_id_param:
            return orig
    return all_origins[0]


def pick_trait_pair(
    all_presets: list[dict[str, Any]],
    all_traits: list[dict[str, Any]],
    trait_pair_param: str | None,
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    """选定因果天赋成对预设并构造天赋对象字典。"""
    trait_map = {str(t.get("trait_id") or t.get("id")): t for t in all_traits}
    selected_preset = all_presets[0]
    if trait_pair_param:
        for p in all_presets:
            pid = str(p.get("preset_id") or p.get("id") or "")
            if pid == trait_pair_param or p.get("positive") == trait_pair_param:
                selected_preset = p
                break

    pos_id = str(selected_preset.get("positive") or selected_preset.get("positive_trait") or "PRIMORDIAL_RESONANCE")
    neg_id = str(selected_preset.get("negative") or selected_preset.get("negative_trait") or "HEART_CORE_FISSURE")
    pos_obj = trait_map.get(pos_id, {"trait_id": pos_id, "name": pos_id, "cost": 2, "type": "POSITIVE"})
    neg_obj = trait_map.get(neg_id, {"trait_id": neg_id, "name": neg_id, "cost": -2, "type": "NEGATIVE"})
    pos_name = str(pos_obj.get("name") or pos_id)
    neg_name = str(neg_obj.get("name") or neg_id)
    return selected_preset, [pos_obj, neg_obj], f"{pos_name} / {neg_name}"


def pick_starter_kit(
    all_kits: list[dict[str, Any]],
    selected_origin: dict[str, Any],
) -> dict[str, Any]:
    """依据身世偏好选取初始装备行囊套件。"""
    pref_kit_id = str(selected_origin.get("starter_kit_id") or "")
    for k in all_kits:
        kid = str(k.get("kit_id") or k.get("id") or "")
        if kid == pref_kit_id:
            return k
    return all_kits[0]


def resolve_character_sheet(
    player_name: str,
    race_id: str,
    gender: str,
    origin_id_param: str | None,
    trait_pair_param: str | None,
    seed: str,
    reroll_nonce: int,
    all_origins: list[dict[str, Any]],
    all_traits: list[dict[str, Any]],
    all_presets: list[dict[str, Any]],
    all_kits: list[dict[str, Any]],
) -> dict[str, Any]:
    """解算角色全量面板数据（六维基底 21 点、身世修正、HP/MP/负重、因果天赋与初始行囊）。"""
    base_attrs = generate_base_attributes(seed, reroll_nonce)
    selected_origin = pick_origin(all_origins, origin_id_param)
    origin_id = str(selected_origin.get("origin_id") or "IMPERIAL_NOBLE")
    origin_name = str(selected_origin.get("name") or origin_id)
    birth_region = str(selected_origin.get("birth_region") or "CENTRAL_CONTINENT")
    origin_bonus = selected_origin.get("attribute_bonus") if isinstance(selected_origin.get("attribute_bonus"), dict) else {}

    final_attrs = {
        k: base_attrs[k] + int(origin_bonus.get(k, 0))
        for k in ("STR", "CON", "INT", "AGI", "SPR", "VIT")
    }

    hp = 100 + final_attrs["VIT"] * 15 + final_attrs["CON"] * 10
    mp = 50 + final_attrs["SPR"] * 15 + final_attrs["INT"] * 10
    carry_weight = round(30.0 + final_attrs["STR"] * 8.0 + final_attrs["CON"] * 4.0, 1)

    derived_stats = {
        "hp": hp,
        "max_hp": hp,
        "mp": mp,
        "max_mp": mp,
        "carry_weight": carry_weight,
        "max_weight": carry_weight,
    }

    selected_preset, traits_list, trait_summary = pick_trait_pair(all_presets, all_traits, trait_pair_param)
    pos_obj, neg_obj = traits_list[0], traits_list[1]
    selected_kit = pick_starter_kit(all_kits, selected_origin)

    orig_gold = int(selected_origin.get("initial_gold", 0))
    kit_gold = int(selected_kit.get("initial_gold", 0))
    initial_gold = orig_gold if orig_gold > 0 else max(kit_gold, 50)
    kit_name = str(selected_kit.get("name") or selected_kit.get("kit_id") or "标准新兵行囊")
    initial_equip = str(selected_kit.get("display_weapon") or "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD")
    initial_items = list(selected_kit.get("initial_items", []))

    return {
        "name": player_name,
        "player_name": player_name,
        "character_name": player_name,
        "character_id": f"CHAR_{origin_id}_{player_name}",
        "race": race_id.upper(),
        "race_id": race_id.upper(),
        "gender": gender.upper(),
        "seed": seed,
        "reroll_nonce": reroll_nonce,
        "origin_id": origin_id,
        "origin_name": origin_name,
        "birth_region": birth_region,
        "base_attributes": base_attrs,
        "base_points_sum": sum(base_attrs.values()),
        "origin_bonus": origin_bonus,
        "attributes": final_attrs,
        "final_attributes": final_attrs,
        "derived_stats": derived_stats,
        "hp": hp,
        "max_hp": hp,
        "mp": mp,
        "max_mp": mp,
        "carry_weight": carry_weight,
        "trait_pair_id": str(selected_preset.get("preset_id") or "PAIR_DEFAULT"),
        "trait_pair": {
            "preset_id": str(selected_preset.get("preset_id") or "PAIR_DEFAULT"),
            "positive": pos_obj,
            "negative": neg_obj,
            "net_cost": int(pos_obj.get("cost", 0)) + int(neg_obj.get("cost", 0)),
        },
        "traits": traits_list,
        "trait_summary": trait_summary,
        "starter_kit_id": str(selected_kit.get("kit_id") or "KIT_DEFAULT"),
        "starter_kit_name": kit_name,
        "initial_gold": initial_gold,
        "initial_items": initial_items,
        "initial_equipment": initial_equip,
    }


def build_character_context(char: dict[str, Any]) -> dict[str, Any]:
    """根据角色面板构建全量双轨占位符上下文字典。"""
    ctx: dict[str, Any] = {
        "player_name": char["player_name"],
        "character_name": char["character_name"],
        "character_id": char["character_id"],
        "race": char["race"],
        "race_id": char["race_id"],
        "gender": char["gender"],
        "level": 1,
        "world_id": "WORLD_KALAR_STAGE_01",
        "town": "卡拉尔圣城",
        "start_location": char["birth_region"],
        "initial_equipment": char["initial_equipment"],
        "npc_target": "圣城指引司铎",
        "event_result": "初始天命启蒙试炼顺利通关",
        "origin_id": char["origin_id"],
        "origin_name": char["origin_name"],
        "birth_region": char["birth_region"],
        "trait_summary": char["trait_summary"],
        "starter_kit_name": char["starter_kit_name"],
        "initial_gold": char["initial_gold"],
        "gold": char["initial_gold"],
        "cur": char["hp"],
        "max": char["max_hp"],
        "name": char["player_name"],
        "status": "NORMAL",
        "desc": f"{char['origin_name']}，命途初展之行者",
        "beast_count": 0,
        "reward_gold": 0,
        "loss_soldiers": 0,
        "loss_gold": 0,
        "gain_gold": 0,
    }
    for k, v in list(ctx.items()):
        ctx[k.upper()] = v
    return ctx
