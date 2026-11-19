#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · 演习报告与概览渲染器)
# 文件路径: WebGames/mod_sdk/tools/preview_mod_reports.py
# 架构定位: MOD 无头演习分支构建与 JSON/终端报告渲染子模块
# 依赖与触发: 触发方: preview_mod.py | 上游: 推演上下文与图元路径 | 下游: stdout/JSON 报告 | 运行时: Python 3.10+
# 职责说明: 构建剧情分支步骤载荷并渲染 simulate 与 overview 两种模式的 JSON 及终端文本报告
# 退出语义与设计依据: 工具库模块，返回进程建议退出码 (0) | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ------------------------------------------------------------------------------
# 用法示例:
#   from preview_mod_reports import build_simulation_branches, emit_overview_result, emit_simulation_result
# ==============================================================================
"""MOD 无头演习器报告渲染与分支步骤构建辅助模块。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import json


def build_simulation_branches(
    all_paths: list[list[str]],
    nodes: dict[str, Any],
    i18n_catalog: dict[str, str],
    context: dict[str, Any],
    resolve_raw_text: Callable[[dict[str, Any], dict[str, str]], tuple[str, str]],
    hydrate_text: Callable[[str, dict[str, Any]], str],
) -> list[dict[str, Any]]:
    """根据可达图元路径构造分支与逐步台词、视听及状态变更载荷。"""
    branches_payload: list[dict[str, Any]] = []
    for b_idx, path_nodes in enumerate(all_paths, start=1):
        steps_payload: list[dict[str, Any]] = []
        for step_num, nid in enumerate(path_nodes, start=1):
            nd = nodes.get(nid, {})
            raw_text, text_source = resolve_raw_text(nd, i18n_catalog)
            steps_payload.append(
                {
                    "step": step_num,
                    "node_id": nid,
                    "node_type": nd.get("node_type", "UNKNOWN"),
                    "narrative_key": nd.get("narrative_key", ""),
                    "background_asset": nd.get("background_asset") or nd.get("bg_asset"),
                    "bgm_asset": nd.get("bgm_asset") or nd.get("bgm"),
                    "text_source": text_source,
                    "raw_text": raw_text,
                    "hydrated_text": hydrate_text(raw_text, context),
                    "mutations_on_complete": nd.get("mutations_on_complete", []),
                }
            )
        branches_payload.append(
            {
                "branch_index": b_idx,
                "path_nodes": path_nodes,
                "steps": steps_payload,
            }
        )
    return branches_payload


def emit_simulation_result(
    manifest_data: dict[str, Any],
    target_dag_id: str,
    routing_source: str,
    selected_origin: dict[str, Any],
    player_name: str,
    race_id: str,
    final_attrs: dict[str, int],
    attr_summary: str,
    net_bonus: int,
    trait_summary: str,
    trait_net_cost: int,
    kit_summary: str,
    merged_gold: int,
    context_level: int,
    all_paths: list[list[str]],
    branches_payload: list[dict[str, Any]],
    as_json: bool,
) -> int:
    """输出 simulate 模式的结构化 JSON 或控制台演习报告。"""
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

    sep = "=" * 78
    print(sep)
    print("🎭 纯净世界引擎 MOD 剧情无头演习推演引擎")
    print(f"  • MOD 名称   : {manifest_data.get('pack_name')} ({manifest_data.get('pack_id')})")
    print(f"  • 激活图元   : {target_dag_id} (路由来源: {routing_source})")
    print(f"  • 选定身世   : {selected_origin.get('origin_id')} ({selected_origin.get('name')})")
    print(f"  • 模拟角色   : {player_name} (种族: {race_id.upper()}, 等级: {context_level})")
    print(f"  • 六维面板   : {attr_summary} (净加成: {net_bonus:+d})")
    print(f"  • 因果天赋   : {trait_summary} (净点数: {trait_net_cost:+d})")
    print(f"  • 初始装备   : {kit_summary}")
    print(f"  • 可达分支总数: {len(all_paths)} 条")
    print(sep)

    for branch in branches_payload:
        print(f"\n🎬 ----------------- [分支 {branch['branch_index']}/{len(all_paths)}] -----------------")
        for step in branch["steps"]:
            print(f"  [{step['step']}] 节点: {step['node_id']} ({step['node_type']}) [来源: {step['text_source']}]")
            if step.get("background_asset") or step.get("bgm_asset"):
                print(f"      视听绑定: 背景: {step.get('background_asset') or '无'} | BGM: {step.get('bgm_asset') or '无'}")
            print(f"      叙事键 : {step['narrative_key']}")
            print(f'      填充台词: "{step["hydrated_text"]}"')
            if step["mutations_on_complete"]:
                print(f"      状态变更: {json.dumps(step['mutations_on_complete'], ensure_ascii=False)}")
        print("  🏁 分支终态: 剧情顺利达成 TERMINAL_EXIT。")

    print(f"\n{sep}\n🎉 无头推演演习圆满完成！所有分支均可顺利抵达终态。\n{sep}")
    return 0


def emit_overview_result(
    manifest_data: dict[str, Any],
    destinies_data: Any,
    target_dag_id: str,
    routing_source: str,
    selected_origin: dict[str, Any],
    dag_files: list[Path],
    i18n_catalog: dict[str, str],
    normalize_list_items: Callable[[Any, str], list[dict[str, Any]]],
    as_json: bool,
) -> int:
    """输出 overview 模式的结构化 JSON 或人类可读控制台摘要。"""
    c_origins = normalize_list_items(destinies_data.get("custom_origins"), "origin_id") if isinstance(destinies_data, dict) else []
    c_traits = normalize_list_items(destinies_data.get("custom_traits"), "trait_id") if isinstance(destinies_data, dict) else []
    c_kits = normalize_list_items(destinies_data.get("custom_starter_kits"), "kit_id") if isinstance(destinies_data, dict) else []

    if as_json:
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
            "destinies_counts": {"origins": len(c_origins), "traits": len(c_traits), "starter_kits": len(c_kits)},
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("=" * 78)
    print(f"📖 MOD 静态概览预览: {manifest_data.get('pack_name', '未知模组')}")
    print("-" * 78)
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
        print(f"  • 命途扩展   : 身世 {len(c_origins)} 项 / 天赋 {len(c_traits)} 项 / 套件 {len(c_kits)} 套")
    print("-" * 78)
    print("💡 提示: 传入 '--simulate' 参数可启动无头剧情推演与字段动态填充。")
    print("=" * 78)
    return 0
