#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/scaffold_mod.py
# 架构定位: MOD项目骨架脚手架 (Mod Project Scaffolding CLI)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: 用户/Agent 命令行参数 | 下游: 生成合规 MOD 目录与骨架文件 | 运行时: Python 3.10+
# 职责说明: 解析 CLI 参数，自动化生成包含清单、路由、DAG 图元与多语言的标准 MOD 项目骨架
# 退出语义与设计依据: 退出码: 0=生成成功, 1=参数或IO错误, 2=参数解析错误 | 设计依据: Phase 114 DevKit 工具链契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/scaffold_mod.py --id my_pack --name "我的模组" --race HUMAN --output-dir ./my_pack
# ==============================================================================
"""MOD 项目骨架脚手架 CLI：自动化生成合规的标准卡拉尔剧情 MOD 骨架。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


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


def _build_dag_dict(dag_id: str, pack_id: str) -> dict[str, Any]:
    """构建标准三节点可达因果 DAG 图元。"""
    clean_stem = pack_id.upper()
    entry_nid = f"NODE_{clean_stem}_START"
    step_nid = f"NODE_{clean_stem}_STEP"
    exit_nid = f"NODE_{clean_stem}_EXIT"

    start_key = f"narrative.{pack_id}.start"
    step_key = f"narrative.{pack_id}.step"
    exit_key = f"narrative.{pack_id}.exit"

    return {
        "entry_node_id": entry_nid,
        "terminal_node_id": exit_nid,
        "nodes": {
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
        },
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


def _build_destinies_dict(pack_id: str, pack_name: str, race_id: str) -> dict[str, Any]:
    """构建合规的命途扩展配置 destinies.json 模板。"""
    clean_stem = re.sub(r"[^A-Za-z0-9_]", "_", pack_id).upper()
    origin_id = f"ORIGIN_{clean_stem}_INITIATE"
    pos_trait_id = f"TRAIT_{clean_stem}_BLESSING"
    neg_trait_id = f"TRAIT_{clean_stem}_BURDEN"
    kit_id = f"KIT_{clean_stem}_STARTER"

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
    race_id: str,
    out_dir: Path,
    with_destiny: bool = True,
) -> int:
    """执行模组脚手架骨架生成。"""
    _ensure_utf8_stdout()
    if not pack_id or not re.match(r"^[A-Za-z0-9_]+$", pack_id):
        print(f"❌ 错误: pack_id 格式不合法 (仅允许字母数字下划线): '{pack_id}'", file=sys.stderr)
        return 1

    if not pack_name.strip():
        print("❌ 错误: pack_name 不能为空", file=sys.stderr)
        return 1

    dag_id = _normalize_dag_id(pack_id)
    manifest_data = _build_manifest_dict(pack_id, pack_name)
    routing_data = _build_routing_dict(race_id, dag_id)
    dag_data = _build_dag_dict(dag_id, pack_id)
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
            destinies_data = _build_destinies_dict(pack_id, pack_name, race_id)
            _write_json(destinies_file, destinies_data)
        _write_json(dag_file, dag_data)
        _write_json(i18n_file, i18n_data)
    except OSError as io_err:
        print(f"❌ 写入文件失败: {io_err}", file=sys.stderr)
        return 1

    print("==============================================================================")
    print("✨ MOD 骨架生成成功！")
    print(f"  • MOD 标识符 : {pack_id}")
    print(f"  • MOD 呈现名 : {pack_name}")
    print(f"  • 匹配种族   : {race_id.upper()}")
    print(f"  • 根目录     : {out_dir}")
    print("------------------------------------------------------------------------------")
    print(f"  [1] 清单定义 : {manifest_file.name}")
    print(f"  [2] 路由规则 : {routing_file.name}")
    print(f"  [3] 因果图元 : dag_graphs/{dag_file.name}")
    print(f"  [4] 本地化包 : i18n/{i18n_file.name}")
    if with_destiny:
        print(f"  [5] 命途扩展 : {destinies_file.name}")
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

    args = parser.parse_args()
    code = scaffold_mod(
        pack_id=args.pack_id,
        pack_name=args.pack_name,
        race_id=args.race_id,
        out_dir=Path(args.output_dir),
        with_destiny=args.with_destiny,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
