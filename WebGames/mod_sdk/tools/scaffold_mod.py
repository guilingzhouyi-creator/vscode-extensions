#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/scaffold_mod.py
# 架构定位: MOD项目骨架脚手架 (Mod Project Scaffolding CLI)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: 用户/Agent 命令行参数 | 下游: 生成合规 MOD 目录与骨架文件 | 运行时: Python 3.10+
# 职责说明: 解析 CLI 参数，自动化生成包含清单、路由、DAG 图元与多语言的标准 MOD 项目骨架
# 退出语义与设计依据: 退出码: 0=生成成功, 1=参数或IO错误, 2=参数解析错误 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/scaffold_mod.py --id my_pack --name "我的模组" --race HUMAN --output-dir ./my_pack
# ==============================================================================
"""MOD 项目骨架脚手架 CLI：自动化生成合规的标准卡拉尔剧情 MOD 骨架。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

try:
    from cook_assets import cook_assets
except ImportError:
    cook_assets = None

MINIMAL_PNG_BYTES: bytes = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?"
    b"\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _normalize_dag_id(pack_id: str) -> str:
    """从 pack_id 派生全大写 DAG 图标识符。"""
    clean_id = re.sub(r"[^A-Za-z0-9_]", "_", pack_id).upper()
    if not clean_id.startswith("DAG_"):
        return f"DAG_{clean_id}"
    return clean_id


def _build_manifest_dict(pack_id: str, pack_name: str) -> dict[str, Any]:
    """构建 pack.json 强类型清单结构。"""
    return {
        "pack_id": pack_id,
        "pack_name": pack_name,
        "version": "1.0.0",
        "author": "Kalar Modder",
        "engine_api_version": "1.0.0",
        "priority": 100,
        "dependencies": [],
        "incompatible_packs": [],
        "semantic_tags": ["story", "prologue"],
        "is_active": True,
    }


def _build_routing_dict(race_id: str, dag_id: str) -> dict[str, Any]:
    """构建 routing_rules.json 路由结构。"""
    return {
        "routing_rules": [
            {
                "match_condition": {
                    "race_id": race_id.upper(),
                },
                "target_dag_id": dag_id,
            },
            {
                "match_condition": {
                    "is_default": True,
                },
                "target_dag_id": dag_id,
            },
        ]
    }


def _build_sample_content_dict(pack_id: str, pack_name: str) -> dict[str, Any]:
    """构建 Tier 3 大魔改实体定义示例。"""
    clean_stem = pack_id.upper()
    return {
        "schema_version": "1.0.0",
        "custom_entities": [
            {
                "entity_id": f"ENTITY_{clean_stem}_RELIC",
                "name": f"{pack_name}·源初遗物",
                "category": "ANCIENT_RELIC",
                "description": f"源自《{pack_name}》的古老造物，散发微弱的法则共鸣。",
            }
        ],
    }


def _build_dag_dict(
    dag_id: str,
    pack_id: str,
    inline_text: bool = False,
    pack_name: str = "",
    with_assets: bool = False,
) -> dict[str, Any]:
    """构建标准三节点可达因果 DAG 图元（顶层携带 dag_id，可选 inline_text 语法糖与资产绑定）。"""
    clean_stem = pack_id.upper()
    entry_nid = f"NODE_{clean_stem}_START"
    step_nid = f"NODE_{clean_stem}_STEP"
    exit_nid = f"NODE_{clean_stem}_EXIT"

    start_key = f"narrative.{pack_id}.start"
    step_key = f"narrative.{pack_id}.step"
    exit_key = f"narrative.{pack_id}.exit"

    label = pack_name if pack_name else pack_id

    nodes: dict[str, Any] = {
        entry_nid: {
            "node_type": "START_ENTRY",
            "narrative_key": start_key,
            "required_prerequisites": [],
        },
        step_nid: {
            "node_type": "STANDARD_STEP",
            "narrative_key": step_key,
            "required_prerequisites": [entry_nid],
        },
        exit_nid: {
            "node_type": "TERMINAL_EXIT",
            "narrative_key": exit_key,
            "required_prerequisites": [step_nid],
            "mutations_on_complete": [
                {
                    "type": "PrologueCompleted",
                    "dag_id": dag_id,
                }
            ],
        },
    }

    if with_assets:
        nodes[entry_nid]["background_asset"] = "mod://assets/textures/background_sample.png"

    if inline_text:
        nodes[entry_nid]["inline_text"] = f"在《{label}》的初始启蒙点，{{player_name}} 缓缓苏醒。"
        nodes[step_nid]["inline_text"] = f"四周微光浮动，{{player_name}} 握紧武器迈出坚实步伐。"
        nodes[exit_nid]["inline_text"] = f"完成试炼，{{player_name}} 准备启程探索卡拉尔广袤天地。"

    return {
        "dag_id": dag_id,
        "entry_node_id": entry_nid,
        "terminal_node_id": exit_nid,
        "nodes": nodes,
        "edges": [
            {"from": entry_nid, "to": step_nid},
            {"from": step_nid, "to": exit_nid},
        ],
    }


def _ensure_utf8_stdout() -> None:
    """保障 Windows 控制台 UTF-8 输出，防止 emoji 字符编码异常。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _build_i18n_dict(pack_id: str, pack_name: str) -> dict[str, str]:
    """构建多语言字典模板，植入合规的玩家占位符。"""
    return {
        f"narrative.{pack_id}.start": f"在《{pack_name}》的初始启蒙点，{{player_name}} 缓缓苏醒。",
        f"narrative.{pack_id}.step": f"四周微光浮动，{{player_name}} 握紧武器迈出坚实步伐。",
        f"narrative.{pack_id}.exit": f"完成试炼，{{player_name}} 准备启程探索卡拉尔广袤天地。",
    }


def _build_destinies_dict(
    pack_id: str,
    pack_name: str,
    race_id: str,
    dag_id: str | None = None,
) -> dict[str, Any]:
    """构建合规的命途扩展配置 destinies.json 模板（注入 prologue_dag_id 与合法行囊）。"""
    clean_stem = re.sub(r"[^A-Za-z0-9_]", "_", pack_id).upper()
    origin_id = f"ORIGIN_{clean_stem}_INITIATE"
    pos_trait_id = f"TRAIT_{clean_stem}_BLESSING"
    neg_trait_id = f"TRAIT_{clean_stem}_BURDEN"
    kit_id = f"KIT_{clean_stem}_STARTER"
    actual_dag_id = dag_id if dag_id else _normalize_dag_id(pack_id)

    return {
        "ui_capabilities": {
            "origin_selection_mode": "ALLOW_MANUAL",
            "trait_selection_mode": "ALLOW_MANUAL",
            "allow_attribute_reroll": True,
        },
        "custom_origins": [
            {
                "origin_id": origin_id,
                "name": f"{pack_name}·秘传学徒",
                "race": race_id.upper(),
                "birth_region": "CENTRAL_CONTINENT",
                "weight": 25,
                "initial_gold": 150,
                "initial_reputation": 30,
                "prologue_dag_id": actual_dag_id,
                "starter_kit_id": kit_id,
                "attribute_bonus": {
                    "INT": 2,
                    "AGI": 1,
                    "CON": -1,
                },
                "desc": f"源自《{pack_name}》的自定义创角出身，兼顾灵能感知与敏捷身手。",
            }
        ],
        "custom_traits": [
            {
                "trait_id": pos_trait_id,
                "name": f"{pack_name}·星辉眷顾",
                "cost": 2,
                "type": "POSITIVE",
                "modifiers": {
                    "INT": 2,
                    "SPR": 1,
                },
                "desc": "先天灵觉敏锐，思维专注度与精神抗压显著提升。",
            },
            {
                "trait_id": neg_trait_id,
                "name": f"{pack_name}·星蚀负荷",
                "cost": -2,
                "type": "NEGATIVE",
                "modifiers": {
                    "CON": -1,
                    "VIT": -1,
                },
                "desc": "受秘传力量反噬，初始体魄与生理耐受上限略微降低。",
            },
        ],
        "paired_presets": [
            {
                "preset_id": f"PAIR_{clean_stem}_DEFAULT",
                "positive": pos_trait_id,
                "negative": neg_trait_id,
                "weight": 50,
            }
        ],
        "custom_starter_kits": [
            {
                "kit_id": kit_id,
                "name": f"{pack_name}·初始行囊",
                "initial_gold": 80,
                "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
                "initial_items": [
                    {
                        "canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
                        "count": 1,
                    },
                    {
                        "canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA",
                        "count": 2,
                    },
                ],
            }
        ],
    }


def _write_json(file_path: Path, payload: Any) -> None:
    """原子/标准写出 2 空格缩进的 JSON 文件（LF 换行）。"""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    with open(file_path, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(content)


def scaffold_mod(
    pack_id: str,
    pack_name: str,
    race_id: str = "HUMAN",
    out_dir: Path | None = None,
    with_destiny: bool = True,
    inline_text: bool = False,
    tier: int | None = None,
) -> int:
    """执行模组脚手架骨架生成。"""
    _ensure_utf8_stdout()
    if not pack_id or not re.match(r"^[A-Za-z0-9_]+$", pack_id):
        print(f"❌ 错误: pack_id 格式不合法 (仅允许字母数字下划线): '{pack_id}'", file=sys.stderr)
        return 1

    if not pack_name.strip():
        print("❌ 错误: pack_name 不能为空", file=sys.stderr)
        return 1

    if out_dir is None:
        out_dir = Path(pack_id)

    if tier is not None:
        effective_tier = tier
        if tier == 1:
            with_destiny = False
            with_assets = False
            with_content = False
        elif tier == 3:
            with_assets = True
            with_content = True
        else:
            with_assets = False
            with_content = False
    else:
        effective_tier = 2 if with_destiny else 1
        with_assets = False
        with_content = False

    dag_id = _normalize_dag_id(pack_id)
    manifest_data = _build_manifest_dict(pack_id, pack_name)
    routing_data = _build_routing_dict(race_id, dag_id)
    dag_data = _build_dag_dict(dag_id, pack_id, inline_text=inline_text, pack_name=pack_name, with_assets=with_assets)
    i18n_data = _build_i18n_dict(pack_id, pack_name)

    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_file = out_dir / "pack.json"
    routing_file = out_dir / "routing_rules.json"
    destinies_file = out_dir / "destinies.json"
    dag_file = out_dir / "dag_graphs" / f"{dag_id}.json"
    i18n_file = out_dir / "i18n" / "zh-CN.json"

    try:
        _write_json(manifest_file, manifest_data)
        _write_json(routing_file, routing_data)
        if with_destiny:
            destinies_data = _build_destinies_dict(pack_id, pack_name, race_id, dag_id)
            _write_json(destinies_file, destinies_data)
        _write_json(dag_file, dag_data)
        if not inline_text:
            _write_json(i18n_file, i18n_data)

        if with_assets:
            tex_dir = out_dir / "assets" / "textures"
            tex_dir.mkdir(parents=True, exist_ok=True)
            sample_png = tex_dir / "background_sample.png"
            sample_png.write_bytes(MINIMAL_PNG_BYTES)
            if cook_assets is not None:
                cook_assets(out_dir, check_only=False)

        if with_content:
            content_dir = out_dir / "content"
            content_dir.mkdir(parents=True, exist_ok=True)
            content_file = content_dir / "custom_entities.json"
            _write_json(content_file, _build_sample_content_dict(pack_id, pack_name))

    except OSError as io_err:
        print(f"❌ 写入文件失败: {io_err}", file=sys.stderr)
        return 1

    tier_labels = {
        1: "Tier 1 (极简纯剧情骨架)",
        2: "Tier 2 (命途系统扩展骨架)",
        3: "Tier 3 (全量富媒体与大魔改骨架)",
    }
    tier_desc = tier_labels.get(effective_tier, f"Tier {effective_tier}")

    print("==============================================================================")
    print("✨ MOD 骨架生成成功！")
    print(f"  • MOD 标识符 : {pack_id}")
    print(f"  • MOD 呈现名 : {pack_name}")
    print(f"  • 架构层级   : {tier_desc}")
    print(f"  • 匹配种族   : {race_id.upper()}")
    print(f"  • 根目录     : {out_dir}")
    print(f"  • 内联文本   : {'开启 (inline_text)' if inline_text else '关闭 (外部 i18n)'}")
    print("------------------------------------------------------------------------------")
    print(f"  [1] 清单定义 : {manifest_file.name}")
    print(f"  [2] 路由规则 : {routing_file.name}")
    print(f"  [3] 因果图元 : dag_graphs/{dag_file.name}")
    if not inline_text:
        print(f"  [4] 本地化包 : i18n/{i18n_file.name}")
    if with_destiny:
        print(f"  [5] 命途扩展 : {destinies_file.name}")
    if with_assets:
        print("  [6] 富媒体库 : assets/textures/background_sample.png & manifest.json")
    if with_content:
        print("  [7] 魔改实体 : content/custom_entities.json")
    print("==============================================================================")
    return 0


def main() -> None:
    """命令行主入口。"""
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 骨架生成器 (Scaffold Tool)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--id", required=True, dest="pack_id", help="MOD 包唯一标识符 (如 mod_elf_story)")
    parser.add_argument("--name", required=True, dest="pack_name", help="MOD 人类可读名称")
    parser.add_argument("--race", default="HUMAN", dest="race_id", help="默认绑定的角色种族 (默认: HUMAN)")
    parser.add_argument("--output-dir", required=True, dest="output_dir", help="生成的目标目录路径")
    parser.add_argument(
        "--tier",
        type=int,
        choices=[1, 2, 3],
        default=None,
        dest="tier",
        help="模组复杂度层级 (1=极简纯剧情, 2=命途扩展, 3=全量富媒体与大魔改, 默认: 2)",
    )
    parser.add_argument(
        "--with-destiny",
        action="store_true",
        dest="with_destiny",
        default=True,
        help="生成命途扩展配置文件 destinies.json (默认开启)",
    )
    parser.add_argument(
        "--no-destiny",
        action="store_false",
        dest="with_destiny",
        help="跳过生成 destinies.json",
    )
    parser.add_argument(
        "--inline-text",
        action="store_true",
        dest="inline_text",
        default=False,
        help="在 DAG 节点中直接内联 inline_text 文本，不强制依赖外部 i18n 词条",
    )

    args = parser.parse_args()
    code = scaffold_mod(
        pack_id=args.pack_id,
        pack_name=args.pack_name,
        race_id=args.race_id,
        out_dir=Path(args.output_dir),
        with_destiny=args.with_destiny,
        inline_text=args.inline_text,
        tier=args.tier,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
